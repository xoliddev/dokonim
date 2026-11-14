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

type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
type VTDoc = Document & { startViewTransition?: (cb: () => void) => VT };
const vtSupported = () => typeof document !== 'undefined' && typeof (document as VTDoc).startViewTransition === 'function';

/** Decided once per render tree: VT names in the full tier with support, Motion layoutId otherwise. */
const useVT = () => useMotionTier() === 'full' && vtSupported();

/**
 * Chrome aborts a View Transition when two elements share a `view-transition-name`. That happens twice here:
 * a product can appear on one screen more than once (two rails), and right after the swap the router keeps the
 * leaving screen in the DOM (AnimatePresence popLayout), so the old card and the new hero carry the same name.
 * For every duplicated name this keeps one copy (the `keep` element, else the first one) and strips the rest.
 */
export function dedupeViewTransitionNames(keep: (el: HTMLElement) => boolean = () => false): Array<[HTMLElement, string]> {
  const stripped: Array<[HTMLElement, string]> = [];
  const byName = new Map<string, HTMLElement[]>();
  for (const el of document.querySelectorAll<HTMLElement>('.morph-media')) {
    const name = el.style.viewTransitionName;
    if (!name || name === 'none') continue;
    byName.set(name, [...(byName.get(name) ?? []), el]);
  }
  for (const els of byName.values()) {
    if (els.length < 2) continue;
    const winner = els.find(keep) ?? els[0];
    for (const el of els) {
      if (el === winner) continue;
      stripped.push([el, el.style.viewTransitionName]);
      el.style.viewTransitionName = 'none';
    }
  }
  return stripped;
}

/** The element currently on screen: inside the router screen for the current path, not a leaving one. */
const onCurrentScreen = (el: HTMLElement) => !!el.closest('.screen:not([data-leaving])');

/**
 * Navigates with a shared-element morph. `from` is the tapped card's media, which wins over other copies of the
 * same product on the old screen; after the swap the copy on the new screen wins over the leaving one.
 */
export function morphNavigate(to: string, opts: { replace?: boolean; from?: Element | null } = {}) {
  const doc = document as VTDoc;
  if (effectiveTier() !== 'full' || !vtSupported()) return navigate(to, opts);
  const from = opts.from instanceof HTMLElement ? (opts.from.closest('.morph-media') ?? opts.from.querySelector('.morph-media') ?? opts.from) : null;
  const stripped = dedupeViewTransitionNames((el) => el === from);
  const vt = doc.startViewTransition!(() => {
    flushSync(() => navigate(to, opts));
    stripped.push(...dedupeViewTransitionNames((el) => el !== from && onCurrentScreen(el)));
  });
  // React does not re-apply an unchanged inline style, so give surviving copies their names back afterwards
  const restore = () => {
    for (const [el, name] of stripped) if (el.isConnected && onCurrentScreen(el)) el.style.viewTransitionName = name;
  };
  // a skipped transition (hidden tab, a newer navigation) is not an error
  vt.ready?.catch(() => {});
  vt.updateCallbackDone?.catch(() => {});
  (vt.finished ?? Promise.resolve()).then(restore, restore);
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
