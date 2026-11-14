/**
 * Chip: filter / option / variant selector. Selecting fires `selectionChanged()`.
 *   <Chip selected={size === 'M'} onClick={() => setSize('M')}>M</Chip>
 *   <Chip swatch="#b3263a" selected>Qizil</Chip>
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { haptic } from '../telegram/shim';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Colour swatch shown before the label. */
  swatch?: string | null;
  /** Visually struck through (sold-out variant value) but still focusable. */
  unavailable?: boolean;
  icon?: ReactNode;
}

export function Chip({ selected, swatch, unavailable, icon, className, children, onClick, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={rest.role ? undefined : !!selected}
      className={`chip${selected ? ' is-selected' : ''}${unavailable ? ' is-unavailable' : ''} ${className ?? ''}`}
      onClick={(e) => {
        haptic.selection();
        onClick?.(e);
      }}
      {...rest}
    >
      {swatch && <span className="chip-swatch" style={{ background: swatch }} aria-hidden="true" />}
      {icon}
      {children}
    </button>
  );
}
