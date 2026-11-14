import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatTashkentTime } from '@dokonim/payments';
import { clickSignString, paymeAuthHeader, SANDBOX_CREDENTIALS, tiyinToSom } from '@dokonim/payments';
import { createBot } from '@dokonim/bot';
import type { UserFromGetMe } from 'grammy/types';
import { ADAPTERS, BOT_TOKEN, makeApi, placeOrder, seedOverHttp, type Api, type J } from './helpers';
import { createBotBackend } from '../src/bot-backend';

const botInfo = { id: 7000000001, is_bot: true, first_name: 'Doʻkonim', username: 'dokonim_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true } as unknown as UserFromGetMe;
const WEBHOOK_SECRET = 'tg-webhook-secret-0123456789';

describe.each(ADAPTERS)('webhooks over HTTP on $name', ({ make }) => {
  let api: Api;
  let seed: Awaited<ReturnType<typeof seedOverHttp>>;
  const slug = 'hooks-shop';
  const apiCalls: string[] = [];
  beforeAll(async () => {
    // A real grammY bot (botInfo given → no getMe); outgoing Bot API calls are captured, never sent.
    api = await makeApi(make, { botWebhookSecret: WEBHOOK_SECRET }, (be) => {
      const bot = createBot({ token: BOT_TOKEN, botInfo, miniAppBase: 'https://t.me/dokonim_bot/shop', webAppUrl: 'https://app.dokonim.test' }, createBotBackend(be));
      bot.api.config.use(async (_prev, method) => {
        apiCalls.push(method);
        return { ok: true, result: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } } as never;
      });
      return bot;
    });
    seed = await seedOverHttp(api, slug);
  });
  afterAll(() => api.close());

  const variant = (k = 0) => seed.product.variants[k].id as string;
  const payme = (body: unknown, auth = paymeAuthHeader(SANDBOX_CREDENTIALS.payme.key!)) =>
    api.app.inject({ method: 'POST', url: `/hooks/payme/${seed.store.id}`, headers: { authorization: auth, 'content-type': 'application/json' }, payload: JSON.stringify(body) });

  it('Payme JSON-RPC over HTTP: wrong Basic auth → -32504 with HTTP 200; correct auth → Check/Create/Perform → paid', async () => {
    const buyer = await api.login('Jasur');
    const { order } = await placeOrder(api, slug, variant(1), buyer, 'payme');
    const account = { order_id: order.id };
    const bad = await payme({ jsonrpc: '2.0', id: 1, method: 'CheckPerformTransaction', params: { amount: order.total, account } }, paymeAuthHeader('wrong-key'));
    expect(bad.statusCode).toBe(200);
    expect((bad.json() as J).error.code).toBe(-32504);
    const none = await payme({ jsonrpc: '2.0', id: 2, method: 'CheckPerformTransaction', params: { amount: order.total, account } }, '');
    expect((none.json() as J).error.code).toBe(-32504);

    const check = await payme({ jsonrpc: '2.0', id: 3, method: 'CheckPerformTransaction', params: { amount: order.total, account } });
    expect((check.json() as J).result.allow).toBe(true);
    const txn = 'a1b2c3d4e5f6a1b2c3d4e5f6';
    const time = api.h.clock.now().getTime();
    const create = await payme({ jsonrpc: '2.0', id: 4, method: 'CreateTransaction', params: { id: txn, time, amount: order.total, account } });
    expect((create.json() as J).result.state).toBe(1);
    const perform = await payme({ jsonrpc: '2.0', id: 5, method: 'PerformTransaction', params: { id: txn } });
    expect((perform.json() as J).result.state).toBe(2);
    const again = await payme({ jsonrpc: '2.0', id: 6, method: 'PerformTransaction', params: { id: txn } });
    expect((again.json() as J).result.state).toBe(2);
    const o = await api.ok('orders.get', { slug, id: order.id }, buyer.token);
    expect(o.paymentStatus).toBe('paid');
    // unknown store → still HTTP 200 with a JSON-RPC error
    const ghost = await api.app.inject({ method: 'POST', url: '/hooks/payme/0190a000-0000-7000-8000-000000000000', headers: { 'content-type': 'application/json' }, payload: '{"jsonrpc":"2.0","id":9,"method":"CheckTransaction","params":{}}' });
    expect(ghost.statusCode).toBe(200);
    expect((ghost.json() as J)).toMatchObject({ id: 9, error: { code: -32504 } });
    const events = await api.ok('admin.payments.events', { storeId: seed.store.id }, seed.owner.token);
    expect(events.length).toBeGreaterThanOrEqual(5);
  });

  it('Click prepare/complete form posts with real md5 signs; bad sign → -1; duplicate complete is idempotent', async () => {
    const buyer = await api.login('Malika');
    const { order } = await placeOrder(api, slug, variant(0), buyer, 'click');
    const c = SANDBOX_CREDENTIALS.click;
    const base = { click_trans_id: '1234567890', service_id: c.service_id!, click_paydoc_id: '555', merchant_trans_id: order.id, amount: tiyinToSom(order.total), error: '0', error_note: 'Success', sign_time: formatTashkentTime(api.h.clock.now()) };
    const post = (action: 'prepare' | 'complete', f: Record<string, string>, secret = c.secret_key!) => {
      const sign_string = clickSignString({ click_trans_id: f.click_trans_id!, service_id: f.service_id!, merchant_trans_id: f.merchant_trans_id!, merchant_prepare_id: f.merchant_prepare_id ?? '', amount: f.amount!, action: f.action!, sign_time: f.sign_time! }, secret);
      return api.app.inject({ method: 'POST', url: `/hooks/click/${seed.store.id}/${action}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ ...f, sign_string }).toString() });
    };
    const badSign = await post('prepare', { ...base, action: '0' }, 'not-the-secret');
    expect(badSign.statusCode).toBe(200);
    expect((badSign.json() as J).error).toBe(-1);

    const prep = await post('prepare', { ...base, action: '0' });
    const pj = prep.json() as J;
    expect(pj.error).toBe(0);
    expect(typeof pj.merchant_prepare_id).toBe('number');
    const complete = { ...base, action: '1', merchant_prepare_id: String(pj.merchant_prepare_id) };
    const done = await post('complete', complete);
    expect((done.json() as J)).toMatchObject({ error: 0 });
    const dup = await post('complete', complete);
    expect((dup.json() as J)).toMatchObject({ error: 0, merchant_confirm_id: (done.json() as J).merchant_confirm_id });
    const o = await api.ok('orders.get', { slug, id: order.id }, buyer.token);
    expect(o.status).toBe('paid');
    expect(o.payments.filter((p: J) => p.status === 'paid')).toHaveLength(1);
    // wrong action segment → 404
    expect((await api.app.inject({ method: 'POST', url: `/hooks/click/${seed.store.id}/refund`, payload: 'a=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(404);
  });

  it('Uzum routes reach the protocol handler verbatim and only known actions are routed', async () => {
    // every store gets a sandbox Uzum config that starts disabled; webhooks for a disabled provider are ignored
    const res = await api.app.inject({ method: 'POST', url: `/hooks/uzum/${seed.store.id}/check`, headers: { 'content-type': 'application/json' }, payload: '{"serviceId":1}' });
    expect(res.statusCode).toBe(404);
    const ghost = await api.app.inject({ method: 'POST', url: '/hooks/uzum/0190a000-0000-7000-8000-000000000000/check', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(ghost.statusCode).toBe(404);
    expect(ghost.json()).toEqual({ error: 'provider not configured' });
    expect((await api.app.inject({ method: 'POST', url: `/hooks/uzum/${seed.store.id}/hack`, headers: { 'content-type': 'application/json' }, payload: '{}' })).statusCode).toBe(404);
  });

  it('Telegram bot webhook: wrong secret → 401; correct secret is processed and deduplicated by update_id', async () => {
    const wrong = await api.app.inject({ method: 'POST', url: '/hooks/telegram', headers: { 'x-telegram-bot-api-secret-token': 'nope', 'content-type': 'application/json' }, payload: { update_id: 10 } });
    expect(wrong.statusCode).toBe(401);
    const missing = await api.app.inject({ method: 'POST', url: '/hooks/telegram', headers: { 'content-type': 'application/json' }, payload: { update_id: 10 } });
    expect(missing.statusCode).toBe(401);
    const spy = vi.spyOn(api.h.be.methods, 'auth.seenUpdate');
    const update = { update_id: 4242, message: { message_id: 1, date: 1, chat: { id: 555, type: 'private', first_name: 'A' }, from: { id: 555, is_bot: false, first_name: 'A', language_code: 'ru' }, text: '/help', entities: [{ type: 'bot_command', offset: 0, length: 5 }] } };
    const ok = await api.app.inject({ method: 'POST', url: '/hooks/telegram', headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET, 'content-type': 'application/json' }, payload: update });
    expect(ok.statusCode).toBe(200);
    expect(apiCalls).toContain('sendMessage');
    const sends = apiCalls.length;
    const dupe = await api.app.inject({ method: 'POST', url: '/hooks/telegram', headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET, 'content-type': 'application/json' }, payload: update });
    expect(dupe.statusCode).toBe(200);
    expect(apiCalls.length).toBe(sends); // second delivery of the same update_id is skipped
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('bot backend: preCheckout / successfulPayment resolve the store from the invoice payload (payment id)', async () => {
    const bb = createBotBackend(api.h.be);
    const buyer = await api.login('Stars');
    const { order, nextAction } = await placeOrder(api, slug, variant(2), buyer, 'payme');
    const paymentId = nextAction.paymentId as string;
    const wrongAmount = await bb.preCheckout({ id: 'q1', payload: paymentId, totalAmount: order.total + 1, currency: 'UZS', fromId: 1, languageCode: 'en' });
    expect(wrongAmount).toMatchObject({ ok: false });
    const good = await bb.preCheckout({ id: 'q2', payload: paymentId, totalAmount: order.total, currency: 'UZS', fromId: 1 });
    expect(good).toEqual({ ok: true });
    const unknown = await bb.preCheckout({ id: 'q3', payload: 'not-a-payment', totalAmount: 1, currency: 'UZS', fromId: 1, languageCode: 'ru' });
    expect(unknown).toMatchObject({ ok: false, errorMessage: expect.stringContaining('Заказ') });
    await bb.successfulPayment({ payload: paymentId, totalAmount: order.total, currency: 'UZS', telegramChargeId: 'tg-charge-1', fromId: 1 });
    const o = await api.ok('orders.get', { slug, id: order.id }, buyer.token);
    expect(o.paymentStatus).toBe('paid');
    // owner action from a Telegram button
    const tgOwner = seed.owner.user.telegramId as number;
    expect(await bb.orderAction(tgOwner, order.id, 'confirm')).toMatchObject({ ok: true, status: 'confirmed', message: null });
    expect(await bb.orderAction(tgOwner, order.id, 'confirm')).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(await bb.orderAction(999_999_999, order.id, 'confirm')).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await bb.seenUpdate(1_000_001)).toBe(false);
    expect(await bb.seenUpdate(1_000_001)).toBe(true);
    expect((await bb.upsertUser({ telegramId: 31337, firstName: 'Ali', languageCode: 'en' })).locale).toBe('en');
    await bb.saveVerifiedPhone(31337, '+998901112233');
  });
});
