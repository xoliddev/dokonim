/** One row of the category tree + the per-category action sheet (with breadcrumbs). */
import type { PointerEvent as RPointerEvent } from 'react';
import { m } from 'motion/react';
import { useI18n } from '../../../i18n';
import { spring, useMotionTier } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Sheet } from '../../../ui';
import { SIcon } from '../../components/SIcon';
import { pathTo, type CatNode, type Row } from '../../lib/tree';
import type { DragState } from './useTreeDrag';

export const ROW_H = 60;

export function TreeRow({ row, drag, overZone, flash, canDrag, onToggle, onOpen, onAdd, onGrip }: {
  row: Row;
  drag: DragState | null;
  /** Drop zone shown on this row while another row is dragged over it. */
  overZone: string | null;
  flash: boolean;
  canDrag: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onAdd: () => void;
  onGrip: (e: RPointerEvent<HTMLElement>) => void;
}) {
  const { t, l } = useI18n();
  const tier = useMotionTier();
  const n = row.node;
  const dragging = drag?.id === n.id;
  return (
    <m.div
      layout={tier === 'full' && !drag ? 'position' : false}
      initial={tier === 'minimal' ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={spring.snappy}
      className={`ct-row${dragging ? ' is-dragging' : ''}${flash ? ' is-flash' : ''}${n.isHidden ? ' is-hidden' : ''}`}
      data-zone={overZone ?? undefined}
      style={{ height: ROW_H, ...(dragging ? { transform: `translateY(${drag!.dy}px) scale(1.02)`, zIndex: 5 } : null) }}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
    >
      {canDrag ? (
        <span className="ct-grip" onPointerDown={onGrip} aria-label={t('seller.moveCategory')} role="button" tabIndex={-1}>
          <SIcon name="grip" size={18} />
        </span>
      ) : (
        <span className="ct-grip is-off" />
      )}
      <span className="ct-indent" style={{ width: row.depth * 18 }} aria-hidden="true" />
      <button type="button" className={`ct-chev${row.expanded ? ' is-open' : ''}`} disabled={!row.hasChildren} aria-label={row.hasChildren ? l(n.name) : undefined} onClick={() => { haptic.selection(); onToggle(); }}>
        {row.hasChildren ? <SIcon name="chevron-right" size={18} /> : <span className="ct-dot" />}
      </button>
      <button type="button" className="ct-main" onClick={onOpen}>
        <span className="ct-name">
          {l(n.name) || n.slug}
          {n.isHidden && <SIcon name="eye-off" size={14} className="ct-hidden-icon" label={t('seller.catsHidden')} />}
        </span>
        <span className="ct-meta">
          {t('seller.catsMeta', { p: n.subtreeCount })}
          {n.children.length > 0 && ` · ${t('seller.catsChildren', { n: n.children.length })}`}
        </span>
      </button>
      <button type="button" className="ct-add" aria-label={t('seller.addSubcategory')} onClick={onAdd}>
        <SIcon name="plus" size={18} />
      </button>
    </m.div>
  );
}

export type Action = 'add' | 'edit' | 'up' | 'down' | 'moveTo' | 'toggleHidden' | 'products' | 'delete';

export function ActionSheet({ row, nodes, onClose, onAction }: { row: Row | null; nodes: CatNode[]; onClose: () => void; onAction: (a: Action) => void }) {
  const { t, l } = useI18n();
  const n = row?.node;
  const crumbs = n ? pathTo(nodes, n.id) : [];
  const items: Array<{ a: Action; icon: string; label: string; disabled?: boolean; danger?: boolean }> = n
    ? [
        { a: 'add', icon: 'folder-plus', label: t('seller.addSubcategory') },
        { a: 'edit', icon: 'edit', label: t('seller.catsRename') },
        { a: 'up', icon: 'up', label: t('seller.catsMoveUp'), disabled: row!.index === 0 },
        { a: 'down', icon: 'down', label: t('seller.catsMoveDown'), disabled: row!.index >= row!.siblings - 1 },
        { a: 'moveTo', icon: 'move', label: t('seller.catsMoveTo') },
        { a: 'toggleHidden', icon: n.isHidden ? 'eye' : 'eye-off', label: n.isHidden ? t('seller.catsShow') : t('seller.catsHide') },
        { a: 'products', icon: 'box', label: t('seller.catsViewProducts') },
        { a: 'delete', icon: 'trash', label: t('common.delete'), danger: true },
      ]
    : [];
  return (
    <Sheet open={!!row} onClose={onClose} title={n ? l(n.name) : ''}>
      {n && (
        <div className="ct-actions">
          <nav className="ct-crumbs" aria-label="breadcrumbs">
            <span>{t('seller.catsTop')}</span>
            {crumbs.map((c) => (
              <span key={c.id} className={c.id === n.id ? 'is-on' : ''}>
                <SIcon name="chevron-right" size={12} /> {l(c.name)}
              </span>
            ))}
          </nav>
          <div className="ct-action-grid">
            {items.map((it) => (
              <button key={it.a} type="button" className={`ct-action${it.danger ? ' is-danger' : ''}`} disabled={it.disabled} onClick={() => onAction(it.a)}>
                <SIcon name={it.icon} size={20} />
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
