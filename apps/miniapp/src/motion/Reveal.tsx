/** Supporting motions (§13.7): enter reveal, list stagger, and the route-level shared-axis transition. */
import { Children, type ReactNode } from 'react';
import { m } from 'motion/react';
import { useMotionTier } from './tier';
import { dur, ease, staggerDelay } from './tokens';

/** Fade-and-rise on mount (y 12 → 0). Opacity only in the minimal tier. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const tier = useMotionTier();
  return (
    <m.div className={className} initial={{ opacity: 0, y: tier === 'minimal' ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: tier === 'minimal' ? dur.sm : dur.md, delay, ease: ease.decel }}>
      {children}
    </m.div>
  );
}

/** Wraps each child in a Reveal with the 24 ms / max-8 stagger. */
export function Stagger({ children, className, itemClassName }: { children: ReactNode; className?: string; itemClassName?: string }) {
  return (
    <div className={className}>
      {Children.toArray(children).map((child, i) => (
        <Reveal key={(child as { key?: string }).key ?? i} delay={staggerDelay(i)} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}

/** Route transition: shared-axis X (±24px + fade, 220 ms) in full, crossfade in lite, opacity-only in minimal. */
export function PageTransition({ children, direction, className }: { children: ReactNode; direction: 'forward' | 'back' | 'none'; className?: string }) {
  const tier = useMotionTier();
  const dx = tier === 'full' && direction !== 'none' ? (direction === 'forward' ? 24 : -24) : 0;
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, x: dx }}
      animate={{ opacity: 1, x: 0, transition: { duration: tier === 'minimal' ? dur.sm : dur.md, ease: ease.decel } }}
      exit={{ opacity: 0, x: -dx, transition: { duration: dur.sm, ease: ease.accel } }}
    >
      {children}
    </m.div>
  );
}
