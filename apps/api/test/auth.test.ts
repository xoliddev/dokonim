import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { signInitData } from '@dokonim/core';
import { ADAPTERS, makeApi, nextIp, type Api, type J } from './helpers';

describe.each(ADAPTERS)('auth over HTTP on $name', ({ make }) => {
  let api: Api;
  beforeAll(async () => {
    api = await makeApi(make, { platformAdminTelegramIds: [4242] });
  });
  afterAll(() => api.close());

  const loginWith = (initData: unknown, ip = nextIp()) => api.app.inject({ method: 'POST', url: '/v1/auth/telegram', payload: { initData }, remoteAddress: ip });

  it('valid initData → access JWT (HS256, 15 min) + refresh token + user', async () => {
    const res = await loginWith(await api.initData({ first_name: 'Sardor', language_code: 'ru', id: 777001 }));
    expect(res.statusCode).toBe(200);
    const j = res.json() as J;
    expect(j.accessToken.split('.')).toHaveLength(3);
    expect(j.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    expect(j.expiresIn).toBe(900);
    expect(j.user).toMatchObject({ telegramId: 777001, firstName: 'Sardor', isPlatformAdmin: false });
    const header = JSON.parse(Buffer.from(j.accessToken.split('.')[0], 'base64url').toString()) as J;
    const claims = JSON.parse(Buffer.from(j.accessToken.split('.')[1], 'base64url').toString()) as J;
    expect(header.alg).toBe('HS256');
    expect(claims).toMatchObject({ sub: j.user.id, tg: 777001, adm: false, loc: 'ru' });
    expect(claims.exp - claims.iat).toBe(900);
    const me = await api.call('me.get', {}, j.accessToken);
    expect(me.statusCode).toBe(200);
    expect((me.json() as J).user.id).toBe(j.user.id);
  });

  it('tampered, expired, wrong-bot and missing initData are rejected', async () => {
    const good = await api.initData({ first_name: 'Eve' });
    const p = new URLSearchParams(good);
    p.set('user', JSON.stringify({ id: 1, first_name: 'Admin' }));
    const tampered = await loginWith(p.toString());
    expect(tampered.statusCode).toBe(401);
    expect((tampered.json() as J).error.code).toBe('UNAUTHENTICATED');

    const old = await api.initData({ first_name: 'Old' }, new Date(api.h.clock.now().getTime() - 2 * 86_400_000));
    const expired = await loginWith(old);
    expect(expired.statusCode).toBe(401);
    expect((expired.json() as J).error.message).toMatch(/expired/);

    const otherBot = await signInitData({ user: { id: 5, first_name: 'X' }, authDate: api.h.clock.now() }, '1:other-bot-token-aaaaaaaaaaaaaaaaaaaaaaa');
    expect((await loginWith(otherBot)).statusCode).toBe(401);

    const noHash = await loginWith('auth_date=1&user=%7B%7D');
    expect(noHash.statusCode).toBe(401);

    const missing = await api.app.inject({ method: 'POST', url: '/v1/auth/telegram', payload: {}, remoteAddress: nextIp() });
    expect(missing.statusCode).toBe(422);
    expect((missing.json() as J).error).toMatchObject({ code: 'VALIDATION', details: { field: 'initData' } });
  });

  it('user routes require a valid bearer token → 401 UNAUTHENTICATED', async () => {
    const none = await api.call('me.get', {});
    expect(none.statusCode).toBe(401);
    expect((none.json() as J).error.code).toBe('UNAUTHENTICATED');
    expect((await api.call('me.get', {}, 'not-a-jwt')).statusCode).toBe(401);
    const forged = await new SignJWT({ tg: 1, adm: true, loc: 'uz' }).setProtectedHeader({ alg: 'HS256' }).setSubject('0190a000-0000-7000-8000-000000000000').setIssuer('dokonim').setAudience('dokonim-api').setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode('some-other-secret-that-is-32-chars-long!!'));
    expect((await api.call('me.get', {}, forged)).statusCode).toBe(401);
    const { token } = await api.login('Clock');
    expect((await api.call('me.get', {}, token)).statusCode).toBe(200);
    api.h.clock.advance(16 * 60_000);
    const stale = await api.call('me.get', {}, token);
    expect(stale.statusCode).toBe(401);
    expect((stale.json() as J).error.message).toMatch(/expired/);
    // public routes: an expired bearer is a 401 too (so the client refreshes); no bearer at all is anonymous
    const stalePublic = await api.call('stores.slugAvailable', { slug: 'some-shop' }, token);
    expect(stalePublic.statusCode).toBe(401);
    expect((stalePublic.json() as J).error.message).toMatch(/expired/);
    expect((await api.call('stores.slugAvailable', { slug: 'some-shop' })).statusCode).toBe(200);
    // every user route without a token → 401 (before validation)
    expect((await api.call('orders.place', { slug: 'x' })).statusCode).toBe(401);
    expect((await api.call('admin.store.get', { storeId: 'nope' })).statusCode).toBe(401);
  });

  it('refresh rotates; reusing an old refresh token revokes the whole family', async () => {
    const s = await api.login('Rotator');
    const r1 = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: s.refresh }, remoteAddress: nextIp() });
    expect(r1.statusCode).toBe(200);
    const p1 = r1.json() as J;
    expect(p1.refreshToken).not.toBe(s.refresh);
    expect((await api.call('me.get', {}, p1.accessToken)).statusCode).toBe(200);
    // reuse of the first token → 401 …
    const reuse = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: s.refresh }, remoteAddress: nextIp() });
    expect(reuse.statusCode).toBe(401);
    expect((reuse.json() as J).error.message).toMatch(/reuse/);
    // … and the legitimately rotated token of the same family is now dead too
    const after = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: p1.refreshToken }, remoteAddress: nextIp() });
    expect(after.statusCode).toBe(401);
    const unknown = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'f'.repeat(64) }, remoteAddress: nextIp() });
    expect(unknown.statusCode).toBe(401);
  });

  it('PLATFORM_ADMIN_TELEGRAM_IDS marks the user admin on login; others get 403 on platform routes', async () => {
    const admin = await api.login('Xolid', { id: 4242 });
    expect(admin.user.isPlatformAdmin).toBe(true);
    const claims = JSON.parse(Buffer.from(admin.token.split('.')[1]!, 'base64url').toString()) as J;
    expect(claims.adm).toBe(true);
    expect((await api.call('platform.stores', {}, admin.token)).statusCode).toBe(200);
    const nobody = await api.login('Nobody');
    const res = await api.call('platform.stores', {}, nobody.token);
    expect(res.statusCode).toBe(403);
    expect((res.json() as J).error.code).toBe('FORBIDDEN');
  });

  it('auth is rate limited: the 11th login from one IP within a minute → 429', async () => {
    const ip = '203.0.113.77';
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await loginWith(await api.initData({ first_name: `Burst${i}` }), ip)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
    const res = await loginWith(await api.initData({ first_name: 'Again' }), ip);
    expect(res.statusCode).toBe(429);
    expect((res.json() as J).error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
    // another IP is unaffected
    expect((await loginWith(await api.initData({ first_name: 'Other' }))).statusCode).toBe(200);
  });
});
