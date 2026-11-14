/** Turns a StoreSpec into a live store through the real backend services. */
import { fromMajor, seededUuid, type Clock } from '@dokonim/core';
import type { Actor, Backend, CategoryNode, ProductInput, StoreRow } from '@dokonim/db';
import { artDataUrl, artUrl } from './art';
import type { CatSpec, ProductSpec, StoreSpec } from './spec';

const DAY = 86_400_000;

/** A settable clock so seeded rows get believable timestamps (products added weeks ago, orders over a month). */
export class SeedClock implements Clock {
  constructor(public t: number) {}
  now = () => new Date(this.t);
  set(ms: number) {
    this.t = ms;
  }
}

export interface SeedCtx {
  be: Backend;
  clock: SeedClock;
  /** Real "now" the demo is anchored to. */
  anchor: number;
  rand: () => number;
  owner: Actor;
}

export interface BuiltVariant {
  id: string;
  stock: number;
  price: number;
}
export interface BuiltProduct {
  id: string;
  key: string;
  title: string;
  variants: BuiltVariant[];
}
export interface BuiltStore {
  spec: StoreSpec;
  store: StoreRow;
  products: BuiltProduct[];
  categoryIds: Map<string, string>;
}

const id = (c: SeedCtx) => seededUuid(c.rand, c.clock.t);

async function clearDefaultCategories(c: SeedCtx, storeId: string) {
  const m = c.be.methods;
  for (let guard = 0; guard < 50; guard++) {
    const tree = (await m['admin.categories.tree'](c.owner, { storeId })) as CategoryNode[];
    if (!tree.length) return;
    const leaf = (n: CategoryNode): CategoryNode => (n.children.length ? leaf(n.children[0]!) : n);
    await m['admin.categories.delete'](c.owner, { storeId, id: leaf(tree[0]!).id, strategy: { kind: 'reparent_children' } });
  }
}

async function createCategories(c: SeedCtx, storeId: string, nodes: CatSpec[], parentId: string | null, prefix: string, out: Map<string, string>) {
  for (const n of nodes) {
    const row = await c.be.methods['admin.categories.create'](c.owner, { storeId, parentId, name: n.name, icon: n.icon ?? null });
    const path = prefix ? `${prefix}/${n.name.uz}` : n.name.uz!;
    out.set(path, row.id);
    if (n.children?.length) await createCategories(c, storeId, n.children, row.id, path, out);
  }
}

export function productInput(c: SeedCtx, storeId: string, categoryId: string | null, p: ProductSpec): ProductInput & { storeId: string } {
  const sizeOpt = p.sizes
    ? { id: id(c), name: p.sizes.name ?? { uz: 'Oʻlcham', ru: 'Размер', en: 'Size' }, display: 'chips' as const, values: p.sizes.values.map((v) => ({ id: id(c), label: { uz: v, ru: v, en: v } })) }
    : null;
  const colorOpt = p.colors?.length
    ? { id: id(c), name: { uz: 'Rang', ru: 'Цвет', en: 'Colour' }, display: 'swatch' as const, values: p.colors.map((x) => ({ id: id(c), label: x.label, swatchHex: x.hex })) }
    : null;
  const options = [sizeOpt, colorOpt].filter((o): o is NonNullable<typeof o> => !!o);
  const sizes = sizeOpt?.values ?? [null];
  const colors = colorOpt?.values ?? [null];
  const stocks = Array.isArray(p.stock) ? p.stock : [p.stock ?? 10];
  const art = (hex?: string, pat = p.art.p) => artDataUrl(artUrl(p.art.kind, { c: hex ?? p.art.c, c2: p.art.c2, p: pat }));
  const variants: ProductInput['variants'] = [];
  sizes.forEach((s, si) =>
    colors.forEach((col, ci) => {
      const delta = p.sizes?.delta?.[si] ?? 0;
      const price = fromMajor(p.price + delta);
      const k = variants.length;
      variants.push({
        id: id(c), optionValueIds: [s?.id, col?.id].filter((x): x is string => !!x), sku: `${p.key.toUpperCase()}-${k + 1}`, barcode: '',
        price, compareAtPrice: p.was ? fromMajor(p.was + delta) : null, costPrice: Math.round((price * 0.58) / 100) * 100,
        weightG: p.weightG ?? 300, stock: stocks[k % stocks.length]!, lowStockThreshold: 2, trackInventory: true, allowBackorder: false,
        mediaUrl: col ? art(p.colors![ci]!.hex) : null,
      });
    }),
  );
  const firstHex = p.colors?.[0]?.hex;
  const alt = p.art.p === 'ikat' ? 'suzani' : p.art.p === 'suzani' ? 'stripe' : 'ikat';
  return {
    storeId, id: id(c), status: 'active', title: p.title, description: p.desc, categoryId, collectionIds: [], tags: p.tags ?? [],
    attributes: (p.attrs ?? []).map(([name, value]) => ({ name, value })), isDigital: false, brand: p.brand ?? '', vendorCode: p.key.toUpperCase(),
    media: [{ url: art(firstHex), alt: p.title }, { url: art(firstHex, alt), alt: p.title }],
    options, variants,
  } as ProductInput & { storeId: string };
}

export async function buildStore(c: SeedCtx, spec: StoreSpec): Promise<BuiltStore> {
  const m = c.be.methods;
  c.clock.set(c.anchor - 95 * DAY);
  const { store } = await m['stores.create'](c.owner, { name: spec.name, slug: spec.slug, businessType: spec.businessType, presetId: spec.preset, locale: 'uz', ...(spec.brand ? { brand: spec.brand } : {}) });
  await m['admin.store.update'](c.owner, { storeId: store.id, name: spec.nameL10n, tagline: spec.tagline, settings: spec.settings, locales: ['uz', 'ru', 'en'], defaultLocale: 'uz' });
  await clearDefaultCategories(c, store.id);
  const categoryIds = new Map<string, string>();
  await createCategories(c, store.id, spec.categories, null, '', categoryIds);

  const products: BuiltProduct[] = [];
  for (const p of spec.products) {
    const catId = categoryIds.get(p.cat);
    if (!catId) throw new Error(`seed: unknown category "${p.cat}" for ${p.key}`);
    c.clock.set(c.anchor - (p.ageDays ?? 30) * DAY - Math.floor(c.rand() * 6) * 3_600_000);
    const input = productInput(c, store.id, catId, p);
    await m['admin.products.save'](c.owner, input);
    products.push({ id: input.id!, key: p.key, title: p.title.uz!, variants: input.variants.map((v) => ({ id: v.id, stock: v.stock, price: v.price })) });
  }

  c.clock.set(c.anchor - 60 * DAY);
  const byKey = (k: string) => products.find((x) => x.key === k)?.id;
  const ids = (keys?: string[]) => (keys ?? []).map(byKey).filter((x): x is string => !!x);
  for (const pr of spec.promos) {
    const flash = pr.kind === 'flash_sale';
    await m['admin.discounts.save'](c.owner, {
      storeId: store.id, kind: pr.kind, title: pr.title, code: pr.code ?? null, valueType: pr.valueType, value: pr.valueType === 'fixed' ? fromMajor(pr.value) : pr.value,
      appliesTo: pr.products ? { type: 'products', ids: ids(pr.products) } : { type: 'all' },
      conditions: pr.minSubtotal ? { minSubtotal: fromMajor(pr.minSubtotal) } : {},
      startsAt: flash ? new Date(c.anchor - 6 * 3_600_000).toISOString() : null,
      endsAt: flash ? new Date(c.anchor + (pr.endsInHours ?? 24) * 3_600_000).toISOString() : null,
      usageLimit: pr.usageLimit ?? null, combines: { order: true, product: true, shipping: true },
    });
  }

  c.clock.set(c.anchor);
  for (const col of spec.collections) {
    await m['admin.collections.save'](c.owner, {
      storeId: store.id, title: col.title, kind: col.kind,
      ...(col.kind === 'automated' ? { rules: { match: 'all' as const, rules: [{ field: 'created_within_days' as const, op: 'lt' as const, value: col.newerThanDays ?? 14 }] } } : { productIds: ids(col.products) }),
    });
  }
  return { spec, store, products, categoryIds };
}
