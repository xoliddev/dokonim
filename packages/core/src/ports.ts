/**
 * Ports (§7.1, §11.3). Core owns the interfaces; adapters live in packages/payments, packages/db and apps/*.
 */
import type { Minor, Currency } from './money';
import type { OrderStatus, PaymentStatus } from './state-machines';
import type { Locale } from './locale';

export type ProviderId = 'payme' | 'click' | 'uzum' | 'paynet' | 'telegram' | 'stars' | 'stripe' | 'cod' | 'bank_transfer';
export const PROVIDER_IDS: ProviderId[] = ['payme', 'click', 'uzum', 'paynet', 'telegram', 'stars', 'stripe', 'cod', 'bank_transfer'];
export type ProviderMode = 'sandbox' | 'live';

export interface ProviderCapabilities {
  currencies: Currency[];
  goods: Array<'physical' | 'digital'>;
  refunds: 'full' | 'partial' | 'none' | 'manual';
  flow: 'redirect' | 'invoice' | 'offline';
  fiscalReceipts: boolean;
}

/** Decrypted config, only ever materialised inside the payments layer (never sent to clients). */
export interface ProviderConfig {
  provider: ProviderId;
  mode: ProviderMode;
  enabled: boolean;
  publicConfig: Record<string, string>;
  credentials: Record<string, string>;
}

export interface StoreRef {
  id: string;
  slug: string;
  name: string;
}

export interface OrderSnapshot {
  id: string;
  shortId: string;
  number: number;
  total: Minor;
  currency: Currency;
  items: Array<{ title: string; qty: number; unitPrice: Minor; ikpuCode?: string | null; packageCode?: string | null; vatPercent?: number | null }>;
  isDigital: boolean;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: ProviderId;
  mode: ProviderMode;
  status: PaymentStatus;
  amount: Minor;
  currency: Currency;
  providerTxnId?: string | null;
}

export interface CreateIntentInput {
  store: StoreRef;
  order: OrderSnapshot;
  payment: PaymentRecord;
  returnUrl: string;
  locale: Locale;
}

export type NextAction =
  | { type: 'redirect'; url: string; openWith: 'openLink' | 'openTelegramLink' }
  | { type: 'invoice'; invoiceLink: string }
  | { type: 'sandbox'; provider: ProviderId; paymentId: string; url: string }
  | { type: 'none'; message: string };

export interface ConfigCheck {
  ok: boolean;
  problems: string[];
}

export interface RefundResult {
  status: 'refunded' | 'pending' | 'manual';
  providerRef?: string;
}

export interface PaymentProviderAdapter {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  validateConfig(cfg: ProviderConfig): Promise<ConfigCheck>;
  createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction>;
  refund?(p: PaymentRecord, amount: Minor, cfg: ProviderConfig): Promise<RefundResult>;
}

export interface RawWebhookRequest {
  /** Sub-route for multi-endpoint protocols: Click 'prepare' | 'complete', Uzum 'check' | 'create' | … */
  action?: string;
  headers: Record<string, string | undefined>;
  /** Exact raw body as received (signatures are computed over it). */
  body: string;
  contentType?: string;
  ip?: string;
}

export interface RawWebhookResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type AuthResult = { ok: true } | { ok: false; reason: string };

export interface PayableOrder {
  orderId: string;
  orderNumber: number;
  paymentId: string;
  amount: Minor;
  currency: Currency;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  isDigital: boolean;
}

export type CheckResult =
  | { ok: true; order: PayableOrder }
  | { ok: false; reason: 'not_found' | 'amount_mismatch' | 'not_payable' | 'already_paid' | 'cancelled' };

export interface TxnView {
  provider: ProviderId;
  providerTxnId: string;
  paymentId: string;
  orderId: string;
  amount: Minor;
  status: PaymentStatus;
  /** Our creation time (Payme `create_time`). */
  createdAt: Date;
  providerTime: Date;
  performedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: number | null;
}

/** Narrow port the protocol handlers use — all money logic stays in core/services. */
export interface PaymentLedgerPort {
  now(): Date;
  /** ref may carry our order id, payment id, or order number (Click's merchant_trans_id). */
  checkPayable(ref: { orderId?: string; paymentId?: string }, amount: Minor): Promise<CheckResult>;
  getTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView | null>;
  /** Another live (created/pending) transaction of this provider for the order, if any. */
  activeTransactionForOrder(provider: ProviderId, orderId: string): Promise<TxnView | null>;
  /** Idempotent by (provider, providerTxnId). Moves the payment to `pending`. */
  openTransaction(input: { provider: ProviderId; providerTxnId: string; orderId: string; amount: Minor; providerTime: Date }): Promise<TxnView>;
  /** Idempotent. Payment → paid, order → paid (commits stock), outbox notifications. */
  confirmTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView>;
  /** Idempotent. Before perform → cancelled; after perform → refunded (order cancelled + restock). */
  cancelTransaction(provider: ProviderId, providerTxnId: string, reason: number): Promise<TxnView>;
  statement(provider: ProviderId, from: Date, to: Date): Promise<TxnView[]>;
  /** Append-only protocol log (payment_events). */
  log(e: { provider: ProviderId; kind: string; payload: string; signatureOk: boolean; response: string }): Promise<void>;
}

export interface WebhookHandler {
  readonly id: ProviderId;
  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult | Promise<AuthResult>;
  handle(req: RawWebhookRequest, cfg: ProviderConfig, ledger: PaymentLedgerPort): Promise<RawWebhookResponse>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
