/**
 * Telegram Payments (physical goods, provider token) and Telegram Stars (XTR, digital goods).
 *
 * Flow: invoice (payload = our payment id) → `pre_checkout_query` (must be answered within 10 s) →
 * `successful_payment` (keyed by telegram_payment_charge_id).
 *
 * The bot (grammY) can call `answerPreCheckout` / `processSuccessfulPayment` directly; `TelegramPaymentsHandler`
 * wraps the same functions as a WebhookHandler for raw Bot API webhook updates and answers the pre-checkout query
 * in the webhook response body (`{"method":"answerPreCheckoutQuery",…}`), which the Bot API allows.
 */
import { isDomainError, timingSafeEqual, toLocale } from '@dokonim/core';
import type {
  AuthResult,
  CheckResult,
  Locale,
  PaymentLedgerPort,
  ProviderConfig,
  RawWebhookRequest,
  RawWebhookResponse,
  TxnView,
  WebhookHandler,
} from '@dokonim/core';
import { emptyResponse, errorMessage, getHeader, isRecord, jsonResponse, withDeadline } from './util';

export type TelegramProvider = 'telegram' | 'stars';

/** Telegram allows 10 s; we answer "no" at 9 s so the answer still arrives in time. */
export const PRE_CHECKOUT_DEADLINE_MS = 9_000;

export interface PreCheckoutQuery {
  id: string;
  from?: { id: number; language_code?: string };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export type PreCheckoutRejectReason = Extract<CheckResult, { ok: false }>['reason'];

export type PreCheckoutAnswer =
  | { ok: true }
  | { ok: false; reason: PreCheckoutRejectReason | 'currency_mismatch' | 'timeout' | 'error'; error_message: string };

export type SuccessfulPaymentResult =
  | { ok: true; txn: TxnView; duplicate: boolean }
  /** Money was taken but the order can no longer accept it: the bot must refund (refundStarPayment / provider). */
  | { ok: false; reason: string; needsRefund: true };

/** Routes a Telegram currency to our provider id: XTR → stars, anything else → telegram. */
export function telegramProviderFor(currency: string): TelegramProvider {
  return currency === 'XTR' ? 'stars' : 'telegram';
}

const REJECT: Record<'not_payable' | 'amount' | 'timeout' | 'paid', Record<Locale, string>> = {
  not_payable: {
    uz: "Bu buyurtmani endi to'lab bo'lmaydi. Iltimos, qaytadan buyurtma bering.",
    ru: 'Этот заказ больше нельзя оплатить. Пожалуйста, оформите заказ заново.',
    en: 'This order can no longer be paid. Please place it again.',
  },
  amount: {
    uz: "Buyurtma summasi o'zgardi. Iltimos, savatni yangilang.",
    ru: 'Сумма заказа изменилась. Пожалуйста, обновите корзину.',
    en: 'The order total has changed. Please refresh your cart.',
  },
  timeout: {
    uz: "Do'kon javob bermadi. Bir ozdan so'ng qayta urinib ko'ring.",
    ru: 'Магазин не ответил вовремя. Попробуйте ещё раз чуть позже.',
    en: 'The shop did not respond in time. Please try again shortly.',
  },
  paid: {
    uz: "Bu buyurtma allaqachon to'langan.",
    ru: 'Этот заказ уже оплачен.',
    en: 'This order is already paid.',
  },
};

export interface PreCheckoutOptions {
  provider: TelegramProvider;
  deadlineMs?: number;
}

/** Re-validates the invoice against the ledger and returns the answer for answerPreCheckoutQuery (≤ deadline). */
export async function answerPreCheckout(q: PreCheckoutQuery, ledger: PaymentLedgerPort, opts: PreCheckoutOptions): Promise<PreCheckoutAnswer> {
  const locale = toLocale(q.from?.language_code);
  const validate = async (): Promise<PreCheckoutAnswer> => {
    if (opts.provider === 'stars' && q.currency !== 'XTR') return { ok: false, reason: 'currency_mismatch', error_message: REJECT.not_payable[locale] };
    const r = await ledger.checkPayable({ paymentId: q.invoice_payload }, q.total_amount);
    if (!r.ok) {
      const msg = r.reason === 'amount_mismatch' ? REJECT.amount : r.reason === 'already_paid' ? REJECT.paid : REJECT.not_payable;
      return { ok: false, reason: r.reason, error_message: msg[locale] };
    }
    if (r.order.currency !== q.currency) return { ok: false, reason: 'currency_mismatch', error_message: REJECT.amount[locale] };
    return { ok: true };
  };
  let answer: PreCheckoutAnswer;
  try {
    const res = await withDeadline(validate(), opts.deadlineMs ?? PRE_CHECKOUT_DEADLINE_MS);
    answer = res.ok ? res.value : { ok: false, reason: 'timeout', error_message: REJECT.timeout[locale] };
  } catch {
    answer = { ok: false, reason: 'error', error_message: REJECT.timeout[locale] };
  }
  await ledger.log({
    provider: opts.provider,
    kind: 'pre_checkout_query',
    payload: JSON.stringify(q),
    signatureOk: true,
    response: JSON.stringify(answer),
  });
  return answer;
}

/** Records the charge idempotently by telegram_payment_charge_id: open + confirm the transaction. */
export async function processSuccessfulPayment(
  p: SuccessfulPayment,
  ledger: PaymentLedgerPort,
  opts: { provider: TelegramProvider; date?: Date },
): Promise<SuccessfulPaymentResult> {
  const provider = opts.provider;
  let result: SuccessfulPaymentResult;
  try {
    const existing = await ledger.getTransaction(provider, p.telegram_payment_charge_id);
    if (existing) {
      const txn = existing.status === 'paid' ? existing : await ledger.confirmTransaction(provider, p.telegram_payment_charge_id);
      result = txn.status === 'paid'
        ? { ok: true, txn, duplicate: existing.status === 'paid' }
        : { ok: false, reason: `transaction is ${txn.status}`, needsRefund: true };
    } else {
      const r = await ledger.checkPayable({ paymentId: p.invoice_payload }, p.total_amount);
      if (!r.ok) {
        result = { ok: false, reason: r.reason, needsRefund: true };
      } else {
        await ledger.openTransaction({
          provider,
          providerTxnId: p.telegram_payment_charge_id,
          orderId: r.order.orderId,
          amount: p.total_amount,
          providerTime: opts.date ?? ledger.now(),
        });
        const txn = await ledger.confirmTransaction(provider, p.telegram_payment_charge_id);
        result = txn.status === 'paid' ? { ok: true, txn, duplicate: false } : { ok: false, reason: `transaction is ${txn.status}`, needsRefund: true };
      }
    }
  } catch (e) {
    if (!isDomainError(e)) throw e;
    result = { ok: false, reason: errorMessage(e), needsRefund: true };
  }
  await ledger.log({
    provider,
    kind: 'successful_payment',
    payload: JSON.stringify(p),
    signatureOk: true,
    response: JSON.stringify(result.ok ? { ok: true, duplicate: result.duplicate, paymentId: result.txn.paymentId } : result),
  });
  return result;
}

export interface TelegramHandlerOptions {
  deadlineMs?: number;
}

/** WebhookHandler for raw Bot API updates (one instance per provider id: 'telegram' or 'stars'). */
export class TelegramPaymentsHandler implements WebhookHandler {
  constructor(
    readonly id: TelegramProvider,
    private readonly opts: TelegramHandlerOptions = {},
  ) {}

  /** `X-Telegram-Bot-Api-Secret-Token` must equal credentials.webhook_secret (required in live mode). */
  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult {
    const secret = cfg.credentials.webhook_secret ?? '';
    if (!secret) return cfg.mode === 'sandbox' ? { ok: true } : { ok: false, reason: 'webhook_secret is not configured' };
    return timingSafeEqual(getHeader(req, 'x-telegram-bot-api-secret-token') ?? '', secret) ? { ok: true } : { ok: false, reason: 'bad secret token' };
  }

  async handle(req: RawWebhookRequest, cfg: ProviderConfig, ledger: PaymentLedgerPort): Promise<RawWebhookResponse> {
    const auth = this.authenticate(req, cfg);
    let update: unknown = null;
    try {
      update = JSON.parse(req.body);
    } catch {
      /* logged below */
    }
    if (!auth.ok || !isRecord(update)) {
      const res = auth.ok ? emptyResponse(400) : emptyResponse(401);
      await ledger.log({ provider: this.id, kind: auth.ok ? 'bad_update' : 'unauthenticated', payload: req.body, signatureOk: auth.ok, response: String(res.status) });
      return res;
    }
    const q = update.pre_checkout_query;
    if (isRecord(q)) {
      const query = q as unknown as PreCheckoutQuery;
      const ans = await answerPreCheckout(query, ledger, { provider: this.id, deadlineMs: this.opts.deadlineMs ?? PRE_CHECKOUT_DEADLINE_MS });
      return jsonResponse({
        method: 'answerPreCheckoutQuery',
        pre_checkout_query_id: query.id,
        ok: ans.ok,
        ...(ans.ok ? {} : { error_message: ans.error_message }),
      });
    }
    const msg = update.message;
    if (isRecord(msg) && isRecord(msg.successful_payment)) {
      const date = typeof msg.date === 'number' ? new Date(msg.date * 1000) : undefined;
      await processSuccessfulPayment(msg.successful_payment as unknown as SuccessfulPayment, ledger, { provider: this.id, ...(date ? { date } : {}) });
      return emptyResponse(200);
    }
    await ledger.log({ provider: this.id, kind: 'ignored_update', payload: req.body, signatureOk: true, response: '200' });
    return emptyResponse(200);
  }
}
