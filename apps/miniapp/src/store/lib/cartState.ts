/**
 * Cart & promo UI state (pure, unit-tested): promo messages from core pricing explanations, blocking stock
 * warnings, the free-delivery progress bar and stepper bounds. The API is the pricing source of truth;
 * these helpers only decide what to show.
 */
import type { MessageKey } from '@dokonim/i18n';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;
type Money = (minor: number) => string;

export interface PromoExplanation {
  code: string;
  params?: Record<string, string | number>;
}
export interface PromoResult {
  promo: { code: string; status: 'applied' | 'rejected'; reason?: string } | null;
  explanation: PromoExplanation | null;
}

const PROMO_KEYS = new Set([
  'PROMO_NOT_FOUND', 'PROMO_NOT_STARTED', 'PROMO_EXPIRED', 'PROMO_DISABLED', 'PROMO_MIN_SUBTOTAL', 'PROMO_FIRST_ORDER', 'PROMO_CUSTOMER_TAGS',
  'PROMO_USAGE_LIMIT', 'PROMO_PER_CUSTOMER_LIMIT', 'PROMO_NOT_COMBINABLE', 'PROMO_NO_ELIGIBLE_ITEMS', 'PROMO_REPLACED_AUTOMATIC',
]);

/** Normalises what the buyer typed: trims, uppercases, drops inner spaces. */
export const normalisePromo = (raw: string) => raw.trim().replace(/\s+/g, '').toUpperCase().slice(0, 40);

/** A localised, specific reason for a rejected promo code (never just "invalid"). */
export function promoMessage(t: T, money: Money, code: string, r: PromoResult): { ok: boolean; message: string } {
  if (r.promo?.status === 'applied') return { ok: true, message: t('checkout.promoApplied', { code: r.promo.code }) };
  const reason = r.explanation?.code ?? r.promo?.reason ?? 'PROMO_NOT_FOUND';
  if (!PROMO_KEYS.has(reason)) return { ok: false, message: t('checkout.promoInvalid') };
  const p = r.explanation?.params ?? {};
  const params: Record<string, string | number> = { code };
  if (typeof p.min === 'number') params.min = money(p.min);
  if (typeof p.missing === 'number') params.missing = money(Math.max(0, p.missing));
  return { ok: false, message: t(`checkout.promo_${reason}` as MessageKey, params) };
}

export type Warning = 'price_changed' | 'out_of_stock' | 'qty_reduced' | 'unavailable';
export interface LineLike {
  variantId: string;
  qty: number;
  available: number;
  maxQty: number;
  warnings: Warning[];
}

const BLOCKING: Warning[] = ['out_of_stock', 'qty_reduced', 'unavailable'];

/** Lines that stop checkout (stock problems). Price changes are handled by "accept new prices". */
export const blockingLines = <L extends LineLike>(items: L[]) => items.filter((i) => i.warnings.some((w) => BLOCKING.includes(w)));
export const hasPriceChange = (items: LineLike[]) => items.some((i) => i.warnings.includes('price_changed'));
export function canCheckout(items: LineLike[]): boolean {
  return items.some((i) => !i.warnings.includes('unavailable')) && blockingLines(items).length === 0 && !hasPriceChange(items);
}

/** The single most useful warning label for a line. */
export function lineWarning(t: T, line: LineLike): string | null {
  if (line.warnings.includes('unavailable')) return t('store.warn_unavailable');
  if (line.warnings.includes('out_of_stock')) return t('store.warn_out_of_stock');
  if (line.warnings.includes('qty_reduced')) return t('store.warn_qty_reduced', { n: line.available });
  return null;
}

/** Stepper bounds: 1…maxQty (0 removes the line). */
export function clampQty(line: Pick<LineLike, 'maxQty'>, qty: number): number {
  return Math.max(0, Math.min(Math.max(line.maxQty, 0), Math.floor(qty)));
}

export interface PricingLike {
  subtotal: number;
  shippingTotal: number;
  freeShippingRemaining: number | null;
  explanations: PromoExplanation[];
}

/** Free-delivery nudge: remaining amount and a 0..1 progress ratio (null when the store has no threshold). */
export function freeShipping(p: PricingLike): { remaining: number; ratio: number } | null {
  const threshold = p.explanations.find((e) => e.code === 'FREE_SHIPPING_THRESHOLD')?.params?.freeOver;
  if (p.freeShippingRemaining == null) {
    if (p.explanations.some((e) => e.code === 'FREE_SHIPPING_APPLIED')) return { remaining: 0, ratio: 1 };
    return null;
  }
  const remaining = Math.max(0, p.freeShippingRemaining);
  const total = typeof threshold === 'number' && threshold > 0 ? threshold : p.subtotal + remaining;
  return { remaining, ratio: total > 0 ? Math.min(1, Math.max(0, (total - remaining) / total)) : 1 };
}

/** Error code → localised message for order placement. */
export function orderError(t: T, code: string | undefined, fallback: string): string {
  switch (code) {
    case 'OUT_OF_STOCK':
    case 'PRICE_CHANGED':
    case 'SHIPPING_UNAVAILABLE':
    case 'PAYMENT_METHOD_UNAVAILABLE':
    case 'CART_EMPTY':
    case 'PAYMENT_FAILED':
      return t(`checkout.err_${code}` as MessageKey);
    default:
      return fallback || t('common.errorGeneric');
  }
}

/** +998 XX XXX XX XX as the buyer types (keeps the leading plus). */
export function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (!d.startsWith('998')) d = `998${d}`.slice(0, 12);
  d = d.slice(0, 12);
  const parts = [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
  return `+${parts.join(' ')}`;
}
export const isPhoneValid = (raw: string) => /^\+?998\d{9}$/.test(raw.replace(/[\s()-]/g, ''));
