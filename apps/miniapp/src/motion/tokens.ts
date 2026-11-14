/** Motion tokens (§13.2), mirrored as CSS variables in theme/tokens.css. Durations in seconds for Motion. */
export const dur = { xs: 0.09, sm: 0.14, md: 0.22, lg: 0.32, xl: 0.48, arc: 0.52 } as const;

export const ease = {
  standard: [0.2, 0, 0, 1],
  decel: [0.05, 0.7, 0.1, 1],
  accel: [0.3, 0, 1, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export const cssEase = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decel: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  accel: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 1 },
  bouncy: { type: 'spring', stiffness: 380, damping: 18, mass: 1 },
  sheet: { type: 'spring', stiffness: 300, damping: 32, mass: 1 },
  morph: { type: 'spring', stiffness: 420, damping: 40, mass: 1 },
} as const;

/** List stagger: 24 ms per item, capped at 8 items, then the rest enter as one batch. */
export const STAGGER = 0.024;
export const STAGGER_MAX = 8;
export const staggerDelay = (i: number, base = 0) => base + Math.min(i, STAGGER_MAX) * STAGGER;
