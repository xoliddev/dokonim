import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLedger } from '../src';
import { ADAPTERS, ADDRESS, seedStore, setup, variantProduct, type H } from './harness';

/** Regression tests for the backend review findings. */
describe.each(ADAPTERS)('review fixes on $name', ({ make }) => {
  let h: H;
  let ctx: Awaited<ReturnType<typeof seedStore>>;
  beforeAll(async () => {
    h = await setup(make);
    ctx = await seedStore(h, 'review-fixes');
  });
  afterAll(() => h.close());

  const slug = () => ctx.store.slug;
  const variant = (k = 0) => ctx.product.variants[k]!;
  let n = 0;
  const place = async (paymentMethod: string, k = 0, qty = 1, promo?: string) => {
    const buyer = await h.user(`Buyer${++n}`);
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(k).id, qty });
    if (promo) await h.m['cart.applyPromo'](buyer, { slug: slug(), code: promo });
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    const m = q.shippingOptions.find((o) => o.type === 'courier')!;
    const r = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: `rf-${n}`, contact: { name: 'X', phone: '+998901112233' }, methodId: m.methodId, address: ADDRESS, paymentMethod: paymentMethod as 'payme' });
    return { buyer, ...r, paymentId: (r.nextAction as { paymentId?: string }).paymentId! };
  };

  it('a webhook of one provider/mode cannot settle a payment that belongs to another (#7)', async () => {
    const { order, paymentId } = await place('payme');
    await h.db.query(`update payments set mode = 'live' where id = $1`, [paymentId]);
    const click = sqlLedger(h.be.ctx, ctx.store.id, { provider: 'click', mode: 'sandbox' });
    const pay = await h.db.query<{ amount: number }>('select amount from payments where id = $1', [paymentId]);
    expect(await click.checkPayable({ orderId: order.id }, pay[0]!.amount)).toMatchObject({ ok: false, reason: 'not_payable' });
    const paymeSandbox = sqlLedger(h.be.ctx, ctx.store.id, { provider: 'payme', mode: 'sandbox' });
    expect(await paymeSandbox.checkPayable({ orderId: order.id }, pay[0]!.amount)).toMatchObject({ ok: false, reason: 'not_payable' });
    const paymeLive = sqlLedger(h.be.ctx, ctx.store.id, { provider: 'payme', mode: 'live' });
    expect(await paymeLive.checkPayable({ orderId: order.id }, pay[0]!.amount)).toMatchObject({ ok: true });
  });

  it('sandbox.pay refuses a cancelled sandbox payment after a switch to another provider (#7 path B)', async () => {
    const { buyer, order, paymentId } = await place('click');
    await h.m['orders.retryPayment'](buyer, { slug: slug(), id: order.id, provider: 'payme' });
    await expect(h.m['sandbox.pay'](buyer, { slug: slug(), paymentId, scenario: 'success' })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await h.m['orders.get'](buyer, { slug: slug(), id: order.id })).paymentStatus).not.toBe('paid');
  });

  it('a Stars (XTR) payment cannot be paid through a UZS provider (#9)', async () => {
    const { order, paymentId } = await place('payme');
    // the row a Stars order carries: amount = star count, currency XTR
    await h.db.query(`update payments set provider = 'stars', currency = 'XTR', amount = 1000 where id = $1`, [paymentId]);
    const payme = sqlLedger(h.be.ctx, ctx.store.id, { provider: 'payme', mode: 'sandbox' });
    expect(await payme.checkPayable({ orderId: order.id }, 1000)).toMatchObject({ ok: false, reason: 'not_payable' });
    await h.db.query(`update payments set provider = 'payme' where id = $1`, [paymentId]);
    expect(await payme.checkPayable({ orderId: order.id }, 1000)).toMatchObject({ ok: false, reason: 'not_payable' });
    const stars = sqlLedger(h.be.ctx, ctx.store.id, { provider: 'stars', mode: 'sandbox' });
    await h.db.query(`update payments set provider = 'stars' where id = $1`, [paymentId]);
    expect(await stars.checkPayable({ orderId: order.id }, 1000)).toMatchObject({ ok: true });
  });

  it('the reservation job never cancels an order that got paid (#16)', async () => {
    const { buyer, order, paymentId } = await place('payme', 2);
    expect((await h.m['sandbox.pay'](buyer, { slug: slug(), paymentId, scenario: 'success' })).status).toBe('paid');
    h.clock.advance(31 * 60_000);
    await h.m['jobs.expireReservations']({} as never, {} as never);
    expect(await h.m['orders.get'](buyer, { slug: slug(), id: order.id })).toMatchObject({ status: 'paid', paymentStatus: 'paid' });
  });

  it('saving a product applies only the editor stock change, keeping sales made meanwhile (#17/#26)', async () => {
    const input = variantProduct(ctx.store.id, null, { title: 'Stock base', stock: 5 });
    const p = await h.m['admin.products.save'](ctx.owner, input);
    const vid = input.variants[0]!.id;
    await h.m['admin.inventory.adjust'](ctx.owner, { storeId: ctx.store.id, variantId: vid, delta: -1, reason: 'adjustment' }); // a sale while the editor is open
    const again = (stock: number) => ({ ...input, id: p.id, variants: input.variants.map((v) => ({ ...v, stock: v.id === vid ? stock : v.stock, stockBase: 5 })) });
    await h.m['admin.products.save'](ctx.owner, again(5));
    const onHand = async () => (await h.m['admin.products.get'](ctx.owner, { storeId: ctx.store.id, id: p.id })).variants.find((v) => v.id === vid)!.stock;
    expect(await onHand()).toBe(4);
    await h.m['admin.products.save'](ctx.owner, again(7));
    expect(await onHand()).toBe(6);
  });

  it('an order operator cannot refund a paid order through cancel, in the API or the bot (#10)', async () => {
    const inv = await h.m['admin.staff.invite'](ctx.owner, { storeId: ctx.store.id, role: 'order_operator' });
    const op = await h.user('Operator');
    await h.m['invites.accept'](op, { token: inv.token });
    const { buyer, order, paymentId } = await place('payme', 3);
    await h.m['sandbox.pay'](buyer, { slug: slug(), paymentId, scenario: 'success' });
    await expect(h.m['admin.orders.transition'](op, { storeId: ctx.store.id, id: order.id, event: 'cancel' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await h.m['bot.orderAction'](op, { orderId: order.id, action: 'cancel' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await h.m['admin.orders.transition'](op, { storeId: ctx.store.id, id: order.id, event: 'confirm' })).status).toBe('confirmed');
    // an unpaid COD order can still be cancelled by the operator
    const cod = await place('cod', 3);
    expect((await h.m['admin.orders.transition'](op, { storeId: ctx.store.id, id: cod.order.id, event: 'cancel' })).status).toBe('cancelled');
  });

  it('buyer phones and addresses are masked for roles without orders.manage (#11)', async () => {
    const inv = await h.m['admin.staff.invite'](ctx.owner, { storeId: ctx.store.id, role: 'viewer' });
    const viewer = await h.user('Viewer');
    await h.m['invites.accept'](viewer, { token: inv.token });
    const { order } = await place('cod', 0);
    const dash = await h.m['admin.dashboard'](viewer, { storeId: ctx.store.id });
    expect(JSON.stringify(dash.recent)).not.toContain('+998901112233');
    const list = await h.m['admin.orders.list'](viewer, { storeId: ctx.store.id });
    expect(JSON.stringify(list.items)).not.toContain('+998901112233');
    expect((await h.m['admin.orders.list'](viewer, { storeId: ctx.store.id, q: '901112233' })).items).toHaveLength(0);
    const got = await h.m['admin.orders.get'](viewer, { storeId: ctx.store.id, id: order.id });
    expect(JSON.stringify(got)).not.toContain('+998901112233');
    expect(JSON.stringify(got)).not.toContain('Amir Temur');
    const owner = await h.m['admin.orders.get'](ctx.owner, { storeId: ctx.store.id, id: order.id });
    expect((owner.contact as { phone: string }).phone).toBe('+998901112233');
  });

  it('a free-shipping discount is not counted again in the stored discount_total (#18)', async () => {
    await h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Bepul', code: 'BEPUL', valueType: 'free_shipping', value: 0, appliesTo: { type: 'all' }, combines: { order: true, product: true, shipping: true } });
    const { order } = await place('cod', 1, 1, 'BEPUL');
    expect(order.shippingTotal).toBe(0);
    expect(order.discountTotal).toBe(0);
    expect(order.subtotal - order.discountTotal + order.shippingTotal).toBe(order.total);
  });

  it('concurrent checkouts never push a code past its usage limit (#19)', async () => {
    const d = await h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Bir marta', code: 'ONCE1', valueType: 'percent', value: 10, appliesTo: { type: 'all' }, usageLimit: 1, combines: { order: true, product: true, shipping: true } });
    const results = await Promise.allSettled([place('cod', 0, 1, 'ONCE1'), place('cod', 0, 1, 'ONCE1')]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const [row] = await h.db.query<{ usedCount: number }>('select used_count from discounts where id = $1', [(d as { id: string }).id]);
    expect(row!.usedCount).toBeLessThanOrEqual(1);
  });

  it('a total that changed since the buyer saw it fails with PRICE_CHANGED (#20)', async () => {
    const buyer = await h.user('Expected');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(1).id, qty: 1 });
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    const m = q.shippingOptions.find((o) => o.type === 'courier')!;
    const quoted = (await h.m['checkout.quote'](buyer, { slug: slug(), methodId: m.methodId, region: 'UZ-TK' })).cart.pricing.total;
    const input = { slug: slug(), idempotencyKey: 'expected-1', contact: { name: 'X', phone: '+998901112233' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod' as const };
    await expect(h.m['orders.place'](buyer, { ...input, expectedTotal: quoted - 8_000_000 })).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect((await h.m['orders.place'](buyer, { ...input, expectedTotal: quoted })).order.total).toBe(quoted);
  });

  it('moving a category refreshes the search docs of the moved subtree (#27)', async () => {
    const erkaklar = await h.m['admin.categories.create'](ctx.owner, { storeId: ctx.store.id, parentId: null, name: { uz: 'Erkaklar' } });
    await h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: ctx.cats.koylak.id, parentId: erkaklar.id, index: 0 });
    const [p] = await h.db.query<{ searchDoc: string }>('select search_doc from products where id = $1', [ctx.product.id]);
    expect(p!.searchDoc.toLowerCase()).toContain('erkaklar');
    expect(p!.searchDoc.toLowerCase()).not.toContain('ayollar');
  });

  it('a deleted promo code can be created again (#28)', async () => {
    const save = () => h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Bayram', code: 'BAYRAM10', valueType: 'percent', value: 10, appliesTo: { type: 'all' } });
    const first = (await save()) as { id: string };
    await expect(save()).rejects.toMatchObject({ code: 'CONFLICT' });
    await h.m['admin.discounts.delete'](ctx.owner, { storeId: ctx.store.id, id: first.id });
    const again = (await save()) as { id: string };
    expect(again.id).not.toBe(first.id);
  });

  it('two concurrent rotations of one refresh token never both succeed (#6/#13)', async () => {
    const u = await h.user('Rotate');
    const { token } = await h.m['auth.issueRefresh']({} as never, { userId: u.userId! });
    const results = await Promise.allSettled([h.m['auth.rotateRefresh']({} as never, { token }), h.m['auth.rotateRefresh']({} as never, { token })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'UNAUTHENTICATED' } });
    // reuse revoked the family, including the token the winner got
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ token: string }>).value.token;
    await expect(h.m['auth.rotateRefresh']({} as never, { token: winner })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('unsuspend restores the earlier status and never reopens a closed store (#15)', async () => {
    const admin = { ...(await h.user('PlatformAdmin')), isPlatformAdmin: true };
    const owner = await h.user('DraftOwner');
    const { store } = await h.m['stores.create'](owner, { name: 'Draft shop', slug: 'draft-shop-rf', businessType: 'clothing' });
    const status = async () => (await h.db.query<{ status: string }>('select status from stores where id = $1', [store.id]))[0]!.status;
    await h.db.query(`update stores set status = 'draft' where id = $1`, [store.id]);
    await expect(h.m['platform.suspend'](admin, { storeId: store.id, suspended: false })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await h.m['platform.suspend'](admin, { storeId: store.id, suspended: true, reason: 'spam' });
    expect(await status()).toBe('suspended');
    await h.m['platform.suspend'](admin, { storeId: store.id, suspended: false });
    expect(await status()).toBe('draft');
    await h.db.query(`update stores set status = 'closed' where id = $1`, [store.id]);
    await expect(h.m['platform.suspend'](admin, { storeId: store.id, suspended: true })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await status()).toBe('closed');
  });

  it('a first order that expired unpaid does not use up a first-order promo (#22)', async () => {
    await h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Xush kelibsiz', code: 'WELCOME', valueType: 'percent', value: 10, appliesTo: { type: 'all' }, conditions: { firstOrder: true }, combines: { order: true, product: true, shipping: true } });
    const { buyer, order } = await place('payme', 2, 1, 'WELCOME');
    h.clock.advance(31 * 60_000);
    await h.m['jobs.expireReservations']({} as never, {} as never);
    expect((await h.m['orders.get'](buyer, { slug: slug(), id: order.id })).status).toBe('cancelled');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(2).id, qty: 1 });
    expect((await h.m['cart.applyPromo'](buyer, { slug: slug(), code: 'WELCOME' })).promo).toMatchObject({ status: 'applied' });
  });

  it('weight-based shipping ignores unavailable cart lines (#23)', async () => {
    const w = await seedStore(h, 'weight-rf');
    await h.db.query(`update shipping_rates set calc = 'weight', amount = 2000000, per_kg = 500000 where store_id = $1`, [w.store.id]);
    const heavyIn = variantProduct(w.store.id, null, { title: 'Ogʻir', stock: 5 });
    heavyIn.variants = heavyIn.variants.map((v) => ({ ...v, weightG: 5000 }));
    const heavy = await h.m['admin.products.save'](w.owner, heavyIn);
    const buyer = await h.user('Weight');
    await h.m['cart.setItem'](buyer, { slug: 'weight-rf', variantId: heavy.variants[0]!.id as string, qty: 1 });
    await h.m['cart.setItem'](buyer, { slug: 'weight-rf', variantId: w.product.variants[0]!.id as string, qty: 1 });
    await h.m['admin.products.bulk'](w.owner, { storeId: w.store.id, ids: [heavy.id], action: 'archive' });
    const q = await h.m['checkout.quote'](buyer, { slug: 'weight-rf', region: 'UZ-TK' });
    expect(q.shippingOptions.find((o) => o.type === 'courier')!.amount).toBe(2_000_000);
  });

  it('a prepaid order whose discounts bring the total to 0 is settled at placement (#24)', async () => {
    await h.m['admin.discounts.save'](ctx.owner, { storeId: ctx.store.id, kind: 'code', title: 'Hammasi', code: 'FREE100', valueType: 'fixed', value: 100_000_000, appliesTo: { type: 'all' }, combines: { order: true, product: true, shipping: true } });
    const buyer = await h.user('ZeroTotal');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(3).id, qty: 1 });
    await h.m['cart.applyPromo'](buyer, { slug: slug(), code: 'FREE100' });
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    const pickup = q.shippingOptions.find((o) => o.type === 'self_pickup')!;
    const r = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'zero-total-1', contact: { name: 'Z', phone: '+998901112233' }, methodId: pickup.methodId, pickupPointId: pickup.pickupPoints[0]?.id, paymentMethod: 'payme' });
    expect(r.order.total).toBe(0);
    expect(r.order).toMatchObject({ status: 'paid', paymentStatus: 'paid' });
    expect(r.nextAction.type).toBe('none');
  });

  it('cancelling a backorder sale restocks only the units it really took (#25)', async () => {
    const input = variantProduct(ctx.store.id, null, { title: 'Backorder', stock: 2 });
    input.options = [];
    input.variants = [{ ...input.variants[0]!, optionValueIds: [], allowBackorder: true }];
    const p = await h.m['admin.products.save'](ctx.owner, input);
    const vid = p.variants[0]!.id as string;
    const buyer = await h.user('Backorder');
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: vid, qty: 5 });
    const q = await h.m['checkout.quote'](buyer, { slug: slug(), region: 'UZ-TK' });
    const m = q.shippingOptions.find((o) => o.type === 'courier')!;
    const { order } = await h.m['orders.place'](buyer, { slug: slug(), idempotencyKey: 'backorder-1', contact: { name: 'B', phone: '+998901112233' }, methodId: m.methodId, address: ADDRESS, paymentMethod: 'cod' });
    const t = (event: string) => h.m['admin.orders.transition'](ctx.owner, { storeId: ctx.store.id, id: order.id, event: event as 'confirm' });
    await t('confirm');
    const onHand = async () => (await h.db.query<{ onHand: number }>('select on_hand from inventory_levels where variant_id = $1', [vid]))[0]!.onHand;
    expect(await onHand()).toBe(0);
    await t('cancel');
    expect(await onHand()).toBe(2);
  });

  it('deleting with reparent_children puts the children in the deleted node\'s slot (#29)', async () => {
    const mk = (name: string, parentId: string | null) => h.m['admin.categories.create'](ctx.owner, { storeId: ctx.store.id, parentId, name: { uz: name } });
    const top = await mk('Tepa', null);
    const kiyim = await mk('Kiyim', top.id);
    const poyabzal = await mk('Poyabzal', top.id);
    const aksessuar = await mk('Aksessuar', top.id);
    const kids = [await mk('Krossovka', poyabzal.id), await mk('Tufli', poyabzal.id), await mk('Etik', poyabzal.id), await mk('Shippak', poyabzal.id)];
    await h.m['admin.categories.delete'](ctx.owner, { storeId: ctx.store.id, id: poyabzal.id, strategy: { kind: 'reparent_children' } });
    const rows = await h.db.query<{ id: string }>('select id from categories where parent_id = $1 order by position, slug', [top.id]);
    expect(rows.map((r) => r.id)).toEqual([kiyim.id, ...kids.map((k) => k.id), aksessuar.id]);
  });

  it('a bulk price rise clears old prices that are no longer above the price (#30)', async () => {
    const input = variantProduct(ctx.store.id, null, { title: 'Bulk', price: 100_000_000 });
    input.variants = input.variants.map((v) => ({ ...v, compareAtPrice: 120_000_000 }));
    const p = await h.m['admin.products.save'](ctx.owner, input);
    await h.m['admin.products.bulk'](ctx.owner, { storeId: ctx.store.id, ids: [p.id], action: 'adjust_price', params: { percent: 30 } });
    const rows = await h.db.query<{ price: number; compareAtPrice: number | null }>('select price, compare_at_price from product_variants where product_id = $1', [p.id]);
    for (const r of rows) expect(r.compareAtPrice === null || r.compareAtPrice > r.price).toBe(true);
    await h.m['admin.products.bulk'](ctx.owner, { storeId: ctx.store.id, ids: [p.id], action: 'adjust_price', params: { percent: -50 } });
    expect((await h.db.query<{ compareAtPrice: number | null }>('select compare_at_price from product_variants where product_id = $1', [p.id]))[0]!.compareAtPrice).toBeNull();
  });
});
