/** OKLCH colour maths (Björn Ottosson's OKLab), gamut mapping by chroma reduction, WCAG contrast. */

export interface Oklch {
  l: number; // 0..1
  c: number; // ~0..0.4
  h: number; // degrees
}
export type Rgb = [number, number, number]; // 0..1 sRGB

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`bad hex ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
}

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]: Rgb): [number, number, number] {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const r = (h * Math.PI) / 180;
  return oklabToLinear([l, c * Math.cos(r), c * Math.sin(r)]);
}

const inGamut = (lin: Rgb) => lin.every((x) => x >= -1e-4 && x <= 1 + 1e-4);

/** OKLCH → hex, reducing chroma (binary search) until the colour fits sRGB. */
export function oklchToHex(o: Oklch): string {
  const l = Math.min(1, Math.max(0, o.l));
  let lo = 0, hi = o.c;
  if (inGamut(oklchToLinear({ l, c: hi, h: o.h }))) lo = hi;
  else
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: o.h }))) lo = mid;
      else hi = mid;
    }
  const lin = oklchToLinear({ l, c: lo, h: o.h });
  return rgbToHex(lin.map(fromLinear) as Rgb);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Shift lightness of `fg` (keeping hue/chroma) until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): { hex: string; adjusted: boolean } {
  if (contrast(fg, bg) >= min) return { hex: fg, adjusted: false };
  const o = hexToOklch(fg);
  const darker = luminance(bg) > 0.4;
  for (let i = 1; i <= 60; i++) {
    const l = darker ? o.l - i * 0.015 : o.l + i * 0.015;
    const hex = oklchToHex({ ...o, l });
    if (contrast(hex, bg) >= min) return { hex, adjusted: true };
  }
  return { hex: darker ? '#000000' : '#ffffff', adjusted: true };
}

/** White or ink — whichever reads better on the accent. */
export function onColor(bg: string, ink = '#15131a', paper = '#ffffff'): string {
  return contrast(paper, bg) >= contrast(ink, bg) ? paper : ink;
}

export const RAMP_L = [0.985, 0.955, 0.91, 0.845, 0.765, 0.675, 0.585, 0.5, 0.415, 0.33, 0.24, 0.12];

/** 12-step tonal ramp from one brand colour. Chroma follows a bell so the extremes stay calm. */
export function tonalRamp(brand: string): string[] {
  const o = hexToOklch(brand);
  return RAMP_L.map((l) => {
    const t = 1 - Math.abs(l - 0.55) / 0.5;
    return oklchToHex({ l, c: o.c * (0.25 + 0.75 * Math.max(0, t)), h: o.h });
  });
}

/** Neutral ramp tinted 4% toward the brand hue. */
export function neutralRamp(brand: string): string[] {
  const o = hexToOklch(brand);
  return RAMP_L.map((l) => oklchToHex({ l, c: Math.min(0.012, o.c * 0.04 + 0.004), h: o.h }));
}

export function mixHue(base: number, toward: number, amount: number): number {
  const d = ((toward - base + 540) % 360) - 180;
  return (base + d * amount + 360) % 360;
}

/** Palette suggestions from image pixels: k-means in OKLab, ranked by population × chroma. */
export function paletteFromPixels(rgba: Uint8ClampedArray | number[], k = 5, maxSamples = 4000): string[] {
  const pts: Array<[number, number, number]> = [];
  const n = rgba.length / 4;
  const step = Math.max(1, Math.floor(n / maxSamples));
  for (let i = 0; i < n; i += step) {
    const a = rgba[i * 4 + 3]!;
    if (a < 128) continue;
    const lab = rgbToOklab([rgba[i * 4]! / 255, rgba[i * 4 + 1]! / 255, rgba[i * 4 + 2]! / 255]);
    if (lab[0] > 0.96 || lab[0] < 0.12) continue; // skip paper-white and pure black backgrounds
    pts.push(lab);
  }
  if (pts.length === 0) return [];
  // deterministic farthest-point init
  const centers: Array<[number, number, number]> = [pts[0]!];
  while (centers.length < Math.min(k, pts.length)) {
    let best = pts[0]!, bestD = -1;
    for (const p of pts) {
      const d = Math.min(...centers.map((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2));
      if (d > bestD) (bestD = d), (best = p);
    }
    centers.push(best);
  }
  let counts = centers.map(() => 0);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, ci) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) (bd = d), (bi = ci);
      });
      sums[bi]![0]! += p[0]; sums[bi]![1]! += p[1]; sums[bi]![2]! += p[2];
      counts[bi]!++;
    }
    centers.forEach((c, ci) => {
      if (counts[ci]) for (let j = 0; j < 3; j++) c[j] = sums[ci]![j]! / counts[ci]!;
    });
  }
  return centers
    .map((c, i) => ({ c, score: counts[i]! * (0.05 + Math.hypot(c[1], c[2])) }))
    .sort((a, b) => b.score - a.score)
    .map(({ c }) => {
      const lin = oklabToLinear(c);
      return rgbToHex(lin.map((x) => fromLinear(Math.min(1, Math.max(0, x)))) as Rgb);
    });
}
