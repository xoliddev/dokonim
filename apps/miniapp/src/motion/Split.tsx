/**
 * "Boʻlib toʻlash" — The Split (§13.6). Chips [Toʻliq][3 oy][6 oy][12 oy]. Picking a plan makes the full price
 * shrink to 40% on the line above while N segment pills fan out (30 ms stagger) and the monthly amount rolls in.
 * The total payable stays visible. Lite/minimal: numbers crossfade only.
 *
 *   <InstallmentSplit price={variant.price} plans={store.installments} />
 */
import { useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { installment, type InstallmentPlan } from '@dokonim/core';
import { useI18n } from '../i18n';
import { haptic } from '../telegram/shim';
import { Chip } from '../ui/Chip';
import { Odometer } from './Odometer';
import { useMotionTier } from './tier';
import { dur, ease, spring } from './tokens';

export interface SplitProps {
  /** Price in minor units. */
  price: number;
  plans: InstallmentPlan[];
  /** Controlled selection: 0 = full price, otherwise months. */
  months?: number;
  onChange?: (months: number) => void;
}

export function InstallmentSplit({ price, plans, months: controlled, onChange }: SplitProps) {
  const { t, money } = useI18n();
  const tier = useMotionTier();
  const [own, setOwn] = useState(0);
  const months = controlled ?? own;
  const plan = plans.find((p) => p.months === months);
  const calc = plan ? installment(price, plan) : null;
  const fancy = tier === 'full';

  const select = (mo: number) => {
    haptic.selection();
    setOwn(mo);
    onChange?.(mo);
  };

  return (
    <div className="split">
      <div className="split-figures" aria-live="polite">
        <m.div
          className="price split-full"
          animate={calc ? { scale: 0.62, opacity: 0.4, y: -2 } : { scale: 1, opacity: 1, y: 0 }}
          transition={fancy ? spring.snappy : { duration: dur.sm }}
          style={{ originX: 0 }}
        >
          {money(price)}
        </m.div>
        <AnimatePresence initial={false} mode="popLayout">
          {calc && (
            <m.div key="monthly" className="price split-monthly" initial={{ opacity: 0, y: fancy ? 10 : 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur.md, ease: ease.decel }}>
              <Odometer value={t('store.perMonth', { amount: money(calc.monthly) })} />
            </m.div>
          )}
        </AnimatePresence>
      </div>
      {calc && fancy && (
        <div className="split-bar" aria-hidden="true">
          {Array.from({ length: months }, (_, i) => (
            <m.span key={`${months}-${i}`} className="split-seg" initial={{ opacity: 0, x: -12 * (i + 1), scaleX: 0.4 }} animate={{ opacity: 1, x: 0, scaleX: 1 }} transition={{ ...spring.snappy, delay: i * 0.03 }} />
          ))}
        </div>
      )}
      {calc && <div className="split-total muted">{t('store.installmentTotal', { amount: money(calc.totalPayable) })}</div>}
      <div className="split-chips" role="radiogroup">
        <Chip selected={months === 0} onClick={() => select(0)} role="radio" aria-checked={months === 0}>
          {t('store.payInFull')}
        </Chip>
        {plans.map((p) => (
          <Chip key={p.months} selected={months === p.months} onClick={() => select(p.months)} role="radio" aria-checked={months === p.months}>
            {t('store.months', { n: p.months })}
          </Chip>
        ))}
      </div>
    </div>
  );
}
