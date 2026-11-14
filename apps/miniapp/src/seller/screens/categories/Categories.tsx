/**
 * Category tree editor (§5.2 / §6.3) — unlimited nesting. Expand/collapse, search (matches + ancestors), drag to
 * move or reorder (before / inside / after), "move to…" drill-down picker, up/down, create a child at any level,
 * rename, hide, delete with a child strategy, breadcrumbs. Moves and deletes are optimistic and roll back on error.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import type { RouteProps } from '../../../router/router';
import { navigate } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, toast } from '../../../ui';
import { CategoryPicker } from '../../components/CategoryPicker';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate, ListSkeleton } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { deleteNode, findNode, maxDepth, moveNode, subtreeIds, visibleRows, walk, type CatNode, type Row } from '../../lib/tree';
import { CategoryForm, type FormMode } from './CategoryForm';
import { DeleteSheet, type DeleteChoice } from './DeleteSheet';
import { ActionSheet, ROW_H, TreeRow, type Action } from './TreeRow';
import { useTreeDrag } from './useTreeDrag';
import './categories.css';

const INV = ['admin.categories', 'admin.products', 'admin.dashboard', 'store.'];

export default function Categories(_: RouteProps) {
  const { t, l } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.categories.tree', s.storeId ? { storeId: s.storeId } : null);
  const server = q.data as CatNode[] | undefined;
  const [local, setLocal] = useState<CatNode[] | null>(null);
  const nodes = useMemo(() => local ?? server ?? [], [local, server]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const seeded = useRef(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormMode | null>(null);
  const [action, setAction] = useState<Row | null>(null);
  const [moving, setMoving] = useState<CatNode | null>(null);
  const [deleting, setDeleting] = useState<CatNode | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moveApi = useMutation('admin.categories.move', { invalidates: INV });
  const delApi = useMutation('admin.categories.delete', { invalidates: INV });
  const updApi = useMutation('admin.categories.update', { invalidates: INV });

  // fresh server data replaces the optimistic copy; first load opens the top level
  useEffect(() => {
    setLocal(null);
    if (server && !seeded.current) {
      seeded.current = true;
      let saved: string[] | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(`sl.cats.open.${s.storeId}`) ?? 'null') as string[] | null;
      } catch {}
      setExpanded(new Set(saved ?? server.map((n) => n.id)));
    }
  }, [server, s.storeId]);
  // remember which branches are open for this session (coming back from a product keeps the tree as it was)
  useEffect(() => {
    if (!seeded.current || !s.storeId) return;
    try {
      sessionStorage.setItem(`sl.cats.open.${s.storeId}`, JSON.stringify([...expanded]));
    } catch {}
  }, [expanded, s.storeId]);

  const rows = useMemo(() => visibleRows(nodes, expanded, search), [nodes, expanded, search]);
  const depth = useMemo(() => maxDepth(nodes), [nodes]);
  const sheetOpen = !!(form || action || moving || deleting);
  const searching = !!search.trim();

  const open = (id: string | null) => id && setExpanded((e) => new Set(e).add(id));
  const pulse = (id: string) => {
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1400);
  };

  const move = async (id: string, parentId: string | null, index: number) => {
    const node = findNode(nodes, id);
    if (!s.storeId || !node) return;
    try {
      setLocal(moveNode(nodes, id, parentId, index));
    } catch {
      haptic.notify('error');
      toast.error(t('seller.catsMoveSelf'));
      return;
    }
    open(parentId);
    pulse(id);
    try {
      await moveApi.run({ storeId: s.storeId, id, parentId, index });
      haptic.notify('success');
      toast.success(t('seller.catsMoved', { name: l(node.name) }));
    } catch (e) {
      setLocal(null);
      toastError(e, t);
    }
  };

  const drag = useTreeDrag({ rows, nodes, rowH: ROW_H, listRef, onDrop: (id, to) => void move(id, to.parentId, to.index) });

  const remove = async (node: CatNode, c: DeleteChoice) => {
    if (!s.storeId) return;
    const strategy = c.kind === 'reassign_products' ? { kind: c.kind, targetId: c.targetId! } : { kind: c.kind };
    try {
      await delApi.run({ storeId: s.storeId, id: node.id, strategy });
      setLocal(deleteNode(nodes, node.id, c.kind));
      if (c.kind === 'reparent_children') node.children.forEach((k) => pulse(k.id));
      setDeleting(null);
      haptic.notify('success');
      toast.success(t('seller.catsDeleted', { name: l(node.name) }));
    } catch (e) {
      toastError(e, t);
    }
  };

  const onAction = async (a: Action) => {
    const row = action;
    if (!row || !s.storeId) return;
    const n = row.node;
    const parentId = row.trail.at(-1) ?? null;
    setAction(null);
    if (a === 'add') setForm({ kind: 'create', parentId: n.id });
    else if (a === 'edit') setForm({ kind: 'edit', node: n });
    else if (a === 'up') void move(n.id, parentId, row.index - 1);
    else if (a === 'down') void move(n.id, parentId, row.index + 1);
    else if (a === 'moveTo') setMoving(n);
    else if (a === 'delete') setDeleting(n);
    else if (a === 'products') navigate(`/m/${s.slug}/products?category=${n.id}`);
    else if (a === 'toggleHidden') {
      try {
        await updApi.run({ storeId: s.storeId, id: n.id, isHidden: !n.isHidden });
        haptic.notify('success');
      } catch (e) {
        toastError(e, t);
      }
    }
  };

  useMainButton({ text: t('seller.addCategory'), onClick: () => setForm({ kind: 'create', parentId: null }), hidden: sheetOpen || !s.storeId });

  const allIds = () => {
    const out = new Set<string>();
    walk(nodes, (n) => n.children.length && out.add(n.id));
    return out;
  };
  const allOpen = rows.length > 0 && rows.every((r) => !r.hasChildren || r.expanded);

  return (
    <SellerScreen
      kicker={s.store ? `@${s.store.slug}` : undefined}
      title={t('seller.categories')}
      actions={
        nodes.length > 0 && (
          <button type="button" className="sl-icon-btn" aria-label={allOpen ? t('seller.catsCollapseAll') : t('seller.catsExpandAll')} onClick={() => setExpanded(allOpen ? new Set() : allIds())}>
            <SIcon name={allOpen ? 'up' : 'layers'} size={20} />
          </button>
        )
      }
    >
      <Gate loading={!server && (q.loading || s.loading)} error={!server && (s.error ?? q.error)} onRetry={q.reload} skeleton={<ListSkeleton rows={7} thumb={false} />}>
        {nodes.length === 0 ? (
          <Empty icon="grid" title={t('seller.catsEmpty')} hint={t('seller.catsEmptyHint')} action={<Button icon={<SIcon name="plus" size={18} />} onClick={() => setForm({ kind: 'create', parentId: null })}>{t('seller.addCategory')}</Button>} />
        ) : (
          <>
            <label className="sl-search">
              <SIcon name="search" size={18} />
              <input value={search} placeholder={t('seller.catsSearch')} onChange={(e) => setSearch(e.target.value)} />
              {searching && <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.close')} onClick={() => setSearch('')}><SIcon name="close" size={16} /></button>}
            </label>
            {depth > 8 && <p className="ct-warn"><SIcon name="alert" size={16} /> {t('seller.catsDeepWarn', { n: 8 })}</p>}
            {!searching && <p className="sl-hint">{t('seller.catsDragHint')}</p>}
            {rows.length === 0 ? (
              <p className="sl-hint ct-nomatch">{t('seller.catsNoMatch', { q: search })}</p>
            ) : (
              <div ref={listRef} className={`ct-tree${drag.state ? ' is-dragging' : ''}`} role="tree" aria-label={t('seller.categories')}>
                <AnimatePresence initial={false}>
                  {rows.map((r, i) => (
                    <TreeRow
                      key={r.node.id}
                      row={r}
                      drag={drag.state}
                      overZone={drag.state && drag.state.target && drag.state.overIndex === i && drag.state.id !== r.node.id ? drag.state.zone : null}
                      flash={flash === r.node.id}
                      canDrag={!searching && !moveApi.loading}
                      onGrip={drag.start(r.node.id)}
                      onToggle={() => setExpanded((e) => { const x = new Set(e); if (x.has(r.node.id)) x.delete(r.node.id); else x.add(r.node.id); return x; })}
                      onOpen={() => setAction(r)}
                      onAdd={() => setForm({ kind: 'create', parentId: r.node.id })}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </Gate>
      {s.storeId && (
        <CategoryForm mode={form} nodes={nodes} storeId={s.storeId} onClose={() => setForm(null)} onSaved={(id, parentId) => { open(parentId); pulse(id); }} />
      )}
      <ActionSheet row={action} nodes={nodes} onClose={() => setAction(null)} onAction={(a) => void onAction(a)} />
      <CategoryPicker
        open={!!moving}
        onClose={() => setMoving(null)}
        title={moving ? t('seller.catsMoveTitle', { name: l(moving.name) }) : ''}
        nodes={nodes}
        mode="move"
        blocked={moving ? subtreeIds(moving) : undefined}
        onPick={(parentId) => {
          const m = moving;
          if (!m) return;
          const siblings = parentId ? (findNode(nodes, parentId)?.children ?? []) : nodes;
          void move(m.id, parentId, siblings.filter((x) => x.id !== m.id).length);
        }}
      />
      <DeleteSheet node={deleting} nodes={nodes} busy={delApi.loading} onClose={() => setDeleting(null)} onConfirm={(c) => deleting && void remove(deleting, c)} />
    </SellerScreen>
  );
}
