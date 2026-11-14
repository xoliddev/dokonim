/**
 * Store theming (§12): `core.compileTheme` turns owner tokens into CSS custom properties; we write them on the
 * `[data-store]` element, so switching a store or editing the theme only rewrites variables (no re-render).
 * Telegram harmony: in `mode: telegram` neutrals come from themeParams and we tint Telegram's header/bottom bar.
 */
import { useEffect } from 'react';
import { compileTheme, DEFAULT_TOKENS, sanitizeTokens, type CompiledTheme, type ThemeTokens } from '@dokonim/core';
import { shimStore, tg } from '../telegram/shim';
import { useStore } from '../lib/store';

/** The platform look (hub, boot): follows the Telegram / demo light-dark scheme. */
export const PLATFORM_TOKENS: ThemeTokens = { ...DEFAULT_TOKENS, brand: '#a3195b', motif: 'ikat', mode: 'telegram' };

let applied: string[] = [];

/** Writes a store's compiled theme on `el`; `null` clears it back to the paper-and-ink platform look in tokens.css. */
export function applyTheme(el: HTMLElement, tokens: Partial<ThemeTokens> | null | undefined, scheme: 'light' | 'dark'): CompiledTheme | null {
  if (!tokens) {
    for (const k of applied) el.style.removeProperty(k);
    applied = [];
    el.dataset.scheme = scheme;
    el.dataset.motif = PLATFORM_TOKENS.motif;
    return null;
  }
  const t = sanitizeTokens({ ...PLATFORM_TOKENS, ...tokens });
  const compiled = compileTheme(t, { prefersDark: scheme === 'dark', telegram: tg.themeParams() });
  for (const k of applied) if (!(k in compiled.vars)) el.style.removeProperty(k);
  for (const [k, v] of Object.entries(compiled.vars)) el.style.setProperty(k, v);
  applied = Object.keys(compiled.vars);
  el.dataset.scheme = compiled.scheme;
  el.dataset.motif = t.motif;
  el.dataset.card = t.cardStyle;
  tg.setColors({ header: compiled.headerColor, background: compiled.vars['--c-surface'], bottomBar: compiled.bottomBarColor });
  return compiled;
}

/**
 * Applies a store's theme tokens to the app root while mounted. Pass `null` for the platform look.
 *   const { data } = useQuery('store.get', { slug }); useStoreTheme(data?.theme?.tokens);
 */
export function useStoreTheme(tokens: Partial<ThemeTokens> | null | undefined) {
  const scheme = useStore(shimStore, (s) => s.scheme);
  const key = JSON.stringify(tokens ?? null);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-store]');
    if (root) applyTheme(root, tokens, scheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scheme]);
}

export { compileTheme, type ThemeTokens };
