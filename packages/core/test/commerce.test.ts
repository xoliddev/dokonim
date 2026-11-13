import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  adjustStock, allowedEvents, available, cartesian, commitReservation, deliveryPromise, discountPercent, displayPrice,
  DomainError, findVariant, installment, matchZone, ORDER_STATUSES, ORDER_TRANSITIONS, paymeStateToStatus, planVariantMatrix,
  priceCart, rateAmount, releaseReservation, reserve, restock, statusToPaymeState, transitionOrder, transitionPayment,
  valueStates, type DiscountRule, type OrderEvent, type PriceLine, type StockLevel,
} from '../src';

const base: Omit<DiscountRule, 'id' | 'kind' | 'valueType' | 'value'> = {
  appliesTo: { type: 'all' },
  conditions: {},
  usedCount: 0,
  combines: { order: false, product: false, shipping: true },
  priority: 0,
  status: 'active',
};
const d = (x: Partial<DiscountRule> & Pick<DiscountRule, 'id' | 'kind' | 'valueType' | 'value'>): DiscountRule => ({ ...base, ...x });
const line = (key: string, unitPrice: number, qty: number, extra: Partial<PriceLine> = {}): PriceLine => ({
  key, productId: `p-${key}`, categoryPath: null, collectionIds: [], unitPrice, qty, ...extra,
});
const now = new Date('2026-11-13T09:00:00Z');

describe('pricing pipeline — golden cases', () => {
  it('no discounts: total = subtotal + shipping', () => {
    const r = priceCart({ lines: [line('a', 25_000_000, 2)], discounts: [], shipping: { amount: 2_000_000 }, now });
    expect(r.subtotal).toBe(50_000_000);
    expect(r.total).toBe(52_000_000);
    expect(r.discountTotal).toBe(0);
  });

  it('flash sale on a category subtree + SALOM10 order code (combinable)', () => {
    const flash = d({ id: 'f', kind: 'flash_sale', valueType: 'percent', value: 20, appliesTo: { type: 'category', paths: ['kiyim'] }, endsAt: '2026-11-14T00:00:00Z', combines: { order: true, product: false, shipping: true } });
    const code = d({ id: 'c', kind: 'code', code: 'SALOM10', valueType: 'percent', value: 10, combines: { order: true, product: true, shipping: true } });
    const r = priceCart({
      lines: [line('a', 30_000_000, 1, { categoryPath: 'kiyim.ayollar' }), line('b', 10_000_000, 2)],
      discounts: [flash, code], promoCode: 'salom10', now,
    });
    expect(r.lines[0]!.productDiscount).toBe(6_000_000);
    expect(r.lines[1]!.productDiscount).toBe(0);
    // order base = 24m + 20m = 44m → 10% = 4.4m
    expect(r.orderDiscountTotal).toBe(4_400_000);
    expect(r.total).toBe(50_000_000 - 6_000_000 - 4_400_000);
    expect(r.promo).toEqual({ code: 'salom10', status: 'applied' });
    expect(r.explanations.map((e) => e.code)).toContain('FLASH_SALE_APPLIED');
  });

  it('explains a min-subtotal rejection with the missing amount', () => {
    const code = d({ id: 'c', kind: 'code', code: 'KATTA', valueType: 'fixed', value: 5_000_000, conditions: { minSubtotal: 30_000_000 } });
    const r = priceCart({ lines: [line('a', 12_000_000, 2)], discounts: [code], promoCode: 'KATTA', now });
    expect(r.promo?.status).toBe('rejected');
    expect(r.explanations[0]).toMatchObject({ code: 'PROMO_MIN_SUBTOTAL', params: { min: 30_000_000, missing: 6_000_000 } });
    expect(r.total).toBe(24_000_000);
  });

  it('rejects expired, not-started, exhausted, first-order and unknown codes', () => {
    const mk = (x: Partial<DiscountRule>) => d({ id: 'c', kind: 'code', code: 'X', valueType: 'percent', value: 10, ...x });
    const run = (disc: DiscountRule, code = 'X', ordersCount = 0) =>
      priceCart({ lines: [line('a', 1_000_000, 1)], discounts: [disc], promoCode: code, customer: { ordersCount, tags: [], usage: { c: 3 } }, now }).promo?.reason;
    expect(run(mk({ endsAt: '2026-11-01T00:00:00Z' }))).toBe('PROMO_EXPIRED');
    expect(run(mk({ startsAt: '2026-12-01T00:00:00Z' }))).toBe('PROMO_NOT_STARTED');
    expect(run(mk({ usageLimit: 5, usedCount: 5 }))).toBe('PROMO_USAGE_LIMIT');
    expect(run(mk({ perCustomerLimit: 3 }))).toBe('PROMO_PER_CUSTOMER_LIMIT');
    expect(run(mk({ conditions: { firstOrder: true } }), 'X', 2)).toBe('PROMO_FIRST_ORDER');
    expect(run(mk({ conditions: { customerTags: ['vip'] } }))).toBe('PROMO_CUSTOMER_TAGS');
    expect(run(mk({ status: 'disabled' }))).toBe('PROMO_DISABLED');
    expect(run(mk({}), 'NOPE')).toBe('PROMO_NOT_FOUND');
  });

  it('non-combinable code vs automatic: larger one wins', () => {
    const auto = d({ id: 'a', kind: 'automatic', valueType: 'percent', value: 5 });
    const big = d({ id: 'c', kind: 'code', code: 'BIG', valueType: 'percent', value: 15 });
    const small = d({ id: 's', kind: 'code', code: 'SMALL', valueType: 'percent', value: 2 });
    const r1 = priceCart({ lines: [line('a', 10_000_000, 1)], discounts: [auto, big], promoCode: 'BIG', now });
    expect(r1.orderDiscountTotal).toBe(1_500_000);
    expect(r1.explanations.map((e) => e.code)).toContain('PROMO_REPLACED_AUTOMATIC');
    const r2 = priceCart({ lines: [line('a', 10_000_000, 1)], discounts: [auto, small], promoCode: 'SMALL', now });
    expect(r2.orderDiscountTotal).toBe(500_000);
    expect(r2.promo?.reason).toBe('PROMO_NOT_COMBINABLE');
  });

  it('free shipping: threshold and BEPULYETKAZISH code', () => {
    const r = priceCart({ lines: [line('a', 40_000_000, 1)], discounts: [], shipping: { amount: 2_500_000, freeOver: 100_000_000 }, now });
    expect(r.freeShippingRemaining).toBe(60_000_000);
    expect(r.shippingTotal).toBe(2_500_000);
    const r2 = priceCart({ lines: [line('a', 40_000_000, 3)], discounts: [], shipping: { amount: 2_500_000, freeOver: 100_000_000 }, now });
    expect(r2.shippingTotal).toBe(0);
    expect(r2.freeShippingRemaining).toBe(0);
    const fs = d({ id: 'fs', kind: 'code', code: 'BEPULYETKAZISH', valueType: 'free_shipping', value: 0 });
    const r3 = priceCart({ lines: [line('a', 40_000_000, 1)], discounts: [fs], promoCode: 'BEPULYETKAZISH', shipping: { amount: 2_500_000 }, now });
    expect(r3.shippingTotal).toBe(0);
    expect(r3.shippingDiscount).toBe(2_500_000);
    expect(r3.total).toBe(40_000_000);
  });

  it('buy 2 get 1 free discounts the cheapest unit in each group', () => {
    const b = d({ id: 'b', kind: 'automatic', valueType: 'bxgy', value: 100, bxgy: { buy: 2, get: 1 } });
    const r = priceCart({ lines: [line('a', 3_000_000, 2), line('b', 1_000_000, 1), line('c', 500_000, 1)], discounts: [b], now });
    expect(r.productDiscountTotal).toBe(1_000_000); // group: 3m,3m,1m → 1m free; leftover 0.5m
  });

  it('display price surfaces the flash price and badge', () => {
    const flash = d({ id: 'f', kind: 'flash_sale', valueType: 'percent', value: 25, appliesTo: { type: 'products', ids: ['p1'] }, endsAt: '2026-11-20T00:00:00Z' });
    const dp = displayPrice({ productId: 'p1', categoryPath: null, collectionIds: [], unitPrice: 20_000_000 }, [flash], now);
    expect(dp).toEqual({ price: 15_000_000, compareAt: 20_000_000, discountId: 'f', endsAt: '2026-11-20T00:00:00Z' });
    expect(discountPercent(15_000_000, 20_000_000)).toBe(25);
  });
});

describe('pricing pipeline — properties', () => {
  const lineArb = fc.record({
    unitPrice: fc.integer({ min: 0, max: 50_000 }).map((x) => x * 100),
    qty: fc.integer({ min: 1, max: 5 }),
    cat: fc.constantFrom(null, 'a', 'a.b', 'c'),
  });
  const discArb = fc.record({
    kind: fc.constantFrom('automatic', 'flash_sale', 'code') as fc.Arbitrary<'automatic' | 'flash_sale' | 'code'>,
    valueType: fc.constantFrom('percent', 'fixed', 'free_shipping', 'bxgy') as fc.Arbitrary<'percent' | 'fixed' | 'free_shipping' | 'bxgy'>,
    value: fc.integer({ min: 1, max: 100 }),
    fixed: fc.integer({ min: 1, max: 30_000 }).map((x) => x * 100),
    scope: fc.constantFrom('all', 'a', 'c'),
    combO: fc.boolean(),
    combP: fc.boolean(),
    min: fc.option(fc.integer({ min: 0, max: 100_000 }).map((x) => x * 100)),
  });
  it('totals reconcile: total = subtotal − discounts + shipping; Σ lines = merchandise; never negative', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 6 }),
        fc.array(discArb, { maxLength: 5 }),
        fc.integer({ min: 0, max: 50_000 }).map((x) => x * 100),
        fc.option(fc.integer({ min: 0, max: 500_000 }).map((x) => x * 100)),
        (ls, ds, ship, freeOver) => {
          const discounts: DiscountRule[] = ds.map((x, i) =>
            d({
              id: `d${i}`, kind: x.kind, code: x.kind === 'code' ? `C${i}` : null, valueType: x.valueType,
              value: x.valueType === 'fixed' ? x.fixed : x.value, bxgy: { buy: 1, get: 1 },
              appliesTo: x.scope === 'all' ? { type: 'all' } : { type: 'category', paths: [x.scope] },
              combines: { order: x.combO, product: x.combP, shipping: true }, conditions: { minSubtotal: x.min },
            }),
          );
          const codes = discounts.filter((x) => x.code);
          const r = priceCart({
            lines: ls.map((l, i) => line(`l${i}`, l.unitPrice, l.qty, { categoryPath: l.cat })),
            discounts, promoCode: codes[0]?.code ?? null, shipping: { amount: ship, freeOver }, now,
          });
          expect(r.total).toBe(r.subtotal - r.productDiscountTotal - r.orderDiscountTotal + r.shippingTotal);
          expect(r.discountTotal).toBe(r.productDiscountTotal + r.orderDiscountTotal + r.shippingDiscount);
          expect(r.lines.reduce((a, l) => a + l.total, 0)).toBe(r.subtotal - r.productDiscountTotal - r.orderDiscountTotal);
          for (const l of r.lines) {
            expect(l.total).toBeGreaterThanOrEqual(0);
            expect(l.allocations.reduce((a, x) => a + x.amount, 0)).toBe(l.productDiscount + l.orderDiscount);
          }
          expect(r.total).toBeGreaterThanOrEqual(0);
          expect(r.total % 100).toBe(0);
        },
      ),
      { numRuns: 400 },
    );
  });
});

describe('delivery promise', () => {
  const cal = { workingDays: [1, 2, 3, 4, 5, 6], holidays: ['2026-12-08'] };
  const p = (iso: string, extra = {}) =>
    deliveryPromise({ now: new Date(iso), timezone: 'Asia/Tashkent', cutoffTime: '14:00', processingDays: 0, transitMin: 1, transitMax: 1, calendar: cal, ...extra });
  it('before cutoff on a working day ships today → tomorrow', () => {
    // Fri 13 Nov 2026 09:00Z = 14:00 Tashkent? no: 09:00Z = 14:00 local → exactly cutoff → next day
    expect(p('2026-11-13T08:59:00Z')).toEqual({ startsOn: '2026-11-13', from: '2026-11-14', to: '2026-11-14' });
  });
  it('after cutoff starts next working day, skipping Sunday', () => {
    expect(p('2026-11-14T10:00:00Z')).toEqual({ startsOn: '2026-11-16', from: '2026-11-17', to: '2026-11-17' });
  });
  it('skips holidays and spans a range', () => {
    const r = p('2026-12-07T05:00:00Z', { transitMin: 1, transitMax: 3 });
    expect(r.startsOn).toBe('2026-12-07');
    expect(r.from).toBe('2026-12-09'); // 8th is a holiday
    expect(r.to).toBe('2026-12-11');
  });
  it('time zone matters: 20:00Z Thursday is already Friday in Tashkent', () => {
    expect(p('2026-11-12T20:00:00Z').startsOn).toBe('2026-11-13');
  });
});

describe('shipping & installments', () => {
  it('rates and zone matching', () => {
    expect(rateAmount({ calc: 'flat', amount: 2_000_000 }, 5_000)).toBe(2_000_000);
    expect(rateAmount({ calc: 'weight', amount: 2_000_000, perKg: 300_000 }, 3_200)).toBe(2_900_000);
    const zones = [
      { id: 'tk', regions: ['UZ-TK'], districts: [] },
      { id: 'yun', regions: [], districts: ['TK-YUN'] },
      { id: 'rest', regions: [], districts: [] },
    ];
    expect(matchZone(zones, 'UZ-TK', 'TK-YUN')?.id).toBe('yun');
    expect(matchZone(zones, 'UZ-TK')?.id).toBe('tk');
    expect(matchZone(zones, 'UZ-SA')?.id).toBe('rest');
  });
  it('installments show the honest total payable', () => {
    expect(installment(240_000_000, { months: 6, markupPercent: 3 })).toEqual({ monthly: 41_200_000, totalPayable: 247_200_000 });
    expect(installment(100_000, { months: 3, markupPercent: 0 }).monthly).toBe(33_400);
  });
});

describe('variants', () => {
  const opts = [
    { id: 'size', name: 'Size', values: [{ id: 'S', label: 'S' }, { id: 'M', label: 'M' }] },
    { id: 'color', name: 'Rang', values: [{ id: 'red', label: 'Qizil' }, { id: 'blue', label: 'Koʻk' }] },
  ];
  it('cartesian and limits', () => {
    expect(cartesian(opts)).toEqual([['S', 'red'], ['S', 'blue'], ['M', 'red'], ['M', 'blue']]);
    expect(cartesian([])).toEqual([[]]);
    const four = [...opts, { id: 'a', name: 'a', values: [{ id: 'x', label: 'x' }] }, { id: 'b', name: 'b', values: [{ id: 'y', label: 'y' }] }];
    expect(() => cartesian(four)).toThrow(DomainError);
    const big = [0, 1, 2].map((i) => ({ id: `o${i}`, name: 'o', values: Array.from({ length: 13 }, (_, k) => ({ id: `${i}-${k}`, label: `${k}` })) }));
    expect(() => cartesian(big)).toThrow(/2048/);
  });
  it('plans regeneration keeping existing combos', () => {
    const plan = planVariantMatrix(opts, [{ id: 'v1', optionValueIds: ['S', 'red'] }, { id: 'v9', optionValueIds: ['XL', 'red'] }]);
    expect(plan.keep).toEqual(['v1']);
    expect(plan.remove).toEqual(['v9']);
    expect(plan.create).toHaveLength(3);
  });
  it('availability matrix dims sold-out and missing combos', () => {
    const vs = [
      { id: '1', optionValueIds: ['S', 'red'], available: 3, trackInventory: true, allowBackorder: false },
      { id: '2', optionValueIds: ['S', 'blue'], available: 0, trackInventory: true, allowBackorder: false },
      { id: '3', optionValueIds: ['M', 'red'], available: 0, trackInventory: true, allowBackorder: true },
    ];
    const st = valueStates(opts, vs, ['S', null]);
    expect(st[1]).toEqual({ red: 'available', blue: 'sold_out' });
    const st2 = valueStates(opts, vs, ['M', null]);
    expect(st2[1]).toEqual({ red: 'available', blue: 'unavailable' });
    expect(findVariant(vs, ['M', 'red'])?.id).toBe('3');
    expect(findVariant(vs, ['M', null])).toBeUndefined();
  });
});

describe('order state machine', () => {
  it('happy paths: prepaid courier and COD pickup', () => {
    let s = transitionOrder('pending_payment', 'pay', 'provider', 'delivery');
    expect(s.effects).toContain('commit_reservation');
    s = transitionOrder(s.to, 'confirm', 'staff', 'delivery');
    s = transitionOrder(s.to, 'pack', 'staff', 'delivery');
    s = transitionOrder(s.to, 'ship', 'staff', 'delivery');
    s = transitionOrder(s.to, 'deliver', 'staff', 'delivery');
    expect(transitionOrder(s.to, 'complete', 'system', 'delivery').to).toBe('completed');
    const p = transitionOrder('confirmed', 'ready_for_pickup', 'staff', 'pickup');
    expect(p.effects).toContain('generate_pickup_code');
    expect(() => transitionOrder('confirmed', 'ship', 'staff', 'pickup')).toThrow(DomainError);
  });
  it('buyers can cancel only before confirmation; paid cancels refund and restock', () => {
    expect(() => transitionOrder('confirmed', 'cancel', 'buyer', 'delivery')).toThrow(/Cannot cancel/);
    const c = transitionOrder('paid', 'cancel', 'buyer', 'delivery', { paid: true });
    expect(c.effects).toEqual(expect.arrayContaining(['refund', 'restock']));
    expect(c.effects).not.toContain('release_reservation');
    const c2 = transitionOrder('pending_payment', 'cancel', 'system', 'delivery');
    expect(c2.effects).toContain('release_reservation');
    expect(c2.effects).not.toContain('refund');
  });
  it('EXHAUSTIVE: every (status, event, actor, fulfilment) is either in the table or rejected', () => {
    const actors = ['buyer', 'staff', 'system', 'provider'] as const;
    let allowed = 0, rejected = 0;
    for (const st of ORDER_STATUSES)
      for (const ev of Object.keys(ORDER_TRANSITIONS) as OrderEvent[])
        for (const a of actors)
          for (const f of ['delivery', 'pickup'] as const) {
            const def = ORDER_TRANSITIONS[ev].find((t) => t.from.includes(st) && t.actors.includes(a) && (!t.fulfilment || t.fulfilment === f));
            if (def) {
              expect(transitionOrder(st, ev, a, f).to).toBe(def.to);
              allowed++;
            } else {
              expect(() => transitionOrder(st, ev, a, f)).toThrow(DomainError);
              rejected++;
            }
          }
    expect(allowed).toBeGreaterThan(30);
    expect(rejected).toBeGreaterThan(300);
    for (const terminal of ['cancelled', 'returned'] as const) expect(allowedEvents(terminal, 'staff', 'delivery')).toEqual([]);
    expect(allowedEvents('paid', 'staff', 'delivery')[0]).toBe('confirm');
  });
  it('payment transitions are idempotent and Payme states map both ways', () => {
    expect(transitionPayment('pending', 'paid')).toBe('paid');
    expect(transitionPayment('paid', 'paid')).toBe('paid');
    expect(() => transitionPayment('cancelled', 'paid')).toThrow();
    for (const st of [1, 2, -1, -2]) expect(statusToPaymeState(paymeStateToStatus(st))).toBe(st);
  });
});

describe('inventory — property', () => {
  it('random place/pay/cancel/expire/adjust sequences never oversell', () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('place' as const), q: fc.integer({ min: 1, max: 5 }) }),
      fc.record({ k: fc.constantFrom('pay' as const, 'cancel' as const, 'expire' as const), i: fc.nat(20) }),
      fc.record({ k: fc.constant('adjust' as const), q: fc.integer({ min: -10, max: 10 }) }),
      fc.record({ k: fc.constant('return' as const), q: fc.integer({ min: 1, max: 3 }) }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.array(op, { maxLength: 60 }), (start, ops) => {
        let l: StockLevel = { onHand: start, reserved: 0 };
        const open: number[] = [];
        for (const o of ops) {
          try {
            if (o.k === 'place') (l = reserve(l, o.q)), open.push(o.q);
            else if (o.k === 'adjust') l = adjustStock(l, o.q);
            else if (o.k === 'return') l = restock(l, o.q);
            else if (open.length) {
              const q = open.splice(o.i % open.length, 1)[0]!;
              l = o.k === 'pay' ? commitReservation(l, q) : releaseReservation(l, q);
            }
          } catch (e) {
            expect(['OUT_OF_STOCK', 'VALIDATION']).toContain((e as DomainError).code);
          }
          expect(available(l)).toBeGreaterThanOrEqual(0);
          expect(l.onHand).toBeGreaterThanOrEqual(0);
          expect(l.reserved).toBe(open.reduce((a, b) => a + b, 0));
        }
      }),
      { numRuns: 300 },
    );
  });
});
