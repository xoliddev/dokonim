/**
 * The pricing pipeline (§9.4). Pure and deterministic; the API, the demo worker and the UI quote all use it.
 *
 * lines → automatic product-level (flash sales, scoped automatics, BXGY) → order-level automatic
 *       → promo code → shipping (free-over threshold, free-shipping discounts)
 *       → whole-so'm rounding → allocation of order-level discounts back to lines (largest remainder)
 */
import { isDescendantOrSelf } from './category-tree';
import { allocate, floorToMajor, MINOR_PER_MAJOR, percentOf, type Currency, type Minor } from './money';

export type DiscountKind = 'code' | 'automatic' | 'flash_sale';
export type DiscountValueType = 'percent' | 'fixed' | 'free_shipping' | 'bxgy';
export type DiscountScope =
  | { type: 'all' }
  | { type: 'products'; ids: string[] }
  | { type: 'collections'; ids: string[] }
  | { type: 'category'; paths: string[] };

export interface DiscountRule {
  id: string;
  kind: DiscountKind;
  title?: string;
  code?: string | null;
  valueType: DiscountValueType;
  /** percent (0–100) for percent/bxgy, minor units for fixed */
  value: number;
  bxgy?: { buy: number; get: number } | null;
  appliesTo: DiscountScope;
  conditions: { minSubtotal?: Minor | null; firstOrder?: boolean; customerTags?: string[] };
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  usedCount: number;
  combines: { order: boolean; product: boolean; shipping: boolean };
  priority: number;
  status: 'active' | 'disabled' | 'archived';
}

export interface PriceLine {
  key: string;
  productId: string;
  categoryPath: string | null;
  collectionIds: string[];
  unitPrice: Minor;
  qty: number;
  weightG?: number;
}

export interface PricingCustomer {
  ordersCount: number;
  tags: string[];
  /** discountId → times this customer used it */
  usage: Record<string, number>;
}

export interface PricingInput {
  lines: PriceLine[];
  discounts: DiscountRule[];
  promoCode?: string | null;
  customer?: PricingCustomer | null;
  shipping?: { amount: Minor; freeOver?: Minor | null } | null;
  now: Date;
  currency?: Currency;
}

export type ExplanationCode =
  | 'AUTO_APPLIED'
  | 'FLASH_SALE_APPLIED'
  | 'PROMO_APPLIED'
  | 'PROMO_NOT_FOUND'
  | 'PROMO_NOT_STARTED'
  | 'PROMO_EXPIRED'
  | 'PROMO_DISABLED'
  | 'PROMO_MIN_SUBTOTAL'
  | 'PROMO_FIRST_ORDER'
  | 'PROMO_CUSTOMER_TAGS'
  | 'PROMO_USAGE_LIMIT'
  | 'PROMO_PER_CUSTOMER_LIMIT'
  | 'PROMO_NOT_COMBINABLE'
  | 'PROMO_NO_ELIGIBLE_ITEMS'
  | 'PROMO_REPLACED_AUTOMATIC'
  | 'FREE_SHIPPING_THRESHOLD'
  | 'FREE_SHIPPING_APPLIED';

export interface Explanation {
  code: ExplanationCode;
  discountId?: string;
  params?: Record<string, string | number>;
}

export type DiscountTarget = 'product' | 'order' | 'shipping';

export interface AppliedDiscount {
  discountId: string;
  kind: DiscountKind;
  code?: string | null;
  title?: string;
  target: DiscountTarget;
  amount: Minor;
}

export interface PricedLine extends PriceLine {
  subtotal: Minor;
  productDiscount: Minor;
  orderDiscount: Minor;
  total: Minor;
  allocations: Array<{ discountId: string; amount: Minor }>;
}

export interface PricingResult {
  lines: PricedLine[];
  subtotal: Minor;
  productDiscountTotal: Minor;
  orderDiscountTotal: Minor;
  shippingBase: Minor;
  shippingDiscount: Minor;
  shippingTotal: Minor;
  discountTotal: Minor;
  total: Minor;
  applied: AppliedDiscount[];
  explanations: Explanation[];
  promo: { code: string; status: 'applied' | 'rejected'; reason?: ExplanationCode } | null;
  freeShippingRemaining: Minor | null;
}

export function discountTarget(d: Pick<DiscountRule, 'valueType' | 'kind' | 'appliesTo'>): DiscountTarget {
  if (d.valueType === 'free_shipping') return 'shipping';
  if (d.valueType === 'bxgy' || d.kind === 'flash_sale' || d.appliesTo.type !== 'all') return 'product';
  return 'order';
}

export function scopeMatches(scope: DiscountScope, line: Pick<PriceLine, 'productId' | 'categoryPath' | 'collectionIds'>): boolean {
  switch (scope.type) {
    case 'all':
      return true;
    case 'products':
      return scope.ids.includes(line.productId);
    case 'collections':
      return line.collectionIds.some((c) => scope.ids.includes(c));
    case 'category':
      return !!line.categoryPath && scope.paths.some((p) => isDescendantOrSelf(line.categoryPath!, p));
  }
}

type Window = 'ok' | 'not_started' | 'expired' | 'disabled' | 'exhausted';
export function discountWindow(d: DiscountRule, now: Date): Window {
  if (d.status !== 'active') return 'disabled';
  if (d.startsAt && now < new Date(d.startsAt)) return 'not_started';
  if (d.endsAt && now >= new Date(d.endsAt)) return 'expired';
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) return 'exhausted';
  return 'ok';
}

function conditionFailure(d: DiscountRule, merchSubtotal: Minor, customer: PricingCustomer | null | undefined): Explanation | null {
  const c = d.conditions ?? {};
  if (c.minSubtotal && merchSubtotal < c.minSubtotal)
    return { code: 'PROMO_MIN_SUBTOTAL', discountId: d.id, params: { min: c.minSubtotal, missing: c.minSubtotal - merchSubtotal } };
  if (c.firstOrder && (customer?.ordersCount ?? 0) > 0) return { code: 'PROMO_FIRST_ORDER', discountId: d.id };
  if (c.customerTags?.length && !c.customerTags.some((t) => customer?.tags.includes(t)))
    return { code: 'PROMO_CUSTOMER_TAGS', discountId: d.id };
  if (d.perCustomerLimit != null && (customer?.usage[d.id] ?? 0) >= d.perCustomerLimit)
    return { code: 'PROMO_PER_CUSTOMER_LIMIT', discountId: d.id, params: { limit: d.perCustomerLimit } };
  return null;
}

/** Per-line amounts of a product-target discount. */
function productAmounts(d: DiscountRule, lines: PriceLine[], currency: Currency): Minor[] {
  if (d.valueType === 'bxgy') {
    const buy = Math.max(1, d.bxgy?.buy ?? 1);
    const get = Math.max(1, d.bxgy?.get ?? 1);
    const units: Array<{ li: number; price: Minor }> = [];
    lines.forEach((l, li) => {
      if (scopeMatches(d.appliesTo, l)) for (let k = 0; k < Math.min(l.qty, 500); k++) units.push({ li, price: l.unitPrice });
    });
    units.sort((a, b) => b.price - a.price || a.li - b.li);
    const out = lines.map(() => 0);
    const group = buy + get;
    for (let g = 0; g + group <= units.length; g += group) {
      for (let k = g + buy; k < g + group; k++) {
        const u = units[k]!;
        out[u.li] = out[u.li]! + percentOf(u.price, d.value, currency);
      }
    }
    return out;
  }
  return lines.map((l) => {
    if (!scopeMatches(d.appliesTo, l)) return 0;
    const sub = l.unitPrice * l.qty;
    if (d.valueType === 'percent') return Math.min(sub, percentOf(sub, d.value, currency));
    if (d.valueType === 'fixed') return Math.min(sub, floorToMajor(Math.min(d.value, l.unitPrice), currency) * l.qty);
    return 0;
  });
}

function orderAmount(d: DiscountRule, base: Minor, currency: Currency): Minor {
  if (d.valueType === 'percent') return Math.min(base, percentOf(base, d.value, currency));
  if (d.valueType === 'fixed') return Math.min(base, floorToMajor(d.value, currency));
  return 0;
}

export function priceCart(input: PricingInput): PricingResult {
  const currency = input.currency ?? 'UZS';
  const unit = MINOR_PER_MAJOR[currency];
  const now = input.now;
  const explanations: Explanation[] = [];
  const applied: AppliedDiscount[] = [];
  const lines = input.lines.filter((l) => l.qty > 0);
  const subs = lines.map((l) => l.unitPrice * l.qty);
  const subtotal = subs.reduce((a, b) => a + b, 0);

  // Per-line product discount stacks: discountId → amount.
  const productStacks: Array<Array<{ d: DiscountRule; amount: Minor }>> = lines.map(() => []);
  const lineAllocations: Array<Array<{ discountId: string; amount: Minor }>> = lines.map(() => []);

  const active = input.discounts.filter((d) => discountWindow(d, now) === 'ok');
  const autos = active
    .filter((d) => d.kind !== 'code')
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  // ── 1. automatic product-level discounts
  const autoProduct = autos.filter((d) => discountTarget(d) === 'product' && !conditionFailure(d, subtotal, input.customer));
  const candidates = autoProduct.map((d) => ({ d, amounts: productAmounts(d, lines, currency) }));
  lines.forEach((_, li) => {
    const opts = candidates
      .map((c) => ({ d: c.d, amount: c.amounts[li]! }))
      .filter((o) => o.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    let room = subs[li]!;
    for (const o of opts) {
      const stack = productStacks[li]!;
      const ok = stack.length === 0 || (o.d.combines.product && stack.every((s) => s.d.combines.product));
      if (!ok) continue;
      const amt = Math.min(room, o.amount);
      if (amt <= 0) break;
      stack.push({ d: o.d, amount: amt });
      room -= amt;
    }
  });

  const productDiscountOf = (li: number) => productStacks[li]!.reduce((a, s) => a + s.amount, 0);
  const netOf = (li: number) => subs[li]! - productDiscountOf(li);
  const merchAfterProduct = () => lines.reduce((a, _, li) => a + netOf(li), 0);

  // ── 2. order-level automatic discounts (best single, plus mutually combinable ones)
  type OrderApplied = { d: DiscountRule; amount: Minor; weights: number[] };
  let orderApplied: OrderApplied[] = [];
  // same stacking rule as an order-level code: lines that already carry a product discount count only if combines.product
  const orderBase = (d: DiscountRule) => lines.map((l, li) => (scopeMatches(d.appliesTo, l) && (d.combines.product || productStacks[li]!.length === 0) ? netOf(li) : 0));
  const autoOrder = autos
    .filter((d) => discountTarget(d) === 'order' && !conditionFailure(d, merchAfterProduct(), input.customer))
    .map((d) => {
      const w = orderBase(d);
      return { d, amount: orderAmount(d, w.reduce((a, b) => a + b, 0), currency), weights: w };
    })
    .filter((x) => x.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  for (const c of autoOrder) {
    const used = orderApplied.reduce((a, o) => a + o.amount, 0);
    const room = merchAfterProduct() - used;
    const ok = orderApplied.length === 0 || (c.d.combines.order && orderApplied.every((o) => o.d.combines.order));
    if (!ok || room <= 0) continue;
    orderApplied.push({ ...c, amount: Math.min(room, c.amount) });
  }

  // ── 3. promo code
  let promo: PricingResult['promo'] = null;
  let codeShipping: DiscountRule | null = null;
  const code = input.promoCode?.trim();
  if (code) {
    const d = input.discounts.find((x) => x.kind === 'code' && x.code?.toLowerCase() === code.toLowerCase());
    const reject = (e: Explanation) => {
      explanations.push(e);
      promo = { code, status: 'rejected', reason: e.code };
    };
    if (!d) reject({ code: 'PROMO_NOT_FOUND', params: { code } });
    else {
      const w = discountWindow(d, now);
      const cond = conditionFailure(d, merchAfterProduct(), input.customer);
      if (w === 'not_started') reject({ code: 'PROMO_NOT_STARTED', discountId: d.id, params: { startsAt: d.startsAt ?? '' } });
      else if (w === 'expired') reject({ code: 'PROMO_EXPIRED', discountId: d.id });
      else if (w === 'disabled') reject({ code: 'PROMO_DISABLED', discountId: d.id });
      else if (w === 'exhausted') reject({ code: 'PROMO_USAGE_LIMIT', discountId: d.id });
      else if (cond) reject(cond);
      else {
        const target = discountTarget(d);
        if (target === 'shipping') {
          codeShipping = d;
          promo = { code, status: 'applied' };
        } else if (target === 'product') {
          const amounts = productAmounts(d, lines, currency);
          let any = false;
          let blocked = false;
          amounts.forEach((amt, li) => {
            if (amt <= 0) return;
            const stack = productStacks[li]!;
            if (stack.length && !(d.combines.product && stack.every((s) => s.d.combines.product))) {
              blocked = true;
              return;
            }
            const real = Math.min(netOf(li), amt);
            if (real > 0) {
              stack.push({ d, amount: real });
              any = true;
            }
          });
          if (any) promo = { code, status: 'applied' };
          else reject({ code: blocked ? 'PROMO_NOT_COMBINABLE' : 'PROMO_NO_ELIGIBLE_ITEMS', discountId: d.id });
        } else {
          const weights = lines.map((l, li) =>
            scopeMatches(d.appliesTo, l) && (d.combines.product || productStacks[li]!.length === 0) ? netOf(li) : 0,
          );
          const base = weights.reduce((a, b) => a + b, 0);
          const amount = orderAmount(d, base, currency);
          if (amount <= 0) reject({ code: base === 0 && subtotal > 0 ? 'PROMO_NOT_COMBINABLE' : 'PROMO_NO_ELIGIBLE_ITEMS', discountId: d.id });
          else {
            const compatible = orderApplied.every((o) => o.d.combines.order && d.combines.order);
            if (compatible) {
              const room = merchAfterProduct() - orderApplied.reduce((a, o) => a + o.amount, 0);
              orderApplied.push({ d, amount: Math.min(room, amount), weights });
              promo = { code, status: 'applied' };
            } else {
              const autoTotal = orderApplied.reduce((a, o) => a + o.amount, 0);
              if (amount > autoTotal) {
                explanations.push({ code: 'PROMO_REPLACED_AUTOMATIC', discountId: d.id });
                orderApplied = [{ d, amount: Math.min(merchAfterProduct(), amount), weights }];
                promo = { code, status: 'applied' };
              } else reject({ code: 'PROMO_NOT_COMBINABLE', discountId: d.id });
            }
          }
        }
        if (promo && (promo as { status: string }).status === 'applied')
          explanations.push({ code: 'PROMO_APPLIED', discountId: d.id, params: { code: d.code ?? code } });
      }
    }
  }

  // ── allocation of order-level discounts to lines
  // Sequential: each discount is spread over what is still left on its eligible lines, so the
  // sum of allocations on a line can never exceed that line's net amount.
  const remaining = lines.map((_, li) => netOf(li));
  for (const o of orderApplied) {
    const weights = o.weights.map((w, li) => (w > 0 ? remaining[li]! : 0));
    o.amount = Math.min(o.amount, weights.reduce((a, b) => a + b, 0));
    const parts = allocate(o.amount, weights, unit);
    parts.forEach((p, li) => (remaining[li] = remaining[li]! - p));
    parts.forEach((p, li) => {
      if (p > 0) lineAllocations[li]!.push({ discountId: o.d.id, amount: p });
    });
    applied.push({ discountId: o.d.id, kind: o.d.kind, code: o.d.code ?? null, title: o.d.title, target: 'order', amount: o.amount });
    if (o.d.kind !== 'code') explanations.push({ code: 'AUTO_APPLIED', discountId: o.d.id });
  }
  const productTotals = new Map<string, { d: DiscountRule; amount: Minor }>();
  productStacks.forEach((stack, li) =>
    stack.forEach((s) => {
      lineAllocations[li]!.push({ discountId: s.d.id, amount: s.amount });
      const cur = productTotals.get(s.d.id);
      productTotals.set(s.d.id, { d: s.d, amount: (cur?.amount ?? 0) + s.amount });
    }),
  );
  for (const { d, amount } of productTotals.values()) {
    applied.unshift({ discountId: d.id, kind: d.kind, code: d.code ?? null, title: d.title, target: 'product', amount });
    if (d.kind === 'flash_sale') explanations.push({ code: 'FLASH_SALE_APPLIED', discountId: d.id });
    else if (d.kind === 'automatic') explanations.push({ code: 'AUTO_APPLIED', discountId: d.id });
  }

  const priced: PricedLine[] = lines.map((l, li) => {
    const productDiscount = productDiscountOf(li);
    const orderDiscount = lineAllocations[li]!.filter((a) => orderApplied.some((o) => o.d.id === a.discountId)).reduce(
      (a, b) => a + b.amount,
      0,
    );
    return {
      ...l,
      subtotal: subs[li]!,
      productDiscount,
      orderDiscount,
      total: subs[li]! - productDiscount - orderDiscount,
      allocations: lineAllocations[li]!,
    };
  });
  const productDiscountTotal = priced.reduce((a, l) => a + l.productDiscount, 0);
  const orderDiscountTotal = orderApplied.reduce((a, o) => a + o.amount, 0);
  const merchTotal = subtotal - productDiscountTotal - orderDiscountTotal;

  // ── 4. shipping
  let shippingBase = 0;
  let freeShippingRemaining: Minor | null = null;
  if (input.shipping) {
    shippingBase = input.shipping.amount;
    const freeOver = input.shipping.freeOver;
    if (freeOver != null && freeOver > 0) {
      if (merchTotal >= freeOver) {
        if (shippingBase > 0) explanations.push({ code: 'FREE_SHIPPING_THRESHOLD', params: { freeOver } });
        shippingBase = 0;
        freeShippingRemaining = 0;
      } else freeShippingRemaining = freeOver - merchTotal;
    }
  }
  let shippingDiscount = 0;
  const shippingCandidates: DiscountRule[] = [
    ...autos.filter((d) => discountTarget(d) === 'shipping' && !conditionFailure(d, merchTotal, input.customer)),
    ...(codeShipping ? [codeShipping] : []),
  ];
  if (shippingBase > 0 && shippingCandidates.length) {
    const d = shippingCandidates[0]!;
    shippingDiscount = shippingBase;
    applied.push({ discountId: d.id, kind: d.kind, code: d.code ?? null, title: d.title, target: 'shipping', amount: shippingDiscount });
    explanations.push({ code: 'FREE_SHIPPING_APPLIED', discountId: d.id });
  } else if (codeShipping && shippingBase === 0 && input.shipping) {
    // free-shipping code applied, but delivery is already free — still "applied" (no-op), no amount.
  }
  const shippingTotal = shippingBase - shippingDiscount;
  const discountTotal = productDiscountTotal + orderDiscountTotal + shippingDiscount;
  return {
    lines: priced,
    subtotal,
    productDiscountTotal,
    orderDiscountTotal,
    shippingBase,
    shippingDiscount,
    shippingTotal,
    discountTotal,
    total: subtotal - productDiscountTotal - orderDiscountTotal + shippingTotal,
    applied,
    explanations,
    promo,
    freeShippingRemaining,
  };
}

/** Best active flash-sale/automatic product price for a single unit — used for listing cards & PDP. */
export function displayPrice(
  line: Omit<PriceLine, 'qty' | 'key'>,
  discounts: DiscountRule[],
  now: Date,
): { price: Minor; compareAt: Minor | null; discountId: string | null; endsAt: string | null } {
  const r = priceCart({
    lines: [{ ...line, key: 'x', qty: 1 }],
    discounts: discounts.filter((d) => d.kind !== 'code' && d.valueType !== 'bxgy' && discountTarget(d) === 'product' && !d.conditions?.minSubtotal && !d.conditions?.firstOrder && !d.conditions?.customerTags?.length),
    now,
  });
  const l = r.lines[0]!;
  if (l.productDiscount <= 0) return { price: line.unitPrice, compareAt: null, discountId: null, endsAt: null };
  const top = r.applied.find((a) => a.target === 'product');
  const rule = discounts.find((d) => d.id === top?.discountId);
  return { price: l.total, compareAt: line.unitPrice, discountId: top?.discountId ?? null, endsAt: rule?.endsAt ?? null };
}

/** Percent badge ("−20%"), floor so we never overstate. */
export function discountPercent(price: Minor, compareAt: Minor | null | undefined): number {
  if (!compareAt || compareAt <= price) return 0;
  return Math.floor(((compareAt - price) / compareAt) * 100);
}
