/**
 * TelegramShim (§19.3): one API for screens, backed by the real WebApp inside Telegram or simulated in the demo.
 *
 *   useMainButton({ text: t('store.addToCart'), onClick: add, progress: saving });
 *   useBackButton(() => navigate(-1));            // the shell already wires router back by default
 *   haptic.impact('light'); haptic.selection(); haptic.notify('success');
 *
 * Main/Back buttons are stacks: the most recently mounted screen/sheet owns the button, and unmounting
 * hands it back to whoever registered before.
 */
import { useEffect, useId, useRef } from 'react';
import { createStore, useStore } from '../lib/store';
import { realWebApp, type ImpactStyle, type NotificationType } from './webapp';

export interface MainButtonConfig {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  progress?: boolean;
  /** Defaults to the store accent. */
  color?: string;
  textColor?: string;
  shine?: boolean;
  hidden?: boolean;
}

interface Entry<T> {
  id: string;
  value: T;
}

export interface ShimState {
  main: MainButtonConfig | null;
  back: (() => void) | null;
  haptic: { kind: string; at: number } | null;
  scheme: 'light' | 'dark';
  verticalSwipes: boolean;
}

export const shimStore = createStore<ShimState>({ main: null, back: null, haptic: null, scheme: 'light', verticalSwipes: true });
const mainStack: Entry<MainButtonConfig>[] = [];
const backStack: Entry<() => void>[] = [];

const wa = () => realWebApp();
export const isRealTelegram = () => !!wa();

// ── real Telegram bindings ──────────────────────────────────────────────────
let boundMain: (() => void) | null = null;
let boundBack: (() => void) | null = null;
function syncReal(s: ShimState) {
  const w = wa();
  if (!w) return;
  const mb = w.MainButton;
  if (boundMain) mb.offClick(boundMain);
  boundMain = null;
  if (s.main && !s.main.hidden) {
    const cfg = s.main;
    boundMain = () => cfg.onClick();
    mb.onClick(boundMain);
    mb.setParams({ text: cfg.text, is_visible: true, is_active: !cfg.disabled, has_shine_effect: !!cfg.shine, ...(cfg.color ? { color: cfg.color } : {}), ...(cfg.textColor ? { text_color: cfg.textColor } : {}) });
    if (cfg.progress) mb.showProgress(false);
    else mb.hideProgress();
  } else mb.setParams({ is_visible: false });
  if (boundBack) w.BackButton.offClick(boundBack);
  boundBack = null;
  if (s.back) {
    const fn = s.back;
    boundBack = () => fn();
    w.BackButton.onClick(boundBack);
    w.BackButton.show();
  } else w.BackButton.hide();
}
shimStore.subscribe(() => syncReal(shimStore.get()));

function publish() {
  shimStore.set((s) => ({ ...s, main: mainStack.at(-1)?.value ?? null, back: backStack.at(-1)?.value ?? null }));
}

function upsert<T>(stack: Entry<T>[], id: string, value: T) {
  const i = stack.findIndex((e) => e.id === id);
  if (i >= 0) stack[i] = { id, value };
  else stack.push({ id, value });
  publish();
}
function remove<T>(stack: Entry<T>[], id: string) {
  const i = stack.findIndex((e) => e.id === id);
  if (i >= 0) stack.splice(i, 1);
  publish();
}

/** Declares the bottom MainButton for as long as the calling component is mounted. Pass null to not claim it. */
export function useMainButton(cfg: MainButtonConfig | null) {
  const id = useId();
  const latest = useRef(cfg);
  latest.current = cfg;
  const active = !!cfg;
  const { text, disabled, progress, color, textColor, shine, hidden } = cfg ?? ({} as Partial<MainButtonConfig>);
  useEffect(() => {
    if (!active) return remove(mainStack, id);
    upsert(mainStack, id, { text: text ?? '', disabled, progress, color, textColor, shine, hidden, onClick: () => latest.current?.onClick() });
  }, [id, active, text, disabled, progress, color, textColor, shine, hidden]);
  useEffect(() => () => remove(mainStack, id), [id]);
}

/** Shows the Telegram BackButton with this handler while mounted (null = don't claim). */
export function useBackButton(onBack: (() => void) | null) {
  const id = useId();
  const latest = useRef(onBack);
  latest.current = onBack;
  const active = !!onBack;
  useEffect(() => {
    if (!active) return remove(backStack, id);
    upsert(backStack, id, () => latest.current?.());
    return () => remove(backStack, id);
  }, [id, active]);
}

export const useShim = () => useStore(shimStore);

// ── haptics (§13.8) ─────────────────────────────────────────────────────────
function tick(kind: string, ms: number) {
  shimStore.set((s) => ({ ...s, haptic: { kind, at: Date.now() } }));
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

export const haptic = {
  impact(style: ImpactStyle = 'light') {
    const w = wa();
    if (w) w.HapticFeedback.impactOccurred(style);
    else tick(`impact:${style}`, style === 'heavy' || style === 'rigid' ? 18 : 8);
  },
  notify(type: NotificationType) {
    const w = wa();
    if (w) w.HapticFeedback.notificationOccurred(type);
    else tick(`notify:${type}`, type === 'error' ? 30 : 14);
  },
  selection() {
    const w = wa();
    if (w) w.HapticFeedback.selectionChanged();
    else tick('selection', 4);
  },
};

// ── misc platform calls ─────────────────────────────────────────────────────
export const tg = {
  ready() {
    const w = wa();
    if (!w) return;
    w.ready();
    w.expand();
    shimStore.set((s) => ({ ...s, scheme: w.colorScheme }));
    w.onEvent('themeChanged', () => shimStore.set((s) => ({ ...s, scheme: w.colorScheme })));
  },
  themeParams: (): Record<string, string> | undefined => wa()?.themeParams,
  setScheme: (scheme: 'light' | 'dark') => shimStore.set((s) => ({ ...s, scheme })),
  setColors(c: { header?: string; background?: string; bottomBar?: string }) {
    const w = wa();
    if (!w) return;
    try {
      if (c.header) w.setHeaderColor?.(c.header);
      if (c.background) w.setBackgroundColor?.(c.background);
      if (c.bottomBar) w.setBottomBarColor?.(c.bottomBar);
    } catch {}
  },
  /** PDP drag-to-dismiss conflicts with Telegram's swipe-to-close (§13.5). */
  setVerticalSwipes(enabled: boolean) {
    shimStore.set((s) => ({ ...s, verticalSwipes: enabled }));
    const w = wa();
    if (enabled) w?.enableVerticalSwipes?.();
    else w?.disableVerticalSwipes?.();
  },
  confirm(message: string): Promise<boolean> {
    const w = wa();
    if (w?.showConfirm) return new Promise((r) => w.showConfirm!(message, r));
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(message));
  },
};
