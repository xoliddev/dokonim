/**
 * Order detail + tracking (§6.2 #9): live status timeline (LocalApi pushes an `outbox` event on every status
 * change; HttpApi falls back to polling), pickup code, items, delivery, payment, totals; pay / cancel / reorder.
 * Arriving with `?placed=1` plays the receipt-print success moment.
 */
import { useEffect, useState } from 'react';
import type { L10n } from '@dokonim/core';
import { ApiError, invalidate, useApi, useQuery } from '../../api';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../lib/i18n';
import { navigate, type RouteProps } from '../../router/router';
import { tg, useMainButton } from '../../telegram/shim';
import { Button, EmptyState, Icon, Skeleton, toast } from '../../ui';
import { StoreScreen, TopBar } from '../components/Chrome';
import { SandboxPay, type SandboxTarget } from '../checkout/SandboxPay';
import { Receipt } from '../orders/Receipt';
import { Timeline } from '../orders/Timeline';
import type { OrderEventRow, OrderItemRow, PaymentRow } from '../lib/types';
import '../styles/orders.css';

const FINAL = ['delivered', 'completed', 'cancelled', 'returned'];

/** Re-fetches the order whenever the backend reports a change; polls as a fallback while it is still moving. */
function useLiveOrder(slug: string, id: string) {
  const client = useApi();
  const q = useQuery('orders.get', { slug, id }, { staleMs: 3_000 });
  const status = q.data?.status;
  const { reload } = q;
  useEffect(() => client.onEvent((e) => e.type === 'outbox' && reload()), [client, reload]);
  useEffect(() => {
    if (status && FINAL.includes(status)) return;
    const t = setInterval(reload, client.kind === 'local' ? 5_000 : 8_000);
    return () => clearInterval(t);
  }, [client.kind, status, reload]);
  return q;
}

export default function OrderDetail({ params, query }: RouteProps) {
  const slug = params.slug!;
  const id = params.orderId!;
  const placed = query.get('placed') === '1';
  const { t, l, money, relativeDay, dateTime } = useI18n();
  const { api } = useApi();
  const q = useLiveOrder(slug, id);
  const o = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<SandboxTarget | null>(null);

  const items = (o?.items ?? []) as unknown as OrderItemRow[];
  const events = (o?.events ?? []) as unknown as OrderEventRow[];
  const payments = (o?.payments ?? []) as unknown as PaymentRow[];
  const allowed = (o?.allowed ?? []) as string[];
  const paid = o?.paymentStatus === 'paid';
  const addr = o?.shippingAddress as { line1?: string; landmark?: string; district?: string; pickupPoint?: { name: L10n; address: string } } | null | undefined;

  const payNow = async () => {
    if (!o) return;
    setBusy('pay');
    try {
      const r = await api['orders.retryPayment']({ slug, id: o.id });
      if (r.nextAction.type === 'sandbox') setSandbox({ provider: r.nextAction.provider, paymentId: r.nextAction.paymentId, orderId: o.id, amount: o.total, currency: 'UZS' });
      else if (r.nextAction.type === 'redirect') window.open(r.nextAction.url, '_blank', 'noopener');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!o || !(await tg.confirm(t('store.cancelConfirm')))) return;
    setBusy('cancel');
    try {
      await api['orders.cancel']({ slug, id: o.id });
      toast.success(t('store.cancelled'));
      q.reload();
      invalidate('orders.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t('common.errorGeneric'));
    } finally {
      setBusy(null);
    }
  };
  const reorder = async () => {
    if (!o) return;
    setBusy('reorder');
    try {
      const r = await api['orders.reorder']({ slug, id: o.id });
      invalidate('cart.');
      toast.success(t('store.reorderDone', { n: r.added }));
      navigate(`/s/${slug}/cart`);
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setBusy(null);
    }
  };

  useMainButton(
    !o
      ? null
      : o.status === 'pending_payment'
        ? { text: t('checkout.payAmount', { amount: money(o.total) }), onClick: payNow, progress: busy === 'pay', shine: true }
        : placed
          ? { text: t('checkout.continueShopping'), onClick: () => navigate(`/s/${slug}`) }
          : null,
  );

  const body = o && (
    <>
      {o.pickupCode && (
        <section className="st-card st-pickup">
          <span className="muted">{t('store.pickupCode')}</span>
          <span className="st-pickup-code">{o.pickupCode}</span>
          <span className="muted">{t('store.pickupCodeHint')}</span>
        </section>
      )}
      <section className="st-card">
        <h2 className="st-card-title">
          {t('store.timeline')}
          {!FINAL.includes(o.status) && (
            <span className="st-live">
              <i /> {t('store.liveTracking')}
            </span>
          )}
        </h2>
        <Timeline status={o.status} paymentMethod={o.paymentMethod} fulfilment={o.fulfilmentKind} events={events} />
        {o.deliveryPromise && !FINAL.includes(o.status) && <p className="st-expect">{t('store.expectedOn', { date: relativeDay(o.deliveryPromise.from) })}</p>}
      </section>
      <section className="st-card">
        <h2 className="st-card-title">{t('store.orderItems')}</h2>
        <ul className="st-ck-items">
          {items.map((it) => (
            <li key={it.id}>
              {it.imageUrl && <img src={it.imageUrl} alt="" />}
              <span>
                {it.title}
                {it.variantTitle && <small className="muted"> · {it.variantTitle}</small>}
              </span>
              <b>
                {it.qty} × {money(it.unitPrice)}
              </b>
            </li>
          ))}
        </ul>
        <dl className="st-summary">
          <div className="st-kv">
            <dt>{t('checkout.subtotal')}</dt>
            <dd>{money(o.subtotal)}</dd>
          </div>
          {o.discountTotal > 0 && (
            <div className="st-kv is-discount">
              <dt>{t('checkout.discount')}</dt>
              <dd>−{money(o.discountTotal)}</dd>
            </div>
          )}
          <div className="st-kv">
            <dt>{t('checkout.shipping')}</dt>
            <dd>{o.shippingTotal ? money(o.shippingTotal) : t('checkout.free')}</dd>
          </div>
          <div className="st-kv is-total">
            <dt>{t('checkout.total')}</dt>
            <dd className="price">{money(o.total)}</dd>
          </div>
        </dl>
      </section>
      <section className="st-card">
        <dl className="st-summary">
          {o.shippingMethodName && (
            <div className="st-kv">
              <dt>{t('checkout.deliveryMethod')}</dt>
              <dd>{l(o.shippingMethodName)}</dd>
            </div>
          )}
          {addr?.line1 && (
            <div className="st-kv">
              <dt>{t('store.deliveryAddress')}</dt>
              <dd>{[addr.line1, addr.district, addr.landmark].filter(Boolean).join(', ')}</dd>
            </div>
          )}
          {addr?.pickupPoint && (
            <div className="st-kv">
              <dt>{t('checkout.pickupPoint')}</dt>
              <dd>
                {l(addr.pickupPoint.name)}, {addr.pickupPoint.address}
              </dd>
            </div>
          )}
          <div className="st-kv">
            <dt>{t('checkout.paymentMethod')}</dt>
            <dd>
              {t(`checkout.pay_${o.paymentMethod}` as MessageKey)} · {t(`checkout.payment_${payments.at(-1)?.status ?? 'created'}` as MessageKey)}
              {payments.at(-1)?.mode === 'sandbox' && o.paymentMethod !== 'cod' && <span className="st-badge is-sandbox" style={{ marginLeft: 6 }}>{t('checkout.sandboxShort')}</span>}
            </dd>
          </div>
          <div className="st-kv">
            <dt>{t('checkout.contact')}</dt>
            <dd>
              {o.contact?.name}, {o.contact?.phone}
            </dd>
          </div>
        </dl>
      </section>
      <div className="st-stack">
        {o.status === 'pending_payment' && (
          <Button block size="lg" onClick={payNow} loading={busy === 'pay'}>
            {t('checkout.payAmount', { amount: money(o.total) })}
          </Button>
        )}
        {FINAL.includes(o.status) && o.status !== 'cancelled' && (
          <Button block variant="secondary" onClick={reorder} loading={busy === 'reorder'} icon={<Icon name="refresh" size={18} />}>
            {t('store.reorder')}
          </Button>
        )}
        {allowed.includes('cancel') && (
          <Button block variant="danger" onClick={cancel} loading={busy === 'cancel'}>
            {t('store.cancelOrder')}
          </Button>
        )}
      </div>
    </>
  );

  return (
    <StoreScreen
      slug={slug}
      tab={placed ? undefined : null}
      top={<TopBar title={o ? t('store.orderNumber', { number: String(o.number) }) : t('store.trackOrder')} sub={o ? t('store.orderedOn', { date: dateTime(o.placedAt) }) : undefined} />}
    >
      {q.loading && !o ? (
        <div className="st-stack">
          <Skeleton h={180} radius="var(--r-card)" />
          <Skeleton h={140} radius="var(--r-card)" />
        </div>
      ) : !o ? (
        <EmptyState icon="receipt" title={t('common.errorNotFound')} action={<Button onClick={() => navigate(`/s/${slug}/orders`, { replace: true })}>{t('store.myOrders')}</Button>} />
      ) : placed ? (
        <>
          <Receipt paid={paid} number={o.number}>
            <div className="st-receipt-lines">
              {items.slice(0, 4).map((it) => (
                <div key={it.id} className="st-kv">
                  <dt>
                    {it.title} ×{it.qty}
                  </dt>
                  <dd>{money(it.lineTotal)}</dd>
                </div>
              ))}
              <div className="st-kv is-total">
                <dt>{t('checkout.total')}</dt>
                <dd className="price">{money(o.total)}</dd>
              </div>
            </div>
            <p className="muted st-receipt-hint">{t('checkout.orderPlacedHint')}</p>
          </Receipt>
          {body}
        </>
      ) : (
        body
      )}
      <SandboxPay
        slug={slug}
        target={sandbox}
        onPaid={() => (setSandbox(null), q.reload(), invalidate('orders.'))}
        onLater={() => setSandbox(null)}
        onClose={() => setSandbox(null)}
      />
    </StoreScreen>
  );
}
