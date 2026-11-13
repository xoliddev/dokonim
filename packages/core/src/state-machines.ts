/**
 * Order, payment and fulfilment state machines (§9) as typed transition tables.
 * Guards that need data (stock, amounts) run in the services; the table owns "who may move what where".
 */
import { DomainError } from './errors';

export const ORDER_STATUSES = [
  'pending_payment',
  'awaiting_confirmation',
  'paid',
  'confirmed',
  'packing',
  'shipped',
  'ready_for_pickup',
  'delivered',
  'completed',
  'cancelled',
  'return_requested',
  'returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderEvent =
  | 'pay'
  | 'confirm'
  | 'pack'
  | 'ship'
  | 'ready_for_pickup'
  | 'deliver'
  | 'complete'
  | 'cancel'
  | 'request_return'
  | 'accept_return'
  | 'reject_return';

export type ActorKind = 'buyer' | 'staff' | 'system' | 'provider';
export type FulfilmentKind = 'delivery' | 'pickup';

export type OrderEffect =
  | 'commit_reservation'
  | 'release_reservation'
  | 'restock'
  | 'refund'
  | 'generate_pickup_code'
  | 'set_delivered_at'
  | 'request_review'
  | 'notify_buyer'
  | 'notify_owner';

interface TransitionDef {
  from: OrderStatus[];
  to: OrderStatus;
  actors: ActorKind[];
  /** Only for this fulfilment kind. */
  fulfilment?: FulfilmentKind;
  effects: OrderEffect[];
}

export const ORDER_TRANSITIONS: Record<OrderEvent, TransitionDef[]> = {
  pay: [{ from: ['pending_payment'], to: 'paid', actors: ['provider', 'system'], effects: ['commit_reservation', 'notify_buyer', 'notify_owner'] }],
  confirm: [
    { from: ['paid', 'awaiting_confirmation'], to: 'confirmed', actors: ['staff', 'system'], effects: ['notify_buyer'] },
  ],
  pack: [{ from: ['confirmed'], to: 'packing', actors: ['staff'], effects: [] }],
  ship: [{ from: ['packing', 'confirmed'], to: 'shipped', actors: ['staff'], fulfilment: 'delivery', effects: ['notify_buyer'] }],
  ready_for_pickup: [
    { from: ['packing', 'confirmed'], to: 'ready_for_pickup', actors: ['staff'], fulfilment: 'pickup', effects: ['generate_pickup_code', 'notify_buyer'] },
  ],
  deliver: [
    { from: ['shipped', 'ready_for_pickup'], to: 'delivered', actors: ['staff', 'system'], effects: ['set_delivered_at', 'notify_buyer'] },
  ],
  complete: [{ from: ['delivered'], to: 'completed', actors: ['system', 'staff'], effects: ['request_review'] }],
  cancel: [
    // buyers may cancel only before the shop confirmed
    { from: ['pending_payment', 'awaiting_confirmation', 'paid'], to: 'cancelled', actors: ['buyer'], effects: ['release_reservation', 'refund', 'notify_owner', 'notify_buyer'] },
    { from: ['pending_payment', 'awaiting_confirmation', 'paid', 'confirmed', 'packing'], to: 'cancelled', actors: ['staff', 'system'], effects: ['release_reservation', 'refund', 'notify_buyer'] },
  ],
  request_return: [{ from: ['delivered', 'completed'], to: 'return_requested', actors: ['buyer'], effects: ['notify_owner'] }],
  accept_return: [{ from: ['return_requested'], to: 'returned', actors: ['staff'], effects: ['restock', 'refund', 'notify_buyer'] }],
  reject_return: [{ from: ['return_requested'], to: 'delivered', actors: ['staff'], effects: ['notify_buyer'] }],
};

export interface TransitionResult {
  from: OrderStatus;
  to: OrderStatus;
  effects: OrderEffect[];
}

export function findTransition(
  status: OrderStatus,
  event: OrderEvent,
  actor: ActorKind,
  fulfilment: FulfilmentKind,
): TransitionDef | undefined {
  return ORDER_TRANSITIONS[event].find(
    (t) => t.from.includes(status) && t.actors.includes(actor) && (!t.fulfilment || t.fulfilment === fulfilment),
  );
}

export function transitionOrder(
  status: OrderStatus,
  event: OrderEvent,
  actor: ActorKind,
  fulfilment: FulfilmentKind,
  ctx: { paid?: boolean } = {},
): TransitionResult {
  const t = findTransition(status, event, actor, fulfilment);
  if (!t) throw new DomainError('INVALID_TRANSITION', `Cannot ${event} an order in ${status} as ${actor}`, { status, event, actor });
  // Refund is only an effect when money was actually captured; release only while a reservation still exists.
  const effects = t.effects.filter((e) => {
    if (e === 'refund') return !!ctx.paid;
    if (e === 'release_reservation') return status === 'pending_payment' || status === 'awaiting_confirmation';
    return true;
  });
  // A paid order cancelled after the sale was committed must restock instead of releasing.
  if (event === 'cancel' && !['pending_payment', 'awaiting_confirmation'].includes(status)) effects.push('restock');
  return { from: status, to: t.to, effects };
}

/** Events an actor may fire now, in the order the UI should offer them (first = MainButton). */
export function allowedEvents(status: OrderStatus, actor: ActorKind, fulfilment: FulfilmentKind): OrderEvent[] {
  const order: OrderEvent[] = ['confirm', 'pack', 'ship', 'ready_for_pickup', 'deliver', 'complete', 'accept_return', 'reject_return', 'request_return', 'cancel'];
  return order.filter((e) => !!findTransition(status, e, actor, fulfilment) && e !== 'pay');
}

export type FulfillmentStatus = 'unfulfilled' | 'packing' | 'shipped' | 'ready' | 'delivered' | 'returned';

export function fulfillmentOf(status: OrderStatus): FulfillmentStatus {
  switch (status) {
    case 'packing':
      return 'packing';
    case 'shipped':
      return 'shipped';
    case 'ready_for_pickup':
      return 'ready';
    case 'delivered':
    case 'completed':
    case 'return_requested':
      return 'delivered';
    case 'returned':
      return 'returned';
    default:
      return 'unfulfilled';
  }
}

/** Buyer-facing timeline stages (Uzum-style tracking). */
export function timelineStages(fulfilment: FulfilmentKind, prepaid: boolean): OrderStatus[] {
  return [
    prepaid ? 'pending_payment' : 'awaiting_confirmation',
    ...(prepaid ? (['paid'] as OrderStatus[]) : []),
    'confirmed',
    'packing',
    fulfilment === 'pickup' ? 'ready_for_pickup' : 'shipped',
    'delivered',
  ];
}

// ── Payments ────────────────────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  'created',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refund_pending',
  'refunded',
  'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const PAYMENT_NEXT: Record<PaymentStatus, PaymentStatus[]> = {
  created: ['pending', 'paid', 'failed', 'cancelled', 'expired'],
  pending: ['paid', 'failed', 'cancelled', 'expired'],
  paid: ['refund_pending', 'refunded', 'partially_refunded'],
  failed: [],
  cancelled: [],
  expired: [],
  refund_pending: ['refunded', 'partially_refunded', 'paid'],
  partially_refunded: ['refund_pending', 'refunded', 'partially_refunded'],
  refunded: [],
};

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || PAYMENT_NEXT[from].includes(to);
}

/** Idempotent payment transition: same→same is a no-op, illegal moves throw. */
export function transitionPayment(from: PaymentStatus, to: PaymentStatus): PaymentStatus {
  if (!canPaymentTransition(from, to)) throw new DomainError('INVALID_TRANSITION', `payment ${from} → ${to}`);
  return to;
}

/** Payme transaction states ↔ ours. 1 created/pending, 2 performed, −1 cancelled before perform, −2 cancelled after. */
export const PAYME_STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER_PERFORM: -2 } as const;

export function paymeStateToStatus(state: number): PaymentStatus {
  switch (state) {
    case 1:
      return 'pending';
    case 2:
      return 'paid';
    case -1:
      return 'cancelled';
    case -2:
      return 'refunded';
    default:
      throw new DomainError('VALIDATION', `unknown Payme state ${state}`);
  }
}

export function statusToPaymeState(s: PaymentStatus): number {
  switch (s) {
    case 'created':
    case 'pending':
      return 1;
    case 'paid':
      return 2;
    case 'refunded':
    case 'partially_refunded':
    case 'refund_pending':
      return -2;
    default:
      return -1;
  }
}

export type PaymentProviderStatusFamily = 'success' | 'waiting' | 'failed';
export function paymentFamily(s: PaymentStatus): PaymentProviderStatusFamily {
  if (s === 'paid' || s === 'refunded' || s === 'partially_refunded' || s === 'refund_pending') return 'success';
  if (s === 'created' || s === 'pending') return 'waiting';
  return 'failed';
}

// ── Inventory (§9.3) ───────────────────────────────────────────────────────

export interface StockLevel {
  onHand: number;
  reserved: number;
}

export function available(l: StockLevel): number {
  return l.onHand - l.reserved;
}

export function reserve(l: StockLevel, qty: number, allowBackorder = false): StockLevel {
  if (qty <= 0) throw new DomainError('VALIDATION', 'qty must be positive');
  if (!allowBackorder && available(l) < qty) throw new DomainError('OUT_OF_STOCK', undefined, { available: available(l), qty });
  return { onHand: l.onHand, reserved: l.reserved + qty };
}

/** Payment captured: the reservation becomes a sale. */
export function commitReservation(l: StockLevel, qty: number): StockLevel {
  return { onHand: l.onHand - qty, reserved: Math.max(0, l.reserved - qty) };
}

export function releaseReservation(l: StockLevel, qty: number): StockLevel {
  return { onHand: l.onHand, reserved: Math.max(0, l.reserved - qty) };
}

export function restock(l: StockLevel, qty: number): StockLevel {
  return { onHand: l.onHand + qty, reserved: l.reserved };
}

export function adjustStock(l: StockLevel, delta: number): StockLevel {
  const onHand = l.onHand + delta;
  if (onHand < l.reserved) throw new DomainError('VALIDATION', 'Stock cannot go below reserved units', { reserved: l.reserved });
  return { onHand, reserved: l.reserved };
}

export const RESERVATION_TTL_MS = 30 * 60_000;
export const PAYME_TXN_TIMEOUT_MS = 43_200_000;
