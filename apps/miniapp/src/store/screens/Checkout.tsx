/**
 * Checkout (§6.2 #7): one scroll — contact, delivery (zone → method with a date → address / pickup point),
 * payment tiles (sandbox clearly marked), comment and summary. The quote is re-priced server-side for
 * every change; MainButton "Pay 1 250 000 soʻm" shines while the form is valid. Prepaid methods open the
 * sandbox sheet, COD goes straight to the receipt.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, invalidate, useApi, useQuery } from '../../api';
import { useI18n } from '../../i18n';
import { shake } from '../../motion';
import { navigate, type RouteProps } from '../../router/router';
import { haptic, useMainButton } from '../../telegram/shim';
import { Button, EmptyState, Input, Skeleton, toast } from '../../ui';
import { StoreScreen, TopBar } from '../components/Chrome';
import { DeliverySection, needsAddress, PaymentSection, type AddressDraft } from '../checkout/Cards';
import { SandboxPay, type SandboxTarget } from '../checkout/SandboxPay';
import { formatPhone, isPhoneValid, orderError } from '../lib/cartState';
import { newIdempotencyKey } from '../lib/data';
import { Summary } from './Cart';
import '../styles/cart.css';
import '../styles/checkout.css';

export default function Checkout({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, l, money } = useI18n();
  const { api } = useApi();
  const [address, setAddress] = useState<AddressDraft>({ regionCode: 'UZ-TK', district: '', line1: '', landmark: '', save: true });
  const [methodId, setMethodId] = useState<string | null>(null);
  const [pickupId, setPickupId] = useState<string | null>(null);
  const [pay, setPay] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState(false);
  const [sandbox, setSandbox] = useState<SandboxTarget | null>(null);
  const key = useRef(newIdempotencyKey());
  const placedOrder = useRef<string | null>(null);

  const q = useQuery('checkout.quote', { slug, methodId, region: address.regionCode, district: address.district || null }, { staleMs: 0 });
  const quote = q.loading ? undefined : q.data;
  const [last, setLast] = useState(quote);
  if (quote && quote !== last) setLast(quote);
  const view = quote ?? last;
  const cart = view?.cart;
  const options = useMemo(() => view?.shippingOptions ?? [], [view]);
  const method = options.find((o) => o.methodId === methodId) ?? null;
  const methods = view?.paymentMethods ?? [];

  // sensible defaults once the quote arrives: first delivery option, first payment method, Telegram contact
  useEffect(() => {
    if (!view) return;
    if (!methodId || !options.some((o) => o.methodId === methodId)) setMethodId(options[0]?.methodId ?? null);
    if (!pay || !methods.some((m) => m.provider === pay)) setPay(methods.find((m) => m.provider !== 'cod')?.provider ?? methods[0]?.provider ?? null);
    if (name === null) setName(view.prefill.name ?? '');
    if (phone === null) setPhone(view.prefill.phone ? formatPhone(view.prefill.phone) : '');
    if (method?.type === 'pickup_point' && !pickupId) setPickupId(method.pickupPoints[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, methodId]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name?.trim()) e.name = t('checkout.nameRequired');
    if (!isPhoneValid(phone ?? '')) e.phone = t('checkout.phoneInvalid');
    if (cart && !cart.isDigital) {
      if (!method) e.method = t('checkout.err_SHIPPING_UNAVAILABLE');
      else if (needsAddress(method) && !address.line1.trim()) e.address = t('checkout.addressRequired');
      else if (method.type === 'pickup_point' && method.pickupPoints.length && !pickupId) e.pickupPoint = t('checkout.pickupChoose');
    }
    if (!pay) e.payment = t('checkout.err_PAYMENT_METHOD_UNAVAILABLE');
    return e;
  };
  const valid = !!cart && Object.keys(validate()).length === 0;

  const focusError = (e: Record<string, string>) => {
    const first = ['name', 'phone', 'method', 'address', 'pickupPoint', 'payment'].find((k) => e[k]);
    const el = first ? document.getElementById(`ck-${first}`) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    shake(el);
  };

  const done = (orderId: string) => {
    invalidate('cart.');
    invalidate('orders.');
    navigate(`/s/${slug}/orders/${orderId}?placed=1`, { replace: true });
  };

  const place = async () => {
    if (placedOrder.current && sandbox === null) return done(placedOrder.current);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return focusError(e);
    setPlacing(true);
    try {
      const pickup = method?.type === 'pickup_point' || method?.type === 'self_pickup';
      const r = await api['orders.place']({
        slug,
        idempotencyKey: key.current,
        contact: { name: name!.trim(), phone: (phone ?? '').replace(/[\s()-]/g, '') },
        methodId: cart?.isDigital ? null : methodId,
        address: !cart?.isDigital && !pickup ? { regionCode: address.regionCode, district: address.district || undefined, line1: address.line1.trim(), landmark: address.landmark || undefined, save: address.save } : { regionCode: address.regionCode, line1: '' },
        pickupPointId: method?.type === 'pickup_point' ? pickupId : null,
        paymentMethod: pay as 'cod',
        note: note.trim() || undefined,
      });
      placedOrder.current = r.order.id;
      const na = r.nextAction;
      if (na.type === 'sandbox') {
        const payment = (r.order.payments as Array<{ id: string; amount: number; currency: string }>).find((p) => p.id === na.paymentId);
        setSandbox({ provider: na.provider, paymentId: na.paymentId, orderId: r.order.id, amount: payment?.amount ?? r.order.total, currency: payment?.currency === 'XTR' ? 'XTR' : 'UZS' });
      } else {
        if (na.type === 'redirect') window.open(na.url, '_blank', 'noopener');
        haptic.notify('success');
        done(r.order.id);
      }
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      const field = ae?.details?.field as string | undefined;
      if (field) {
        const e2 = { [field === 'pickupPoint' ? 'pickupPoint' : field]: ae!.message };
        setErrors(e2);
        focusError(e2);
      }
      toast.error(orderError(t, ae?.code, ae?.message ?? ''));
      if (ae && ['OUT_OF_STOCK', 'PRICE_CHANGED', 'CART_EMPTY'].includes(ae.code)) {
        invalidate('cart.');
        navigate(`/s/${slug}/cart`, { replace: true });
      }
    } finally {
      setPlacing(false);
    }
  };

  const prepaid = pay && pay !== 'cod' && pay !== 'bank_transfer';
  const total = cart?.pricing.total ?? 0;
  useMainButton(
    cart && cart.items.length
      ? { text: prepaid ? t('checkout.payAmount', { amount: money(total) }) : `${t('checkout.placeOrder')} · ${money(total)}`, onClick: place, progress: placing || !quote, shine: valid && !placing, disabled: placing || !quote }
      : null,
  );

  if (q.error && !view)
    return <EmptyState icon="refresh" title={t('common.errorGeneric')} action={<Button variant="secondary" onClick={q.reload}>{t('common.retry')}</Button>} />;
  if (view && !view.cart.items.length && !placedOrder.current)
    return <EmptyState icon="cart" title={t('store.cartEmpty')} action={<Button onClick={() => navigate(`/s/${slug}`, { replace: true })}>{t('store.startShopping')}</Button>} />;

  return (
    <StoreScreen slug={slug} top={<TopBar title={t('checkout.title')} sub={cart ? t('store.cartItems', { n: cart.count }) : undefined} />} tight>
      {!view ? (
        <div className="st-stack">
          {[140, 200, 160].map((h, i) => (
            <Skeleton key={i} h={h} radius="var(--r-card)" />
          ))}
        </div>
      ) : (
        <>
          <section className="st-card st-ck">
            <h2 className="st-card-title">
              <span className="st-step">1</span> {t('checkout.contact')}
            </h2>
            <Input id="ck-name" label={t('checkout.name')} value={name ?? ''} onChange={(e) => setName(e.target.value)} autoComplete="name" error={errors.name} maxLength={80} />
            <Input id="ck-phone" label={t('checkout.phone')} inputMode="tel" value={phone ?? ''} onChange={(e) => setPhone(formatPhone(e.target.value))} autoComplete="tel" placeholder="+998 90 123 45 67" error={errors.phone} />
          </section>
          {!view.cart.isDigital && (
            <section className="st-card st-ck">
              <h2 className="st-card-title">
                <span className="st-step">2</span> {t('checkout.deliveryMethod')}
              </h2>
              <DeliverySection quote={view} methodId={methodId} onMethod={(id) => (setMethodId(id), setErrors((x) => ({ ...x, method: '' })))} address={address} onAddress={setAddress} pickupId={pickupId} onPickup={setPickupId} errors={errors} />
            </section>
          )}
          <section className="st-card st-ck">
            <h2 className="st-card-title">
              <span className="st-step">{view.cart.isDigital ? 2 : 3}</span> {t('checkout.paymentMethod')}
            </h2>
            {methods.some((m) => m.mode === 'sandbox' && m.provider !== 'cod') && <div className="st-banner is-sandbox">{t('checkout.sandbox')}</div>}
            <PaymentSection methods={methods} value={pay} onChange={setPay} error={errors.payment} />
            <p className="muted st-ck-secure">{t('checkout.secure')}</p>
          </section>
          <section className="st-card st-ck">
            <h2 className="st-card-title">
              <span className="st-step">{view.cart.isDigital ? 3 : 4}</span> {t('checkout.orderSummary')}
            </h2>
            <ul className="st-ck-items">
              {view.cart.items.map((it) => (
                <li key={it.variantId}>
                  {it.imageUrl && <img src={it.imageUrl} alt="" />}
                  <span>
                    {l(it.title)}
                    {it.variantTitle && <small className="muted"> · {it.variantTitle}</small>}
                  </span>
                  <b>×{it.qty}</b>
                </li>
              ))}
            </ul>
            <Input multiline rows={2} label={t('checkout.note')} placeholder={t('checkout.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            {view.cart.promoCode && view.cart.pricing.promo?.status === 'applied' && <p className="st-ck-promo">{t('checkout.promoApplied', { code: view.cart.promoCode })}</p>}
            <Summary pricing={view.cart.pricing} shippingKnown={!!method || view.cart.isDigital} />
            {q.loading && <div className="st-ck-pricing" aria-hidden="true" />}
          </section>
        </>
      )}
      <SandboxPay
        slug={slug}
        target={sandbox}
        onPaid={() => {
          const id = sandbox!.orderId;
          setSandbox(null);
          done(id);
        }}
        onLater={() => {
          const id = sandbox!.orderId;
          setSandbox(null);
          invalidate('cart.');
          invalidate('orders.');
          navigate(`/s/${slug}/orders/${id}`, { replace: true });
        }}
        onClose={() => {
          const id = sandbox!.orderId;
          setSandbox(null);
          invalidate('cart.');
          navigate(`/s/${slug}/orders/${id}`, { replace: true });
        }}
      />
    </StoreScreen>
  );
}
