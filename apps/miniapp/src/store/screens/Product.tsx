/**
 * Product page (§6.2 #5): Continuity hero (renders instantly from the card hand-off), price with compare-at
 * and The Split, variant matrix that drives price/stock/image, delivery dates, description, specs,
 * reviews, Q&A, related. MainButton = add to cart with The Arc; drag down or swipe right to dismiss.
 */
import { useRef, useState } from 'react';
import type { L10n } from '@dokonim/core';
import { ApiError, useQuery } from '../../api';
import { useI18n } from '../../i18n';
import { DismissablePage, flyToCart, InstallmentSplit, MorphContent, shake } from '../../motion';
import { back, navigate, type RouteProps } from '../../router/router';
import { useCurrentStore } from '../../shell/session';
import { haptic, useMainButton } from '../../telegram/shim';
import { announce, Button, EmptyState, Icon, Sheet, Skeleton, toast } from '../../ui';
import { TopActions } from '../components/Chrome';
import { ProductRail } from '../home/Sections';
import { DeliveryCard, isEmptyDoc, pickDoc, RichText, Specs } from '../product/Blocks';
import { Gallery, type GalleryHandle } from '../product/Gallery';
import { Questions, Reviews } from '../product/Reviews';
import { VariantPicker } from '../product/VariantPicker';
import { handoffFor, qtyInCart, useCart, useCartActions, useWishlist } from '../lib/data';
import type { ShippingOpt } from '../lib/types';
import { addableQty, initialSelection, pickerState, selectValue, type Selection } from '../lib/variants';
import '../styles/base.css';
import '../styles/card.css';
import '../styles/product.css';

interface ProductRow {
  id: string;
  shortId: string;
  title: L10n;
  description: unknown;
  attributes: Array<{ name: L10n; value: L10n }>;
  brand: string;
  vendorCode: string;
  sizeGuide: L10n | null;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  isDigital: boolean;
}
interface MediaRow {
  url: string;
  kind: string;
}

const NO_MORPH = { has: () => true } as unknown as Set<string>;

export default function Product({ params }: RouteProps) {
  const slug = params.slug!;
  const pid = params.productId!;
  const { t, l, money, locale } = useI18n();
  const hand = handoffFor(pid);
  const store = useCurrentStore();
  const q = useQuery('store.product', { slug, id: pid }, { staleMs: 30_000 });
  const d = q.data;
  const p = d?.product as unknown as ProductRow | undefined;
  const related = useQuery('store.related', p ? { slug, productId: p.id } : null, { staleMs: 120_000 });
  const cart = useCart(slug);
  const { setQty } = useCartActions(slug);
  const wish = useWishlist(slug);
  const gallery = useRef<GalleryHandle>(null);
  const picker = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [nudge, setNudge] = useState(false);
  const [adding, setAdding] = useState(false);
  const [guide, setGuide] = useState(false);

  const options = d?.options ?? [];
  const variants = d?.variants ?? [];
  const selection = sel ?? (d ? initialSelection(options, variants) : []);
  const state = d ? pickerState(options, variants, selection) : null;
  const variant = state?.variant;
  const inCart = qtyInCart(cart.data, variant?.id);
  const title = p ? l(p.title) : hand ? l(hand.title) : '';
  const id = p?.id ?? hand?.id ?? pid;
  const saved = wish.has(id);
  const description = p ? pickDoc(p.description, locale) : null;

  const media = ((d?.media ?? []) as unknown as MediaRow[]).filter((m) => m.kind !== 'video').map((m) => m.url);
  const urls = media.length ? [...media] : hand?.coverUrl ? [hand.coverUrl] : [];
  if (state?.mediaUrl && !urls.includes(state.mediaUrl)) urls.push(state.mediaUrl);

  const pick = (oi: number, vid: string) => {
    haptic.selection();
    setSel(selectValue(options, variants, selection, oi, vid));
  };

  const add = async (thenGo?: boolean) => {
    if (!state || !p) return;
    if (!variant) {
      setNudge(true);
      shake(picker.current);
      picker.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (addableQty(variant, inCart) <= 0) {
      shake(picker.current);
      toast.error(state.purchasable ? t('store.maxReached') : t('store.outOfStock'));
      return;
    }
    if (thenGo && inCart > 0) return navigate(`/s/${slug}/cart`);
    setAdding(true);
    const img = gallery.current?.current() ?? null;
    const fly = img ? flyToCart({ from: img, imageUrl: gallery.current?.currentUrl() }) : Promise.resolve();
    try {
      await setQty(variant.id, inCart + 1);
      await fly;
      announce(t('store.addedToCart', { title: [title, variant.optionValueIds.length ? optionText() : ''].filter(Boolean).join(', ') }));
      if (thenGo) navigate(`/s/${slug}/cart`);
    } catch (e) {
      shake(picker.current);
      toast.error(e instanceof ApiError && e.code === 'OUT_OF_STOCK' ? t('store.maxReached') : t('common.errorGeneric'));
    } finally {
      setAdding(false);
    }
  };
  const optionText = () => options.map((o, i) => l(o.values.find((v) => v.id === selection[i])?.label)).filter(Boolean).join(', ');

  useMainButton(
    !d || !state
      ? null
      : !variant
        ? { text: t('store.chooseVariant'), onClick: () => add() }
        : !state.purchasable
          ? { text: t('store.outOfStock'), onClick: () => add(), disabled: true }
          : { text: `${t('store.addToCart')} · ${money(state.price)}`, onClick: () => add(), progress: adding, shine: inCart === 0 },
  );

  const dismiss = () => back(`/s/${slug}`);
  const plans = (store.data?.store.installments ?? []) as Array<{ months: number; markupPercent: number }>;
  const price = state?.price ?? hand?.price ?? 0;
  const compareAt = state ? state.compareAt : (hand?.compareAt ?? null);
  const discount = state?.discountPercent ?? 0;

  if (q.error && !d)
    return (
      <div className="screen-pad">
        <EmptyState icon="box" title={t('common.errorNotFound')} action={<Button onClick={() => navigate(`/s/${slug}`, { replace: true })}>{t('store.home')}</Button>} />
      </div>
    );

  return (
    <DismissablePage onDismiss={dismiss} className="st-pdp">
      <div className="st-pdp-top">
        <button type="button" className="st-icon-btn is-raised" aria-label={t('common.back')} onClick={dismiss}>
          <Icon name="back" />
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className={`st-icon-btn is-raised st-pdp-heart${saved ? ' is-on' : ''}`}
          aria-pressed={saved}
          aria-label={saved ? t('store.removeFromWishlist') : t('store.addToWishlist')}
          onClick={() => wish.toggle(id, saved).catch(() => toast.error(t('common.errorGeneric')))}
        >
          <Icon name="heart" filled={saved} />
        </button>
        <span className="st-pdp-cart">
          <TopActions slug={slug} search={false} cart />
        </span>
      </div>
      {urls.length ? (
        <Gallery ref={gallery} morphId={id} urls={urls} alt={title} focusUrl={state?.mediaUrl} badge={discount > 0 ? <span className="st-badge is-sale">{t('store.discountBadge', { percent: discount })}</span> : null} />
      ) : (
        <Skeleton h="auto" radius={0} style={{ aspectRatio: '4 / 5' }} />
      )}
      <div className="st-pdp-body">
        <MorphContent index={0} className="st-pdp-head">
          {plans.length > 0 && price >= 50_000_000 ? (
            <InstallmentSplit price={price} plans={plans} />
          ) : (
            <div className={`price st-pdp-price${compareAt ? ' is-sale' : ''}`}>{state && !variant && state.maxPrice > state.price ? `${t('store.priceMin')} ${money(price)}` : money(price)}</div>
          )}
          {compareAt && (
            <div className="st-row" style={{ gap: 8 }}>
              <span className="price-old">{money(compareAt)}</span>
              <span className="st-badge is-soft">{t('store.youSave', { amount: money(compareAt - price) })}</span>
            </div>
          )}
          <h1 className="st-pdp-title">{title || <Skeleton w="70%" h={20} />}</h1>
          {p && (
            <div className="st-pdp-meta">
              {p.ratingCount > 0 && (
                <a href="#reviews" className="st-rating" onClick={(e) => (e.preventDefault(), document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth' }))}>
                  <Icon name="star" filled size={14} className="st-stars" /> <b>{p.ratingAvg.toFixed(1)}</b> · {t('common.reviews', { n: p.ratingCount })}
                </a>
              )}
              {p.soldCount > 0 && <span className="muted">{t('store.sold', { n: p.soldCount })}</span>}
              {(variant?.sku || p.vendorCode) && <span className="muted">{t('store.sku', { sku: variant?.sku || p.vendorCode })}</span>}
            </div>
          )}
        </MorphContent>
        {!d ? (
          <div className="st-stack">
            <Skeleton h={40} />
            <Skeleton h={120} radius="var(--r-card)" />
          </div>
        ) : (
          <>
            <MorphContent index={1}>
              <VariantPicker ref={picker} options={options} selection={selection} state={state!} onPick={pick} nudge={nudge} />
              {p?.sizeGuide && l(p.sizeGuide) ? (
                <button type="button" className="st-sec-more" onClick={() => setGuide(true)}>
                  <Icon name="tag" size={16} /> {t('store.sizeGuide')}
                </button>
              ) : null}
            </MorphContent>
            <MorphContent index={2} className="st-pdp-stock">
              {variant && !state!.purchasable && <span className="st-stock is-out">{t('store.outOfStock')}</span>}
              {state!.lowStock && <span className="st-stock is-low">{t('store.onlyLeft', { n: state!.available! })}</span>}
              {variant && state!.purchasable && !state!.lowStock && <span className="st-stock is-ok"><Icon name="check" size={16} /> {t('store.inStock')}</span>}
              {inCart > 0 && (
                <button type="button" className="st-incart" onClick={() => navigate(`/s/${slug}/cart`)}>
                  <Icon name="cart" size={16} /> {t('store.inCart', { n: inCart })} · {t('store.goToCart')}
                </button>
              )}
            </MorphContent>
            <MorphContent index={3}>
              <Button variant="secondary" block size="lg" onClick={() => add(true)} disabled={!!variant && !state!.purchasable} loading={adding}>
                {t('store.buyNow')}
              </Button>
            </MorphContent>
            <MorphContent index={4}>
              <DeliveryCard options={d.shipping as ShippingOpt[]} isDigital={!!p?.isDigital} />
            </MorphContent>
            {p && !isEmptyDoc(description) && (
              <MorphContent index={5} className="st-sec">
                <h2 className="st-sec-title">{t('store.description')}</h2>
                <RichText source={description!} />
              </MorphContent>
            )}
            {p && (p.attributes?.length > 0 || p.brand) && (
              <MorphContent index={6} className="st-sec">
                <h2 className="st-sec-title">{t('store.characteristics')}</h2>
                <Specs rows={p.attributes ?? []} extra={[['Brand', p.brand]]} />
              </MorphContent>
            )}
            {p && (
              <Reviews slug={slug} productId={p.id} avg={p.ratingAvg} count={p.ratingCount} histogram={d.reviewHistogram} withPhotos={d.reviewsWithPhotos} />
            )}
            {p && <Questions slug={slug} productId={p.id} count={d.questionCount} />}
            {related.data && (
              <>
                <ProductRail slug={slug} title={t('store.boughtTogether')} items={related.data.boughtTogether} noMorph={NO_MORPH} />
                <ProductRail slug={slug} title={t('store.related')} items={related.data.related} noMorph={NO_MORPH} />
              </>
            )}
          </>
        )}
      </div>
      {p?.sizeGuide && (
        <Sheet open={guide} onClose={() => setGuide(false)} title={t('store.sizeGuide')}>
          <RichText source={l(p.sizeGuide)} />
        </Sheet>
      )}
    </DismissablePage>
  );
}
