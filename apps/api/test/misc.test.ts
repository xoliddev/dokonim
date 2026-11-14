import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROUTES, type RouteDef } from '@dokonim/contract';
import { ADAPTERS, makeApi, type Api, type J } from './helpers';

describe.each(ADAPTERS)('ops, OpenAPI, headers and limits on $name', ({ make }) => {
  let api: Api;
  beforeAll(async () => {
    api = await makeApi(make);
  });
  afterAll(() => api.close());

  it('GET /healthz pings the database', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: 'up' });
  });

  it('openapi.json is OpenAPI 3.1 and lists every public route with its schema and security', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as J;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    const ops = new Map<string, J>();
    for (const [path, verbs] of Object.entries(doc.paths as Record<string, Record<string, J>>)) for (const [verb, op] of Object.entries(verbs)) ops.set(op.operationId, { ...op, path, verb });
    const publicRoutes = (Object.entries(ROUTES) as Array<[string, RouteDef]>).filter(([, d]) => d.auth !== 'internal');
    for (const [name, def] of publicRoutes) {
      const op = ops.get(name);
      expect(op, name).toBeDefined();
      expect(op.verb).toBe(def.verb.toLowerCase());
      expect(op.path).toBe(def.path.replace(/:([A-Za-z]+)/g, '{$1}'));
      if (def.auth === 'user') expect(op.security).toEqual([{ bearer: [] }]);
    }
    for (const internal of Object.entries(ROUTES).filter(([, d]) => (d as RouteDef).auth === 'internal').map(([k]) => k)) expect(ops.has(internal), internal).toBe(false);
    expect(ops.get('orders.place').parameters.some((p: J) => p.in === 'header' && p.name === 'Idempotency-Key')).toBe(true);
    expect(ops.get('orders.place').requestBody.content['application/json'].schema.properties.contact).toBeDefined();
    expect(ops.get('admin.products.list').parameters.find((p: J) => p.name === 'storeId').in).toBe('path');
    for (const extra of ['auth.telegram', 'auth.refresh', 'orders.events', 'hooks.payme', 'hooks.click', 'hooks.uzum', 'healthz']) expect(ops.has(extra), extra).toBe(true);
  });

  it('security headers, CORS for configured origins only, JSON 404s', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/s/nope', headers: { origin: 'https://app.dokonim.test' } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['access-control-allow-origin']).toBe('https://app.dokonim.test');
    const evil = await api.app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await api.app.inject({ method: 'OPTIONS', url: '/v1/s/x/orders', headers: { origin: 'https://app.dokonim.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,idempotency-key,content-type' } });
    expect(pre.statusCode).toBe(204);
    expect(String(pre.headers['access-control-allow-headers'])).toContain('idempotency-key');
    const missing = await api.app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as J).error.code).toBe('NOT_FOUND');
    // internal methods are not routable
    expect((await api.app.inject({ method: 'POST', url: '/-' })).statusCode).toBe(404);
  });

  it('malformed JSON → 400, oversized body → 413, both without internals', async () => {
    const bad = await api.app.inject({ method: 'POST', url: '/v1/stores/summaries', headers: { 'content-type': 'application/json' }, payload: '{"slugs":' });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as J).error.code).toBe('BAD_REQUEST');
    const big = await api.app.inject({ method: 'POST', url: '/v1/stores/summaries', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ slugs: ['a'], pad: 'x'.repeat(6.5 * 1024 * 1024) }) });
    expect(big.statusCode).toBe(413);
    expect((big.json() as J).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('checkout routes are limited to 20/min per user (shared across checkout routes)', async () => {
    const buyer = await api.login('Hasty');
    const other = await api.login('Calm');
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await api.call('checkout.quote', { slug: 'no-such-shop' }, buyer.token)).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes[20]).toBe(429);
    // same bucket for another checkout route of the same user
    expect((await api.call('orders.retryPayment', { slug: 'no-such-shop', id: '0190a000-0000-7000-8000-000000000000' }, buyer.token)).statusCode).toBe(429);
    // a different user is unaffected
    expect((await api.call('checkout.quote', { slug: 'no-such-shop' }, other.token)).statusCode).toBe(404);
  });

  it('unknown errors become 500 INTERNAL without leaking the message', async () => {
    const orig = api.h.be.methods['store.summaries'];
    (api.h.be.methods as Record<string, unknown>)['store.summaries'] = async () => {
      throw new Error('relation "secret_table" does not exist');
    };
    try {
      const res = await api.call('store.summaries', { slugs: ['a'] });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error', details: {} } });
      expect(res.body).not.toContain('secret_table');
    } finally {
      (api.h.be.methods as Record<string, unknown>)['store.summaries'] = orig;
    }
  });
});
