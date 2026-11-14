/**
 * Variant picker: colour swatches and size chips with an availability matrix — sold-out and impossible
 * combinations stay visible, dimmed with a strike (§6.2 #5). The heading shows the current choice.
 */
import { forwardRef } from 'react';
import { useI18n } from '../../i18n';
import { Chip } from '../../ui';
import type { ProductOption } from '../lib/types';
import type { PickerState, Selection } from '../lib/variants';

interface Props {
  options: ProductOption[];
  selection: Selection;
  state: PickerState;
  onPick: (optionIndex: number, valueId: string) => void;
  /** Highlight options still to choose (after an add attempt). */
  nudge?: boolean;
}

export const VariantPicker = forwardRef<HTMLDivElement, Props>(function VariantPicker({ options, selection, state, onPick, nudge }, ref) {
  const { l, t } = useI18n();
  if (!options.length) return null;
  return (
    <div className="st-picker" ref={ref}>
      {options.map((o, oi) => {
        const chosen = o.values.find((v) => v.id === selection[oi]);
        const missing = nudge && !chosen;
        return (
          <fieldset key={o.id} className={`st-picker-opt${missing ? ' is-missing' : ''}`}>
            <legend>
              {l(o.name)}
              {chosen ? <b>{l(chosen.label)}</b> : <span className="st-picker-hint">{t('store.selectOption', { option: l(o.name).toLowerCase() })}</span>}
            </legend>
            <div className={`st-picker-values${o.display === 'swatch' ? ' is-swatch' : ''}`} role="radiogroup" aria-label={l(o.name)}>
              {o.values.map((v) => {
                const st = state.states[oi]?.[v.id] ?? 'available';
                const on = selection[oi] === v.id;
                const label = l(v.label);
                if (o.display === 'swatch' && v.swatchHex)
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${label}${st !== 'available' ? ` — ${t('store.outOfStock')}` : ''}`}
                      title={label}
                      className={`st-swatch${on ? ' is-on' : ''}${st !== 'available' ? ' is-off' : ''}`}
                      onClick={() => onPick(oi, v.id)}
                    >
                      <span style={{ background: v.swatchHex }} />
                    </button>
                  );
                return (
                  <Chip key={v.id} role="radio" aria-checked={on} selected={on} unavailable={st !== 'available'} onClick={() => onPick(oi, v.id)}>
                    {label}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
});
