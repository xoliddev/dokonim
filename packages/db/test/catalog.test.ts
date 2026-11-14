import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, verifyTree, type DomainError } from '@dokonim/core';
import { ADAPTERS, seedStore, setup, variantProduct, type H } from './harness';

describe.each(ADAPTERS)('catalog on $name', ({ make }) => {
  let h: H;
  let ctx: Awaited<ReturnType<typeof seedStore>>;
  beforeAll(async () => {
    h = await setup(make);
    ctx = await seedStore(h);
  });
  afterAll(() => h.close());

  const tree = () => h.m['admin.categories.tree'](ctx.owner, { storeId: ctx.store.id });
  const flat = async () => {
    const out: Array<{ id: string; parentId: string | null; path: string; slug: string; position: number }> = [];
    const walk = (ns: Awaited<ReturnType<typeof tree>>) => ns.forEach((n) => (out.push(n), walk(n.children)));
    walk(await tree());
    return out;
  };

  it('onboarding seeded categories, shipping, theme and sandbox payments', async () => {
    const t = await tree();
    expect(t.map((n) => n.name.uz)).toEqual(expect.arrayContaining(['Ayollar', 'Erkaklar', 'Bolalar', 'Kiyim']));
    const ship = await h.m['admin.shipping.get'](ctx.owner, { storeId: ctx.store.id });
    expect(ship.methods).toHaveLength(3);
    expect(ship.rates.length).toBeGreaterThanOrEqual(3);
    const pays = await h.m['admin.payments.list'](ctx.owner, { storeId: ctx.store.id });
    expect(pays.filter((p) => (p as { enabled: boolean }).enabled).map((p) => (p as { provider: string }).provider).sort()).toEqual(['click', 'cod', 'payme']);
    const theme = await h.m['admin.theme.get'](ctx.owner, { storeId: ctx.store.id });
    expect(theme.published?.tokens.brand).toMatch(/^#/);
  });

  it('builds a 4-level tree with subtree product counts and consistent paths', async () => {
    const kiyim = (await tree()).find((n) => n.id === ctx.cats.kiyim.id)!;
    expect(kiyim.subtreeCount).toBe(1);
    expect(kiyim.children[0]!.children[0]!.children[0]!.name.uz).toBe('Atlas koʻylaklar');
    expect(ctx.cats.atlas.depth).toBe(4);
    expect(verifyTree(await flat())).toEqual([]);
  });

  it('rejects empty names and duplicate sibling slugs on rename', async () => {
    await expect(h.m['admin.categories.create'](ctx.owner, { storeId: ctx.store.id, parentId: null, name: {} })).rejects.toMatchObject({ code: 'VALIDATION' });
    const a = await h.m['admin.categories.create'](ctx.owner, { storeId: ctx.store.id, parentId: ctx.cats.kiyim.id, name: { uz: 'Shimlar' } });
    const dupe = await h.m['admin.categories.create'](ctx.owner, { storeId: ctx.store.id, parentId: ctx.cats.kiyim.id, name: { uz: 'Shimlar' } });
    expect(dupe.slug).toBe('shimlar-2');
    await expect(h.m['admin.categories.update'](ctx.owner, { storeId: ctx.store.id, id: dupe.id, slug: 'shimlar' })).rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    const renamed = await h.m['admin.categories.update'](ctx.owner, { storeId: ctx.store.id, id: dupe.id, name: { uz: 'Yubkalar' }, slug: 'yubkalar' });
    expect(renamed.slug).toBe('yubkalar');
    expect(renamed.path).toBe(dupe.path); // renames never touch paths
    await h.m['admin.categories.delete'](ctx.owner, { storeId: ctx.store.id, id: a.id, strategy: { kind: 'reparent_children' } });
    await h.m['admin.categories.delete'](ctx.owner, { storeId: ctx.store.id, id: renamed.id, strategy: { kind: 'reparent_children' } });
  });

  it('moves a whole subtree, rewrites descendant paths and blocks cycles', async () => {
    await expect(h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: ctx.cats.ayollar.id, parentId: ctx.cats.atlas.id, index: 0 })).rejects.toMatchObject({ code: 'CATEGORY_CYCLE' });
    await expect(h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: ctx.cats.ayollar.id, parentId: ctx.cats.ayollar.id, index: 0 })).rejects.toMatchObject({ code: 'CATEGORY_CYCLE' });
    const moved = await h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: ctx.cats.koylak.id, parentId: null, index: 0 });
    expect(moved.parentId).toBeNull();
    expect(moved.depth).toBe(1);
    const roots = await tree();
    expect(roots[0]!.id).toBe(ctx.cats.koylak.id);
    expect(roots[0]!.children[0]!.depth).toBe(2);
    expect(roots[0]!.subtreeCount).toBe(1);
    expect(verifyTree(await flat())).toEqual([]);
    // storefront drill-down follows the new slug path
    const r = await h.m['store.categoryByPath']({ ...ctx.owner }, { slug: ctx.store.slug, path: ['koylaklar', 'atlas-koylaklar'] });
    expect(r.category?.id).toBe(ctx.cats.atlas.id);
    // and back under Ayollar at index 0
    await h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: ctx.cats.koylak.id, parentId: ctx.cats.ayollar.id, index: 0 });
    expect(verifyTree(await flat())).toEqual([]);
  });

  it('reorders siblings', async () => {
    const roots = await tree();
    const last = roots[roots.length - 1]!;
    await h.m['admin.categories.move'](ctx.owner, { storeId: ctx.store.id, id: last.id, parentId: null, index: 0 });
    expect((await tree())[0]!.id).toBe(last.id);
  });

  it('delete strategies: reparent children, reassign products, archive subtree', async () => {
    const sid = ctx.store.id;
    const top = await h.m['admin.categories.create'](ctx.owner, { storeId: sid, parentId: null, name: { uz: 'Vaqtinchalik' } });
    const child = await h.m['admin.categories.create'](ctx.owner, { storeId: sid, parentId: top.id, name: { uz: 'Bola' } });
    const grand = await h.m['admin.categories.create'](ctx.owner, { storeId: sid, parentId: child.id, name: { uz: 'Nevara' } });
    const p = await h.m['admin.products.save'](ctx.owner, variantProduct(sid, child.id, { title: 'Vaqtinchalik mahsulot' }));
    await h.m['admin.categories.delete'](ctx.owner, { storeId: sid, id: child.id, strategy: { kind: 'reparent_children' } });
    let after = await flat();
    expect(after.find((n) => n.id === grand.id)?.parentId).toBe(top.id);
    expect((await h.m['admin.products.get'](ctx.owner, { storeId: sid, id: p.id })).categoryId).toBe(top.id);
    await expect(h.m['admin.categories.delete'](ctx.owner, { storeId: sid, id: top.id, strategy: { kind: 'reassign_products', targetId: grand.id } })).rejects.toMatchObject({ code: 'CATEGORY_CYCLE' });
    await h.m['admin.categories.delete'](ctx.owner, { storeId: sid, id: top.id, strategy: { kind: 'reassign_products', targetId: ctx.cats.atlas.id } });
    after = await flat();
    expect(after.some((n) => n.id === top.id || n.id === grand.id)).toBe(false);
    expect((await h.m['admin.products.get'](ctx.owner, { storeId: sid, id: p.id })).categoryId).toBe(ctx.cats.atlas.id);
    const tmp = await h.m['admin.categories.create'](ctx.owner, { storeId: sid, parentId: null, name: { uz: 'Arxiv' } });
    const p2 = await h.m['admin.products.save'](ctx.owner, variantProduct(sid, tmp.id, { title: 'Arxivlanadi' }));
    await h.m['admin.categories.delete'](ctx.owner, { storeId: sid, id: tmp.id, strategy: { kind: 'archive_subtree' } });
    expect((await h.m['admin.products.get'](ctx.owner, { storeId: sid, id: p2.id })).status).toBe('archived');
    expect(verifyTree(await flat())).toEqual([]);
  });

  it('product aggregate: variant matrix, stock ledger, edit, validation', async () => {
    const p = await h.m['admin.products.get'](ctx.owner, { storeId: ctx.store.id, id: ctx.product.id });
    expect(p.options).toHaveLength(2);
    expect(p.variants).toHaveLength(4);
    expect(p.descriptionMarkup.uz).toBe('Qoʻlda **tikilgan** atlas.');
    const input = variantProduct(ctx.store.id, ctx.cats.atlas.id);
    // round-trip edit: drop one colour → 2 variants remain, stock change recorded
    const edited = {
      ...input, id: p.id, options: p.options.map((o) => ({ id: o.id, name: o.name, display: o.display as 'chips', values: o.values.map((v) => ({ id: v.id, label: v.label, swatchHex: v.swatchHex })) })),
      variants: p.variants.map((v) => ({ id: v.id, optionValueIds: v.optionValueIds, sku: v.sku, barcode: '', price: v.price, compareAtPrice: v.compareAtPrice, costPrice: v.costPrice, weightG: v.weightG, stock: 7, lowStockThreshold: 2, trackInventory: true, allowBackorder: false })),
    };
    edited.options[1]!.values = edited.options[1]!.values.slice(0, 1);
    edited.variants = edited.variants.filter((v) => v.optionValueIds[1] === edited.options[1]!.values[0]!.id);
    const saved = await h.m['admin.products.save'](ctx.owner, edited);
    expect(saved.variants).toHaveLength(2);
    expect(saved.variants.every((v) => v.stock === 7)).toBe(true);
    const mv = await h.m['admin.inventory.movements'](ctx.owner, { storeId: ctx.store.id, variantId: saved.variants[0]!.id });
    expect(mv.map((x) => (x as { reason: string }).reason)).toEqual(['adjustment', 'initial']);
    await expect(h.m['admin.products.save'](ctx.owner, { ...edited, variants: [...edited.variants, { ...edited.variants[0]!, id: uuidv7() }] })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.m['admin.products.save'](ctx.owner, { ...edited, title: {} })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(h.m['admin.products.save'](ctx.owner, { ...edited, variants: [{ ...edited.variants[0]!, optionValueIds: [uuidv7(), uuidv7()] }] })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('inventory adjust cannot go below reserved and is audited', async () => {
    const p = await h.m['admin.products.get'](ctx.owner, { storeId: ctx.store.id, id: ctx.product.id });
    const v = p.variants[0]!;
    const r = await h.m['admin.inventory.adjust'](ctx.owner, { storeId: ctx.store.id, variantId: v.id, delta: 3, reason: 'purchase', note: 'Yangi partiya' });
    expect(r.onHand).toBe(v.stock + 3);
    await expect(h.m['admin.inventory.adjust'](ctx.owner, { storeId: ctx.store.id, variantId: v.id, delta: -1000, reason: 'adjustment' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const audit = await h.m['admin.audit'](ctx.owner, { storeId: ctx.store.id, entityType: 'variant' });
    expect(audit.items[0]).toMatchObject({ action: 'inventory.adjust' });
  });

  it('duplicate, bulk actions and collections (manual + automated)', async () => {
    const copy = await h.m['admin.products.duplicate'](ctx.owner, { storeId: ctx.store.id, id: ctx.product.id });
    expect(copy.status).toBe('draft');
    expect((copy.title as { uz: string }).uz).toContain('nusxa');
    await h.m['admin.products.bulk'](ctx.owner, { storeId: ctx.store.id, ids: [copy.id], action: 'activate' });
    await h.m['admin.products.bulk'](ctx.owner, { storeId: ctx.store.id, ids: [copy.id], action: 'adjust_price', params: { percent: -10 } });
    const after = await h.m['admin.products.get'](ctx.owner, { storeId: ctx.store.id, id: copy.id });
    expect(after.status).toBe('active');
    expect(after.variants[0]!.price).toBe(40_500_000);
    const auto = await h.m['admin.collections.save'](ctx.owner, { storeId: ctx.store.id, title: { uz: 'Atlaslar' }, kind: 'automated', rules: { match: 'all', rules: [{ field: 'category', op: 'in_subtree', value: ctx.cats.kiyim.id }] } });
    const got = await h.m['admin.collections.get'](ctx.owner, { storeId: ctx.store.id, id: (auto as { id: string }).id });
    expect((got.products as unknown[]).length).toBeGreaterThanOrEqual(2);
    const prev = await h.m['admin.collections.previewRules'](ctx.owner, { storeId: ctx.store.id, rules: { match: 'all', rules: [{ field: 'tag', op: 'eq', value: 'atlas' }] } });
    expect(prev.count).toBeGreaterThanOrEqual(2);
    const manual = await h.m['admin.collections.save'](ctx.owner, { storeId: ctx.store.id, title: { uz: 'Tanlov' }, kind: 'manual', productIds: [ctx.product.id] });
    const mg = await h.m['admin.collections.get'](ctx.owner, { storeId: ctx.store.id, id: (manual as { id: string }).id });
    expect((mg.products as unknown[]).length).toBe(1);
  });

  it('storefront: subtree listing, facets with counts, transliterated search, PDP availability', async () => {
    const buyer = await h.user('Sardor');
    const list = await h.m['store.products'](buyer, { slug: ctx.store.slug, categoryId: ctx.cats.kiyim.id });
    expect(list.total).toBeGreaterThanOrEqual(1);
    const f = await h.m['store.facets'](buyer, { slug: ctx.store.slug, categoryId: ctx.cats.kiyim.id });
    expect(f.options.find((o) => o.name === 'Oʻlcham')?.values.map((v) => v.label).sort()).toEqual(['M', 'S']);
    const bySize = await h.m['store.products'](buyer, { slug: ctx.store.slug, options: { Oʻlcham: ['S'] } });
    expect(bySize.total).toBeGreaterThanOrEqual(1);
    for (const q of ['кўйлак', "ko'ylak", 'koylak', 'AD-S-Qizil']) {
      const r = await h.m['store.products'](buyer, { slug: ctx.store.slug, q });
      expect(r.items.some((i) => i.id === ctx.product.id), q).toBe(true);
    }
    const pdp = await h.m['store.product'](buyer, { slug: ctx.store.slug, id: ctx.product.id });
    expect(pdp.variants.length).toBeGreaterThan(0);
    expect(pdp.breadcrumbs.map((b) => b.slug)).toEqual(['kiyim', 'ayollar', 'koylaklar', 'atlas-koylaklar']);
    expect(pdp.shipping.map((s) => s.type)).toEqual(expect.arrayContaining(['courier', 'self_pickup']));
    expect(pdp.installments.map((x) => x.months)).toEqual([3, 6, 12]);
    const sug = await h.m['store.suggest'](buyer, { slug: ctx.store.slug, q: 'atlas' });
    expect(sug.products.length).toBeGreaterThan(0);
    const home = await h.m['store.home'](buyer, { slug: ctx.store.slug });
    expect(home.newest.length).toBeGreaterThan(0);
  });

  it('CSV import builds nested categories from category paths (dry run, then real)', async () => {
    const csv = [
      'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price,Variant Inventory Qty,Category Path',
      'chopon,Chopon,Oʻlcham,L,CH-L,900000,2,Kiyim / Erkaklar / Ustki / Choponlar',
      'chopon,,,XL,CH-XL,950000,1,',
      'bad,Bad,,,,abc,1,Kiyim',
    ].join('\n');
    const dry = await h.m['admin.import.products'](ctx.owner, { storeId: ctx.store.id, csv, dryRun: true });
    expect(dry.products).toBe(1);
    expect(dry.errors.map((e) => e.code)).toEqual(['bad_price']);
    expect(dry.newCategories).toContain('Kiyim / Erkaklar / Ustki / Choponlar');
    const real = await h.m['admin.import.products'](ctx.owner, { storeId: ctx.store.id, csv, dryRun: false });
    expect(real.imported).toBe(1);
    const t = await flat();
    expect(verifyTree(t)).toEqual([]);
    const exp = await h.m['admin.export.products'](ctx.owner, { storeId: ctx.store.id });
    expect(exp.csv).toContain('Kiyim / Erkaklar / Ustki / Choponlar');
    expect(exp.csv).toContain('CH-XL');
  });

  it('theme: draft → publish → restore, versions kept', async () => {
    const t0 = await h.m['admin.theme.get'](ctx.owner, { storeId: ctx.store.id });
    await h.m['admin.theme.saveDraft'](ctx.owner, { storeId: ctx.store.id, tokens: { ...t0.draft!.tokens, brand: '#0e7c86', radius: 'round' }, sections: t0.draft!.sections });
    const pub = await h.m['admin.theme.publish'](ctx.owner, { storeId: ctx.store.id });
    const st = await h.m['store.get']({ userId: null, telegramId: null, isPlatformAdmin: false, locale: 'uz' }, { slug: ctx.store.slug });
    expect(st.theme.tokens.brand).toBe('#0e7c86');
    const t1 = await h.m['admin.theme.get'](ctx.owner, { storeId: ctx.store.id });
    expect(t1.versions.length).toBeGreaterThanOrEqual(2);
    await h.m['admin.theme.restore'](ctx.owner, { storeId: ctx.store.id, version: 1 });
    const t2 = await h.m['admin.theme.get'](ctx.owner, { storeId: ctx.store.id });
    expect(t2.draft!.tokens.brand).toBe(t0.published!.tokens.brand);
    expect(pub.version).toBeGreaterThan(1);
  });

  it('error objects carry stable codes', async () => {
    const e = await h.m['admin.products.get'](ctx.owner, { storeId: ctx.store.id, id: uuidv7() }).catch((x: DomainError) => x);
    expect((e as DomainError).code).toBe('NOT_FOUND');
  });
});
