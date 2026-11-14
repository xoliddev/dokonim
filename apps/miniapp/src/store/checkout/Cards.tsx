/** Checkout cards: delivery method + address / pickup point, payment method tiles. */
import { UZ_REGIONS } from '@dokonim/core';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../lib/i18n';
import { haptic } from '../../telegram/shim';
import { Chip, Icon, Input, type IconName } from '../../ui';
import type { Quote, ShippingOpt } from '../lib/types';

export interface AddressDraft {
  regionCode: string;
  district: string;
  line1: string;
  landmark: string;
  save: boolean;
}

export interface SavedAddress {
  id: string;
  label: string;
  regionCode: string;
  district: string;
  line1: string;
  landmark: string;
}

const METHOD_ICON: Record<string, IconName> = { courier: 'truck', post: 'box', pickup_point: 'store', self_pickup: 'store' };
export const needsAddress = (m: ShippingOpt | null | undefined) => !!m && (m.type === 'courier' || m.type === 'post');

export function DeliverySection({
  quote, methodId, onMethod, address, onAddress, pickupId, onPickup, errors,
}: {
  quote: Quote | undefined;
  methodId: string | null;
  onMethod: (id: string) => void;
  address: AddressDraft;
  onAddress: (a: AddressDraft) => void;
  pickupId: string | null;
  onPickup: (id: string) => void;
  errors: Record<string, string>;
}) {
  const { t, l, money, relativeDay, locale } = useI18n();
  const options = quote?.shippingOptions ?? [];
  const method = options.find((o) => o.methodId === methodId) ?? null;
  const saved = (quote?.prefill.addresses ?? []) as unknown as SavedAddress[];
  return (
    <>
      <label className="st-select">
        <span className="field-label">{t('checkout.region')}</span>
        <select value={address.regionCode} onChange={(e) => onAddress({ ...address, regionCode: e.target.value })}>
          {UZ_REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r[locale as 'uz']}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} />
      </label>
      {quote && !options.length && <p className="st-line-warn">{t('checkout.noShipping')}</p>}
      <div className={`st-methods${errors.method ? ' has-error' : ''}`} role="radiogroup" aria-label={t('checkout.deliveryMethod')} id="ck-method">
        {options.map((o) => {
          const on = o.methodId === methodId;
          const from = relativeDay(o.promise.from);
          const to = relativeDay(o.promise.to);
          return (
            <button key={o.methodId} type="button" role="radio" aria-checked={on} className={`st-tile${on ? ' is-on' : ''}`} onClick={() => (haptic.selection(), onMethod(o.methodId))}>
              <Icon name={METHOD_ICON[o.type] ?? 'truck'} size={22} />
              <span className="st-tile-main">
                <b>{l(o.name)}</b>
                <span>{from === to ? from : t('checkout.deliveryRange', { from, to })}</span>
              </span>
              <span className={`st-tile-side${o.amount === 0 ? ' is-free' : ''}`}>{o.amount === 0 ? t('checkout.free') : money(o.amount)}</span>
            </button>
          );
        })}
      </div>
      {errors.method && <p className="field-error">{errors.method}</p>}
      {needsAddress(method) && (
        <div className="st-stack" id="ck-address">
          {saved.length > 0 && (
            <div className="st-chips">
              {saved.map((a) => (
                <Chip
                  key={a.id}
                  icon={<Icon name="home" size={14} />}
                  selected={a.line1 === address.line1 && a.regionCode === address.regionCode}
                  onClick={() => onAddress({ regionCode: a.regionCode, district: a.district ?? '', line1: a.line1, landmark: a.landmark ?? '', save: false })}
                >
                  {a.label || a.line1}
                </Chip>
              ))}
            </div>
          )}
          <Input label={t('checkout.addressLine')} value={address.line1} onChange={(e) => onAddress({ ...address, line1: e.target.value })} autoComplete="street-address" error={errors.address} maxLength={200} />
          <div className="st-two">
            <Input label={t('checkout.district')} value={address.district} onChange={(e) => onAddress({ ...address, district: e.target.value })} maxLength={80} />
            <Input label={t('checkout.landmark')} value={address.landmark} onChange={(e) => onAddress({ ...address, landmark: e.target.value })} maxLength={200} />
          </div>
          <label className="st-check">
            <input type="checkbox" checked={address.save} onChange={(e) => onAddress({ ...address, save: e.target.checked })} />
            {t('checkout.saveAddress')}
          </label>
        </div>
      )}
      {method?.type === 'pickup_point' && method.pickupPoints.length > 0 && (
        <div className="st-methods" role="radiogroup" aria-label={t('checkout.pickupChoose')} id="ck-pickupPoint">
          {method.pickupPoints.map((pp) => (
            <button key={pp.id} type="button" role="radio" aria-checked={pickupId === pp.id} className={`st-tile is-sub${pickupId === pp.id ? ' is-on' : ''}`} onClick={() => (haptic.selection(), onPickup(pp.id))}>
              <Icon name="store" size={20} />
              <span className="st-tile-main">
                <b>{l(pp.name)}</b>
                <span>
                  {pp.address}
                  {pp.hours ? ` · ${pp.hours}` : ''}
                </span>
              </span>
            </button>
          ))}
          {errors.pickupPoint && <p className="field-error">{errors.pickupPoint}</p>}
        </div>
      )}
    </>
  );
}

const PAY_MARK: Record<string, string> = { payme: 'P', click: 'C', uzum: 'U', stars: '★', telegram: 'T', cod: '₸', bank_transfer: 'B', paynet: 'N', stripe: 'S' };

export function PaymentSection({ methods, value, onChange, error }: { methods: Quote['paymentMethods']; value: string | null; onChange: (p: string) => void; error?: string }) {
  const { t } = useI18n();
  return (
    <div className={`st-methods is-pay${error ? ' has-error' : ''}`} role="radiogroup" aria-label={t('checkout.paymentMethod')} id="ck-payment">
      {methods.map((m) => {
        const on = m.provider === value;
        const desc = m.provider === 'cod' || m.provider === 'bank_transfer' ? t('checkout.payDescCod') : m.provider === 'stars' ? t('checkout.payDescStars') : t('checkout.payDescOnline');
        return (
          <button key={m.provider} type="button" role="radio" aria-checked={on} className={`st-tile${on ? ' is-on' : ''}`} onClick={() => (haptic.selection(), onChange(m.provider))}>
            <span className={`st-paymark is-${m.provider}`} aria-hidden="true">
              {PAY_MARK[m.provider] ?? '•'}
            </span>
            <span className="st-tile-main">
              <b>{t(`checkout.pay_${m.provider}` as MessageKey)}</b>
              <span>{desc}</span>
            </span>
            {m.mode === 'sandbox' && m.provider !== 'cod' && <span className="st-badge is-sandbox">{t('checkout.sandboxShort')}</span>}
          </button>
        );
      })}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
