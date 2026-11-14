/**
 * Access tokens (§16.1): HS256 JWT, 15 min, claims sub=userId, tg=telegramId, adm=isPlatformAdmin, loc=locale, nm=name.
 * The Actor of every request is rebuilt from these claims alone (no DB hit per request).
 */
import { jwtVerify, SignJWT } from 'jose';
import { toLocale } from '@dokonim/core';
import type { Actor, UserRow } from '@dokonim/db';

export const ACCESS_TTL_SEC = 15 * 60;
const ISSUER = 'dokonim';
const AUDIENCE = 'dokonim-api';

export interface TokenService {
  sign(user: UserRow): Promise<string>;
  /** null for anything that is not a valid, unexpired token of ours. */
  verify(token: string): Promise<Actor | null>;
}

export function createTokenService(secret: string, now: () => Date): TokenService {
  if (secret.length < 32) throw new Error('jwtSecret must be at least 32 characters');
  const key = new TextEncoder().encode(secret);
  return {
    async sign(u) {
      const iat = Math.floor(now().getTime() / 1000);
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').slice(0, 80);
      return new SignJWT({ tg: u.telegramId, adm: !!u.isPlatformAdmin, loc: toLocale(u.languageCode), nm: name })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(u.id)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TTL_SEC)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload: p } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE, currentDate: now() });
        if (typeof p.sub !== 'string' || typeof p.tg !== 'number') return null;
        return {
          userId: p.sub,
          telegramId: p.tg,
          isPlatformAdmin: p.adm === true,
          locale: toLocale(typeof p.loc === 'string' ? p.loc : undefined),
          ...(typeof p.nm === 'string' && p.nm ? { name: p.nm } : {}),
        };
      } catch {
        return null;
      }
    },
  };
}

/** `Authorization: Bearer <jwt>` → the token, else null. */
export function bearerOf(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}
