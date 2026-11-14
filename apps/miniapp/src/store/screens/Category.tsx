/**
 * Category drill-down (§6.2 #2–3) through any depth: scrollable breadcrumbs, "All" + child chips (the next
 * level slides in on the shared X axis via the router), and the whole subtree's products below.
 */
import { useQuery } from '../../api';
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { Link, navigate } from '../../router/router';
import { Button, Chip, EmptyState, Icon, Skeleton } from '../../ui';
import { StoreScreen, TopActions, TopBar } from '../components/Chrome';
import { Listing } from '../components/Listing';
import { GridSkeleton } from '../components/ProductGrid';
import { categoryUrl } from '../lib/data';
import '../styles/listing.css';

export default function Category({ params, query }: RouteProps) {
  const slug = params.slug!;
  const parts = (params['*'] ?? '').split('/').filter(Boolean);
  const { t, l } = useI18n();
  const q = useQuery('store.categoryByPath', parts.length ? { slug, path: parts } : null, { staleMs: 120_000 });
  const cat = q.data?.category;
  const crumbs = q.data?.breadcrumbs ?? [];
  const parent = parts.slice(0, -1);
  // a leaf shows its siblings instead, so the buyer can hop sideways without going back
  const leaf = !!cat && cat.children.length === 0 && parent.length > 0;
  const up = useQuery('store.categoryByPath', leaf ? { slug, path: parent } : null, { staleMs: 120_000 });
  const siblings = leaf ? (up.data?.category?.children ?? []) : [];

  return (
    <StoreScreen slug={slug} tab="catalog" top={<TopBar title={cat ? l(cat.name) : ' '} actions={<TopActions slug={slug} cart />} />}>
      {q.loading && !q.data ? (
        <>
          <Skeleton w="70%" h={16} />
          <GridSkeleton />
        </>
      ) : q.error || !cat ? (
        <EmptyState icon="grid" title={t('common.errorNotFound')} action={<Button variant="secondary" onClick={() => navigate(`/s/${slug}/catalog`)}>{t('store.allCategories')}</Button>} />
      ) : (
        <Listing
          key={cat.id}
          slug={slug}
          base={{ categoryId: cat.id }}
          query={query}
          path={categoryUrl(slug, parts)}
          head={
            <div className="st-cat-head">
              <nav className="st-crumbs" aria-label="breadcrumbs">
                <Link to={`/s/${slug}/catalog`}>{t('store.catalog')}</Link>
                {crumbs.map((c, i) => (
                  <span key={c.id} className="st-row" style={{ gap: 4 }}>
                    <Icon name="chevron-right" size={14} />
                    <Link to={categoryUrl(slug, parts.slice(0, i + 1))} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                      {l(c.name)}
                    </Link>
                  </span>
                ))}
              </nav>
              {cat.children.length > 0 && (
                <div className="st-subcats" role="list" aria-label={t('store.subcategories')}>
                  <Chip selected role="listitem">
                    {t('store.allInCategory')} <span className="st-chip-count">{cat.subtreeCount}</span>
                  </Chip>
                  {cat.children.map((c) => (
                    <Chip key={c.id} role="listitem" onClick={() => navigate(categoryUrl(slug, [...parts, c.slug]))}>
                      {l(c.name)} <span className="st-chip-count">{c.subtreeCount}</span>
                      {c.childCount > 0 && <Icon name="chevron-right" size={14} />}
                    </Chip>
                  ))}
                </div>
              )}
              {siblings.length > 1 && (
                <div className="st-subcats" role="list" aria-label={t('store.subcategories')}>
                  {siblings.map((c) => (
                    <Chip key={c.id} role="listitem" selected={c.id === cat.id} onClick={() => c.id !== cat.id && navigate(categoryUrl(slug, [...parent, c.slug]), { replace: true })}>
                      {l(c.name)} <span className="st-chip-count">{c.subtreeCount}</span>
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          }
        />
      )}
    </StoreScreen>
  );
}
