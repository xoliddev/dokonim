/**
 * Infinite product grid: the first page is a cached `useQuery` (instant on back navigation), further pages
 * load imperatively when a sentinel 700px below the fold enters the scroll container.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi, useQuery, type ApiIn } from '../../api';
import { useI18n } from '../../i18n';
import { Reveal, staggerDelay } from '../../motion';
import { Button, EmptyState, Loading, SkeletonCard } from '../../ui';
import type { ProductCardData } from '../lib/types';
import { ProductCard } from './ProductCard';

export type ListingInput = ApiIn<'store.products'>;
const PAGE = 20;

export function useInfiniteProducts(input: ListingInput | null) {
  const { api } = useApi();
  const first = useQuery('store.products', input ? { ...input, limit: PAGE } : null, { staleMs: 60_000 });
  const key = JSON.stringify(input);
  const [more, setMore] = useState<{ key: string; items: ProductCardData[]; cursor: string | null; loading: boolean; error: boolean }>({ key, items: [], cursor: null, loading: false, error: false });
  const state = more.key === key ? more : { key, items: [], cursor: null, loading: false, error: false };
  const cursor = state.items.length ? state.cursor : (first.data?.nextCursor ?? null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (!input || !cursor || busy.current) return;
    busy.current = true;
    setMore((s) => ({ ...(s.key === key ? s : { key, items: [], cursor: null, error: false }), loading: true, error: false }));
    try {
      const page = await api['store.products']({ ...input, limit: PAGE, cursor });
      setMore((s) => (s.key === key ? { ...s, items: [...s.items, ...page.items], cursor: page.nextCursor, loading: false } : s));
    } catch {
      setMore((s) => (s.key === key ? { ...s, loading: false, error: true } : s));
    } finally {
      busy.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, cursor]);

  const seen = new Set<string>();
  const items = [...(first.data?.items ?? []), ...state.items].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return { items, total: first.data?.total ?? 0, loading: first.loading && !first.data, error: first.error && !first.data, reload: first.reload, hasMore: !!cursor, loadMore, loadingMore: state.loading, moreError: state.error };
}

function useSentinel(onHit: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onHit);
  cb.current = onHit;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return;
    const root = el.closest('.screen-scroll');
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), { root, rootMargin: '0px 0px 700px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

export function GridSkeleton({ n = 4 }: { n?: number }) {
  const { t } = useI18n();
  return (
    <Loading label={t('common.loading')}>
      <div className="st-grid">
        {Array.from({ length: n }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </Loading>
  );
}

export function ProductGrid({ slug, input, empty, noMorph }: { slug: string; input: ListingInput | null; empty?: ReactNode; noMorph?: Set<string> }) {
  const { t } = useI18n();
  const q = useInfiniteProducts(input);
  const sentinel = useSentinel(q.loadMore, q.hasMore && !q.moreError);
  if (q.loading) return <GridSkeleton n={6} />;
  if (q.error)
    return (
      <div className="st-error">
        <EmptyState icon="refresh" title={t('common.errorGeneric')} action={<Button variant="secondary" onClick={q.reload}>{t('common.retry')}</Button>} />
      </div>
    );
  if (!q.items.length) return <>{empty ?? <EmptyState icon="search" title={t('common.empty')} />}</>;
  return (
    <>
      <div className="st-grid">
        {q.items.map((p, i) => (
          <Reveal key={p.id} delay={i < PAGE ? staggerDelay(i % PAGE) : 0}>
            <ProductCard slug={slug} p={p} priority={i < 4} morph={!noMorph?.has(p.id)} />
          </Reveal>
        ))}
      </div>
      {q.loadingMore && <GridSkeleton n={2} />}
      {q.moreError && (
        <div className="st-end">
          <Button variant="secondary" size="sm" onClick={q.loadMore}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!q.hasMore && q.items.length > 6 && (
        <div className="st-end">
          <div className="ikat-band" aria-hidden="true" />
          {t('store.listEnd')}
        </div>
      )}
      <div ref={sentinel} className="st-sentinel" aria-hidden="true" />
    </>
  );
}
