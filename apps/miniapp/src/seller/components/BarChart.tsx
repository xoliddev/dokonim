/**
 * Tiny 7-day revenue chart: bars grow from the baseline (scaleY, staggered), today's bar is the accent,
 * the rest are ink at low opacity. Tapping a bar shows its value. Pure SVG + transform animation.
 */
import { useState } from 'react';
import { m } from 'motion/react';
import { spring, staggerDelay, useMotionTier } from '../../motion';
import { haptic } from '../../telegram/shim';

export function BarChart({ values, labels, format, height = 72 }: { values: number[]; labels: string[]; format: (v: number) => string; height?: number }) {
  const tier = useMotionTier();
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const shown = sel ?? values.length - 1;
  return (
    <div className="sl-chart">
      <div className="sl-chart-tip" aria-live="polite">
        <span className="muted">{labels[shown]}</span> <strong>{format(values[shown] ?? 0)}</strong>
      </div>
      <div className="sl-chart-bars" style={{ height }}>
        {values.map((v, i) => {
          const h = Math.max(3, (v / max) * height);
          const today = i === values.length - 1;
          return (
            <button
              key={i}
              type="button"
              className={`sl-chart-col${shown === i ? ' is-sel' : ''}`}
              aria-label={`${labels[i]}: ${format(v)}`}
              onClick={() => {
                haptic.selection();
                setSel(i === sel ? null : i);
              }}
            >
              <m.span
                className={`sl-chart-bar${today ? ' is-today' : ''}`}
                style={{ height: h }}
                initial={tier === 'minimal' ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ ...spring.snappy, delay: staggerDelay(i, 0.1) }}
              />
            </button>
          );
        })}
      </div>
      <div className="sl-chart-axis">
        {labels.map((l, i) => (
          <span key={i}>{l.slice(0, 2)}</span>
        ))}
      </div>
    </div>
  );
}
