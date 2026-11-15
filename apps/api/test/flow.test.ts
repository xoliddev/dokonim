import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ADAPTERS, ADDRESS, makeApi, placeOrder, seedOverHttp, type Api, type J } from './helpers';
import { deliverOutboxOnce, startWorkers } from '../src/workers';

describe.each(ADAPTERS)('HTTP commerce flow on $name', ({ make }) => {
  let api: Api;
  let seed: Awaited<ReturnType<typeof seedOverHttp>>;
  const slug = 'http-flow';
  beforeAll(async () => {
    api = await makeApi(make, { sse: { pollMs: 40, heartbeatMs: 100, maxMs: 2_500 } });
    seed = await seedOverHttp(api, slug);
  });
  afterAll(() => api.close());

  const variant = (k = 0) => seed.product.variants[k].id as string;

  it('owner builds the store over HTTP: nested category + variant product are visible publicly', async () => {
    expect(seed.child.parentId).toBe(seed.root.id);
    const pub = await api.call('store.get', { slug });
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as J).store.slug).toBe(slug);
    const tree = await api.ok('admin.categories.tree', { storeId: seed.store.id }, seed.owner.token);
    expect(JSON.stringify(tree)).toContain(seed.child.id);
    const search = await api.ok('store.products', { slug, categoryId: seed.root.id }, undefined);
    expect(JSON.stringify(search)).toContain(seed.product.id);
  });

  it('zod validation → 422 VALIDATION with the failing field', async () => {
    const buyer = await api.login('Validator');
    const res = await api.call('cart.setItem', { slug, variantId: variant(), qty: 500 }, buyer.token);
    expect(res.statusCode).toBe(422);
    expect((res.json() as J).error).toMatchObject({ code: 'VALIDATION', details: { field: 'qty' } });
    const bad = await api.call('orders.place', { slug, contact: { name: 'x', phone: '+998901234567' }, methodId: null, address: { ...ADDRESS, regionCode: 'Tashkent' }, paymentMethod: 'cod' }, buyer.token, { 'idempotency-key': 'validation-key-1' });
    expect(bad.statusCode).toBe(422);
    expect((bad.json() as J).error.details.field).toBe('address.regionCode');
    const notUuid = await api.call('admin.store.get', { storeId: 'not-a-uuid' }, seed.owner.token);
    expect(notUuid.statusCode).toBe(422);
    expect((notUuid.json() as J).error.details.field).toBe('storeId');
    // domain errors keep their code/status mapping
    const oos = await api.call('cart.setItem', { slug, variantId: variant(), qty: 99 }, buyer.token);
    expect(oos.statusCode).toBe(422);
    expect((oos.json() as J).error.code).toBe('OUT_OF_STOCK');
    const nf = await api.call('store.get', { slug: 'no-such-store' });
    expect(nf.statusCode).toBe(404);
    expect((nf.json() as J).error.code).toBe('NOT_FOUND');
  });

  it('Idempotency-Key is required on orders.place and a replay returns the same order', async () => {
    const buyer = await api.login('Kamol');
    await api.ok('cart.setItem', { slug, variantId: variant(3), qty: 1 }, buyer.token);
    const quote = await api.ok('checkout.quote', { slug, region: 'UZ-TK' }, buyer.token);
    const methodId = quote.shippingOptions.find((o: J) => o.type === 'courier').methodId;
    const input = { slug, contact: { name: 'Kamol', phone: '+998931112233' }, methodId, address: ADDRESS, paymentMethod: 'cod' };
    const missing = await api.call('orders.place', input, buyer.token);
    expect(missing.statusCode).toBe(400);
    expect((missing.json() as J).error.details.field).toBe('Idempotency-Key');
    const a = await api.call('orders.place', input, buyer.token, { 'idempotency-key': 'replay-key-0001' });
    const b = await api.call('orders.place', input, buyer.token, { 'idempotency-key': 'replay-key-0001' });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((b.json() as J).order.id).toBe((a.json() as J).order.id);
    expect((b.json() as J).replayed).toBe(true);
    // a body-supplied key never overrides the header
    const c = await api.call('orders.place', { ...input, idempotencyKey: 'body-key-xxxx' }, buyer.token, { 'idempotency-key': 'replay-key-0001' });
    expect((c.json() as J).order.id).toBe((a.json() as J).order.id);
    await api.ok('orders.cancel', { slug, id: (a.json() as J).order.id }, buyer.token);
  });

  it('full flow: buyer cart → payme order → sandbox pay → paid → owner sees it; SSE pushes the change', async () => {
    const buyer = await api.login('Sardor');
    const placed = await placeOrder(api, slug, variant(1), buyer, 'payme');
    expect(placed.order.status).toBe('pending_payment');
    expect(placed.nextAction.type).toBe('sandbox');

    // open the event stream (EventSource style: token in the query string)
    const stream = api.app.inject({ method: 'GET', url: `/v1/s/${slug}/orders/${placed.order.id}/events?access_token=${buyer.token}` });
    await new Promise((r) => setTimeout(r, 150));

    const pay = await api.ok('sandbox.pay', { slug, paymentId: placed.nextAction.paymentId, scenario: 'success' }, buyer.token);
    expect(pay.status).toBe('paid');
    const order = await api.ok('orders.get', { slug, id: placed.order.id }, buyer.token);
    expect(order).toMatchObject({ status: 'paid', paymentStatus: 'paid' });

    const res = await stream;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const events = res.body.split('\n\n').filter((b) => b.includes('event: order')).map((b) => JSON.parse(b.split('data: ')[1]!) as J);
    expect(events[0]).toMatchObject({ id: placed.order.id, status: 'pending_payment' });
    expect(events.at(-1)).toMatchObject({ status: 'paid', paymentStatus: 'paid' });
    expect(res.body).toContain(': ping');

    const list = await api.ok('admin.orders.list', { storeId: seed.store.id }, seed.owner.token);
    expect(list.items.map((o: J) => o.id)).toContain(placed.order.id);
    const got = await api.ok('admin.orders.get', { storeId: seed.store.id, id: placed.order.id }, seed.owner.token);
    expect(got.status).toBe('paid');
    const confirmed = await api.ok('admin.orders.transition', { storeId: seed.store.id, id: placed.order.id, event: 'confirm' }, seed.owner.token);
    expect(confirmed.status).toBe('confirmed');
  });

  it('SSE: needs a token and refuses other buyers’ orders', async () => {
    const owner = await api.login('Owner2');
    const placed = await placeOrder(api, slug, variant(2), owner, 'cod');
    const anon = await api.app.inject({ method: 'GET', url: `/v1/s/${slug}/orders/${placed.order.id}/events` });
    expect(anon.statusCode).toBe(401);
    const stranger = await api.login('Stranger');
    const other = await api.app.inject({ method: 'GET', url: `/v1/s/${slug}/orders/${placed.order.id}/events`, headers: { authorization: `Bearer ${stranger.token}` } });
    expect(other.statusCode).toBe(404);
  });

  it('outbox worker renders + delivers notifications through bot.api and marks them sent', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 1 }));
    const sent = await deliverOutboxOnce(api.h.be, { sendMessage }, { miniAppBase: 'https://t.me/dokonim_bot/shop', batch: 100 });
    expect(sent).toBeGreaterThan(0);
    expect(sendMessage).toHaveBeenCalled();
    const [chatId, text, other] = sendMessage.mock.calls[0] as unknown as [number, string, J];
    expect(typeof chatId).toBe('number');
    expect(text.length).toBeGreaterThan(0);
    expect(other.parse_mode).toBe('HTML');
    // nothing left to deliver
    expect(await deliverOutboxOnce(api.h.be, { sendMessage }, { miniAppBase: 'x', batch: 100 })).toBe(0);
    // without a bot, workers leave the outbox alone; jobs still run
    const w = startWorkers(api.h.be, null, { miniAppBase: 'x', intervalMs: 60_000, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });
    expect(await w.deliverNow()).toBe(0);
    expect(await w.runExpiry()).toBeGreaterThanOrEqual(0);
    expect(await w.runAutoComplete()).toBeGreaterThanOrEqual(0);
    await w.stop();
  });
});

describe.each(ADAPTERS)('graceful shutdown on $name', ({ make }) => {
  it('closing the app ends open SSE streams instead of waiting out maxMs (#5)', async () => {
    const api = await makeApi(make, { sse: { maxMs: 10 * 60_000, pollMs: 50, heartbeatMs: 60_000 } });
    const seed = await seedOverHttp(api, 'sse-shutdown');
    const buyer = await api.login('Shutdown');
    const placed = await placeOrder(api, 'sse-shutdown', seed.product.variants[0].id as string, buyer, 'cod');
    const stream = api.app.inject({ method: 'GET', url: `/v1/s/sse-shutdown/orders/${placed.order.id}/events?access_token=${buyer.token}` });
    await new Promise((r) => setTimeout(r, 150));
    const t0 = Date.now();
    await api.close();
    const res = await stream;
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(res.body).toContain('event: order');
    expect(res.body).not.toContain('event: error'); // ended by preClose, not by polling a closed database
  });
});
