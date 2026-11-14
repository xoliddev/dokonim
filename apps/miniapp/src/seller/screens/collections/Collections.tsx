/** Collections: manual and rule-based shelves — list, create, edit, delete. */
import { useState } from 'react';
import { m } from 'motion/react';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring, staggerDelay } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, toast } from '../../../ui';
import { useConfirm } from '../../components/Controls';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import type { CatNode } from '../../lib/tree';
import { CollectionForm, type Coll } from './CollectionForm';
import './collections.css';

export default function Collections(_: RouteProps) {
  const { t, l } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.collections.list', s.storeId ? { storeId: s.storeId } : null);
  const cats = useQuery('admin.categories.tree', s.storeId ? { storeId: s.storeId } : null);
  const del = useMutation('admin.collections.delete', { invalidates: ['admin.collections', 'store.'] });
  const [editing, setEditing] = useState<Coll | 'new' | null>(null);
  const [confirmUi, ask] = useConfirm();
  const items = (q.data ?? []) as unknown as Coll[];
  useMainButton({ text: t('seller.colNew'), onClick: () => setEditing('new'), hidden: !!editing || !s.storeId });

  const remove = async (c: Coll) => {
    if (!s.storeId || !(await ask({ title: t('seller.colDeleteConfirm', { name: l(c.title) }), body: t('seller.colDeleteBody'), danger: true, confirm: t('common.delete') }))) return;
    try {
      await del.run({ storeId: s.storeId, id: c.id });
      haptic.notify('success');
      toast.success(t('seller.colDeleted'));
    } catch (e) {
      toastError(e, t);
    }
  };

  return (
    <SellerScreen title={t('seller.collections')}>
      <Gate loading={!q.data && q.loading} error={!q.data && (s.error ?? q.error)} onRetry={q.reload}>
        {items.length === 0 ? (
          <Empty icon="grid" title={t('seller.colEmpty')} hint={t('seller.colEmptyHint')} action={<Button onClick={() => setEditing('new')}>{t('seller.colNew')}</Button>} />
        ) : (
          <div className="sl-list">
            {items.map((c, i) => (
              <m.div key={c.id} className="sl-row cl-row" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: staggerDelay(i) }}>
                <span className="sl-row-icon"><SIcon name={c.kind === 'automated' ? 'zap' : 'grid'} size={20} /></span>
                <button type="button" className="sl-row-main cl-open" onClick={() => setEditing(c)}>
                  <span className="sl-row-title">{l(c.title)} {c.isHidden && <SIcon name="eye-off" size={14} className="ct-hidden-icon" />}</span>
                  <span className="sl-row-sub">{c.kind === 'automated' ? t('seller.colAuto') : t('seller.colManual')} · {t('seller.colCount', { n: c.productCount })}</span>
                </button>
                <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.delete')} onClick={() => void remove(c)}><SIcon name="trash" size={18} /></button>
              </m.div>
            ))}
          </div>
        )}
      </Gate>
      {s.storeId && <CollectionForm open={!!editing} coll={editing === 'new' ? null : editing} storeId={s.storeId} nodes={(cats.data ?? []) as CatNode[]} onClose={() => setEditing(null)} />}
      {confirmUi}
    </SellerScreen>
  );
}
