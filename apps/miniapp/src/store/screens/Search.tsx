/**
 * Search (§6.2 #4): results update as you type (debounced, typo-tolerant on the server), category
 * suggestions, recent searches per device, and the full listing with filters and sort for the results.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '../../api';
import { useI18n } from '../lib/i18n';
import type { RouteProps } from '../../router/router';
import { navigate } from '../../router/router';
import { useCurrentStore } from '../../shell/session';
import { Chip, Icon, Input } from '../../ui';
import { StoreScreen } from '../components/Chrome';
import { Listing } from '../components/Listing';
import { ProductGrid } from '../components/ProductGrid';
import { SecHead } from '../home/Sections';
import { categoryUrl, useRecentSearches } from '../lib/data';
import { filtersToQuery, parseFilters } from '../lib/filters';
import '../styles/listing.css';

export function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="st-hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function Search({ params, query }: RouteProps) {
  const slug = params.slug!;
  const { t, l } = useI18n();
  const store = useCurrentStore();
  const recent = useRecentSearches(slug);
  const committed = query.get('q') ?? '';
  const [text, setText] = useState(committed);
  const input = useRef<HTMLInputElement>(null);
  const path = `/s/${slug}/search`;

  const commit = (q: string, opts: { keepFilters?: boolean } = {}) => {
    const next = filtersToQuery(opts.keepFilters ? parseFilters(query) : { opts: {} }, new URLSearchParams());
    if (q.trim()) next.set('q', q.trim());
    else next.delete('q');
    const s = next.toString();
    navigate(`${path}${s ? `?${s}` : ''}`, { replace: true });
  };

  // instant results: commit the typed text after a short pause
  useEffect(() => {
    if (text.trim() === committed.trim()) return;
    const id = setTimeout(() => commit(text, { keepFilters: true }), 260);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => {
    if (!committed) input.current?.focus({ preventScroll: true });
  }, [committed]);

  const term = committed.trim();
  const suggest = useQuery('store.suggest', term.length >= 2 ? { slug, q: term } : null, { staleMs: 60_000 });
  const cats = suggest.data?.categories ?? [];
  const sortOnly = !term && query.get('sort');

  return (
    <StoreScreen
      slug={slug}
      tab={null}
      top={
        <form
          className="st-searchbar"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            recent.push(text);
            commit(text, { keepFilters: true });
            input.current?.blur();
          }}
        >
          <Input
            ref={input as never}
            type="search"
            enterKeyHint="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={store.data ? t('store.searchIn', { store: l(store.data.store.name) }) : t('store.searchPlaceholder')}
            aria-label={t('common.search')}
            prefix={(<Icon name="search" size={20} />) as unknown as string}
            suffix={
              text ? (
                <button type="button" className="st-search-clear" aria-label={t('common.reset')} onClick={() => (setText(''), commit(''), input.current?.focus())}>
                  <Icon name="close" size={18} />
                </button>
              ) : undefined
            }
          />
        </form>
      }
    >
      {term || sortOnly ? (
        <div className="st-stack" style={{ gap: 18, ['--st-top-h' as string]: '65px' }} onClickCapture={() => term && recent.push(term)}>
          <Listing
            slug={slug}
            base={{ q: term || null }}
            query={query}
            path={path}
            head={
              cats.length > 0 ? (
                <div className="st-subcats">
                  {cats.map((c) => (
                    <Chip key={c.id} icon={<Icon name="grid" size={15} />} onClick={() => navigate(categoryUrl(slug, c.path))}>
                      <Highlight text={l(c.name)} q={term} />
                    </Chip>
                  ))}
                </div>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {recent.items.length > 0 && (
            <section className="st-sec">
              <SecHead title={t('store.recentSearches')} onMore={recent.clear} moreLabel={t('store.clearHistory')} />
              <div className="st-recent">
                {recent.items.map((r) => (
                  <Chip key={r} icon={<Icon name="refresh" size={14} />} onClick={() => (setText(r), commit(r))}>
                    {r}
                  </Chip>
                ))}
              </div>
            </section>
          )}
          {store.data && store.data.nav.length > 0 && (
            <section className="st-sec">
              <SecHead title={t('store.categories')} />
              <div className="st-recent">
                {store.data.nav.map((c) => (
                  <Chip key={c.id} onClick={() => navigate(categoryUrl(slug, [c.slug]))}>
                    {l(c.name)}
                  </Chip>
                ))}
              </div>
            </section>
          )}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t('store.searchHint')}
          </p>
          <section className="st-sec">
            <SecHead title={t('store.bestsellers')} />
            <ProductGrid slug={slug} input={{ slug, sort: 'popular' }} />
          </section>
        </>
      )}
    </StoreScreen>
  );
}
