/** Wizard steps 3–5: brand (logo → palette, colour, font, layout preset), first product, payments. */
import { useRef } from 'react';
import { m } from 'motion/react';
import { FONT_PAIRS, paletteFromPixels, PRESETS, presetsFor, type FontPairId } from '@dokonim/core';
import type { MessageKey } from '@dokonim/i18n';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Button, Chip, Input, toast } from '../../../ui';
import { ART_FOR, artImage } from '../../lib/art';
import { fileToDataUrl } from '../../lib/ctx';
import { MoneyInput, Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import { withPreset, type WizardDraft } from './draft';

type Set = (fn: (d: WizardDraft) => WizardDraft) => void;

async function paletteOf(url: string): Promise<string[]> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, 48, 48);
  return paletteFromPixels(ctx.getImageData(0, 0, 48, 48).data, 5);
}

export function Swatch({ hex, on, onPick, label }: { hex: string; on: boolean; onPick: () => void; label?: string }) {
  return (
    <button type="button" className={`wz-swatch${on ? ' is-on' : ''}`} style={{ background: hex }} aria-label={label ?? hex} aria-pressed={on} onClick={() => { haptic.selection(); onPick(); }}>
      {on && <m.span className="wz-swatch-ring" layoutId="wz-swatch-ring" transition={spring.bouncy} />}
    </button>
  );
}

export function StepBrand({ d, set }: { d: WizardDraft; set: Set }) {
  const { t } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const presetBrands = [...new Set(PRESETS.map((p) => p.tokens.brand))];
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const url = await fileToDataUrl(f, 256, 0.9);
      const palette = await paletteOf(url).catch(() => []);
      set((x) => ({ ...x, logoUrl: url, palette, brand: palette[0] ?? x.brand }));
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  };
  return (
    <div className="wz-step-body">
      <div className="wz-logo-row">
        <span className="wz-logo">{d.logoUrl ? <img src={d.logoUrl} alt="" /> : <SIcon name="image" size={26} />}</span>
        <div className="wz-logo-actions">
          <span className="wz-label">{t('seller.wzLogo')} <span className="muted">· {t('common.optional')}</span></span>
          <div className="wz-row-gap">
            <Button size="sm" variant="secondary" icon={<SIcon name="upload" size={18} />} onClick={() => file.current?.click()}>
              {d.logoUrl ? t('seller.wzLogoChange') : t('seller.wzLogoUpload')}
            </Button>
            {d.logoUrl && (
              <Button size="sm" variant="ghost" onClick={() => set((x) => ({ ...x, logoUrl: null, palette: [] }))}>
                {t('seller.wzLogoRemove')}
              </Button>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      {d.palette.length > 0 && (
        <div className="wz-field">
          <span className="wz-label">{t('seller.wzFromLogo')}</span>
          <div className="wz-swatches">
            {d.palette.map((h) => <Swatch key={`p${h}`} hex={h} on={d.brand === h} onPick={() => set((x) => ({ ...x, brand: h }))} />)}
          </div>
        </div>
      )}
      <div className="wz-field">
        <span className="wz-label">{t('seller.wzColors')}</span>
        <div className="wz-swatches">
          {presetBrands.map((h) => <Swatch key={h} hex={h} on={d.brand === h} onPick={() => set((x) => ({ ...x, brand: h }))} />)}
          <label className="wz-swatch wz-swatch-custom" title={t('seller.wzCustomColor')}>
            <SIcon name="palette" size={18} />
            <input type="color" value={d.brand} aria-label={t('seller.wzCustomColor')} onChange={(e) => set((x) => ({ ...x, brand: e.target.value }))} />
          </label>
        </div>
      </div>
      <div className="wz-field">
        <span className="wz-label">{t('seller.font')}</span>
        <div className="wz-fonts">
          {(Object.keys(FONT_PAIRS) as FontPairId[]).map((f) => (
            <Chip key={f} selected={d.fontPair === f} onClick={() => set((x) => ({ ...x, fontPair: f }))}>
              <span style={{ fontFamily: FONT_PAIRS[f].display }}>{FONT_PAIRS[f].label}</span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="wz-field">
        <span className="wz-label">{t('seller.wzLayout')}</span>
        <div className="wz-presets">
          {presetsFor(d.businessType).slice(0, 6).map((p) => (
            <button key={p.id} type="button" className={`wz-preset${d.presetId === p.id ? ' is-on' : ''}`} aria-pressed={d.presetId === p.id} onClick={() => { haptic.selection(); set((x) => withPreset(x, p.id)); }}>
              <span className="wz-preset-chip" style={{ background: p.tokens.brand }} data-mode={p.tokens.mode} />
              <span className="wz-preset-name">{p.name}</span>
              <span className="wz-preset-meta">{p.tokens.cardStyle}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StepFirst({ d, set }: { d: WizardDraft; set: Set }) {
  const { t } = useI18n();
  const kinds = ART_FOR[d.businessType] ?? ART_FOR.clothing!;
  const setFirst = (patch: Partial<WizardDraft['first']>) => set((x) => ({ ...x, first: { ...x.first, ...patch } }));
  const priceErr = d.first.title.trim() && (d.first.price == null || !Number.isFinite(d.first.price) || d.first.price <= 0) ? t('seller.priceRequired') : undefined;
  return (
    <div className="wz-step-body">
      <div className="wz-art-row" role="radiogroup" aria-label={t('seller.photos')}>
        {kinds.map((k) => {
          const url = artImage(k, d.brand, 'ikat');
          const on = d.first.imageUrl === url;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} className={`wz-art${on ? ' is-on' : ''}`} onClick={() => { haptic.selection(); setFirst({ imageUrl: on ? null : url }); }}>
              <img src={url} alt={k} />
            </button>
          );
        })}
      </div>
      <Input label={t('seller.productTitle')} value={d.first.title} maxLength={120} onChange={(e) => setFirst({ title: e.target.value })} />
      <MoneyInput label={t('seller.price')} value={d.first.price} onChange={(v) => setFirst({ price: v })} error={priceErr} />
    </div>
  );
}

export function StepPay({ d, set }: { d: WizardDraft; set: Set }) {
  const { t } = useI18n();
  const rows: Array<{ key: keyof WizardDraft['payments']; id: string; sandbox?: boolean }> = [
    { key: 'cod', id: 'cod' },
    { key: 'sandboxPayme', id: 'payme', sandbox: true },
    { key: 'sandboxClick', id: 'click', sandbox: true },
    { key: 'stars', id: 'stars' },
  ];
  return (
    <div className="wz-step-body">
      <div className="wz-pay-list">
        {rows.map((r) => (
          <div key={r.key} className={`wz-pay${d.payments[r.key] ? ' is-on' : ''}`}>
            <span className={`wz-pay-logo pay-${r.id}`}>{r.id === 'cod' ? <SIcon name="wallet" size={20} /> : r.id.slice(0, 1).toUpperCase()}</span>
            <Toggle
              checked={d.payments[r.key]}
              onChange={(v) => set((x) => ({ ...x, payments: { ...x.payments, [r.key]: v } }))}
              label={<>{t(`seller.pay_${r.id}` as MessageKey)}{r.sandbox && <span className="sl-pill is-warn wz-sandbox">sandbox</span>}</>}
              hint={t(`seller.payHint_${r.id}` as MessageKey)}
            />
          </div>
        ))}
      </div>
      <p className="sl-hint">{t('seller.wzPayLater')}</p>
    </div>
  );
}
