/** Unknown `/m/:slug/...` path: say so and offer the way home. */
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { navigate } from '../../router/router';
import { Button } from '../../ui';
import { SellerScreen } from '../components/Layout';
import { Empty } from '../components/States';

export default function NotFound({ params }: RouteProps) {
  const { t } = useI18n();
  return (
    <SellerScreen tab="more">
      <Empty icon="search" title={t('seller.notFoundScreen')} action={<Button onClick={() => navigate(`/m/${params.slug}`, { replace: true })}>{t('seller.tabHome')}</Button>} />
    </SellerScreen>
  );
}
