import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allocate, buildSearchDoc, buildStartParam, checkStoreSlug, cyrillicToLatin, formatMoney, GROUP_SEP, isUuid, md5,
  normalizeUzbekApostrophes, parseStartParam, pick, prng, searchKey, slugAlternatives, slugify, uuidTimestamp, uuidv7,
  can, canAssignRole, ROLES, PERMISSIONS, requirePermission, signInitData, validateInitData, encryptSecret, decryptSecret,
  timingSafeEqual, sha256Hex, campaignTag, utf8b64, utf8fromb64, missingLocales, percentOf, roundToMajor,
} from '../src';

describe('money', () => {
  it('formats UZS with narrow no-break group separators and localised suffix', () => {
    expect(formatMoney(125_000_000)).toBe(`1${GROUP_SEP}250${GROUP_SEP}000${GROUP_SEP}so‘m`);
    expect(formatMoney(125_000_000, 'UZS', 'ru')).toBe(`1${GROUP_SEP}250${GROUP_SEP}000${GROUP_SEP}сум`);
    expect(formatMoney(0)).toBe(`0${GROUP_SEP}so‘m`);
    expect(formatMoney(50, 'XTR')).toBe(`50${GROUP_SEP}⭐`);
    expect(formatMoney(-990000)).toBe(`-9${GROUP_SEP}900${GROUP_SEP}so‘m`);
  });
  it('percentOf floors to whole so‘m', () => {
    expect(percentOf(100_050, 10)).toBe(10_000);
    expect(percentOf(999_900, 12.5)).toBe(124_900);
    expect(roundToMajor(150)).toBe(200);
  });
  it('allocate: Σ parts === total and parts are proportional within one unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }).map((x) => x * 100),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          const sumW = weights.reduce((a, b) => a + b, 0);
          if (sumW === 0) return parts.every((p) => p === 0);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          parts.forEach((p, i) => expect(Math.abs(p - (total * weights[i]!) / sumW)).toBeLessThanOrEqual(100));
          return true;
        },
      ),
    );
  });
});

describe('ids', () => {
  it('uuidv7 is valid, version 7 and time-sortable', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(uuidTimestamp(a)).toBe(1_700_000_000_000);
    expect(a < b).toBe(true);
  });
  it('is monotonic inside the same millisecond', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(1_700_000_000_123));
    expect([...ids].sort()).toEqual(ids);
  });
  it('prng is deterministic', () => {
    const a = prng(42), b = prng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('text normalisation', () => {
  it('folds Cyrillic, apostrophes and case to one search key', () => {
    const k = searchKey('koylak');
    expect(searchKey('кўйлак')).toBe(k);
    expect(searchKey("Ko'ylak")).toBe(k);
    expect(searchKey('Koʻylak')).toBe(k);
    expect(searchKey('KO`YLAK')).toBe(k);
    expect(searchKey('Шоколад')).toBe('shokolad');
    expect(cyrillicToLatin('Ғалла')).toBe('Galla');
  });
  it('canonicalises oʻ/gʻ for display', () => {
    expect(normalizeUzbekApostrophes("ko'ylak va g'isht")).toBe('koʻylak va gʻisht');
    expect(normalizeUzbekApostrophes("ma'lumot")).toBe('maʼlumot');
  });
  it('search doc de-duplicates words', () => {
    expect(buildSearchDoc(['Atlas koʻylak', 'атлас', null, 'AT-001'])).toBe('atlas koylak at 001');
  });
});

describe('slugs', () => {
  it('slugifies Latin and Cyrillic names', () => {
    expect(slugify('Dilnoza Atelier')).toBe('dilnoza-atelier');
    expect(slugify('Дилноза ателье')).toBe('dilnoza-atele');
    expect(slugify("Choyxona Market!!")).toBe('choyxona-market');
  });
  it('validates store slugs', () => {
    expect(checkStoreSlug('ab')).toBe('too_short');
    expect(checkStoreSlug('admin')).toBe('reserved');
    expect(checkStoreSlug('-abc')).toBe('format');
    expect(checkStoreSlug('shop-p-x')).toBe('format');
    expect(checkStoreSlug('m-shop')).toBe('format');
    expect(checkStoreSlug('atlas-adras')).toBeNull();
  });
  it('suggests free alternatives', () => {
    const taken = new Set(['atlas', 'atlas-shop']);
    const alts = slugAlternatives('atlas', (s) => taken.has(s));
    expect(alts.length).toBe(3);
    alts.forEach((a) => expect(taken.has(a)).toBe(false));
  });
  it('generated slugs are always valid or empty', () => {
    fc.assert(fc.property(fc.string({ maxLength: 60 }), (s) => {
      const slug = slugify(s);
      return slug === '' || slug.length < 3 || !/[^a-z0-9-]/.test(slug);
    }));
  });
});

describe('startapp grammar', () => {
  it('round-trips every payload kind', () => {
    const payloads = [
      { kind: 'new' } as const,
      { kind: 'manage', slug: 'atlas-adras' } as const,
      { kind: 'store', slug: 'atlas-adras' } as const,
      { kind: 'store', slug: 'atlas-adras', campaign: 'insta_nov' } as const,
      { kind: 'product', slug: 'atlas-adras', productShortId: 'k3x9a1b2' } as const,
      { kind: 'order', slug: 'choyxona-market', orderShortId: 'zz81q0aa' } as const,
    ];
    for (const p of payloads) expect(parseStartParam(buildStartParam(p))).toEqual(p);
    expect(parseStartParam('')).toEqual({ kind: 'hub' });
    expect(parseStartParam('bad payload!')).toEqual({ kind: 'hub' });
    expect(campaignTag('Insta Nov!')).toBe('insta_nov_');
  });
});

describe('locale helpers', () => {
  it('falls back user → store default → first non-empty', () => {
    expect(pick({ uz: 'Koʻylak', ru: 'Платье' }, 'ru')).toBe('Платье');
    expect(pick({ uz: 'Koʻylak' }, 'en')).toBe('Koʻylak');
    expect(pick({ ru: 'Платье' }, 'en', 'uz')).toBe('Платье');
    expect(missingLocales({ uz: 'a', ru: ' ' }, ['uz', 'ru', 'en'])).toEqual(['ru', 'en']);
  });
});

describe('permissions', () => {
  it('matches the §16.3 matrix', () => {
    expect(can('owner', 'payments.configure')).toBe(true);
    expect(can('admin', 'payments.configure')).toBe(false);
    expect(can('manager', 'orders.refund')).toBe(true);
    expect(can('order_operator', 'orders.refund')).toBe(false);
    expect(can('order_operator', 'catalog.write')).toBe(false);
    expect(can('catalog_editor', 'catalog.write')).toBe(true);
    expect(can('viewer', 'analytics.read')).toBe(true);
    expect(can('viewer', 'audit.read')).toBe(false);
    expect(can(null, 'dashboard.read')).toBe(false);
    expect(() => requirePermission('viewer', 'catalog.write')).toThrow(/Missing permission/);
    for (const r of ROLES) expect(can(r, 'dashboard.read')).toBe(true);
    expect(PERMISSIONS.every((p) => can('owner', p))).toBe(true);
  });
  it('nobody grants owner; admins cannot mint admins', () => {
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'manager')).toBe(true);
    expect(canAssignRole('manager', 'viewer')).toBe(false);
    for (const r of ROLES) expect(canAssignRole(r, 'owner')).toBe(false);
  });
});

describe('crypto', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a');
    expect(md5('Oʻzbekiston')).toHaveLength(32);
  });
  it('sha256 and constant-time equality', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
  it('AES-GCM envelope round-trips and detects tampering', async () => {
    const key = 'a'.repeat(64);
    const env = await encryptSecret('{"key":"secret"}', key);
    expect(await decryptSecret(env, key)).toBe('{"key":"secret"}');
    const tampered = env.slice(0, -4) + (env.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptSecret(tampered, key)).rejects.toThrow();
    expect(utf8fromb64(utf8b64('Doʻkonim'))).toBe('Doʻkonim');
  });
});

describe('Telegram initData', () => {
  const token = '123456:TEST-token';
  const user = { id: 777, first_name: 'Sardor', language_code: 'uz' };
  it('accepts correctly signed data', async () => {
    const init = await signInitData({ user, startParam: 'atlas-adras' }, token);
    const v = await validateInitData(init, token);
    expect(v.user.id).toBe(777);
    expect(v.startParam).toBe('atlas-adras');
  });
  it('rejects wrong token, tampering and stale auth_date', async () => {
    const init = await signInitData({ user }, token);
    await expect(validateInitData(init, '999:other')).rejects.toThrow(/signature/);
    await expect(validateInitData(init.replace('Sardor', 'Hacker'), token)).rejects.toThrow(/signature/);
    const old = await signInitData({ user, authDate: new Date(Date.now() - 2 * 86_400_000) }, token);
    await expect(validateInitData(old, token)).rejects.toThrow(/expired/);
    await expect(validateInitData('user=%7B%7D', token)).rejects.toThrow(/hash/);
  });

  it('includes the signature field in the HMAC check, as real clients send it', async () => {
    const init = await signInitData({ user, queryId: 'AAE1', signature: 'c2lnbmF0dXJl' }, token);
    expect((await validateInitData(init, token)).user.id).toBe(user.id);
    const stripped = new URLSearchParams(init);
    stripped.delete('signature');
    await expect(validateInitData(stripped.toString(), token)).rejects.toThrow(/signature/);
  });
  it('matches an independently computed vector (node:crypto)', async () => {
    const { createHmac } = await import('node:crypto');
    const init = await signInitData({ user, authDate: new Date(1_700_000_000_000) }, token);
    const params = new URLSearchParams(init);
    const hash = params.get('hash');
    params.delete('hash');
    const dcs = [...params].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    expect(createHmac('sha256', secret).update(dcs).digest('hex')).toBe(hash);
  });
});
