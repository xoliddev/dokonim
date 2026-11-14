/**
 * UI i18n: `const { t, money, l, relativeDay } = useI18n();` — see @dokonim/i18n for the catalogues.
 * Locale comes from the demo bar / Telegram language_code and is remembered per browser.
 * Business dates use the current store's time zone: call `setStoreTimezone(store.timezone)` (the shell does).
 */
import { useMemo } from 'react';
import { toLocale, type Locale } from '@dokonim/core';
import { createI18n, type I18n, type MessageKey } from '@dokonim/i18n';
import { createStore, local, useStore } from '../lib/store';
import { realWebApp } from '../telegram/webapp';

const initial = (): Locale => {
  const saved = local.get<Locale | null>('dokonim.locale', null);
  if (saved) return saved;
  const tgLang = realWebApp()?.initDataUnsafe.user?.language_code;
  return toLocale(tgLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'uz'), 'uz');
};

export const i18nStore = createStore<{ locale: Locale; tz: string }>({ locale: initial(), tz: 'Asia/Tashkent' });

export function setLocale(locale: Locale) {
  local.set('dokonim.locale', locale);
  i18nStore.set((s) => ({ ...s, locale }));
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function setStoreTimezone(tz: string | null | undefined) {
  i18nStore.set((s) => (s.tz === (tz || 'Asia/Tashkent') ? s : { ...s, tz: tz || 'Asia/Tashkent' }));
}

/**
 * The shared formatters group digits with U+202F (narrow no-break space), which is right for Telegram messages and
 * CSV but ~0.13em wide in the display face, so with tight tracking prices read as "3900000UZS". On screen every
 * money/number string (and every message that interpolates one) uses a regular no-break space instead.
 */
const NNBSP = / /g;
export const uiSpaces = (s: string) => s.replace(NNBSP, ' ');

export function uiI18n(locale: Locale, tz?: string): I18n {
  const i = createI18n(locale, tz ? { tz } : undefined);
  return {
    ...i,
    t: ((key: MessageKey, params?: Record<string, string | number>) => uiSpaces(i.t(key, params))) as I18n['t'],
    money: (minor, currency) => uiSpaces(i.money(minor, currency)),
    number: (n) => uiSpaces(i.number(n)),
    compact: (major) => uiSpaces(i.compact(major)),
  };
}

export function useI18n(): I18n {
  const { locale, tz } = useStore(i18nStore);
  return useMemo(() => uiI18n(locale, tz), [locale, tz]);
}

/** Non-hook access (event handlers, toasts outside React). */
export const t = (key: MessageKey, params?: Record<string, string | number>) => uiI18n(i18nStore.get().locale).t(key, params);

export type { MessageKey };
