import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLedger } from '../src';
import { ADAPTERS, ADDRESS, seedStore, setup, type H } from './harness';

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
  const place = async (paymentMethod: string, k = 0, qty = 1) => {
    const buyer = await h.user(`Buyer${++n}`);
    await h.m['cart.setItem'](buyer, { slug: slug(), variantId: variant(k).id, qty });
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
});
