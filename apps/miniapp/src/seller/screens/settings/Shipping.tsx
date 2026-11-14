/** Delivery: methods on/off, zones (regions) and a rate per zone × method. */
import { useState } from 'react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation, useQuery } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import type { RouteProps } from '../../../router/router';
import { haptic, useMainButton } from '../../../telegram/shim';
import { toast } from '../../../ui';
import { Toggle, useConfirm } from '../../components/Controls';
import { Section, SellerScreen } from '../../components/Layout';
import { SIcon } from '../../components/SIcon';
import { Empty, Gate } from '../../components/States';
import { useSeller } from '../../lib/ctx';
import { toastError } from '../../lib/errors';
import { RateSheet, ZoneSheet, type Method, type Rate, type Zone } from './ShippingSheets';
import './settings.css';

export default function Shipping(_: RouteProps) {
  const { t, l, money } = useI18n();
  const s = useSeller();
  const q = useQuery('admin.shipping.get', s.storeId ? { storeId: s.storeId } : null);
  const saveMethod = useMutation('admin.shipping.saveMethod', { invalidates: ['admin.shipping', 'store.'] });
  const delZone = useMutation('admin.shipping.deleteZone', { invalidates: ['admin.shipping', 'store.'] });
  const [zone, setZone] = useState<Zone | 'new' | null>(null);
  const [rate, setRate] = useState<{ zone: Zone; method: Method; rate: Rate | null } | null>(null);
  const [flip, setFlip] = useState<Record<string, boolean>>({});
  const [confirmUi, ask] = useConfirm();
  const data = q.data as { methods: Method[]; zones: Zone[]; rates: Rate[] } | undefined;
  useMainButton({ text: t('seller.shAddZone'), onClick: () => setZone('new'), hidden: !!zone || !!rate || !s.storeId });

  const toggleMethod = async (m: Method, on: boolean) => {
    if (!s.storeId) return;
    setFlip((f) => ({ ...f, [m.id]: on }));
    try {
      await saveMethod.run({ storeId: s.storeId, id: m.id, type: m.type as never, name: m.name, processingDays: m.processingDays, cutoffTime: m.cutoffTime, workingDays: m.workingDays, holidays: m.holidays, pickupPoints: m.pickupPoints as never, codAllowed: m.codAllowed, enabled: on });
      haptic.notify('success');
    } catch (e) {
      setFlip((f) => ({ ...f, [m.id]: !on }));
      toastError(e, t);
    }
  };
  const removeZone = async (z: Zone) => {
    if (!s.storeId || !(await ask({ title: t('seller.shZoneDelete', { name: z.name }), body: t('seller.shZoneDeleteBody'), danger: true, confirm: t('common.delete') }))) return;
    try {
      await delZone.run({ storeId: s.storeId, id: z.id });
      toast.success(t('seller.shZoneDeleted'));
    } catch (e) {
      toastError(e, t);
    }
  };
  const rateText = (r: Rate) =>
    `${r.calc === 'free_over' && r.freeOver ? `${money(r.amount)} · ≥ ${money(r.freeOver)} ${t('seller.shFree')}` : r.amount === 0 ? t('seller.shFree') : money(r.amount)}${r.calc === 'weight' && r.perKg ? ` + ${money(r.perKg)}/kg` : ''} · ${t('seller.shDays', { a: r.transitDaysMin, b: r.transitDaysMax })}`;

  return (
    <SellerScreen title={t('seller.shipping')}>
      <Gate loading={!data && q.loading} error={!data && (s.error ?? q.error)} onRetry={q.reload}>
        {data && (
          <>
            <Section title={t('seller.shMethods')}>
              <div className="sl-list">
                {data.methods.map((m) => (
                  <div key={m.id} className="sl-row">
                    <span className="sl-row-icon"><SIcon name={m.type === 'courier' ? 'truck' : m.type === 'post' ? 'box' : 'store'} size={20} /></span>
                    <span className="sl-row-main">
                      <span className="sl-row-title">{l(m.name) || t(`seller.mt_${m.type}` as MessageKey)}</span>
                      <span className="sl-row-sub">{t('seller.shProcessing', { n: m.processingDays, cut: m.cutoffTime })}</span>
                    </span>
                    <Toggle checked={flip[m.id] ?? m.enabled} onChange={(v) => void toggleMethod(m, v)} />
                  </div>
                ))}
              </div>
            </Section>
            <Section title={t('seller.shZones')}>
              {data.zones.length === 0 && <Empty icon="map" title={t('seller.shZonesEmpty')} />}
              {data.zones.map((z) => (
                <div key={z.id} className="sh-zone">
                  <div className="sh-zone-head">
                    <button type="button" className="cl-open sh-zone-name" onClick={() => setZone(z)}>
                      <strong>{z.name}</strong>
                      <span className="sl-row-sub">{t('seller.shRegionsN', { n: z.regions.length })}</span>
                    </button>
                    <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.edit')} onClick={() => setZone(z)}><SIcon name="edit" size={18} /></button>
                    <button type="button" className="sl-icon-btn is-plain" aria-label={t('common.delete')} onClick={() => void removeZone(z)}><SIcon name="trash" size={18} /></button>
                  </div>
                  {data.methods.filter((m) => m.enabled || flip[m.id]).map((m) => {
                    const r = data.rates.find((x) => x.zoneId === z.id && x.methodId === m.id) ?? null;
                    return (
                      <button key={m.id} type="button" className={`sh-rate${r ? '' : ' is-empty'}`} onClick={() => setRate({ zone: z, method: m, rate: r })}>
                        <span>{l(m.name) || t(`seller.mt_${m.type}` as MessageKey)}</span>
                        <span className="sh-rate-val">{r ? rateText(r) : t('seller.shNoRate')}</span>
                        <SIcon name="chevron-right" size={16} />
                      </button>
                    );
                  })}
                </div>
              ))}
            </Section>
          </>
        )}
      </Gate>
      {s.storeId && <ZoneSheet zone={zone} storeId={s.storeId} onClose={() => setZone(null)} />}
      {s.storeId && <RateSheet target={rate} storeId={s.storeId} onClose={() => setRate(null)} />}
      {confirmUi}
    </SellerScreen>
  );
}
