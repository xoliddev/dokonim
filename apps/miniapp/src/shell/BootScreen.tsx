/** Shown inside the phone while PGlite boots / migrates / seeds in the worker (first run ≈ a few seconds). */
import { useBackendStatus } from '../api/provider';
import { useI18n } from '../i18n';
import { Button, Skeleton } from '../ui';

export function BootScreen() {
  const { t } = useI18n();
  const s = useBackendStatus();
  const text = s.phase === 'seeding' ? t('common.demoSeeding') : s.phase === 'error' ? t('common.errorGeneric') : t('common.demoBooting');
  return (
    <div className="boot" role="status" aria-live="polite" aria-busy={s.phase !== 'error'}>
      <div className="boot-logo display">{t('common.appName')}</div>
      <div className="ikat-band boot-band" aria-hidden="true" />
      <p className="boot-text">{text}</p>
      {s.phase === 'seeding' && (
        <div className="boot-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0.06, s.progress)})` }} />
        </div>
      )}
      {s.phase === 'error' ? (
        <>
          <p className="muted boot-error">{s.error}</p>
          <Button onClick={() => location.reload()}>{t('common.retry')}</Button>
        </>
      ) : (
        <div className="boot-skeleton" aria-hidden="true">
          <Skeleton h={120} radius="var(--r-card)" />
          <Skeleton w="60%" />
          <Skeleton w="40%" />
        </div>
      )}
      <p className="boot-demo muted">{t('common.demoLabel')}</p>
    </div>
  );
}
