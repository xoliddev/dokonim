/**
 * Order detail (§6.3): big status header, the next allowed action as MainButton (from the core state machine's
 * `allowed` list), secondary actions, sandbox refund, items + totals, customer, timeline and internal notes.
 */
import { useState } from 'react';
import { m } from 'motion/react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, Input, toast } from '../../../ui';
import { Section, SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { STATUS_TONE } from '../../lib/status';
import { ActionSheet, Timeline, type Detail } from './OrderParts';
import './orders.css';

const FORWARD = ['confirm', 'pack', 'ship', 'ready_for_pickup', 'deliver', 'complete', 'accept_return'];
const INV = ['admin.orders', 'admin.dashboard', 'admin.inventory', 'admin.products'];

export default function OrderDetail({ params }: RouteProps) {
  const { t, money, dateTime, l } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.orders.get', s.storeId ? { storeId: s.storeId, id: params.id! } : null, { staleMs: 0 });
  const tr = useMutation('admin.orders.transition', { invalidates: INV });
  const refund = useMutation('admin.orders.refund', { invalidates: INV });
  const note = useMutation('admin.orders.note', { invalidates: ['admin.orders.get'] });
  const [sheet, setSheet] = useState<null | 'ship' | 'cancel' | 'refund' | 'reject_return'>(null);
  const [noteText, setNoteText] = useState('');
  const o = q.data as Detail | undefined;

  const allowed = (o?.allowed ?? []).filter((e) => e !== 'request_return' && e !== 'pay');
  const primary = o?.canManage ? allowed.find((e) => FORWARD.includes(e)) : undefined;
  const secondary = o?.canManage ? allowed.filter((e) => e !== primary) : [];
  const canRefund = !!o?.canManage && o.paymentStatus === 'paid' && ['paid', 'confirmed', 'packing', 'return_requested'].includes(o.status);

  const run = async (event: string, extra: Record<string, string> = {}) => {
    if (!s.storeId || !o) return;
    try {
      const r = (await tr.run({ storeId: s.storeId, id: o.id, event: event as never, ...extra })) as { status: string };
      haptic.notify('success');
      toast.success(t('seller.ordMoved', { status: t(`checkout.status_${r.status}` as MessageKey) }));
      setSheet(null);
      q.reload();
    } catch (e) {
      toastError(e, t);
    }
  };
  const doRefund = async (reason: string) => {
    if (!s.storeId || !o) return;
    try {
      await refund.run({ storeId: s.storeId, id: o.id, reason: reason || 'refund' });
      haptic.notify('success');
      toast.success(t('seller.ordRefunded'));
      setSheet(null);
      q.reload();
    } catch (e) {
      toastError(e, t);
    }
  };
  const addNote = async () => {
    if (!s.storeId || !o || !noteText.trim()) return;
    try {
      await note.run({ storeId: s.storeId, id: o.id, text: noteText.trim() });
      setNoteText('');
      toast.success(t('seller.ordNoteAdded'));
    } catch (e) {
      toastError(e, t);
    }
  };

  const onPrimary = () => (primary === 'ship' ? setSheet('ship') : primary && void run(primary));
  useMainButton(primary ? { text: t(`seller.act_${primary}` as MessageKey), onClick: onPrimary, progress: tr.loading, disabled: tr.loading, hidden: !!sheet } : null);

  const tone = o ? (STATUS_TONE[o.status] ?? 'muted') : 'muted';
  return (
    <SellerScreen kicker={o ? dateTime(o.placedAt) : undefined} title={o ? t('seller.orderNo', { n: o.number }) : '…'}>
      <Gate loading={!o && !q.error} error={!o && (s.error ?? q.error)} onRetry={q.reload}>
        {o && (
          <>
            <m.div key={o.status} className={`od-status is-${tone}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring.bouncy}>
              <span className="od-status-label">{t(`checkout.status_${o.status}` as MessageKey)}</span>
              <span className="od-status-total price">{money(o.total)}</span>
              <span className="od-status-sub">
                {t(`checkout.pay_${o.paymentMethod}` as MessageKey)} · {t(`checkout.payment_${o.paymentStatus}` as MessageKey)}
                {o.payments?.[0]?.mode === 'sandbox' && <span className="sl-pill is-warn">{t('seller.ordSandbox')}</span>}
              </span>
            </m.div>
            {(secondary.length > 0 || canRefund) && (
              <div className="od-actions">
                {secondary.map((e) => (
                  <Button key={e} variant={e === 'cancel' || e === 'reject_return' ? 'danger' : 'secondary'} size="sm" disabled={tr.loading} onClick={() => (e === 'cancel' || e === 'reject_return' ? setSheet(e === 'cancel' ? 'cancel' : 'reject_return') : e === 'ship' ? setSheet('ship') : void run(e))}>
                    {t(`seller.act_${e}` as MessageKey)}
                  </Button>
                ))}
                {canRefund && (
                  <Button variant="secondary" size="sm" icon={<SIcon name="undo" size={16} />} onClick={() => setSheet('refund')}>
                    {t('seller.refund')}
                  </Button>
                )}
              </div>
            )}
            {!primary && secondary.length === 0 && !canRefund && <p className="sl-hint">{t('seller.ordNoActions')}</p>}

            <Section title={t('seller.ordItems', { n: o.items.reduce((n, x) => n + x.qty, 0) })}>
              <div className="sl-list">
                {o.items.map((it) => (
                  <div key={it.id} className="sl-row">
                    {it.imageUrl ? <img className="sl-thumb" src={it.imageUrl} alt="" /> : <span className="sl-thumb" />}
                    <span className="sl-row-main">
                      <span className="sl-row-title">{it.title}</span>
                      <span className="sl-row-sub">{[it.variantTitle, it.sku].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="sl-row-end">
                      <span className="price">{money(it.lineTotal)}</span>
                      <span className="sl-row-sub">{it.qty} × {money(it.unitPrice)}</span>
                    </span>
                  </div>
                ))}
              </div>
              <dl className="od-totals">
                <dt>{t('seller.ordSubtotal')}</dt><dd>{money(o.subtotal)}</dd>
                {o.discountTotal > 0 && (<><dt>{t('seller.ordDiscount')}</dt><dd>−{money(o.discountTotal)}</dd></>)}
                <dt>{t('seller.ordShipping')}</dt><dd>{money(o.shippingTotal)}</dd>
                <dt className="od-grand">{t('seller.ordTotal')}</dt><dd className="od-grand price">{money(o.total)}</dd>
              </dl>
            </Section>

            <Section title={t('seller.customer')}>
              <div className="od-card">
                <div className="od-line"><SIcon name="user" size={18} /> <strong>{o.contact.name || '—'}</strong></div>
                {o.contact.phone && (
                  <a className="od-line sl-link" href={`tel:${o.contact.phone}`}><SIcon name="phone" size={18} /> {o.contact.phone}</a>
                )}
                <div className="od-line">
                  <SIcon name={o.fulfilmentKind === 'pickup' ? 'store' : 'truck'} size={18} />
                  {o.fulfilmentKind === 'pickup' ? t('seller.ordPickup') : t('seller.ordDelivery')}
                  {o.shippingMethodName && ` · ${l(o.shippingMethodName)}`}
                </div>
                {o.shippingAddress && <div className="od-line muted"><SIcon name="map" size={18} /> {[o.shippingAddress.regionCode, o.shippingAddress.district, o.shippingAddress.line1].filter(Boolean).join(', ')}</div>}
                {o.note && <div className="od-note"><span className="muted">{t('seller.ordBuyerNote')}:</span> {o.note}</div>}
              </div>
            </Section>

            <Section title={t('seller.timeline')}>
              <Timeline events={o.events} notes={o.notes} />
              {o.canManage && (
                <div className="od-note-form">
                  <Input value={noteText} placeholder={t('seller.ordNotePh')} maxLength={1000} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addNote()} />
                  <Button size="sm" variant="secondary" loading={note.loading} disabled={!noteText.trim()} onClick={() => void addNote()}>{t('seller.addNote')}</Button>
                </div>
              )}
            </Section>
          </>
        )}
      </Gate>
      <ActionSheet kind={sheet} busy={tr.loading || refund.loading} onClose={() => setSheet(null)} onShip={(x) => void run('ship', x)} onCancel={(reason) => void run(sheet === 'reject_return' ? 'reject_return' : 'cancel', reason ? { reason } : {})} onRefund={(reason) => void doRefund(reason)} />
    </SellerScreen>
  );
}
