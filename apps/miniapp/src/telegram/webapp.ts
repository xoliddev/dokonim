/**
 * The slice of Telegram's WebApp API we use (§14.1), plus launch detection. Inside Telegram we talk to
 * `window.Telegram.WebApp`; outside, `shim.ts` simulates the same surface for the demo frame.
 */
export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type NotificationType = 'error' | 'success' | 'warning';

interface TgButton {
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean; has_shine_effect?: boolean }): void;
  onClick(fn: () => void): void;
  offClick(fn: () => void): void;
  showProgress(leaveActive?: boolean): void;
  hideProgress(): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; language_code?: string } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  ready(): void;
  expand(): void;
  close(): void;
  MainButton: TgButton;
  SecondaryButton?: TgButton;
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
  HapticFeedback: { impactOccurred(s: ImpactStyle): void; notificationOccurred(t: NotificationType): void; selectionChanged(): void };
  onEvent(name: string, fn: () => void): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  showAlert?(message: string, cb?: () => void): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  isVersionAtLeast?(v: string): boolean;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Telegram passes launch params in the URL hash (`#tgWebAppData=…`) before its script parses them. */
export function launchedFromTelegram(): boolean {
  return typeof location !== 'undefined' && /tgWebAppData=|tgWebAppPlatform=/.test(location.hash + location.search);
}

/** The real WebApp object, only when we are actually inside Telegram (non-empty initData). */
export function realWebApp(): TelegramWebApp | null {
  const w = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  return w && w.initData ? w : null;
}

export function getInitData(): string {
  return realWebApp()?.initData ?? '';
}

/** `startapp` payload: from Telegram, or `?startapp=` in the demo URL. */
export function getStartParam(): string | null {
  const real = realWebApp()?.initDataUnsafe.start_param;
  if (real) return real;
  try {
    return new URLSearchParams(location.search).get('startapp');
  } catch {
    return null;
  }
}

/** Loads telegram-web-app.js on demand (demo build opened inside Telegram). */
export function loadTelegramScript(): Promise<void> {
  if (window.Telegram?.WebApp) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js?59';
    s.onload = s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}
