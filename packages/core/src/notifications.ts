/**
 * Transactional outbox messages (§8.7). Services write them in the same transaction as the change;
 * the bot (server) or the BotChatSimulator (demo) delivers them. Payloads carry everything needed to
 * render the message without another DB read.
 */
import type { Locale } from './locale';
import type { Currency, Minor } from './money';
import type { OrderStatus } from './state-machines';
import type { ProviderId } from './ports';

export interface OrderSummary {
  orderId: string;
  shortId: string;
  number: number;
  storeSlug: string;
  storeName: string;
  total: Minor;
  currency: Currency;
  items: Array<{ title: string; variantTitle?: string; qty: number }>;
  paymentMethod: ProviderId;
  buyerName: string;
  buyerPhone: string | null;
  fulfilment: 'delivery' | 'pickup';
  deliveryFrom: string | null;
  deliveryTo: string | null;
  status: OrderStatus;
}

export type NotificationPayload =
  | { topic: 'order.placed'; order: OrderSummary }
  | { topic: 'order.paid'; order: OrderSummary }
  | { topic: 'order.status_changed'; order: OrderSummary; from: OrderStatus; to: OrderStatus; pickupCode?: string | null; trackingNumber?: string | null }
  | { topic: 'order.cancelled'; order: OrderSummary; by: 'buyer' | 'staff' | 'system'; reason?: string | null }
  | { topic: 'review.created'; storeSlug: string; storeName: string; reviewId: string; productId: string; productTitle: string; rating: number; text: string }
  | { topic: 'question.created'; storeSlug: string; storeName: string; questionId: string; productId: string; productTitle: string; text: string }
  | { topic: 'question.answered'; storeSlug: string; storeName: string; productId: string; productShortId: string; productTitle: string; question: string; answer: string }
  | { topic: 'stock.low'; storeSlug: string; storeName: string; productId: string; productTitle: string; variantTitle: string; available: number }
  | { topic: 'store.created'; storeSlug: string; storeName: string }
  | { topic: 'staff.joined'; storeSlug: string; storeName: string; memberName: string; role: string };

export type NotificationTopic = NotificationPayload['topic'];

export interface Recipient {
  kind: 'owner' | 'staff' | 'buyer';
  telegramId: number;
  userId: string;
  locale: Locale;
}

export interface OutboxMessage {
  id: string;
  storeId: string;
  recipient: Recipient;
  payload: NotificationPayload;
  createdAt: string;
}

/** Inline-button callback grammar (≤ 64 bytes): "o:<action>:<orderId>". */
export type OrderCallbackAction = 'confirm' | 'pack' | 'ship' | 'ready' | 'deliver' | 'cancel';

export function orderCallback(action: OrderCallbackAction, orderId: string): string {
  return `o:${action}:${orderId}`;
}

export function parseCallback(data: string): { kind: 'order'; action: OrderCallbackAction; orderId: string } | null {
  const m = /^o:(confirm|pack|ship|ready|deliver|cancel):([0-9a-f-]{36})$/.exec(data);
  return m ? { kind: 'order', action: m[1] as OrderCallbackAction, orderId: m[2]! } : null;
}
