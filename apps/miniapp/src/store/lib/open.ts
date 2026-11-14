/**
 * Opening a product from a card: remember the card for the PDP hand-off, then morph (Continuity).
 * `morphNavigate` handles duplicate `view-transition-name`s (two rails, the leaving screen) itself.
 */
import { morphNavigate } from '../../motion';
import { productUrl, rememberCard } from './data';
import type { ProductCardData } from './types';

export function openProduct(slug: string, p: ProductCardData, img?: Element | null) {
  rememberCard(p);
  morphNavigate(productUrl(slug, p.id), { from: img });
}
