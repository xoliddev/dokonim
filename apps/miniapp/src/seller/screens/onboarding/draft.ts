/** Onboarding wizard state + pure validation (unit-tested). */
import { checkStoreSlug, PRESETS, presetsFor, slugify, type BusinessType, type FontPairId } from '@dokonim/core';

export interface WizardDraft {
  name: string;
  slug: string;
  slugTouched: boolean;
  businessType: BusinessType;
  presetId: string;
  brand: string;
  fontPair: FontPairId;
  logoUrl: string | null;
  palette: string[];
  first: { title: string; price: number | null; imageUrl: string | null };
  payments: { cod: boolean; sandboxPayme: boolean; sandboxClick: boolean; stars: boolean };
}

export function initialDraft(): WizardDraft {
  const p = presetsFor('clothing')[0]!;
  return {
    name: '',
    slug: '',
    slugTouched: false,
    businessType: 'clothing',
    presetId: p.id,
    brand: p.tokens.brand,
    fontPair: p.tokens.fontPair,
    logoUrl: null,
    palette: [],
    first: { title: '', price: null, imageUrl: null },
    payments: { cod: true, sandboxPayme: true, sandboxClick: true, stars: false },
  };
}

/** Name edits drive the slug until the owner edits the slug by hand. */
export function withName(d: WizardDraft, name: string): WizardDraft {
  return { ...d, name, slug: d.slugTouched ? d.slug : slugify(name) };
}

export function withSlug(d: WizardDraft, raw: string): WizardDraft {
  const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  return { ...d, slug, slugTouched: true };
}

/** Switching the business type re-suggests the matching preset (unless the brand was customised). */
export function withType(d: WizardDraft, bt: BusinessType): WizardDraft {
  const p = presetsFor(bt)[0]!;
  const customBrand = d.brand !== (PRESETS.find((x) => x.id === d.presetId)?.tokens.brand ?? d.brand);
  return {
    ...d,
    businessType: bt,
    presetId: p.id,
    fontPair: p.tokens.fontPair,
    brand: customBrand ? d.brand : p.tokens.brand,
    payments: bt === 'digital' ? { cod: false, sandboxPayme: false, sandboxClick: false, stars: true } : d.payments.stars && !d.payments.cod ? { cod: true, sandboxPayme: true, sandboxClick: true, stars: false } : d.payments,
  };
}

export function withPreset(d: WizardDraft, presetId: string): WizardDraft {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return d;
  return { ...d, presetId, brand: p.tokens.brand, fontPair: p.tokens.fontPair };
}

export function draftTokens(d: WizardDraft) {
  const p = PRESETS.find((x) => x.id === d.presetId) ?? PRESETS[0]!;
  return { ...p.tokens, brand: d.brand, fontPair: d.fontPair };
}

export type StepId = 'name' | 'type' | 'brand' | 'first' | 'pay';
export const STEPS: StepId[] = ['name', 'type', 'brand', 'first', 'pay'];

/** Is the step complete enough to continue? `slugFree` is the server's availability answer. */
export function stepValid(step: StepId, d: WizardDraft, slugFree: boolean | null): boolean {
  switch (step) {
    case 'name':
      return d.name.trim().length >= 2 && checkStoreSlug(d.slug) === null && slugFree === true;
    case 'first':
      // either skipped (empty title) or a title with a valid price
      return !d.first.title.trim() || (d.first.price != null && Number.isFinite(d.first.price) && d.first.price > 0);
    case 'pay':
      return d.payments.cod || d.payments.sandboxPayme || d.payments.sandboxClick || d.payments.stars;
    default:
      return true;
  }
}

export function createInput(d: WizardDraft, locale: 'uz' | 'ru' | 'en') {
  const first = d.first.title.trim() && d.first.price ? { title: d.first.title.trim(), price: d.first.price, imageUrl: d.first.imageUrl, stock: 10 } : null;
  return {
    name: d.name.trim(),
    slug: d.slug,
    businessType: d.businessType,
    brand: d.brand,
    presetId: d.presetId,
    fontPair: d.fontPair,
    logoUrl: d.logoUrl,
    locale,
    firstProduct: first,
    payments: d.payments,
  };
}
