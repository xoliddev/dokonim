/** Public storefront reads: home data, category drill-down, listing + facets + search, PDP, social proof. */
import {
  breadcrumbs, compileTheme, displayPrice, discountPercent, DomainError, installment, isUuid, resolveSlugPath, sanitizeSections,
  sanitizeTokens, searchKey, slugPathOf, type DiscountRule, type L10n,
} from '@dokonim/core';
import type { Sql } from '../client';
import { categoryTree, loadCategories, type CategoryRow } from './catalog';
import { clampLimit, decodeCursor, encodeCursor, type Actor, type Ctx, type StoreRow } from './ctx';
import { loadDiscountRules, productPricingMeta, shippingOptions } from './pricing-data';

export type SortKey = 'popular' | 'new' | 'price_asc' | 'price_desc' | 'rating' | 'discount' | 'relevance';

export interface ListingQuery {
  slug: string;
  categoryId?: string | null;
  collectionId?: string | null;
  q?: string | null;
  sort?: SortKey;
  priceMin?: number | null;
  priceMax?: number | null;
  options?: Record<string, string[]>;
  inStock?: boolean;
  onSale?: boolean;
  ratingGte?: number | null;
  ids?: string[];
  cursor?: string | null;
  limit?: number;
}

export interface ProductCard {
  id: string;
  shortId: string;
  title: L10n;
  coverUrl: string | null;
  secondUrl: string | null;
  dominantColor: string | null;
  price: number;
  maxPrice: number;
  compareAt: number | null;
  discountPercent: number;
  flashEndsAt: string | null;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  inStock: boolean;
  isDigital: boolean;
  quickAddVariantId: string | null;
  available: number | null;
  createdAt: string;
  monthly: number | null;
}

/** On-sale predicate shared by listing filters and facets (compare-at OR an active automatic product discount). */
const ON_SALE_SQL = `(p.max_compare_at > p.min_price or exists (
  select 1 from discounts d where d.store_id = p.store_id and d.status = 'active' and d.kind <> 'code' and d.value_type in ('percent','fixed')
    and (d.starts_at is null or d.starts_at <= $NOW) and (d.ends_at is null or d.ends_at > $NOW)
    and ((d.kind = 'flash_sale' and d.applies_to->>'type' = 'all')
      or (d.applies_to->>'type' = 'products' and d.applies_to->'ids' ? p.id::text)
      or (d.applies_to->>'type' = 'collections' and exists (select 1 from product_collections pc where pc.product_id = p.id and d.applies_to->'ids' ? pc.collection_id::text))
      or (d.applies_to->>'type' = 'category' and exists (select 1 from categories dc join categories pcat on pcat.id = p.category_id
            where d.applies_to->'ids' ? dc.id::text and pcat.path <@ dc.path)))))`;

function buildWhere(store: StoreRow, q: ListingQuery, now: Date, skipFacet?: string): { where: string; params: unknown[] } {
  const params: unknown[] = [store.id];
  const w = [`p.store_id = $1`, `p.status = 'active'`];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (q.categoryId) w.push(`p.category_id in (select d.id from categories c join categories d on d.store_id = c.store_id and d.path <@ c.path where c.store_id = $1 and c.id = ${add(q.categoryId)})`);
  if (q.collectionId) w.push(`exists (select 1 from product_collections pc where pc.product_id = p.id and pc.collection_id = ${add(q.collectionId)})`);
  if (q.ids?.length) w.push(`p.id = any(${add(q.ids.filter(isUuid))}::uuid[])`);
  const term = q.q ? searchKey(q.q) : '';
  if (term) {
    const t = add(term);
    w.push(`(p.search_doc like '%' || ${t} || '%' or word_similarity(${t}, p.search_doc) > 0.45 or exists (select 1 from product_variants v where v.product_id = p.id and lower(v.sku) = lower(${add(q.q!.trim())})))`);
  }
  if (skipFacet !== 'price') {
    if (q.priceMin != null) w.push(`p.min_price >= ${add(q.priceMin)}`);
    if (q.priceMax != null) w.push(`p.min_price <= ${add(q.priceMax)}`);
  }
  if (q.inStock && skipFacet !== 'inStock') w.push('p.in_stock');
  if (q.onSale && skipFacet !== 'onSale') w.push(ON_SALE_SQL.replaceAll('$NOW', add(now.toISOString())));
  if (q.ratingGte && skipFacet !== 'rating') w.push(`p.rating_avg >= ${add(q.ratingGte)}`);
  for (const [name, vals] of Object.entries(q.options ?? {})) {
    if (!vals?.length || skipFacet === `opt:${name}`) continue;
    const n = add(name.toLowerCase());
    const v = add(vals.map((x) => x.toLowerCase()));
    w.push(`exists (select 1 from product_options po join option_values ov on ov.option_id = po.id
      where po.product_id = p.id and lower(coalesce(po.name->>'${store.defaultLocale}', po.name->>'uz')) = ${n}
        and lower(coalesce(ov.label->>'${store.defaultLocale}', ov.label->>'uz')) = any(${v}::text[]))`);
  }
  return { where: w.join(' and '), params };
}

function orderBy(sort: SortKey | undefined, hasQuery: boolean, params: unknown[], q?: string | null): string {
  switch (sort ?? (hasQuery ? 'relevance' : 'popular')) {
    case 'new':
      return 'p.created_at desc';
    case 'price_asc':
      return 'p.min_price asc, p.id';
    case 'price_desc':
      return 'p.min_price desc, p.id';
    case 'rating':
      return 'p.rating_avg desc, p.rating_count desc';
    case 'discount':
      return 'coalesce((p.max_compare_at - p.min_price)::float / nullif(p.max_compare_at, 0), 0) desc, p.sold_count desc';
    case 'relevance':
      if (q) {
        params.push(searchKey(q));
        return `word_similarity($${params.length}, p.search_doc) desc, p.sold_count desc`;
      }
      return 'p.sold_count desc';
    default:
      return 'p.sold_count desc, p.rating_count desc, p.created_at desc';
  }
}

export async function toCards(tx: Sql, store: StoreRow, rows: Array<Record<string, unknown>>, now: Date, discounts?: DiscountRule[]): Promise<ProductCard[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const rules = discounts ?? (await loadDiscountRules(tx, store.id, { onlyAutomatic: true }));
  const meta = await productPricingMeta(tx, store.id, ids);
  const vs = await tx.query<{ productId: string; id: string; available: number; trackInventory: boolean; allowBackorder: boolean; n: number }>(
    `select v.product_id, v.id, coalesce(l.on_hand - l.reserved, 0)::int as available, v.track_inventory, v.allow_backorder,
       count(*) over (partition by v.product_id)::int as n
     from product_variants v left join inventory_levels l on l.variant_id = v.id where v.store_id = $1 and v.product_id = any($2::uuid[])`,
    [store.id, ids],
  );
  const second = await tx.query<{ productId: string; url: string }>('select product_id, url from product_media where store_id = $1 and product_id = any($2::uuid[]) and position = 1', [store.id, ids]);
  const secondMap = new Map(second.map((x) => [x.productId, x.url]));
  const plan = store.installments?.find((x) => x.months === 12) ?? store.installments?.[store.installments.length - 1];
  return rows.map((r) => {
    const id = r.id as string;
    const m = meta.get(id) ?? { categoryPath: null, collectionIds: [] };
    const dp = displayPrice({ productId: id, categoryPath: m.categoryPath, collectionIds: m.collectionIds, unitPrice: r.minPrice as number }, rules, now);
    const compareAt = dp.compareAt ?? ((r.maxCompareAt as number | null) && (r.maxCompareAt as number) > dp.price ? (r.maxCompareAt as number) : null);
    const pv = vs.filter((v) => v.productId === id);
    const single = pv.length === 1 ? pv[0]! : null;
    return {
      id,
      shortId: r.shortId as string,
      title: r.title as L10n,
      coverUrl: (r.coverUrl as string) ?? null,
      secondUrl: secondMap.get(id) ?? null,
      dominantColor: (r.dominantColor as string) ?? null,
      price: dp.price,
      maxPrice: r.maxPrice as number,
      compareAt,
      discountPercent: discountPercent(dp.price, compareAt),
      flashEndsAt: dp.endsAt,
      ratingAvg: Number(r.ratingAvg ?? 0),
      ratingCount: (r.ratingCount as number) ?? 0,
      soldCount: (r.soldCount as number) ?? 0,
      inStock: !!r.inStock,
      isDigital: !!r.isDigital,
      quickAddVariantId: single && (!single.trackInventory || single.allowBackorder || single.available > 0) ? single.id : null,
      available: single?.trackInventory ? single.available : null,
      createdAt: r.createdAt as string,
      monthly: plan && dp.price >= 50_000_000 ? installment(dp.price, plan).monthly : null,
    };
  });
}

const CARD_COLS = `p.id, p.short_id, p.title, p.cover_url, p.min_price, p.max_price, p.max_compare_at, p.rating_avg, p.rating_count, p.sold_count, p.in_stock, p.is_digital, p.created_at,
  (select m.dominant_color from product_media m where m.product_id = p.id order by m.position limit 1) as dominant_color`;

export async function listing(s: Ctx, tx: Sql, store: StoreRow, q: ListingQuery) {
  const now = s.now();
  const lim = clampLimit(q.limit, 24, 60);
  const off = decodeCursor(q.cursor);
  const { where, params } = buildWhere(store, q, now);
  const order = orderBy(q.sort, !!q.q, params, q.q);
  params.push(lim + 1, off);
  const rows = await tx.query<Record<string, unknown>>(`select ${CARD_COLS} from products p where ${where} order by ${order} limit $${params.length - 1} offset $${params.length}`, params);
  const countParams = buildWhere(store, q, now);
  const [{ total }] = (await tx.query<{ total: number }>(`select count(*)::int as total from products p where ${countParams.where}`, countParams.params)) as [{ total: number }];
  return { items: await toCards(tx, store, rows.slice(0, lim), now), nextCursor: rows.length > lim ? encodeCursor(off + lim) : null, total };
}

export async function facets(s: Ctx, tx: Sql, store: StoreRow, q: ListingQuery) {
  const now = s.now();
  const loc = store.defaultLocale;
  const price = buildWhere(store, q, now, 'price');
  const [range] = await tx.query<{ min: number | null; max: number | null }>(`select min(p.min_price) as min, max(p.min_price) as max from products p where ${price.where}`, price.params);
  const base = buildWhere(store, q, now);
  const opts = await tx.query<{ name: string; label: string; swatch: string | null; count: number; display: string }>(
    `select coalesce(po.name->>'${loc}', po.name->>'uz') as name, coalesce(ov.label->>'${loc}', ov.label->>'uz') as label, max(ov.swatch_hex) as swatch, max(po.display) as display,
       count(distinct p.id)::int as count
     from products p join product_options po on po.product_id = p.id join option_values ov on ov.option_id = po.id
     where ${base.where} group by 1, 2 order by 1, count desc`,
    base.params,
  );
  // Each option facet is counted without its own filter so the user can widen a selection.
  const optionNames = [...new Set(opts.map((o) => o.name))];
  const optionFacets = [] as Array<{ name: string; display: string; values: Array<{ label: string; swatch: string | null; count: number }> }>;
  for (const name of optionNames) {
    const w = buildWhere(store, q, now, `opt:${name}`);
    const vals = await tx.query<{ label: string; swatch: string | null; count: number; display: string }>(
      `select coalesce(ov.label->>'${loc}', ov.label->>'uz') as label, max(ov.swatch_hex) as swatch, max(po.display) as display, count(distinct p.id)::int as count
       from products p join product_options po on po.product_id = p.id join option_values ov on ov.option_id = po.id
       where ${w.where} and lower(coalesce(po.name->>'${loc}', po.name->>'uz')) = lower($${w.params.length + 1}) group by 1 order by count desc, 1`,
      [...w.params, name],
    );
    optionFacets.push({ name, display: vals[0]?.display ?? 'chips', values: vals.map(({ label, swatch, count }) => ({ label, swatch, count })) });
  }
  const flag = async (skip: string, extra: string, extraParams: unknown[] = []) => {
    const w = buildWhere(store, q, now, skip);
    const [r] = await tx.query<{ n: number }>(`select count(*)::int as n from products p where ${w.where} and ${extra.replaceAll('$NOWX', `$${w.params.length + 1}`)}`, [...w.params, ...extraParams]);
    return r?.n ?? 0;
  };
  const inStock = await flag('inStock', 'p.in_stock');
  const onSale = await flag('onSale', ON_SALE_SQL.replaceAll('$NOW', '$NOWX'), [now.toISOString()]);
  const ratingW = buildWhere(store, q, now, 'rating');
  const ratings = await tx.query<{ r: number; n: number }>(`select r, (select count(*)::int from products p where ${ratingW.where} and p.rating_avg >= r) as n from unnest(array[4, 3]) r`, ratingW.params);
  const [{ total }] = (await tx.query<{ total: number }>(`select count(*)::int as total from products p where ${base.where}`, base.params)) as [{ total: number }];
  return { total, price: { min: range?.min ?? 0, max: range?.max ?? 0 }, options: optionFacets, inStock, onSale, ratings };
}

export function publicStore(store: StoreRow) {
  const { ownerUserId: _o, planFlags, suspendedReason: _r, ...rest } = store;
  return { ...rest, showBadge: !planFlags?.removeBadge };
}

export function storefrontService(s: Ctx) {
  async function theme(tx: Sql, store: StoreRow) {
    const [t] = await tx.query<{ tokens: unknown; sections: unknown; version: number }>(`select tokens, sections, version from store_themes where store_id = $1 and status = 'published'`, [store.id]);
    const tokens = sanitizeTokens(t?.tokens);
    return { tokens, sections: sanitizeSections(t?.sections), version: t?.version ?? 0, compiled: compileTheme(tokens).vars };
  }

  async function findProduct(tx: Sql, store: StoreRow, idOrShort: string) {
    const [p] = await tx.query<Record<string, unknown> & { id: string; categoryId: string | null; status: string }>(
      `select * from products where store_id = $1 and (${isUuid(idOrShort) ? 'id = $2' : 'short_id = $2'})`,
      [store.id, idOrShort],
    );
    if (!p || p.status !== 'active') throw new DomainError('NOT_FOUND', 'Product not found');
    return p;
  }

  return {
    'store.get': async (actor: Actor, i: { slug: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const methods = await tx.query<{ provider: string; mode: string }>('select provider, mode from payment_provider_configs where store_id = $1 and enabled', [store.id]);
        const nav = (await categoryTree(tx, store.id, { includeHidden: false })).map(({ children, ...c }) => ({ ...c, childCount: children.length }));
        const role = await s.roleOf(tx, store.id, actor.userId);
        return { store: publicStore(store), theme: await theme(tx, store), nav, paymentMethods: methods, role };
      }),

    'store.summaries': async (actor: Actor, i: { slugs: string[] }) =>
      s.tx(null, actor, async (tx) =>
        tx.query(`select id, slug, name, tagline, logo_url, business_type, status from stores where lower(slug) = any($1::text[]) and status = 'active'`, [i.slugs.slice(0, 20).map((x) => x.toLowerCase())]),
      ),

    'store.home': async (actor: Actor, i: { slug: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const now = s.now();
        const rules = await loadDiscountRules(tx, store.id, { onlyAutomatic: true });
        const sel = (order: string, extra = '', lim = 12) =>
          tx.query<Record<string, unknown>>(`select ${CARD_COLS} from products p where p.store_id = $1 and p.status = 'active' ${extra} order by ${order} limit ${lim}`, [store.id]);
        const [newest, best, top] = await Promise.all([sel('p.created_at desc'), sel('p.sold_count desc, p.rating_count desc'), sel('p.rating_avg desc, p.rating_count desc', 'and p.rating_count > 0', 8)]);
        const flash = rules.filter((d) => d.kind === 'flash_sale' && d.endsAt);
        const flashSales = [];
        for (const f of flash.slice(0, 2)) {
          let extra = '';
          if (f.appliesTo.type === 'products') extra = `and p.id = any('{${f.appliesTo.ids.filter(isUuid).join(',')}}'::uuid[])`;
          else if (f.appliesTo.type === 'collections') extra = `and exists (select 1 from product_collections pc where pc.product_id = p.id and pc.collection_id = any('{${f.appliesTo.ids.filter(isUuid).join(',')}}'::uuid[]))`;
          else if (f.appliesTo.type === 'category') extra = `and exists (select 1 from categories c where c.id = p.category_id and (${f.appliesTo.paths.map((x) => `c.path <@ '${x.replace(/[^a-z0-9.]/g, '')}'::ltree`).join(' or ') || 'false'}))`;
          const rows = await sel('p.sold_count desc', extra, 10);
          flashSales.push({ id: f.id, title: f.title, endsAt: f.endsAt, value: f.value, valueType: f.valueType, products: await toCards(tx, store, rows, now, rules) });
        }
        const collections = await tx.query<Record<string, unknown>>(
          `select c.id, c.slug, c.title, c.image_url, c.kind, (select count(*)::int from product_collections pc join products p on p.id = pc.product_id and p.status = 'active' where pc.collection_id = c.id) as product_count,
             array(select p.cover_url from product_collections pc join products p on p.id = pc.product_id where pc.collection_id = c.id and p.status = 'active' and p.cover_url is not null order by pc.position limit 3) as covers
           from collections c where c.store_id = $1 and not c.is_hidden order by c.position, c.created_at`,
          [store.id],
        );
        const testimonials = await tx.query(
          `select r.id, r.author_name, r.rating, r.text, r.photos, r.created_at, p.title as product_title, p.short_id as product_short_id
           from reviews r join products p on p.id = r.product_id where r.store_id = $1 and r.status = 'published' and length(r.text) > 20 and r.rating >= 4 order by r.helpful_count desc, r.created_at desc limit 8`,
          [store.id],
        );
        const stories = await tx.query(
          `select s.*, coalesce((select json_agg(f order by f.position) from story_frames f where f.story_id = s.id), '[]'::json) as frames
           from stories s where s.store_id = $1 and (s.is_highlight or s.expires_at is null or s.expires_at > $2) order by s.is_highlight desc, s.position, s.created_at desc`,
          [store.id, now.toISOString()],
        );
        return {
          newest: await toCards(tx, store, newest, now, rules),
          bestsellers: await toCards(tx, store, best, now, rules),
          topRated: await toCards(tx, store, top, now, rules),
          flashSales,
          collections,
          testimonials,
          stories,
        };
      }),

    'store.categories': async (actor: Actor, i: { slug: string }) => s.storefront(i.slug, actor, (tx, store) => categoryTree(tx, store.id, { includeHidden: false })),

    'store.categoryByPath': async (actor: Actor, i: { slug: string; path: string[] }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const all = await loadCategories(tx, store.id);
        const chain = resolveSlugPath(all, i.path);
        if (!chain?.length || chain.some((c) => c.isHidden)) throw new DomainError('NOT_FOUND', 'Category not found');
        const node = chain[chain.length - 1]!;
        const tree = await categoryTree(tx, store.id, { includeHidden: false });
        const find = (ns: typeof tree): (typeof tree)[number] | undefined => {
          for (const n of ns) {
            if (n.id === node.id) return n;
            const f = find(n.children);
            if (f) return f;
          }
        };
        const view = find(tree);
        return { category: view ? { ...view, children: view.children.map(({ children, ...c }) => ({ ...c, childCount: children.length })) } : null, breadcrumbs: chain.map(({ id, slug, name }) => ({ id, slug, name })) };
      }),

    'store.products': async (actor: Actor, i: ListingQuery) => s.storefront(i.slug, actor, (tx, store) => listing(s, tx, store, i)),
    'store.facets': async (actor: Actor, i: ListingQuery) => s.storefront(i.slug, actor, (tx, store) => facets(s, tx, store, i)),

    'store.product': async (actor: Actor, i: { slug: string; id: string; region?: string | null }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const now = s.now();
        const p = await findProduct(tx, store, i.id);
        const options = await tx.query<{ id: string; position: number; name: L10n; display: string }>('select id, position, name, display from product_options where product_id = $1 order by position', [p.id]);
        const values = await tx.query<{ id: string; optionId: string; label: L10n; swatchHex: string | null }>(
          'select ov.id, ov.option_id, ov.label, ov.swatch_hex from option_values ov join product_options po on po.id = ov.option_id where po.product_id = $1 order by ov.position',
          [p.id],
        );
        const variants = await tx.query<{ id: string; optionValueIds: string[]; sku: string; price: number; compareAtPrice: number | null; weightG: number; trackInventory: boolean; allowBackorder: boolean; available: number; mediaUrl: string | null; isDefault: boolean }>(
          `select v.id, v.option_value_ids, v.sku, v.price, v.compare_at_price, v.weight_g, v.track_inventory, v.allow_backorder, v.media_url, v.is_default,
             coalesce(l.on_hand - l.reserved, 0)::int as available from product_variants v left join inventory_levels l on l.variant_id = v.id where v.product_id = $1 order by v.position`,
          [p.id],
        );
        const rules = await loadDiscountRules(tx, store.id, { onlyAutomatic: true });
        const meta = (await productPricingMeta(tx, store.id, [p.id])).get(p.id)!;
        const priced = variants.map((v) => {
          const dp = displayPrice({ productId: p.id, categoryPath: meta.categoryPath, collectionIds: meta.collectionIds, unitPrice: v.price }, rules, now);
          const compareAt = dp.compareAt ?? (v.compareAtPrice && v.compareAtPrice > dp.price ? v.compareAtPrice : null);
          return { ...v, price: dp.price, basePrice: v.price, compareAt, discountPercent: discountPercent(dp.price, compareAt), flashEndsAt: dp.endsAt };
        });
        const media = await tx.query('select id, url, kind, alt, dominant_color from product_media where product_id = $1 order by position', [p.id]);
        const all = await loadCategories(tx, store.id);
        const byId = new Map<string, CategoryRow>(all.map((c) => [c.id, c]));
        const cat = p.categoryId ? byId.get(p.categoryId) : undefined;
        const crumbs = cat ? breadcrumbs(cat, byId).map((c) => ({ id: c.id, slug: c.slug, name: c.name, path: slugPathOf(c, byId) })) : [];
        const hist = await tx.query<{ rating: number; n: number }>(`select rating, count(*)::int as n from reviews where product_id = $1 and status = 'published' group by rating`, [p.id]);
        const [{ withPhotos }] = (await tx.query<{ withPhotos: number }>(`select count(*)::int as with_photos from reviews where product_id = $1 and status = 'published' and cardinality(photos) > 0`, [p.id])) as [{ withPhotos: number }];
        const [{ questions }] = (await tx.query<{ questions: number }>(`select count(*)::int as questions from questions where product_id = $1 and status = 'published'`, [p.id])) as [{ questions: number }];
        const wish = actor.userId ? (await tx.query('select 1 from wishlists where store_id = $1 and user_id = $2 and product_id = $3', [store.id, actor.userId, p.id])).length > 0 : false;
        const weight = Math.max(...variants.map((v) => v.weightG), 0);
        const shipping = p.isDigital ? [] : await shippingOptions(tx, store, i.region ?? 'UZ-TK', null, weight, now);
        await tx.query('update products set view_count = view_count + 1 where id = $1', [p.id]);
        const { searchDoc: _sd, ...product } = p as Record<string, unknown> & { searchDoc?: string };
        return {
          product,
          options: options.map((o) => ({ ...o, values: values.filter((v) => v.optionId === o.id) })),
          variants: priced,
          media,
          breadcrumbs: crumbs,
          reviewHistogram: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: hist.find((h) => h.rating === r)?.n ?? 0 })),
          reviewsWithPhotos: withPhotos,
          questionCount: questions,
          wishlisted: wish,
          shipping,
          installments: (store.installments ?? []).map((pl) => ({ ...pl, ...installment(priced[0]?.price ?? 0, pl) })),
        };
      }),

    'store.related': async (actor: Actor, i: { slug: string; productId: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const now = s.now();
        const p = await findProduct(tx, store, i.productId);
        const related = await tx.query<Record<string, unknown>>(
          `select ${CARD_COLS} from products p where p.store_id = $1 and p.status = 'active' and p.id <> $2
             and p.category_id in (select d.id from categories c join categories d on d.path <@ (case when nlevel(c.path) > 1 then subpath(c.path, 0, nlevel(c.path) - 1) else c.path end) where c.id = $3)
           order by (p.category_id = $3) desc, p.sold_count desc limit 12`,
          [store.id, p.id, p.categoryId],
        );
        const together = await tx.query<Record<string, unknown>>(
          `select ${CARD_COLS} from co_purchases cp join products p on p.id = cp.product_b where cp.store_id = $1 and cp.product_a = $2 and p.status = 'active' order by cp.count desc limit 4`,
          [store.id, p.id],
        );
        return { related: await toCards(tx, store, related, now), boughtTogether: await toCards(tx, store, together, now) };
      }),

    'store.suggest': async (actor: Actor, i: { slug: string; q: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const term = searchKey(i.q ?? '');
        if (term.length < 2) return { products: [], categories: [] };
        const products = await tx.query(
          `select p.id, p.short_id, p.title, p.cover_url, p.min_price from products p where p.store_id = $1 and p.status = 'active'
             and (p.search_doc like '%' || $2 || '%' or word_similarity($2, p.search_doc) > 0.45) order by word_similarity($2, p.search_doc) desc, p.sold_count desc limit 6`,
          [store.id, term],
        );
        const all = await loadCategories(tx, store.id);
        const byId = new Map(all.map((c) => [c.id, c]));
        const categories = all
          .filter((c) => !c.isHidden && Object.values(c.name).some((n) => searchKey(n ?? '').includes(term)))
          .slice(0, 4)
          .map((c) => ({ id: c.id, name: c.name, path: slugPathOf(c, byId) }));
        return { products, categories };
      }),

    'store.collection': async (actor: Actor, i: { slug: string; collectionSlug: string }) =>
      s.storefront(i.slug, actor, async (tx) => {
        const [c] = await tx.query('select id, slug, title, description, image_url, kind from collections where slug = $1 and not is_hidden', [i.collectionSlug]);
        if (!c) throw new DomainError('NOT_FOUND', 'Collection not found');
        return c;
      }),

    'store.reviews': async (actor: Actor, i: { slug: string; productId: string; rating?: number | null; withMedia?: boolean; sort?: 'new' | 'helpful'; cursor?: string | null }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const p = await findProduct(tx, store, i.productId);
        const lim = 10;
        const off = decodeCursor(i.cursor);
        const params: unknown[] = [p.id];
        let w = `r.product_id = $1 and r.status = 'published'`;
        if (i.rating) params.push(i.rating), (w += ` and r.rating = $${params.length}`);
        if (i.withMedia) w += ' and cardinality(r.photos) > 0';
        params.push(actor.userId ?? '00000000-0000-0000-0000-000000000000', lim + 1, off);
        const rows = await tx.query<Record<string, unknown>>(
          `select r.id, r.author_name, r.rating, r.text, r.pros, r.cons, r.photos, r.variant_title, r.helpful_count, r.owner_reply, r.owner_reply_at, r.created_at,
             exists (select 1 from review_votes v where v.review_id = r.id and v.user_id = $${params.length - 2}::uuid) as voted
           from reviews r where ${w} order by ${i.sort === 'helpful' ? 'r.helpful_count desc,' : ''} r.created_at desc limit $${params.length - 1} offset $${params.length}`,
          params,
        );
        return { items: rows.slice(0, lim), nextCursor: rows.length > lim ? encodeCursor(off + lim) : null };
      }),

    'store.questions': async (actor: Actor, i: { slug: string; productId: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const p = await findProduct(tx, store, i.productId);
        return tx.query(
          `select q.id, q.author_name, q.text, q.created_at,
             coalesce((select json_agg(json_build_object('id', a.id, 'text', a.text, 'authorName', a.author_name, 'isOfficial', a.is_official, 'createdAt', a.created_at) order by a.created_at) from answers a where a.question_id = q.id), '[]'::json) as answers
           from questions q where q.product_id = $1 and (q.status = 'published' or q.user_id = $2) order by q.created_at desc limit 50`,
          [p.id, actor.userId],
        );
      }),

    'store.shippingQuote': async (actor: Actor, i: { slug: string; region: string; district?: string | null; weightG?: number }) =>
      s.storefront(i.slug, actor, (tx, store) => shippingOptions(tx, store, i.region, i.district ?? null, i.weightG ?? 0, s.now())),

  };
}
