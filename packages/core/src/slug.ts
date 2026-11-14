import { searchKey } from './text';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
export const RESERVED_SLUGS = new Set([
  'new', 'admin', 'api', 'm', 'manage', 's', 'shop', 'store', 'stores', 'app', 'help', 'support', 'dokonim',
  'telegram', 'login', 'settings', 'demo', 'www', 'static', 'assets', 'hooks', 'payme', 'click', 'uzum',
]);

/** Store slug from a display name ("Dilnoza Atelier" / "Дилноза ателье" → "dilnoza-atelier"). */
export function slugify(name: string, max = 32): string {
  const s = searchKey(name)
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s;
}

export type SlugProblem = 'too_short' | 'too_long' | 'format' | 'reserved';

export function checkStoreSlug(slug: string): SlugProblem | null {
  if (slug.length < 3) return 'too_short';
  if (slug.length > 32) return 'too_long';
  // "-p-/-c-/-o-" and a leading "m-" are reserved by the startapp grammar (see startapp.ts).
  if (!SLUG_RE.test(slug) || slug.includes('--') || /-[pco]-/.test(slug) || slug.startsWith('m-') || slug.startsWith('i-')) return 'format';
  if (RESERVED_SLUGS.has(slug)) return 'reserved';
  return null;
}

/** Category/product slugs: same alphabet, length 1..64, unique among siblings. */
export function itemSlug(name: string): string {
  return slugify(name, 64) || 'item';
}

/** Suggest alternatives when a slug is taken. */
export function slugAlternatives(base: string, taken: (s: string) => boolean, count = 3): string[] {
  const out: string[] = [];
  const suffixes = ['shop', 'uz', 'store', 'market', 'official'];
  for (const sfx of suffixes) {
    const c = `${base.slice(0, 32 - sfx.length - 1)}-${sfx}`;
    if (!checkStoreSlug(c) && !taken(c)) out.push(c);
    if (out.length >= count) return out;
  }
  for (let i = 2; out.length < count && i < 100; i++) {
    const c = `${base.slice(0, 29)}-${i}`;
    if (!checkStoreSlug(c) && !taken(c)) out.push(c);
  }
  return out;
}
