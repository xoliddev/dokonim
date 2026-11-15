/**
 * apps/bot's `BotBackend` implemented with the application services.
 *
 * Telegram invoices carry our payment id as `invoice_payload`; its store is resolved with a by-id lookup on
 * `payments` (see privileged.ts for why that runs outside the tenant scope), then the store's SQL ledger is driven
 * by the same `answerPreCheckout` / `processSuccessfulPayment` functions the raw-webhook handler uses.
 */
import { toLocale, type Locale } from '@dokonim/core';
import { ANON, SYSTEM, sqlLedger, type Backend } from '@dokonim/db';
import { answerPreCheckout, processSuccessfulPayment, telegramProviderFor } from '@dokonim/payments';
import type { BotBackend } from '@dokonim/bot';
import { paymentStoreId, userByTelegramId } from './privileged';

export interface BotBackendOptions {
  /** pre_checkout answer budget inside the bot's own 9 s deadline. */
  preCheckoutDeadlineMs?: number;
  /** Stars that arrived for an order that can no longer take them are refunded through this (bot.api.refundStarPayment). */
  refundStarPayment?: (userId: number, telegramChargeId: string) => Promise<unknown>;
  log?: (entry: Record<string, unknown>) => void;
}

const NOT_FOUND: Record<Locale, string> = {
  uz: 'Buyurtma topilmadi. Iltimos, qaytadan buyurtma bering.',
  ru: 'Заказ не найден. Пожалуйста, оформите заказ заново.',
  en: 'Order not found. Please place it again.',
};

export function createBotBackend(backend: Backend, opts: BotBackendOptions = {}): BotBackend {
  const m = backend.methods;
  const db = backend.ctx.db;
  const log = opts.log ?? ((e) => console.warn(JSON.stringify(e)));

  return {
    seenUpdate: (updateId) => m['auth.seenUpdate'](SYSTEM, { updateId }),
    forgetUpdate: async (updateId) => {
      await m['auth.forgetUpdate'](SYSTEM, { updateId });
    },

    async upsertUser(u) {
      const { user } = await backend.upsertUser({
        id: u.telegramId,
        first_name: u.firstName,
        ...(u.lastName ? { last_name: u.lastName } : {}),
        ...(u.username ? { username: u.username } : {}),
        ...(u.languageCode ? { language_code: u.languageCode } : {}),
      });
      return { locale: toLocale(user.languageCode) };
    },

    async saveVerifiedPhone(telegramId, phone) {
      await m['auth.savePhone'](SYSTEM, { telegramId, phone });
    },

    async orderAction(telegramId, orderId, action) {
      const user = await userByTelegramId(db, telegramId);
      if (!user) return { ok: false, code: 'FORBIDDEN' };
      const r = await m['bot.orderAction'](backend.actorFor(user), { orderId, action });
      // The bot renders the toast + next button from `status`; with message=null it derives the next step itself.
      return r.ok ? { ok: true, status: r.status, message: null } : { ok: false, code: r.code };
    },

    async inlineProducts(query, telegramId) {
      const user = await userByTelegramId(db, telegramId);
      const actor = user ? backend.actorFor(user) : { ...ANON, locale: 'uz' as const };
      return m['bot.inlineProducts'](actor, { query });
    },

    async preCheckout(q) {
      const storeId = await paymentStoreId(db, q.payload);
      if (!storeId) return { ok: false, errorMessage: NOT_FOUND[toLocale(q.languageCode)] };
      const ans = await answerPreCheckout(
        {
          id: q.id,
          from: { id: q.fromId, ...(q.languageCode ? { language_code: q.languageCode } : {}) },
          currency: q.currency,
          total_amount: q.totalAmount,
          invoice_payload: q.payload,
        },
        sqlLedger(backend.ctx, storeId),
        { provider: telegramProviderFor(q.currency), deadlineMs: opts.preCheckoutDeadlineMs ?? 8_500 },
      );
      return ans.ok ? { ok: true } : { ok: false, errorMessage: ans.error_message };
    },

    async successfulPayment(p) {
      const storeId = await paymentStoreId(db, p.payload);
      const provider = telegramProviderFor(p.currency);
      if (!storeId) {
        log({ event: 'successful_payment_unknown_payment', provider });
        if (provider === 'stars') await opts.refundStarPayment?.(p.fromId, p.telegramChargeId);
        return;
      }
      const r = await processSuccessfulPayment(
        {
          currency: p.currency,
          total_amount: p.totalAmount,
          invoice_payload: p.payload,
          telegram_payment_charge_id: p.telegramChargeId,
          ...(p.providerChargeId ? { provider_payment_charge_id: p.providerChargeId } : {}),
        },
        sqlLedger(backend.ctx, storeId),
        { provider },
      );
      if (!r.ok) {
        log({ event: 'successful_payment_needs_refund', provider, storeId, reason: r.reason });
        if (provider === 'stars') await opts.refundStarPayment?.(p.fromId, p.telegramChargeId);
      }
    },
  };
}
