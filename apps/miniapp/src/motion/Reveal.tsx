/** Supporting motions (§13.7): enter reveal, list stagger, and the route-level shared-axis transition. */
import { Children, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { m, PresenceContext, useIsPresent } from 'motion/react';
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

/** Longest a leaving screen may stay in the DOM before it is hidden outright (exit is dur.sm). */
export const EXIT_WATCHDOG_MS = 900;

/**
 * Route transition: shared-axis X (±24px + fade, 220 ms) in full, crossfade in lite, opacity-only in minimal.
 *
 * Exits are made robust in three ways, because a frozen exit leaves an invisible screen on top that eats clicks:
 * 1. The screen's subtree gets a `null` PresenceContext, so only this wrapper takes part in the exit. Otherwise every
 *    layout element below (a shared `layoutId` tab ink, a `MorphMedia` in the lite tier) registers with the router's
 *    AnimatePresence and holds removal until its projection settles, which can never happen once the new screen took
 *    the shared id. Shared ids still morph across screens: the new element simply becomes the stack lead.
 * 2. A leaving screen is `inert` and ignores the pointer from its first exit frame.
 * 3. A watchdog hides it (`display: none`) if it is somehow still mounted after EXIT_WATCHDOG_MS.
 */
export function PageTransition({ children, direction, className, path }: { children: ReactNode; direction: 'forward' | 'back' | 'none'; className?: string; path?: string }) {
  const tier = useMotionTier();
  const present = useIsPresent();
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (present) return;
    const t = setTimeout(() => setStuck(true), EXIT_WATCHDOG_MS);
    return () => clearTimeout(t);
  }, [present]);
  const dx = tier === 'full' && direction !== 'none' ? (direction === 'forward' ? 24 : -24) : 0;
  const style: CSSProperties | undefined = present ? undefined : { pointerEvents: 'none', ...(stuck ? { display: 'none' } : null) };
  return (
    <m.div
      className={className}
      data-path={path}
      data-leaving={present ? undefined : ''}
      inert={!present}
      aria-hidden={present ? undefined : true}
      style={style}
      initial={{ opacity: 0, x: dx }}
      animate={{ opacity: 1, x: 0, transition: { duration: tier === 'minimal' ? dur.sm : dur.md, ease: ease.decel } }}
      exit={{ opacity: 0, x: -dx, transition: { duration: dur.sm, ease: ease.accel } }}
    >
      <PresenceContext.Provider value={null}>{children}</PresenceContext.Provider>
    </m.div>
  );
}
