/**
 * The app viewport (what Telegram shows): faux Telegram header (demo), routed screen, demo MainButton bar,
 * overlay layer for sheets/toasts, live region. Also wires: router back → Telegram BackButton, the current
 * store's theme + time zone, and the owner's calm-motion cap.
 */
import { useEffect } from 'react';
import { pick } from '@dokonim/core';
import { IS_DEMO } from '../api';
import { useBackendStatus } from '../api/provider';
import { setStoreTimezone, useI18n } from '../i18n';
import { setTierCap } from '../motion/tier';
import { back, useLocation, type RouteDef } from '../router/router';
import { useStoreTheme } from '../theme/theme';
import { isRealTelegram, useBackButton } from '../telegram/shim';
import { LiveRegion, ToastHost } from '../ui';
import { BootScreen } from './BootScreen';
import { RouterView } from './RouterView';
import { homeOf, useCurrentStore, useSession } from './session';
import { MainButtonBar, TelegramHeader } from './TelegramChrome';

function StoreSync() {
  const { data } = useCurrentStore();
  useStoreTheme(data?.theme.tokens ?? null);
  useEffect(() => {
    setStoreTimezone(data?.store.timezone);
    setTierCap(data?.theme.tokens.motion === 'calm');
  }, [data]);
  return null;
}

function DefaultBack() {
  const loc = useLocation();
  const { role, slug, inSurface } = useSession();
  // Pops history; on a cold start falls back to the store home, and from the store home to the hub.
  const storeHome = inSurface && slug ? homeOf(role, slug) : null;
  const fallback = !storeHome || loc.path === storeHome ? '/' : storeHome;
  useBackButton(loc.path === '/' ? null : () => back(fallback));
  return null;
}

export function AppShell({ routes }: { routes: RouteDef[] }) {
  const status = useBackendStatus();
  const { t, locale } = useI18n();
  const { data } = useCurrentStore();
  const ready = status.phase === 'ready';
  const chrome = IS_DEMO && !isRealTelegram();
  const title = data ? pick(data.store.name, locale) : t('common.appName');

  return (
    <div className="app-viewport" data-store="">
      {chrome && <TelegramHeader title={title} subtitle={t('common.telegramBot')} />}
      {/*
        The overlay layer (sheets, stories) lives inside <main>, i.e. between the faux header and the MainButton bar,
        because that is the Mini App's real viewport: in Telegram both bars are native and nothing in the web view can
        cover them. So a sheet's scrim never hides the MainButton, and the sheet sits right above it.
      */}
      <main className="app-main">
        {ready ? <RouterView routes={routes} /> : <BootScreen />}
        <div id="overlay-root" className="overlay-root" />
      </main>
      {ready && (
        <>
          <StoreSync />
          <DefaultBack />
        </>
      )}
      {chrome && <MainButtonBar />}
      <ToastHost />
      <LiveRegion />
    </div>
  );
}
