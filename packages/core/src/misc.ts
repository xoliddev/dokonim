/** Automated collections, audit diffs and analytics helpers. */
import { isDescendantOrSelf } from './category-tree';
import type { Minor } from './money';

// ── Automated collection rules ─────────────────────────────────────────────
export type RuleField = 'tag' | 'price' | 'category' | 'on_sale' | 'created_within_days' | 'vendor' | 'title' | 'in_stock';
export type RuleOp = 'eq' | 'neq' | 'lt' | 'gt' | 'contains' | 'in_subtree';
export interface CollectionRule {
  field: RuleField;
  op: RuleOp;
  value: string | number | boolean;
}
export interface CollectionRules {
  match: 'all' | 'any';
  rules: CollectionRule[];
}

export interface RuleSubject {
  tags: string[];
  minPrice: Minor;
  categoryPath: string | null;
  onSale: boolean;
  createdAt: string;
  vendor: string;
  title: string;
  inStock: boolean;
}

export function ruleMatches(r: CollectionRule, p: RuleSubject, now: Date): boolean {
  switch (r.field) {
    case 'tag': {
      const has = p.tags.map((t) => t.toLowerCase()).includes(String(r.value).toLowerCase());
      return r.op === 'neq' ? !has : has;
    }
    case 'price': {
      const v = Number(r.value);
      return r.op === 'lt' ? p.minPrice < v : r.op === 'gt' ? p.minPrice > v : p.minPrice === v;
    }
    case 'category':
      return !!p.categoryPath && isDescendantOrSelf(p.categoryPath, String(r.value));
    case 'on_sale':
      return p.onSale === Boolean(r.value);
    case 'in_stock':
      return p.inStock === Boolean(r.value);
    case 'created_within_days':
      return now.getTime() - Date.parse(p.createdAt) <= Number(r.value) * 86_400_000;
    case 'vendor':
      return r.op === 'neq' ? p.vendor !== r.value : p.vendor.toLowerCase() === String(r.value).toLowerCase();
    case 'title':
      return p.title.toLowerCase().includes(String(r.value).toLowerCase());
  }
}

export function collectionMatches(rules: CollectionRules, p: RuleSubject, now: Date): boolean {
  if (!rules.rules.length) return false;
  return rules.match === 'all' ? rules.rules.every((r) => ruleMatches(r, p, now)) : rules.rules.some((r) => ruleMatches(r, p, now));
}

// ── Audit diff (JSON-Patch-like) ──────────────────────────────────────────
export interface DiffOp {
  op: 'add' | 'remove' | 'replace';
  path: string;
  from?: unknown;
  value?: unknown;
}

const IGNORED = new Set(['updatedAt', 'updated_at', 'searchDoc', 'search_doc']);

export function diff(before: unknown, after: unknown, path = ''): DiffOp[] {
  if (before === after) return [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const out: DiffOp[] = [];
    for (const k of keys) {
      if (IGNORED.has(k)) continue;
      const p = `${path}/${k}`;
      if (!(k in before)) out.push({ op: 'add', path: p, value: after[k] });
      else if (!(k in after)) out.push({ op: 'remove', path: p, from: before[k] });
      else out.push(...diff(before[k], after[k], p));
    }
    return out;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before === undefined) return [{ op: 'add', path: path || '/', value: after }];
  if (after === undefined) return [{ op: 'remove', path: path || '/', from: before }];
  return [{ op: 'replace', path: path || '/', from: before, value: after }];
}

// ── Analytics ──────────────────────────────────────────────────────────────
export const FUNNEL_STEPS = ['store_view', 'product_view', 'add_to_cart', 'begin_checkout', 'purchase'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function funnel(counts: Partial<Record<FunnelStep, number>>): Array<{ step: FunnelStep; count: number; rate: number; fromPrev: number }> {
  const first = counts.store_view ?? 0;
  let prev = first;
  return FUNNEL_STEPS.map((step) => {
    const count = counts[step] ?? 0;
    const row = { step, count, rate: first ? count / first : 0, fromPrev: prev ? count / prev : 0 };
    prev = count;
    return row;
  });
}

export type RangeKey = 'today' | '7d' | '30d' | '90d';
export function rangeStart(range: RangeKey, now: Date): Date {
  const days = range === 'today' ? 0 : range === '7d' ? 6 : range === '30d' ? 29 : 89;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** Sparkline path for a series, in a w×h box. */
export function sparklinePath(values: number[], w: number, h: number, pad = 2): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(pad + i * step).toFixed(1)} ${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`)
    .join(' ');
}

// ── Prohibited goods screen (very small, extended per policy) ─────────────
const PROHIBITED = ['narkotik', 'qurol', 'oruzhie', 'weapon', 'cocaine', 'heroin', 'spice', 'psixotrop'];
export function prohibitedHits(text: string): string[] {
  const t = text.toLowerCase();
  return PROHIBITED.filter((w) => t.includes(w));
}
