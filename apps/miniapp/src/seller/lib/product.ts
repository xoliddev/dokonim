/**
 * Product editor model — pure (unit-tested in test/seller-variants.test.ts).
 * Options (≤ 3, e.g. Size × Colour) generate the variant matrix as a Cartesian product; regenerating keeps every
 * existing combination's price/stock/SKU (matched by value ids), adds new combos with the defaults and drops
 * combos whose values were removed. Money is integer tiyin.
 */
import { cartesian, comboKey, MAX_OPTIONS, MAX_VARIANTS } from '@dokonim/core';
import { uid } from './ctx';

export type L3 = { uz: string; ru: string; en: string };
export const l3 = (v?: Partial<Record<string, string | undefined>> | null): L3 => ({ uz: v?.uz ?? '', ru: v?.ru ?? '', en: v?.en ?? '' });

/** `orig` keeps the other-language translations loaded from the server; the editor edits the Uzbek label. */
export interface OptionValue { id: string; label: string; swatchHex: string | null; orig?: Record<string, string> }
export interface OptionDraft { id: string; name: string; display: 'chips' | 'swatch'; values: OptionValue[]; orig?: Record<string, string> }
export interface VariantDraft {
  id: string;
  optionValueIds: string[];
  sku: string;
  barcode: string;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  stock: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  allowBackorder: boolean;
  weightG: number;
  mediaUrl: string | null;
}
export interface ProductDraft {
  id: string | null;
  status: 'draft' | 'active' | 'archived';
  title: L3;
  description: L3;
  categoryId: string | null;
  collectionIds: string[];
  tags: string[];
  media: Array<{ url: string }>;
  options: OptionDraft[];
  variants: VariantDraft[];
  brand: string;
  vendorCode: string;
  isDigital: boolean;
  attributes: Array<{ name: Record<string, string>; value: Record<string, string> }>;
}

export function newVariant(optionValueIds: string[], base: Partial<VariantDraft> = {}): VariantDraft {
  return {
    id: uid(), optionValueIds, sku: '', barcode: '', price: base.price ?? null, compareAtPrice: base.compareAtPrice ?? null, costPrice: base.costPrice ?? null,
    stock: base.stock ?? 0, lowStockThreshold: base.lowStockThreshold ?? 3, trackInventory: base.trackInventory ?? true, allowBackorder: false, weightG: base.weightG ?? 0, mediaUrl: null,
  };
}

export function emptyDraft(categoryId: string | null = null): ProductDraft {
  return {
    id: null, status: 'active', title: l3(), description: l3(), categoryId, collectionIds: [], tags: [], media: [], options: [], variants: [newVariant([], { stock: 10 })],
    brand: '', vendorCode: '', isDigital: false, attributes: [],
  };
}

/** Options that actually contribute to the matrix (named, with at least one value). */
export const activeOptions = (opts: OptionDraft[]) => opts.filter((o) => o.values.length > 0);

/**
 * Rebuilds the variant list for the current options, preserving existing combos. With `previous` (the options the
 * variants were built for), a combo that was already possible then but has no variant was removed on purpose and
 * stays removed: renaming an option or adding a value elsewhere must not bring back a deleted combination.
 */
export function regenerate(options: OptionDraft[], existing: VariantDraft[], defaults: Partial<VariantDraft> = {}, previous?: OptionDraft[]): VariantDraft[] {
  const opts = activeOptions(options).slice(0, MAX_OPTIONS);
  const before = previous ? activeOptions(previous).slice(0, MAX_OPTIONS).map((o) => new Set(o.values.map((v) => v.id))) : [];
  const wasPossible = (ids: string[]) => before.length > 0 && before.length === ids.length && ids.every((id, i) => before[i]!.has(id));
  const combos = cartesian(opts.map((o) => ({ id: o.id, name: o.name, values: o.values.map((v) => ({ id: v.id, label: v.label })) })));
  const have = new Map(existing.map((v) => [comboKey(v.optionValueIds), v]));
  // a single default variant becomes the template for the first generated matrix
  const template = existing.length === 1 && existing[0]!.optionValueIds.length === 0 ? existing[0]! : null;
  const base = { ...(template ?? {}), ...defaults };
  return combos.flatMap((ids) => {
    const keep = have.get(comboKey(ids));
    if (keep) return [keep];
    if (wasPossible(ids)) return [];
    // a combo that only gained a new option dimension inherits from its "parent" combo
    const parent = existing.find((v) => v.optionValueIds.length > 0 && v.optionValueIds.every((x) => ids.includes(x)));
    // no parent combo: fall back to the template, then to the first existing variant (e.g. options were removed)
    const src = parent ?? (template || !existing[0] ? base : { ...existing[0], ...defaults });
    return [newVariant(ids, { price: src.price ?? null, compareAtPrice: src.compareAtPrice ?? null, costPrice: src.costPrice ?? null, stock: parent ? parent.stock : template ? template.stock : (defaults.stock ?? 0), weightG: src.weightG ?? 0, trackInventory: src.trackInventory ?? true })];
  });
}

/** Variant count the options would produce (shown as "3 × 2 = 6"). */
export const matrixSize = (options: OptionDraft[]) => activeOptions(options).reduce((n, o) => n * o.values.length, 1);

export function variantLabel(options: OptionDraft[], ids: string[]): string {
  return ids.map((id, i) => activeOptions(options)[i]?.values.find((v) => v.id === id)?.label ?? '').filter(Boolean).join(' / ');
}

/** "ATL-KOY" + "-M-QIZIL" — fills SKUs that are still empty. */
export function autoSku(prefix: string, options: OptionDraft[], variants: VariantDraft[]): VariantDraft[] {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9А-ЯЁ]+/gi, '').slice(0, 6);
  const p = clean(prefix) || 'SKU';
  return variants.map((v) => (v.sku ? v : { ...v, sku: [p, ...v.optionValueIds.map((id, i) => clean(activeOptions(options)[i]?.values.find((x) => x.id === id)?.label ?? ''))].filter(Boolean).join('-') }));
}

export interface BulkPatch { price?: number | null; compareAtPrice?: number | null; stock?: number; percent?: number }

export function applyBulk(variants: VariantDraft[], ids: ReadonlySet<string>, patch: BulkPatch): VariantDraft[] {
  return variants.map((v) => {
    if (!ids.has(v.id)) return v;
    const next = { ...v };
    if (patch.price !== undefined) next.price = patch.price;
    if (patch.compareAtPrice !== undefined) next.compareAtPrice = patch.compareAtPrice;
    if (patch.stock !== undefined) next.stock = patch.stock;
    if (patch.percent !== undefined && next.price != null) next.price = Math.max(0, Math.round((next.price * (100 + patch.percent)) / 100 / 100) * 100);
    return next;
  });
}

export type DraftErrors = Partial<Record<'title' | 'variants' | 'options' | 'media', string>> & { variant?: Record<string, 'price' | 'compare' | 'stock'> };

/** Client-side validation (the server re-checks everything). Returns error *codes*; the UI localises them. */
export function validateDraft(d: ProductDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.title.uz.trim() && !d.title.ru.trim() && !d.title.en.trim()) e.title = 'required';
  if (d.options.length > MAX_OPTIONS) e.options = 'limit';
  for (const o of d.options) {
    if (!o.name.trim()) e.options = 'name';
    else if (o.values.length === 0) e.options = 'values';
    const labels = o.values.map((v) => v.label.trim().toLowerCase());
    if (labels.some((x) => !x)) e.options = 'valueEmpty';
    else if (new Set(labels).size !== labels.length) e.options = 'duplicate';
  }
  if (d.variants.length === 0) e.variants = 'none';
  if (d.variants.length > MAX_VARIANTS) e.variants = 'limit';
  const bad: Record<string, 'price' | 'compare' | 'stock'> = {};
  for (const v of d.variants) {
    if (v.price == null || !Number.isFinite(v.price) || v.price < 0) bad[v.id] = 'price';
    else if (v.compareAtPrice != null && (!Number.isFinite(v.compareAtPrice) || v.compareAtPrice <= v.price)) bad[v.id] = 'compare';
    else if (!Number.isInteger(v.stock) || v.stock < 0) bad[v.id] = 'stock';
  }
  if (Object.keys(bad).length) e.variant = bad;
  return e;
}

export const hasErrors = (e: DraftErrors) => Object.keys(e).length > 0;
