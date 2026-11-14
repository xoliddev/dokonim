/**
 * Variant picker logic (pure, unit-tested). Options are positional: selection[i] is the chosen value id of
 * option i (or null). Unavailable combinations stay visible but dimmed (§6.2); picking one re-resolves the
 * other options to the closest purchasable variant instead of leaving the buyer on a dead end.
 */
import { defaultSelection, findVariant, isPurchasable, valueStates, type ValueState } from '@dokonim/core';

export interface PickerValue {
  id: string;
}
export interface PickerOption {
  id: string;
  values: PickerValue[];
}
export interface PickerVariant {
  id: string;
  optionValueIds: string[];
  available: number;
  trackInventory: boolean;
  allowBackorder: boolean;
  price: number;
  compareAt: number | null;
  discountPercent: number;
  mediaUrl: string | null;
  sku: string;
}

export type Selection = Array<string | null>;

const asDefs = (options: PickerOption[]) => options.map((o) => ({ id: o.id, name: o.id, values: o.values.map((v) => ({ id: v.id, label: v.id })) }));

/** First purchasable variant (else the first one); a product without options resolves to its only variant. */
export function initialSelection(options: PickerOption[], variants: PickerVariant[], preferVariantId?: string | null): Selection {
  if (!options.length) return [];
  const preferred = preferVariantId ? variants.find((v) => v.id === preferVariantId) : undefined;
  const ids = preferred ? preferred.optionValueIds : defaultSelection(variants);
  return options.map((_, i) => ids[i] ?? null);
}

/** Picks `valueId` for option `index`; keeps the other choices when that combination exists, else re-resolves. */
export function selectValue(options: PickerOption[], variants: PickerVariant[], selection: Selection, index: number, valueId: string): Selection {
  const next = options.map((_, i) => (i === index ? valueId : (selection[i] ?? null)));
  if (findVariant(variants, next)) return next;
  if (next.some((x) => x == null)) {
    // partial selection: keep it if any variant is still reachable
    const reachable = variants.some((v) => v.optionValueIds.every((id, k) => next[k] == null || next[k] === id));
    if (reachable) return next;
  }
  const withValue = variants.filter((v) => v.optionValueIds[index] === valueId);
  const score = (v: PickerVariant) => v.optionValueIds.reduce((s, id, k) => s + (k !== index && id === selection[k] ? 1 : 0), 0);
  const best = [...withValue].sort((a, b) => Number(isPurchasable(b)) - Number(isPurchasable(a)) || score(b) - score(a))[0];
  return best ? options.map((_, i) => best.optionValueIds[i] ?? null) : next;
}

export interface PickerState {
  states: Array<Record<string, ValueState>>;
  variant: PickerVariant | undefined;
  /** Indexes of options still to choose. */
  missing: number[];
  price: number;
  maxPrice: number;
  compareAt: number | null;
  discountPercent: number;
  available: number | null;
  purchasable: boolean;
  lowStock: boolean;
  mediaUrl: string | null;
}

export const LOW_STOCK = 5;

export function pickerState(options: PickerOption[], variants: PickerVariant[], selection: Selection): PickerState {
  const states = valueStates(asDefs(options), variants, selection);
  const variant = options.length ? findVariant(variants, selection) : variants[0];
  const missing = options.map((_, i) => i).filter((i) => selection[i] == null);
  const pool = variant ? [variant] : variants.filter((v) => v.optionValueIds.every((id, k) => selection[k] == null || selection[k] === id));
  const prices = (pool.length ? pool : variants).map((v) => v.price);
  const tracked = variant && variant.trackInventory && !variant.allowBackorder;
  return {
    states,
    variant,
    missing,
    price: Math.min(...prices),
    maxPrice: Math.max(...prices),
    compareAt: variant?.compareAt ?? null,
    discountPercent: variant?.discountPercent ?? Math.max(0, ...pool.map((v) => v.discountPercent)),
    available: tracked ? variant.available : null,
    purchasable: !!variant && isPurchasable(variant),
    lowStock: !!tracked && variant.available > 0 && variant.available <= LOW_STOCK,
    mediaUrl: variant?.mediaUrl ?? null,
  };
}

/** Quantity the buyer may add on top of what is already in the cart. */
export function addableQty(variant: Pick<PickerVariant, 'available' | 'trackInventory' | 'allowBackorder'> | undefined, inCart: number): number {
  if (!variant) return 0;
  const cap = !variant.trackInventory || variant.allowBackorder ? 99 : Math.min(99, variant.available);
  return Math.max(0, cap - inCart);
}
