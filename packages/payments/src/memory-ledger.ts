/**
 * In-memory PaymentLedgerPort for tests, the sandbox debugger and anyone who needs a fake.
 * Implements the semantics documented on the port:
 * - checkPayable: existence → state → amount (in that order);
 * - openTransaction / confirmTransaction / cancelTransaction are idempotent by (provider, providerTxnId);
 * - cancel before perform → payment `cancelled` (order stays payable); after perform → `refunded` (order cancelled);
 * - a settable clock (`setNow`, `advance`) so 12 h Payme expiry can be tested without waiting.
 */
import { DomainError } from '@dokonim/core';
import type {
  CheckResult,
  Currency,
  Minor,
  OrderStatus,
  PayableOrder,
  PaymentLedgerPort,
  PaymentStatus,
  ProviderId,
  TxnView,
} from '@dokonim/core';
import { randomUuid } from './util';

export interface MemoryOrder {
  id: string;
  number: number;
  amount: Minor;
  currency: Currency;
  status: OrderStatus;
  isDigital: boolean;
}

export interface MemoryPayment {
  id: string;
  orderId: string;
  provider: ProviderId | null;
  providerTxnId: string | null;
  amount: Minor;
  currency: Currency;
  status: PaymentStatus;
}

export interface MemoryLogEntry {
  provider: ProviderId;
  kind: string;
  payload: string;
  signatureOk: boolean;
  response: string;
  at: number;
}

interface TxnRecord {
  provider: ProviderId;
  providerTxnId: string;
  paymentId: string;
  orderId: string;
  amount: Minor;
  createdAt: number;
  providerTime: number;
  performedAt: number | null;
  cancelledAt: number | null;
  cancelReason: number | null;
}

export interface AddOrderInput {
  id?: string;
  number?: number;
  amount: Minor;
  currency?: Currency;
  status?: OrderStatus;
  isDigital?: boolean;
  /** Id of the initial `created` payment (defaults to a random UUID). */
  paymentId?: string;
}

const LIVE: PaymentStatus[] = ['created', 'pending'];
const PAID_ORDER: OrderStatus[] = ['paid', 'confirmed', 'packing', 'shipped', 'ready_for_pickup', 'delivered', 'completed', 'return_requested', 'returned'];

export class MemoryLedger implements PaymentLedgerPort {
  readonly orders = new Map<string, MemoryOrder>();
  readonly payments = new Map<string, MemoryPayment>();
  readonly events: MemoryLogEntry[] = [];
  /** How many times each order was moved to `paid` (must never exceed 1). */
  readonly paidCount = new Map<string, number>();
  private readonly txns = new Map<string, TxnRecord>();
  private clock: number;
  private nextNumber = 1001;
  /** Optional artificial latency (ms) for every async method — handy to exercise deadlines. */
  latencyMs = 0;

  constructor(opts: { now?: Date | number } = {}) {
    this.clock = opts.now === undefined ? Date.now() : typeof opts.now === 'number' ? opts.now : opts.now.getTime();
  }

  // ── clock ──
  now(): Date {
    return new Date(this.clock);
  }
  setNow(t: Date | number): void {
    this.clock = typeof t === 'number' ? t : t.getTime();
  }
  advance(ms: number): void {
    this.clock += ms;
  }

  // ── fixtures ──
  addOrder(input: AddOrderInput): { orderId: string; paymentId: string } {
    const id = input.id ?? randomUuid();
    const order: MemoryOrder = {
      id,
      number: input.number ?? this.nextNumber++,
      amount: input.amount,
      currency: input.currency ?? 'UZS',
      status: input.status ?? 'pending_payment',
      isDigital: input.isDigital ?? false,
    };
    this.orders.set(id, order);
    const paymentId = input.paymentId ?? randomUuid();
    this.payments.set(paymentId, { id: paymentId, orderId: id, provider: null, providerTxnId: null, amount: order.amount, currency: order.currency, status: 'created' });
    return { orderId: id, paymentId };
  }

  order(id: string): MemoryOrder | undefined {
    return this.orders.get(id);
  }
  payment(id: string): MemoryPayment | undefined {
    return this.payments.get(id);
  }
  paymentsOf(orderId: string): MemoryPayment[] {
    return [...this.payments.values()].filter((p) => p.orderId === orderId);
  }
  /** All transactions (snapshot views), oldest first. */
  transactions(provider?: ProviderId): TxnView[] {
    return [...this.txns.values()].filter((t) => !provider || t.provider === provider).sort((a, b) => a.createdAt - b.createdAt).map((t) => this.view(t));
  }

  // ── port ──
  private async tick(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private key(provider: ProviderId, providerTxnId: string): string {
    return `${provider}\u0000${providerTxnId}`;
  }

  private view(t: TxnRecord): TxnView {
    const p = this.payments.get(t.paymentId)!;
    return {
      provider: t.provider,
      providerTxnId: t.providerTxnId,
      paymentId: t.paymentId,
      orderId: t.orderId,
      amount: t.amount,
      status: p.status,
      createdAt: new Date(t.createdAt),
      providerTime: new Date(t.providerTime),
      performedAt: t.performedAt === null ? null : new Date(t.performedAt),
      cancelledAt: t.cancelledAt === null ? null : new Date(t.cancelledAt),
      cancelReason: t.cancelReason,
    };
  }

  /** Resolves an order by id, by payment id, or by order number (Click / Uzum may send the number). */
  private resolveOrder(ref: { orderId?: string; paymentId?: string }): { order: MemoryOrder; payment?: MemoryPayment } | null {
    if (ref.paymentId) {
      const p = this.payments.get(ref.paymentId);
      const o = p && this.orders.get(p.orderId);
      return p && o ? { order: o, payment: p } : null;
    }
    if (!ref.orderId) return null;
    const direct = this.orders.get(ref.orderId);
    if (direct) return { order: direct };
    if (/^\d+$/.test(ref.orderId)) {
      const n = Number(ref.orderId);
      for (const o of this.orders.values()) if (o.number === n) return { order: o };
    }
    return null;
  }

  private payableView(o: MemoryOrder, p?: MemoryPayment): PayableOrder {
    const pay = p ?? this.currentPayment(o.id);
    return {
      orderId: o.id,
      orderNumber: o.number,
      paymentId: pay?.id ?? '',
      amount: o.amount,
      currency: o.currency,
      orderStatus: o.status,
      paymentStatus: pay?.status ?? 'created',
      isDigital: o.isDigital,
    };
  }

  /** Latest live payment of the order, else the most recently added one. */
  private currentPayment(orderId: string): MemoryPayment | undefined {
    const list = this.paymentsOf(orderId);
    return list.filter((p) => LIVE.includes(p.status)).at(-1) ?? list.at(-1);
  }

  async checkPayable(ref: { orderId?: string; paymentId?: string }, amount: Minor): Promise<CheckResult> {
    await this.tick();
    const found = this.resolveOrder(ref);
    if (!found) return { ok: false, reason: 'not_found' };
    const { order, payment } = found;
    if (payment) {
      if (payment.status === 'paid' || payment.status === 'refunded' || payment.status === 'partially_refunded' || payment.status === 'refund_pending') {
        return { ok: false, reason: 'already_paid' };
      }
      if (!LIVE.includes(payment.status)) return { ok: false, reason: 'cancelled' };
    }
    if (PAID_ORDER.includes(order.status)) return { ok: false, reason: 'already_paid' };
    if (order.status === 'cancelled') return { ok: false, reason: 'cancelled' };
    if (order.status !== 'pending_payment') return { ok: false, reason: 'not_payable' };
    if (amount !== order.amount) return { ok: false, reason: 'amount_mismatch' };
    return { ok: true, order: this.payableView(order, payment) };
  }

  async getTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView | null> {
    await this.tick();
    const t = this.txns.get(this.key(provider, providerTxnId));
    return t ? this.view(t) : null;
  }

  async activeTransactionForOrder(provider: ProviderId, orderId: string): Promise<TxnView | null> {
    await this.tick();
    for (const t of this.txns.values()) {
      if (t.provider === provider && t.orderId === orderId && LIVE.includes(this.payments.get(t.paymentId)!.status)) return this.view(t);
    }
    return null;
  }

  async openTransaction(input: { provider: ProviderId; providerTxnId: string; orderId: string; amount: Minor; providerTime: Date }): Promise<TxnView> {
    await this.tick();
    const k = this.key(input.provider, input.providerTxnId);
    const existing = this.txns.get(k);
    if (existing) return this.view(existing);
    const order = this.orders.get(input.orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'order not found');
    if (order.status !== 'pending_payment') throw new DomainError('INVALID_TRANSITION', `order is ${order.status}`);
    if (input.amount !== order.amount) throw new DomainError('VALIDATION', 'amount mismatch');
    // Bind the order's unused `created` payment, or start a new payment attempt for this transaction.
    let payment = this.paymentsOf(order.id).find((p) => p.status === 'created' && p.providerTxnId === null);
    if (!payment) {
      payment = { id: randomUuid(), orderId: order.id, provider: input.provider, providerTxnId: null, amount: order.amount, currency: order.currency, status: 'created' };
      this.payments.set(payment.id, payment);
    }
    payment.provider = input.provider;
    payment.providerTxnId = input.providerTxnId;
    payment.status = 'pending';
    const rec: TxnRecord = {
      provider: input.provider,
      providerTxnId: input.providerTxnId,
      paymentId: payment.id,
      orderId: order.id,
      amount: input.amount,
      createdAt: this.clock,
      providerTime: input.providerTime.getTime(),
      performedAt: null,
      cancelledAt: null,
      cancelReason: null,
    };
    this.txns.set(k, rec);
    return this.view(rec);
  }

  async confirmTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView> {
    await this.tick();
    const t = this.txns.get(this.key(provider, providerTxnId));
    if (!t) throw new DomainError('NOT_FOUND', 'transaction not found');
    const p = this.payments.get(t.paymentId)!;
    if (p.status === 'paid') return this.view(t);
    if (!LIVE.includes(p.status)) throw new DomainError('INVALID_TRANSITION', `payment is ${p.status}`);
    const order = this.orders.get(t.orderId)!;
    if (order.status !== 'pending_payment') throw new DomainError('INVALID_TRANSITION', `order is ${order.status}`);
    p.status = 'paid';
    order.status = 'paid';
    t.performedAt = this.clock;
    this.paidCount.set(order.id, (this.paidCount.get(order.id) ?? 0) + 1);
    return this.view(t);
  }

  async cancelTransaction(provider: ProviderId, providerTxnId: string, reason: number): Promise<TxnView> {
    await this.tick();
    const t = this.txns.get(this.key(provider, providerTxnId));
    if (!t) throw new DomainError('NOT_FOUND', 'transaction not found');
    const p = this.payments.get(t.paymentId)!;
    if (LIVE.includes(p.status)) {
      p.status = 'cancelled';
    } else if (p.status === 'paid') {
      const order = this.orders.get(t.orderId)!;
      // Auto-refund only while the goods have not left the shop (mirrors the order state machine's cancel guard).
      if (!['paid', 'confirmed', 'packing'].includes(order.status)) throw new DomainError('INVALID_TRANSITION', `order is ${order.status}`);
      p.status = 'refunded';
      order.status = 'cancelled';
    } else {
      return this.view(t); // already cancelled / refunded: idempotent
    }
    t.cancelledAt = this.clock;
    t.cancelReason = reason;
    return this.view(t);
  }

  async statement(provider: ProviderId, from: Date, to: Date): Promise<TxnView[]> {
    await this.tick();
    const a = from.getTime();
    const b = to.getTime();
    return this.transactions(provider).filter((t) => t.createdAt.getTime() >= a && t.createdAt.getTime() <= b);
  }

  async log(e: { provider: ProviderId; kind: string; payload: string; signatureOk: boolean; response: string }): Promise<void> {
    this.events.push({ ...e, at: this.clock });
  }
}
