/** Loading skeletons, error state and the "nothing here yet" state shared by seller screens. */
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button, EmptyState, Loading, Skeleton } from '../../ui';
import { errorMessage } from '../lib/errors';
import { SIcon } from './SIcon';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="sl-error" role="alert">
      <span className="sl-error-icon">
        <SIcon name="alert" size={26} />
      </span>
      <h3 className="sl-error-title">{t('seller.loadFailed')}</h3>
      <p className="muted sl-error-text">{errorMessage(error, t)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} icon={<SIcon name="refresh" size={18} />}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5, thumb = true }: { rows?: number; thumb?: boolean }) {
  const { t } = useI18n();
  return (
    <Loading label={t('common.loading')}>
      <div className="sl-skel-list">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="sl-skel-row">
            {thumb && <Skeleton w={48} h={48} radius="var(--r-media)" />}
            <div className="sl-skel-lines">
              <Skeleton w={`${70 - (i % 3) * 12}%`} h={14} />
              <Skeleton w="38%" h={11} />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function Empty({ icon = 'box', title, hint, action }: { icon?: string; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return <EmptyState icon={icon as never} title={title} hint={hint} action={action} />;
}

/** Renders `loading` → skeleton, `error` → ErrorState, otherwise children (only when data is present). */
export function Gate({ loading, error, onRetry, skeleton, children }: { loading: boolean; error: unknown; onRetry?: () => void; skeleton?: ReactNode; children: ReactNode }) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <>{skeleton ?? <ListSkeleton />}</>;
  return <>{children}</>;
}
