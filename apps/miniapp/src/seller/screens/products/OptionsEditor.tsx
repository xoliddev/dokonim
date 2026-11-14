/**
 * Options editor (≤ 3): name + value chips (type and press Enter / comma), colour swatches, quick presets
 * (Size, Colour). Every change regenerates the matrix through `regenerate()` in the parent.
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { MAX_OPTIONS } from '@dokonim/core';
import { useI18n } from '../../../i18n';
import { spring } from '../../../motion';
import { haptic } from '../../../telegram/shim';
import { Input } from '../../../ui';
import { Toggle } from '../../components/Controls';
import { SIcon } from '../../components/SIcon';
import { uid } from '../../lib/ctx';
import type { OptionDraft } from '../../lib/product';

const SIZE_PRESET = ['S', 'M', 'L'];
const COLOR_PRESET: Array<[Record<string, string>, string]> = [
  [{ uz: 'Qizil', ru: 'Красный', en: 'Red' }, '#c0392b'],
  [{ uz: 'Koʻk', ru: 'Синий', en: 'Blue' }, '#1f4fa8'],
];
/** Rough colour guess from a label so swatches start sensible ("qizil" → red). */
const GUESS: Array<[RegExp, string]> = [
  [/qizil|красн|red/i, '#c0392b'], [/koʻk|kok|син|blue/i, '#1f4fa8'], [/yashil|зел|green/i, '#1f6e5a'], [/sariq|жёлт|желт|yellow/i, '#d9a21b'],
  [/qora|чёрн|черн|black/i, '#1d1a16'], [/oq|бел|white/i, '#f4efe6'], [/binafsha|фиол|purple/i, '#6b4fd8'], [/pushti|розов|pink/i, '#e07aa3'], [/kulrang|сер|gr[ae]y/i, '#8a8580'],
];
const guessHex = (label: string) => GUESS.find(([re]) => re.test(label))?.[1] ?? '#a3195b';

export function OptionsEditor({ options, onChange, error }: { options: OptionDraft[]; onChange: (o: OptionDraft[]) => void; error?: string }) {
  const { t, locale } = useI18n();
  const set = (i: number, patch: Partial<OptionDraft>) => onChange(options.map((o, k) => (k === i ? { ...o, ...patch } : o)));
  const add = (kind: 'size' | 'color' | 'other') => {
    if (options.length >= MAX_OPTIONS) return;
    haptic.impact('light');
    const o: OptionDraft =
      kind === 'size'
        ? { id: uid(), name: t('seller.optionSize'), display: 'chips', values: SIZE_PRESET.map((label) => ({ id: uid(), label, swatchHex: null })) }
        : kind === 'color'
          ? { id: uid(), name: t('seller.optionColor'), display: 'swatch', values: COLOR_PRESET.map(([l, hex]) => ({ id: uid(), label: l[locale] ?? l.uz!, swatchHex: hex })) }
          : { id: uid(), name: '', display: 'chips', values: [] };
    onChange([...options, o]);
  };
  return (
    <div className="oe">
      <AnimatePresence initial={false}>
        {options.map((o, i) => (
          <m.div key={o.id} className="oe-card" layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={spring.snappy}>
            <div className="oe-head">
              <Input label={t('seller.optName')} value={o.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} />
              <button type="button" className="sl-icon-btn is-plain oe-remove" aria-label={t('seller.optRemove')} onClick={() => onChange(options.filter((_, k) => k !== i))}>
                <SIcon name="trash" size={18} />
              </button>
            </div>
            <ValueChips option={o} onChange={(values) => set(i, { values })} />
            <Toggle checked={o.display === 'swatch'} onChange={(v) => set(i, { display: v ? 'swatch' : 'chips', values: v ? o.values.map((x) => ({ ...x, swatchHex: x.swatchHex ?? guessHex(x.label) })) : o.values })} label={t('seller.optAsSwatch')} />
          </m.div>
        ))}
      </AnimatePresence>
      {error && <p className="field-error" role="alert">{error}</p>}
      {options.length < MAX_OPTIONS ? (
        <div className="oe-add">
          {!options.some((o) => o.display === 'chips' && o.name === t('seller.optionSize')) && <button type="button" className="chip" onClick={() => add('size')}>{t('seller.optAddSize')}</button>}
          {!options.some((o) => o.display === 'swatch') && <button type="button" className="chip" onClick={() => add('color')}>{t('seller.optAddColor')}</button>}
          <button type="button" className="chip" onClick={() => add('other')}>{t('seller.optAddOther')}</button>
        </div>
      ) : (
        <p className="sl-hint">{t('seller.optLimit')}</p>
      )}
    </div>
  );
}

function ValueChips({ option, onChange }: { option: OptionDraft; onChange: (v: OptionDraft['values']) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const commit = (raw = text) => {
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const have = new Set(option.values.map((v) => v.label.toLowerCase()));
    const fresh = parts.filter((p) => !have.has(p.toLowerCase())).map((label) => ({ id: uid(), label, swatchHex: option.display === 'swatch' ? guessHex(label) : null }));
    if (fresh.length) haptic.selection();
    onChange([...option.values, ...fresh].slice(0, 100));
    setText('');
  };
  return (
    <div className="oe-values">
      <AnimatePresence initial={false}>
        {option.values.map((v) => (
          <m.span key={v.id} className="oe-value" layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring.bouncy}>
            {option.display === 'swatch' && (
              <label className="oe-swatch" style={{ background: v.swatchHex ?? '#ccc' }}>
                <input type="color" value={v.swatchHex ?? '#cccccc'} aria-label={v.label} onChange={(e) => onChange(option.values.map((x) => (x.id === v.id ? { ...x, swatchHex: e.target.value } : x)))} />
              </label>
            )}
            <input className="oe-value-input" value={v.label} size={Math.max(2, v.label.length)} aria-label={t('seller.optValuePh')} onChange={(e) => onChange(option.values.map((x) => (x.id === v.id ? { ...x, label: e.target.value } : x)))} />
            <button type="button" className="oe-x" aria-label={t('common.delete')} onClick={() => onChange(option.values.filter((x) => x.id !== v.id))}>
              <SIcon name="close" size={14} />
            </button>
          </m.span>
        ))}
      </AnimatePresence>
      <input
        className="oe-new"
        value={text}
        placeholder={t('seller.optValuePh')}
        onChange={(e) => (e.target.value.includes(',') ? commit(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={() => commit()}
      />
    </div>
  );
}
