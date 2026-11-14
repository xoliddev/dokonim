/**
 * Small helpers shared by adapters, handlers and simulators.
 * Runs in Node, browsers and Web Workers: WebCrypto + standard globals only (no node:*, no Buffer).
 */
import { md5, timingSafeEqual, utf8b64, utf8fromb64 } from '@dokonim/core';
import type { Minor, RawWebhookRequest, RawWebhookResponse } from '@dokonim/core';

/** Case-insensitive header lookup (Node lower-cases, fetch Headers vary, tests write whatever). */
export function getHeader(req: Pick<RawWebhookRequest, 'headers'>, name: string): string | undefined {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(req.headers)) if (k.toLowerCase() === n) return v;
  return undefined;
}

export function jsonResponse(body: unknown, status = 200): RawWebhookResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

export function emptyResponse(status = 200): RawWebhookResponse {
  return { status, headers: {}, body: '' };
}

/** Decodes `Authorization: Basic base64(user:pass)`; null when absent or malformed. */
export function parseBasicAuth(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^\s*basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header);
  if (!m?.[1]) return null;
  try {
    return utf8fromb64(m[1]);
  } catch {
    return null;
  }
}

/** Constant-time check of a Basic header against `user:pass` (only the length can leak). */
export function basicAuthMatches(header: string | undefined, user: string, pass: string): boolean {
  const decoded = parseBasicAuth(header) ?? '';
  // Always run the comparison, even for a missing header, so timing does not reveal which check failed.
  const ok = timingSafeEqual(decoded, `${user}:${pass}`);
  return ok && decoded.length > 0 && pass.length > 0;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function randomHex(chars: number): string {
  let s = '';
  for (const x of randomBytes(Math.ceil(chars / 2))) s += x.toString(16).padStart(2, '0');
  return s.slice(0, chars);
}

/** Random decimal string without a leading zero. */
export function randomDigits(n: number): string {
  let s = '';
  for (const x of randomBytes(n)) s += String(x % 10);
  return (s[0] === '0' ? '1' : s[0]) + s.slice(1);
}

export function randomUuid(): string {
  const h = randomHex(32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Deterministic positive 31-bit integer derived from a string (first 32 bits of md5, top bit cleared).
 * Used for Click's numeric `merchant_prepare_id` / `merchant_confirm_id` (derived from our payment id).
 */
export function stableNumericId(seed: string): number {
  const n = parseInt(md5(seed).slice(0, 8), 16) & 0x7fffffff;
  return n === 0 ? 1 : n;
}

/** Tiyin → "so'm with two decimals" without floating-point drift: 1234567 → "12345.67". */
export function tiyinToSom(amount: Minor): string {
  const neg = amount < 0;
  const a = Math.abs(Math.trunc(amount));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/** "12345.67" / "12345" / "12345.6" → 1234567 tiyin; null when not a plain non-negative decimal. */
export function somToTiyin(s: string): Minor | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(s);
  if (!m?.[1]) return null;
  const fracRaw = m[2] ?? '';
  // Decimals beyond tiyin precision are only accepted when they are zeros ("100.000").
  if (/[1-9]/.test(fracRaw.slice(2))) return null;
  const frac = fracRaw.slice(0, 2).padEnd(2, '0');
  const v = Number(m[1]) * 100 + Number(frac);
  return Number.isSafeInteger(v) ? v : null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type DeadlineResult<T> = { ok: true; value: T } | { ok: false; timedOut: true };

/** Races `work` against a timer; the timer is always cleared so nothing keeps the event loop alive. */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms);
  });
  try {
    return await Promise.race([work.then((value): DeadlineResult<T> => ({ ok: true, value })), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Tashkent is UTC+5 all year (no DST). Click's `sign_time` is "YYYY-MM-DD HH:mm:ss" in local time. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000;

export function formatTashkentTime(d: Date): string {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseTashkentTime(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s.trim())) return null;
  const ms = Date.parse(`${s.trim().replace(' ', 'T')}+05:00`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `Basic base64(user:pass)` (UTF-8 safe). */
export function basicHeader(user: string, pass: string): string {
  return `Basic ${utf8b64(`${user}:${pass}`)}`;
}
