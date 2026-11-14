import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CATALOGS, allKeys, createI18n, daysFrom, formatCompact, formatDate, formatDateTime, formatMessage, formatMoney, formatRelativeDay,
  messageArgs, pluralCategory, rawMessage, translate, zonedParts, type MessageKey,
} from '../src';

const LOCALES = ['uz', 'ru', 'en'] as const;
const NNBSP = ' ';

describe('catalogues', () => {
  it('every area has the same keys in uz, ru and en', () => {
    for (const [area, cat] of Object.entries(CATALOGS)) {
      const uz = Object.keys(cat.uz).sort();
      expect(Object.keys(cat.ru).sort(), `${area}.ru`).toEqual(uz);
      expect(Object.keys(cat.en).sort(), `${area}.en`).toEqual(uz);
    }
  });

  it('every message parses and uses the same arguments in all locales', () => {
    for (const key of allKeys()) {
      const args = messageArgs(rawMessage('uz', key)!);
      for (const l of LOCALES) expect(messageArgs(rawMessage(l, key)!), `${l}:${key}`).toEqual(args);
    }
  });

  it('Uzbek uses canonical oʻ/gʻ (U+02BB), never ASCII or curly apostrophes after o/g', () => {
    for (const key of allKeys()) {
      const s = rawMessage('uz', key)!;
      expect(/[oOgG]['‘’`]/.test(s), `${key}: ${s}`).toBe(false);
    }
  });

  it('has a reasonable number of keys per area', () => {
    expect(allKeys().length).toBeGreaterThan(250);
    for (const area of ['common', 'store', 'checkout', 'seller']) expect(allKeys().some((k) => k.startsWith(`${area}.`))).toBe(true);
  });
});

describe('t()', () => {
  it('translates and interpolates', () => {
    const uz = createI18n('uz');
    expect(uz.t('store.addToCart')).toBe('Savatga qoʻshish');
    expect(uz.t('store.addedToCart', { title: 'Atlas koʻylak' })).toBe('Savatga qoʻshildi: Atlas koʻylak');
    expect(createI18n('ru').t('common.save')).toBe('Сохранить');
    expect(createI18n('en').t('common.demoLabel')).toBe('Demo mode — runs entirely in your browser');
  });

  it('falls back to the key for unknown keys', () => {
    expect(translate('ru', 'nope.missing' as MessageKey)).toBe('nope.missing');
  });

  it('plurals: uz one/other, ru one/few/many, exact =0 branches', () => {
    const uz = createI18n('uz');
    const ru = createI18n('ru');
    const en = createI18n('en');
    expect(uz.t('common.products', { n: 0 })).toBe('Mahsulot yoʻq');
    expect(uz.t('common.products', { n: 3 })).toBe('3 ta mahsulot');
    expect(ru.t('common.products', { n: 1 })).toBe('1 товар');
    expect(ru.t('common.products', { n: 3 })).toBe('3 товара');
    expect(ru.t('common.products', { n: 5 })).toBe('5 товаров');
    expect(ru.t('common.products', { n: 11 })).toBe('11 товаров');
    expect(ru.t('common.products', { n: 21 })).toBe('21 товар');
    expect(ru.t('common.products', { n: 1234 })).toBe(`1${NNBSP}234 товара`);
    expect(en.t('common.orders', { n: 1 })).toBe('1 order');
    expect(en.t('common.orders', { n: 1000 })).toBe('1,000 orders');
  });

  it('nested arguments inside plural branches', () => {
    expect(formatMessage('{rating} · {count, plural, one {# baho} other {# baho}}', { rating: '4.8', count: 12 }, 'uz')).toBe('4.8 · 12 baho');
  });

  it('rejects malformed messages', () => {
    expect(() => formatMessage('{n, plural, one {x}}', { n: 1 })).toThrow();
    expect(() => formatMessage('{n, select, a {x} other {y}}', { n: 1 })).toThrow();
  });

  it('ru plural categories match CLDR for 0..200', () => {
    const expected = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'one' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'few' : 'many');
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000 }), (n) => pluralCategory('ru', n) === expected(n)));
    expect(pluralCategory('uz', 1)).toBe('one');
    expect(pluralCategory('uz', 2)).toBe('other');
    expect(pluralCategory('ru', 1.5)).toBe('other');
  });
});

describe('money', () => {
  it('formats UZS minor units with a narrow no-break group separator', () => {
    expect(formatMoney(125_000_000, 'uz')).toBe(`1${NNBSP}250${NNBSP}000${NNBSP}so‘m`);
    expect(formatMoney(125_000_000, 'ru')).toBe(`1${NNBSP}250${NNBSP}000${NNBSP}сум`);
    expect(createI18n('en').money(50_000)).toBe(`500${NNBSP}UZS`);
  });

  it('compact KPI numbers', () => {
    expect(formatCompact(1_250_000, 'uz')).toBe('1,3 mln');
    expect(formatCompact(1_250_000, 'en')).toBe('1.3M');
    expect(formatCompact(48_500, 'ru')).toBe('48,5 тыс.');
    expect(formatCompact(950, 'uz')).toBe('950');
  });
});

describe('dates (store time zone)', () => {
  const now = new Date('2026-11-13T07:00:00Z'); // Friday 13 Nov, 12:00 in Tashkent

  it('formats in Asia/Tashkent by default', () => {
    expect(zonedParts('2026-11-13T20:30:00Z')).toMatchObject({ year: 2026, month: 11, day: 14, hour: 1, minute: 30, weekday: 6 });
    expect(formatDate('2026-11-12T10:00:00Z', 'uz', { weekday: true, now })).toBe('Payshanba, 12-noyabr');
    expect(formatDate('2026-11-12T10:00:00Z', 'ru', { now })).toBe('12 ноября');
    expect(formatDate('2025-03-08T10:00:00Z', 'en', { now })).toBe('8 March 2025');
    expect(formatDate('2025-03-08T10:00:00Z', 'uz', { now })).toBe('2025-yil 8-mart');
  });

  it('relative day phrases', () => {
    expect(formatRelativeDay('2026-11-13T18:00:00Z', 'uz', { now })).toBe('Bugun'); // 23:00 local, same day
  });

  it('uses calendar days in the store zone, not 24h windows', () => {
    // 18:00Z = 23:00 Tashkent (same day); 19:30Z = 00:30 next day
    expect(daysFrom('2026-11-13T18:00:00Z', now)).toBe(0);
    expect(daysFrom('2026-11-13T19:30:00Z', now)).toBe(1);
    expect(formatRelativeDay('2026-11-13T19:30:00Z', 'uz', { now })).toBe('Ertaga');
    expect(formatRelativeDay('2026-11-12T08:00:00Z', 'ru', { now })).toBe('Вчера');
    expect(formatRelativeDay('2026-11-16T08:00:00Z', 'uz', { now })).toBe('Dushanba, 16-noyabr');
    expect(formatRelativeDay('2026-11-13T19:30:00Z', 'en', { now, tz: 'UTC' })).toBe('Today');
  });

  it('date-time for timelines', () => {
    expect(formatDateTime('2026-11-13T04:05:00Z', 'uz', { now })).toBe('Bugun, 09:05');
    expect(formatDateTime('2026-11-01T04:05:00Z', 'en', { now })).toBe('1 Nov, 09:05');
  });

  it('createI18n binds locale, zone and clock', () => {
    const i = createI18n('ru', { now: () => now, tz: 'Asia/Tashkent' });
    expect(i.relativeDay('2026-11-14T06:00:00Z')).toBe('Завтра');
    expect(i.time('2026-11-13T07:00:00Z')).toBe('12:00');
    expect(i.l({ uz: 'Koʻylak', ru: 'Платье' })).toBe('Платье');
    expect(i.l({ uz: 'Koʻylak' })).toBe('Koʻylak');
  });
});
