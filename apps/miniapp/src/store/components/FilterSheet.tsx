/**
 * Filter sheet: price range, option facets (colour swatches, size chips) with counts, in stock, on sale, rating.
 * Edits a draft; the MainButton shows the live result count ("Show 128 products") for that draft.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '../../api';
import { useI18n } from '../../i18n';
import { Button, Chip, Input, Sheet } from '../../ui';
import { clearFilters, toggleOpt, toListing, type Filters } from '../lib/filters';
import type { Facets } from '../lib/types';
import type { ListingInput } from './ProductGrid';

interface Props {
  open: boolean;
  onClose: () => void;
  slug: string;
  base: Pick<ListingInput, 'categoryId' | 'collectionId' | 'q'>;
  value: Filters;
  onApply: (f: Filters) => void;
}

export function FilterSheet(props: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Filters>(props.value);
  const [seq, setSeq] = useState(0);
  const facets = useQuery('store.facets', props.open ? { slug: props.slug, ...props.base, ...toListing(draft) } : null, { staleMs: 60_000 });
  const last = useRef<number | undefined>(undefined);
  if (facets.data) last.current = facets.data.total;
  const total = facets.data?.total ?? last.current;
  useEffect(() => {
    if (props.open) {
      setDraft(props.value);
      setSeq((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={t('store.filters')}
      maxHeight={0.88}
      footer={
        <Button block size="lg" disabled={total === 0} loading={total == null} aria-busy={facets.loading || undefined} onClick={() => props.onApply(draft)}>
          {total == null ? t('common.loading') : t('store.showResults', { n: total })}
        </Button>
      }
    >
      {props.open && <FilterBody key={seq} {...props} draft={draft} setDraft={setDraft} facets={facets.data} />}
    </Sheet>
  );
}

function FilterBody({ value, draft, setDraft, facets: fd }: Props & { draft: Filters; setDraft: Dispatch<SetStateAction<Filters>>; facets: Facets | undefined }) {
  const { t, money } = useI18n();
  const [min, setMin] = useState(value.min?.toString() ?? '');
  const [max, setMax] = useState(value.max?.toString() ?? '');
  // debounce typed prices into the draft so the live count follows
  useEffect(() => {
    const id = setTimeout(() => {
      const p = (s: string) => (s.trim() === '' ? undefined : Math.max(0, Math.floor(Number(s.replace(/\D/g, '')) || 0)));
      setDraft((d) => ({ ...d, min: p(min), max: p(max) }));
    }, 300);
    return () => clearTimeout(id);
  }, [min, max, setDraft]);

  const facets = { data: fd };
  const range = fd?.price;

  const toggle = (k: 'stock' | 'sale') => setDraft((d) => ({ ...d, [k]: !d[k] || undefined }));

  return (
    <div className="st-filters">
      <section className="st-fsec">
        <h3>{t('store.filterPrice')}</h3>
        <div className="st-price-row">
          <Input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} leading={t('store.priceMin')} placeholder={range ? String(Math.floor(range.min / 100)) : ''} aria-label={t('store.priceMin')} />
          <Input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} leading={t('store.priceMax')} placeholder={range ? String(Math.ceil(range.max / 100)) : ''} aria-label={t('store.priceMax')} />
        </div>
        {range && range.max > range.min && <p className="st-fhint muted">{`${money(range.min)} — ${money(range.max)}`}</p>}
      </section>
      <section className="st-fsec">
        <div className="st-chips is-wrap">
          <Chip selected={!!draft.stock} onClick={() => toggle('stock')}>
            {t('store.filterInStock')} <span className="st-fcount">{facets.data?.inStock ?? ''}</span>
          </Chip>
          <Chip selected={!!draft.sale} onClick={() => toggle('sale')}>
            {t('store.filterOnSale')} <span className="st-fcount">{facets.data?.onSale ?? ''}</span>
          </Chip>
        </div>
      </section>
      {(facets.data?.options ?? []).map((o) => (
        <section key={o.name} className="st-fsec">
          <h3>{o.name}</h3>
          <div className="st-chips is-wrap">
            {o.values.map((v) => {
              const on = !!draft.opts[o.name]?.includes(v.label);
              return (
                <Chip key={v.label} swatch={o.display === 'swatch' ? v.swatch : null} selected={on} unavailable={!on && v.count === 0} onClick={() => setDraft((d) => toggleOpt(d, o.name, v.label))}>
                  {v.label} <span className="st-fcount">{v.count}</span>
                </Chip>
              );
            })}
          </div>
        </section>
      ))}
      <section className="st-fsec">
        <h3>{t('store.sortRating')}</h3>
        <div className="st-chips is-wrap">
          {(facets.data?.ratings ?? []).map((r) => (
            <Chip key={r.r} selected={draft.rating === r.r} onClick={() => setDraft((d) => ({ ...d, rating: d.rating === r.r ? undefined : r.r }))}>
              {t('store.ratingAtLeast', { n: r.r })} <span className="st-fcount">{r.n}</span>
            </Chip>
          ))}
        </div>
      </section>
      <div className="st-fsec">
        <Button
          variant="ghost"
          block
          onClick={() => {
            setMin('');
            setMax('');
            setDraft(clearFilters(draft));
          }}
        >
          {t('store.filterReset')}
        </Button>
      </div>
    </div>
  );
}
