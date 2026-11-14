/** Zone editor (name + regions) and rate editor (flat / by weight / free over, transit days) sheets. */
import { useState } from 'react';
import { UZ_REGIONS } from '@dokonim/core';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { haptic } from '../../../telegram/shim';
import { Button, Chip, Input, Sheet, toast } from '../../../ui';
import { MoneyInput, Segmented } from '../../components/Controls';
import { toastError } from '../../lib/errors';

export interface Zone { id: string; name: string; regions: string[] }
export interface Method { id: string; type: string; name: Record<string, string>; processingDays: number; cutoffTime: string; workingDays: number[]; holidays: string[]; pickupPoints: unknown[]; codAllowed: boolean; enabled: boolean }
export interface Rate { zoneId: string; methodId: string; calc: 'flat' | 'weight' | 'free_over'; amount: number; perKg: number | null; freeOver: number | null; transitDaysMin: number; transitDaysMax: number }
const INV = ['admin.shipping', 'store.'];

export function ZoneSheet({ zone, storeId, onClose }: { zone: Zone | 'new' | null; storeId: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={!!zone} onClose={onClose} title={zone === 'new' ? t('seller.shAddZone') : zone?.name}>
      {zone && <ZoneBody key={zone === 'new' ? 'new' : zone.id} zone={zone === 'new' ? null : zone} storeId={storeId} onClose={onClose} />}
    </Sheet>
  );
}

function ZoneBody({ zone, storeId, onClose }: { zone: Zone | null; storeId: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(zone?.name ?? '');
  const [regions, setRegions] = useState<Set<string>>(new Set(zone?.regions ?? []));
  const [touched, setTouched] = useState(false);
  const save = useMutation('admin.shipping.saveZone', { invalidates: INV });
  const errName = touched && !name.trim() ? t('seller.catsNameRequired') : undefined;
  const errReg = touched && regions.size === 0 ? t('seller.shRegionsReq') : undefined;
  const submit = async () => {
    setTouched(true);
    if (!name.trim() || regions.size === 0) return haptic.notify('error');
    try {
      await save.run({ storeId, ...(zone ? { id: zone.id } : {}), name: name.trim(), regions: [...regions] });
      haptic.notify('success');
      toast.success(t('seller.shZoneSaved'));
      onClose();
    } catch (e) {
      toastError(e, t);
    }
  };
  return (
    <div className="sl-form">
      <Input label={t('seller.shZoneName')} value={name} maxLength={60} error={errName} onChange={(e) => setName(e.target.value)} />
      <div className="field">
        <span className="field-label">{t('seller.shRegions')} · {regions.size}/14</span>
        <div className="pe-wrap">
          {UZ_REGIONS.map((r) => (
            <Chip key={r.code} selected={regions.has(r.code)} onClick={() => setRegions((x) => { const n = new Set(x); if (n.has(r.code)) n.delete(r.code); else n.add(r.code); return n; })}>
              {r[locale]}
            </Chip>
          ))}
        </div>
        {errReg && <span className="field-error">{errReg}</span>}
      </div>
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={save.loading} onClick={() => void submit()}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

export function RateSheet({ target, storeId, onClose }: { target: { zone: Zone; method: Method; rate: Rate | null } | null; storeId: string; onClose: () => void }) {
  const { l } = useI18n();
  return (
    <Sheet open={!!target} onClose={onClose} title={target ? `${target.zone.name} · ${l(target.method.name)}` : ''}>
      {target && <RateBody key={`${target.zone.id}:${target.method.id}`} {...target} storeId={storeId} onClose={onClose} />}
    </Sheet>
  );
}

function RateBody({ zone, method, rate, storeId, onClose }: { zone: Zone; method: Method; rate: Rate | null; storeId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [calc, setCalc] = useState<Rate['calc']>(rate?.calc ?? 'flat');
  const [amount, setAmount] = useState<number | null>(rate?.amount ?? 2500000);
  const [perKg, setPerKg] = useState<number | null>(rate?.perKg ?? null);
  const [freeOver, setFreeOver] = useState<number | null>(rate?.freeOver ?? null);
  const [min, setMin] = useState(String(rate?.transitDaysMin ?? 1));
  const [max, setMax] = useState(String(rate?.transitDaysMax ?? 2));
  const save = useMutation('admin.shipping.saveRate', { invalidates: INV });
  const del = useMutation('admin.shipping.deleteRate', { invalidates: INV });
  const daysBad = Number(max) < Number(min);
  const amountBad = amount == null || !Number.isFinite(amount) || amount < 0;
  const submit = async () => {
    if (daysBad || amountBad) return haptic.notify('error');
    try {
      await save.run({ storeId, zoneId: zone.id, methodId: method.id, calc, amount: amount!, perKg: calc === 'weight' ? perKg : null, freeOver: calc === 'free_over' ? freeOver : null, transitDaysMin: Number(min), transitDaysMax: Number(max) });
      haptic.notify('success');
      toast.success(t('seller.shRateSaved'));
      onClose();
    } catch (e) {
      toastError(e, t);
    }
  };
  const remove = async () => {
    try {
      await del.run({ storeId, zoneId: zone.id, methodId: method.id });
      toast.success(t('seller.shRateDeleted'));
      onClose();
    } catch (e) {
      toastError(e, t);
    }
  };
  return (
    <div className="sl-form">
      <Segmented<Rate['calc']> size="sm" value={calc} onChange={setCalc} options={(['flat', 'weight', 'free_over'] as const).map((c) => ({ value: c, label: t(`seller.calc_${c}` as MessageKey) }))} />
      <MoneyInput label={t('seller.shAmount')} value={amount} error={amountBad ? t('seller.e_price') : undefined} onChange={setAmount} />
      {calc === 'weight' && <MoneyInput label={t('seller.shPerKg')} value={perKg} onChange={setPerKg} />}
      {calc === 'free_over' && <MoneyInput label={t('seller.shFreeOver')} value={freeOver} onChange={setFreeOver} />}
      <div className="pe-2col">
        <Input label={t('seller.shDaysMin')} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        <Input label={t('seller.shDaysMax')} inputMode="numeric" value={max} error={daysBad ? t('seller.shDaysBad') : undefined} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      </div>
      <div className="sl-sheet-actions">
        {rate ? <Button variant="danger" loading={del.loading} onClick={() => void remove()}>{t('common.delete')}</Button> : <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>}
        <Button loading={save.loading} onClick={() => void submit()}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
