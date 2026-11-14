/**
 * Payme Merchant API (JSON-RPC 2.0, "Payme calls us"). §11.1, §16.4.
 *
 * - Auth: `Authorization: Basic base64("Paycom:<key>")`, compared in constant time. Wrong → −32504.
 * - Always HTTP 200; errors travel in the JSON-RPC `error` object with a localized `message: {uz, ru, en}`.
 * - Account field: `params.account.order_id` = our order id. Amounts are tiyin (= our UZS minor units).
 * - `transaction` in responses = our payment id (TxnView.paymentId); times are OUR create/perform/cancel times in ms.
 * - An unperformed transaction older than 12 h (PAYME_TXN_TIMEOUT_MS, measured with ledger.now()) is cancelled with
 *   reason 4 and the call answers −31008.
 * - Every call is logged through ledger.log(); the handler never touches storage directly.
 */
import { PAYME_TXN_TIMEOUT_MS, isDomainError, statusToPaymeState, utf8b64 } from '@dokonim/core';
import type {
  AuthResult,
  CheckResult,
  Locale,
  Minor,
  PaymentLedgerPort,
  ProviderConfig,
  RawWebhookRequest,
  RawWebhookResponse,
  TxnView,
  WebhookHandler,
} from '@dokonim/core';
import { basicAuthMatches, getHeader, isRecord, jsonResponse } from './util';

export const PAYME_ERROR = {
  WRONG_AMOUNT: -31001,
  TXN_NOT_FOUND: -31003,
  CANNOT_CANCEL: -31007,
  CANNOT_PERFORM: -31008,
  ORDER: -31050,
  SYSTEM: -32400,
  INSUFFICIENT_PRIVILEGE: -32504,
  TRANSPORT: -32300,
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
} as const;

/** Payme cancel reasons (Merchant API "reason" field). */
export const PAYME_REASON = {
  RECEIVER_NOT_FOUND: 1,
  DEBIT_ERROR: 2,
  EXECUTION_ERROR: 3,
  TIMEOUT: 4,
  REFUND: 5,
  UNKNOWN: 10,
} as const;

export const PAYME_METHODS = [
  'CheckPerformTransaction',
  'CreateTransaction',
  'PerformTransaction',
  'CancelTransaction',
  'CheckTransaction',
  'GetStatement',
  'SetFiscalData',
] as const;
export type PaymeMethod = (typeof PAYME_METHODS)[number];

type L10nMessage = Record<Locale, string>;

const MSG = {
  wrong_amount: { uz: "Noto'g'ri summa", ru: 'Неверная сумма', en: 'Incorrect amount' },
  txn_not_found: { uz: 'Tranzaksiya topilmadi', ru: 'Транзакция не найдена', en: 'Transaction not found' },
  cannot_cancel: {
    uz: "Tranzaksiyani bekor qilib bo'lmaydi: buyurtma bajarilgan",
    ru: 'Невозможно отменить транзакцию: заказ выполнен',
    en: 'Cannot cancel the transaction: the order is fulfilled',
  },
  cannot_perform: {
    uz: "Bu amalni bajarib bo'lmaydi",
    ru: 'Невозможно выполнить данную операцию',
    en: 'Unable to perform this operation',
  },
  expired: {
    uz: "Tranzaksiya muddati o'tdi (12 soat) va bekor qilindi",
    ru: 'Истекло время ожидания транзакции (12 часов), транзакция отменена',
    en: 'The transaction timed out (12 h) and was cancelled',
  },
  order_not_found: { uz: 'Buyurtma topilmadi', ru: 'Заказ не найден', en: 'Order not found' },
  order_busy: {
    uz: "Buyurtma uchun boshqa to'lov kutilmoqda",
    ru: 'По заказу уже ожидается другая оплата',
    en: 'Another payment for this order is already in progress',
  },
  order_paid: { uz: "Buyurtma allaqachon to'langan", ru: 'Заказ уже оплачен', en: 'The order is already paid' },
  order_cancelled: { uz: 'Buyurtma bekor qilingan', ru: 'Заказ отменён', en: 'The order is cancelled' },
  order_not_payable: {
    uz: "Buyurtmani hozir to'lab bo'lmaydi",
    ru: 'Заказ сейчас нельзя оплатить',
    en: 'The order cannot be paid right now',
  },
  system: { uz: 'Ichki xatolik', ru: 'Внутренняя ошибка', en: 'Internal error' },
  auth: { uz: "Ruxsat yo'q", ru: 'Недостаточно привилегий для выполнения метода', en: 'Insufficient privileges' },
  transport: { uz: 'Faqat POST so‘rovlar qabul qilinadi', ru: 'Метод запроса не POST', en: 'Request method must be POST' },
  parse: { uz: "JSON tahlil qilib bo'lmadi", ru: 'Ошибка парсинга JSON', en: 'Parse error' },
  invalid_request: {
    uz: "So'rovda majburiy maydonlar yo'q yoki noto'g'ri",
    ru: 'Отсутствуют обязательные поля или неверный тип полей',
    en: 'Missing or invalid request fields',
  },
  method_not_found: { uz: 'Metod topilmadi', ru: 'Запрашиваемый метод не найден', en: 'Method not found' },
} satisfies Record<string, L10nMessage>;

export type PaymeMessageKey = keyof typeof MSG;

export class PaymeError extends Error {
  constructor(
    readonly code: number,
    readonly key: PaymeMessageKey,
    readonly data?: string,
  ) {
    super(MSG[key].en);
    this.name = 'PaymeError';
  }
  toJSON(): { code: number; message: L10nMessage; data?: string } {
    return { code: this.code, message: MSG[this.key], ...(this.data !== undefined ? { data: this.data } : {}) };
  }
}

export interface PaymeTxnResult {
  create_time?: number;
  perform_time?: number;
  cancel_time?: number;
  transaction: string;
  state: number;
  reason?: number | null;
}

export interface PaymeStatementEntry {
  id: string;
  time: number;
  amount: number;
  account: { order_id: string };
  create_time: number;
  perform_time: number;
  cancel_time: number;
  transaction: string;
  state: number;
  reason: number | null;
}

/** Payme state from our payment status (1/2/−1/−2). */
export function paymeState(t: TxnView): number {
  return statusToPaymeState(t.status);
}

/** Maps a failed CheckResult to the Payme error the protocol expects. */
export function paymeErrorForCheck(r: Extract<CheckResult, { ok: false }>): PaymeError {
  switch (r.reason) {
    case 'amount_mismatch':
      return new PaymeError(PAYME_ERROR.WRONG_AMOUNT, 'wrong_amount', 'amount');
    case 'not_found':
      return new PaymeError(PAYME_ERROR.ORDER, 'order_not_found', 'order_id');
    case 'already_paid':
      return new PaymeError(PAYME_ERROR.ORDER, 'order_paid', 'order_id');
    case 'cancelled':
      return new PaymeError(PAYME_ERROR.ORDER, 'order_cancelled', 'order_id');
    default:
      return new PaymeError(PAYME_ERROR.ORDER, 'order_not_payable', 'order_id');
  }
}

const isLive = (t: TxnView) => t.status === 'created' || t.status === 'pending';

/** Builds the exact `Authorization` header Payme sends. */
export function paymeAuthHeader(key: string): string {
  return `Basic ${utf8b64(`Paycom:${key}`)}`;
}

export interface PaymeHandlerOptions {
  /** Override the 12 h timeout (tests only; Payme's value is fixed). */
  timeoutMs?: number;
}

export class PaymeWebhookHandler implements WebhookHandler {
  readonly id = 'payme' as const;
  private readonly timeoutMs: number;

  constructor(opts: PaymeHandlerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? PAYME_TXN_TIMEOUT_MS;
  }

  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult {
    const key = cfg.credentials.key ?? '';
    if (!basicAuthMatches(getHeader(req, 'authorization'), 'Paycom', key)) {
      return { ok: false, reason: key ? 'bad credentials' : 'payme key is not configured' };
    }
    return { ok: true };
  }

  async handle(req: RawWebhookRequest, cfg: ProviderConfig, ledger: PaymentLedgerPort): Promise<RawWebhookResponse> {
    let id: unknown = null;
    let kind = 'unknown';
    let signatureOk = false;
    let body: Record<string, unknown>;
    try {
      if (req.method && req.method.toUpperCase() !== 'POST') throw new PaymeError(PAYME_ERROR.TRANSPORT, 'transport');
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body);
      } catch {
        throw new PaymeError(PAYME_ERROR.PARSE, 'parse');
      }
      if (isRecord(parsed)) {
        id = parsed.id ?? null;
        if (typeof parsed.method === 'string') kind = parsed.method;
      }
      const auth = this.authenticate(req, cfg);
      signatureOk = auth.ok;
      if (!auth.ok) throw new PaymeError(PAYME_ERROR.INSUFFICIENT_PRIVILEGE, 'auth');
      if (!isRecord(parsed) || typeof parsed.method !== 'string' || !isRecord(parsed.params)) {
        throw new PaymeError(PAYME_ERROR.INVALID_REQUEST, 'invalid_request');
      }
      const result = await this.dispatch(parsed.method, parsed.params, ledger);
      body = { jsonrpc: '2.0', id, result };
    } catch (e) {
      const err = e instanceof PaymeError ? e : new PaymeError(PAYME_ERROR.SYSTEM, 'system');
      body = { jsonrpc: '2.0', id, error: err.toJSON() };
    }
    const res = jsonResponse(body, 200);
    await ledger.log({ provider: 'payme', kind, payload: req.body, signatureOk, response: res.body });
    return res;
  }

  private dispatch(method: string, params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<unknown> {
    switch (method) {
      case 'CheckPerformTransaction':
        return this.checkPerform(params, ledger);
      case 'CreateTransaction':
        return this.create(params, ledger);
      case 'PerformTransaction':
        return this.perform(params, ledger);
      case 'CancelTransaction':
        return this.cancel(params, ledger);
      case 'CheckTransaction':
        return this.checkTxn(params, ledger);
      case 'GetStatement':
        return this.statement(params, ledger);
      case 'SetFiscalData':
        // Fiscal receipt data is acknowledged; storing it is the ledger/log's job (raw payload is logged).
        return Promise.resolve({ success: true });
      default:
        throw new PaymeError(PAYME_ERROR.METHOD_NOT_FOUND, 'method_not_found', method);
    }
  }

  // ── param helpers ──
  private str(params: Record<string, unknown>, key: string): string {
    const v = params[key];
    if (typeof v !== 'string' || !v) throw new PaymeError(PAYME_ERROR.INVALID_REQUEST, 'invalid_request', key);
    return v;
  }
  private int(params: Record<string, unknown>, key: string): number {
    const v = params[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new PaymeError(PAYME_ERROR.INVALID_REQUEST, 'invalid_request', key);
    return v;
  }
  private amount(params: Record<string, unknown>): Minor {
    const v = params.amount;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new PaymeError(PAYME_ERROR.WRONG_AMOUNT, 'wrong_amount', 'amount');
    return v;
  }
  private orderId(params: Record<string, unknown>): string {
    const acc = params.account;
    const v = isRecord(acc) ? acc.order_id : undefined;
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    throw new PaymeError(PAYME_ERROR.ORDER, 'order_not_found', 'order_id');
  }

  private expired(t: TxnView, ledger: PaymentLedgerPort): boolean {
    return ledger.now().getTime() - t.createdAt.getTime() > this.timeoutMs;
  }

  /** Cancels an expired live transaction with reason 4. */
  private async expire(t: TxnView, ledger: PaymentLedgerPort): Promise<void> {
    await ledger.cancelTransaction('payme', t.providerTxnId, PAYME_REASON.TIMEOUT);
  }

  /** Order exists, amount matches, state is payable and no other live Payme transaction holds the order. */
  private async assertPayable(ledger: PaymentLedgerPort, orderId: string, amount: Minor, txnId: string | null) {
    const r = await ledger.checkPayable({ orderId }, amount);
    if (!r.ok) throw paymeErrorForCheck(r);
    const active = await ledger.activeTransactionForOrder('payme', r.order.orderId);
    if (active && active.providerTxnId !== txnId) {
      if (this.expired(active, ledger)) await this.expire(active, ledger);
      else throw new PaymeError(PAYME_ERROR.ORDER, 'order_busy', 'order_id');
    }
    return r.order;
  }

  private async checkPerform(params: Record<string, unknown>, ledger: PaymentLedgerPort) {
    const amount = this.amount(params);
    const orderId = this.orderId(params);
    await this.assertPayable(ledger, orderId, amount, null);
    // VERIFY: fiscal `detail` (ikpu/package codes per line) is not returned because the ledger port does not expose
    // order lines; merchants that need Payme-side fiscalisation must extend PayableOrder.
    return { allow: true };
  }

  private async create(params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<PaymeTxnResult> {
    const id = this.str(params, 'id');
    const time = this.int(params, 'time');
    const amount = this.amount(params);
    const orderId = this.orderId(params);

    const existing = await ledger.getTransaction('payme', id);
    if (existing) {
      if (!isLive(existing)) throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'cannot_perform');
      if (this.expired(existing, ledger)) {
        await this.expire(existing, ledger);
        throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'expired');
      }
      if (existing.amount !== amount) throw new PaymeError(PAYME_ERROR.WRONG_AMOUNT, 'wrong_amount', 'amount');
      return { create_time: existing.createdAt.getTime(), transaction: existing.paymentId, state: paymeState(existing) };
    }

    const order = await this.assertPayable(ledger, orderId, amount, id);
    let t: TxnView;
    try {
      t = await ledger.openTransaction({ provider: 'payme', providerTxnId: id, orderId: order.orderId, amount, providerTime: new Date(time) });
    } catch (e) {
      if (isDomainError(e)) throw new PaymeError(PAYME_ERROR.ORDER, 'order_not_payable', 'order_id');
      throw e;
    }
    return { create_time: t.createdAt.getTime(), transaction: t.paymentId, state: paymeState(t) };
  }

  private async perform(params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<PaymeTxnResult> {
    const id = this.str(params, 'id');
    const t = await ledger.getTransaction('payme', id);
    if (!t) throw new PaymeError(PAYME_ERROR.TXN_NOT_FOUND, 'txn_not_found');
    if (t.status === 'paid') return { transaction: t.paymentId, perform_time: t.performedAt?.getTime() ?? 0, state: 2 };
    if (!isLive(t)) throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'cannot_perform');
    if (this.expired(t, ledger)) {
      await this.expire(t, ledger);
      throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'expired');
    }
    let done: TxnView;
    try {
      done = await ledger.confirmTransaction('payme', id);
    } catch (e) {
      if (isDomainError(e)) throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'cannot_perform');
      throw e;
    }
    if (done.status !== 'paid') throw new PaymeError(PAYME_ERROR.CANNOT_PERFORM, 'cannot_perform');
    return { transaction: done.paymentId, perform_time: done.performedAt?.getTime() ?? 0, state: 2 };
  }

  private async cancel(params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<PaymeTxnResult> {
    const id = this.str(params, 'id');
    const reason = this.int(params, 'reason');
    const t = await ledger.getTransaction('payme', id);
    if (!t) throw new PaymeError(PAYME_ERROR.TXN_NOT_FOUND, 'txn_not_found');
    if (paymeState(t) < 0) return { transaction: t.paymentId, cancel_time: t.cancelledAt?.getTime() ?? 0, state: paymeState(t) };
    let done: TxnView;
    try {
      done = await ledger.cancelTransaction('payme', id, reason);
    } catch (e) {
      // e.g. the order was already delivered and the ledger refuses an automatic refund.
      if (isDomainError(e)) throw new PaymeError(PAYME_ERROR.CANNOT_CANCEL, 'cannot_cancel');
      throw e;
    }
    return { transaction: done.paymentId, cancel_time: done.cancelledAt?.getTime() ?? 0, state: paymeState(done) };
  }

  private async checkTxn(params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<PaymeTxnResult> {
    const id = this.str(params, 'id');
    const t = await ledger.getTransaction('payme', id);
    if (!t) throw new PaymeError(PAYME_ERROR.TXN_NOT_FOUND, 'txn_not_found');
    return {
      create_time: t.createdAt.getTime(),
      perform_time: t.performedAt?.getTime() ?? 0,
      cancel_time: t.cancelledAt?.getTime() ?? 0,
      transaction: t.paymentId,
      state: paymeState(t),
      reason: t.cancelReason ?? null,
    };
  }

  private async statement(params: Record<string, unknown>, ledger: PaymentLedgerPort): Promise<{ transactions: PaymeStatementEntry[] }> {
    const from = this.int(params, 'from');
    const to = this.int(params, 'to');
    if (to < from) throw new PaymeError(PAYME_ERROR.INVALID_REQUEST, 'invalid_request', 'to');
    // VERIFY: range is applied to OUR create_time (inclusive both ends), as the ledger's statement() defines.
    const list = await ledger.statement('payme', new Date(from), new Date(to));
    return {
      transactions: list.map((t) => ({
        id: t.providerTxnId,
        time: t.providerTime.getTime(),
        amount: t.amount,
        account: { order_id: t.orderId },
        create_time: t.createdAt.getTime(),
        perform_time: t.performedAt?.getTime() ?? 0,
        cancel_time: t.cancelledAt?.getTime() ?? 0,
        transaction: t.paymentId,
        state: paymeState(t),
        reason: t.cancelReason ?? null,
      })),
    };
  }
}
