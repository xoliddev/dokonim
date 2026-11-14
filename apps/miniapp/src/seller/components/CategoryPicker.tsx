/**
 * Drill-down category picker with breadcrumbs (§6.3 "move to…" for big trees) and search across the whole tree.
 *   mode 'select' — tapping a row picks it (product category, delete-reassign target); "No category" optional.
 *   mode 'move'   — rows only drill in; the footer button moves into the level you are looking at.
 * Levels slide in the travel direction.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useI18n } from '../../i18n';
import { spring } from '../../motion';
import { haptic } from '../../telegram/shim';
import { Button, Sheet } from '../../ui';
import { findNode, pathTo, walk, type CatNode } from '../lib/tree';
import { SIcon } from './SIcon';

export interface PickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  nodes: CatNode[];
  mode: 'select' | 'move';
  value?: string | null;
  /** Ids that cannot be picked or entered (the moved node's subtree). */
  blocked?: ReadonlySet<string>;
  allowNone?: boolean;
  onPick: (id: string | null) => void;
  confirmLabel?: string;
}

export function CategoryPicker(p: PickerProps) {
  return (
    <Sheet open={p.open} onClose={p.onClose} title={p.title} maxHeight={0.86}>
      {p.open && <PickerBody {...p} />}
    </Sheet>
  );
}

function PickerBody({ nodes, mode, value, blocked, allowNone, onPick, onClose, confirmLabel }: PickerProps) {
  const { t, l } = useI18n();
  const start = mode === 'select' && value ? (findNode(nodes, value)?.parentId ?? null) : null;
  const [level, setLevel] = useState<string | null>(start);
  const [dir, setDir] = useState(1);
  const [q, setQ] = useState('');
  const crumbs = pathTo(nodes, level);
  const list = level ? (findNode(nodes, level)?.children ?? []) : nodes;
  const blockedLevel = !!level && !!blocked?.has(level);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    const out: Array<{ n: CatNode; trail: string }> = [];
    walk(nodes, (n, _d, trail) => {
      if (Object.values(n.name).some((v) => v?.toLowerCase().includes(s))) out.push({ n, trail: trail.map((id) => l(findNode(nodes, id)?.name)).join(' › ') });
    });
    return out.slice(0, 50);
  }, [q, nodes, l]);

  const enter = (id: string | null, d: number) => {
    haptic.selection();
    setDir(d);
    setLevel(id);
  };
  const pick = (id: string | null) => {
    haptic.impact('light');
    onPick(id);
    onClose();
  };

  return (
    <div className="cp">
      <label className="sl-search">
        <SIcon name="search" size={18} />
        <input value={q} placeholder={t('seller.catsSearch')} onChange={(e) => setQ(e.target.value)} />
      </label>
      {results ? (
        <div className="cp-list">
          {results.length === 0 && <p className="sl-hint cp-empty">{t('seller.catsNoMatch', { q })}</p>}
          {results.map(({ n, trail }) => {
            const off = !!blocked?.has(n.id);
            return (
              <button key={n.id} type="button" className={`cp-row${value === n.id ? ' is-on' : ''}`} disabled={off} onClick={() => (mode === 'select' ? pick(n.id) : (setQ(''), enter(n.id, 1)))}>
                <SIcon name="folder" size={20} />
                <span className="cp-row-main">
                  <span className="cp-row-name">{l(n.name)}</span>
                  {trail && <span className="cp-row-sub">{trail}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <nav className="cp-crumbs" aria-label="breadcrumbs">
            <button type="button" className={`cp-crumb${level === null ? ' is-on' : ''}`} onClick={() => enter(null, -1)}>
              {t('seller.catsTop')}
            </button>
            {crumbs.map((c) => (
              <span key={c.id} className="cp-crumb-wrap">
                <SIcon name="chevron-right" size={14} />
                <button type="button" className={`cp-crumb${level === c.id ? ' is-on' : ''}`} onClick={() => enter(c.id, -1)}>
                  {l(c.name)}
                </button>
              </span>
            ))}
          </nav>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <m.div key={level ?? 'root'} className="cp-list" initial={{ opacity: 0, x: dir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -dir * 28 }} transition={spring.snappy}>
              {mode === 'select' && allowNone && level === null && (
                <button type="button" className={`cp-row${value == null ? ' is-on' : ''}`} onClick={() => pick(null)}>
                  <SIcon name="close" size={20} />
                  <span className="cp-row-main"><span className="cp-row-name">{t('seller.noCategory')}</span></span>
                </button>
              )}
              {list.map((n) => {
                const off = !!blocked?.has(n.id);
                const kids = n.children.length;
                return (
                  <div key={n.id} className={`cp-row-wrap${off ? ' is-off' : ''}`}>
                    <button type="button" className={`cp-row${value === n.id ? ' is-on' : ''}`} disabled={off} onClick={() => (mode === 'select' ? pick(n.id) : enter(n.id, 1))}>
                      <SIcon name="folder" size={20} />
                      <span className="cp-row-main">
                        <span className="cp-row-name">{l(n.name)}</span>
                        <span className="cp-row-sub">{off ? t('seller.catsMoveSelf') : t('seller.catsMeta', { p: n.subtreeCount })}</span>
                      </span>
                      {mode === 'move' && !off && <SIcon name="chevron-right" size={18} />}
                    </button>
                    {mode === 'select' && kids > 0 && !off && (
                      <button type="button" className="cp-drill" aria-label={l(n.name)} onClick={() => enter(n.id, 1)}>
                        <span className="cp-drill-n">{kids}</span>
                        <SIcon name="chevron-right" size={18} />
                      </button>
                    )}
                  </div>
                );
              })}
            </m.div>
          </AnimatePresence>
          {mode === 'move' && (
            <div className="cp-foot">
              <Button block disabled={blockedLevel} onClick={() => pick(level)} icon={<SIcon name="move" size={18} />}>
                {confirmLabel ?? t('seller.catsMoveHere')} · {level ? l(findNode(nodes, level)?.name) : t('seller.catsTop')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
