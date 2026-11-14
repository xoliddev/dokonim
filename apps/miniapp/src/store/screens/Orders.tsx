/** My orders: status, number, date, total and a strip of item thumbnails; tap to track. */
import { useQuery } from '../../api';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../lib/i18n';
import { Reveal, staggerDelay } from '../../motion';
import { navigate, type RouteProps } from '../../router/router';
import { Button, EmptyState, Icon, Skeleton } from '../../ui';
import { StoreScreen, TopBar } from '../components/Chrome';
import type { OrderListItem } from '../lib/types';
import '../styles/orders.css';

export const statusTone = (s: string) =>
  ['cancelled', 'returned'].includes(s) ? 'is-bad' : ['delivered', 'completed'].includes(s) ? 'is-good' : ['pending_payment', 'awaiting_confirmation', 'return_requested'].includes(s) ? 'is-wait' : 'is-move';

export default function Orders({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, money, relativeDay } = useI18n();
  const q = useQuery('orders.mine', { slug }, { staleMs: 10_000 });
  const list = (q.data ?? []) as unknown as OrderListItem[];
  return (
    <StoreScreen slug={slug} tab="profile" top={<TopBar title={t('store.myOrders')} />}>
      {q.loading && !q.data ? (
        <div className="st-stack">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={120} radius="var(--r-card)" />
          ))}
        </div>
      ) : q.error && !q.data ? (
        <EmptyState icon="refresh" title={t('common.errorGeneric')} action={<Button variant="secondary" onClick={q.reload}>{t('common.retry')}</Button>} />
      ) : !list.length ? (
        <EmptyState icon="receipt" title={t('store.ordersEmpty')} action={<Button onClick={() => navigate(`/s/${slug}`)}>{t('store.startShopping')}</Button>} />
      ) : (
        <div className="st-stack">
          {list.map((o, i) => (
            <Reveal key={o.id} delay={staggerDelay(i)}>
              <button type="button" className="st-order" onClick={() => navigate(`/s/${slug}/orders/${o.id}`)}>
                <span className="st-order-top">
                  <b>{t('store.orderNumber', { number: String(o.number) })}</b>
                  <span className={`st-status ${statusTone(o.status)}`}>{t(`checkout.status_${o.status}` as MessageKey)}</span>
                </span>
                <span className="st-order-thumbs" aria-hidden="true">
                  {(o.items ?? []).slice(0, 4).map((it, k) => (it.imageUrl ? <img key={k} src={it.imageUrl} alt="" loading="lazy" /> : <span key={k} className="st-order-ph" />))}
                  {(o.items?.length ?? 0) > 4 && <span className="st-order-more">+{o.items!.length - 4}</span>}
                </span>
                <span className="st-order-bottom">
                  <span className="muted">{relativeDay(o.placedAt)}</span>
                  <span className="price">{money(o.total)}</span>
                  <Icon name="chevron-right" size={18} />
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      )}
    </StoreScreen>
  );
}
