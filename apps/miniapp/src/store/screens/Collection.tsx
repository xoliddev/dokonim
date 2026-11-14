/** Collection listing: the collection's title and description, then its products with filters. */
import { useQuery } from '../../api';
import type { L10n } from '@dokonim/core';
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { EmptyState } from '../../ui';
import { StoreScreen, TopActions, TopBar } from '../components/Chrome';
import { Listing } from '../components/Listing';
import { GridSkeleton } from '../components/ProductGrid';

export default function Collection({ params, query }: RouteProps) {
  const slug = params.slug!;
  const cslug = params.collectionSlug!;
  const { t, l } = useI18n();
  const q = useQuery('store.collection', { slug, collectionSlug: cslug }, { staleMs: 120_000 });
  const c = q.data as { id: string; title: L10n; description: L10n } | undefined;
  return (
    <StoreScreen slug={slug} tab={null} top={<TopBar title={c ? l(c.title) : ' '} actions={<TopActions slug={slug} cart />} />}>
      {q.loading && !c ? (
        <GridSkeleton />
      ) : !c ? (
        <EmptyState icon="grid" title={t('common.errorNotFound')} />
      ) : (
        <Listing slug={slug} base={{ collectionId: c.id }} query={query} path={`/s/${slug}/collection/${cslug}`} head={l(c.description) ? <p className="muted" style={{ margin: 0 }}>{l(c.description)}</p> : undefined} />
      )}
    </StoreScreen>
  );
}
