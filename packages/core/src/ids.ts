/** UUIDv7 (RFC 9562): 48-bit unix ms timestamp + random. Time-sortable, same in browser and server. */
let lastMs = 0;
let seq = 0;

function rnd(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function uuidv7(nowMs: number = Date.now()): string {
  // Monotonic within the same millisecond: bump a 12-bit counter in rand_a.
  if (nowMs === lastMs) seq = (seq + 1) & 0xfff;
  else {
    lastMs = nowMs;
    seq = rnd(2)[0]! & 0x7f;
  }
  const b = rnd(16);
  const ms = BigInt(nowMs);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function uuidTimestamp(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short base36 id for deep links (8 chars ≈ 41 bits). Unique per store, enforced by a DB constraint. */
export function shortId(len = 8): string {
  const b = rnd(len);
  let s = '';
  for (let i = 0; i < len; i++) s += B36[b[i]! % 36];
  return s;
}

/** Six-digit pickup code. */
export function pickupCode(): string {
  const b = rnd(4);
  const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** Deterministic PRNG (mulberry32) for seed data and property tests. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic UUIDv7-shaped id from a PRNG (seed data must be stable across runs). */
export function seededUuid(rand: () => number, ms: number): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(rand() * 256);
  const big = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((big >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
