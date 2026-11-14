/**
 * Delete a category with an explicit child strategy:
 *   reparent_children — children + direct products move up to the parent
 *   reassign_products — subtree deleted, every product moves to a picked category
 *   archive_subtree   — subtree deleted, products archived ("delete with products", recoverable from the archive)
 * Empty leaves skip the choice. Strategy cards expand with a layout animation.
 */
import { useState } from 'react';
import { m } from 'motion/react';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Button, Sheet } from '../../../ui';
import { CategoryPicker } from '../../components/CategoryPicker';
import { SIcon } from '../../components/SIcon';
import { countDescendants, findNode, subtreeIds, type CatNode, type DeleteKind } from '../../lib/tree';

export interface DeleteChoice {
  kind: DeleteKind;
  targetId?: string;
}

export function DeleteSheet({ node, nodes, busy, onClose, onConfirm }: { node: CatNode | null; nodes: CatNode[]; busy: boolean; onClose: () => void; onConfirm: (c: DeleteChoice) => void }) {
  const { t, l } = useI18n();
  return (
    <Sheet open={!!node} onClose={onClose} title={node ? t('seller.deleteCategoryTitle', { name: l(node.name) }) : ''}>
      {node && <Body key={node.id} node={node} nodes={nodes} busy={busy} onClose={onClose} onConfirm={onConfirm} />}
    </Sheet>
  );
}

function Body({ node, nodes, busy, onClose, onConfirm }: { node: CatNode; nodes: CatNode[]; busy: boolean; onClose: () => void; onConfirm: (c: DeleteChoice) => void }) {
  const { t, l } = useI18n();
  const kids = countDescendants(node);
  const products = node.subtreeCount;
  const simple = kids === 0 && products === 0;
  const [kind, setKind] = useState<DeleteKind>('reparent_children');
  const [target, setTarget] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const parent = findNode(nodes, node.parentId);
  const parentName = parent ? l(parent.name) : t('seller.catsTop');
  const blocked = subtreeIds(node);
  const ready = simple || kind !== 'reassign_products' || !!target;

  const options: Array<{ k: DeleteKind; title: string; hint: string; icon: string }> = [
    { k: 'reparent_children', title: t('seller.del_reparent'), hint: t('seller.delHint_reparent', { parent: parentName }), icon: 'up' },
    { k: 'reassign_products', title: t('seller.del_reassign'), hint: t('seller.delHint_reassign'), icon: 'move' },
    { k: 'archive_subtree', title: t('seller.del_archive'), hint: t('seller.delHint_archive'), icon: 'trash' },
  ];

  return (
    <div className="sl-form">
      <div className="ds-what">
        <SIcon name="folder" size={20} />
        <span>{t('seller.delWhat', { n: kids, p: products })}</span>
      </div>
      {!simple && (
        <div className="ds-options" role="radiogroup" aria-label={t('seller.delStrategy')}>
          <span className="wz-label">{t('seller.delStrategy')}</span>
          {options.map((o) => {
            const on = kind === o.k;
            return (
              <m.button
                key={o.k}
                layout
                transition={spring.snappy}
                type="button"
                role="radio"
                aria-checked={on}
                className={`ds-opt${on ? ' is-on' : ''}${o.k === 'archive_subtree' ? ' is-danger' : ''}`}
                onClick={() => {
                  haptic.selection();
                  setKind(o.k);
                }}
              >
                <span className="ds-radio" aria-hidden="true">{on && <m.span className="ds-radio-dot" layoutId="ds-dot" transition={spring.bouncy} />}</span>
                <span className="ds-opt-main">
                  <span className="ds-opt-title">
                    <SIcon name={o.icon} size={16} /> {o.title}
                  </span>
                  <span className="ds-opt-hint">{o.hint}</span>
                  {on && o.k === 'reassign_products' && (
                    <span
                      className="ds-target"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicking(true);
                      }}
                    >
                      <SIcon name="folder" size={16} />
                      {target ? l(findNode(nodes, target)?.name) : t('seller.delTargetNone')}
                      <SIcon name="chevron-right" size={16} />
                    </span>
                  )}
                </span>
              </m.button>
            );
          })}
        </div>
      )}
      <p className="sl-hint">{t('seller.delIrreversible')}</p>
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" className="ds-go" loading={busy} disabled={!ready} onClick={() => onConfirm({ kind: simple ? 'reparent_children' : kind, targetId: target ?? undefined })}>
          {kind === 'archive_subtree' && products > 0 && !simple ? t('seller.delConfirmN', { p: products }) : t('seller.delConfirm')}
        </Button>
      </div>
      <CategoryPicker open={picking} onClose={() => setPicking(false)} title={t('seller.delPickTarget')} nodes={nodes} mode="select" value={target} blocked={blocked} onPick={(id) => setTarget(id)} />
    </div>
  );
}
