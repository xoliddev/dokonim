import { describe, expect, it } from 'vitest';
import { collectionTitle } from '../src/seller/screens/collections/CollectionForm';

describe('collection title editing', () => {
  const orig = { uz: 'Yangi kelganlar', ru: 'Новинки' };
  it('keeps the stored title when the name is untouched (a ru seller only flips hidden)', () => {
    expect(collectionTitle(orig, 'Новинки', 'Новинки', 'ru')).toBe(orig);
    // a fallback shown in en is not copied into en either
    expect(collectionTitle(orig, 'Yangi kelganlar', 'Yangi kelganlar', 'en')).toBe(orig);
  });
  it('writes an edit into the UI locale only, never over the uz title', () => {
    expect(collectionTitle(orig, 'Новинки', 'Новинки недели', 'ru')).toEqual({ uz: 'Yangi kelganlar', ru: 'Новинки недели' });
  });
  it('a new collection gets the name as its uz title too', () => {
    expect(collectionTitle(null, '', ' Sale ', 'en')).toEqual({ uz: 'Sale', en: 'Sale' });
  });
});
