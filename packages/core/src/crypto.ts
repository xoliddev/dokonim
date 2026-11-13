/**
 * Crypto helpers on WebCrypto (same code in Node ≥ 20, browsers and the demo worker).
 * MD5 is implemented here because WebCrypto has no MD5 and Click's SHOP-API signs with it.
 */

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8b64(s: string): string {
  return b64encode(enc.encode(s));
}

export function utf8fromb64(s: string): string {
  return new TextDecoder().decode(b64decode(s));
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const subtle = () => globalThis.crypto.subtle;

function buf(data: string | Uint8Array): BufferSource {
  return (typeof data === 'string' ? enc.encode(data) : data) as BufferSource;
}

export async function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, buf(data)));
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await subtle().digest('SHA-256', buf(data)));
}

/** AES-256-GCM envelope for provider credentials: base64(iv(12) | ciphertext+tag). Key = 32-byte hex KEK. */
export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
  const key = await subtle().importKey('raw', buf(fromHex(keyHex)), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, buf(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptSecret(envelope: string, keyHex: string): Promise<string> {
  const raw = b64decode(envelope);
  const key = await subtle().importKey('raw', buf(fromHex(keyHex)), 'AES-GCM', false, ['decrypt']);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, buf(raw.slice(12)));
  return new TextDecoder().decode(pt);
}

// ── MD5 (RFC 1321) ─────────────────────────────────────────────────────────
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input: string | Uint8Array): string {
  const msg = typeof input === 'string' ? enc.encode(input) : input;
  const len = msg.length;
  const padLen = ((len + 8) >>> 6) * 64 + 64;
  const bytes = new Uint8Array(padLen);
  bytes.set(msg);
  bytes[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(bytes.buffer);
  dv.setUint32(padLen - 8, bitLen >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(bitLen / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padLen; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i]! + dv.getUint32(off + g * 4, true)) >>> 0;
      b = (b + ((x << S[i]!) | (x >>> (32 - S[i]!)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v, true));
  return toHex(out);
}
