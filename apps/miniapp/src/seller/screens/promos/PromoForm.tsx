/** Promo / discount editor sheet: kind, code (with generator), value type, conditions, limits, schedule, on/off. */
import { useState } from 'react';
import type { MessageKey } from '@dokonim/i18n';
import { useMutation } from '../../../api/provider';
import { useI18n } from '../../../i18n';
import { haptic } from '../../../telegram/shim';
import { Button, Input, Sheet, toast } from '../../../ui';
import { MoneyInput, Segmented, Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import { fieldError, toastError } from '../../lib/errors';

export interface Promo {
  id: string;
  kind: 'code' | 'automatic' | 'flash_sale';
  title: string;
  code: string | null;
  valueType: 'percent' | 'fixed' | 'free_shipping' | 'bxgy';
  value: number;
  bxgy: { buy: number; get: number } | null;
  appliesTo?: { type: 'all' | 'products' | 'collections' | 'category'; ids?: string[] };
  conditions: { minSubtotal?: number | null; firstOrder?: boolean };
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  status: 'active' | 'disabled';
}

const CODE = /^[A-Z0-9_-]{3,32}$/;
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const randomCode = () => `${['SALOM', 'BAYRAM', 'YANGI', 'DOST', 'TOY'][Math.floor(Math.random() * 5)]}${Math.floor(10 + Math.random() * 89)}`;

export function PromoForm({ open, promo, storeId, onClose }: { open: boolean; promo: Promo | null; storeId: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={promo ? t('seller.prEdit') : t('seller.prNew')} maxHeight={0.94}>
      {open && <Body key={promo?.id ?? 'new'} promo={promo} storeId={storeId} onClose={onClose} t={t} />}
    </Sheet>
  );
}

function Body({ promo, storeId, onClose, t }: { promo: Promo | null; storeId: string; onClose: () => void; t: ReturnType<typeof useI18n>['t'] }) {
  const [kind, setKind] = useState<Promo['kind']>(promo?.kind ?? 'code');
  const [code, setCode] = useState(promo?.code ?? '');
  const [title, setTitle] = useState(promo?.title ?? '');
  const [vt, setVt] = useState<Promo['valueType']>(promo?.valueType ?? 'percent');
  const [pct, setPct] = useState(promo?.valueType === 'percent' ? String(promo.value) : '10');
  const [amount, setAmount] = useState<number | null>(promo?.valueType === 'fixed' ? promo.value : null);
  const [buy, setBuy] = useState(String(promo?.bxgy?.buy ?? 2));
  const [get, setGet] = useState(String(promo?.bxgy?.get ?? 1));
  const [min, setMin] = useState<number | null>(promo?.conditions?.minSubtotal ?? null);
  const [first, setFirst] = useState(!!promo?.conditions?.firstOrder);
  const [limit, setLimit] = useState(promo?.usageLimit ? String(promo.usageLimit) : '');
  const [per, setPer] = useState(promo?.perCustomerLimit ? String(promo.perCustomerLimit) : '');
  const [starts, setStarts] = useState(toLocal(promo?.startsAt ?? null));
  const [ends, setEnds] = useState(toLocal(promo?.endsAt ?? null));
  const [on, setOn] = useState(promo ? promo.status === 'active' : true);
  const [touched, setTouched] = useState(false);
  const [apiErr, setApiErr] = useState<unknown>(null);
  const save = useMutation('admin.discounts.save', { invalidates: ['admin.discounts', 'store.'] });

  const p = Number(pct);
  const errs = {
    code: kind === 'code' && !CODE.test(code) ? t('seller.prCodeBad') : fieldError(apiErr, 'code', t),
    value: vt === 'percent' && !(p >= 1 && p <= 100) ? t('seller.prValueBad') : vt === 'fixed' && !(amount && amount > 0) ? t('seller.prAmountBad') : fieldError(apiErr, 'value', t),
    ends: starts && ends && new Date(ends) <= new Date(starts) ? t('seller.prEndsBad') : kind === 'flash_sale' && !ends ? t('seller.prEndsBad') : fieldError(apiErr, 'endsAt', t),
  };
  const invalid = Object.values(errs).some(Boolean);

  const submit = async () => {
    setTouched(true);
    if (invalid) return haptic.notify('error');
    setApiErr(null);
    try {
      await save.run({
        storeId, ...(promo ? { id: promo.id } : {}), kind, title: title.trim() || code || t(`seller.vt_${vt}` as MessageKey), code: kind === 'code' ? code : null, valueType: vt,
        value: vt === 'percent' ? p : vt === 'fixed' ? amount! : 0, bxgy: vt === 'bxgy' ? { buy: Number(buy) || 1, get: Number(get) || 1 } : null, appliesTo: promo?.appliesTo ?? { type: 'all' }, // keep an existing product / collection scope
        conditions: { minSubtotal: min, firstOrder: first }, startsAt: fromLocal(starts), endsAt: fromLocal(ends), usageLimit: limit ? Number(limit) : null, perCustomerLimit: per ? Number(per) : null,
        status: on ? 'active' : 'disabled',
      });
      haptic.notify('success');
      toast.success(t('seller.prSaved'));
      onClose();
    } catch (e) {
      setApiErr(e);
      if (!fieldError(e, 'code', t) && !fieldError(e, 'value', t)) toastError(e, t);
    }
  };
  const show = (k: keyof typeof errs) => (touched || apiErr ? errs[k] : undefined);

  return (
    <div className="sl-form">
      <Segmented<Promo['kind']> size="sm" value={kind} onChange={setKind} options={[{ value: 'code', label: t('seller.discountCode') }, { value: 'automatic', label: t('seller.discountAutomatic') }, { value: 'flash_sale', label: t('seller.discountFlash') }]} />
      {kind === 'code' && (
        <div className="pr-code-row">
          <Input label={t('seller.prCode')} value={code} hint={show('code') ? undefined : t('seller.prCodeHint')} error={show('code')} maxLength={32} autoCapitalize="characters" spellCheck={false} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />
          <button type="button" className="sl-icon-btn" aria-label={t('seller.prGenerate')} onClick={() => { haptic.selection(); setCode(randomCode()); }}>
            <SIcon name="sparkle" size={20} />
          </button>
        </div>
      )}
      <Input label={t('seller.prTitle')} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      <div className="field">
        <span className="field-label">{t('seller.prType')}</span>
        <div className="pe-wrap">
          {(['percent', 'fixed', 'free_shipping', 'bxgy'] as const).map((x) => (
            <button key={x} type="button" className={`chip${vt === x ? ' is-selected' : ''}`} onClick={() => { haptic.selection(); setVt(x); }}>{t(`seller.vt_${x}` as MessageKey)}</button>
          ))}
        </div>
      </div>
      {vt === 'percent' && <Input label={t('seller.prValuePercent')} inputMode="numeric" value={pct} suffix="%" error={show('value')} onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))} />}
      {vt === 'fixed' && <MoneyInput label={t('seller.prValueFixed')} value={amount} error={show('value')} onChange={setAmount} />}
      {vt === 'bxgy' && (
        <div className="pe-2col">
          <Input label={t('seller.prBuy')} inputMode="numeric" value={buy} onChange={(e) => setBuy(e.target.value.replace(/\D/g, ''))} />
          <Input label={t('seller.prGet')} inputMode="numeric" value={get} onChange={(e) => setGet(e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
      <MoneyInput label={t('seller.prMin')} value={min} hint={t('common.optional')} onChange={setMin} />
      <div className="pe-2col">
        <Input label={t('seller.prLimit')} inputMode="numeric" value={limit} placeholder="∞" onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
        <Input label={t('seller.prPerCustomer')} inputMode="numeric" value={per} placeholder="∞" onChange={(e) => setPer(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="pe-2col">
        <Input label={t('seller.prStarts')} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        <Input label={t('seller.prEnds')} type="datetime-local" value={ends} error={show('ends')} onChange={(e) => setEnds(e.target.value)} />
      </div>
      <Toggle checked={first} onChange={setFirst} label={t('seller.prFirstOrder')} />
      <Toggle checked={on} onChange={setOn} label={t('seller.prEnabled')} />
      <div className="sl-sheet-actions">
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={save.loading} onClick={() => void submit()}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
