import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../src/api/http';
import { ApiError } from '../src/api/types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (code: string, message: string, details: Record<string, unknown> = {}) => ({ error: { code, message, details } });

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('HttpApi', () => {
  it('unwraps the server error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, envelope('OUT_OF_STOCK', 'Out of stock', { field: 'qty' }))),
    );
    const c = createHttpApi('http://api', () => '');
    const err = (await c.api['store.get']({ slug: 'atlas' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('OUT_OF_STOCK');
    expect(err.message).toBe('Out of stock');
    expect(err.details).toEqual({ field: 'qty' });
    expect(err.status).toBe(409);
  });

  it('shares one refresh between concurrent 401s', async () => {
    sessionStorage.setItem('dokonim.refresh', 'R1');
    let n = 1; // current refresh token generation
    let valid = ''; // the access token the server accepts
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/v1/auth/refresh')) {
          const { refreshToken } = JSON.parse(String(init.body)) as { refreshToken: string };
          // replaying an already-rotated token is reuse: the server revokes the family
          if (refreshToken !== `R${n}`) return json(401, envelope('UNAUTHENTICATED', 'reuse'));
          await new Promise((r) => setTimeout(r, 5));
          n++;
          valid = `A${n}`;
          return json(200, { accessToken: valid, refreshToken: `R${n}` });
        }
        const auth = (init.headers as Record<string, string>).authorization;
        return auth === `Bearer ${valid}` ? json(200, { ok: true }) : json(401, envelope('UNAUTHENTICATED', 'expired'));
      }),
    );
    const c = createHttpApi('http://api', () => '');
    expect(await c.api['me.get'](undefined)).toEqual({ ok: true });
    expect(n).toBe(2);
    valid = 'expired';
    const results = await Promise.all([c.api['me.get'](undefined), c.api['me.get'](undefined), c.api['me.get'](undefined)]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(n).toBe(3);
    expect(sessionStorage.getItem('dokonim.refresh')).toBe('R3');
  });
});
