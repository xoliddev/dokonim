/**
 * Motion tiers (§13.3): full / lite / minimal. Detection is low-end-Android first: Telegram's performance class
 * from the UA, deviceMemory, CPU count, Data Saver and prefers-reduced-motion. A 1-second FPS probe can only
 * downgrade. The store owner's `motion: calm` caps the tier at `lite`; the demo bar can override it.
 */
import { createStore, local, useStore } from '../lib/store';

export type MotionTier = 'full' | 'lite' | 'minimal';
const RANK: Record<MotionTier, number> = { minimal: 0, lite: 1, full: 2 };
export const minTier = (a: MotionTier, b: MotionTier): MotionTier => (RANK[a] <= RANK[b] ? a : b);

interface NavLike {
  userAgent: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

export function detectTier(nav: NavLike, reducedMotion: boolean): MotionTier {
  if (reducedMotion || nav.connection?.saveData) return 'minimal';
  const cls = /Telegram-Android\/[^(]*\([^)]*;\s*(LOW|AVERAGE|HIGH)\)/i.exec(nav.userAgent)?.[1]?.toUpperCase();
  if (cls === 'LOW') return 'minimal';
  if (cls === 'AVERAGE') return 'lite';
  if (cls === 'HIGH') return 'full';
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) return 'lite';
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent);
  const mobile = /Android|Mobile/.test(nav.userAgent);
  if (ios || !mobile) return 'full';
  return (nav.hardwareConcurrency ?? 4) >= 6 ? 'full' : 'lite';
}

interface TierState {
  detected: MotionTier;
  override: MotionTier | null;
  cap: MotionTier;
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const nav = (): NavLike => (typeof navigator !== 'undefined' ? (navigator as unknown as NavLike) : { userAgent: '' });

export const tierStore = createStore<TierState>({ detected: detectTier(nav(), reduced()), override: local.get<MotionTier | null>('dokonim.motion', null), cap: 'full' });

export const effectiveTier = (s: TierState = tierStore.get()): MotionTier => {
  if (reduced()) return 'minimal';
  return s.override ?? minTier(s.detected, s.cap);
};

function reflect() {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = effectiveTier();
}
tierStore.subscribe(reflect);
reflect();

if (typeof matchMedia !== 'undefined') matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => tierStore.set((s) => ({ ...s })));

export function setTierOverride(t: MotionTier | null) {
  local.set('dokonim.motion', t);
  tierStore.set((s) => ({ ...s, override: t }));
}

/** Owner preference: `calm` caps the store at `lite`. */
export function setTierCap(calm: boolean) {
  tierStore.set((s) => ({ ...s, cap: calm ? 'lite' : 'full' }));
}

/** The FPS probe: samples rAF deltas for ~1 s once the app is idle and downgrades if frames are slow. */
export function runFpsProbe(): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  const start = () => {
    let frames = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      frames++;
      if (t - t0 < 1000) requestAnimationFrame(step);
      else {
        if (document.hidden) return; // background tabs throttle rAF; that says nothing about the device
        const fps = (frames * 1000) / (t - t0);
        const probe: MotionTier = fps < 40 ? 'minimal' : fps < 55 ? 'lite' : 'full';
        tierStore.set((s) => ({ ...s, detected: minTier(s.detected, probe) }));
      }
    };
    requestAnimationFrame(step);
  };
  const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(start, { timeout: 2500 });
  else setTimeout(start, 800);
}

export const useMotionTier = (): MotionTier => useStore(tierStore, effectiveTier);
