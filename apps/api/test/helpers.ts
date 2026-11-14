/**
 * HTTP test harness: the db package's adapter-parity setup (PGlite always, Postgres when TEST_DATABASE_URL is set)
 * wrapped in the real Fastify app, driven with `inject`. Users log in with genuinely signed initData.
 */
import type { Bot } from 'grammy';
import { signInitData, type TelegramUser } from '@dokonim/core';
import { buildRequest, type RouteName } from '@dokonim/contract';
import type { Backend, Database } from '@dokonim/db';
import { ADAPTERS, ADDRESS, setup, variantProduct } from '../../../packages/db/test/harness';
import { buildApp, type ApiConfig } from '../src/app';

export { ADAPTERS, ADDRESS, variantProduct };

export const BOT_TOKEN = '7000000001:AAtest-dokonim-api-token-0123456789abcdef';
export const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-0123456789';

export const CONFIG: ApiConfig = {
  botToken: BOT_TOKEN,
  jwtSecret: JWT_SECRET,
  corsOrigins: ['https://app.dokonim.test'],
  publicUrl: 'https://api.dokonim.test',
  miniAppBase: 'https://t.me/dokonim_bot/shop',
  initDataMaxAgeSec: 86_400,
  nodeEnv: 'test',
};

export type J = any;

let tgSeq = 900_000;
let ipSeq = 0;
/** A fresh client IP per login so suites do not trip the 10/min auth limit (the rate-limit test reuses one IP). */
export const nextIp = () => {
  ipSeq++;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};

export interface Session {
  token: string;
  refresh: string;
  user: J;
}

export async function makeApi(make: () => Promise<Database>, over: Partial<ApiConfig> = {}, bot: ((be: Backend) => Bot) | null = null) {
  const h = await setup(make);
  const app = await buildApp({ backend: h.be, config: { ...CONFIG, ...over }, bot: bot ? bot(h.be) : null });
  await app.ready();

  const initData = (user: Partial<TelegramUser> = {}, authDate: Date = h.clock.now()) =>
    signInitData({ user: { id: ++tgSeq, first_name: 'Test', language_code: 'uz', ...user }, authDate }, BOT_TOKEN);

  const login = async (first_name = 'User', extra: Partial<TelegramUser> = {}): Promise<Session> => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/telegram', payload: { initData: await initData({ first_name, ...extra }) }, remoteAddress: nextIp() });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
    const j = res.json() as J;
    return { token: j.accessToken, refresh: j.refreshToken, user: j.user };
  };

  /** Calls a contract route over HTTP exactly like the HttpApi client would (buildRequest from the contract). */
  const call = (name: RouteName, input: Record<string, unknown>, token?: string, headers: Record<string, string> = {}) => {
    const r = buildRequest(name, input);
    return app.inject({
      method: r.verb,
      url: r.url,
      ...(r.body !== undefined ? { payload: r.body as Record<string, unknown> } : {}),
      headers: { ...r.headers, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
  };

  const ok = async (name: RouteName, input: Record<string, unknown>, token?: string, headers: Record<string, string> = {}): Promise<J> => {
    const res = await call(name, input, token, headers);
    if (res.statusCode !== 200) throw new Error(`${name} → ${res.statusCode} ${res.body}`);
    return res.json();
  };

  return {
    h,
    app,
    initData,
    login,
    call,
    ok,
    close: async () => {
      await app.close();
      await h.close();
    },
  };
}

export type Api = Awaited<ReturnType<typeof makeApi>>;

/** Owner session + store (with nested categories and a variant product) created entirely over HTTP. */
export async function seedOverHttp(api: Api, slug: string) {
  const owner = await api.login('Dilnoza');
  const { store } = await api.ok('stores.create', { name: `Store ${slug}`, slug, businessType: 'clothing' }, owner.token);
  const root = await api.ok('admin.categories.create', { storeId: store.id, parentId: null, name: { uz: 'Kiyim' } }, owner.token);
  const child = await api.ok('admin.categories.create', { storeId: store.id, parentId: root.id, name: { uz: 'Koʻylaklar' } }, owner.token);
  const product = await api.ok('admin.products.save', variantProduct(store.id, child.id), owner.token);
  return { owner, store, root, child, product };
}

/** Buyer: one unit in the cart, courier quote → place order with an Idempotency-Key. */
export async function placeOrder(api: Api, slug: string, variantId: string, buyer: Session, paymentMethod: string, key = `key-${Math.random().toString(36).slice(2)}`) {
  await api.ok('cart.setItem', { slug, variantId, qty: 1 }, buyer.token);
  const quote = await api.ok('checkout.quote', { slug, region: 'UZ-TK' }, buyer.token);
  const courier = quote.shippingOptions.find((o: J) => o.type === 'courier');
  const input = { slug, contact: { name: 'Sardor', phone: '+998901234567' }, methodId: courier.methodId, address: ADDRESS, paymentMethod };
  const res = await api.call('orders.place', input, buyer.token, { 'idempotency-key': key });
  if (res.statusCode !== 200) throw new Error(`orders.place → ${res.statusCode} ${res.body}`);
  return { ...(res.json() as J), key, input };
}
