/**
 * Products list: search, status segments (with live counts), category / low-stock filters, paging, and bulk mode
 * (publish, draft, archive, move category, adjust price %). Status changes are optimistic. Thumbnails morph into
 * the editor hero (Continuity).
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { morphNavigate, spring } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { navigate } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, Chip, toast } from '../../../ui';
import { CategoryPicker } from '../../components/CategoryPicker';
import { Segmented } from '../../components/Controls';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { findNode, type CatNode } from '../../lib/tree';
import { PercentSheet, ProductRow, type ListItem } from './ProductRow';
import './products.css';

type Status = 'all' | 'active' | 'draft' | 'archived';
type Bulk = 'activate' | 'draft' | 'archive' | 'move_category' | 'adjust_price';
const INV = ['admin.products', 'admin.dashboard', 'admin.inventory', 'admin.categories', 'store.'];

export default function Products({ query }: RouteProps) {
  const { t, l } = useI18n();
  const s = useSeller();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const low = query.get('filter') === 'low';
  const categoryId = query.get('category');
  const [pages, setPages] = useState<string[]>(['']);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [patched, setPatched] = useState<Record<string, ListItem['status']>>({});
  const [moving, setMoving] = useState(false);
  const [pricing, setPricing] = useState(false);
  const bulk = useMutation('admin.products.bulk', { invalidates: INV });

  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPages(['']), [dq, status, low, categoryId]);

  const base = s.storeId ? { storeId: s.storeId, q: dq || undefined, status: status === 'all' ? undefined : status, lowStock: low || undefined, categoryId: categoryId || undefined, limit: 30 } : null;
  const first = useQuery('admin.products.list', base ? { ...base } : null);
  const cats = useQuery('admin.categories.tree', s.storeId ? { storeId: s.storeId } : null);
  const nodes = (cats.data ?? []) as CatNode[];
  const catName = categoryId ? l(findNode(nodes, categoryId)?.name) : '';

  const items = useMemo(() => ((first.data?.items ?? []) as unknown as ListItem[]).map((p) => (patched[p.id] ? { ...p, status: patched[p.id]! } : p)), [first.data, patched]);
  useEffect(() => setPatched({}), [first.data]);
  const total = first.data?.total ?? 0;

  const toggle = (id: string) => {
    haptic.selection();
    setSel((x) => {
      const n = new Set(x);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const exitSelect = () => {
    setSelecting(false);
    setSel(new Set());
  };

  const runBulk = async (action: Bulk, params?: { categoryId?: string | null; percent?: number }) => {
    if (!s.storeId || sel.size === 0) return;
    const ids = [...sel];
    const st = action === 'activate' ? 'active' : action === 'draft' ? 'draft' : action === 'archive' ? 'archived' : null;
    if (st) setPatched((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, st])) }));
    try {
      const r = await bulk.run({ storeId: s.storeId, ids, action, params });
      haptic.notify('success');
      toast.success(t('seller.bulkDone', { n: (r as { updated: number }).updated }));
      exitSelect();
    } catch (e) {
      setPatched({});
      toastError(e, t);
    }
  };

  useMainButton(selecting ? null : { text: t('seller.newProduct'), onClick: () => navigate(`/m/${s.slug}/products/new${categoryId ? `?category=${categoryId}` : ''}`), hidden: moving || pricing });

  return (
    <SellerScreen
      tab="products"
      kicker={total ? t('seller.productsTotal', { n: total }) : undefined}
      title={t('seller.products')}
      actions={
        <>
          <button type="button" className="sl-icon-btn" aria-label={t('seller.categories')} onClick={() => navigate(`/m/${s.slug}/categories`)}>
            <SIcon name="layers" size={20} />
          </button>
          <button type="button" className={`sl-icon-btn${selecting ? ' is-active' : ''}`} aria-pressed={selecting} aria-label={t('seller.prodSelect')} onClick={() => (selecting ? exitSelect() : setSelecting(true))}>
            <SIcon name={selecting ? 'close' : 'check'} size={20} />
          </button>
        </>
      }
    >
      <label className="sl-search">
        <SIcon name="search" size={18} />
        <input value={q} type="search" placeholder={t('seller.prodSearch')} onChange={(e) => setQ(e.target.value)} />
      </label>
      <Segmented<Status>
        size="sm"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: t('seller.prodAll') },
          { value: 'active', label: t('seller.status_active') },
          { value: 'draft', label: t('seller.status_draft') },
          { value: 'archived', label: t('seller.status_archived') },
        ]}
      />
      {(low || categoryId) && (
        <div className="sl-chips">
          {low && <Chip selected onClick={() => navigate(`/m/${s.slug}/products`, { replace: true })}>{t('seller.prodLow')} ✕</Chip>}
          {categoryId && <Chip selected onClick={() => navigate(`/m/${s.slug}/products`, { replace: true })}>{t('seller.inCategory', { name: catName || '…' })} ✕</Chip>}
        </div>
      )}
      <Gate loading={!first.data && first.loading} error={!first.data && (s.error ?? first.error)} onRetry={first.reload}>
        {items.length === 0 ? (
          dq || status !== 'all' || low || categoryId ? (
            <Empty icon="search" title={t('seller.prodNoMatch')} hint={t('seller.prodNoMatchHint')} />
          ) : (
            <Empty icon="box" title={t('seller.prodEmpty')} hint={t('seller.prodEmptyHint')} action={<Button icon={<SIcon name="plus" size={18} />} onClick={() => navigate(`/m/${s.slug}/products/new`)}>{t('seller.newProduct')}</Button>} />
          )
        ) : (
          <div className="sl-list pl-list">
            {items.map((p, i) => (
              <ProductRow key={p.id} p={p} index={i} selecting={selecting} selected={sel.has(p.id)} onToggle={() => toggle(p.id)} onOpen={() => morphNavigate(`/m/${s.slug}/products/${p.id}`)} />
            ))}
          </div>
        )}
        {first.data?.nextCursor && pages.length === 1 && <MorePages base={base} cursor={first.data.nextCursor} selecting={selecting} sel={sel} toggle={toggle} slug={s.slug} />}
      </Gate>

      <AnimatePresence>
        {selecting && (
          <m.div className="pl-bulk" initial={{ y: 90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 90, opacity: 0 }} transition={spring.sheet}>
            <div className="pl-bulk-head">
              <strong>{t('seller.prodSelected', { n: sel.size })}</strong>
              <button type="button" className="sl-link pl-bulk-all" onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((p) => p.id)))}>{t('seller.matrixSelectAll')}</button>
            </div>
            <div className="pl-bulk-actions">
              {([['activate', 'eye', t('seller.bulkActivate')], ['draft', 'eye-off', t('seller.bulkDraft')], ['move_category', 'folder', t('seller.bulkMove')], ['adjust_price', 'percent', t('seller.bulkPrice')], ['archive', 'trash', t('seller.bulkArchive')]] as const).map(([a, icon, label]) => (
                <button key={a} type="button" className="pl-bulk-btn" disabled={sel.size === 0 || bulk.loading} onClick={() => (a === 'move_category' ? setMoving(true) : a === 'adjust_price' ? setPricing(true) : void runBulk(a))}>
                  <SIcon name={icon} size={20} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
      <CategoryPicker open={moving} onClose={() => setMoving(false)} title={t('seller.bulkMoveTitle')} nodes={nodes} mode="select" allowNone onPick={(id) => void runBulk('move_category', { categoryId: id })} />
      <PercentSheet open={pricing} busy={bulk.loading} onClose={() => setPricing(false)} onApply={(p) => { setPricing(false); void runBulk('adjust_price', { percent: p }); }} />
    </SellerScreen>
  );
}

/** Second+ pages (cursor paging) rendered under the first page. */
function MorePages({ base, cursor, selecting, sel, toggle, slug }: { base: Record<string, unknown> | null; cursor: string; selecting: boolean; sel: Set<string>; toggle: (id: string) => void; slug: string }) {
  const { t } = useI18n();
  const [go, setGo] = useState(false);
  const q = useQuery('admin.products.list', go && base ? ({ ...base, cursor } as never) : null);
  const items = (q.data?.items ?? []) as unknown as ListItem[];
  if (!go) return <Button variant="secondary" block onClick={() => setGo(true)}>{t('seller.loadMore')}</Button>;
  return (
    <>
      <div className="sl-list pl-list">
        {items.map((p, i) => (
          <ProductRow key={p.id} p={p} index={i} selecting={selecting} selected={sel.has(p.id)} onToggle={() => toggle(p.id)} onOpen={() => morphNavigate(`/m/${slug}/products/${p.id}`)} />
        ))}
      </div>
      {q.data?.nextCursor && <MorePages base={base} cursor={q.data.nextCursor} selecting={selecting} sel={sel} toggle={toggle} slug={slug} />}
    </>
  );
}
