/** Promo codes & discounts: list with live status (active / scheduled / expired / off), usage, quick toggle, edit, delete. */
import { useState } from 'react';
import { m } from 'motion/react';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { spring, staggerDelay } from '../../../motion';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { Button, toast } from '../../../ui';
import { Toggle, useConfirm } from '../../components/Controls';
import { SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { copyText } from '../onboarding/Done';
import { PromoForm, type Promo } from './PromoForm';
import './promos.css';

export default function Promos(_: RouteProps) {
  const { t, money, date } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.discounts.list', s.storeId ? { storeId: s.storeId } : null);
  const save = useMutation('admin.discounts.save', { invalidates: ['admin.discounts', 'store.'] });
  const del = useMutation('admin.discounts.delete', { invalidates: ['admin.discounts', 'store.'] });
  const [editing, setEditing] = useState<Promo | null | 'new'>(null);
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const [confirmUi, ask] = useConfirm();
  const items = (q.data ?? []) as unknown as Promo[];
  useMainButton({ text: t('seller.prNew'), onClick: () => setEditing('new'), hidden: !!editing || !s.storeId });

  const state = (p: Promo) => {
    const now = Date.now();
    const on = flip[p.id] ?? p.status === 'active';
    if (!on) return ['muted', t('seller.prDisabled')] as const;
    if (p.endsAt && Date.parse(p.endsAt) < now) return ['bad', t('seller.prExpired')] as const;
    if (p.startsAt && Date.parse(p.startsAt) > now) return ['info', t('seller.prScheduled')] as const;
    return ['good', t('seller.prActive')] as const;
  };
  const value = (p: Promo) => (p.valueType === 'percent' ? `${p.value}%` : p.valueType === 'fixed' ? money(p.value) : p.valueType === 'bxgy' ? `${p.bxgy?.buy ?? 0}+${p.bxgy?.get ?? 0}` : <SIcon name="truck" size={30} label={t('seller.vt_free_shipping')} />);

  const toggle = async (p: Promo, on: boolean) => {
    if (!s.storeId) return;
    setFlip((f) => ({ ...f, [p.id]: on }));
    try {
      await save.run({ storeId: s.storeId, id: p.id, kind: p.kind, title: p.title, code: p.code, valueType: p.valueType, value: p.value, bxgy: p.bxgy, appliesTo: (p as unknown as { appliesTo: { type: 'all' } }).appliesTo ?? { type: 'all' }, conditions: p.conditions, startsAt: p.startsAt, endsAt: p.endsAt, usageLimit: p.usageLimit, perCustomerLimit: p.perCustomerLimit, status: on ? 'active' : 'disabled' });
    } catch (e) {
      setFlip((f) => ({ ...f, [p.id]: !on }));
      toastError(e, t);
    }
  };
  const remove = async (p: Promo) => {
    if (!s.storeId || !(await ask({ title: t('seller.prDeleteConfirm', { code: p.code ?? p.title }), danger: true, confirm: t('common.delete') }))) return;
    try {
      await del.run({ storeId: s.storeId, id: p.id });
      haptic.notify('success');
      toast.success(t('seller.prDeleted'));
    } catch (e) {
      toastError(e, t);
    }
  };

  return (
    <SellerScreen title={t('seller.promos')}>
      <Gate loading={!q.data && q.loading} error={!q.data && (s.error ?? q.error)} onRetry={q.reload}>
        {items.length === 0 ? (
          <Empty icon="tag" title={t('seller.prEmpty')} hint={t('seller.prEmptyHint')} action={<Button onClick={() => setEditing('new')}>{t('seller.prNew')}</Button>} />
        ) : (
          <div className="pr-list">
            {items.map((p, i) => {
              const [tone, label] = state(p);
              return (
                <m.div key={p.id} className={`pr-ticket is-${tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.snappy, delay: staggerDelay(i) }}>
                  <div className="pr-stub">
                    <span className="pr-value">{value(p)}</span>
                    <span className={`sl-pill is-${tone}`}>{label}</span>
                  </div>
                  <div className="pr-main">
                    <button type="button" className="pr-code" onClick={() => p.code && void copyText(p.code, t('common.copied'))}>
                      {p.code ?? p.title} {p.code && <SIcon name="copy" size={14} />}
                    </button>
                    <span className="pr-sub">
                      {t('seller.prUsage', { used: p.usedCount ?? 0, limit: p.usageLimit ?? '∞' })}
                      {p.conditions?.minSubtotal ? ` · ≥ ${money(p.conditions.minSubtotal)}` : ''}
                      {p.endsAt ? ` · ${t('seller.prEnds')}: ${date(p.endsAt)}` : ''}
                    </span>
                    <div className="pr-actions">
                      <Toggle checked={flip[p.id] ?? p.status === 'active'} onChange={(v) => void toggle(p, v)} />
                      <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.edit')} onClick={() => setEditing(p)}><SIcon name="edit" size={18} /></button>
                      <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.delete')} onClick={() => void remove(p)}><SIcon name="trash" size={18} /></button>
                    </div>
                  </div>
                </m.div>
              );
            })}
          </div>
        )}
      </Gate>
      {s.storeId && <PromoForm open={!!editing} promo={editing === 'new' ? null : editing} storeId={s.storeId} onClose={() => setEditing(null)} />}
      {confirmUi}
    </SellerScreen>
  );
}
