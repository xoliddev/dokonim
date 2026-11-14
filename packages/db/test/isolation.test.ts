import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { uuidv7, type DomainError } from '@dokonim/core';
import { inScope, type MethodName } from '../src';
import { ADAPTERS, ADDRESS, seedStore, setup, type H } from './harness';

const TENANT_TABLES = [
  'customers', 'addresses', 'categories', 'products', 'product_options', 'option_values', 'product_variants', 'inventory_levels', 'inventory_movements',
  'product_media', 'collections', 'carts', 'cart_items', 'shipping_methods', 'shipping_zones', 'shipping_rates', 'discounts', 'orders', 'order_items',
  'order_events', 'payment_provider_configs', 'payments', 'store_themes', 'audit_log', 'outbox',
];

describe.each(ADAPTERS)('tenant isolation on $name', ({ make }) => {
  let h: H;
  let A: Awaited<ReturnType<typeof seedStore>>;
  let B: Awaited<ReturnType<typeof seedStore>>;
  let bOrderId: string;
  beforeAll(async () => {
    h = await setup(make);
    A = await seedStore(h, 'store-alpha');
    B = await seedStore(h, 'store-bravo');
    const buyer = await h.user('Buyer');
    await h.m['cart.setItem'](buyer, { slug: B.store.slug, variantId: B.product.variants[0]!.id, qty: 1 });
    const q = await h.m['checkout.quote'](buyer, { slug: B.store.slug, region: 'UZ-TK' });
    const placed = await h.m['orders.place'](buyer, { slug: B.store.slug, idempotencyKey: 'b1', contact: { name: 'B', phone: '+998901112233' }, methodId: q.shippingOptions[0]!.methodId, address: ADDRESS, paymentMethod: 'cod' });
    bOrderId = placed.order.id;
  });
  afterAll(() => h.close());

  const adminMethods = () => (Object.keys(h.m) as MethodName[]).filter((k) => k.startsWith('admin.'));

  it('RLS: inside store A, rows of store B are invisible and cannot be written', async () => {
    for (const t of TENANT_TABLES) {
      const rows = await inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query(`select count(*)::int as n from ${t} where store_id = $1`, [B.store.id]));
      expect((rows[0] as { n: number }).n, t).toBe(0);
    }
    await expect(inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query(`insert into categories (store_id, id, path, slug, name) values ($1,$2,'cx','x','{}')`, [B.store.id, uuidv7()]))).rejects.toThrow(/row-level security/);
    const upd = await inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query(`update products set status = 'archived' where id = $1 returning id`, [B.product.id]));
    expect(upd).toEqual([]);
    const none = await inScope(h.db, { storeId: null, userId: null }, (tx) => tx.query('select count(*)::int as n from products'));
    expect((none[0] as { n: number }).n).toBe(0);
  });

  it('audit log is append-only for the application role', async () => {
    await expect(inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query('delete from audit_log'))).rejects.toThrow(/permission denied/);
    await expect(inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query(`update audit_log set action = 'x'`))).rejects.toThrow(/permission denied/);
  });

  it('every admin method refuses a store the caller is not a member of', async () => {
    for (const k of adminMethods()) {
      const fn = h.m[k] as (a: unknown, i: unknown) => Promise<unknown>;
      const e = await fn(A.owner, { storeId: B.store.id, id: B.product.id, ids: [B.product.id], parentId: null, name: { uz: 'x' }, range: '7d' }).catch((x: DomainError) => x);
      expect((e as DomainError).code, k).toBe('FORBIDDEN');
    }
  });

  it('IDOR: B’s ids used inside A’s scope are not found', async () => {
    const sid = A.store.id;
    const calls: Array<[MethodName, Record<string, unknown>]> = [
      ['admin.products.get', { storeId: sid, id: B.product.id }],
      ['admin.categories.update', { storeId: sid, id: B.cats.kiyim.id, name: { uz: 'hack' } }],
      ['admin.categories.move', { storeId: sid, id: A.cats.kiyim.id, parentId: B.cats.kiyim.id, index: 0 }],
      ['admin.categories.delete', { storeId: sid, id: B.cats.kiyim.id, strategy: { kind: 'reparent_children' } }],
      ['admin.orders.get', { storeId: sid, id: bOrderId }],
      ['admin.orders.transition', { storeId: sid, id: bOrderId, event: 'confirm' }],
      ['admin.inventory.adjust', { storeId: sid, variantId: B.product.variants[0]!.id, delta: 5, reason: 'purchase' }],
      ['admin.collections.delete', { storeId: sid, id: uuidv7() }],
    ];
    for (const [k, input] of calls) {
      const e = await (h.m[k] as (a: unknown, i: unknown) => Promise<unknown>)(A.owner, input).catch((x: DomainError) => x);
      expect((e as DomainError).code, k).toBe('NOT_FOUND');
    }
    // B's product is untouched
    const bp = await h.m['admin.products.get'](B.owner, { storeId: B.store.id, id: B.product.id });
    expect(bp.status).toBe('active');
  });

  it('FUZZ: random admin method × foreign store id × random payload never succeeds', async () => {
    const methods = adminMethods();
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...methods), fc.constantFrom(B.store.id, uuidv7()), fc.dictionary(fc.constantFrom('id', 'productId', 'variantId', 'q', 'status'), fc.oneof(fc.uuid(), fc.string())), async (k, storeId, extra) => {
        const e = await (h.m[k] as (a: unknown, i: unknown) => Promise<unknown>)(A.owner, { ...extra, storeId }).then(() => null, (x: DomainError) => x);
        expect(e, k).not.toBeNull();
        expect(['FORBIDDEN', 'NOT_FOUND'], k).toContain((e as DomainError).code);
      }),
      { numRuns: 120 },
    );
  });

  it('buyers cannot read other buyers’ orders', async () => {
    const stranger = await h.user('Stranger');
    await expect(h.m['orders.get'](stranger, { slug: B.store.slug, id: bOrderId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(h.m['orders.cancel'](stranger, { slug: B.store.slug, id: bOrderId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('roles: an order operator works orders but cannot edit the catalog or payments', async () => {
    const inv = await h.m['admin.staff.invite'](A.owner, { storeId: A.store.id, role: 'order_operator' });
    const kamola = await h.user('Kamola');
    const joined = await h.m['invites.accept'](kamola, { token: inv.token });
    expect(joined.role).toBe('order_operator');
    await expect(h.m['invites.accept'](await h.user('Late'), { token: inv.token })).rejects.toMatchObject({ code: 'INVITE_INVALID' });
    await expect(h.m['admin.categories.create'](kamola, { storeId: A.store.id, parentId: null, name: { uz: 'x' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.m['admin.payments.save'](kamola, { storeId: A.store.id, provider: 'payme', mode: 'sandbox', enabled: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.m['admin.staff.invite'](kamola, { storeId: A.store.id, role: 'viewer' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const list = await h.m['admin.orders.list'](kamola, { storeId: A.store.id });
    expect(list.items).toBeDefined();
    const inv2 = await h.m['admin.staff.invite'](A.owner, { storeId: A.store.id, role: 'admin' });
    const admin = await h.user('Admin');
    await h.m['invites.accept'](admin, { token: inv2.token });
    await expect(h.m['admin.payments.save'](admin, { storeId: A.store.id, provider: 'payme', mode: 'sandbox', enabled: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.m['admin.staff.invite'](admin, { storeId: A.store.id, role: 'admin' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(h.m['admin.staff.remove'](admin, { storeId: A.store.id, userId: A.owner.userId! })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await h.m['admin.staff.update'](A.owner, { storeId: A.store.id, userId: kamola.userId!, role: 'viewer' });
    await expect(h.m['admin.inventory.adjust'](kamola, { storeId: A.store.id, variantId: A.product.variants[0]!.id, delta: 1, reason: 'purchase' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('payment credentials are encrypted at rest and never returned', async () => {
    await h.m['admin.payments.save'](A.owner, { storeId: A.store.id, provider: 'click', mode: 'live', enabled: true, credentials: { service_id: '1', merchant_id: '2', secret_key: 'TOP-SECRET', merchant_user_id: '3' } });
    const raw = await inScope(h.db, { storeId: A.store.id, userId: null }, (tx) => tx.query<{ credentialsEnc: string }>(`select credentials_enc from payment_provider_configs where provider = 'click'`));
    expect(raw[0]!.credentialsEnc).not.toContain('TOP-SECRET');
    const list = await h.m['admin.payments.list'](A.owner, { storeId: A.store.id });
    expect(JSON.stringify(list)).not.toContain('TOP-SECRET');
    expect(list.find((p) => p.provider === 'click')).toMatchObject({ hasCredentials: true, mode: 'live' });
    await expect(h.m['admin.payments.save'](A.owner, { storeId: A.store.id, provider: 'payme', mode: 'live', enabled: true, credentials: { merchant_id: 'x' } })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('platform admin: only admins; suspension blocks the storefront and writes', async () => {
    const nobody = await h.user('Nobody');
    await expect(h.m['platform.stores'](nobody, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const xolid = { ...(await h.user('Xolid')), isPlatformAdmin: true };
    const stores = await h.m['platform.stores'](xolid, {});
    expect(stores.length).toBeGreaterThanOrEqual(2);
    await h.m['platform.suspend'](xolid, { storeId: B.store.id, suspended: true, reason: 'abuse report' });
    await expect(h.m['store.get'](nobody, { slug: B.store.slug })).rejects.toMatchObject({ code: 'STORE_SUSPENDED' });
    await expect(h.m['admin.categories.create'](B.owner, { storeId: B.store.id, parentId: null, name: { uz: 'x' } })).rejects.toMatchObject({ code: 'STORE_SUSPENDED' });
    expect(await h.m['admin.dashboard'](B.owner, { storeId: B.store.id })).toBeTruthy();
    await h.m['platform.suspend'](xolid, { storeId: B.store.id, suspended: false });
    expect((await h.m['store.get'](nobody, { slug: B.store.slug })).store.slug).toBe(B.store.slug);
  });
});
