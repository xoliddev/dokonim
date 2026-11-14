import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackend, type Backend, type CategoryNode, type Database } from '@dokonim/db';
import { createPgliteDatabase } from '@dokonim/db/pglite';
import { createPaymentRegistry } from '@dokonim/payments';
import { ART_KINDS, DEMO_KEK, DEMO_SLUGS, DEMO_STORES, DEMO_USER, artUrl, isSeeded, renderArt, seedDemo, type SeedResult } from '../src';

const NOW = new Date('2026-11-13T07:00:00Z');
const depth = (nodes: CategoryNode[]): number => (nodes.length ? 1 + Math.max(...nodes.map((n) => depth(n.children))) : 0);

describe('art', () => {
  it('renders every kind as small, self-contained SVG', () => {
    for (const k of ART_KINDS) {
      const svg = renderArt(artUrl(k, { p: 'ikat' }));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.length).toBeLessThan(6000);
      expect(svg).not.toMatch(/<script|on\w+=|https?:\/\/(?!www\.w3\.org)/i);
    }
  });

  it('is deterministic per spec and differs between colours', () => {
    expect(renderArt('art:dress?c=b3263a')).toBe(renderArt('art:dress?c=b3263a'));
    expect(renderArt('art:dress?c=b3263a')).not.toBe(renderArt('art:dress?c=2c4f9e'));
  });
});

describe('specs', () => {
  it('every product points at a declared leaf-or-node category and has Uzbek names', () => {
    for (const s of DEMO_STORES) {
      const paths = new Set<string>();
      const walk = (ns: typeof s.categories, pre: string) => ns.forEach((n) => { const p = pre ? `${pre}/${n.name.uz}` : n.name.uz!; paths.add(p); walk(n.children ?? [], p); });
      walk(s.categories, '');
      for (const p of s.products) {
        expect(paths.has(p.cat), `${s.slug}:${p.key} → ${p.cat}`).toBe(true);
        expect(p.title.uz && p.title.ru && p.title.en).toBeTruthy();
        expect(ART_KINDS as readonly string[]).toContain(p.art.kind);
      }
      expect(new Set(s.products.map((p) => p.key)).size).toBe(s.products.length);
    }
  });
});

describe('seedDemo on PGlite', () => {
  let db: Database;
  let be: Backend;
  let res: SeedResult;
  beforeAll(async () => {
    db = await createPgliteDatabase();
    expect(await isSeeded(db)).toBe(false);
    res = await seedDemo(db, { now: NOW });
    be = createBackend({ db, clock: { now: () => NOW }, kek: DEMO_KEK, payments: createPaymentRegistry({}), links: { miniAppBase: 'x', webhookBase: 'y' } });
  }, 300_000);
  afterAll(() => db.close());

  it('creates three active stores and reports itself as seeded', async () => {
    expect(res.stores.map((s) => s.slug)).toEqual(DEMO_SLUGS);
    expect(await isSeeded(db)).toBe(true);
    const sums = await be.methods['store.summaries']({ userId: null, telegramId: null, isPlatformAdmin: false, locale: 'uz' }, { slugs: DEMO_SLUGS });
    expect(sums).toHaveLength(3);
  });

  it('builds 3-level category trees with no leftover template categories', async () => {
    const { actor } = await be.upsertUser(DEMO_USER);
    for (const s of res.stores) {
      const tree = (await be.methods['admin.categories.tree'](actor, { storeId: s.id })) as CategoryNode[];
      expect(depth(tree)).toBe(3);
      const spec = DEMO_STORES.find((x) => x.slug === s.slug)!;
      expect(tree.map((n) => n.name.uz)).toEqual(spec.categories.map((n) => n.name.uz));
    }
  });

  it('products have variants, stock, discounts and art media', async () => {
    const { actor } = await be.upsertUser(DEMO_USER);
    const atlas = res.stores[0]!;
    const page = await be.methods['store.products'](actor, { slug: atlas.slug, limit: 60 });
    const items = (page as { items: Array<Record<string, any>> }).items;
    expect(items.length).toBe(DEMO_STORES[0]!.products.length);
    const dress = items.find((p) => p.title.uz.includes('Margʻilon”'))!;
    const pdp = await be.methods['store.product'](actor, { slug: atlas.slug, id: dress.id });
    expect(pdp.options).toHaveLength(2);
    expect(pdp.variants).toHaveLength(12);
    expect((pdp.media[0] as { url: string }).url.startsWith('data:image/svg+xml')).toBe(true);
    expect(pdp.variants.some((v) => v.compareAt)).toBe(true);
    expect(pdp.variants.some((v) => v.available === 0)).toBe(true);
    expect(pdp.breadcrumbs).toHaveLength(3);
    const disc = await be.methods['admin.discounts.list'](actor, { storeId: atlas.id });
    expect(disc.map((d) => (d as { code: string | null }).code).filter(Boolean)).toEqual(expect.arrayContaining(['SALOM10', 'BEPULYETKAZISH']));
  });

  it('generates historical orders in mixed states, with payments and reviews', async () => {
    const { actor } = await be.upsertUser(DEMO_USER);
    for (const s of res.stores) {
      expect(s.orders.placed).toBeGreaterThanOrEqual(DEMO_STORES.find((x) => x.slug === s.slug)!.orders.count * 0.8);
      const list = (await be.methods['admin.orders.list'](actor, { storeId: s.id })) as { items: Array<{ status: string }> };
      const statuses = new Set(list.items.map((o) => o.status));
      expect(statuses.size).toBeGreaterThanOrEqual(3);
    }
    const total = res.stores.reduce((a, s) => a + s.orders.reviews, 0);
    expect(total).toBeGreaterThan(10);
    const mine = await be.methods['orders.mine'](actor, { slug: res.stores[2]!.slug });
    expect((mine as unknown[]).length).toBeGreaterThan(0);
  });

  it('dashboard and analytics have data', async () => {
    const { actor } = await be.upsertUser(DEMO_USER);
    const a = await be.methods['admin.analytics'](actor, { storeId: res.stores[0]!.id, range: '30d' });
    expect(JSON.stringify(a)).toMatch(/\d/);
    expect(res.ms).toBeGreaterThan(0);
  });
});
