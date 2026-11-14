/**
 * Tenant-breach suite over HTTP (§16.2 / §18): the owner of store A calls EVERY admin route with store B's id and
 * gets 403; B's object ids inside A's path are 404. Inputs are generated from each route's zod schema so they pass
 * validation and actually reach the permission check.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { uuidv7 } from '@dokonim/core';
import { ROUTES, validate, type RouteDef, type RouteName } from '@dokonim/contract';
import { ADAPTERS, makeApi, placeOrder, seedOverHttp, type Api, type J } from './helpers';

type S = Record<string, unknown>;

/** Minimal valid value for a JSON Schema produced by z.toJSONSchema (required properties only). */
function sample(s: S): unknown {
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  const alts = (s.anyOf ?? s.oneOf) as S[] | undefined;
  if (alts) return sample(alts.find((a) => a.type !== 'null') ?? alts[0]!);
  switch (s.type) {
    case 'object': {
      const out: S = {};
      const props = (s.properties ?? {}) as Record<string, S>;
      for (const k of (s.required as string[] | undefined) ?? []) out[k] = sample(props[k] ?? {});
      return out;
    }
    case 'array':
      return Array.from({ length: Number(s.minItems ?? 0) }, () => sample((s.items as S) ?? {}));
    case 'string':
      if (s.format === 'uuid') return uuidv7();
      if (s.format === 'date-time') return '2026-11-14T10:00:00Z';
      if (s.format === 'uri') return 'https://example.com';
      if (s.pattern === '^UZ-[A-Z]{2}$') return 'UZ-TK';
      return 'x'.repeat(Math.max(Number(s.minLength ?? 0), 3));
    case 'integer':
    case 'number':
      return Math.max(Number(s.minimum ?? 0), 1);
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return 1;
  }
}

const adminRoutes = (Object.entries(ROUTES) as Array<[RouteName, RouteDef]>).filter(([k]) => k.startsWith('admin.'));

function validInput(name: RouteName, over: S): S {
  const json = z.toJSONSchema(ROUTES[name].input, { io: 'input', unrepresentable: 'any' }) as S;
  const input = { ...(sample(json) as S), ...over };
  for (const k of Object.keys(over)) if (!(k in ((json.properties ?? {}) as S))) delete input[k];
  validate(name, input); // throws if the generator produced something the contract rejects
  return input;
}

describe.each(ADAPTERS)('tenant breach over HTTP on $name', ({ make }) => {
  let api: Api;
  let A: Awaited<ReturnType<typeof seedOverHttp>>;
  let B: Awaited<ReturnType<typeof seedOverHttp>>;
  let bOrderId: string;
  beforeAll(async () => {
    api = await makeApi(make);
    A = await seedOverHttp(api, 'alpha-http');
    B = await seedOverHttp(api, 'bravo-http');
    const buyer = await api.login('Buyer');
    bOrderId = (await placeOrder(api, 'bravo-http', B.product.variants[0].id, buyer, 'cod')).order.id;
  });
  afterAll(() => api.close());

  it(`every admin route (${adminRoutes.length}) with store B's id → 403 FORBIDDEN for A's owner`, async () => {
    expect(adminRoutes.length).toBeGreaterThan(60);
    const failures: string[] = [];
    for (const [name] of adminRoutes) {
      const input = validInput(name, { storeId: B.store.id, id: B.product.id, confirmSlug: 'bravo-http' });
      const res = await api.call(name, input, A.owner.token);
      const code = (res.json() as J).error?.code;
      if (res.statusCode !== 403 || code !== 'FORBIDDEN') failures.push(`${name}: ${res.statusCode} ${code}`);
    }
    expect(failures).toEqual([]);
    // control: the same generated inputs on A's own store reach the handlers (reads succeed)
    let okReads = 0;
    for (const [name, def] of adminRoutes.filter(([, d]) => d.verb === 'GET')) {
      const res = await api.call(name, validInput(name, { storeId: A.store.id, id: A.product.id }), A.owner.token);
      if (res.statusCode === 200) okReads++;
      else expect([404, 422], `${name} ${def.path} ${res.body}`).toContain(res.statusCode);
    }
    expect(okReads).toBeGreaterThan(20);
    // B is intact and still B's
    const bp = await api.ok('admin.products.get', { storeId: B.store.id, id: B.product.id }, B.owner.token);
    expect(bp.status).toBe('active');
    expect((await api.ok('store.get', { slug: 'bravo-http' })).store.status).toBe('active');
  });

  it("B's object ids inside A's path → 404 NOT_FOUND", async () => {
    const sid = A.store.id;
    const calls: Array<[RouteName, S]> = [
      ['admin.products.get', { storeId: sid, id: B.product.id }],
      ['admin.products.duplicate', { storeId: sid, id: B.product.id }],
      ['admin.categories.update', { storeId: sid, id: B.root.id, name: { uz: 'hack' } }],
      ['admin.categories.delete', { storeId: sid, id: B.root.id, strategy: { kind: 'reparent_children' } }],
      ['admin.orders.get', { storeId: sid, id: bOrderId }],
      ['admin.orders.transition', { storeId: sid, id: bOrderId, event: 'confirm' }],
      ['admin.orders.note', { storeId: sid, id: bOrderId, text: 'peek' }],
      ['admin.inventory.adjust', { storeId: sid, variantId: B.product.variants[0].id, delta: 5, reason: 'purchase' }],
    ];
    for (const [name, input] of calls) {
      const res = await api.call(name, input, A.owner.token);
      expect(`${name}: ${res.statusCode} ${(res.json() as J).error?.code}`).toBe(`${name}: 404 NOT_FOUND`);
    }
    const order = await api.ok('admin.orders.get', { storeId: B.store.id, id: bOrderId }, B.owner.token);
    expect(order.status).toBe('awaiting_confirmation');
  });

  it('buyers cannot read other buyers’ orders; anonymous callers get 401 on admin routes', async () => {
    const stranger = await api.login('Stranger');
    expect((await api.call('orders.get', { slug: 'bravo-http', id: bOrderId }, stranger.token)).statusCode).toBe(404);
    expect((await api.call('admin.orders.list', { storeId: B.store.id })).statusCode).toBe(401);
  });
});
