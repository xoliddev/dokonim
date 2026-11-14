/** Home sections rendered from the published theme (§12.2): categories, collections, deals, grids, social proof. */
import type { ReactNode } from 'react';
import type { L10n } from '@dokonim/core';
import { useQuery } from '../../api';
import { useI18n } from '../lib/i18n';
import { Reveal, staggerDelay } from '../../motion';
import { navigate } from '../../router/router';
import { Icon, Skeleton } from '../../ui';
import { Countdown } from '../components/Countdown';
import { ProductCard } from '../components/ProductCard';
import { Stars } from '../components/Stars';
import { categoryUrl } from '../lib/data';
import type { CollectionTile, HomeData, NavCategory, ProductCardData, Testimonial } from '../lib/types';

export function SecHead({ title, onMore, moreLabel }: { title: string; onMore?: () => void; moreLabel?: string }) {
  const { t } = useI18n();
  return (
    <div className="st-sec-head">
      <h2 className="st-sec-title">{title}</h2>
      {onMore && (
        <button type="button" className="st-sec-more" onClick={onMore}>
          {moreLabel ?? t('common.showAll')}
          <Icon name="chevron-right" size={16} />
        </button>
      )}
    </div>
  );
}

/** A category tile: name, product count, and a fan of the subtree's top covers. */
export function CategoryTile({ slug, c, path, big }: { slug: string; c: Pick<NavCategory, 'id' | 'name' | 'subtreeCount'>; path: string[]; big?: boolean }) {
  const { l, t } = useI18n();
  const q = useQuery('store.products', { slug, categoryId: c.id, limit: 3, sort: 'popular' }, { staleMs: 120_000 });
  const covers = (q.data?.items ?? []).map((p) => p.coverUrl).filter(Boolean) as string[];
  return (
    <button type="button" className={`st-cat${big ? ' is-big' : ''}`} onClick={() => navigate(categoryUrl(slug, path))}>
      <span className="st-cat-text">
        <span className="st-cat-name">{l(c.name)}</span>
        <span className="st-cat-count">{t('common.products', { n: c.subtreeCount })}</span>
      </span>
      <span className="st-cat-fan" aria-hidden="true">
        {q.loading && !q.data ? <Skeleton h="100%" radius="var(--r-media)" /> : covers.map((src, i) => <img key={i} src={src} alt="" loading="lazy" className={`is-${i}`} />)}
      </span>
    </button>
  );
}

export function CategoryRail({ slug, nav, title }: { slug: string; nav: NavCategory[]; title: string }) {
  const { t } = useI18n();
  if (!nav.length) return null;
  return (
    <section className="st-sec">
      <SecHead title={title} onMore={() => navigate(`/s/${slug}/catalog`)} />
      <div className="st-catgrid">
        {nav.slice(0, 6).map((c, i) => (
          <Reveal key={c.id} delay={staggerDelay(i)}>
            <CategoryTile slug={slug} c={c} path={[c.slug]} big={i === 0 && nav.length % 2 === 1} />
          </Reveal>
        ))}
      </div>
      <span className="sr-only">{t('store.categories')}</span>
    </section>
  );
}

export function CollectionsBento({ slug, collections, title }: { slug: string; collections: CollectionTile[]; title: string }) {
  const { l, t } = useI18n();
  if (!collections.length) return null;
  return (
    <section className="st-sec">
      <SecHead title={title} />
      <div className="st-bento">
        {collections.slice(0, 5).map((c, i) => (
          <button key={c.id} type="button" className={`st-bento-tile is-${i}`} onClick={() => navigate(`/s/${slug}/collection/${c.slug}`)}>
            <span className="st-bento-covers" aria-hidden="true">
              {(c.covers ?? []).slice(0, 3).map((src, k) => (
                <img key={k} src={src} alt="" loading="lazy" />
              ))}
            </span>
            <span className="st-bento-text">
              <strong>{l(c.title)}</strong>
              <span>{t('common.products', { n: c.productCount })}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ProductRail({ slug, title, items, onMore, noMorph, head, className }: { slug: string; title: string; items: ProductCardData[]; onMore?: () => void; noMorph: Set<string>; head?: ReactNode; className?: string }) {
  if (!items.length) return null;
  return (
    <section className={`st-sec ${className ?? ''}`}>
      {head ?? <SecHead title={title} onMore={onMore} />}
      <div className="st-rail is-cards">
        {items.map((p) => (
          <ProductCard key={p.id} slug={slug} p={p} morph={!noMorph.has(p.id)} />
        ))}
      </div>
    </section>
  );
}

export function ProductGridSection({ slug, title, items, onMore, noMorph, max = 6 }: { slug: string; title: string; items: ProductCardData[]; onMore?: () => void; noMorph: Set<string>; max?: number }) {
  if (!items.length) return null;
  return (
    <section className="st-sec">
      <SecHead title={title} onMore={onMore} />
      <div className="st-grid">
        {items.slice(0, max).map((p, i) => (
          <Reveal key={p.id} delay={staggerDelay(i)}>
            <ProductCard slug={slug} p={p} morph={!noMorph.has(p.id)} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function FlashSale({ slug, sale, noMorph }: { slug: string; sale: HomeData['flashSales'][number]; noMorph: Set<string> }) {
  const { t } = useI18n();
  if (!sale.products.length || !sale.endsAt) return null;
  return (
    <ProductRail
      slug={slug}
      title={sale.title || t('store.flashSale')}
      items={sale.products}
      noMorph={noMorph}
      className="st-flash"
      head={
        <div className="st-sec-head st-flash-head">
          <h2 className="st-sec-title">
            <Icon name="sparkle" size={18} /> {sale.title || t('store.flashSale')}
          </h2>
          <Countdown endsAt={sale.endsAt} />
        </div>
      }
    />
  );
}

export function Testimonials({ items, title }: { items: Testimonial[]; title: string }) {
  const { l, relativeDay } = useI18n();
  if (!items.length) return null;
  return (
    <section className="st-sec">
      <SecHead title={title} />
      <div className="st-rail st-quotes">
        {items.map((r) => (
          <figure key={r.id} className="st-quote">
            <Stars value={r.rating} size={13} />
            <blockquote>{r.text}</blockquote>
            <figcaption>
              <b>{r.authorName}</b> · {relativeDay(r.createdAt)}
              <span className="muted">{l(r.productTitle)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export function Faq({ title, blocks }: { title: string; blocks: Array<{ id: string; settings: Record<string, unknown> }> }) {
  const { l } = useI18n();
  if (!blocks.length) return null;
  return (
    <section className="st-sec">
      <SecHead title={title} />
      <div className="st-card st-faq">
        {blocks.map((b) => (
          <details key={b.id}>
            <summary>
              {l(b.settings.q as L10n)}
              <Icon name="chevron-down" size={18} />
            </summary>
            <p>{l(b.settings.a as L10n)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Contacts({ settings }: { settings: Record<string, unknown> | null | undefined }) {
  const { t } = useI18n();
  const c = (settings?.contacts ?? {}) as { phone?: string; telegram?: string; address?: string };
  const hours = settings?.hours as string | undefined;
  if (!c.phone && !c.telegram && !c.address) return null;
  return (
    <section className="st-sec">
      <SecHead title={t('store.contacts')} />
      <dl className="st-card st-contacts">
        {c.address && (
          <div className="st-kv">
            <dt>{t('checkout.address')}</dt>
            <dd>{c.address}</dd>
          </div>
        )}
        {c.phone && (
          <div className="st-kv">
            <dt>{t('checkout.phone')}</dt>
            <dd>
              <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>
            </dd>
          </div>
        )}
        {c.telegram && (
          <div className="st-kv">
            <dt>Telegram</dt>
            <dd>{c.telegram}</dd>
          </div>
        )}
        {hours && (
          <div className="st-kv">
            <dt>{t('store.hours')}</dt>
            <dd>{hours}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function TextBlock({ settings }: { settings: Record<string, unknown> }) {
  const { l } = useI18n();
  const title = l(settings.title as L10n);
  const body = l((settings.body ?? settings.text) as L10n);
  if (!title && !body) return null;
  return (
    <section className="st-card st-textblock">
      {title && <h2 className="st-sec-title">{title}</h2>}
      {body && <p>{body}</p>}
    </section>
  );
}
