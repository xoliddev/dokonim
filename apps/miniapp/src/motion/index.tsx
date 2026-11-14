/**
 * Motion system entry. <MotionRoot> loads Motion lazily (LazyMotion + `m`, §13.1) with the domMax feature set
 * (needed for layoutId morphs), respects prefers-reduced-motion via MotionConfig, and switches to opacity-only
 * in the minimal tier.
 */
import type { ReactNode } from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';
import { useMotionTier } from './tier';

const loadFeatures = () => import('./features').then((r) => r.default);

export function MotionRoot({ children }: { children: ReactNode }) {
  const tier = useMotionTier();
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion={tier === 'minimal' ? 'always' : 'user'}>{children}</MotionConfig>
    </LazyMotion>
  );
}

export * from './tokens';
export * from './tier';
export { arcKeyframes, arcPath, flyToCart, pulse, shake, squash, useCartTarget } from './arc';
export { DismissablePage, MorphContent, MorphMedia, morphNavigate } from './Continuity';
export { InstallmentSplit } from './Split';
export { Odometer } from './Odometer';
export { Reveal, Stagger, PageTransition } from './Reveal';
