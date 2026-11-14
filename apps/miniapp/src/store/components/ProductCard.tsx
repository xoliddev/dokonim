/**
 * Product card (grid + rails): Continuity image, −% badge, honest flash countdown, wishlist heart, quick-add
 * with The Arc, price/compare-at, installment hint, rating and real stock. Card style follows the theme's
 * `cardStyle` (gallery | catalog | editorial | ticket) via [data-card] on the store root.
 */
import { memo, useRef, useState } from 'react';
import { ApiError } from '../../api';
import { useI18n } from '../lib/i18n';
import { flyToCart, shake } from '../../motion';
import { announce, Icon, toast } from '../../ui';
import { qtyInCart, useCart, useCartActions, useWishlist } from '../lib/data';
import { openProduct } from '../lib/open';
import type { ProductCardData } from '../lib/types';
import { Countdown } from './Countdown';
import { CardImage } from './CardImage';
import { Stars } from './Stars';

export interface ProductCardProps {
  slug: string;
  p: ProductCardData;
  /** Only one card per product id on a screen may carry the morph name. */
  morph?: boolean;
  priority?: boolean;
}

export const ProductCard = memo(function ProductCard({ slug, p, morph = true, priority }: ProductCardProps) {
  const { t, l, money, number } = useI18n();
  const wish = useWishlist(slug);
  const cart = useCart(slug);
  const { setQty } = useCartActions(slug);
  const media = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const saved = wish.has(p.id);
  const title = l(p.title);
  const low = p.available != null && p.available > 0 && p.available <= 5;

  const open = () => openProduct(slug, p, media.current?.querySelector('img') ?? null);

  const quickAdd = async () => {
    if (!p.quickAddVariantId) return open();
    if (!p.inStock) return shake(addBtn.current);
    setAdding(true);
    const fly = flyToCart({ from: media.current ?? addBtn.current!, imageUrl: p.coverUrl ?? undefined });
    try {
      await setQty(p.quickAddVariantId, qtyInCart(cart.data, p.quickAddVariantId) + 1);
      await fly;
      announce(t('store.addedToCart', { title }));
    } catch (e) {
      shake(addBtn.current);
      toast.error(e instanceof ApiError && e.code === 'OUT_OF_STOCK' ? t('store.maxReached') : t('common.errorGeneric'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <article className={`st-pcard${p.inStock ? '' : ' is-oos'}`}>
      <div className="st-pcard-media" ref={media}>
        <button type="button" className="st-pcard-hit" onClick={open} aria-label={title}>
          <CardImage id={p.id} src={p.coverUrl} alt={title} morph={morph} priority={priority} tint={p.dominantColor} />
        </button>
        <div className="st-pcard-badges">
          {p.discountPercent > 0 && <span className="st-badge is-sale">{t('store.discountBadge', { percent: p.discountPercent })}</span>}
          {p.flashEndsAt && <Countdown endsAt={p.flashEndsAt} compact />}
        </div>
        <button
          type="button"
          className={`st-heart${saved ? ' is-on' : ''}`}
          aria-pressed={saved}
          aria-label={saved ? t('store.removeFromWishlist') : t('store.addToWishlist')}
          onClick={() => wish.toggle(p.id, saved).catch(() => toast.error(t('common.errorGeneric')))}
        >
          <Icon name="heart" filled={saved} size={20} />
        </button>
        {!p.inStock && <span className="st-pcard-oos">{t('store.outOfStock')}</span>}
        {p.inStock && (
          <button ref={addBtn} type="button" className="st-quick" aria-label={t('store.addToCart')} onClick={quickAdd} disabled={adding}>
            <Icon name={adding ? 'check' : 'plus'} size={20} />
          </button>
        )}
      </div>
      <button type="button" className="st-pcard-info" onClick={open}>
        <span className="st-pcard-price">
          {p.maxPrice > p.price && <span className="st-pcard-from">{t('store.priceMin')}</span>}
          <span className={`price${p.compareAt ? ' is-sale' : ''}`}>{money(p.price)}</span>
          {p.compareAt && <span className="price-old">{money(p.compareAt)}</span>}
        </span>
        {p.monthly && <span className="st-pcard-monthly">{t('store.perMonth', { amount: money(p.monthly) })}</span>}
        <span className="st-pcard-title">{title}</span>
        <span className="st-pcard-meta">
          {p.ratingCount > 0 && (
            <span className="st-rating">
              <Stars value={p.ratingAvg} size={12} single />
              <b>{p.ratingAvg.toFixed(1)}</b> ({number(p.ratingCount)})
            </span>
          )}
          {low && <span className="st-pcard-low">{t('store.onlyLeft', { n: p.available! })}</span>}
        </span>
      </button>
    </article>
  );
});
