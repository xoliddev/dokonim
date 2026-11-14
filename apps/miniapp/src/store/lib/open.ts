/** Opening a product from a card: remember the card for the PDP hand-off, then morph (Continuity). */
import { morphNavigate } from '../../motion';
import { productUrl, rememberCard } from './data';
import type { ProductCardData } from './types';

export function openProduct(slug: string, p: ProductCardData, _img?: Element | null) {
  rememberCard(p);
  morphNavigate(productUrl(slug, p.id));
}
