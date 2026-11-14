/** Unknown `/s/:slug/...` path: keep the store chrome and offer the way back to the storefront. */
import { useI18n } from '../../i18n';
import { navigate, type RouteProps } from '../../router/router';
import { Button, EmptyState } from '../../ui';
import { StoreScreen, TopActions, TopBar } from '../components/Chrome';

export default function NotFound({ params }: RouteProps) {
  const slug = params.slug!;
  const { t } = useI18n();
  return (
    <StoreScreen slug={slug} tab={null} top={<TopBar title={t('common.errorNotFound')} actions={<TopActions slug={slug} />} />}>
      <EmptyState icon="search" title={t('common.errorNotFound')} action={<Button onClick={() => navigate(`/s/${slug}`, { replace: true })}>{t('store.startShopping')}</Button>} />
    </StoreScreen>
  );
}
