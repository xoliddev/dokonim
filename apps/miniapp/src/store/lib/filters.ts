/**
 * Listing filters ⇄ URL query (so back navigation and shared links restore them) ⇄ `store.products` input.
 * Prices in the URL are whole so'm; the API takes tiyin.
 */
export type SortKey = 'popular' | 'new' | 'price_asc' | 'price_desc' | 'rating' | 'discount' | 'relevance';
export const SORTS: SortKey[] = ['popular', 'new', 'price_asc', 'price_desc', 'rating', 'discount'];

export interface Filters {
  sort?: SortKey;
  min?: number;
  max?: number;
  stock?: boolean;
  sale?: boolean;
  rating?: number;
  opts: Record<string, string[]>;
}

const num = (v: string | null) => {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

export function parseFilters(q: URLSearchParams): Filters {
  let opts: Record<string, string[]> = {};
  try {
    const raw = q.get('o');
    if (raw) {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === 'object')
        for (const [k, vals] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(vals) && vals.length) opts[k] = vals.map(String).slice(0, 30);
    }
  } catch {
    opts = {};
  }
  const sort = q.get('sort') as SortKey | null;
  return {
    sort: sort && [...SORTS, 'relevance'].includes(sort) ? sort : undefined,
    min: num(q.get('min')),
    max: num(q.get('max')),
    stock: q.get('stock') === '1' || undefined,
    sale: q.get('sale') === '1' || undefined,
    rating: num(q.get('r')),
    opts,
  };
}

/** Writes filters into a copy of `base` (other params such as `q` are kept). */
export function filtersToQuery(f: Filters, base = new URLSearchParams()): URLSearchParams {
  const q = new URLSearchParams(base);
  for (const k of ['sort', 'min', 'max', 'stock', 'sale', 'r', 'o']) q.delete(k);
  if (f.sort) q.set('sort', f.sort);
  if (f.min != null) q.set('min', String(f.min));
  if (f.max != null) q.set('max', String(f.max));
  if (f.stock) q.set('stock', '1');
  if (f.sale) q.set('sale', '1');
  if (f.rating) q.set('r', String(f.rating));
  if (Object.keys(f.opts).length) q.set('o', JSON.stringify(f.opts));
  return q;
}

export function toListing(f: Filters) {
  return {
    sort: f.sort,
    priceMin: f.min != null ? f.min * 100 : null,
    priceMax: f.max != null ? f.max * 100 : null,
    inStock: f.stock || undefined,
    onSale: f.sale || undefined,
    ratingGte: f.rating || null,
    options: Object.keys(f.opts).length ? f.opts : undefined,
  };
}

/** Number of active filters (sort excluded) for the "Filters (n)" button. */
export function activeCount(f: Filters): number {
  return (f.min != null || f.max != null ? 1 : 0) + (f.stock ? 1 : 0) + (f.sale ? 1 : 0) + (f.rating ? 1 : 0) + Object.values(f.opts).reduce((a, v) => a + v.length, 0);
}

export function toggleOpt(f: Filters, name: string, value: string): Filters {
  const cur = f.opts[name] ?? [];
  const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
  const opts = { ...f.opts };
  if (next.length) opts[name] = next;
  else delete opts[name];
  return { ...f, opts };
}

export const clearFilters = (f: Filters): Filters => ({ sort: f.sort, opts: {} });
