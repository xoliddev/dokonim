/**
 * "Savat yoyi" — The Arc (§13.4). A 56px token of the product image flies along a ballistic parabola to the
 * cart icon as ONE pre-sampled WAAPI animation (compositor only, no React renders per frame), then the cart
 * icon squashes and stretches. Lite tier: the source pulses. Minimal: haptics only.
 *
 *   const cart = useCartTarget();                // on the cart tab icon:  <span ref={cart} />
 *   await flyToCart({ from: imgEl, imageUrl });  // in the add-to-cart handler
 *   shake(buttonEl);                             // out of stock
 */
import { useCallback } from 'react';
import { haptic } from '../telegram/shim';
import { cssEase, dur } from './tokens';
import { effectiveTier, type MotionTier } from './tier';

export interface Point {
  x: number;
  y: number;
}

/**
 * Projectile solution: x moves at constant speed, y follows a parabola whose apex is `apex` px above the higher
 * of the two points (screen y grows downward). Returns `samples` points from start to end inclusive.
 */
export function arcPath(from: Point, to: Point, samples = 16, apex = 120): Point[] {
  const d = to.y - from.y;
  const k = from.y - (Math.min(from.y, to.y) - apex); // > 0
  const a = d + 2 * k + 2 * Math.sqrt(k * (k + d));
  const b = d - a;
  const pts: Point[] = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    pts.push({ x: from.x + (to.x - from.x) * t, y: from.y + b * t + a * t * t });
  }
  return pts;
}

/** WAAPI keyframes for the token: translate along the arc, scale 1 → 0.32, rotate −14° → 0°. */
export function arcKeyframes(from: Point, to: Point, samples = 16): Keyframe[] {
  return arcPath(from, to, samples).map((p, i, all) => {
    const t = i / (all.length - 1);
    return {
      transform: `translate(${(p.x - from.x).toFixed(1)}px, ${(p.y - from.y).toFixed(1)}px) scale(${(1 - 0.68 * t).toFixed(3)}) rotate(${(-14 + 14 * t).toFixed(1)}deg)`,
      opacity: t > 0.92 ? 0.6 : 1,
      offset: t,
    };
  });
}

let cartTarget: HTMLElement | null = null;

/** Ref callback for the element the token lands on (the cart tab icon). */
export function useCartTarget() {
  return useCallback((el: HTMLElement | null) => {
    if (el) cartTarget = el;
    else if (cartTarget && !cartTarget.isConnected) cartTarget = null;
  }, []);
}

const centre = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const rectOf = (x: Element | DOMRect) => (x instanceof Element ? x.getBoundingClientRect() : x);

export function squash(el: Element | null) {
  el?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scaleX(1.18) scaleY(0.84)', offset: 0.25 }, { transform: 'scaleX(0.94) scaleY(1.06)', offset: 0.6 }, { transform: 'scale(1)' }],
    { duration: 420, easing: cssEase.standard },
  );
}

export function pulse(el: Element | null) {
  el?.animate([{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { duration: dur.sm * 1000, easing: cssEase.decel });
}

/** Error shake: 3 × 6px over 240ms, with the error haptic. */
export function shake(el: Element | null) {
  haptic.notify('error');
  if (effectiveTier() === 'minimal') return;
  el?.animate(
    [0, -6, 6, -6, 6, -6, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 240, easing: 'linear' },
  );
}

export interface FlyOpts {
  from: Element | DOMRect;
  imageUrl?: string;
  to?: Element | DOMRect | null;
  tier?: MotionTier;
}

/** Runs the add-to-cart flight. Resolves at landing (immediately in lite/minimal). */
export async function flyToCart(opts: FlyOpts): Promise<void> {
  const tier = opts.tier ?? effectiveTier();
  const target = opts.to ?? cartTarget;
  haptic.impact('light');
  if (tier === 'minimal' || !target) {
    haptic.impact('soft');
    return;
  }
  if (tier === 'lite') {
    if (opts.from instanceof Element) pulse(opts.from);
    squash(target instanceof Element ? target : null);
    haptic.impact('soft');
    return;
  }
  const a = centre(rectOf(opts.from));
  const b = centre(rectOf(target));
  const token = document.createElement('div');
  token.setAttribute('aria-hidden', 'true');
  Object.assign(token.style, {
    position: 'fixed', left: `${a.x - 28}px`, top: `${a.y - 28}px`, width: '56px', height: '56px', borderRadius: '50%', zIndex: '9999',
    pointerEvents: 'none', background: opts.imageUrl ? `center / cover no-repeat url("${opts.imageUrl.replace(/"/g, '%22')}")` : 'var(--c-accent)',
    boxShadow: '0 0 0 2px var(--c-surface-raised), 2px 3px 0 var(--c-print)', willChange: 'transform',
  });
  document.body.appendChild(token);
  const anim = token.animate(arcKeyframes(a, b), { duration: dur.arc * 1000, easing: 'linear', fill: 'forwards' });
  await anim.finished.catch(() => {});
  token.remove();
  squash(target instanceof Element ? target : null);
  haptic.impact('soft');
}
