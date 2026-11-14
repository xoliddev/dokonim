/** Store home (§6.2 #1): brand header + stories + the theme's sections, then an endless "popular" feed. */
import { useMemo } from 'react';
import type { L10n } from '@dokonim/core';
import { useQuery } from '../../api';
import { useI18n } from '../lib/i18n';
import type { RouteProps } from '../../router/router';
import { navigate } from '../../router/router';
import { useCurrentStore } from '../../shell/session';
import { Button, EmptyState, Skeleton } from '../../ui';
import { StoreScreen } from '../components/Chrome';
import { GridSkeleton, ProductGrid } from '../components/ProductGrid';
import { Hero, SearchRow, TrustRow } from '../home/Hero';
import { CategoryRail, CollectionsBento, Contacts, Faq, FlashSale, ProductGridSection, ProductRail, TextBlock, Testimonials } from '../home/Sections';
import { StoriesRow } from '../home/Stories';
import { useLinkOpener } from '../lib/links';
import type { CollectionTile, ProductCardData, Story, Testimonial } from '../lib/types';
import '../styles/home.css';

/** Collection rails can repeat any product, so they never carry the morph name. */
const NO_MORPH = { has: () => true } as unknown as Set<string>;

function CollectionRail({ slug, c, noMorph }: { slug: string; c: CollectionTile; noMorph: Set<string> }) {
  const { l } = useI18n();
  const q = useQuery('store.products', { slug, collectionId: c.id, limit: 10, sort: 'popular' }, { staleMs: 120_000 });
  return <ProductRail slug={slug} title={l(c.title)} items={q.data?.items ?? []} noMorph={noMorph} onMore={() => navigate(`/s/${slug}/collection/${c.slug}`)} />;
}

export default function Home({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, l } = useI18n();
  const store = useCurrentStore();
  const home = useQuery('store.home', { slug }, { staleMs: 60_000 });
  const openLink = useLinkOpener(slug, (home.data?.collections ?? []) as unknown as CollectionTile[]);

  // Each product id may carry the Continuity morph name only once per screen (first section wins).
  const claims = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Map<string, Set<string>>();
    const claim = (key: string, items: ProductCardData[]) => {
      const s = new Set<string>();
      for (const p of items) (seen.has(p.id) ? s.add(p.id) : seen.add(p.id));
      dup.set(key, s);
    };
    if (home.data) {
      home.data.flashSales.forEach((f, i) => claim(`flash${i}`, f.products));
      claim('new', home.data.newest);
      claim('best', home.data.bestsellers);
      claim('top', home.data.topRated);
    }
    return { get: (k: string) => dup.get(k) ?? new Set<string>(), all: seen };
  }, [home.data]);

  if (store.error && !store.data)
    return (
      <div className="screen-pad">
        <EmptyState icon="store" title={store.error.code === 'NOT_FOUND' ? t('common.errorNotFound') : t('store.storeClosed')} action={<Button onClick={() => navigate('/')}>{t('common.pickStore')}</Button>} />
      </div>
    );
  if (!store.data)
    return (
      <div className="screen-pad st-stack">
        <Skeleton h={44} radius={14} />
        <Skeleton h={200} radius="var(--r-card)" />
        <GridSkeleton />
      </div>
    );

  const info = store.data;
  const sections = (info.theme.sections ?? []).filter((s) => !s.hidden);
  const d = home.data;
  const heroCovers = (d?.bestsellers ?? []).map((p) => p.coverUrl).filter(Boolean) as string[];
  const title = (s: { settings: Record<string, unknown> }, fallback: string) => l(s.settings.title as L10n) || fallback;
  const collections = (d?.collections ?? []) as unknown as CollectionTile[];
  const allMorph = claims.all;

  const render = (s: (typeof sections)[number]) => {
    switch (s.type) {
      case 'hero':
        return <Hero key={s.id} slug={slug} store={info.store} settings={s.settings} covers={heroCovers} />;
      case 'stories':
        return d ? <StoriesRow key={s.id} slug={slug} stories={d.stories as unknown as Story[]} onLink={openLink} /> : null;
      case 'category_rail':
      case 'category_grid':
        return <CategoryRail key={s.id} slug={slug} nav={info.nav} title={title(s, t('store.categories'))} />;
      case 'flash_sale':
        return d?.flashSales.map((f, i) => <FlashSale key={`${s.id}-${f.id}`} slug={slug} sale={f} noMorph={claims.get(`flash${i}`)} />);
      case 'product_carousel': {
        if (!d) return <GridSkeleton key={s.id} n={2} />;
        const src = s.settings.source as string;
        const [items, key, sort] = src === 'bestsellers' ? [d.bestsellers, 'best', 'popular'] : src === 'top_rated' ? [d.topRated, 'top', 'rating'] : [d.newest, 'new', 'new'];
        const fallback = key === 'best' ? t('store.bestsellers') : key === 'top' ? t('store.topRated') : t('store.newArrivals');
        return <ProductGridSection key={s.id} slug={slug} title={title(s, fallback)} items={items} max={key === 'best' ? 6 : 4} noMorph={claims.get(key)} onMore={() => navigate(`/s/${slug}/search?sort=${sort}`)} />;
      }
      case 'bento':
      case 'collection_grid':
        return (
          <div key={s.id} className="st-stack" style={{ gap: 22 }}>
            <CollectionsBento slug={slug} collections={collections} title={title(s, t('store.collections'))} />
            {collections.slice(0, 2).map((c) => (
              <CollectionRail key={c.id} slug={slug} c={c} noMorph={NO_MORPH} />
            ))}
          </div>
        );
      case 'testimonials':
        return <Testimonials key={s.id} items={(d?.testimonials ?? []) as unknown as Testimonial[]} title={title(s, t('store.buyersSay'))} />;
      case 'faq':
        return <Faq key={s.id} title={title(s, t('store.faq'))} blocks={s.blocks} />;
      case 'contacts_map':
        return <Contacts key={s.id} settings={info.store.settings as Record<string, unknown>} />;
      case 'text':
      case 'image_text':
      case 'banner':
        return <TextBlock key={s.id} settings={s.settings} />;
      default:
        return null;
    }
  };

  const hasHero = sections.some((s) => s.type === 'hero');
  return (
    <StoreScreen slug={slug} tab="home" top={<SearchRow slug={slug} store={info.store} />}>
      {!hasHero && <Hero slug={slug} store={info.store} settings={{}} covers={heroCovers} />}
      {sections.map((s, i) => (
        <div key={s.id} className="st-home-sec" style={{ display: 'contents' }}>
          {render(s)}
          {s.type === 'hero' && i === 0 && <TrustRow />}
        </div>
      ))}
      {home.error && !d && (
        <div className="st-error">
          <p className="muted">{t('common.errorGeneric')}</p>
          <Button variant="secondary" onClick={home.reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      <section className="st-sec">
        <h2 className="st-sec-title">{t('store.sortPopular')}</h2>
        <ProductGrid slug={slug} input={{ slug, sort: 'popular' }} noMorph={allMorph} />
      </section>
    </StoreScreen>
  );
}
