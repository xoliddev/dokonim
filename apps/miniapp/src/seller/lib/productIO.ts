/** Server aggregate (`admin.products.get`) ⇄ editor draft ⇄ `admin.products.save` input. */
import { l3, type OptionDraft, type ProductDraft, type VariantDraft } from './product';

type L = Record<string, string | undefined>;
const pickL = (v: L | null | undefined, locale = 'uz') => v?.[locale] || v?.uz || v?.ru || v?.en || '';
const compact = (v: L | null | undefined): Record<string, string> => Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => typeof x === 'string' && x)) as Record<string, string>;

interface Agg {
  id: string;
  status: ProductDraft['status'];
  title: L;
  descriptionMarkup: L;
  categoryId: string | null;
  collectionIds: string[];
  tags: string[];
  media: Array<{ url: string }>;
  options: Array<{ id: string; name: L; display: string; values: Array<{ id: string; label: L; swatchHex: string | null }> }>;
  variants: Array<{ id: string; optionValueIds: string[]; sku: string; barcode: string; price: number; compareAtPrice: number | null; costPrice: number | null; stock: number; lowStockThreshold: number | null; trackInventory: boolean; allowBackorder: boolean; weightG: number; mediaUrl: string | null }>;
  brand: string;
  vendorCode: string;
  isDigital: boolean;
  attributes: Array<{ name: Record<string, string>; value: Record<string, string> }>;
}

export function fromAggregate(raw: unknown, locale = 'uz'): ProductDraft {
  const a = raw as Agg;
  return {
    id: a.id,
    status: a.status,
    title: l3(a.title),
    description: l3(a.descriptionMarkup),
    categoryId: a.categoryId,
    collectionIds: a.collectionIds ?? [],
    tags: a.tags ?? [],
    media: (a.media ?? []).map((m) => ({ url: m.url })),
    options: (a.options ?? []).map<OptionDraft>((o) => ({
      id: o.id,
      name: pickL(o.name, locale),
      orig: compact(o.name),
      display: o.display === 'swatch' ? 'swatch' : 'chips',
      values: o.values.map((v) => ({ id: v.id, label: pickL(v.label, locale), swatchHex: v.swatchHex, orig: compact(v.label) })),
    })),
    variants: (a.variants ?? []).map<VariantDraft>((v) => ({
      id: v.id, optionValueIds: v.optionValueIds, sku: v.sku ?? '', barcode: v.barcode ?? '', price: v.price, compareAtPrice: v.compareAtPrice, costPrice: v.costPrice,
      stock: v.stock ?? 0, stockBase: v.stock ?? 0, lowStockThreshold: v.lowStockThreshold ?? 3, trackInventory: v.trackInventory, allowBackorder: v.allowBackorder, weightG: v.weightG ?? 0, mediaUrl: v.mediaUrl,
    })),
    brand: a.brand ?? '',
    vendorCode: a.vendorCode ?? '',
    isDigital: !!a.isDigital,
    attributes: a.attributes ?? [],
  };
}

/** The editor edits labels in the current UI language; other translations survive the save. */
const withLabel = (orig: Record<string, string> | undefined, label: string, locale: string) => ({ ...(orig ?? {}), [locale]: label.trim() });

export function toInput(d: ProductDraft, storeId: string, locale = 'uz') {
  return {
    storeId,
    ...(d.id ? { id: d.id } : {}),
    status: d.status,
    title: compact(d.title),
    description: compact(d.description),
    categoryId: d.categoryId,
    collectionIds: d.collectionIds,
    tags: d.tags,
    attributes: d.attributes,
    isDigital: d.isDigital,
    brand: d.brand,
    vendorCode: d.vendorCode,
    media: d.media.map((m) => ({ url: m.url })),
    options: d.options.map((o) => ({
      id: o.id,
      name: withLabel(o.orig, o.name, locale),
      display: o.display,
      values: o.values.map((v) => ({ id: v.id, label: withLabel(v.orig, v.label, locale), swatchHex: v.swatchHex })),
    })),
    variants: d.variants.map((v) => ({
      id: v.id, optionValueIds: v.optionValueIds, sku: v.sku.trim(), barcode: v.barcode.trim(), price: v.price ?? 0, compareAtPrice: v.compareAtPrice, costPrice: v.costPrice,
      weightG: v.weightG, stock: v.stock, stockBase: v.stockBase, lowStockThreshold: v.lowStockThreshold, trackInventory: v.trackInventory, allowBackorder: v.allowBackorder, mediaUrl: v.mediaUrl,
    })),
  };
}
