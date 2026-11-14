/** Catalogue root (§6.2 #2): every root category as a large visual tile, then its sections as chips. */
import { useQuery } from '../../api';
import { useI18n } from '../../i18n';
import type { RouteProps } from '../../router/router';
import { navigate } from '../../router/router';
import { Reveal, staggerDelay } from '../../motion';
import { Button, EmptyState, Skeleton } from '../../ui';
import { StoreScreen, TopActions, TopBar } from '../components/Chrome';
import { CategoryTile } from '../home/Sections';
import { categoryUrl } from '../lib/data';
import '../styles/home.css';
import '../styles/listing.css';

export default function Catalog({ params }: RouteProps) {
  const slug = params.slug!;
  const { t, l } = useI18n();
  const tree = useQuery('store.categories', { slug }, { staleMs: 120_000 });
  return (
    <StoreScreen slug={slug} tab="catalog" top={<TopBar title={t('store.catalog')} actions={<TopActions slug={slug} />} />}>
      {tree.loading && !tree.data && (
        <div className="st-catlist">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={112} radius="var(--r-card)" />
          ))}
        </div>
      )}
      {tree.error && !tree.data && <EmptyState icon="refresh" title={t('common.errorGeneric')} action={<Button variant="secondary" onClick={tree.reload}>{t('common.retry')}</Button>} />}
      {tree.data && !tree.data.length && <EmptyState icon="grid" title={t('common.empty')} />}
      {tree.data?.map((root, i) => (
        <Reveal key={root.id} delay={staggerDelay(i)} className="st-stack">
          <CategoryTile slug={slug} c={root} path={[root.slug]} big />
          {root.children.length > 0 && (
            <div className="st-subcats">
              {root.children.map((c) => (
                <Button key={c.id} variant="secondary" size="sm" onClick={() => navigate(categoryUrl(slug, [root.slug, c.slug]))}>
                  {l(c.name)}
                </Button>
              ))}
            </div>
          )}
        </Reveal>
      ))}
    </StoreScreen>
  );
}
