/**
 * "Bozor Modern" product art (§12.4): flat paper-and-ink illustrations rendered as tiny self-contained SVGs.
 *
 * A spec is a URL-like string `art:<kind>?bg=<hex>&c=<hex>&c2=<hex>&p=<pattern>` (URLSearchParams syntax,
 * `#` optional). `renderArt(spec)` turns it into SVG markup (viewBox 0 0 400 500, no external refs, no scripts,
 * < 4 KB); `artDataUrl(spec)` wraps that markup in a `data:image/svg+xml` URL the backend accepts as media.
 * The same kind looks different per colour set: the backdrop, tilt and scattered dots are derived from a hash
 * of the whole spec, so colour variants of one product never look like copies.
 */

export const ART_KINDS = [
  'dress', 'shirt', 'chapan', 'doppi', 'scarf', 'trousers', 'bag', 'sneaker', 'pillow', 'fabric', 'wallhanging',
  'teapot', 'piyola', 'lagan', 'tea', 'driedfruit', 'honey', 'spices', 'non', 'halva',
  'phone', 'headphones', 'watch', 'cream', 'perfume', 'soap', 'candle', 'vase', 'box',
] as const;
export type ArtKind = (typeof ART_KINDS)[number];

export const ART_PATTERNS = ['ikat', 'suzani', 'stripe', 'none'] as const;
export type ArtPattern = (typeof ART_PATTERNS)[number];

export interface ArtOpts {
  /** Background tint (default: derived from `c`). */
  bg?: string;
  /** Main colour of the object. */
  c?: string;
  /** Accent colour (trim, motifs, lids…). */
  c2?: string;
  /** Pattern inside the object. */
  p?: ArtPattern;
}

const INK = '#1d1a16';
const CREAM = '#fbf6ee';

// ── tiny colour helpers ──────────────────────────────────────────────────────

function hex(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return null;
}

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two hex colours (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function luma(h: string): number {
  const [r, g, b] = rgb(h);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ── spec parsing ─────────────────────────────────────────────────────────────

export function artUrl(kind: string, opts: ArtOpts = {}): string {
  const q: string[] = [];
  for (const k of ['bg', 'c', 'c2'] as const) {
    const h = hex(opts[k]);
    if (h) q.push(`${k}=${h.slice(1)}`);
  }
  if (opts.p && (ART_PATTERNS as readonly string[]).includes(opts.p)) q.push(`p=${opts.p}`);
  return `art:${kind}${q.length ? `?${q.join('&')}` : ''}`;
}

export function isArtUrl(url: unknown): url is string {
  return typeof url === 'string' && /^art:[a-z0-9-]+(\?.*)?$/.test(url);
}

export function parseArt(spec: string): { kind: string; opts: ArtOpts } {
  const m = /^art:([a-z0-9-]+)(?:\?(.*))?$/.exec(spec.trim());
  if (!m) return { kind: 'box', opts: {} };
  const q = new URLSearchParams(m[2] ?? '');
  const p = q.get('p');
  return {
    kind: m[1]!,
    opts: { bg: hex(q.get('bg')) ?? undefined, c: hex(q.get('c')) ?? undefined, c2: hex(q.get('c2')) ?? undefined, p: (ART_PATTERNS as readonly string[]).includes(p ?? '') ? (p as ArtPattern) : undefined },
  };
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── geometry helpers (path data) ─────────────────────────────────────────────

const r0 = (n: number) => Math.round(n);
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
const el = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
const P = (d: string, a = '') => `<path d='${d}'${a ? ` ${a}` : ''}/>`;
const C = (cx: number, cy: number, r: number, a = '') => `<circle cx='${r0(cx)}' cy='${r0(cy)}' r='${r}'${a ? ` ${a}` : ''}/>`;
const f = (c: string) => `fill='${c}'`;
const NS = `stroke='none'`;

/** Stepped (ikat-style, "blurred-edge") diamond. */
function stairDiamond(cx: number, cy: number, w: number, h: number, n: number): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) pts.push([cx + (w * i) / n, cy - h + (h * i) / n]);
  for (let i = 1; i <= n; i++) pts.push([cx + w - (w * i) / n, cy + (h * i) / n]);
  for (let i = 1; i <= n; i++) pts.push([cx - (w * i) / n, cy + h - (h * i) / n]);
  for (let i = 1; i <= n; i++) pts.push([cx - w + (w * i) / n, cy - (h * i) / n]);
  let d = `M${r0(pts[0]![0])} ${r0(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) d += `H${r0(pts[i]![0])}V${r0(pts[i]![1])}`;
  return `${d}Z`;
}

interface Ctx {
  c: string;
  c2: string;
  lt: string;
  dk: string;
  c2d: string;
  pat: string | null;
  rnd: () => number;
}

interface KindDef {
  /** Silhouette (shadow + base fill + outline). */
  s: string;
  /** Details drawn on top (inherit the ink stroke; fill defaults to none). */
  d?: (k: Ctx) => string;
  c: string;
  c2: string;
  p?: ArtPattern;
  /** Pattern goes on this path instead of the silhouette ('' = nowhere). */
  patOn?: string;
  /** Draw a soft ground shadow at this y. */
  ground?: number;
  /** Allow a slight random tilt. */
  tilt?: boolean;
}

// ── the kinds ────────────────────────────────────────────────────────────────

const DEFS: Record<ArtKind, KindDef> = {
  dress: {
    c: '#b4442e', c2: '#f2c14e', p: 'ikat', tilt: true,
    s: 'M168 92Q200 116 232 92L266 102L292 170L258 182L250 222Q290 330 312 436Q200 462 88 436Q110 330 150 222L142 182L108 170L134 102Z',
    d: (k) => P('M200 98V78q0-14 12-16q10-2 10-14') + P('M150 222Q200 236 250 222L248 240Q200 254 152 240Z', f(k.c2)) + P('M98 410Q200 434 302 410', `stroke-opacity='.4'`),
  },
  shirt: {
    c: '#2c5d8f', c2: '#f4ead8', p: 'none', tilt: true,
    s: 'M156 92L200 106L244 92L304 116L336 228L300 240L284 186L286 430L114 430L116 186L100 240L64 228L96 116Z',
    d: (k) =>
      P('M200 106V430') + P('M156 92L200 106L178 138Z', f(k.c2)) + P('M244 92L200 106L222 138Z', f(k.c2)) +
      [160, 210, 260, 310, 360].map((y) => C(212, y, 4, f(k.c2))).join('') + P('M126 196h46v40q-23 10-46 0Z') + P('M68 216L104 228M332 216L296 228'),
  },
  chapan: {
    c: '#5b2a6e', c2: '#e8b04a', p: 'ikat', tilt: true,
    s: 'M168 78L232 78L276 98L344 156L354 286L306 294L292 214L300 448L100 448L108 214L94 294L46 286L56 156L124 98Z',
    d: (k) =>
      P('M168 78L184 78L224 248L224 448L206 448L206 252Z', f(k.c2)) + P('M49 266L96 274L94 294L46 286Z', f(k.c2)) + P('M351 266L304 274L306 294L354 286Z', f(k.c2)) +
      P('M106 246Q200 262 296 246L297 272Q200 288 105 272Z', f(k.c2d)) + P('M168 78Q200 98 232 78'),
  },
  doppi: {
    c: '#24211d', c2: '#f6f0e4', p: 'none', ground: 352,
    s: 'M92 340L122 186Q200 156 278 186L308 340Q200 372 92 340Z',
    d: (k) => {
      let zig = 'M100 334';
      for (let x = 110; x <= 300; x += 10) zig += `L${x} ${x % 20 ? 322 : 334}`;
      return P('M122 186L200 210L278 186M200 210V358', `stroke='${k.c2}' stroke-opacity='.5'`) + P('M96 314Q200 346 304 314L308 340Q200 372 92 340Z', f(k.c2d)) +
        P(zig, `stroke='${k.c}' stroke-width='2'`) + P('M158 226c26 26 22 62 0 80c-22-18-26-54 0-80Z', f(k.c2)) + P('M242 226c26 26 22 62 0 80c-22-18-26-54 0-80Z', f(k.c2)) +
        P('M158 246v40M242 246v40', `stroke='${k.c}' stroke-width='2'`) + C(200, 182, 6, f(k.c2));
    },
  },
  scarf: {
    c: '#c23b5a', c2: '#f2c14e', p: 'ikat', tilt: true,
    s: 'M200 64L346 236L200 408L54 236Z',
    d: (k) => {
      let fr = '';
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        fr += `M${r0(54 + 146 * t)} ${r0(236 + 172 * t)}v16M${r0(346 - 146 * t)} ${r0(236 + 172 * t)}v16`;
      }
      return P('M200 94L320 236L200 378L80 236Z', `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`) + P(fr, `stroke-width='2'`);
    },
  },
  trousers: {
    c: '#3b4a6b', c2: '#d9b26a', p: 'none',
    s: 'M128 82L272 82L292 444L214 444L200 176L186 444L108 444Z',
    d: (k) => P('M128 82H272L273 110H127Z', f(k.c2)) + P('M152 82v28M248 82v28M200 82v28') + P('M160 120L148 436M240 120L252 436', `stroke-opacity='.35'`) + P('M136 112q24 4 32 34M264 112q-24 4-32 34'),
  },
  bag: {
    c: '#8a4b2a', c2: '#1f6f78', p: 'ikat', ground: 438,
    s: 'M84 206L316 206L336 432Q200 448 64 432Z',
    d: (k) =>
      P('M136 206C136 88 264 88 264 206', `stroke-width='14'`) + P('M136 206C136 88 264 88 264 206', `stroke='${k.c2}' stroke-width='8' stroke-opacity='1'`) +
      P('M84 206L316 206L306 292Q200 320 94 292Z', f(k.dk)) + C(200, 302, 11, f(k.c2)) + P('M100 222H300', `stroke-width='2' stroke-dasharray='6 6'`),
  },
  sneaker: {
    c: '#f4ead8', c2: '#b4442e', p: 'ikat', ground: 398,
    s: 'M58 362L60 300Q66 254 118 246L178 236Q214 206 248 214L282 246Q330 274 352 306Q366 336 352 362Z',
    d: (k) =>
      P('M50 362H356Q360 396 334 396H74Q48 396 50 362Z', f(CREAM)) + P('M60 380H346', `stroke-opacity='.35'`) + P('M118 334Q206 302 292 262L304 282Q212 324 126 352Z', f(k.c2)) +
      P('M300 266Q340 290 352 330') + P('M196 232L222 254M210 222L238 244M226 214L252 234', `stroke-width='4'`),
  },
  pillow: {
    c: '#b4442e', c2: '#f2c14e', p: 'ikat', ground: 384,
    s: 'M70 150Q200 128 330 150Q350 260 330 370Q200 392 70 370Q50 260 70 150Z',
    d: (k) =>
      P('M86 164Q200 144 314 164Q332 260 314 356Q200 376 86 356Q68 260 86 164Z', `stroke='${k.c2}' stroke-width='4' stroke-opacity='1'`) +
      P('M70 150l-18-16M330 150l18-16M70 370l-18 16M330 370l18 16') + C(50, 132, 7, f(k.c2)) + C(350, 132, 7, f(k.c2)) + C(50, 388, 7, f(k.c2)) + C(350, 388, 7, f(k.c2)),
  },
  fabric: {
    c: '#5b2a6e', c2: '#e8b04a', p: 'ikat', ground: 432,
    s: rr(60, 240, 280, 190, 16),
    d: (k) =>
      P('M66 244L116 196H344Q366 196 352 216L332 244Z', f(k.lt)) + (k.pat ? P('M66 244L116 196H344Q366 196 352 216L332 244Z', f(k.pat)) : '') +
      P('M340 256L362 214V390L340 418Z', f(k.dk)) + P('M60 302Q200 314 340 302V366Q200 378 60 366Z', f(k.c2)) + P('M60 302Q200 314 340 302M60 366Q200 378 340 366'),
  },
  wallhanging: {
    c: '#f4ead8', c2: '#b4442e', p: 'none',
    s: rr(70, 74, 260, 340, 6),
    d: (k) => {
      let t = '';
      for (let x = 86; x <= 314; x += 19) t += `M${x} 414v22`;
      const leaf = '#2f6b4f';
      return P('M52 74H348', `stroke-width='6'`) + P(rr(88, 92, 224, 304, 4), `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`) +
        P('M130 154Q200 196 270 154M130 334Q200 292 270 334M130 154Q170 244 130 334M270 154Q230 244 270 334', `stroke='${leaf}' stroke-width='4' stroke-opacity='1'`) +
        C(200, 244, 58, f(k.c2)) + C(200, 244, 32, f(CREAM)) + C(200, 244, 13, f(k.c2)) +
        [[130, 154], [270, 154], [130, 334], [270, 334]].map(([x, y]) => C(x!, y!, 24, f(k.c2d)) + C(x!, y!, 8, f(CREAM))).join('') + P(t, `stroke='${k.c2}' stroke-width='3'`);
    },
  },
  teapot: {
    c: '#f4f1ea', c2: '#1f4fa8', p: 'suzani', ground: 404,
    s: 'M112 332C102 236 158 196 200 196C242 196 298 236 288 332C282 384 240 402 200 402C160 402 118 384 112 332Z M118 300C80 292 64 256 50 214L68 206C84 248 98 268 124 272Z M282 256C342 246 352 330 290 356L292 338C330 318 324 270 286 274Z',
    d: (k) => P('M118 304Q200 326 282 304', `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`) + P(el(200, 200, 54, 13), f(k.c2)) + C(200, 178, 12, f(k.c2)) + P('M150 398Q200 410 250 398'),
  },
  piyola: {
    c: '#f4f1ea', c2: '#1f4fa8', p: 'suzani', ground: 414,
    s: 'M78 246L322 246C318 338 270 392 200 392C130 392 82 338 78 246Z',
    d: (k) =>
      P('M158 388L242 388L236 412L164 412Z', f(k.c)) + P(el(200, 246, 122, 24), f(k.lt)) + P(el(200, 250, 104, 16), f('#b8742a')) +
      P('M92 292Q200 318 308 292', `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`) + P('M172 204q-14-20 0-40q14-20 0-40M224 210q-14-20 0-40q14-20 0-40', `stroke-opacity='.3'`),
  },
  lagan: {
    c: '#1f6e8c', c2: '#f2e3c2', p: 'suzani', ground: 392,
    s: el(200, 262, 168, 122),
    d: (k) => {
      let star = '';
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI * i) / 8;
        const r = i % 2 ? 16 : 38;
        star += `${i ? 'L' : 'M'}${r0(200 + r * Math.cos(a))} ${r0(262 + r * 0.72 * Math.sin(a))}`;
      }
      let dots = '';
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 * i) / 18;
        dots += C(200 + 148 * Math.cos(a), 262 + 107 * Math.sin(a), 5, `${f(k.c2)} ${NS}`);
      }
      return P(el(200, 262, 128, 92), `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`) + P(el(200, 262, 58, 42), f(k.c2)) + P(`${star}Z`, f(k.c)) + dots;
    },
  },
  tea: {
    c: '#2f6b4f', c2: '#f2c14e', p: 'none', patOn: 'M110 172L260 172L260 424L110 424Z', ground: 428,
    s: 'M110 172L160 140L310 140L310 392L260 424L110 424Z',
    d: (k) =>
      P('M110 172L160 140L310 140L260 172Z', f(k.lt)) + P('M260 172L310 140L310 392L260 424Z', f(k.dk)) + P('M110 194H260V214H110Z', f(k.c2)) +
      P(rr(126, 236, 118, 126, 10), f(CREAM)) + P('M185 336C148 306 158 266 200 254C214 294 210 320 185 336Z', f(k.c)) + P('M186 332Q194 292 200 256', `stroke-width='2'`),
  },
  driedfruit: {
    c: '#1f6e8c', c2: '#e08a2e', p: 'suzani', ground: 416,
    s: 'M66 296L334 296C324 376 272 414 200 414C128 414 76 376 66 296Z',
    d: (k) => {
      const rows: Array<[number, number[]]> = [[284, [100, 140, 180, 220, 260, 300]], [252, [122, 162, 202, 242, 282]], [222, [152, 192, 232]], [196, [196]]];
      const dark = mix(k.c2, '#4a2410', 0.5);
      let fr = P(el(200, 296, 134, 22), f(k.dk));
      let i = 0;
      for (const [y, xs] of rows)
        for (const x of xs) {
          const j = () => (k.rnd() - 0.5) * 8;
          fr += i % 4 === 3 ? P(el(r0(x + j()), r0(y + 6 + j()), 14, 10), f(dark)) : C(x + j(), y + j(), 22, f(i % 3 === 1 ? mix(k.c2, '#ffffff', 0.15) : k.c2));
          i++;
        }
      return fr + P('M66 296Q200 330 334 296');
    },
  },
  honey: {
    c: '#e0a526', c2: '#b4442e', p: 'suzani', patOn: '', ground: 430,
    s: 'M118 200L282 200Q302 200 302 222L302 404Q302 428 278 428L122 428Q98 428 98 404L98 222Q98 200 118 200Z',
    d: (k) => {
      const cloth = 'M90 206Q96 140 200 134Q304 140 310 206L292 226L272 206L252 226L232 206L212 226L192 206L172 226L152 206L132 226L112 206Z';
      return P('M122 250V392', `stroke='#fff' stroke-opacity='.55' stroke-width='8'`) + P(cloth, f(k.c2)) + (k.pat ? P(cloth, f(k.pat)) : '') +
        P('M104 196Q200 216 296 196', `stroke-width='4'`) + P(rr(140, 282, 120, 86, 12), f(CREAM)) + P('M200 300L222 312V338L200 350L178 338V312Z', f(k.c));
    },
  },
  spices: {
    c: '#c9a46a', c2: '#c2410c', p: 'none', ground: 430,
    s: 'M196 236Q186 320 192 420L340 420Q346 320 334 236Q306 256 266 248Q226 256 196 236Z',
    d: (k) => {
      const sp2 = mix(k.c2, '#d9a21b', 0.65);
      let g = '';
      for (let i = 0; i < 8; i++) g += C(100 + i * 11, 250 + (i % 3) * 5, 2, `${f(k.dk)} ${NS}`) + C(232 + i * 9, 222 + (i % 3) * 5, 2, `${f(mix(sp2, INK, 0.3))} ${NS}`);
      return P('M200 240Q265 190 330 240', f(sp2)) + P('M196 236Q266 266 334 236', `stroke-width='6'`) +
        P('M62 262Q52 340 58 428L222 428Q228 340 216 262Q186 282 140 274Q94 282 62 262Z', f(k.dk)) + P('M70 266Q139 210 208 266', f(k.c2)) + P('M62 262Q140 292 216 262', `stroke-width='6'`) + g;
    },
  },
  non: {
    c: '#d08a3e', c2: '#f0c27a', p: 'none', ground: 412,
    s: el(200, 262, 166, 146),
    d: (k) => {
      let dots = '';
      const ring = (n: number, rx: number, ry: number, r: number) => {
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n;
          dots += C(200 + rx * Math.cos(a), 262 + ry * Math.sin(a), r, `${f(k.dk)} ${NS}`);
        }
      };
      ring(18, 74, 63, 4);
      if (k.rnd() > 0.4) ring(10, 44, 38, 4);
      ring(6, 16, 14, 3);
      let ses = '';
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI * 2 * i) / 16 + k.rnd() * 0.3;
        ses += P(el(r0(200 + 140 * Math.cos(a)), r0(262 + 122 * Math.sin(a)), 4, 2), `${f(CREAM)} ${NS}`);
      }
      return P(el(200, 262, 134, 116), `stroke='${k.lt}' stroke-width='10' stroke-opacity='.6'`) + P(el(200, 262, 100, 86), f(k.c2)) + dots + C(200, 262, 4, `${f(k.dk)} ${NS}`) + ses;
    },
  },
  halva: {
    c: '#e9d3a6', c2: '#7fa650', p: 'none', ground: 414,
    s: el(200, 360, 172, 52),
    d: (k) => {
      const block = (x: number, y: number, w: number, h: number) =>
        P(`M${x} ${y}h${w}v${h}h${-w}Z`, f(k.c)) + P(`M${x} ${y}l18 -16h${w}l-18 16Z`, f(k.lt)) + P(`M${x + w} ${y}l18 -16v${h}l-18 16Z`, f(k.dk)) +
        C(x + w / 2, y - 8, 4, `${f(k.c2)} ${NS}`) + C(x + w / 2 + 16, y - 9, 3, `${f(k.c2)} ${NS}`);
      return P(el(200, 354, 138, 36), `${f('#f4f1ea')}`) + block(104, 298, 72, 52) + block(194, 286, 82, 64) + block(146, 244, 74, 52) +
        P(rr(286, 318, 34, 26, 10), f(CREAM)) + P(rr(300, 340, 34, 26, 10), f(CREAM));
    },
  },
  phone: {
    c: '#2f3a4f', c2: '#b4442e', p: 'none', tilt: true,
    s: rr(122, 70, 156, 320, 30),
    d: (k) => {
      const tile = mix(k.c2, CREAM, 0.55);
      return P(rr(134, 86, 132, 288, 20), f(CREAM)) + P(rr(146, 104, 108, 14, 7), f(k.c2)) +
        [[146, 130], [204, 130], [146, 204], [204, 204]].map(([x, y]) => P(rr(x!, y!, 50, 62, 8), f(tile)) + P(`M${x} ${y! + 74}h34`, `stroke-opacity='.4'`)).join('') +
        P(rr(146, 336, 108, 24, 12), f(k.c2)) + C(200, 96, 3, f(INK));
    },
  },
  headphones: {
    c: '#2f3a4f', c2: '#e8b04a', p: 'none', ground: 392,
    s: `M92 286C92 112 308 112 308 286L284 286C284 142 116 142 116 286Z ${rr(66, 250, 72, 128, 30)} ${rr(262, 250, 72, 128, 30)}`,
    d: (k) => P(rr(132, 262, 18, 104, 9), f(k.dk)) + P(rr(250, 262, 18, 104, 9), f(k.dk)) + C(102, 314, 14, f(k.c2)) + C(298, 314, 14, f(k.c2)) + P('M140 150Q200 126 260 150', `stroke='${k.c2}' stroke-width='10' stroke-opacity='1'`),
  },
  watch: {
    c: '#7a4a2a', c2: '#e8b04a', p: 'ikat', tilt: true,
    s: `${rr(166, 52, 68, 140, 14)} ${rr(166, 308, 68, 140, 14)}`,
    d: (k) => {
      let t = '';
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * i) / 6;
        const r1 = i % 3 ? 60 : 52;
        t += `M${r0(200 + r1 * Math.cos(a))} ${r0(250 + r1 * Math.sin(a))}L${r0(200 + 66 * Math.cos(a))} ${r0(250 + 66 * Math.sin(a))}`;
      }
      return P(rr(286, 238, 16, 24, 4), f(k.c2)) + C(200, 250, 88, f(k.c2)) + C(200, 250, 72, f(CREAM)) + P(t, `stroke-width='3'`) +
        P('M200 250V198M200 250L238 268', `stroke-width='5'`) + C(200, 250, 6, f(INK)) + C(200, 404, 4, f(k.dk)) + C(200, 424, 4, f(k.dk));
    },
  },
  cream: {
    c: '#f2d7d0', c2: '#b4442e', p: 'none', patOn: rr(92, 200, 216, 64, 16), ground: 410,
    s: rr(100, 252, 200, 156, 22),
    d: (k) =>
      P(rr(92, 200, 216, 64, 16), f(k.c2)) + (k.pat ? P(rr(92, 200, 216, 64, 16), f(k.pat)) : '') + P(rr(132, 300, 136, 66, 10), f(CREAM)) +
      P('M150 324h100M164 344h72', `stroke-opacity='.45'`) + P('M300 414c26-40 56-44 78-32c-18 32-48 44-78 32Z', f('#7fa650')),
  },
  perfume: {
    c: '#c98fa8', c2: '#d9a21b', p: 'none', ground: 434,
    s: rr(100, 214, 200, 218, 24),
    d: (k) =>
      P(rr(176, 176, 48, 42, 6), f(mix(k.c2, CREAM, 0.4))) + P('M156 178L244 178L262 132L200 98L138 132Z', f(k.c2)) + P('M156 178L200 98L244 178M138 132H262', `stroke-width='2'`) +
      P('M126 246V404', `stroke='#fff' stroke-opacity='.55' stroke-width='10'`) + P(rr(146, 300, 108, 56, 8), f(CREAM)) + P('M164 328h72', `stroke-opacity='.45'`),
  },
  soap: {
    c: '#e9c46a', c2: '#7fa650', p: 'none', ground: 388,
    s: 'M84 318Q84 300 102 300L150 262H320V340Q320 360 300 372L270 384H102Q84 384 84 366Z',
    d: (k) =>
      P('M100 300L150 262H320L284 300Z', f(k.lt)) + P('M284 300L320 262V340Q320 360 300 372L284 384Z', f(k.dk)) + P(el(184, 342, 52, 22), `stroke='${k.dk}' stroke-width='3'`) +
      P('M168 344c10-16 22-16 32 0c-10 16-22 16-32 0Z', f(k.c2)) + C(112, 226, 18, `fill='#fff' fill-opacity='.6'`) + C(150, 196, 11, `fill='#fff' fill-opacity='.6'`) + C(300, 212, 22, `fill='#fff' fill-opacity='.6'`),
  },
  candle: {
    c: '#1f6e8c', c2: '#f6e7c8', p: 'suzani', ground: 424,
    s: rr(126, 246, 148, 176, 18),
    d: (k) =>
      C(200, 196, 50, `fill='#f6c453' fill-opacity='.28' ${NS}`) + P('M126 322H274V358H126Z', f(k.c2)) + P(el(200, 250, 74, 15), f(k.c2)) + P('M200 250V226') +
      P('M200 160C226 190 224 218 200 228C176 218 174 190 200 160Z', f('#f2a93b')) + P('M200 192C210 204 208 216 200 220C192 216 190 204 200 192Z', `fill='#ffe08a' ${NS}`),
  },
  vase: {
    c: '#1f6e8c', c2: '#f2e3c2', p: 'suzani', ground: 426,
    s: 'M168 92L232 92L226 128Q302 176 302 286Q302 384 242 424L158 424Q98 384 98 286Q98 176 174 128Z',
    d: (k) => P(el(200, 92, 34, 8), f(k.lt)) + P('M130 196Q200 214 270 196M104 334Q200 354 296 334', `stroke='${k.c2}' stroke-width='6' stroke-opacity='1'`),
  },
  box: {
    c: '#c9a46a', c2: '#b4442e', p: 'none', ground: 418,
    s: `${rr(104, 214, 192, 200, 10)} ${rr(92, 178, 216, 48, 10)}`,
    d: (k) => P('M186 178H214V414H186Z', f(k.c2)) + P('M200 178C160 126 136 168 200 178C264 168 240 126 200 178Z', f(k.c2)) + P('M92 226H308'),
  },
};

function patternDef(id: string, p: ArtPattern, c: string, c2: string): string {
  const cream = luma(c2) < 0.5 ? CREAM : mix(c, INK, 0.25);
  if (p === 'ikat')
    return `<pattern id='${id}' width='48' height='64' patternUnits='userSpaceOnUse'>${P(stairDiamond(24, 32, 16, 28, 5), `${f(c2)} fill-opacity='.92'`)}${P(stairDiamond(24, 32, 7, 12, 3), f(cream))}${P('M0 0V64M48 0V64', `stroke='${c2}' stroke-width='5' stroke-dasharray='10 4 3 4'`)}</pattern>`;
  if (p === 'suzani')
    return `<pattern id='${id}' width='44' height='44' patternUnits='userSpaceOnUse'>${C(22, 22, 9, f(c2))}${C(22, 22, 4, f(cream))}${C(0, 0, 4, f(c2))}${C(44, 0, 4, f(c2))}${C(0, 44, 4, f(c2))}${C(44, 44, 4, f(c2))}</pattern>`;
  if (p === 'stripe') return `<pattern id='${id}' width='30' height='10' patternUnits='userSpaceOnUse'>${P('M0 0h8v10h-8Z', f(c2))}${P('M15 0h3v10h-3Z', `${f(cream)} fill-opacity='.7'`)}</pattern>`;
  return '';
}

/** Render a spec (`art:<kind>?…`) to SVG markup. Unknown kinds become a tasteful gift box. */
export function renderArt(spec: string): string {
  const { kind, opts } = parseArt(spec);
  const def = DEFS[(ART_KINDS as readonly string[]).includes(kind) ? (kind as ArtKind) : 'box'];
  const c = opts.c ?? def.c;
  const c2 = opts.c2 ?? def.c2;
  const p = opts.p ?? def.p ?? 'none';
  const bg = opts.bg ?? mix(luma(c) > 0.82 ? c2 : c, CREAM, 0.86);
  const h = fnv(spec);
  const rnd = prng(h);
  const u = h.toString(36);
  const pid = `p${u}`;
  const sid = `s${u}`;
  const bg2 = mix(bg, luma(c) > 0.82 ? c2 : c, 0.16);
  const k: Ctx = { c, c2, lt: mix(c, '#ffffff', 0.35), dk: mix(c, INK, 0.3), c2d: mix(c2, INK, 0.18), pat: p !== 'none' ? `url(#${pid})` : null, rnd };

  // backdrop: circle, pointed arch (ravoq) or tilted tile — picked by the hash
  const v = h % 3;
  const back =
    v === 0
      ? C(200 + ((h >> 3) % 5) * 14 - 28, 236, 150, f(bg2))
      : v === 1
        ? P('M76 476V236Q76 128 200 68Q324 128 324 236V476Z', f(bg2))
        : P(rr(70, 90, 260, 330, 28), `${f(bg2)} transform='rotate(${((h >> 5) % 13) - 6} 200 255)'`);
  let dots = '';
  for (let i = 0; i < 5; i++) dots += C(20 + rnd() * 360, 20 + rnd() * 460, 3 + r0(rnd() * 4), `${f(c2)} fill-opacity='.22'`);
  const tilt = def.tilt ? ` transform='rotate(${((h >> 7) % 7) - 3} 200 260)'` : '';
  const patOn = def.patOn ?? null;
  const patLayer = k.pat ? (patOn === null ? `<use href='#${sid}' fill='${k.pat}'/>` : patOn ? P(patOn, `fill='${k.pat}'`) : '') : '';

  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 500'>` +
    `<defs><path id='${sid}' d='${def.s}'/>${k.pat ? patternDef(pid, p, c, c2) : ''}</defs>` +
    `<rect width='400' height='500' fill='${bg}'/>${back}${dots}` +
    (def.ground ? P(el(200, def.ground, 150, 12), `fill='${INK}' fill-opacity='.07'`) : '') +
    `<g${tilt}>` +
    `<use href='#${sid}' fill='${INK}' fill-opacity='.16' transform='translate(10 10)'/>` +
    `<use href='#${sid}' fill='${c}'/>${patLayer}` +
    `<use href='#${sid}' fill='none' stroke='${INK}' stroke-opacity='.85' stroke-width='3' stroke-linejoin='round'/>` +
    `<g fill='none' stroke='${INK}' stroke-opacity='.85' stroke-width='3' stroke-linejoin='round' stroke-linecap='round'>${def.d ? def.d(k) : ''}</g>` +
    `</g></svg>`
  );
}

/** `data:image/svg+xml` URL for a spec (what the seed stores as product media). */
export function artDataUrl(spec: string): string {
  return `data:image/svg+xml,${renderArt(spec).replace(/[<>#%"{}\n]/g, (m) => encodeURIComponent(m))}`;
}
