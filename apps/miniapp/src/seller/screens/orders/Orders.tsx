/**
 * Orders queue (§6.3): status tabs with live counts, search, list grouped by status, an inline optimistic
 * "Confirm" on orders waiting for it. Tapping opens the detail with the next allowed action as MainButton.
 */
import { useEffect, useMemo, useState } from 'react';
import { m } from 'motion/react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring, staggerDelay, useMotionTier } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { navigate } from '../../../router/router';
import { haptic } from '../../../telegram/shim';
import { toast } from '../../../ui';
import { Segmented } from '../../components/Controls';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { BUCKETS, bucketCount, toneClass, type Bucket } from '../../lib/status';
import './orders.css';

type Tab = Exclude<Bucket, 'pending'> | 'all';
export interface OrderListItem {
  id: string;
  number: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  fulfilmentKind: string;
  total: number;
  contact: { name?: string; phone?: string };
  placedAt: string;
  items: Array<{ title: string; imageUrl: string | null; qty: number; variantTitle: string }> | null;
}

const ORDER = [...BUCKETS.attention, ...BUCKETS.active, 'pending_payment', ...BUCKETS.done, ...BUCKETS.closed];

export default function Orders({ query }: RouteProps) {
  const { t, money, relativeDay, time } = useI18n();
  const tier = useMotionTier();
  const s = useSeller();
  const [tab, setTab] = useState<Tab>(((query.get('tab') as Tab) || 'attention'));
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [patched, setPatched] = useState<Record<string, string>>({});
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const list = useQuery('admin.orders.list', s.storeId ? { storeId: s.storeId, status: tab === 'all' ? null : tab, q: dq || null } : null);
  const tr = useMutation('admin.orders.transition', { invalidates: ['admin.orders', 'admin.dashboard'] });
  const data = list.data as { items: OrderListItem[]; counts: Record<string, number> } | undefined;
  useEffect(() => setPatched({}), [data]);

  const groups = useMemo(() => {
    const items = (data?.items ?? []).map((o) => (patched[o.id] ? { ...o, status: patched[o.id]! } : o));
    const by = new Map<string, OrderListItem[]>();
    for (const o of items) by.set(o.status, [...(by.get(o.status) ?? []), o]);
    return [...by.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  }, [data, patched]);

  const confirm = async (o: OrderListItem) => {
    if (!s.storeId) return;
    setPatched((p) => ({ ...p, [o.id]: 'confirmed' }));
    haptic.impact('medium');
    try {
      await tr.run({ storeId: s.storeId, id: o.id, event: 'confirm' });
      haptic.notify('success');
      toast.success(t('seller.ordMoved', { status: t('checkout.status_confirmed') }));
    } catch (e) {
      setPatched((p) => {
        const { [o.id]: _, ...rest } = p;
        return rest;
      });
      toastError(e, t);
    }
  };

  const tabs: Tab[] = ['attention', 'active', 'done', 'closed', 'all'];
  let row = 0;
  return (
    <SellerScreen tab="orders" title={t('seller.orders')}>
      <label className="sl-search">
        <SIcon name="search" size={18} />
        <input type="search" value={q} placeholder={t('seller.ordSearch')} onChange={(e) => setQ(e.target.value)} />
      </label>
      <Segmented<Tab> size="sm" value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x, label: t(`seller.ordTab_${x}` as MessageKey), count: x === 'all' ? undefined : bucketCount(data?.counts, x) || undefined }))} />
      <Gate loading={!data && list.loading} error={!data && (s.error ?? list.error)} onRetry={list.reload}>
        {groups.length === 0 ? (
          <Empty icon="receipt" title={t('seller.ordEmpty')} hint={t('seller.ordEmptyHint')} />
        ) : (
          groups.map(([status, items]) => (
            <section key={status} className="or-group">
              <h2 className="or-group-title">
                <span className={toneClass(status)}>{t(`checkout.status_${status}` as MessageKey)}</span>
                <span className="muted">{items.length}</span>
              </h2>
              <div className="sl-list">
                {items.map((o) => {
                  const i = row++;
                  const first = o.items?.[0];
                  const qty = (o.items ?? []).reduce((n, x) => n + x.qty, 0);
                  return (
                    <m.div key={o.id} className={`or-row${o.status === 'paid' || o.status === 'awaiting_confirmation' ? ' has-quick' : ''}`} layout={tier === 'full' ? 'position' : false} initial={tier === 'minimal' ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: staggerDelay(i) }}>
                      <button type="button" className="sl-row" onClick={() => navigate(`/m/${s.slug}/orders/${o.id}`)}>
                        {first?.imageUrl ? <img className="sl-thumb" src={first.imageUrl} alt="" /> : <span className="sl-thumb or-no">#{o.number}</span>}
                        <span className="sl-row-main">
                          <span className="sl-row-title">
                            {t('seller.orderNo', { n: String(o.number) })} · {o.contact?.name || '—'}
                          </span>
                          <span className="sl-row-sub">
                            {t('seller.ordItems', { n: qty })} · {relativeDay(o.placedAt)} {time(o.placedAt)}
                          </span>
                          <span className="sl-row-sub">
                            <SIcon name={o.fulfilmentKind === 'pickup' ? 'store' : 'truck'} size={12} /> {t(`checkout.pay_${o.paymentMethod}` as MessageKey)}
                          </span>
                        </span>
                        <span className="sl-row-end">
                          <span className="price">{money(o.total)}</span>
                        </span>
                      </button>
                      {(o.status === 'paid' || o.status === 'awaiting_confirmation') && (
                        <button type="button" className="or-quick" disabled={tr.loading} onClick={() => void confirm(o)}>
                          <SIcon name="check" size={16} /> {t('seller.ordQuick')}
                        </button>
                      )}
                    </m.div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </Gate>
    </SellerScreen>
  );
}
