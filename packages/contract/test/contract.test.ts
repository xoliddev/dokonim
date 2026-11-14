import { describe, expect, it } from 'vitest';
import { ApiError, buildRequest, mergeRequest, ROUTES, validate, type RouteDef } from '../src';

const entries = Object.entries(ROUTES) as Array<[keyof typeof ROUTES, RouteDef]>;

describe('route table', () => {
  it('every public route has a unique verb + path', () => {
    const seen = new Set<string>();
    for (const [name, def] of entries) {
      if (def.auth === 'internal') continue;
      const key = `${def.verb} ${def.path}`;
      expect(seen.has(key), `${name} duplicates ${key}`).toBe(false);
      seen.add(key);
      expect(def.path.startsWith('/v1/'), name).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it('store-admin routes are always scoped by :storeId in the path (§10.1)', () => {
    for (const [name, def] of entries) if (name.startsWith('admin.')) expect(def.path, name).toMatch(/^\/v1\/stores\/:storeId/);
    for (const [name, def] of entries) if (name.startsWith('store.') && name !== 'store.summaries') expect(def.path, name).toMatch(/^\/v1\/s\/:slug/);
  });

  it('builds and merges requests losslessly', () => {
    const input = { slug: 'atlas', categoryId: '0190f0f0-0000-7000-8000-000000000001', options: { Oʻlcham: ['S', 'M'] }, inStock: true };
    const req = buildRequest('store.products', input);
    expect(req).toMatchObject({ verb: 'POST', url: '/v1/s/atlas/products/search' });
    const back = mergeRequest({ slug: 'atlas' }, {}, req.body);
    expect(back).toEqual(input);
    const get = buildRequest('store.reviews', { slug: 'atlas', productId: 'k3x9', rating: 5 });
    const url = new URL(get.url, 'http://x');
    expect(url.pathname).toBe('/v1/s/atlas/products/k3x9/reviews');
    expect(mergeRequest({ slug: 'atlas', productId: 'k3x9' }, Object.fromEntries(url.searchParams), undefined)).toEqual({ slug: 'atlas', productId: 'k3x9', rating: 5 });
    const place = buildRequest('orders.place', { slug: 'a', idempotencyKey: 'key-12345678' } as never);
    expect(place.headers['idempotency-key']).toBe('key-12345678');
  });

  it('validates with field paths', () => {
    expect(() => validate('cart.setItem', { slug: 'a', variantId: 'nope', qty: 1 })).toThrow(ApiError);
    try {
      validate('cart.setItem', { slug: 'a', variantId: '0190f0f0-0000-7000-8000-000000000001', qty: 500 });
    } catch (e) {
      expect((e as ApiError).code).toBe('VALIDATION');
      expect((e as ApiError).details?.field).toBe('qty');
    }
    expect(validate('store.get', { slug: 'atlas' })).toEqual({ slug: 'atlas' });
    expect(() => validate('stores.create', { name: 'x', slug: 'ab', businessType: 'cars' })).toThrow();
  });
});
