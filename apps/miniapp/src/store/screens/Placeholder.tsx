/** Temporary storefront screen: proves routing, store theme and the API work end to end. Replace freely. */
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { useCurrentStore } from '../../shell/session';
import { EmptyState, Skeleton } from '../../ui';

export default function Placeholder({ params }: RouteProps) {
  const { t, l } = useI18n();
  const { data, loading } = useCurrentStore();
  return (
    <div className="screen-pad">
      {loading && !data ? <Skeleton h={28} w="60%" /> : <h1 className="display placeholder-title">{l(data?.store.name)}</h1>}
      <p className="muted">{l(data?.store.tagline)}</p>
      <EmptyState icon="store" title={t('common.comingSoon')} hint={`/s/${params.slug}${params['*'] ? `/${params['*']}` : ''}`} />
    </div>
  );
}
