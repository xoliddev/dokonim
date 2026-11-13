export const LOCALES = ['uz', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Translatable content: jsonb {uz, ru, en}. */
export type L10n = Partial<Record<Locale, string>>;

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

export function toLocale(v: string | null | undefined, fallback: Locale = 'uz'): Locale {
  if (!v) return fallback;
  const base = v.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : fallback;
}

/** Fallback order: user locale → store default → first non-empty. */
export function pick(v: L10n | null | undefined, locale: Locale, storeDefault: Locale = 'uz'): string {
  if (!v) return '';
  return v[locale] || v[storeDefault] || v.uz || v.ru || v.en || '';
}

export function l10n(uz: string, ru?: string, en?: string): L10n {
  const o: L10n = { uz };
  if (ru) o.ru = ru;
  if (en) o.en = en;
  return o;
}

/** Locales that are enabled for the store but missing in this field (for "missing translation" dots). */
export function missingLocales(v: L10n | null | undefined, enabled: Locale[]): Locale[] {
  return enabled.filter((l) => !v?.[l]?.trim());
}
