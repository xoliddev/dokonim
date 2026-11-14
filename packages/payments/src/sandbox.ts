/**
 * Sandbox simulators (§11.4): each one plays the PROVIDER side and drives our REAL webhook handler with genuine
 * protocol messages (Payme JSON-RPC with a correct Basic header, Click form posts with real md5 signatures,
 * Uzum JSON with Basic auth, Telegram Bot API updates). `onMessage` streams every request/response so the demo's
 * "Payment debugger" can render a live protocol log.
 */
import { PAYME_TXN_TIMEOUT_MS } from '@dokonim/core';
import type { Clock, Minor, PaymentLedgerPort, ProviderConfig, ProviderId, RawWebhookRequest, RawWebhookResponse, WebhookHandler } from '@dokonim/core';
import { ClickWebhookHandler, clickSignString } from './click';
import { MemoryLedger } from './memory-ledger';
import { PAYME_REASON, PaymeWebhookHandler, paymeAuthHeader } from './payme';
import { PRE_CHECKOUT_DEADLINE_MS, TelegramPaymentsHandler } from './telegram';
import type { TelegramProvider } from './telegram';
import { UzumMerchantHandler } from './uzum';
import { basicHeader, formatTashkentTime, isRecord, randomDigits, randomHex, randomUuid, sleep, tiyinToSom } from './util';

/** Demo credentials used by every sandbox store (they never leave the sandbox). */
export const SANDBOX_CREDENTIALS: Record<'payme' | 'click' | 'uzum' | 'telegram' | 'stars', Record<string, string>> = {
  payme: { merchant_id: '64d0c0ffee0000000000d0c0', key: 'sandbox-payme-key' },
  click: { service_id: '10001', merchant_id: '20001', secret_key: 'sandbox-click-secret', merchant_user_id: '30001' },
  uzum: { terminal_id: 'sandbox-terminal', api_key: 'sandbox-api-key', service_id: '40001', webhook_login: 'uzum', webhook_password: 'sandbox-uzum-password' },
  telegram: { provider_token: '1234567890:TEST:sandbox', webhook_secret: 'sandbox-telegram-secret' },
  stars: { webhook_secret: 'sandbox-telegram-secret' },
};

export function sandboxConfig(provider: keyof typeof SANDBOX_CREDENTIALS): ProviderConfig {
  return { provider, mode: 'sandbox', enabled: true, publicConfig: {}, credentials: { ...SANDBOX_CREDENTIALS[provider] } };
}

export interface ProtocolMessage {
  provider: ProviderId;
  direction: 'request' | 'response';
  /** Method / action, e.g. "CreateTransaction", "prepare", "pre_checkout_query". */
  label: string;
  /** Parsed body (JSON object or form fields). */
  body: unknown;
  /** Exact bytes on the wire. */
  raw: string;
  /** HTTP status (responses only). */
  status?: number;
  at: number;
}

export type SimulationStatus = 'paid' | 'failed' | 'cancelled';

export interface SimulationResult {
  status: SimulationStatus;
  messages: ProtocolMessage[];
  /** Human-readable reason for failed / cancelled outcomes. */
  detail?: string;
}

export interface SimulatorOptions {
  ledger: PaymentLedgerPort;
  /** Store config for the provider (defaults to sandboxConfig(provider)). */
  config?: ProviderConfig;
  /** Handler under test (defaults to a fresh production handler). */
  handler?: WebhookHandler;
  onMessage?: (m: ProtocolMessage) => void;
  /** Provider-side clock (defaults to the ledger's clock). */
  clock?: Clock;
}

abstract class Simulator {
  protected readonly ledger: PaymentLedgerPort;
  protected readonly config: ProviderConfig;
  protected readonly handler: WebhookHandler;
  protected readonly clock: Clock;
  private readonly onMessage: ((m: ProtocolMessage) => void) | undefined;
  protected messages: ProtocolMessage[] = [];

  constructor(
    readonly provider: ProviderId,
    opts: SimulatorOptions,
    defaults: { config: ProviderConfig; handler: WebhookHandler },
  ) {
    this.ledger = opts.ledger;
    this.config = opts.config ?? defaults.config;
    this.handler = opts.handler ?? defaults.handler;
    this.clock = opts.clock ?? opts.ledger;
    this.onMessage = opts.onMessage;
  }

  protected begin(): void {
    this.messages = [];
  }

  protected emit(m: Omit<ProtocolMessage, 'provider' | 'at'>): void {
    const full: ProtocolMessage = { provider: this.provider, at: this.clock.now().getTime(), ...m };
    this.messages.push(full);
    this.onMessage?.(full);
  }

  /** Sends one request through the real handler, logging both directions. */
  protected async exchange(label: string, req: RawWebhookRequest, parsedBody: unknown, ledger: PaymentLedgerPort = this.ledger): Promise<{ res: RawWebhookResponse; json: unknown }> {
    this.emit({ direction: 'request', label, body: parsedBody, raw: req.body });
    const res = await this.handler.handle(req, this.config, ledger);
    let json: unknown = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = res.body;
    }
    this.emit({ direction: 'response', label, body: json, raw: res.body, status: res.status });
    return { res, json };
  }

  protected done(status: SimulationStatus, detail?: string): SimulationResult {
    return { status, messages: [...this.messages], ...(detail ? { detail } : {}) };
  }
}

// ── Payme ──────────────────────────────────────────────────────────────────

export type PaymeScenario = 'success' | 'insufficient_funds' | 'timeout' | 'wrong_amount';

export interface PaymeSimulatorOptions extends SimulatorOptions {
  /**
   * Moves the merchant clock forward (used by the 'timeout' scenario to cross the 12 h limit).
   * Defaults to `ledger.advance` when the ledger is a MemoryLedger; otherwise the simulator falls back to
   * sending CancelTransaction with reason 4, which is what Payme does after its own timeout.
   */
  advanceClock?: (ms: number) => void;
}

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: { en: string } };
}

export class SandboxPayme extends Simulator {
  private readonly advanceClock: ((ms: number) => void) | undefined;
  private rpcId = 1;

  constructor(opts: PaymeSimulatorOptions) {
    super('payme', opts, { config: sandboxConfig('payme'), handler: new PaymeWebhookHandler() });
    const l = opts.ledger;
    this.advanceClock = opts.advanceClock ?? (l instanceof MemoryLedger ? (ms: number) => l.advance(ms) : undefined);
  }

  /** Sends one JSON-RPC call exactly as Payme would. */
  async call(method: string, params: Record<string, unknown>): Promise<RpcReply> {
    const payload = { jsonrpc: '2.0', id: this.rpcId++, method, params };
    const body = JSON.stringify(payload);
    const req: RawWebhookRequest = {
      method: 'POST',
      headers: { authorization: paymeAuthHeader(this.config.credentials.key ?? ''), 'content-type': 'application/json' },
      body,
      contentType: 'application/json',
    };
    const { json } = await this.exchange(method, req, payload);
    return (isRecord(json) ? json : {}) as RpcReply;
  }

  async pay(orderId: string, amount: Minor, scenario: PaymeScenario = 'success'): Promise<SimulationResult> {
    this.begin();
    const account = { order_id: orderId };
    const txnId = randomHex(24);

    const check = await this.call('CheckPerformTransaction', { amount: scenario === 'wrong_amount' ? amount + 100 : amount, account });
    if (check.error) return this.done('failed', check.error.message.en);

    const create = await this.call('CreateTransaction', { id: txnId, time: this.clock.now().getTime(), amount, account });
    if (create.error) return this.done('failed', create.error.message.en);

    if (scenario === 'insufficient_funds') {
      // The card was declined in Payme's processing centre: Payme cancels the created transaction (reason 2).
      await this.call('CancelTransaction', { id: txnId, reason: PAYME_REASON.DEBIT_ERROR });
      await this.call('CheckTransaction', { id: txnId });
      return this.done('failed', 'Insufficient funds');
    }

    if (scenario === 'timeout') {
      if (this.advanceClock) {
        this.advanceClock(PAYME_TXN_TIMEOUT_MS + 60_000);
        const perform = await this.call('PerformTransaction', { id: txnId });
        await this.call('CheckTransaction', { id: txnId });
        return this.done('cancelled', perform.error?.message.en ?? 'Transaction timed out');
      }
      await this.call('CancelTransaction', { id: txnId, reason: PAYME_REASON.TIMEOUT });
      await this.call('CheckTransaction', { id: txnId });
      return this.done('cancelled', 'Transaction timed out');
    }

    const perform = await this.call('PerformTransaction', { id: txnId });
    if (perform.error) return this.done('failed', perform.error.message.en);
    return this.done('paid');
  }
}

// ── Click ──────────────────────────────────────────────────────────────────

export type ClickScenario = 'success' | 'duplicate_complete' | 'bad_signature' | 'wrong_amount' | 'user_cancelled';

/** Error Click puts in Complete when the payment failed on its side (VERIFY: -5017 = "insufficient funds"). */
export const CLICK_SIM_FAILURE_ERROR = -5017;

interface ClickReply {
  error?: number;
  error_note?: string;
  merchant_prepare_id?: number | null;
  merchant_confirm_id?: number | null;
}

export class SandboxClick extends Simulator {
  constructor(opts: SimulatorOptions) {
    super('click', opts, { config: sandboxConfig('click'), handler: new ClickWebhookHandler() });
  }

  /** Posts a form exactly as Click would (fields signed with the store's secret unless `badSign`). */
  async post(action: 'prepare' | 'complete', fields: Record<string, string>, badSign = false): Promise<ClickReply> {
    const secret = this.config.credentials.secret_key ?? '';
    const sign = clickSignString(
      {
        click_trans_id: fields.click_trans_id ?? '',
        service_id: fields.service_id ?? '',
        merchant_trans_id: fields.merchant_trans_id ?? '',
        merchant_prepare_id: fields.merchant_prepare_id ?? '',
        amount: fields.amount ?? '',
        action: fields.action ?? '',
        sign_time: fields.sign_time ?? '',
      },
      badSign ? `${secret}-tampered` : secret,
    );
    const all = { ...fields, sign_string: sign };
    const body = new URLSearchParams(all).toString();
    const req: RawWebhookRequest = {
      action,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      contentType: 'application/x-www-form-urlencoded',
    };
    const { json } = await this.exchange(action, req, all);
    return (isRecord(json) ? json : {}) as ClickReply;
  }

  async pay(orderId: string, amount: Minor, scenario: ClickScenario = 'success'): Promise<SimulationResult> {
    this.begin();
    const base = {
      click_trans_id: randomDigits(10),
      service_id: this.config.credentials.service_id ?? '',
      click_paydoc_id: randomDigits(10),
      merchant_trans_id: orderId,
      amount: tiyinToSom(scenario === 'wrong_amount' ? amount + 100 : amount),
    };
    const prepare = await this.post(
      'prepare',
      { ...base, action: '0', error: '0', error_note: 'Success', sign_time: formatTashkentTime(this.clock.now()) },
      scenario === 'bad_signature',
    );
    if (prepare.error !== 0) return this.done('failed', prepare.error_note);

    const failed = scenario === 'user_cancelled';
    const completeFields = {
      ...base,
      merchant_prepare_id: String(prepare.merchant_prepare_id ?? ''),
      action: '1',
      error: failed ? String(CLICK_SIM_FAILURE_ERROR) : '0',
      error_note: failed ? 'Cancelled by user' : 'Success',
      sign_time: formatTashkentTime(this.clock.now()),
    };
    const complete = await this.post('complete', completeFields);
    if (failed) return this.done('cancelled', complete.error_note);
    if (complete.error !== 0) return this.done('failed', complete.error_note);
    if (scenario === 'duplicate_complete') {
      const again = await this.post('complete', completeFields);
      if (again.error !== 0) return this.done('failed', `duplicate Complete answered ${again.error}`);
    }
    return this.done('paid');
  }
}

// ── Uzum ───────────────────────────────────────────────────────────────────

export type UzumScenario = 'success' | 'reversed' | 'wrong_amount';

interface UzumReply {
  status?: string;
  errorCode?: string;
}

export class SandboxUzum extends Simulator {
  constructor(opts: SimulatorOptions) {
    super('uzum', opts, { config: sandboxConfig('uzum'), handler: new UzumMerchantHandler() });
  }

  async send(action: 'check' | 'create' | 'confirm' | 'reverse' | 'status', payload: Record<string, unknown>): Promise<UzumReply> {
    const c = this.config.credentials;
    const full = { serviceId: Number(c.service_id) || c.service_id, timestamp: this.clock.now().getTime(), ...payload };
    const req: RawWebhookRequest = {
      action,
      method: 'POST',
      headers: { authorization: basicHeader(c.webhook_login ?? '', c.webhook_password ?? ''), 'content-type': 'application/json' },
      body: JSON.stringify(full),
      contentType: 'application/json',
    };
    const { json } = await this.exchange(action, req, full);
    return (isRecord(json) ? json : {}) as UzumReply;
  }

  async pay(orderId: string, amount: Minor, scenario: UzumScenario = 'success'): Promise<SimulationResult> {
    this.begin();
    const field = this.config.publicConfig.account_field?.trim() || 'order_id';
    const params = { [field]: orderId };
    const transId = randomUuid();
    const check = await this.send('check', { params });
    if (check.status !== 'OK') return this.done('failed', `check failed (${check.errorCode})`);
    const create = await this.send('create', { transId, params, amount: scenario === 'wrong_amount' ? amount + 100 : amount });
    if (create.status !== 'CREATED') return this.done('failed', `create failed (${create.errorCode})`);
    if (scenario === 'reversed') {
      await this.send('reverse', { transId });
      await this.send('status', { transId });
      return this.done('cancelled', 'Reversed by Uzum');
    }
    const confirm = await this.send('confirm', { transId, paymentSource: 'UZCARD', phone: '998900000000' });
    if (confirm.status !== 'CONFIRMED') return this.done('failed', `confirm failed (${confirm.errorCode})`);
    await this.send('status', { transId });
    return this.done('paid');
  }
}

// ── Telegram invoices ──────────────────────────────────────────────────────

export type TelegramInvoiceScenario = 'success' | 'duplicate_success' | 'wrong_amount' | 'slow_merchant';

export interface TelegramSimulatorOptions extends SimulatorOptions {
  provider?: TelegramProvider;
  /** Currency of the invoice (default XTR for stars, UZS for telegram). */
  currency?: string;
  /** Latency injected into the merchant's ledger in the 'slow_merchant' scenario (default 9.5 s). */
  slowMs?: number;
}

/** Wraps a ledger so checkPayable takes `ms` longer (simulates a slow merchant DB for the 10 s deadline). */
export function delayedLedger(l: PaymentLedgerPort, ms: number): PaymentLedgerPort {
  return {
    now: () => l.now(),
    checkPayable: async (ref, amount) => {
      await sleep(ms);
      return l.checkPayable(ref, amount);
    },
    getTransaction: (p, id) => l.getTransaction(p, id),
    activeTransactionForOrder: (p, o) => l.activeTransactionForOrder(p, o),
    openTransaction: (i) => l.openTransaction(i),
    confirmTransaction: (p, id) => l.confirmTransaction(p, id),
    cancelTransaction: (p, id, r) => l.cancelTransaction(p, id, r),
    statement: (p, f, t) => l.statement(p, f, t),
    log: (e) => l.log(e),
  };
}

export class SandboxTelegramInvoice extends Simulator {
  private readonly currency: string;
  private readonly slowMs: number;
  private updateId = Math.floor(Math.random() * 1e6);

  constructor(opts: TelegramSimulatorOptions) {
    const provider = opts.provider ?? 'stars';
    super(provider, opts, { config: sandboxConfig(provider), handler: new TelegramPaymentsHandler(provider) });
    this.currency = opts.currency ?? (provider === 'stars' ? 'XTR' : 'UZS');
    this.slowMs = opts.slowMs ?? PRE_CHECKOUT_DEADLINE_MS + 500;
  }

  private async update(label: string, update: Record<string, unknown>, ledger?: PaymentLedgerPort) {
    const req: RawWebhookRequest = {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': this.config.credentials.webhook_secret ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(update),
      contentType: 'application/json',
    };
    return this.exchange(label, req, update, ledger);
  }

  async pay(paymentId: string, amount: Minor, scenario: TelegramInvoiceScenario = 'success'): Promise<SimulationResult> {
    this.begin();
    const from = { id: 777000, is_bot: false, first_name: 'Sandbox', language_code: 'uz' };
    const total = scenario === 'wrong_amount' ? amount + (this.currency === 'XTR' ? 1 : 100) : amount;
    const ledger = scenario === 'slow_merchant' ? delayedLedger(this.ledger, this.slowMs) : this.ledger;
    const pre = await this.update(
      'pre_checkout_query',
      {
        update_id: this.updateId++,
        pre_checkout_query: { id: randomDigits(18), from, currency: this.currency, total_amount: total, invoice_payload: paymentId },
      },
      ledger,
    );
    const answer = isRecord(pre.json) ? pre.json : {};
    if (answer.ok !== true) return this.done('failed', typeof answer.error_message === 'string' ? answer.error_message : 'pre_checkout rejected');

    const chargeId = `${this.provider === 'stars' ? 'stxsandbox' : 'tgsandbox'}_${randomHex(20)}`;
    const success = {
      update_id: this.updateId++,
      message: {
        message_id: Number(randomDigits(6)),
        date: Math.floor(this.clock.now().getTime() / 1000),
        chat: { id: from.id, type: 'private' },
        from,
        successful_payment: {
          currency: this.currency,
          total_amount: total,
          invoice_payload: paymentId,
          telegram_payment_charge_id: chargeId,
          provider_payment_charge_id: this.provider === 'stars' ? '' : `sandbox_${randomHex(12)}`,
        },
      },
    };
    await this.update('successful_payment', success);
    if (scenario === 'duplicate_success') await this.update('successful_payment', { ...success, update_id: this.updateId++ });
    const txn = await this.ledger.getTransaction(this.provider, chargeId);
    return txn?.status === 'paid' ? this.done('paid') : this.done('failed', `payment is ${txn?.status ?? 'missing'}`);
  }
}
