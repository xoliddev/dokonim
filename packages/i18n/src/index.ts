/**
 * @dokonim/i18n — message catalogues (uz Latin default, ru, en), a typed `t()`, plurals, money & dates.
 *
 *   const i18n = createI18n('uz', { tz: store.timezone });
 *   i18n.t('store.addToCart')                       // "Savatga qoʻshish"
 *   i18n.t('common.products', { n: 3 })            // "3 ta mahsulot"
 *   i18n.money(125_000_000)                         // "1 250 000 so‘m"
 *   i18n.relativeDay(date)                          // "Ertaga" | "Payshanba, 14-noyabr"
 *
 * Catalogues live in `src/catalog/<area>.ts`; add a key to `uz` and the compiler demands `ru`/`en`.
 */
import { formatMoney as coreMoney, pick, type Currency, type L10n, type Locale } from '@dokonim/core';
import checkout from './catalog/checkout';
import common from './catalog/common';
import seller from './catalog/seller';
import store from './catalog/store';
import { formatDate, formatDateTime, formatRelativeDay, formatTime, type DateOpts } from './dates';
import { formatMessage, formatNumber, pluralCategory, type Params } from './format';

export * from './format';
export * from './dates';
export type { CommonKey } from './catalog/common';
export type { StoreKey } from './catalog/store';
export type { CheckoutKey } from './catalog/checkout';
export type { SellerKey } from './catalog/seller';

export const CATALOGS = { common, store, checkout, seller } as const;
type Areas = typeof CATALOGS;
export type Area = keyof Areas;
export type MessageKey = { [A in Area]: `${A}.${Extract<keyof Areas[A]['uz'], string>}` }[Area];
export const DEFAULT_LOCALE: Locale = 'uz';

const flat = new Map<Locale, Map<string, string>>();
function table(locale: Locale): Map<string, string> {
  let m = flat.get(locale);
  if (!m) {
    m = new Map();
    for (const [area, cat] of Object.entries(CATALOGS)) {
      for (const [k, v] of Object.entries((cat as Record<Locale, Record<string, string>>)[locale])) m.set(`${area}.${k}`, v);
    }
    flat.set(locale, m);
  }
  return m;
}

/** All keys (for tests and tooling). */
export function allKeys(): MessageKey[] {
  return [...table('uz').keys()] as MessageKey[];
}

export function rawMessage(locale: Locale, key: string): string | undefined {
  return table(locale).get(key) ?? table(DEFAULT_LOCALE).get(key);
}

/** Translate. Missing keys fall back to Uzbek, then to the key itself (never throws in UI). */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const src = rawMessage(locale, key);
  if (src === undefined) return key;
  try {
    return formatMessage(src, params, locale);
  } catch {
    return src;
  }
}

/** Money in minor units → "1 250 000 so‘m" (no Intl dependency). */
export function formatMoney(minor: number, locale: Locale = DEFAULT_LOCALE, currency: Currency = 'UZS'): string {
  return coreMoney(minor, currency, locale);
}

const COMPACT: Record<Locale, [string, string, string]> = {
  uz: ['ming', 'mln', 'mlrd'],
  ru: ['тыс.', 'млн', 'млрд'],
  en: ['K', 'M', 'B'],
};

/** Compact major-unit number for KPI tiles: 1 250 000 → "1,3 mln" / "1.3M". */
export function formatCompact(major: number, locale: Locale = DEFAULT_LOCALE): string {
  const abs = Math.abs(major);
  const [k, m, b] = COMPACT[locale];
  const [div, unit] = abs >= 1e9 ? [1e9, b] : abs >= 1e6 ? [1e6, m] : abs >= 1e3 ? [1e3, k] : [1, ''];
  if (div === 1) return formatNumber(Math.round(major), locale);
  const v = Math.round((major / div) * 10) / 10;
  const num = formatNumber(v, locale);
  return locale === 'en' ? `${num}${unit}` : `${num} ${unit}`;
}

export interface I18nOpts {
  /** Store time zone for business dates (default Asia/Tashkent). */
  tz?: string;
  /** Injectable clock (tests, demo time travel). */
  now?: () => Date;
}

export function createI18n(locale: Locale = DEFAULT_LOCALE, opts: I18nOpts = {}) {
  const now = opts.now ?? (() => new Date());
  const tz = opts.tz;
  return {
    locale,
    t: (key: MessageKey, params?: Params) => translate(locale, key, params),
    /** Pick a translatable content field ({uz, ru, en}) with the §15 fallback order. */
    l: (v: L10n | null | undefined, storeDefault: Locale = DEFAULT_LOCALE) => pick(v, locale, storeDefault),
    money: (minor: number, currency: Currency = 'UZS') => formatMoney(minor, locale, currency),
    number: (n: number) => formatNumber(n, locale),
    compact: (major: number) => formatCompact(major, locale),
    plural: (n: number) => pluralCategory(locale, n),
    date: (d: Date | string | number, o: Omit<DateOpts, 'tz' | 'now'> = {}) => formatDate(d, locale, { ...o, tz, now: now() }),
    relativeDay: (d: Date | string | number) => formatRelativeDay(d, locale, { tz, now: now() }),
    dateTime: (d: Date | string | number) => formatDateTime(d, locale, { tz, now: now() }),
    time: (d: Date | string | number) => formatTime(d, { tz }),
  };
}

export type I18n = ReturnType<typeof createI18n>;
