/**
 * Desktop: the app inside a phone frame, with the Demo bar and the persistent "Demo mode" label outside it.
 * Phones (or inside real Telegram): the app fills the screen; the Demo bar collapses behind a pill.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { useBackendStatus } from '../api/provider';
import { isRealTelegram } from '../telegram/shim';
import { Icon } from '../ui';
import { DemoBar } from './DemoBar';

function useWide() {
  const q = '(min-width: 720px) and (min-height: 640px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return wide;
}

/** The label without backend status (rendered before the API client exists). */
export function StaticDemoLabel() {
  const { t } = useI18n();
  return (
    <div className="demo-label" role="note">
      <span className="demo-dot" aria-hidden="true" />
      {t('common.demoLabel')}
    </div>
  );
}

export function DemoLabel() {
  const { t } = useI18n();
  const s = useBackendStatus();
  return (
    <div className="demo-label" role="note">
      <span className="demo-dot" aria-hidden="true" />
      {t('common.demoLabel')}
      {!s.persistent && <em> · {t('common.demoNoPersist')}</em>}
    </div>
  );
}

export function DemoFrame({ children }: { children: ReactNode }) {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  if (isRealTelegram()) return <div className="frame-full">{children}</div>;

  if (!wide)
    return (
      <div className="frame-full">
        <div className="demo-mobile-top">
          <DemoLabel />
          <button type="button" className="demo-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Demo">
            <Icon name={open ? 'close' : 'settings'} size={18} />
          </button>
        </div>
        {open && <DemoBar compact />}
        <div className="frame-full-app">{children}</div>
      </div>
    );

  return (
    <div className="desk">
      <aside className="desk-side">
        <div className="desk-brand">
          <span className="display">{t('common.appName')}</span>
          <div className="ikat-band" aria-hidden="true" />
        </div>
        <DemoLabel />
        <DemoBar />
      </aside>
      <div className="phone" aria-label="Telegram Mini App">
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-screen">{children}</div>
      </div>
    </div>
  );
}
