/**
 * Click SHOP-API (Prepare / Complete, "Click calls us"). §11.1, §16.4.
 *
 * Request: application/x-www-form-urlencoded. Response: JSON.
 * sign_string = md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id
 *                   + [merchant_prepare_id — Complete only] + amount + action + sign_time), hex, compared in constant time.
 *
 * Identifiers:
 * - `merchant_trans_id` = our order id (what the pay link sends as `transaction_param`).
 * - `merchant_prepare_id` = stableNumericId(paymentId): a deterministic positive 31-bit integer derived (md5) from the
 *   payment id the ledger bound to this click_trans_id. Complete recomputes it from the transaction found by
 *   click_trans_id, so no extra storage is needed. `merchant_confirm_id` = stableNumericId('confirm:' + paymentId).
 * - Idempotent on click_trans_id: a repeated Prepare returns the same prepare id; a repeated Complete of a paid
 *   transaction returns error 0 again without a second ledger effect.
 * - Complete with Click's `error` < 0 means Click failed/cancelled the payment: we cancel and answer −9.
 */
import { isDomainError, md5, timingSafeEqual } from '@dokonim/core';
import type {
  AuthResult,
  Minor,
  PaymentLedgerPort,
  ProviderConfig,
  RawWebhookRequest,
  RawWebhookResponse,
  TxnView,
} from '@dokonim/core';
import type { WebhookHandler } from '@dokonim/core';
import { jsonResponse, parseTashkentTime, somToTiyin, stableNumericId } from './util';

export const CLICK_ERROR = {
  OK: 0,
  SIGN_FAILED: -1,
  BAD_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  ORDER_NOT_FOUND: -5,
  TXN_NOT_FOUND: -6,
  BAD_REQUEST: -8,
  CANCELLED: -9,
} as const;

export const CLICK_ERROR_NOTE: Record<number, string> = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'User does not exist',
  [-6]: 'Transaction does not exist',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
};

/** Cancel reason we record when a newer Prepare supersedes an abandoned pending Click transaction. */
export const CLICK_SUPERSEDED_REASON = 1;

export interface ClickSignFields {
  click_trans_id: string;
  service_id: string;
  merchant_trans_id: string;
  merchant_prepare_id?: string;
  amount: string;
  action: string;
  sign_time: string;
}

/** The md5 `sign_string` Click sends (and the simulator computes). `amount` is used exactly as sent. */
export function clickSignString(f: ClickSignFields, secretKey: string): string {
  const prepareId = f.action === '1' ? (f.merchant_prepare_id ?? '') : '';
  return md5(`${f.click_trans_id}${f.service_id}${secretKey}${f.merchant_trans_id}${prepareId}${f.amount}${f.action}${f.sign_time}`);
}

export function clickPrepareId(paymentId: string): number {
  return stableNumericId(paymentId);
}

export function clickConfirmId(paymentId: string): number {
  return stableNumericId(`confirm:${paymentId}`);
}

export interface ClickHandlerOptions {
  /**
   * Reject requests whose sign_time is further than this from ledger.now() (replay protection, §16.4).
   * `null` disables. Default: 24 h in live mode, disabled in sandbox mode.
   */
  signTimeWindowMs?: number | null;
}

export const CLICK_DEFAULT_SIGN_WINDOW_MS = 24 * 3_600_000;

class ClickFail extends Error {
  constructor(readonly code: number, note?: string) {
    super(note ?? CLICK_ERROR_NOTE[code] ?? 'Error');
  }
}

type Fields = Record<string, string>;

function parseForm(body: string): Fields {
  const out: Fields = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

/** Click ids are big integers; echo them back as numbers when exactly representable, else as strings. */
function idOut(v: string | undefined): number | string | null {
  if (v === undefined || v === '') return null;
  return /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : v;
}

const live = (t: TxnView) => t.status === 'created' || t.status === 'pending';
const cancelledish = (t: TxnView) => t.status === 'cancelled' || t.status === 'expired' || t.status === 'failed';

export class ClickWebhookHandler implements WebhookHandler {
  readonly id = 'click' as const;
  constructor(private readonly opts: ClickHandlerOptions = {}) {}

  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult {
    const f = parseForm(req.body);
    const secret = cfg.credentials.secret_key ?? '';
    if (!secret) return { ok: false, reason: 'click secret_key is not configured' };
    const expected = clickSignString(
      {
        click_trans_id: f.click_trans_id ?? '',
        service_id: f.service_id ?? '',
        merchant_trans_id: f.merchant_trans_id ?? '',
        merchant_prepare_id: f.merchant_prepare_id ?? '',
        amount: f.amount ?? '',
        action: f.action ?? '',
        sign_time: f.sign_time ?? '',
      },
      secret,
    );
    return timingSafeEqual(expected, (f.sign_string ?? '').toLowerCase()) ? { ok: true } : { ok: false, reason: 'bad sign_string' };
  }

  async handle(req: RawWebhookRequest, cfg: ProviderConfig, ledger: PaymentLedgerPort): Promise<RawWebhookResponse> {
    const f = parseForm(req.body);
    const kind = req.action ?? (f.action === '0' ? 'prepare' : f.action === '1' ? 'complete' : 'unknown');
    let signatureOk = false;
    const isComplete = f.action === '1';
    const out: Record<string, unknown> = {
      click_trans_id: idOut(f.click_trans_id),
      merchant_trans_id: f.merchant_trans_id ?? null,
    };
    try {
      if (req.method && req.method.toUpperCase() !== 'POST') throw new ClickFail(CLICK_ERROR.BAD_REQUEST);
      const need = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];
      if (isComplete) need.push('merchant_prepare_id');
      if (need.some((k) => !f[k])) throw new ClickFail(CLICK_ERROR.BAD_REQUEST);

      const auth = this.authenticate(req, cfg);
      signatureOk = auth.ok;
      if (!auth.ok) throw new ClickFail(CLICK_ERROR.SIGN_FAILED);
      this.checkFreshness(f.sign_time!, cfg, ledger);

      if (f.action !== '0' && f.action !== '1') throw new ClickFail(CLICK_ERROR.ACTION_NOT_FOUND);
      const route = req.action?.toLowerCase();
      if (route && route !== (isComplete ? 'complete' : 'prepare')) throw new ClickFail(CLICK_ERROR.ACTION_NOT_FOUND);

      const expectedService = cfg.credentials.service_id?.trim();
      if (expectedService && f.service_id !== expectedService) throw new ClickFail(CLICK_ERROR.BAD_REQUEST);

      const amount = somToTiyin(f.amount!);
      if (amount === null || amount <= 0) throw new ClickFail(CLICK_ERROR.BAD_AMOUNT);

      if (isComplete) Object.assign(out, await this.complete(f, amount, ledger));
      else Object.assign(out, await this.prepare(f, amount, ledger));
      out.error = CLICK_ERROR.OK;
      out.error_note = CLICK_ERROR_NOTE[0];
    } catch (e) {
      const fail = e instanceof ClickFail ? e : new ClickFail(CLICK_ERROR.BAD_REQUEST, 'Internal error');
      if (isComplete && !('merchant_confirm_id' in out)) out.merchant_confirm_id = null;
      if (!isComplete && !('merchant_prepare_id' in out)) out.merchant_prepare_id = null;
      out.error = fail.code;
      out.error_note = fail.message;
    }
    const res = jsonResponse(out, 200);
    await ledger.log({ provider: 'click', kind, payload: req.body, signatureOk, response: res.body });
    return res;
  }

  private checkFreshness(signTime: string, cfg: ProviderConfig, ledger: PaymentLedgerPort): void {
    const window = this.opts.signTimeWindowMs !== undefined ? this.opts.signTimeWindowMs : cfg.mode === 'sandbox' ? null : CLICK_DEFAULT_SIGN_WINDOW_MS;
    if (window === null) return;
    const t = parseTashkentTime(signTime);
    if (!t) throw new ClickFail(CLICK_ERROR.BAD_REQUEST);
    if (Math.abs(ledger.now().getTime() - t.getTime()) > window) throw new ClickFail(CLICK_ERROR.SIGN_FAILED, 'SIGN CHECK FAILED! (stale sign_time)');
  }

  private async prepare(f: Fields, amount: Minor, ledger: PaymentLedgerPort): Promise<Record<string, unknown>> {
    const clickTransId = f.click_trans_id!;
    const existing = await ledger.getTransaction('click', clickTransId);
    if (existing) {
      if (existing.status === 'paid') throw new ClickFail(CLICK_ERROR.ALREADY_PAID);
      if (!live(existing)) throw new ClickFail(CLICK_ERROR.CANCELLED);
      if (existing.amount !== amount) throw new ClickFail(CLICK_ERROR.BAD_AMOUNT);
      return { merchant_prepare_id: clickPrepareId(existing.paymentId) };
    }

    const r = await ledger.checkPayable({ orderId: f.merchant_trans_id! }, amount);
    if (!r.ok) {
      switch (r.reason) {
        case 'not_found':
          throw new ClickFail(CLICK_ERROR.ORDER_NOT_FOUND);
        case 'amount_mismatch':
          throw new ClickFail(CLICK_ERROR.BAD_AMOUNT);
        case 'already_paid':
          throw new ClickFail(CLICK_ERROR.ALREADY_PAID);
        default:
          // cancelled / not payable (e.g. order expired): Click shows "Transaction cancelled".
          throw new ClickFail(CLICK_ERROR.CANCELLED);
      }
    }
    // VERIFY: Click may re-Prepare with a new click_trans_id after the buyer abandoned an attempt. We supersede the
    // abandoned pending transaction (cancel it) so its late Complete answers −9 and never double-charges.
    const active = await ledger.activeTransactionForOrder('click', r.order.orderId);
    if (active && active.providerTxnId !== clickTransId) {
      await ledger.cancelTransaction('click', active.providerTxnId, CLICK_SUPERSEDED_REASON);
    }
    let t: TxnView;
    try {
      t = await ledger.openTransaction({
        provider: 'click',
        providerTxnId: clickTransId,
        orderId: r.order.orderId,
        amount,
        providerTime: parseTashkentTime(f.sign_time!) ?? ledger.now(),
      });
    } catch (e) {
      if (isDomainError(e)) throw new ClickFail(CLICK_ERROR.CANCELLED);
      throw e;
    }
    return { merchant_prepare_id: clickPrepareId(t.paymentId) };
  }

  private async complete(f: Fields, amount: Minor, ledger: PaymentLedgerPort): Promise<Record<string, unknown>> {
    const clickTransId = f.click_trans_id!;
    const t = await ledger.getTransaction('click', clickTransId);
    if (!t || String(clickPrepareId(t.paymentId)) !== f.merchant_prepare_id) throw new ClickFail(CLICK_ERROR.TXN_NOT_FOUND);
    if (t.orderId !== f.merchant_trans_id) throw new ClickFail(CLICK_ERROR.TXN_NOT_FOUND);
    const clickError = Number(f.error ?? '0');

    if (t.status === 'paid') {
      // Idempotent repeat of a successful Complete → same answer, no second effect.
      if (clickError < 0) throw new ClickFail(CLICK_ERROR.ALREADY_PAID);
      return { merchant_confirm_id: clickConfirmId(t.paymentId) };
    }
    if (cancelledish(t) || t.status === 'refunded') throw new ClickFail(CLICK_ERROR.CANCELLED);
    if (t.amount !== amount) throw new ClickFail(CLICK_ERROR.BAD_AMOUNT);

    if (Number.isFinite(clickError) && clickError < 0) {
      // Click reports the payment failed (e.g. −5017 insufficient funds / user cancelled): cancel on our side.
      await ledger.cancelTransaction('click', clickTransId, clickError);
      throw new ClickFail(CLICK_ERROR.CANCELLED);
    }

    let done: TxnView;
    try {
      done = await ledger.confirmTransaction('click', clickTransId);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      // The order can no longer be paid (cancelled meanwhile): cancel so Click does not charge.
      await ledger.cancelTransaction('click', clickTransId, CLICK_ERROR.CANCELLED).catch(() => undefined);
      throw new ClickFail(CLICK_ERROR.CANCELLED);
    }
    if (done.status !== 'paid') throw new ClickFail(CLICK_ERROR.CANCELLED);
    return { merchant_confirm_id: clickConfirmId(done.paymentId) };
  }
}
