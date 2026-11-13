/**
 * Money is integer minor units. In TypeScript we use `number` (always a safe integer) and in SQL `bigint`.
 * UZS: 1 so'm = 100 tiyin (Payme also speaks tiyin). XTR (Telegram Stars): minor unit = 1 star.
 * Number.MAX_SAFE_INTEGER tiyin ≈ 90 trillion so'm, far above any single order — see docs/DECISIONS.md.
 */
export type Currency = 'UZS' | 'XTR' | 'USD';
export type Minor = number;

export const MINOR_PER_MAJOR: Record<Currency, number> = { UZS: 100, XTR: 1, USD: 100 };

/** Narrow no-break space, used as the thousands group separator: "1 250 000 so'm". */
export const GROUP_SEP = ' ';

export function assertMinor(v: number): Minor {
  if (!Number.isSafeInteger(v)) throw new RangeError(`Money must be a safe integer, got ${v}`);
  return v;
}

export function fromMajor(major: number, currency: Currency = 'UZS'): Minor {
  return Math.round(major * MINOR_PER_MAJOR[currency]);
}

export function toMajor(minor: Minor, currency: Currency = 'UZS'): number {
  return minor / MINOR_PER_MAJOR[currency];
}

/** Round to whole so'm (half up), keeping minor units. */
export function roundToMajor(minor: Minor, currency: Currency = 'UZS'): Minor {
  const m = MINOR_PER_MAJOR[currency];
  return Math.round(minor / m) * m;
}

/** Floor to whole so'm. Discounts are floored so the merchant never gives away fractions. */
export function floorToMajor(minor: Minor, currency: Currency = 'UZS'): Minor {
  const m = MINOR_PER_MAJOR[currency];
  return Math.floor(minor / m) * m;
}

export function ceilToMajor(minor: Minor, currency: Currency = 'UZS'): Minor {
  const m = MINOR_PER_MAJOR[currency];
  return Math.ceil(minor / m) * m;
}

export function groupDigits(n: number): string {
  const neg = n < 0;
  const s = Math.abs(Math.trunc(n)).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += GROUP_SEP;
    out += s[i];
  }
  return neg ? `-${out}` : out;
}

const SUFFIX: Record<Currency, Record<'uz' | 'ru' | 'en', string>> = {
  UZS: { uz: 'so‘m', ru: 'сум', en: 'UZS' },
  XTR: { uz: '⭐', ru: '⭐', en: '⭐' },
  USD: { uz: '$', ru: '$', en: '$' },
};

/** Formats without relying on Intl locale data (old Android WebViews often lack uz data). */
export function formatMoney(minor: Minor, currency: Currency = 'UZS', locale: 'uz' | 'ru' | 'en' = 'uz'): string {
  const major = toMajor(minor, currency);
  const whole = Math.trunc(major);
  const frac = Math.round(Math.abs(major - whole) * MINOR_PER_MAJOR[currency]);
  const body = groupDigits(whole) + (frac && currency !== 'UZS' ? `.${String(frac).padStart(2, '0')}` : '');
  if (currency === 'USD') return `$${body}`;
  return `${body}${GROUP_SEP}${SUFFIX[currency][locale]}`;
}

/** Percentage of `amount` (percent may be fractional, e.g. 12.5), floored to whole so'm. */
export function percentOf(amount: Minor, percent: number, currency: Currency = 'UZS'): Minor {
  return floorToMajor(Math.floor((amount * Math.round(percent * 100)) / 10000), currency);
}

/**
 * Largest-remainder allocation of `total` across `weights`, in steps of `unit` minor units.
 * Σ result === total whenever total is a multiple of unit. Used to spread order-level discounts to lines.
 */
export function allocate(total: Minor, weights: number[], unit = 100): Minor[] {
  if (weights.length === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || total === 0) return weights.map(() => 0);
  const units = Math.round(total / unit);
  const raw = weights.map((w) => (units * w) / sumW);
  const base = raw.map((r) => Math.floor(r));
  let rest = units - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) {
    const o = order[k]!;
    base[o.i] = base[o.i]! + 1;
  }
  return base.map((b) => b * unit);
}
