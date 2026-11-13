import { DomainError } from './errors';

export const MAX_OPTIONS = 3;
export const MAX_VARIANTS = 2048;

export interface OptionDef {
  id: string;
  name: string;
  values: Array<{ id: string; label: string }>;
}

/** Cartesian product of option value ids, ordered by option position. */
export function cartesian(options: OptionDef[]): string[][] {
  if (options.length > MAX_OPTIONS) throw new DomainError('OPTION_LIMIT', `At most ${MAX_OPTIONS} options`);
  if (options.length === 0) return [[]];
  const total = options.reduce((n, o) => n * Math.max(1, o.values.length), 1);
  if (total > MAX_VARIANTS) throw new DomainError('VARIANT_LIMIT', `At most ${MAX_VARIANTS} variants`, { total });
  let acc: string[][] = [[]];
  for (const o of options) {
    if (o.values.length === 0) continue;
    const next: string[][] = [];
    for (const prefix of acc) for (const v of o.values) next.push([...prefix, v.id]);
    acc = next;
  }
  return acc;
}

export const comboKey = (ids: string[]): string => ids.join('|');

export interface VariantLike {
  id: string;
  optionValueIds: string[];
  available: number; // on_hand - reserved (Infinity-like for untracked)
  trackInventory: boolean;
  allowBackorder: boolean;
}

export function isPurchasable(v: Pick<VariantLike, 'available' | 'trackInventory' | 'allowBackorder'>, qty = 1): boolean {
  return !v.trackInventory || v.allowBackorder || v.available >= qty;
}

/**
 * Plans regeneration of the variant matrix: keep existing combos (by key), create missing ones,
 * and report combos that no longer exist (to delete). Owners can delete individual combos later.
 */
export function planVariantMatrix(
  options: OptionDef[],
  existing: Array<{ id: string; optionValueIds: string[] }>,
): { keep: string[]; create: string[][]; remove: string[] } {
  const combos = cartesian(options);
  const want = new Set(combos.map(comboKey));
  const have = new Map(existing.map((e) => [comboKey(e.optionValueIds), e.id]));
  return {
    keep: [...have.entries()].filter(([k]) => want.has(k)).map(([, id]) => id),
    create: combos.filter((c) => !have.has(comboKey(c))),
    remove: [...have.entries()].filter(([k]) => !want.has(k)).map(([, id]) => id),
  };
}

export type ValueState = 'available' | 'sold_out' | 'unavailable';

/**
 * Availability matrix for the variant picker. Given the current partial selection
 * (optionIndex → valueId), each value is:
 *  - available: some purchasable variant matches the selection with this value swapped in
 *  - sold_out: a variant exists but none is purchasable (dimmed + strike, still selectable)
 *  - unavailable: no variant exists for that combination (dimmed + strike)
 */
export function valueStates(
  options: OptionDef[],
  variants: VariantLike[],
  selection: Array<string | null>,
): Array<Record<string, ValueState>> {
  return options.map((opt, oi) => {
    const out: Record<string, ValueState> = {};
    for (const val of opt.values) {
      const matches = variants.filter((v) =>
        v.optionValueIds.every((id, k) => (k === oi ? id === val.id : selection[k] == null || selection[k] === id)),
      );
      out[val.id] = matches.length === 0 ? 'unavailable' : matches.some((m) => isPurchasable(m)) ? 'available' : 'sold_out';
    }
    return out;
  });
}

export function findVariant<V extends { optionValueIds: string[] }>(variants: V[], selection: Array<string | null>): V | undefined {
  if (selection.some((s) => s == null)) return undefined;
  const key = comboKey(selection as string[]);
  return variants.find((v) => comboKey(v.optionValueIds) === key);
}

export function variantTitle(options: OptionDef[], optionValueIds: string[]): string {
  return optionValueIds
    .map((id, i) => options[i]?.values.find((v) => v.id === id)?.label)
    .filter(Boolean)
    .join(' / ');
}

/** Best default selection: first purchasable variant, else first variant. */
export function defaultSelection(variants: VariantLike[]): string[] {
  const v = variants.find((x) => isPurchasable(x)) ?? variants[0];
  return v ? [...v.optionValueIds] : [];
}

/** Bulk edit helper: adjust prices by percent (rounded to whole so'm), never below zero. */
export function adjustPrice(price: number, percent: number): number {
  return Math.max(0, Math.round((price * (100 + percent)) / 100 / 100) * 100);
}
