import { describe, expect, it } from 'vitest';
import { createInput, initialDraft, stepValid, withName, withPreset, withSlug, withType } from '../src/seller/screens/onboarding/draft';
import { parseSom, somText } from '../src/seller/lib/ctx';

describe('create-store wizard draft', () => {
  it('derives the slug from the name until the owner edits it', () => {
    let d = withName(initialDraft(), 'Dilnoza Atelier');
    expect(d.slug).toBe('dilnoza-atelier');
    d = withSlug(d, 'My Shop!');
    expect(d.slug).toBe('myshop');
    expect(withName(d, 'Other').slug).toBe('myshop');
  });

  it('name step needs a valid, server-confirmed free slug', () => {
    const d = withName(initialDraft(), 'Choy uyi');
    expect(stepValid('name', d, true)).toBe(true);
    expect(stepValid('name', d, false)).toBe(false);
    expect(stepValid('name', d, null)).toBe(false);
    expect(stepValid('name', withSlug(d, 'new'), true)).toBe(false); // reserved
  });

  it('business type re-suggests a preset and digital switches payments to Stars', () => {
    const food = withType(initialDraft(), 'food');
    expect(food.presetId).toBe('choyxona');
    const digital = withType(food, 'digital');
    expect(digital.payments).toEqual({ cod: false, sandboxPayme: false, sandboxClick: false, stars: true });
    expect(withPreset(digital, 'volt').brand).toBe('#0f6fd6');
  });

  it('first product is optional but needs a price when titled; payload is well-formed', () => {
    let d = withName(initialDraft(), 'Test');
    expect(stepValid('first', d, null)).toBe(true);
    d = { ...d, first: { title: 'Doʻppi', price: null, imageUrl: null } };
    expect(stepValid('first', d, null)).toBe(false);
    d = { ...d, first: { ...d.first, price: parseSom('120 000') } };
    expect(stepValid('first', d, null)).toBe(true);
    expect(createInput(d, 'uz').firstProduct).toMatchObject({ title: 'Doʻppi', price: 12_000_000 });
  });
});

describe('soʻm ⇄ tiyin', () => {
  it('parses grouped input and formats back', () => {
    expect(parseSom('1 250 000')).toBe(125_000_000);
    expect(parseSom('12,5')).toBe(1250);
    expect(parseSom('')).toBeNull();
    expect(Number.isNaN(parseSom('12a'))).toBe(true);
    expect(somText(125_000_000)).toBe('1 250 000');
  });
});
