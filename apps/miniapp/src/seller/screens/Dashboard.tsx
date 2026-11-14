/**
 * Seller home (§6.3): bento KPIs (revenue big with a 7-day chart, orders, conversion — all Odometers),
 * the action queue, low-stock alerts and recent orders. Quick-add FAB "+ Mahsulot".
 */
import type { MessageKey } from '@dokonim/i18n';
import { useQuery } from '../../api/provider';
import { useI18n } from '../../i18n';
import { Odometer, Stagger } from '../../motion';
import type { RouteProps } from '../../router/router';
import { Link, navigate } from '../../router/router';
import { Skeleton } from '../../ui';
import { BarChart } from '../components/BarChart';
import { Section, SellerScreen } from '../components/Layout';
import { SIcon } from '../components/SIcon';
import { Empty, ErrorState } from '../components/States';
import { useSeller } from '../lib/ctx';
import { toneClass } from '../lib/status';
import './dashboard.css';

interface Dash {
  today: { revenue: number | null; orders: number; yesterdayRevenue: number | null; conversion: number };
  sparkline: number[];
  queue: Record<'toConfirm' | 'toShip' | 'returns' | 'lowStock' | 'unanswered' | 'newReviews', number>;
  recent: Array<{ id: string; number: number; status: string; total: number; contact: { name?: string }; placedAt: string; paymentMethod: string }>;
  counts: { products: number; drafts: number };
}

interface Low { variantId: string; productId: string; title: Record<string, string>; coverUrl: string | null; available: number; variantLabels: Array<Record<string, string>> }

function weekdays(locale: string, tz: string): string[] {
  const f = new Intl.DateTimeFormat(locale === 'uz' ? 'uz-Latn' : locale, { weekday: 'short', timeZone: tz });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.now() - (6 - i) * 86_400_000)));
}

export default function Dashboard(_: RouteProps) {
  const { t, l, money, locale, relativeDay, time } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.dashboard', s.storeId ? { storeId: s.storeId } : null);
  const low = useQuery('admin.inventory.list', s.storeId ? { storeId: s.storeId, lowStock: true } : null);
  const d = q.data as Dash | undefined;
  const go = (sub: string) => navigate(`/m/${s.slug}/${sub}`);
  const error = s.error ?? (!d ? q.error : undefined);

  const delta = d && d.today.yesterdayRevenue ? Math.round(((d.today.revenue ?? 0) / d.today.yesterdayRevenue - 1) * 100) : null;
  const queue: Array<{ key: keyof Dash['queue']; icon: string; to: string }> = [
    { key: 'toConfirm', icon: 'check', to: 'orders?tab=attention' },
    { key: 'toShip', icon: 'truck', to: 'orders?tab=active' },
    { key: 'returns', icon: 'undo', to: 'orders?tab=attention' },
    { key: 'lowStock', icon: 'box', to: 'products?filter=low' },
  ];
  const pending = d ? queue.filter((x) => d.queue[x.key] > 0) : [];
  const lows = ((low.data ?? []) as Low[]).slice(0, 5);

  return (
    <SellerScreen
      tab="home"
      kicker={s.store ? `@${s.store.slug}` : undefined}
      title={s.store ? l(s.store.name) : <Skeleton w={180} h={26} />}
      actions={
        <button type="button" className="sl-icon-btn" aria-label={t('seller.openStore')} onClick={() => navigate(`/s/${s.slug}`)}>
          <SIcon name="external" size={20} />
        </button>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={() => (s.error ? s.reload() : q.reload())} />
      ) : !d ? (
        <div className="db-bento">
          <Skeleton h={168} radius="var(--r-card)" className="db-skel-big" />
          <Skeleton h={96} radius="var(--r-card)" />
          <Skeleton h={96} radius="var(--r-card)" />
        </div>
      ) : (
        <>
          <div className="db-bento">
            <div className="db-tile db-revenue">
              <span className="db-label">{t('seller.revenueToday')}</span>
              <Odometer className="db-big" value={d.today.revenue == null ? '—' : money(d.today.revenue)} />
              {delta != null && (
                <span className={`db-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
                  {t('seller.vsYesterday', { delta: `${delta >= 0 ? '+' : ''}${delta}%` })}
                </span>
              )}
              <BarChart values={d.sparkline} labels={weekdays(locale, 'Asia/Tashkent')} format={(v) => money(v)} />
            </div>
            <button type="button" className="db-tile db-small" onClick={() => go('orders')}>
              <span className="db-label">{t('seller.ordersToday')}</span>
              <Odometer className="db-mid" value={d.today.orders} />
            </button>
            <div className="db-tile db-small">
              <span className="db-label">{t('seller.conversion')}</span>
              <Odometer className="db-mid" value={`${(d.today.conversion * 100).toFixed(1)}%`} />
            </div>
          </div>

          <Section title={t('seller.dashQueue')}>
            {pending.length === 0 ? (
              <div className="db-clear">
                <SIcon name="check" size={20} /> {t('seller.allClear')}
              </div>
            ) : (
              <Stagger className="db-queue">
                {pending.map((x) => (
                  <button key={x.key} type="button" className="db-q" onClick={() => go(x.to)}>
                    <span className="db-q-icon"><SIcon name={x.icon} size={20} /></span>
                    <span className="db-q-n">{d.queue[x.key]}</span>
                    <span className="db-q-label">{t(`seller.q_${x.key}` as MessageKey)}</span>
                    <SIcon name="chevron-right" size={18} className="db-q-chev" />
                  </button>
                ))}
              </Stagger>
            )}
          </Section>

          {lows.length > 0 && (
            <Section title={t('seller.lowStockTitle')} action={<Link className="sl-link" to={`/m/${s.slug}/products?filter=low`}>{t('common.showAll')}</Link>}>
              <div className="sl-list">
                {lows.map((v) => (
                  <Link key={v.variantId} className="sl-row" to={`/m/${s.slug}/products/${v.productId}`}>
                    {v.coverUrl ? <img className="sl-thumb" src={v.coverUrl} alt="" /> : <span className="sl-thumb" />}
                    <span className="sl-row-main">
                      <span className="sl-row-title">{l(v.title)}</span>
                      <span className="sl-row-sub">{v.variantLabels.map((x) => l(x)).filter(Boolean).join(' / ') || '—'}</span>
                    </span>
                    <span className={`sl-pill ${v.available <= 0 ? 'is-bad' : 'is-warn'}`}>{t('seller.leftN', { n: Math.max(0, v.available) })}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          <Section title={t('seller.recentOrders')} action={d.recent.length > 0 ? <Link className="sl-link" to={`/m/${s.slug}/orders`}>{t('common.showAll')}</Link> : undefined}>
            {d.recent.length === 0 ? (
              <Empty icon="receipt" title={t('seller.noOrdersYet')} hint={t('seller.noOrdersHint')} />
            ) : (
              <div className="sl-list">
                {d.recent.map((o) => (
                  <Link key={o.id} className="sl-row" to={`/m/${s.slug}/orders/${o.id}`}>
                    <span className="sl-row-icon db-order-no">{o.number}</span>
                    <span className="sl-row-main">
                      <span className="sl-row-title">{o.contact?.name || t('seller.orderNo', { n: o.number })}</span>
                      <span className="sl-row-sub">{relativeDay(o.placedAt)} · {time(o.placedAt)}</span>
                    </span>
                    <span className="sl-row-end">
                      <span className="price">{money(o.total)}</span>
                      <span className={toneClass(o.status)}>{t(`checkout.status_${o.status}` as MessageKey)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Section>
          <p className="sl-hint db-counts">{t('seller.catalogCounts', { n: d.counts.products, d: d.counts.drafts })}</p>
        </>
      )}
      <button type="button" className="sl-fab" onClick={() => go('products/new')}>
        <SIcon name="plus" size={22} /> {t('seller.newProduct')}
      </button>
    </SellerScreen>
  );
}
