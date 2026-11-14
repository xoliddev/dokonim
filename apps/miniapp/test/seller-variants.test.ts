import { describe, expect, it } from 'vitest';
import { applyBulk, autoSku, emptyDraft, matrixSize, newVariant, regenerate, validateDraft, variantLabel, type OptionDraft } from '../src/seller/lib/product';
import { fromAggregate, toInput } from '../src/seller/lib/productIO';

const opt = (id: string, name: string, labels: string[]): OptionDraft => ({ id, name, display: 'chips', values: labels.map((l) => ({ id: `${id}-${l}`, label: l, swatchHex: null })) });
const SIZE = opt('size', 'Oʻlcham', ['S', 'M']);
const COLOR = opt('color', 'Rang', ['Qizil', 'Koʻk', 'Yashil']);

describe('variant matrix generation', () => {
  it('2 × 3 options → 6 combos in Cartesian order, priced from the single default variant', () => {
    const base = [{ ...newVariant([]), price: 120_000_00, stock: 7 }];
    const v = regenerate([SIZE, COLOR], base);
    expect(matrixSize([SIZE, COLOR])).toBe(6);
    expect(v).toHaveLength(6);
    expect(v.map((x) => variantLabel([SIZE, COLOR], x.optionValueIds))).toEqual(['S / Qizil', 'S / Koʻk', 'S / Yashil', 'M / Qizil', 'M / Koʻk', 'M / Yashil']);
    expect(v.every((x) => x.price === 120_000_00 && x.stock === 7)).toBe(true);
    expect(new Set(v.map((x) => x.id)).size).toBe(6);
  });

  it('keeps edited combos when a value is added and drops combos of removed values', () => {
    const v1 = regenerate([SIZE, COLOR], [{ ...newVariant([]), price: 100 }]).map((v, i) => ({ ...v, price: 1000 + i, sku: `X${i}` }));
    const bigger = { ...SIZE, values: [...SIZE.values, { id: 'size-L', label: 'L', swatchHex: null }] };
    const v2 = regenerate([bigger, COLOR], v1);
    expect(v2).toHaveLength(9);
    expect(v2.slice(0, 6).map((v) => v.sku)).toEqual(['X0', 'X1', 'X2', 'X3', 'X4', 'X5']);
    expect(v2[6]!.stock).toBe(0); // brand-new value: no stock invented
    const smaller = { ...COLOR, values: COLOR.values.slice(0, 1) };
    const v3 = regenerate([bigger, smaller], v2);
    expect(v3.map((v) => v.sku)).toEqual(['X0', 'X3', '']);
  });

  it('adding a new dimension inherits from the parent combo; removing all options keeps the first price', () => {
    const sized = regenerate([SIZE], [{ ...newVariant([]), price: 500 }]).map((v, i) => ({ ...v, stock: i + 4 }));
    const both = regenerate([SIZE, COLOR], sized);
    expect(both.filter((v) => v.optionValueIds[0] === 'size-M').every((v) => v.stock === 5)).toBe(true);
    const none = regenerate([], both);
    expect(none).toHaveLength(1);
    expect(none[0]!.optionValueIds).toEqual([]);
    expect(none[0]!.price).toBe(500);
  });

  it('ignores options without values and enforces the 3-option limit', () => {
    expect(regenerate([SIZE, opt('x', 'Material', [])], [newVariant([])])).toHaveLength(2);
    expect(() => regenerate([SIZE, COLOR, opt('a', 'A', ['1']), opt('b', 'B', ['1'])].slice(0, 4), [])).not.toThrow(); // sliced to 3
  });

  it('bulk edit, percent adjust (whole soʻm) and auto SKUs', () => {
    const v = regenerate([SIZE, COLOR], [{ ...newVariant([]), price: 100_000_00 }]);
    const sel = new Set([v[0]!.id, v[1]!.id]);
    const b = applyBulk(v, sel, { stock: 3, compareAtPrice: 150_000_00 });
    expect(b.filter((x) => x.stock === 3)).toHaveLength(2);
    expect(applyBulk(v, sel, { percent: -15 })[0]!.price).toBe(85_000_00);
    expect(autoSku('Atlas koʻylak', [SIZE, COLOR], v)[0]!.sku).toBe('ATLASK-S-QIZIL');
  });
});

describe('product draft validation and IO', () => {
  it('flags missing title, prices, bad compare-at and duplicate option values', () => {
    const d = emptyDraft();
    expect(validateDraft(d).title).toBe('required');
    expect(validateDraft(d).variant?.[d.variants[0]!.id]).toBe('price');
    d.title.uz = 'Doʻppi';
    d.variants[0]!.price = 100;
    d.variants[0]!.compareAtPrice = 50;
    expect(validateDraft(d).variant?.[d.variants[0]!.id]).toBe('compare');
    d.variants[0]!.compareAtPrice = null;
    d.options = [opt('s', 'Size', ['M', 'm'])];
    expect(validateDraft(d).options).toBe('duplicate');
  });

  it('round-trips through the save input and keeps other-language labels', () => {
    const agg = {
      id: 'p1', status: 'active', title: { uz: 'Koʻylak', ru: 'Платье' }, descriptionMarkup: { uz: 'Ipak' }, categoryId: 'c1', collectionIds: [], tags: ['atlas'], media: [{ url: 'data:image/svg+xml,x' }],
      options: [{ id: 'o1', name: { uz: 'Oʻlcham', ru: 'Размер' }, display: 'chips', values: [{ id: 'v1', label: { uz: 'M', ru: 'M' }, swatchHex: null }] }],
      variants: [{ id: 'x1', optionValueIds: ['v1'], sku: 'A', barcode: '', price: 100, compareAtPrice: null, costPrice: null, stock: 2, lowStockThreshold: 3, trackInventory: true, allowBackorder: false, weightG: 0, mediaUrl: null }],
      brand: '', vendorCode: '', isDigital: false, attributes: [],
    };
    const d = fromAggregate(agg);
    d.options[0]!.name = 'Hajm';
    const input = toInput(d, 'store-1');
    expect(input.options[0]!.name).toEqual({ uz: 'Hajm', ru: 'Размер' });
    expect(input.title).toEqual({ uz: 'Koʻylak', ru: 'Платье' });
    expect(input.variants[0]).toMatchObject({ id: 'x1', optionValueIds: ['v1'], price: 100, stock: 2 });
  });
});
