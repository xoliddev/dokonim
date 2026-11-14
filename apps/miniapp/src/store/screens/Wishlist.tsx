/** Favourites: saved products as a grid, with the price drop since saving called out. */
import { useI18n } from '../lib/i18n';
import { Reveal, staggerDelay } from '../../motion';
import { navigate, type RouteProps } from '../../router/router';
import { Button, EmptyState } from '../../ui';
import { StoreScreen, TopActions, TopBar } from '../components/Chrome';
import { GridSkeleton } from '../components/ProductGrid';
import { ProductCard } from '../components/ProductCard';
import { useWishlist } from '../lib/data';

export default function Wishlist({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, money } = useI18n();
  const { list, has } = useWishlist(slug);
  const items = (list.data ?? []).filter((p) => has(p.id));
  return (
    <StoreScreen slug={slug} tab="profile" top={<TopBar title={t('store.wishlist')} sub={items.length ? t('common.products', { n: items.length }) : undefined} actions={<TopActions slug={slug} cart />} />}>
      {list.loading && !list.data ? (
        <GridSkeleton />
      ) : !items.length ? (
        <EmptyState icon="heart" title={t('store.wishlistEmpty')} hint={t('store.cartEmptyHint')} action={<Button onClick={() => navigate(`/s/${slug}`)}>{t('store.startShopping')}</Button>} />
      ) : (
        <div className="st-grid">
          {items.map((p, i) => (
            <Reveal key={p.id} delay={staggerDelay(i)} className="st-stack" >
              <ProductCard slug={slug} p={p} />
              {p.priceAtSave > p.price && <span className="st-badge is-soft" style={{ justifySelf: 'start' }}>{t('store.youSave', { amount: money(p.priceAtSave - p.price) })}</span>}
            </Reveal>
          ))}
        </div>
      )}
    </StoreScreen>
  );
}
