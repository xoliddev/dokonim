import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@dokonim/core';
import { ADAPTERS, ADDRESS, seedStore, setup, variantProduct, type H } from './harness';

describe.each(ADAPTERS)('commerce on $name', ({ make }) => {
  let h: H;
  let ctx: Awaited<ReturnType<typeof seedStore>>;
  beforeAll(async () => {
    h = await setup(make);
    ctx = await seedStore(h, 'commerce-test');
  });
  afterAll(() => h.close());

  const slug = () => ctx.store.slug;
  const courier = async (buyer: Parameters<H['m']['checkout.quote']>[0]) => {
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    return q.shippingOptions.find((o) => o.type === 'courier')!;
  };
  const variant = (k = 0) => ctx.product.variants[k]!;
  const level = async (variantId: string) => {
    const inv = await h.m['admin.inventory.list'](ctx.owner, { storeId: ctx.store.id });
    return inv.find((r) => r.variantId === variantId) as unknown as { onHand: number; reserved: number; available: number };
  };

  it('cart: add, stock guard, quantity edit, free-delivery nudge', async () => {
    const buyer = await h.user('Sardor');
    const c1 = await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 2 });
    expect(c1.count).toBe(2);
    expect(c1.pricing.subtotal).toBe(90_000_000);
    expect(c1.pricing.freeShippingRemaining).toBe(10_000_000);
    await expect(h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 50 })).rejects.toMatchObject({ code: 'OUT_OF_STOCK', details: { available: 5 } });
    const c2 = await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 0 });
    expect(c2.items).toHaveLength(0);
  });

  it('promo codes: rejected with a reason, then applied and redeemed once', async () => {
    const buyer = await h.user('Aziza');
    await h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Salom', code: 'salom10', valueType: 'percent', value: 10, appliesTo: { type: 'all' }, conditions: { minSubtotal: 50_000_000 }, combines: { order: true, product: true, shipping: true } });
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(1).id, qty: 1 });
    const r1 = await h.m['cart.applyPromo'](buyer, { slug: slug(), code: 'SALOM10' });
    expect(r1.promo?.status).toBe('rejected');
    expect(r1.explanation).toMatchObject({ code: 'PROMO_MIN_SUBTOTAL', params: { missing: 5_000_000 } });
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(1).id, qty: 2 });
    const r2 = await h.m['cart.applyPromo'](buyer, { slug: slug(), code: 'salom10' });
    expect(r2.promo?.status).toBe('applied');
    expect(r2.cart.pricing.orderDiscountTotal).toBe(9_000_000);
    const m = await courier(buyer);
    const placed = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: uuidv7(), contact: { name: 'Aziza', phone: '+998901234567' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod' });
    expect(placed.order.discountTotal).toBe(9_000_000);
    expect(placed.order.status).toBe('awaiting_confirmation');
    const ds = await h.m['admin.discounts.list'](ctx.owner, { storeId: ctx.store.id });
    expect((ds.find((d) => (d as { code: string }).code === 'SALOM10') as { usedCount: number }).usedCount).toBe(1);
  });

  it('COD: reserve → confirm commits stock → ship → deliver → complete; owner gets outbox messages', async () => {
    const buyer = await h.user('Bekzod');
    const before = await level(variant(2).id);
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(2).id, qty: 2 });
    const m = await courier(buyer);
    const { order, nextAction } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'k-cod-1', contact: { name: 'Bekzod', phone: '+998 90 111 22 33' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod', note: 'Qoʻngʻiroq qiling' });
    expect(nextAction.type).toBe('none');
    expect(order.deliveryPromise).toBeTruthy();
    let lv = await level(variant(2).id);
    expect(lv.reserved).toBe(before.reserved + 2);
    expect(lv.onHand).toBe(before.onHand);
    const t = (event: string, extra = {}) => h.m['admin.orders.transition'](ctx.owner, { storeId: ctx.store.id, id: order.id, event: event as 'confirm', ...extra });
    await expect(t('ship')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const c = await t('confirm');
    expect(c.status).toBe('confirmed');
    lv = await level(variant(2).id);
    expect(lv.onHand).toBe(before.onHand - 2);
    expect(lv.reserved).toBe(before.reserved);
    await t('pack');
    const shipped = await t('ship', { trackingNumber: 'UZ123' });
    expect(shipped.shipments).toHaveLength(1);
    const delivered = await t('deliver');
    expect(delivered.paymentStatus).toBe('paid');
    h.clock.advance(8 * 86_400_000);
    expect((await h.m['jobs.autoComplete'](h.be.methods as never, {} as never)).completed).toBeGreaterThanOrEqual(1);
    const got = await h.m['orders.get'](buyer, { slug: slug(), id: order.shortId });
    expect(got.status).toBe('completed');
    expect(got.events.map((e) => (e as { toStatus: string }).toStatus).filter(Boolean)).toEqual(['awaiting_confirmation', 'confirmed', 'packing', 'shipped', 'delivered', 'completed']);
    const msgs = await h.m['outbox.claim']({} as never, { limit: 100 });
    const topics = msgs.filter((x) => x.payload.topic.startsWith('order')).map((x) => `${x.recipient.kind}:${x.payload.topic}`);
    expect(topics).toEqual(expect.arrayContaining(['owner:order.placed', 'buyer:order.placed', 'buyer:order.status_changed']));
    // verified review only after delivery, once per item
    const pend = await h.m['reviews.pending'](buyer, { slug: slug() });
    expect(pend).toHaveLength(1);
    await h.m['reviews.create'](buyer, { slug: slug(), orderItemId: (pend[0] as { orderItemId: string }).orderItemId, rating: 5, text: 'Juda chiroyli, mato sifatli!' });
    await expect(h.m['reviews.create'](buyer, { slug: slug(), orderItemId: (pend[0] as { orderItemId: string }).orderItemId, rating: 4 })).rejects.toMatchObject({ code: 'REVIEW_NOT_ALLOWED' });
    const pdp = await h.m['store.product'](buyer, { slug: slug(), id: ctx.product.id });
    expect(pdp.product.ratingCount).toBe(1);
  });

  it('idempotency: replaying the same key returns the same order', async () => {
    const buyer = await h.user('Kamol');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(3).id, qty: 1 });
    const m = await courier(buyer);
    const input = { slug: slug(), idempotencyKey: 'same-key', contact: { name: 'Kamol', phone: '+998931112233' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod' as const };
    const a = await h.m['orders.place'](buyer, input);
    const b = await h.m['orders.place'](buyer, input);
    expect(b.order.id).toBe(a.order.id);
    expect(b.replayed).toBe(true);
    await h.m['orders.cancel'](buyer, { slug: slug(), id: a.order.id });
  });

  it('validation: phone format, address required, empty cart, wrong payment method', async () => {
    const buyer = await h.user('Nodira');
    await expect(h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'e1', contact: { name: 'N', phone: '+998' }, methodId: null, paymentMethod: 'cod' })).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'phone' } });
    await expect(h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'e2', contact: { name: 'N', phone: '+998901112233' }, methodId: null, paymentMethod: 'cod' })).rejects.toMatchObject({ code: 'CART_EMPTY' });
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 1 });
    const m = await courier(buyer);
    await expect(h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'e3', contact: { name: 'N', phone: '+998901112233' }, methodId: m.methodId, address: null, paymentMethod: 'cod' })).rejects.toMatchObject({ details: { field: 'address' } });
    await expect(h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'e4', contact: { name: 'N', phone: '+998901112233' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'stars' })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 0 });
  });

  it('Payme sandbox: real JSON-RPC handshake marks the order paid and commits stock', async () => {
    const buyer = await h.user('Jasur');
    const before = await level(variant(1).id);
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(1).id, qty: 1 });
    const m = await courier(buyer);
    const { order, nextAction } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'payme-1', contact: { name: 'Jasur', phone: '+998977777777' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'payme' });
    expect(order.status).toBe('pending_payment');
    expect(nextAction.type).toBe('sandbox');
    const paymentId = (nextAction as { paymentId: string }).paymentId;
    const res = await h.m['sandbox.pay'](buyer, { slug: slug(), paymentId, scenario: 'success' });
    expect(res.status).toBe('paid');
    expect(res.messages.map((x) => `${x.direction}:${x.label}`)).toEqual(expect.arrayContaining(['request:CheckPerformTransaction', 'request:CreateTransaction', 'request:PerformTransaction']));
    const o = await h.m['orders.get'](buyer, { slug: slug(), id: order.id });
    expect(o.status).toBe('paid');
    expect(o.paymentStatus).toBe('paid');
    const lv = await level(variant(1).id);
    expect(lv.onHand).toBe(before.onHand - 1);
    expect(lv.reserved).toBe(before.reserved);
    const events = await h.m['admin.payments.events'](ctx.owner, { storeId: ctx.store.id });
    expect(events.length).toBeGreaterThanOrEqual(3);
    // owner cancels a paid order → refund + restock
    const cancelled = await h.m['admin.orders.transition'](ctx.owner, { storeId: ctx.store.id, id: order.id, event: 'cancel', reason: 'Mijoz soʻrovi' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.paymentStatus).toBe('refunded');
    expect((await level(variant(1).id)).onHand).toBe(before.onHand);
  });

  it('Click sandbox: md5-signed prepare/complete, duplicate complete is idempotent, bad signature rejected', async () => {
    const buyer = await h.user('Malika');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 1 });
    const m = await courier(buyer);
    const { order, nextAction } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'click-1', contact: { name: 'Malika', phone: '+998935555555' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'click' });
    const pid = (nextAction as { paymentId: string }).paymentId;
    const bad = await h.m['sandbox.pay'](buyer, { slug: slug(), paymentId: pid, scenario: 'bad_signature' });
    expect(bad.status).toBe('failed');
    const dup = await h.m['sandbox.pay'](buyer, { slug: slug(), paymentId: pid, scenario: 'duplicate_complete' });
    expect(dup.status).toBe('paid');
    const o = await h.m['orders.get'](buyer, { slug: slug(), id: order.id });
    expect(o.status).toBe('paid');
    expect(o.payments.filter((p) => (p as { status: string }).status === 'paid')).toHaveLength(1);
  });

  it('reservation TTL: unpaid prepaid order is cancelled by the job and stock is released', async () => {
    const buyer = await h.user('Otabek');
    const before = await level(variant(3).id);
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(3).id, qty: 1 });
    const m = await courier(buyer);
    const { order } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'ttl-1', contact: { name: 'Otabek', phone: '+998901010101' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'payme' });
    expect((await level(variant(3).id)).reserved).toBe(before.reserved + 1);
    h.clock.advance(31 * 60_000);
    const r = await h.m['jobs.expireReservations']({} as never, {} as never);
    expect(r.cancelled).toBeGreaterThanOrEqual(1);
    const o = await h.m['orders.get'](buyer, { slug: slug(), id: order.id });
    expect(o.status).toBe('cancelled');
    expect((await level(variant(3).id)).reserved).toBe(before.reserved);
  });

  it('never oversells: two buyers race for the last unit', async () => {
    const p = await h.m['admin.products.save'](ctx.owner, { ...variantProduct(ctx.store.id, null, { title: 'Oxirgi dona', stock: 1 }), options: [], variants: [{ id: uuidv7(), optionValueIds: [], sku: 'LAST', barcode: '', price: 10_000_000, compareAtPrice: null, costPrice: null, weightG: 0, stock: 1, lowStockThreshold: 0, trackInventory: true, allowBackorder: false }] });
    const a = await h.user('A');
    const b = await h.user('B');
    const vid = p.variants[0]!.id;
    await h.m['cart.setItem'](a, { slug: slug(), variantId: vid, qty: 1 });
    await h.m['cart.setItem'](b, { slug: slug(), variantId: vid, qty: 1 });
    const ma = await courier(a);
    const place = (u: typeof a, k: string) => h.m['orders.place'](u, { slug: slug(), idempotencyKey: k, contact: { name: 'X', phone: '+998901234500' }, methodId: ma.methodId, address: ADDRESS, paymentMethod: 'cod' });
    const results = await Promise.allSettled([place(a, 'race-a'), place(b, 'race-b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'OUT_OF_STOCK' } });
    expect((await level(vid)).available).toBe(0);
  });

  it('pickup orders need the 6-digit code to be handed over', async () => {
    const buyer = await h.user('Laylo');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 1 });
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    const pickup = q.shippingOptions.find((o) => o.type === 'self_pickup')!;
    const { order } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'pick-1', contact: { name: 'Laylo', phone: '+998909090909' }, methodId: pickup.methodId, pickupPointId: pickup.pickupPoints[0]?.id, paymentMethod: 'cod' });
    expect(order.fulfilmentKind).toBe('pickup');
    const t = (event: string, extra = {}) => h.m['admin.orders.transition'](ctx.owner, { storeId: ctx.store.id, id: order.id, event: event as 'confirm', ...extra });
    await t('confirm');
    const ready = await t('ready_for_pickup');
    expect(ready.pickupCode).toBeNull(); // staff never sees the code
    const mine = await h.m['orders.get'](buyer, { slug: slug(), id: order.id });
    expect(mine.pickupCode).toMatch(/^\d{6}$/);
    await expect(t('deliver', { pickupCode: '000000' === mine.pickupCode ? '111111' : '000000' })).rejects.toMatchObject({ details: { field: 'pickupCode' } });
    expect((await t('deliver', { pickupCode: mine.pickupCode })).status).toBe('delivered');
  });

  it('reorder puts available items back into the cart', async () => {
    const buyer = await h.user('Reorder');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(0).id, qty: 1 });
    const m = await courier(buyer);
    const { order } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 're-1', contact: { name: 'R', phone: '+998901231231' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod' });
    const r = await h.m['orders.reorder'](buyer, { slug: slug(), id: order.id });
    expect(r.added).toBe(1);
    expect(r.cart.count).toBe(1);
  });

  it('dashboard and analytics aggregate the store', async () => {
    const d = await h.m['admin.dashboard'](ctx.owner, { storeId: ctx.store.id });
    expect(d.sparkline).toHaveLength(7);
    expect(d.queue.toConfirm).toBeGreaterThanOrEqual(0);
    const a = await h.m['admin.analytics'](ctx.owner, { storeId: ctx.store.id, range: '30d' });
    expect(a.orders).toBeGreaterThan(0);
    expect(a.funnel.at(-1)?.step).toBe('purchase');
    const exp = await h.m['admin.export.orders'](ctx.owner, { storeId: ctx.store.id });
    expect(exp.csv.split('\r\n').length).toBeGreaterThan(2);
  });
});
