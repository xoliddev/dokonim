/**
 * Odometer: digits roll (translateY inside a 1-em mask, 260 ms) when the value changes — used by the cart badge
 * and The Split's monthly amount. Pure CSS transitions, so reduced-motion/minimal tiers collapse to a swap.
 */
import type { CSSProperties } from 'react';

const DIGITS = '0123456789';

export function Odometer({ value, className, style, label }: { value: string | number; className?: string; style?: CSSProperties; label?: string }) {
  const s = String(value);
  const chars = [...s];
  return (
    <span className={`odo ${className ?? ''}`} style={style} aria-label={label ?? s} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i; // align from the right so units keep their slot
        const d = DIGITS.indexOf(ch);
        if (d < 0)
          return (
            <span key={`s${key}`} className="odo-static" aria-hidden="true">
              {ch}
            </span>
          );
        return (
          <span key={`d${key}`} className="odo-slot" aria-hidden="true">
            <span className="odo-col" style={{ transform: `translateY(${-d}em)` }}>
              {DIGITS.split('').map((x) => (
                <span key={x}>{x}</span>
              ))}
            </span>
            <span className="odo-sizer">0</span>
          </span>
        );
      })}
    </span>
  );
}
