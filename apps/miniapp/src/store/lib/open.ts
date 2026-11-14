/**
 * Opening a product from a card: remember the card for the PDP hand-off, then morph (Continuity).
 *
 * In the full tier with View Transitions the router keeps the outgoing screen in the DOM while it fades
 * (AnimatePresence popLayout), so right after the swap both the grid card and the PDP hero carry
 * `view-transition-name: product-<id>` — Chrome aborts such a transition ("duplicate view-transition-name").
 * We therefore run the transition ourselves and, inside the update callback, strip the name from every copy
 * that is not the new PDP hero. Lite tier keeps Motion's layoutId morph (shared `morphNavigate`).
 */
import { flushSync } from 'react-dom';
import { effectiveTier, morphNavigate } from '../../motion';
import { navigate } from '../../router/router';
import { productUrl, rememberCard } from './data';
import type { ProductCardData } from './types';

type VT = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
type VTDoc = Document & { startViewTransition?: (cb: () => void) => VT };

export function openProduct(slug: string, p: ProductCardData, _img?: Element | null) {
  rememberCard(p);
  const to = productUrl(slug, p.id);
  const doc = document as VTDoc;
  if (effectiveTier() !== 'full' || typeof doc.startViewTransition !== 'function') return morphNavigate(to);
  const name = `product-${p.id}`;
  const vt = doc.startViewTransition(() => {
    flushSync(() => navigate(to));
    for (const el of document.querySelectorAll<HTMLElement>('.morph-media')) {
      if (el.style.viewTransitionName === name && !el.closest('.st-pdp')) el.style.viewTransitionName = 'none';
    }
  });
  // a skipped transition (e.g. the tab is hidden) is not an error for the buyer
  vt.ready.catch(() => {});
  vt.finished.catch(() => {});
  vt.updateCallbackDone.catch(() => {});
}
