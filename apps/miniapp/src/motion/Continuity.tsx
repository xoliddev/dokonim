/**
 * "Uzluksiz" — Continuity (§13.5): grid card ↔ product page morph with drag-to-dismiss.
 *
 *   // grid card and PDP hero both render the same id:
 *   <MorphMedia id={product.id} src={cover} alt={title} />
 *   // open with a morph (View Transitions in the full tier when supported, else Motion layoutId):
 *   morphNavigate(`/s/${slug}/p/${product.id}`);
 *   // PDP root: drag down (or swipe from the left edge) to fly back into the card:
 *   <DismissablePage onDismiss={() => back(`/s/${slug}`)}>…</DismissablePage>
 *
 * Telegram's own vertical swipe closes the Mini App, so DismissablePage disables it while mounted.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { m, useMotionValue, useTransform, type PanInfo } from 'motion/react';
import { navigate } from '../router/router';
import { tg } from '../telegram/shim';
import { effectiveTier, useMotionTier } from './tier';
import { dur, spring } from './tokens';

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
const vtSupported = () => typeof document !== 'undefined' && typeof (document as VTDoc).startViewTransition === 'function';

/** Decided once per render tree: VT names in the full tier with support, Motion layoutId otherwise. */
const useVT = () => useMotionTier() === 'full' && vtSupported();

export function morphNavigate(to: string, opts: { replace?: boolean } = {}) {
  const doc = document as VTDoc;
  if (effectiveTier() === 'full' && vtSupported()) doc.startViewTransition!(() => flushSync(() => navigate(to, opts)));
  else navigate(to, opts);
}

export interface MorphMediaProps {
  id: string;
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
  /** Corner radius while in the grid (morphs to `radiusTo` on the PDP). */
  radius?: number;
  priority?: boolean;
}

export function MorphMedia({ id, src, alt, className, style, radius = 14, priority }: MorphMediaProps) {
  const vt = useVT();
  const tier = useMotionTier();
  const common = { className: `morph-media ${className ?? ''}`, src, alt, draggable: false, loading: priority ? ('eager' as const) : ('lazy' as const), decoding: 'async' as const };
  if (vt) return <img {...common} style={{ ...style, borderRadius: radius, viewTransitionName: `product-${id}` } as CSSProperties} />;
  if (tier === 'minimal') return <img {...common} style={{ ...style, borderRadius: radius }} />;
  return <m.img {...common} layoutId={`product-${id}`} transition={spring.morph} style={{ ...style, borderRadius: radius }} />;
}

export interface DismissProps {
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
}

/** Page wrapper with drag-to-dismiss: follows the finger 1:1, scales 1 − dy/1200 (≥ 0.82), releases past 120px or 800px/s. */
export function DismissablePage({ onDismiss, children, className }: DismissProps) {
  const tier = useMotionTier();
  const y = useMotionValue(0);
  const x = useMotionValue(0);
  const scale = useTransform([y, x], ([dy, dx]: number[]) => Math.max(0.82, 1 - Math.max(dy!, dx!, 0) / 1200));
  const radius = useTransform(scale, (s) => (1 - s) * 120);

  useEffect(() => {
    tg.setVerticalSwipes(false);
    return () => tg.setVerticalSwipes(true);
  }, []);

  const end = (_: unknown, info: PanInfo) => {
    const dy = info.offset.y;
    const dx = info.offset.x;
    if (dy > 120 || info.velocity.y > 800 || dx > 120 || info.velocity.x > 800) onDismiss();
  };

  if (tier === 'minimal') return <div className={className}>{children}</div>;
  return (
    <m.div
      className={className}
      drag
      dragDirectionLock
      dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
      dragElastic={{ top: 0, left: 0, right: 1, bottom: 1 }}
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: spring.sheet.stiffness, bounceDamping: spring.sheet.damping }}
      onDragEnd={end}
      style={{ x, y, scale, borderRadius: radius, overflow: 'hidden', touchAction: 'pan-y' }}
    >
      {children}
    </m.div>
  );
}

/** Content that enters after the morph: y 16 → 0, opacity 0 → 1, starting at +120 ms, 24 ms stagger. */
export function MorphContent({ index = 0, children, className }: { index?: number; children: ReactNode; className?: string }) {
  const tier = useMotionTier();
  if (tier === 'minimal') return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.md, delay: 0.12 + Math.min(index, 8) * 0.024 }}>
      {children}
    </m.div>
  );
}
