import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  collectionMatches, compileTheme, contrast, defaultSections, diff, fromMarkup, funnel, hexToOklch, moveSection, oklchToHex,
  paletteFromPixels, parseCsv, planProductImport, PRESETS, sanitizeRichText, sanitizeSections, sanitizeTokens, splitCategoryPath,
  toCsv, toMarkup, toPlainText, tonalRamp, DEFAULT_TOKENS, sparklinePath, prohibitedHits,
} from '../src';

describe('colour & theme', () => {
  it('OKLCH round-trips sRGB colours', () => {
    for (const hex of ['#a3195b', '#1f6e5a', '#0f6fd6', '#ffffff', '#000000', '#d9a21b']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });
  it('ramps go light → dark with 12 steps', () => {
    const r = tonalRamp('#A3195B');
    expect(r).toHaveLength(12);
    const ls = r.map((h) => hexToOklch(h).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeLessThan(ls[i - 1]!);
  });
  it('PROPERTY: any brand colour in any mode yields AA text contrast', () => {
    const hex = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255)).map(([r, g, b]) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`);
    fc.assert(
      fc.property(hex, fc.constantFrom('light', 'dark', 'brand', 'telegram') as fc.Arbitrary<'light'>, (brand, mode) => {
        const { vars } = compileTheme({ ...DEFAULT_TOKENS, brand, mode });
        expect(contrast(vars['--c-ink']!, vars['--c-surface']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars['--c-accent-text']!, vars['--c-surface']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars['--c-ink-muted']!, vars['--c-surface']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(vars['--c-on-accent']!, vars['--c-accent']!)).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 300 },
    );
  });
  it('telegram mode adopts themeParams neutrals', () => {
    const t = compileTheme({ ...DEFAULT_TOKENS, mode: 'telegram' }, { telegram: { bg_color: '#17212b', text_color: '#f5f5f5', hint_color: '#a0aab5', secondary_bg_color: '#0e1621' } });
    expect(t.vars['--c-surface']).toBe('#17212b');
    expect(t.scheme).toBe('dark');
  });
  it('sanitises tokens and presets are valid', () => {
    expect(sanitizeTokens({ brand: 'red', radius: 'huge', mode: 'dark', evil: 1 })).toEqual({ ...DEFAULT_TOKENS, mode: 'dark' });
    expect(PRESETS).toHaveLength(8);
    for (const p of PRESETS) expect(sanitizeTokens(p.tokens)).toEqual(p.tokens);
  });
  it('palette from pixels returns the dominant chromatic colours', () => {
    const px: number[] = [];
    for (let i = 0; i < 600; i++) px.push(163, 25, 91, 255);
    for (let i = 0; i < 300; i++) px.push(31, 110, 90, 255);
    for (let i = 0; i < 900; i++) px.push(255, 255, 255, 255);
    const pal = paletteFromPixels(px, 3);
    expect(pal[0]).toBe('#a3195b');
    expect(pal).toContain('#1f6e5a');
  });
  it('sections sanitise, dedupe and reorder', () => {
    const s = defaultSections('clothing', { uz: 'Atlas' });
    expect(s[0]!.type).toBe('hero');
    const dirty = [...s, { id: s[0]!.id, type: 'hero', settings: {} }, { id: 'x', type: 'script', settings: {} }];
    expect(sanitizeSections(dirty)).toHaveLength(s.length);
    const moved = moveSection(s, s[0]!.id, 2);
    expect(moved[2]!.id).toBe(s[0]!.id);
  });
});

describe('rich text', () => {
  it('parses light markup to a safe AST and back', () => {
    const src = '## Mato\n\nYumshoq **atlas**, _qoʻlda_ tikilgan.\n\n- Yuviladi\n- Dazmollanadi\n\n[Oʻlchamlar](https://example.uz/size)';
    const doc = fromMarkup(src);
    expect(doc.blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'p']);
    expect(toMarkup(doc)).toBe(src);
    expect(toPlainText(doc)).toContain('Yumshoq atlas');
  });
  it('drops scripts, javascript: links and unknown nodes', () => {
    const doc = sanitizeRichText({ t: 'doc', blocks: [{ t: 'script', children: [] }, { t: 'p', children: [{ t: 'text', text: 'x', href: 'javascript:alert(1)' }, { t: 'img', src: 'x' }] }] });
    expect(doc).toEqual({ t: 'doc', blocks: [{ t: 'p', children: [{ t: 'text', text: 'x' }] }] });
    expect(fromMarkup('[a](javascript:alert)').blocks[0]).toEqual({ t: 'p', children: [{ t: 'text', text: 'a' }] });
  });
});

describe('CSV import / export', () => {
  it('parses quotes, CRLF, semicolons and BOM', () => {
    expect(parseCsv('﻿a,"b,c","d ""q"""\r\n1,2,3\r\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips and neutralises formula injection', () => {
    const csv = toCsv([['Title', 'Note'], ['=HYPERLINK("x")', 'a,b'], ['-5', '+1']]);
    const back = parseCsv(csv);
    expect(back[1]![0]).toBe(`'=HYPERLINK("x")`);
    expect(back[2]).toEqual(['-5', `'+1`]);
    const tricky = parseCsv(toCsv([['-1+HYPERLINK("https://evil.example","Open")', -2.5]]));
    expect(tricky[0]).toEqual([`'-1+HYPERLINK("https://evil.example","Open")`, '-2.5']);
  });
  it('category paths split on / > |', () => {
    expect(splitCategoryPath('Kiyim / Ayollar / Koʻylaklar')).toEqual(['Kiyim', 'Ayollar', 'Koʻylaklar']);
    expect(splitCategoryPath('A>B | C')).toEqual(['A', 'B', 'C']);
  });
  it('plans a Shopify-style import with variants, category paths and row errors', () => {
    const csv = [
      'Handle,Title,Body (HTML),Vendor,Tags,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Variant Compare At Price,Variant Inventory Qty,Category Path',
      'atlas-dress,Atlas koʻylak,<p>Ipak</p>,Marg‘ilon,"yangi, atlas",Oʻlcham,S,Rang,Qizil,AD-S-R,450000,520000,5,Kiyim / Ayollar / Koʻylaklar',
      'atlas-dress,,,,,,M,,Qizil,AD-M-R,450000,,3,',
      'atlas-dress,,,,,,M,,Qizil,AD-M-R2,450000,,3,',
      'tea,Yashil choy,,,,,,,,TEA-1,abc,,2,Oziq-ovqat / Choy',
      'scarf,Ipak roʻmol,,,,,,,,SC-1,120000,,x,Kiyim / Aksessuarlar',
    ].join('\n');
    const plan = planProductImport(csv);
    expect(plan.products).toHaveLength(1);
    const p = plan.products[0]!;
    expect(p.variants.map((v) => v.options)).toEqual([['S', 'Qizil'], ['M', 'Qizil']]);
    expect(p.variants[0]).toMatchObject({ price: 45_000_000, compareAt: 52_000_000, stock: 5 });
    expect(p.description).toBe('Ipak');
    expect(p.tags).toEqual(['yangi', 'atlas']);
    expect(plan.errors.map((e) => [e.row, e.code])).toEqual([[4, 'duplicate_variant'], [5, 'bad_price'], [6, 'bad_stock']]);
    expect(plan.categoryPaths).toEqual([['Kiyim'], ['Kiyim', 'Ayollar'], ['Kiyim', 'Ayollar', 'Koʻylaklar']]);
  });
  it('reports missing columns', () => {
    expect(planProductImport('Foo,Bar\n1,2').errors.map((e) => e.code)).toEqual(['missing_column', 'missing_column']);
  });
});

describe('collections, diff, analytics', () => {
  const subj = { tags: ['Yangi'], minPrice: 10_000_000, categoryPath: 'a.b', onSale: true, createdAt: '2026-11-10T00:00:00Z', vendor: 'Atlas', title: 'Atlas koʻylak', inStock: true };
  const now = new Date('2026-11-13T00:00:00Z');
  it('automated collection rules', () => {
    expect(collectionMatches({ match: 'all', rules: [{ field: 'tag', op: 'eq', value: 'yangi' }, { field: 'price', op: 'lt', value: 20_000_000 }] }, subj, now)).toBe(true);
    expect(collectionMatches({ match: 'all', rules: [{ field: 'category', op: 'in_subtree', value: 'a' }, { field: 'created_within_days', op: 'lt', value: 2 }] }, subj, now)).toBe(false);
    expect(collectionMatches({ match: 'any', rules: [{ field: 'category', op: 'in_subtree', value: 'x' }, { field: 'on_sale', op: 'eq', value: true }] }, subj, now)).toBe(true);
    expect(collectionMatches({ match: 'any', rules: [] }, subj, now)).toBe(false);
  });
  it('diff produces add/remove/replace ops and ignores noise', () => {
    expect(diff({ a: 1, b: { c: 2 }, updatedAt: 1 }, { a: 1, b: { c: 3 }, d: [1], updatedAt: 2 })).toEqual([
      { op: 'replace', path: '/b/c', from: 2, value: 3 },
      { op: 'add', path: '/d', value: [1] },
    ]);
  });
  it('funnel rates and sparkline', () => {
    const f = funnel({ store_view: 100, product_view: 50, add_to_cart: 20, begin_checkout: 10, purchase: 5 });
    expect(f.at(-1)).toEqual({ step: 'purchase', count: 5, rate: 0.05, fromPrev: 0.5 });
    expect(sparklinePath([0, 5, 10], 100, 20)).toMatch(/^M2\.0 18\.0 L50\.0 10\.0 L98\.0 2\.0$/);
    expect(prohibitedHits('Narkotik sotiladi')).toEqual(['narkotik']);
  });
});
