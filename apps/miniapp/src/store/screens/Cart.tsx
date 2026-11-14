/**
 * Cart (§6.2 #6): steppers with optimistic quantities, remove with undo, stock and price-change warnings,
 * free-delivery progress, promo code with a specific reason when it does not apply, and a breakdown priced
 * by core's pipeline on the server; totals roll on the Odometer. MainButton → checkout.
 */
import { useState } from 'react';
import { ApiError, invalidate, useApi } from '../../api';
import { useI18n } from '../lib/i18n';
import { Odometer, Reveal, shake, staggerDelay } from '../../motion';
import { navigate, type RouteProps } from '../../router/router';
import { haptic, useMainButton } from '../../telegram/shim';
import { Button, EmptyState, Icon, Input, Skeleton, toast } from '../../ui';
import { StoreScreen, TopBar } from '../components/Chrome';
import { useCart, useCartActions, productUrl } from '../lib/data';
import { blockingLines, canCheckout, clampQty, freeShipping, hasPriceChange, lineWarning, normalisePromo, promoMessage } from '../lib/cartState';
import type { CartItem, CartView } from '../lib/types';
import '../styles/cart.css';

export function Stepper({ value, max, onChange, busy, label }: { value: number; max: number; onChange: (n: number) => void; busy?: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <div className={`st-stepper${busy ? ' is-busy' : ''}`} role="group" aria-label={label}>
      <button type="button" aria-label={value <= 1 ? t('store.remove') : '−'} onClick={() => onChange(value - 1)}>
        <Icon name={value <= 1 ? 'trash' : 'minus'} size={18} />
      </button>
      <span className="st-stepper-n" aria-live="polite">
        <Odometer value={value} />
      </span>
      <button type="button" aria-label="+" onClick={(e) => (value >= max ? shake(e.currentTarget) : onChange(value + 1))} aria-disabled={value >= max}>
        <Icon name="plus" size={18} />
      </button>
    </div>
  );
}

function Line({ slug, it, onQty, qty, busy }: { slug: string; it: CartItem; onQty: (it: CartItem, n: number) => void; qty: number; busy: boolean }) {
  const { t, l, money } = useI18n();
  const warn = lineWarning(t, it);
  const dead = it.warnings.includes('unavailable') || it.warnings.includes('out_of_stock');
  return (
    <article className={`st-line${warn ? ' has-warn' : ''}${dead ? ' is-dead' : ''}`}>
      <button type="button" className="st-line-img" onClick={() => navigate(productUrl(slug, it.productId))} aria-label={l(it.title)}>
        {it.imageUrl ? <img src={it.imageUrl} alt="" loading="lazy" /> : <Icon name="box" />}
      </button>
      <div className="st-line-main">
        <div className="st-line-title">{l(it.title)}</div>
        {it.variantTitle && <div className="st-line-variant">{it.variantTitle}</div>}
        <div className="st-line-price">
          <span className="price">{money(it.lineTotal)}</span>
          {it.lineDiscount > 0 && <span className="price-old">{money(it.unitPrice * it.qty)}</span>}
          {it.qty > 1 && <span className="muted st-line-unit">{`${money(it.unitPrice)} × ${it.qty}`}</span>}
        </div>
        {it.previousPrice != null && <div className="st-line-warn is-info">{t('store.priceChanged', { old: money(it.previousPrice), new: money(it.unitPrice) })}</div>}
        {warn && <div className="st-line-warn">{warn}</div>}
        <div className="st-line-actions">
          {dead ? (
            <Button variant="danger" size="sm" onClick={() => onQty(it, 0)} icon={<Icon name="trash" size={16} />}>
              {t('store.remove')}
            </Button>
          ) : (
            <Stepper value={qty} max={Math.max(1, it.maxQty)} onChange={(n) => onQty(it, n)} busy={busy} label={t('store.quantity')} />
          )}
          {it.warnings.includes('qty_reduced') && it.available > 0 && (
            <Button variant="secondary" size="sm" onClick={() => onQty(it, it.available)}>
              {t('store.warn_qty_reduced', { n: it.available })}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export function PromoField({ slug, cart }: { slug: string; cart: CartView }) {
  const { t, money } = useI18n();
  const { api } = useApi();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const applied = cart.promoCode && cart.pricing.promo?.status === 'applied' ? cart.promoCode : null;

  const apply = async () => {
    const c = normalisePromo(code);
    if (!c) return;
    setBusy(true);
    try {
      const r = await api['cart.applyPromo']({ slug, code: c });
      const m = promoMessage(t, money, c, { promo: r.promo, explanation: r.explanation });
      setMsg(m);
      if (m.ok) {
        haptic.notify('success');
        setCode('');
      } else haptic.notify('error');
      invalidate('cart.');
      invalidate('checkout.');
    } catch {
      setMsg({ ok: false, message: t('common.errorGeneric') });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api['cart.removePromo']({ slug });
      setMsg(null);
      invalidate('cart.');
      invalidate('checkout.');
    } finally {
      setBusy(false);
    }
  };

  if (applied)
    return (
      <div className="st-promo-on">
        <Icon name="tag" size={18} />
        <span>
          <b>{applied}</b> · {t('checkout.promoApplied', { code: applied })}
        </span>
        <button type="button" className="st-sec-more" onClick={remove} disabled={busy}>
          {t('store.remove')}
        </button>
      </div>
    );
  return (
    <form
      className="st-promo"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <Input
        value={code}
        onChange={(e) => (setCode(e.target.value.toUpperCase()), setMsg(null))}
        placeholder={t('checkout.promoPlaceholder')}
        aria-label={t('checkout.promoCode')}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        error={msg && !msg.ok ? msg.message : undefined}
        hint={msg?.ok ? msg.message : undefined}
      />
      <Button type="submit" variant="secondary" loading={busy} disabled={!code.trim()}>
        {t('common.apply')}
      </Button>
    </form>
  );
}

export function Summary({ pricing, shippingKnown = false }: { pricing: CartView['pricing']; shippingKnown?: boolean }) {
  const { t, money } = useI18n();
  const discount = pricing.productDiscountTotal + pricing.orderDiscountTotal;
  return (
    <dl className="st-summary">
      <div className="st-kv">
        <dt>{t('checkout.subtotal')}</dt>
        <dd>
          <Odometer value={money(pricing.subtotal)} />
        </dd>
      </div>
      {discount > 0 && (
        <div className="st-kv is-discount">
          <dt>{t('checkout.discount')}</dt>
          <dd>
            <Odometer value={`−${money(discount)}`} />
          </dd>
        </div>
      )}
      <div className="st-kv">
        <dt>{t('checkout.shipping')}</dt>
        <dd>{shippingKnown ? pricing.shippingTotal === 0 ? <span className="st-free">{t('checkout.free')}</span> : <Odometer value={money(pricing.shippingTotal)} /> : <span className="muted">—</span>}</dd>
      </div>
      <div className="st-kv is-total">
        <dt>{t('checkout.total')}</dt>
        <dd className="price">
          <Odometer value={money(pricing.total)} />
        </dd>
      </div>
    </dl>
  );
}

export default function Cart({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, money } = useI18n();
  const { api } = useApi();
  const cart = useCart(slug);
  const { setQty } = useCartActions(slug);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [accepting, setAccepting] = useState(false);
  const c = cart.data;
  const live = c?.items ?? [];
  const ok = c ? canCheckout(live) : false;

  const onQty = async (it: CartItem, n: number) => {
    const next = clampQty(it, n);
    if (next === (pending[it.variantId] ?? it.qty)) return;
    setPending((p) => ({ ...p, [it.variantId]: next }));
    try {
      await setQty(it.variantId, next);
      if (next === 0)
        toast.show(t('store.removed'), {
          action: { label: t('store.undo'), onClick: () => setQty(it.variantId, it.qty).catch(() => toast.error(t('common.errorGeneric'))) },
        });
    } catch (e) {
      toast.error(e instanceof ApiError && e.code === 'OUT_OF_STOCK' ? t('store.maxReached') : t('common.errorGeneric'));
    } finally {
      setPending((p) => {
        const { [it.variantId]: _, ...rest } = p;
        return rest;
      });
    }
  };

  useMainButton(
    c && live.length
      ? { text: `${t('store.checkout')} · ${money(c.pricing.total)}`, onClick: () => (ok ? navigate(`/s/${slug}/checkout`) : (haptic.notify('error'), toast.error(t('store.cartFix')))), disabled: !ok, shine: ok }
      : null,
  );

  const fs = c ? freeShipping(c.pricing) : null;
  return (
    <StoreScreen slug={slug} tab="cart" top={<TopBar title={t('store.cart')} sub={c && c.count > 0 ? t('store.cartItems', { n: c.count }) : undefined} />}>
      {cart.loading && !c ? (
        <div className="st-stack">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={110} radius="var(--r-card)" />
          ))}
        </div>
      ) : cart.error && !c ? (
        <EmptyState icon="refresh" title={t('common.errorGeneric')} action={<Button variant="secondary" onClick={cart.reload}>{t('common.retry')}</Button>} />
      ) : !live.length ? (
        <EmptyState icon="cart" title={t('store.cartEmpty')} hint={t('store.cartEmptyHint')} action={<Button onClick={() => navigate(`/s/${slug}`)}>{t('store.startShopping')}</Button>} />
      ) : (
        <>
          {fs && (
            <div className={`st-freeship${fs.remaining === 0 ? ' is-done' : ''}`}>
              <div className="st-freeship-text">
                <Icon name="truck" size={18} />
                {fs.remaining === 0 ? t('store.freeShippingDone') : t('store.freeShippingLeft', { amount: money(fs.remaining) })}
              </div>
              <div className="st-freeship-track">
                <span style={{ transform: `scaleX(${fs.ratio})` }} />
              </div>
            </div>
          )}
          {hasPriceChange(live) && (
            <div className="st-banner">
              <Icon name="tag" size={18} />
              <span>{t('checkout.err_PRICE_CHANGED')}</span>
              <Button
                size="sm"
                loading={accepting}
                onClick={async () => {
                  setAccepting(true);
                  try {
                    await api['cart.acceptPrices']({ slug });
                    invalidate('cart.');
                  } finally {
                    setAccepting(false);
                  }
                }}
              >
                {t('store.acceptPrices')}
              </Button>
            </div>
          )}
          {blockingLines(live).length > 0 && <div className="st-banner is-warn">{t('store.cartFix')}</div>}
          <div className="st-lines">
            {live.map((it, i) => (
              <Reveal key={it.variantId} delay={staggerDelay(i)}>
                <Line slug={slug} it={it} qty={pending[it.variantId] ?? it.qty} busy={it.variantId in pending} onQty={onQty} />
              </Reveal>
            ))}
          </div>
          <section className="st-card st-stack">
            <PromoField slug={slug} cart={c!} />
            <Summary pricing={c!.pricing} />
          </section>
        </>
      )}
    </StoreScreen>
  );
}
