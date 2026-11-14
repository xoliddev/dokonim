/**
 * The "Bozor Modern" art set (same generator the demo seed uses) for product images picked without a photo.
 * art.ts is dependency-free; it is imported by path because @dokonim/seed's entry also pulls the seeder.
 */
import { ART_KINDS, ART_PATTERNS, artDataUrl, artUrl, type ArtPattern } from '../../../../../packages/seed/src/art';

export { ART_KINDS, ART_PATTERNS };
export type { ArtPattern };

export const ART_COLORS = ['#a3195b', '#c0392b', '#d9a21b', '#1f6e5a', '#0e7c86', '#1f4fa8', '#6b4fd8', '#2b2622', '#e8dcc8'];

const cache = new Map<string, string>();

/** Data URL for an art kind in a colour/pattern (memoised; specs are tiny SVGs). */
export function artImage(kind: string, c?: string, p?: ArtPattern, c2?: string): string {
  const spec = artUrl(kind, { c, p, c2 });
  let v = cache.get(spec);
  if (!v) {
    v = artDataUrl(spec);
    cache.set(spec, v);
  }
  return v;
}

/** Representative art kinds per business type (onboarding preview, empty product thumbnails). */
export const ART_FOR: Record<string, string[]> = {
  clothing: ['dress', 'chapan', 'doppi', 'scarf'],
  cosmetics: ['cream', 'perfume', 'soap', 'candle'],
  food: ['tea', 'non', 'honey', 'driedfruit'],
  electronics: ['phone', 'headphones', 'watch', 'box'],
  handmade: ['vase', 'pillow', 'wallhanging', 'lagan'],
  digital: ['box', 'phone', 'headphones', 'watch'],
};
