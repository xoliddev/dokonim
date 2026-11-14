import type { Locale, OrderCallbackAction, OutboxMessage } from '@dokonim/core';

export interface BotUserInput {
  telegramId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export type OrderActionResult = { ok: true; message: OutboxMessage | null; status: string } | { ok: false; code: string };

export interface InlineProduct {
  id: string;
  shortId: string;
  storeSlug: string;
  storeName: string;
  title: string;
  /** Minor units of `currency`. */
  price: number;
  currency: 'UZS' | 'XTR' | 'USD';
  imageUrl?: string;
  description?: string;
}

export interface PreCheckoutInput {
  id: string;
  payload: string;
  totalAmount: number;
  currency: string;
  fromId: number;
  languageCode?: string;
}

export type PreCheckoutDecision = { ok: true } | { ok: false; errorMessage: string };

export interface SuccessfulPaymentInput {
  payload: string;
  totalAmount: number;
  currency: string;
  telegramChargeId: string;
  providerChargeId?: string;
  fromId: number;
}

/** Everything the bot needs from the API/services. The bot itself holds no state. */
export interface BotBackend {
  /** true if this update_id was already processed → skip. */
  seenUpdate(updateId: number): Promise<boolean>;
  upsertUser(u: BotUserInput): Promise<{ locale: Locale }>;
  /** Called only when contact.user_id === from.id; phone is normalised to +digits. */
  saveVerifiedPhone(telegramId: number, phone: string): Promise<void>;
  orderAction(telegramId: number, orderId: string, action: OrderCallbackAction): Promise<OrderActionResult>;
  /** Raw inline query text (trimmed): "<store-slug> <query>" or "<query>"; the backend resolves the slug. */
  inlineProducts(query: string, telegramId: number): Promise<InlineProduct[]>;
  preCheckout(q: PreCheckoutInput): Promise<PreCheckoutDecision>;
  successfulPayment(p: SuccessfulPaymentInput): Promise<void>;
}
