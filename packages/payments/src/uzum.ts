/**
 * Uzum Bank Merchant API webhooks (MVP+): Uzum calls `/check`, `/create`, `/confirm`, `/reverse`, `/status`
 * (route passed as RawWebhookRequest.action). JSON in, JSON out, HTTP Basic auth with credentials issued to us.
 *
 * Assumptions (public docs are thin; confirm with the Uzum account manager):
 * - VERIFY: request bodies carry `serviceId`, `timestamp` (ms), `transId` (UUID), `amount` (tiyin) and `params`
 *   holding the account field (default `order_id`, configurable via publicConfig.account_field).
 * - VERIFY: success responses: check → status "OK"; create → "CREATED" + transTime; confirm → "CONFIRMED" +
 *   confirmTime; reverse → "REVERSED" + reverseTime; status → current status + all times.
 * - VERIFY: errors are HTTP 400 with `{ serviceId, timestamp, status: "FAILED", errorCode }`; codes in UZUM_ERROR.
 * - VERIFY: `check` carries no amount; we validate existence/state only (create re-validates the amount).
 */
import { isDomainError } from '@dokonim/core';
import type {
  AuthResult,
  CheckResult,
  Minor,
  PaymentLedgerPort,
  ProviderConfig,
  RawWebhookRequest,
  RawWebhookResponse,
  TxnView,
  WebhookHandler,
} from '@dokonim/core';
import { basicAuthMatches, getHeader, isRecord, jsonResponse } from './util';

/** VERIFY: Uzum Merchant API error codes. */
export const UZUM_ERROR = {
  ACCESS_DENIED: '10001',
  JSON_PARSE: '10002',
  INVALID_OPERATION: '10003',
  MISSING_PARAMS: '10005',
  WRONG_SERVICE_ID: '10006',
  ORDER_NOT_FOUND: '10007',
  ALREADY_PAID: '10008',
  CANCELLED: '10009',
  ORDER_BUSY: '10010',
  WRONG_AMOUNT: '10011',
  TXN_NOT_FOUND: '10014',
  SYSTEM: '99999',
} as const;

export const UZUM_ACTIONS = ['check', 'create', 'confirm', 'reverse', 'status'] as const;
export type UzumAction = (typeof UZUM_ACTIONS)[number];

export type UzumStatus = 'CREATED' | 'CONFIRMED' | 'REVERSED' | 'FAILED';

/** Cancel reason recorded for an Uzum `reverse` (mirrors Payme's "refund" reason). */
export const UZUM_REVERSE_REASON = 5;

export function uzumStatus(t: TxnView): UzumStatus {
  switch (t.status) {
    case 'created':
    case 'pending':
      return 'CREATED';
    case 'paid':
      return 'CONFIRMED';
    case 'cancelled':
    case 'refunded':
    case 'partially_refunded':
    case 'refund_pending':
      return 'REVERSED';
    default:
      return 'FAILED';
  }
}

class UzumFail extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function errorForCheck(r: Extract<CheckResult, { ok: false }>): UzumFail {
  switch (r.reason) {
    case 'not_found':
      return new UzumFail(UZUM_ERROR.ORDER_NOT_FOUND);
    case 'amount_mismatch':
      return new UzumFail(UZUM_ERROR.WRONG_AMOUNT);
    case 'already_paid':
      return new UzumFail(UZUM_ERROR.ALREADY_PAID);
    default:
      return new UzumFail(UZUM_ERROR.CANCELLED);
  }
}

export class UzumMerchantHandler implements WebhookHandler {
  readonly id = 'uzum' as const;

  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult {
    const login = cfg.credentials.webhook_login ?? '';
    const pass = cfg.credentials.webhook_password ?? '';
    if (!login || !pass) return { ok: false, reason: 'uzum webhook credentials are not configured' };
    return basicAuthMatches(getHeader(req, 'authorization'), login, pass) ? { ok: true } : { ok: false, reason: 'bad credentials' };
  }

  async handle(req: RawWebhookRequest, cfg: ProviderConfig, ledger: PaymentLedgerPort): Promise<RawWebhookResponse> {
    const kind = req.action ?? 'unknown';
    let signatureOk = false;
    let serviceId: unknown = cfg.credentials.service_id ?? null;
    let res: RawWebhookResponse;
    try {
      const auth = this.authenticate(req, cfg);
      signatureOk = auth.ok;
      if (!auth.ok) throw new UzumFail(UZUM_ERROR.ACCESS_DENIED);
      let body: unknown;
      try {
        body = JSON.parse(req.body);
      } catch {
        throw new UzumFail(UZUM_ERROR.JSON_PARSE);
      }
      if (!isRecord(body)) throw new UzumFail(UZUM_ERROR.JSON_PARSE);
      serviceId = body.serviceId ?? serviceId;
      const action = (req.action ?? '').toLowerCase() as UzumAction;
      if (!UZUM_ACTIONS.includes(action)) throw new UzumFail(UZUM_ERROR.INVALID_OPERATION);
      const expectedService = cfg.credentials.service_id?.trim();
      if (expectedService && String(body.serviceId ?? '') !== expectedService) throw new UzumFail(UZUM_ERROR.WRONG_SERVICE_ID);
      const result = await this.dispatch(action, body, cfg, ledger);
      res = jsonResponse({ serviceId: body.serviceId, timestamp: ledger.now().getTime(), ...result }, 200);
    } catch (e) {
      const code = e instanceof UzumFail ? e.code : UZUM_ERROR.SYSTEM;
      res = jsonResponse({ serviceId, timestamp: ledger.now().getTime(), status: 'FAILED', errorCode: code }, 400);
    }
    await ledger.log({ provider: 'uzum', kind, payload: req.body, signatureOk, response: res.body });
    return res;
  }

  private dispatch(action: UzumAction, body: Record<string, unknown>, cfg: ProviderConfig, ledger: PaymentLedgerPort) {
    switch (action) {
      case 'check':
        return this.check(body, cfg, ledger);
      case 'create':
        return this.create(body, cfg, ledger);
      case 'confirm':
        return this.confirm(body, ledger);
      case 'reverse':
        return this.reverse(body, ledger);
      case 'status':
        return this.status(body, ledger);
    }
  }

  private orderId(body: Record<string, unknown>, cfg: ProviderConfig): string {
    const field = cfg.publicConfig.account_field?.trim() || 'order_id';
    const params = body.params;
    const v = isRecord(params) ? params[field] : undefined;
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
    throw new UzumFail(UZUM_ERROR.MISSING_PARAMS);
  }

  private transId(body: Record<string, unknown>): string {
    const v = body.transId;
    if (typeof v !== 'string' || !v) throw new UzumFail(UZUM_ERROR.MISSING_PARAMS);
    return v;
  }

  private amount(body: Record<string, unknown>): Minor {
    const v = body.amount;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new UzumFail(UZUM_ERROR.WRONG_AMOUNT);
    return v;
  }

  private view(t: TxnView) {
    return {
      transId: t.providerTxnId,
      status: uzumStatus(t),
      transTime: t.createdAt.getTime(),
      confirmTime: t.performedAt?.getTime() ?? null,
      reverseTime: t.cancelledAt?.getTime() ?? null,
      amount: t.amount,
      data: { order_id: { value: t.orderId } },
    };
  }

  private async check(body: Record<string, unknown>, cfg: ProviderConfig, ledger: PaymentLedgerPort) {
    const orderId = this.orderId(body, cfg);
    const hasAmount = typeof body.amount === 'number';
    // Without an amount we probe with −1: an "amount_mismatch" then means "exists and is payable" (VERIFY above).
    const r = await ledger.checkPayable({ orderId }, hasAmount ? this.amount(body) : -1);
    if (!r.ok && !(r.reason === 'amount_mismatch' && !hasAmount)) throw errorForCheck(r);
    const data: Record<string, { value: string | number }> = { order_id: { value: orderId } };
    if (r.ok) data.amount = { value: r.order.amount };
    return { status: 'OK', data };
  }

  private async create(body: Record<string, unknown>, cfg: ProviderConfig, ledger: PaymentLedgerPort) {
    const transId = this.transId(body);
    const amount = this.amount(body);
    const orderId = this.orderId(body, cfg);
    const existing = await ledger.getTransaction('uzum', transId);
    if (existing) {
      if (existing.amount !== amount) throw new UzumFail(UZUM_ERROR.WRONG_AMOUNT);
      return this.view(existing);
    }
    const r = await ledger.checkPayable({ orderId }, amount);
    if (!r.ok) throw errorForCheck(r);
    const active = await ledger.activeTransactionForOrder('uzum', r.order.orderId);
    if (active && active.providerTxnId !== transId) throw new UzumFail(UZUM_ERROR.ORDER_BUSY);
    const ts = typeof body.timestamp === 'number' ? new Date(body.timestamp) : ledger.now();
    try {
      return this.view(await ledger.openTransaction({ provider: 'uzum', providerTxnId: transId, orderId: r.order.orderId, amount, providerTime: ts }));
    } catch (e) {
      if (isDomainError(e)) throw new UzumFail(UZUM_ERROR.CANCELLED);
      throw e;
    }
  }

  private async confirm(body: Record<string, unknown>, ledger: PaymentLedgerPort) {
    const transId = this.transId(body);
    const t = await ledger.getTransaction('uzum', transId);
    if (!t) throw new UzumFail(UZUM_ERROR.TXN_NOT_FOUND);
    if (t.status === 'paid') return this.view(t);
    if (t.status !== 'created' && t.status !== 'pending') throw new UzumFail(UZUM_ERROR.CANCELLED);
    try {
      const done = await ledger.confirmTransaction('uzum', transId);
      if (done.status !== 'paid') throw new UzumFail(UZUM_ERROR.CANCELLED);
      return this.view(done);
    } catch (e) {
      if (isDomainError(e)) throw new UzumFail(UZUM_ERROR.CANCELLED);
      throw e;
    }
  }

  private async reverse(body: Record<string, unknown>, ledger: PaymentLedgerPort) {
    const transId = this.transId(body);
    const t = await ledger.getTransaction('uzum', transId);
    if (!t) throw new UzumFail(UZUM_ERROR.TXN_NOT_FOUND);
    if (uzumStatus(t) === 'REVERSED' || uzumStatus(t) === 'FAILED') return this.view(t);
    try {
      return this.view(await ledger.cancelTransaction('uzum', transId, UZUM_REVERSE_REASON));
    } catch (e) {
      if (isDomainError(e)) throw new UzumFail(UZUM_ERROR.INVALID_OPERATION);
      throw e;
    }
  }

  private async status(body: Record<string, unknown>, ledger: PaymentLedgerPort) {
    const t = await ledger.getTransaction('uzum', this.transId(body));
    if (!t) throw new UzumFail(UZUM_ERROR.TXN_NOT_FOUND);
    return this.view(t);
  }
}
