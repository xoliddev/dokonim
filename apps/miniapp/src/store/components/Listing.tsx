/**
 * Listing (§6.2 #3): sticky filter bar (Sort · Filters (n) · quick chips), result count, infinite grid, and
 * the sort / filter sheets. Filters live in the URL query, so back navigation and shared links restore them.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '../../api';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { navigate } from '../../router/router';
import { haptic } from '../../telegram/shim';
import { Chip, EmptyState, Button, Icon, Sheet } from '../../ui';
import { activeCount, clearFilters, filtersToQuery, parseFilters, SORTS, toggleOpt, toListing, type Filters, type SortKey } from '../lib/filters';
import { FilterSheet } from './FilterSheet';
import { ProductGrid, type ListingInput } from './ProductGrid';
import '../styles/listing.css';

export const sortLabel = (t: (k: MessageKey) => string, s: SortKey) =>
  t(({ popular: 'store.sortPopular', new: 'store.sortNew', price_asc: 'store.sortPriceAsc', price_desc: 'store.sortPriceDesc', rating: 'store.sortRating', discount: 'store.sortDiscount', relevance: 'store.sortRelevance' } as const)[s]);

export interface ListingProps {
  slug: string;
  /** Scope: categoryId / collectionId / q. */
  base: Pick<ListingInput, 'categoryId' | 'collectionId' | 'q'>;
  query: URLSearchParams;
  /** Route path (without query) to write filters back to. */
  path: string;
  head?: ReactNode;
  empty?: ReactNode;
}

export function Listing({ slug, base, query, path, head, empty }: ListingProps) {
  const { t } = useI18n();
  const f = parseFilters(query);
  const defaultSort: SortKey = base.q ? 'relevance' : 'popular';
  const sort = f.sort ?? defaultSort;
  const [sheet, setSheet] = useState<'sort' | 'filter' | null>(null);
  const scoped = { slug, ...base, ...toListing(f) };
  const facets = useQuery('store.facets', { ...scoped, sort: undefined }, { staleMs: 60_000 });
  const n = activeCount(f);

  const apply = (nf: Filters) => {
    const q = filtersToQuery(nf, query).toString();
    navigate(`${path}${q ? `?${q}` : ''}`, { replace: true });
  };

  // quick chips: in stock, on sale, and the most common values of the first option facet
  const firstOpt = facets.data?.options[0];
  const quick = firstOpt ? firstOpt.values.slice(0, 5) : [];
  const sorts: SortKey[] = base.q ? ['relevance', ...SORTS] : SORTS;
  const total = facets.data?.total;

  return (
    <>
      <div className="st-fbar" role="toolbar">
        <Chip onClick={() => setSheet('sort')} icon={<Icon name="chevron-down" size={16} />} className="st-fbar-sort">
          {sortLabel(t, sort)}
        </Chip>
        <Chip selected={n > 0} onClick={() => setSheet('filter')} icon={<Icon name="filter" size={16} />}>
          {t('store.filters')}
          {n > 0 && <span className="st-fbar-n">{n}</span>}
        </Chip>
        <Chip selected={!!f.sale} onClick={() => apply({ ...f, sale: !f.sale || undefined })}>
          {t('store.onSale')}
        </Chip>
        <Chip selected={!!f.stock} onClick={() => apply({ ...f, stock: !f.stock || undefined })}>
          {t('store.inStock')}
        </Chip>
        {firstOpt &&
          quick.map((v) => (
            <Chip key={v.label} swatch={v.swatch} selected={!!f.opts[firstOpt.name]?.includes(v.label)} onClick={() => apply(toggleOpt(f, firstOpt.name, v.label))}>
              {v.label}
            </Chip>
          ))}
      </div>
      {head}
      <div className="st-count-line" aria-live="polite">
        {total != null ? t('common.products', { n: total }) : ' '}
        {n > 0 && (
          <button type="button" className="st-sec-more" onClick={() => apply(clearFilters(f))}>
            {t('store.filterReset')}
          </button>
        )}
      </div>
      <ProductGrid
        slug={slug}
        input={{ ...scoped, sort } as ListingInput}
        empty={
          empty ?? (
            <EmptyState
              icon="search"
              title={base.q ? t('store.searchEmpty', { q: base.q }) : t('common.empty')}
              hint={t('store.searchTryOther')}
              action={n > 0 ? <Button variant="secondary" onClick={() => apply(clearFilters(f))}>{t('store.filterReset')}</Button> : undefined}
            />
          )
        }
      />
      <Sheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={t('common.sort')}>
        <div className="st-sortlist" role="radiogroup">
          {sorts.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === sort}
              className={`st-sortopt${s === sort ? ' is-on' : ''}`}
              onClick={() => {
                haptic.selection();
                apply({ ...f, sort: s === defaultSort ? undefined : s });
                setSheet(null);
              }}
            >
              {sortLabel(t, s)}
              {s === sort && <Icon name="check" size={20} />}
            </button>
          ))}
        </div>
      </Sheet>
      <FilterSheet
        open={sheet === 'filter'}
        onClose={() => setSheet(null)}
        slug={slug}
        base={base}
        value={f}
        onApply={(nf) => {
          apply(nf);
          setSheet(null);
        }}
      />
    </>
  );
}
