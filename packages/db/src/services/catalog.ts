/**
 * Catalog administration: nested categories (any depth), products as aggregates
 * (options → values → variant matrix, media, inventory), collections, inventory ledger.
 */
import {
  buildSearchDoc, buildTree, collectionMatches, DomainError, fromMarkup, isDescendantOrSelf, itemSlug, labelFor, MAX_OPTIONS,
  MAX_VARIANTS, comboKey, nextPosition, pathFor, pick, planMove, positionUpdates, sanitizeRichText, shortId, toMarkup,
  uniqueSiblingSlug, uuidv7, isUuid, adjustPrice, type CollectionRules, type DeleteStrategy, type L10n, type RichText,
} from '@dokonim/core';
import { json, type Sql } from '../client';
import { clampLimit, decodeCursor, encodeCursor, type Actor, type Ctx, type StoreRow } from './ctx';

export interface CategoryRow {
  id: string;
  storeId: string;
  parentId: string | null;
  path: string;
  depth: number;
  slug: string;
  name: L10n;
  description: L10n;
  imageUrl: string | null;
  icon: string | null;
  position: number;
  isHidden: boolean;
}

export interface CategoryNode extends CategoryRow {
  productCount: number; // direct, active
  subtreeCount: number; // active products in the whole subtree
  children: CategoryNode[];
}

const cleanL10n = (v: unknown, max = 200): L10n => {
  const o: L10n = {};
  if (v && typeof v === 'object')
    for (const k of ['uz', 'ru', 'en'] as const) {
      const s = (v as Record<string, unknown>)[k];
      if (typeof s === 'string' && s.trim()) o[k] = s.trim().slice(0, max);
    }
  return o;
};

function requireName(n: L10n): void {
  if (!n.uz && !n.ru && !n.en) throw new DomainError('VALIDATION', 'Name is required', { field: 'name' });
}

const roundSom = (v: number) => Math.max(0, Math.round(v / 100) * 100);

export async function loadCategories(tx: Sql, storeId: string): Promise<CategoryRow[]> {
  return tx.query<CategoryRow>(`select id, store_id, parent_id, path::text as path, depth, slug, name, description, image_url, icon, position, is_hidden from categories where store_id = $1 order by depth, position`, [storeId]);
}

export async function categoryTree(tx: Sql, storeId: string, opts: { includeHidden: boolean }): Promise<CategoryNode[]> {
  const rows = await loadCategories(tx, storeId);
  const counts = await tx.query<{ id: string; direct: number; subtree: number }>(
    `select c.id,
       (select count(*) from products p where p.category_id = c.id and p.status = 'active')::int as direct,
       (select count(*) from products p join categories d on d.id = p.category_id where d.path <@ c.path and p.status = 'active')::int as subtree
     from categories c where c.store_id = $1`,
    [storeId],
  );
  const cm = new Map(counts.map((c) => [c.id, c]));
  const hidden = new Set<string>();
  if (!opts.includeHidden) for (const r of rows) if (r.isHidden) hidden.add(r.path);
  const visible = rows.filter((r) => opts.includeHidden || ![...hidden].some((h) => isDescendantOrSelf(r.path, h)));
  const toNode = (t: ReturnType<typeof buildTree<CategoryRow>>[number]): CategoryNode => ({
    ...t.node,
    productCount: cm.get(t.node.id)?.direct ?? 0,
    subtreeCount: cm.get(t.node.id)?.subtree ?? 0,
    children: t.children.map(toNode),
  });
  return buildTree(visible).map(toNode);
}

async function getCategory(tx: Sql, storeId: string, id: string): Promise<CategoryRow> {
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Category not found');
  const [c] = await tx.query<CategoryRow>(`select id, store_id, parent_id, path::text as path, depth, slug, name, description, image_url, icon, position, is_hidden from categories where store_id = $1 and id = $2`, [storeId, id]);
  if (!c) throw new DomainError('NOT_FOUND', 'Category not found', { id });
  return c;
}

async function siblingSlugs(tx: Sql, storeId: string, parentId: string | null, exceptId?: string): Promise<string[]> {
  const rows = await tx.query<{ slug: string }>(
    `select slug from categories where store_id = $1 and parent_id is not distinct from $2 and id <> coalesce($3, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [storeId, parentId, exceptId ?? null],
  );
  return rows.map((r) => r.slug);
}

/** Creates the chain "Kiyim / Ayollar / Koʻylaklar" (reusing existing nodes by name) and returns the leaf id. */
export async function ensureCategoryPath(tx: Sql, store: StoreRow, names: string[], now: Date): Promise<string | null> {
  let parent = null as CategoryRow | null;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const [existing]: CategoryRow[] = await tx.query<CategoryRow>(
      `select id, store_id, parent_id, path::text as path, depth, slug, name, position, is_hidden from categories
       where store_id = $1 and parent_id is not distinct from $2 and (lower(name->>'uz') = lower($3) or lower(name->>'ru') = lower($3) or lower(name->>'en') = lower($3) or slug = $4)`,
      [store.id, parent?.id ?? null, name, itemSlug(name)],
    );
    if (existing) {
      parent = existing;
      continue;
    }
    const id = uuidv7(now.getTime());
    const siblings = await tx.query<{ position: number }>(`select position from categories where store_id = $1 and parent_id is not distinct from $2`, [store.id, parent?.id ?? null]);
    const slug = uniqueSiblingSlug(itemSlug(name), await siblingSlugs(tx, store.id, parent?.id ?? null));
    const path = pathFor(parent?.path ?? null, id);
    await tx.query(`insert into categories (store_id, id, parent_id, path, slug, name, position) values ($1,$2,$3,$4::ltree,$5,$6::jsonb,$7)`, [
      store.id, id, parent?.id ?? null, path, slug, json({ [store.defaultLocale]: name }), nextPosition(siblings),
    ]);
    parent = { id, path, parentId: parent?.id ?? null } as CategoryRow;
  }
  return parent?.id ?? null;
}

export interface ProductInput {
  storeId: string;
  id?: string;
  status: 'draft' | 'active' | 'archived';
  title: L10n;
  slug?: string;
  /** Per-locale light markup (see core/richtext fromMarkup). */
  description: L10n;
  categoryId: string | null;
  collectionIds: string[];
  tags: string[];
  attributes: Array<{ name: L10n; value: L10n }>;
  isDigital: boolean;
  brand: string;
  vendorCode: string;
  sizeGuide?: L10n | null;
  seo?: { title?: L10n; description?: L10n };
  media: Array<{ url: string; alt?: L10n; kind?: 'image' | 'video'; dominantColor?: string | null }>;
  options: Array<{ id: string; name: L10n; display: 'chips' | 'swatch' | 'image'; values: Array<{ id: string; label: L10n; swatchHex?: string | null }> }>;
  variants: Array<{
    id: string;
    optionValueIds: string[];
    sku: string;
    barcode: string;
    price: number;
    compareAtPrice: number | null;
    costPrice: number | null;
    weightG: number;
    stock: number;
    /**
     * The on_hand the editor loaded. When sent, only the seller's change (stock − stockBase) is applied to the live
     * level, so sales and restocks made while the editor was open are kept. Without it `stock` is absolute (legacy).
     */
    stockBase?: number;
    lowStockThreshold: number;
    trackInventory: boolean;
    allowBackorder: boolean;
    ikpuCode?: string | null;
    packageCode?: string | null;
    vatPercent?: number | null;
    mediaUrl?: string | null;
  }>;
}

export async function refreshProduct(s: Ctx, tx: Sql, store: StoreRow, productId: string): Promise<void> {
  const [p] = await tx.query<{ title: L10n; tags: string[]; brand: string; vendorCode: string; categoryId: string | null; createdAt: string; status: string }>(
    'select title, tags, brand, vendor_code, category_id, created_at, status from products where store_id = $1 and id = $2',
    [store.id, productId],
  );
  if (!p) return;
  const skus = await tx.query<{ sku: string; barcode: string }>('select sku, barcode from product_variants where store_id = $1 and product_id = $2', [store.id, productId]);
  const labels = await tx.query<{ label: L10n }>(
    `select ov.label from option_values ov join product_options po on po.id = ov.option_id where po.store_id = $1 and po.product_id = $2`,
    [store.id, productId],
  );
  let catNames: L10n[] = [];
  let catPath: string | null = null;
  if (p.categoryId) {
    const rows = await tx.query<{ name: L10n; path: string }>(
      `select a.name, c.path::text as path from categories c join categories a on a.store_id = c.store_id and a.path @> c.path where c.store_id = $1 and c.id = $2`,
      [store.id, p.categoryId],
    );
    catNames = rows.map((r) => r.name);
    catPath = rows[0]?.path ?? null;
  }
  const doc = buildSearchDoc([
    ...Object.values(p.title), ...p.tags, p.brand, p.vendorCode, ...skus.flatMap((x) => [x.sku, x.barcode]),
    ...catNames.flatMap((n) => Object.values(n)), ...labels.flatMap((l) => Object.values(l.label)),
  ]);
  await tx.query(
    `update products p set
       min_price = coalesce((select min(price) from product_variants v where v.product_id = p.id), 0),
       max_price = coalesce((select max(price) from product_variants v where v.product_id = p.id), 0),
       max_compare_at = (select max(compare_at_price) from product_variants v where v.product_id = p.id and compare_at_price > price),
       in_stock = exists(select 1 from product_variants v left join inventory_levels l on l.variant_id = v.id
                         where v.product_id = p.id and (not v.track_inventory or v.allow_backorder or coalesce(l.on_hand - l.reserved, 0) > 0)),
       cover_url = (select url from product_media m where m.product_id = p.id order by position limit 1),
       search_doc = $3, updated_at = $4
     where store_id = $1 and id = $2`,
    [store.id, productId, doc, s.now().toISOString()],
  );
  // automated collections
  const autos = await tx.query<{ id: string; rules: CollectionRules }>(`select id, rules from collections where store_id = $1 and kind = 'automated'`, [store.id]);
  if (autos.length) {
    const subj = await ruleSubject(tx, store.id, productId, catPath, s.now());
    for (const c of autos) {
      const rules = await resolveRuleCategoryPaths(tx, store.id, c.rules);
      const m = subj && p.status === 'active' && collectionMatches(rules, subj, s.now());
      if (m) await tx.query(`insert into product_collections (store_id, collection_id, product_id) values ($1,$2,$3) on conflict do nothing`, [store.id, c.id, productId]);
      else await tx.query(`delete from product_collections where collection_id = $1 and product_id = $2`, [c.id, productId]);
    }
  }
}

async function ruleSubject(tx: Sql, storeId: string, productId: string, catPath: string | null, _now: Date) {
  const [r] = await tx.query<{ tags: string[]; minPrice: number; maxCompareAt: number | null; createdAt: string; brand: string; title: L10n; inStock: boolean }>(
    'select tags, min_price, max_compare_at, created_at, brand, title, in_stock from products where store_id = $1 and id = $2',
    [storeId, productId],
  );
  if (!r) return null;
  return { tags: r.tags, minPrice: r.minPrice, categoryPath: catPath, onSale: (r.maxCompareAt ?? 0) > r.minPrice, createdAt: r.createdAt, vendor: r.brand, title: Object.values(r.title).join(' '), inStock: r.inStock };
}

/** Collection rules reference categories by id (stable under moves); core evaluates by path. */
export async function resolveRuleCategoryPaths(tx: Sql, storeId: string, rules: CollectionRules): Promise<CollectionRules> {
  const out: CollectionRules = { match: rules.match, rules: [] };
  for (const r of rules.rules) {
    if (r.field === 'category' && typeof r.value === 'string' && isUuid(r.value)) {
      const [c] = await tx.query<{ path: string }>('select path::text as path from categories where store_id = $1 and id = $2', [storeId, r.value]);
      out.rules.push({ ...r, value: c?.path ?? '__missing__' });
    } else out.rules.push(r);
  }
  return out;
}

async function refreshCollection(s: Ctx, tx: Sql, store: StoreRow, collectionId: string): Promise<void> {
  const [c] = await tx.query<{ kind: string; rules: CollectionRules }>('select kind, rules from collections where store_id = $1 and id = $2', [store.id, collectionId]);
  if (!c || c.kind !== 'automated') return;
  const rules = await resolveRuleCategoryPaths(tx, store.id, c.rules);
  const rows = await tx.query<{ id: string; tags: string[]; minPrice: number; maxCompareAt: number | null; createdAt: string; brand: string; title: L10n; inStock: boolean; path: string | null }>(
    `select p.id, p.tags, p.min_price, p.max_compare_at, p.created_at, p.brand, p.title, p.in_stock, c.path::text as path
     from products p left join categories c on c.id = p.category_id where p.store_id = $1 and p.status = 'active'`,
    [store.id],
  );
  await tx.query('delete from product_collections where collection_id = $1', [collectionId]);
  let pos = 0;
  for (const r of rows) {
    const subj = { tags: r.tags, minPrice: r.minPrice, categoryPath: r.path, onSale: (r.maxCompareAt ?? 0) > r.minPrice, createdAt: r.createdAt, vendor: r.brand, title: Object.values(r.title).join(' '), inStock: r.inStock };
    if (collectionMatches(rules, subj, s.now()))
      await tx.query('insert into product_collections (store_id, collection_id, product_id, position) values ($1,$2,$3,$4)', [store.id, collectionId, r.id, pos++]);
  }
}

export interface ProductRow {
  id: string; storeId: string; shortId: string; status: 'draft' | 'active' | 'archived'; title: L10n; slug: string; description: Record<string, RichText>;
  categoryId: string | null; tags: string[]; attributes: Array<{ name: L10n; value: L10n }>; isDigital: boolean; brand: string; vendorCode: string;
  sizeGuide: L10n | null; seo: Record<string, unknown>; ratingAvg: number; ratingCount: number; soldCount: number; viewCount: number; minPrice: number; maxPrice: number;
  maxCompareAt: number | null; inStock: boolean; coverUrl: string | null; searchDoc: string; publishedAt: string | null; createdAt: string; updatedAt: string;
}

export interface VariantRow {
  id: string; productId: string; optionValueIds: string[]; sku: string; barcode: string; price: number; compareAtPrice: number | null; costPrice: number | null;
  weightG: number; ikpuCode: string | null; packageCode: string | null; vatPercent: number | null; isDefault: boolean; position: number; mediaUrl: string | null;
  trackInventory: boolean; allowBackorder: boolean;
}

export async function loadProductAggregate(tx: Sql, storeId: string, productId: string) {
  if (!isUuid(productId)) throw new DomainError('NOT_FOUND', 'Product not found');
  const [p] = await tx.query<ProductRow>('select * from products where store_id = $1 and id = $2', [storeId, productId]);
  if (!p) throw new DomainError('NOT_FOUND', 'Product not found', { id: productId });
  const options = await tx.query<{ id: string; position: number; name: L10n; display: string }>('select id, position, name, display from product_options where store_id = $1 and product_id = $2 order by position', [storeId, productId]);
  const values = await tx.query<{ id: string; optionId: string; position: number; label: L10n; swatchHex: string | null }>(
    `select ov.id, ov.option_id, ov.position, ov.label, ov.swatch_hex from option_values ov join product_options po on po.id = ov.option_id where po.store_id = $1 and po.product_id = $2 order by ov.position`,
    [storeId, productId],
  );
  const variants = await tx.query<VariantRow & { onHand: number | null; reserved: number | null; lowStockThreshold: number | null }>(
    `select v.*, l.on_hand, l.reserved, l.low_stock_threshold from product_variants v left join inventory_levels l on l.variant_id = v.id where v.store_id = $1 and v.product_id = $2 order by v.position`,
    [storeId, productId],
  );
  const media = await tx.query<{ id: string; url: string; kind: string; alt: L10n; position: number; dominantColor: string | null }>('select id, url, kind, alt, position, dominant_color from product_media where store_id = $1 and product_id = $2 order by position', [storeId, productId]);
  const collections = await tx.query<{ collectionId: string }>('select collection_id from product_collections where store_id = $1 and product_id = $2', [storeId, productId]);
  return {
    ...p,
    descriptionMarkup: Object.fromEntries(Object.entries(p.description ?? {}).map(([k, v]) => [k, toMarkup(v)])) as L10n,
    options: options.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id) })),
    variants: variants.map((v) => ({ ...v, stock: v.onHand ?? 0, available: (v.onHand ?? 0) - (v.reserved ?? 0) })),
    media,
    collectionIds: collections.map((c) => c.collectionId),
  };
}

export function catalogService(s: Ctx) {
  const audit = (tx: Sql, store: StoreRow, actor: Actor, role: string, action: string, type: string, id: string | null, before: unknown, after: unknown) =>
    s.audit(tx, store.id, actor, role as never, action, type, id, before, after);

  async function saveProduct(actor: Actor, input: ProductInput) {
    return s.staff(input.storeId, actor, 'catalog.write', async (tx, m) => {
      const store = m.store;
      const now = s.now();
      const title = cleanL10n(input.title, 200);
      requireName(title);
      if (input.options.length > MAX_OPTIONS) throw new DomainError('OPTION_LIMIT');
      if (input.variants.length === 0) throw new DomainError('VALIDATION', 'A product needs at least one variant', { field: 'variants' });
      if (input.variants.length > MAX_VARIANTS) throw new DomainError('VARIANT_LIMIT');
      for (const o of input.options) {
        requireName(cleanL10n(o.name));
        if (!o.values.length) throw new DomainError('VALIDATION', 'Every option needs at least one value', { field: 'options' });
      }
      // variant ↔ option consistency
      const seen = new Set<string>();
      for (const v of input.variants) {
        if (v.optionValueIds.length !== input.options.length) throw new DomainError('VALIDATION', 'Variant does not match options', { variantId: v.id });
        v.optionValueIds.forEach((vid, i) => {
          if (!input.options[i]!.values.some((x) => x.id === vid)) throw new DomainError('VALIDATION', 'Unknown option value', { variantId: v.id });
        });
        const k = comboKey(v.optionValueIds);
        if (seen.has(k)) throw new DomainError('VALIDATION', 'Duplicate variant combination', { variantId: v.id });
        seen.add(k);
        if (!Number.isFinite(v.price) || v.price < 0) throw new DomainError('VALIDATION', 'Price must be ≥ 0', { variantId: v.id, field: 'price' });
        if (!Number.isInteger(v.stock) || v.stock < 0) throw new DomainError('VALIDATION', 'Stock must be a whole number ≥ 0', { variantId: v.id, field: 'stock' });
      }
      const allIds = [input.id, ...input.options.map((o) => o.id), ...input.options.flatMap((o) => o.values.map((v) => v.id)), ...input.variants.map((v) => v.id)].filter(Boolean) as string[];
      if (allIds.some((x) => !isUuid(x))) throw new DomainError('VALIDATION', 'Ids must be UUIDs');
      if (input.categoryId) await getCategory(tx, store.id, input.categoryId);
      if (input.isDigital && input.variants.some((v) => v.weightG > 0)) {
        /* digital goods have no weight — silently ignored */
      }
      const isNew = !input.id || !(await tx.query('select 1 from products where store_id = $1 and id = $2', [store.id, input.id])).length;
      if (isNew) {
        const [{ n }] = (await tx.query<{ n: number }>(`select count(*)::int as n from products where store_id = $1 and status <> 'archived'`, [store.id])) as [{ n: number }];
        if (n >= (store.planFlags?.productLimit ?? 500)) throw new DomainError('VALIDATION', 'Product limit of your plan reached', { limit: store.planFlags.productLimit });
      }
      const id = input.id && isUuid(input.id) ? input.id : uuidv7(now.getTime());
      const before = isNew ? null : await loadProductAggregate(tx, store.id, id);
      const description: Record<string, RichText> = {};
      for (const [k, v] of Object.entries(input.description ?? {})) if (typeof v === 'string' && v.trim()) description[k] = fromMarkup(v.slice(0, 20_000));
      const slug = itemSlug(input.slug || pick(title, store.defaultLocale));
      const attrs = (input.attributes ?? []).slice(0, 40).map((a) => ({ name: cleanL10n(a.name, 80), value: cleanL10n(a.value, 400) })).filter((a) => Object.keys(a.name).length);
      const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
      if (isNew) {
        await tx.query(
          `insert into products (store_id, id, short_id, status, title, slug, description, category_id, tags, attributes, is_digital, brand, vendor_code, size_guide, seo, published_at, created_at, updated_at)
           values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::text[],$10::jsonb,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$17)`,
          [store.id, id, shortId(), input.status, json(title), slug, json(description), input.categoryId, tags, json(attrs), !!input.isDigital, input.brand?.slice(0, 80) ?? '', input.vendorCode?.slice(0, 80) ?? '',
            input.sizeGuide ? json(cleanL10n(input.sizeGuide, 4000)) : null, json(input.seo ?? {}), input.status === 'active' ? now.toISOString() : null, now.toISOString()],
        );
      } else {
        await tx.query(
          `update products set status = $3, title = $4::jsonb, slug = $5, description = $6::jsonb, category_id = $7, tags = $8::text[], attributes = $9::jsonb, is_digital = $10,
             brand = $11, vendor_code = $12, size_guide = $13::jsonb, seo = $14::jsonb, published_at = coalesce(published_at, case when $3 = 'active' then $15::timestamptz end), updated_at = $15
           where store_id = $1 and id = $2`,
          [store.id, id, input.status, json(title), slug, json(description), input.categoryId, tags, json(attrs), !!input.isDigital, input.brand ?? '', input.vendorCode ?? '',
            input.sizeGuide ? json(cleanL10n(input.sizeGuide, 4000)) : null, json(input.seo ?? {}), now.toISOString()],
        );
      }
      // ── options & values (upsert by id, delete missing)
      const optIds = input.options.map((o) => o.id);
      await tx.query(`delete from product_options where store_id = $1 and product_id = $2 and not (id = any($3::uuid[]))`, [store.id, id, optIds]);
      for (const [i, o] of input.options.entries()) {
        await tx.query(
          `insert into product_options (store_id, id, product_id, position, name, display) values ($1,$2,$3,$4,$5::jsonb,$6)
           on conflict (id) do update set position = excluded.position, name = excluded.name, display = excluded.display where product_options.product_id = excluded.product_id`,
          [store.id, o.id, id, i + 1, json(cleanL10n(o.name, 60)), o.display],
        );
        await tx.query(`delete from option_values where store_id = $1 and option_id = $2 and not (id = any($3::uuid[]))`, [store.id, o.id, o.values.map((v) => v.id)]);
        for (const [k, v] of o.values.entries())
          await tx.query(
            `insert into option_values (store_id, id, option_id, position, label, swatch_hex) values ($1,$2,$3,$4,$5::jsonb,$6)
             on conflict (id) do update set position = excluded.position, label = excluded.label, swatch_hex = excluded.swatch_hex where option_values.option_id = excluded.option_id`,
            [store.id, v.id, o.id, k, json(cleanL10n(v.label, 60)), v.swatchHex && /^#[0-9a-f]{6}$/i.test(v.swatchHex) ? v.swatchHex : null],
          );
      }
      // ── variants
      const varIds = input.variants.map((v) => v.id);
      await tx.query(`delete from product_variants where store_id = $1 and product_id = $2 and not (id = any($3::uuid[]))`, [store.id, id, varIds]);
      const single = input.options.length === 0;
      for (const [i, v] of input.variants.entries()) {
        const price = roundSom(v.price);
        const compare = v.compareAtPrice && v.compareAtPrice > price ? roundSom(v.compareAtPrice) : null;
        await tx.query(
          `insert into product_variants (store_id, id, product_id, option_value_ids, sku, barcode, price, compare_at_price, cost_price, weight_g, ikpu_code, package_code, vat_percent, is_default, position, media_url, track_inventory, allow_backorder)
           values ($1,$2,$3,$4::uuid[],$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           on conflict (id) do update set option_value_ids = excluded.option_value_ids, sku = excluded.sku, barcode = excluded.barcode, price = excluded.price,
             compare_at_price = excluded.compare_at_price, cost_price = excluded.cost_price, weight_g = excluded.weight_g, ikpu_code = excluded.ikpu_code,
             package_code = excluded.package_code, vat_percent = excluded.vat_percent, is_default = excluded.is_default, position = excluded.position,
             media_url = excluded.media_url, track_inventory = excluded.track_inventory, allow_backorder = excluded.allow_backorder
           where product_variants.product_id = excluded.product_id`,
          [store.id, v.id, id, v.optionValueIds, (v.sku ?? '').slice(0, 64), (v.barcode ?? '').slice(0, 64), price, compare, v.costPrice != null ? roundSom(v.costPrice) : null, Math.max(0, Math.round(v.weightG || 0)),
            v.ikpuCode || null, v.packageCode || null, v.vatPercent ?? null, single, i, v.mediaUrl || null, v.trackInventory !== false, !!v.allowBackorder],
        );
        const [lvl] = await tx.query<{ onHand: number; reserved: number }>('select on_hand, reserved from inventory_levels where variant_id = $1 for update', [v.id]);
        if (!lvl) {
          await tx.query('insert into inventory_levels (store_id, variant_id, on_hand, reserved, low_stock_threshold) values ($1,$2,$3,0,$4)', [store.id, v.id, v.stock, Math.max(0, v.lowStockThreshold ?? 3)]);
          if (v.stock) await movement(tx, store.id, v.id, v.stock, 'initial', actor, 'product', id, '');
        } else {
          const target = v.stockBase != null && Number.isInteger(v.stockBase) ? lvl.onHand + (v.stock - v.stockBase) : v.stock;
          if (target !== lvl.onHand) {
            if (target < lvl.reserved || target < 0) throw new DomainError('VALIDATION', 'Stock cannot go below reserved units', { variantId: v.id, reserved: lvl.reserved });
            await tx.query('update inventory_levels set on_hand = $2 where variant_id = $1', [v.id, target]);
            await movement(tx, store.id, v.id, target - lvl.onHand, 'adjustment', actor, 'product', id, 'editor');
          }
          await tx.query('update inventory_levels set low_stock_threshold = $2 where variant_id = $1', [v.id, Math.max(0, v.lowStockThreshold ?? 3)]);
        }
      }
      // ── media
      await tx.query('delete from product_media where store_id = $1 and product_id = $2', [store.id, id]);
      for (const [i, md] of input.media.slice(0, 15).entries()) {
        if (!/^(https?:|data:image\/|data:video\/|blob:|\.?\/|assets\/)/.test(md.url)) throw new DomainError('VALIDATION', 'Unsupported media URL', { field: 'media' });
        await tx.query('insert into product_media (store_id, id, product_id, kind, url, position, alt, dominant_color) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)', [
          store.id, uuidv7(now.getTime()), id, md.kind ?? 'image', md.url, i, json(cleanL10n(md.alt ?? {}, 200)), md.dominantColor ?? null,
        ]);
      }
      // ── manual collections
      const manual = await tx.query<{ id: string }>(`select id from collections where store_id = $1 and kind = 'manual'`, [store.id]);
      const manualIds = new Set(manual.map((c) => c.id));
      await tx.query(`delete from product_collections pc using collections c where pc.collection_id = c.id and c.kind = 'manual' and pc.store_id = $1 and pc.product_id = $2`, [store.id, id]);
      for (const cid of input.collectionIds ?? []) if (manualIds.has(cid)) await tx.query('insert into product_collections (store_id, collection_id, product_id) values ($1,$2,$3) on conflict do nothing', [store.id, cid, id]);
      await refreshProduct(s, tx, store, id);
      const after = await loadProductAggregate(tx, store.id, id);
      await audit(tx, store, actor, m.role, isNew ? 'product.create' : 'product.update', 'product', id, before ? strip(before) : null, strip(after));
      return after;
    });
  }

  return {
    // ── Categories ──────────────────────────────────────────────────────────
    'admin.categories.tree': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) => categoryTree(tx, i.storeId, { includeHidden: true }), { write: false }),

    'admin.categories.create': async (actor: Actor, i: { storeId: string; parentId: string | null; name: L10n; slug?: string; icon?: string | null; imageUrl?: string | null; isHidden?: boolean; description?: L10n }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const name = cleanL10n(i.name, 80);
        requireName(name);
        const parent = i.parentId ? await getCategory(tx, m.store.id, i.parentId) : null;
        const id = uuidv7(s.now().getTime());
        const slug = uniqueSiblingSlug(itemSlug(i.slug || pick(name, m.store.defaultLocale)), await siblingSlugs(tx, m.store.id, parent?.id ?? null));
        const siblings = await tx.query<{ position: number }>('select position from categories where store_id = $1 and parent_id is not distinct from $2', [m.store.id, parent?.id ?? null]);
        await tx.query(
          `insert into categories (store_id, id, parent_id, path, slug, name, description, icon, image_url, is_hidden, position) values ($1,$2,$3,$4::ltree,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
          [m.store.id, id, parent?.id ?? null, pathFor(parent?.path ?? null, id), slug, json(name), json(cleanL10n(i.description ?? {}, 1000)), i.icon ?? null, i.imageUrl ?? null, !!i.isHidden, nextPosition(siblings)],
        );
        const created = await getCategory(tx, m.store.id, id);
        await audit(tx, m.store, actor, m.role, 'category.create', 'category', id, null, created);
        return created;
      }),

    'admin.categories.update': async (actor: Actor, i: { storeId: string; id: string; name?: L10n; slug?: string; icon?: string | null; imageUrl?: string | null; isHidden?: boolean; description?: L10n }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const before = await getCategory(tx, m.store.id, i.id);
        const name = i.name ? cleanL10n(i.name, 80) : before.name;
        requireName(name);
        let slug = before.slug;
        if (i.slug !== undefined && i.slug !== before.slug) {
          const want = itemSlug(i.slug || pick(name, m.store.defaultLocale));
          const taken = await siblingSlugs(tx, m.store.id, before.parentId, before.id);
          if (taken.includes(want)) throw new DomainError('SLUG_TAKEN', 'Another category at this level uses this address', { slug: want, suggestion: uniqueSiblingSlug(want, taken) });
          slug = want;
        }
        await tx.query(
          `update categories set name = $3::jsonb, slug = $4, icon = $5, image_url = $6, is_hidden = $7, description = $8::jsonb, updated_at = $9 where store_id = $1 and id = $2`,
          [m.store.id, i.id, json(name), slug, i.icon !== undefined ? i.icon : before.icon, i.imageUrl !== undefined ? i.imageUrl : before.imageUrl, i.isHidden ?? before.isHidden,
            json(i.description ? cleanL10n(i.description, 1000) : before.description), s.now().toISOString()],
        );
        const after = await getCategory(tx, m.store.id, i.id);
        await audit(tx, m.store, actor, m.role, 'category.update', 'category', i.id, before, after);
        // renames change search docs of products in the subtree
        const prods = await tx.query<{ id: string }>(`select p.id from products p join categories c on c.id = p.category_id where p.store_id = $1 and c.path <@ $2::ltree`, [m.store.id, after.path]);
        for (const p of prods) await refreshProduct(s, tx, m.store, p.id);
        return after;
      }),

    /** Move (re-parent) and/or reorder. index = position among the new siblings. */
    'admin.categories.move': async (actor: Actor, i: { storeId: string; id: string; parentId: string | null; index: number }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const node = await getCategory(tx, m.store.id, i.id);
        const parent = i.parentId ? await getCategory(tx, m.store.id, i.parentId) : null;
        const [{ maxDepth }] = (await tx.query<{ maxDepth: number }>('select coalesce(max(depth), 0)::int as max_depth from categories where store_id = $1 and path <@ $2::ltree', [m.store.id, node.path])) as [{ maxDepth: number }];
        const { newPath } = planMove(node, parent, maxDepth);
        // SQL re-check of the cycle rule (defence in depth)
        if (parent) {
          const [cyc] = await tx.query<{ c: boolean }>('select $1::ltree <@ $2::ltree as c', [parent.path, node.path]);
          if (cyc?.c) throw new DomainError('CATEGORY_CYCLE');
        }
        let slug: string;
        if (node.parentId !== (parent?.id ?? null)) {
          slug = uniqueSiblingSlug(node.slug, await siblingSlugs(tx, m.store.id, parent?.id ?? null, node.id));
          await tx.query(`update categories set path = case when nlevel(path) > nlevel($2::ltree) then $3::ltree || subpath(path, nlevel($2::ltree)) else $3::ltree end where store_id = $1 and path <@ $2::ltree`, [m.store.id, node.path, newPath]);
          await tx.query('update categories set parent_id = $3, slug = $4, updated_at = $5 where store_id = $1 and id = $2', [m.store.id, node.id, parent?.id ?? null, slug, s.now().toISOString()]);
        }
        const siblings = await tx.query<{ id: string; position: number }>('select id, position from categories where store_id = $1 and parent_id is not distinct from $2', [m.store.id, parent?.id ?? null]);
        for (const u of positionUpdates(siblings, node.id, i.index)) await tx.query('update categories set position = $3 where store_id = $1 and id = $2', [m.store.id, u.id, u.position]);
        const after = await getCategory(tx, m.store.id, node.id);
        await audit(tx, m.store, actor, m.role, 'category.move', 'category', node.id, { parentId: node.parentId, path: node.path, position: node.position }, { parentId: after.parentId, path: after.path, position: after.position });
        return after;
      }),

    'admin.categories.delete': async (actor: Actor, i: { storeId: string; id: string; strategy: DeleteStrategy }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const node = await getCategory(tx, m.store.id, i.id);
        const sid = m.store.id;
        const subtreeProducts = await tx.query<{ id: string }>(`select p.id from products p join categories c on c.id = p.category_id where p.store_id = $1 and c.path <@ $2::ltree`, [sid, node.path]);
        let affected: number;
        if (i.strategy.kind === 'reparent_children') {
          const parent = node.parentId ? await getCategory(tx, sid, node.parentId) : null;
          const children = await tx.query<{ id: string; slug: string; path: string }>('select id, slug, path::text as path from categories where store_id = $1 and parent_id = $2 order by position', [sid, node.id]);
          for (const c of children) {
            const slug = uniqueSiblingSlug(c.slug, await siblingSlugs(tx, sid, parent?.id ?? null, c.id));
            const np = pathFor(parent?.path ?? null, c.id);
            await tx.query(`update categories set path = case when nlevel(path) > nlevel($2::ltree) then $3::ltree || subpath(path, nlevel($2::ltree)) else $3::ltree end where store_id = $1 and path <@ $2::ltree`, [sid, c.path, np]);
            await tx.query('update categories set parent_id = $3, slug = $4 where store_id = $1 and id = $2', [sid, c.id, parent?.id ?? null, slug]);
          }
          const r = await tx.query<{ id: string }>('update products set category_id = $3 where store_id = $1 and category_id = $2 returning id', [sid, node.id, parent?.id ?? null]);
          affected = r.length;
          await tx.query('delete from categories where store_id = $1 and id = $2', [sid, node.id]);
        } else {
          if (i.strategy.kind === 'reassign_products') {
            const target = await getCategory(tx, sid, i.strategy.targetId);
            if (isDescendantOrSelf(target.path, node.path)) throw new DomainError('CATEGORY_CYCLE', 'Target is inside the category being deleted');
            const r = await tx.query<{ id: string }>(`update products set category_id = $3 where store_id = $1 and category_id in (select id from categories where store_id = $1 and path <@ $2::ltree) returning id`, [sid, node.path, target.id]);
            affected = r.length;
          } else {
            const r = await tx.query<{ id: string }>(
              `update products set status = 'archived', category_id = null where store_id = $1 and category_id in (select id from categories where store_id = $1 and path <@ $2::ltree) returning id`,
              [sid, node.path],
            );
            affected = r.length;
          }
          const levels = await tx.query<{ depth: number }>('select distinct depth from categories where store_id = $1 and path <@ $2::ltree order by depth desc', [sid, node.path]);
          for (const l of levels) await tx.query('delete from categories where store_id = $1 and path <@ $2::ltree and depth = $3', [sid, node.path, l.depth]);
        }
        for (const p of subtreeProducts) await refreshProduct(s, tx, m.store, p.id);
        await audit(tx, m.store, actor, m.role, 'category.delete', 'category', node.id, { ...node, strategy: i.strategy }, null);
        return { deleted: node.id, productsAffected: affected };
      }),

    // ── Products ────────────────────────────────────────────────────────────
    'admin.products.list': async (actor: Actor, i: { storeId: string; q?: string; status?: 'draft' | 'active' | 'archived' | 'all'; categoryId?: string | null; lowStock?: boolean; cursor?: string; limit?: number }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => {
        const lim = clampLimit(i.limit, 30);
        const off = decodeCursor(i.cursor);
        const params: unknown[] = [i.storeId];
        const where = ['p.store_id = $1'];
        if (i.status && i.status !== 'all') params.push(i.status), where.push(`p.status = $${params.length}`);
        else if (!i.status) where.push(`p.status <> 'archived'`);
        if (i.categoryId) params.push(i.categoryId), where.push(`p.category_id in (select d.id from categories c join categories d on d.path <@ c.path where c.id = $${params.length})`);
        if (i.q?.trim()) {
          params.push(i.q.trim().toLowerCase());
          where.push(`(p.search_doc like '%' || $${params.length} || '%' or word_similarity($${params.length}, p.search_doc) > 0.4)`);
        }
        if (i.lowStock) where.push(`exists (select 1 from product_variants v join inventory_levels l on l.variant_id = v.id where v.product_id = p.id and v.track_inventory and l.on_hand - l.reserved <= l.low_stock_threshold)`);
        params.push(lim + 1, off);
        const rows = await tx.query<Record<string, unknown>>(
          `select p.id, p.short_id, p.status, p.title, p.cover_url, p.min_price, p.max_price, p.max_compare_at, p.in_stock, p.category_id, p.sold_count, p.rating_avg, p.rating_count, p.updated_at, p.is_digital,
             (select coalesce(sum(l.on_hand - l.reserved), 0)::int from product_variants v join inventory_levels l on l.variant_id = v.id where v.product_id = p.id) as available,
             (select count(*)::int from product_variants v where v.product_id = p.id) as variant_count
           from products p where ${where.join(' and ')} order by p.updated_at desc limit $${params.length - 1} offset $${params.length}`,
          params,
        );
        const [{ total }] = (await tx.query<{ total: number }>(`select count(*)::int as total from products p where ${where.join(' and ')}`, params.slice(0, -2))) as [{ total: number }];
        return { items: rows.slice(0, lim), nextCursor: rows.length > lim ? encodeCursor(off + lim) : null, total };
      }, { write: false }),

    'admin.products.get': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) => loadProductAggregate(tx, i.storeId, i.id), { write: false }),

    'admin.products.save': saveProduct,

    'admin.products.duplicate': async (actor: Actor, i: { storeId: string; id: string }) => {
      const src = await s.staff(i.storeId, actor, 'catalog.write', (tx) => loadProductAggregate(tx, i.storeId, i.id));
      const now = s.now().getTime();
      const optMap = new Map<string, string>();
      const options = src.options.map((o) => ({
        id: uuidv7(now), name: o.name, display: o.display as 'chips',
        values: o.values.map((v) => {
          const nid = uuidv7(now);
          optMap.set(v.id, nid);
          return { id: nid, label: v.label, swatchHex: v.swatchHex };
        }),
      }));
      const title = src.title as L10n;
      return saveProduct(actor, {
        storeId: i.storeId, status: 'draft',
        title: Object.fromEntries(Object.entries(title).map(([k, v]) => [k, `${v} (${k === 'ru' ? 'копия' : k === 'en' ? 'copy' : 'nusxa'})`])),
        description: src.descriptionMarkup, categoryId: src.categoryId as string | null, collectionIds: src.collectionIds, tags: src.tags as string[],
        attributes: src.attributes as ProductInput['attributes'], isDigital: src.isDigital as boolean, brand: src.brand as string, vendorCode: src.vendorCode as string,
        media: src.media.map((m) => ({ url: m.url, alt: m.alt, kind: m.kind as 'image' })), options,
        variants: src.variants.map((v) => ({
          id: uuidv7(now), optionValueIds: v.optionValueIds.map((x) => optMap.get(x)!), sku: v.sku ? `${v.sku}-COPY` : '', barcode: '', price: v.price as number,
          compareAtPrice: v.compareAtPrice as number | null, costPrice: v.costPrice as number | null, weightG: v.weightG as number, stock: 0, lowStockThreshold: 3,
          trackInventory: v.trackInventory as boolean, allowBackorder: v.allowBackorder as boolean, ikpuCode: v.ikpuCode as string | null, packageCode: v.packageCode as string | null, vatPercent: v.vatPercent as number | null,
        })),
      });
    },

    'admin.products.bulk': async (actor: Actor, i: { storeId: string; ids: string[]; action: 'activate' | 'draft' | 'archive' | 'move_category' | 'adjust_price' | 'add_tag' | 'remove_tag' | 'add_to_collection' | 'remove_from_collection'; params?: { categoryId?: string | null; percent?: number; tag?: string; collectionId?: string } }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const ids = i.ids.filter(isUuid).slice(0, 500);
        const sid = m.store.id;
        const p = i.params ?? {};
        switch (i.action) {
          case 'activate':
          case 'draft':
          case 'archive': {
            const st = i.action === 'activate' ? 'active' : i.action === 'draft' ? 'draft' : 'archived';
            await tx.query(`update products set status = $3, published_at = coalesce(published_at, case when $3 = 'active' then now() end) where store_id = $1 and id = any($2::uuid[])`, [sid, ids, st]);
            break;
          }
          case 'move_category':
            if (p.categoryId) await getCategory(tx, sid, p.categoryId);
            await tx.query('update products set category_id = $3 where store_id = $1 and id = any($2::uuid[])', [sid, ids, p.categoryId ?? null]);
            break;
          case 'adjust_price': {
            const pct = Number(p.percent);
            if (!Number.isFinite(pct) || pct <= -100 || pct > 1000) throw new DomainError('VALIDATION', 'Percent must be between -99 and 1000', { field: 'percent' });
            const vs = await tx.query<{ id: string; price: number }>('select id, price from product_variants where store_id = $1 and product_id = any($2::uuid[])', [sid, ids]);
            for (const v of vs) await tx.query('update product_variants set price = $2 where id = $1', [v.id, adjustPrice(v.price, pct)]);
            break;
          }
          case 'add_tag':
          case 'remove_tag': {
            const tag = (p.tag ?? '').trim().toLowerCase();
            if (!tag) throw new DomainError('VALIDATION', 'Tag is required', { field: 'tag' });
            if (i.action === 'add_tag') await tx.query(`update products set tags = array(select distinct unnest(tags || array[$3::text])) where store_id = $1 and id = any($2::uuid[])`, [sid, ids, tag]);
            else await tx.query('update products set tags = array_remove(tags, $3) where store_id = $1 and id = any($2::uuid[])', [sid, ids, tag]);
            break;
          }
          case 'add_to_collection':
          case 'remove_from_collection': {
            const [c] = await tx.query<{ kind: string }>('select kind from collections where store_id = $1 and id = $2', [sid, p.collectionId ?? null]);
            if (!c || c.kind !== 'manual') throw new DomainError('VALIDATION', 'Pick a manual collection', { field: 'collectionId' });
            for (const id of ids)
              if (i.action === 'add_to_collection') await tx.query('insert into product_collections (store_id, collection_id, product_id) values ($1,$2,$3) on conflict do nothing', [sid, p.collectionId, id]);
              else await tx.query('delete from product_collections where collection_id = $1 and product_id = $2', [p.collectionId, id]);
          }
        }
        for (const id of ids) await refreshProduct(s, tx, m.store, id);
        await audit(tx, m.store, actor, m.role, `product.bulk.${i.action}`, 'product', null, null, { ids, params: p });
        return { updated: ids.length };
      }),

    // ── Inventory ───────────────────────────────────────────────────────────
    'admin.inventory.list': async (actor: Actor, i: { storeId: string; lowStock?: boolean; q?: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => {
        const rows = await tx.query<{ variantId: string; sku: string; optionValueIds: string[]; trackInventory: boolean; allowBackorder: boolean; productId: string; title: L10n; coverUrl: string | null; onHand: number; reserved: number; lowStockThreshold: number; available: number }>(
          `select v.id as variant_id, v.sku, v.option_value_ids, v.track_inventory, v.allow_backorder, p.id as product_id, p.title, p.cover_url, l.on_hand, l.reserved, l.low_stock_threshold,
             (l.on_hand - l.reserved) as available
           from product_variants v join products p on p.id = v.product_id join inventory_levels l on l.variant_id = v.id
           where v.store_id = $1 and p.status <> 'archived' ${i.lowStock ? 'and v.track_inventory and l.on_hand - l.reserved <= l.low_stock_threshold' : ''}
             ${i.q ? `and (p.search_doc like '%' || lower($2) || '%' or lower(v.sku) like '%' || lower($2) || '%')` : ''}
           order by (l.on_hand - l.reserved) asc, p.title->>'uz' limit 300`,
          i.q ? [i.storeId, i.q] : [i.storeId],
        );
        const labels = await tx.query<{ id: string; label: L10n }>('select id, label from option_values where store_id = $1', [i.storeId]);
        const lm = new Map(labels.map((l) => [l.id, l.label]));
        return rows.map((r) => ({ ...r, variantLabels: r.optionValueIds.map((x) => lm.get(x) ?? {}) }));
      }, { write: false }),

    'admin.inventory.adjust': async (actor: Actor, i: { storeId: string; variantId: string; delta: number; reason: 'purchase' | 'adjustment' | 'return'; note?: string }) =>
      s.staff(i.storeId, actor, 'inventory.adjust', async (tx, m) => {
        if (!Number.isInteger(i.delta) || i.delta === 0) throw new DomainError('VALIDATION', 'Enter a whole number other than zero', { field: 'delta' });
        const [lvl] = await tx.query<{ onHand: number; reserved: number; productId: string }>(
          'select l.on_hand, l.reserved, v.product_id from inventory_levels l join product_variants v on v.id = l.variant_id where l.store_id = $1 and l.variant_id = $2 for update of l',
          [m.store.id, i.variantId],
        );
        if (!lvl) throw new DomainError('NOT_FOUND', 'Variant not found');
        if (lvl.onHand + i.delta < lvl.reserved) throw new DomainError('VALIDATION', 'Stock cannot go below reserved units', { reserved: lvl.reserved, onHand: lvl.onHand });
        await tx.query('update inventory_levels set on_hand = on_hand + $2 where variant_id = $1', [i.variantId, i.delta]);
        await movement(tx, m.store.id, i.variantId, i.delta, i.reason, actor, 'manual', null, i.note ?? '');
        await refreshProduct(s, tx, m.store, lvl.productId);
        await audit(tx, m.store, actor, m.role, 'inventory.adjust', 'variant', i.variantId, { onHand: lvl.onHand }, { onHand: lvl.onHand + i.delta, reason: i.reason, note: i.note });
        return { onHand: lvl.onHand + i.delta, reserved: lvl.reserved, available: lvl.onHand + i.delta - lvl.reserved };
      }),

    'admin.inventory.movements': async (actor: Actor, i: { storeId: string; variantId?: string; limit?: number }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(
          `select m.*, p.title, v.sku from inventory_movements m join product_variants v on v.id = m.variant_id join products p on p.id = v.product_id
           where m.store_id = $1 ${i.variantId ? 'and m.variant_id = $3' : ''} order by m.created_at desc limit $2`,
          i.variantId ? [i.storeId, clampLimit(i.limit, 100, 500), i.variantId] : [i.storeId, clampLimit(i.limit, 100, 500)],
        ), { write: false }),

    'admin.inventory.reservations': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(
          `select r.*, o.number, o.status, p.title, v.sku from inventory_reservations r join orders o on o.id = r.order_id join product_variants v on v.id = r.variant_id join products p on p.id = v.product_id
           where r.store_id = $1 order by r.expires_at`,
          [i.storeId],
        ), { write: false }),

    // ── Collections ─────────────────────────────────────────────────────────
    'admin.collections.list': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(`select c.*, (select count(*)::int from product_collections pc where pc.collection_id = c.id) as product_count from collections c where c.store_id = $1 order by c.position, c.created_at`, [i.storeId]), { write: false }),

    'admin.collections.save': async (actor: Actor, i: { storeId: string; id?: string; title: L10n; slug?: string; description?: L10n; kind: 'manual' | 'automated'; rules?: CollectionRules; productIds?: string[]; imageUrl?: string | null; isHidden?: boolean }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const title = cleanL10n(i.title, 120);
        requireName(title);
        const id = i.id && isUuid(i.id) ? i.id : uuidv7(s.now().getTime());
        const [before] = await tx.query('select * from collections where store_id = $1 and id = $2', [m.store.id, id]);
        const slugBase = itemSlug(i.slug || pick(title, m.store.defaultLocale));
        const taken = (await tx.query<{ slug: string }>('select slug from collections where store_id = $1 and id <> $2', [m.store.id, id])).map((r) => r.slug);
        const slug = uniqueSiblingSlug(slugBase, taken);
        const rules: CollectionRules = { match: i.rules?.match === 'any' ? 'any' : 'all', rules: (i.rules?.rules ?? []).slice(0, 20) };
        await tx.query(
          `insert into collections (store_id, id, title, slug, description, kind, rules, image_url, is_hidden) values ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7::jsonb,$8,$9)
           on conflict (id) do update set title = excluded.title, slug = excluded.slug, description = excluded.description, kind = excluded.kind, rules = excluded.rules, image_url = excluded.image_url, is_hidden = excluded.is_hidden
           where collections.store_id = excluded.store_id`,
          [m.store.id, id, json(title), slug, json(cleanL10n(i.description ?? {}, 1000)), i.kind, json(rules), i.imageUrl ?? null, !!i.isHidden],
        );
        if (i.kind === 'manual') {
          await tx.query('delete from product_collections where collection_id = $1', [id]);
          for (const [k, pid] of (i.productIds ?? []).filter(isUuid).entries())
            await tx.query(`insert into product_collections (store_id, collection_id, product_id, position) select $1, $2, id, $4 from products where store_id = $1 and id = $3 on conflict do nothing`, [m.store.id, id, pid, k]);
        } else await refreshCollection(s, tx, m.store, id);
        const [after] = await tx.query('select * from collections where id = $1', [id]);
        await audit(tx, m.store, actor, m.role, before ? 'collection.update' : 'collection.create', 'collection', id, before ?? null, after);
        return after;
      }),

    'admin.collections.delete': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const [before] = await tx.query('delete from collections where store_id = $1 and id = $2 returning *', [m.store.id, i.id]);
        if (!before) throw new DomainError('NOT_FOUND');
        await audit(tx, m.store, actor, m.role, 'collection.delete', 'collection', i.id, before, null);
        return { deleted: i.id };
      }),

    'admin.collections.get': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => {
        const [c] = await tx.query('select * from collections where store_id = $1 and id = $2', [i.storeId, i.id]);
        if (!c) throw new DomainError('NOT_FOUND');
        const products = await tx.query(`select p.id, p.title, p.cover_url, p.min_price, p.status from product_collections pc join products p on p.id = pc.product_id where pc.collection_id = $1 order by pc.position`, [i.id]);
        return { ...c, products };
      }, { write: false }),

    'admin.collections.previewRules': async (actor: Actor, i: { storeId: string; rules: CollectionRules }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => {
        const rules = await resolveRuleCategoryPaths(tx, i.storeId, i.rules);
        const rows = await tx.query<{ id: string; tags: string[]; minPrice: number; maxCompareAt: number | null; createdAt: string; brand: string; title: L10n; inStock: boolean; path: string | null; coverUrl: string | null }>(
          `select p.id, p.tags, p.min_price, p.max_compare_at, p.created_at, p.brand, p.title, p.in_stock, p.cover_url, c.path::text as path from products p left join categories c on c.id = p.category_id where p.store_id = $1 and p.status = 'active'`,
          [i.storeId],
        );
        const hits = rows.filter((r) =>
          collectionMatches(rules, { tags: r.tags, minPrice: r.minPrice, categoryPath: r.path, onSale: (r.maxCompareAt ?? 0) > r.minPrice, createdAt: r.createdAt, vendor: r.brand, title: Object.values(r.title).join(' '), inStock: r.inStock }, s.now()),
        );
        return { count: hits.length, sample: hits.slice(0, 8).map((h) => ({ id: h.id, title: h.title, coverUrl: h.coverUrl, minPrice: h.minPrice })) };
      }, { write: false }),
  };
}

export async function movement(tx: Sql, storeId: string, variantId: string, delta: number, reason: string, actor: Actor, refType: string | null, refId: string | null, note: string): Promise<void> {
  await tx.query(
    'insert into inventory_movements (store_id, id, variant_id, delta, reason, ref_type, ref_id, note, actor_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [storeId, uuidv7(), variantId, delta, reason, refType, refId, note.slice(0, 300), actor.userId],
  );
}

function strip(a: Record<string, unknown>): Record<string, unknown> {
  const { searchDoc: _s, updatedAt: _u, viewCount: _v, ...rest } = a as Record<string, unknown> & { searchDoc?: unknown; updatedAt?: unknown; viewCount?: unknown };
  return rest;
}

export { labelFor, sanitizeRichText };
