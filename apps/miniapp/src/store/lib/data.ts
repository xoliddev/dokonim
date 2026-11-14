/**
 * Buyer data hooks: cart, wishlist (optimistic), recent searches, and the grid → PDP hand-off that lets the
 * product page render its hero instantly (Continuity) before `store.product` resolves.
 */
import { useCallback } from 'react';
import { invalidate, useApi, useQuery } from '../../api';
import { createStore, local, useStore } from '../../lib/store';
import type { CartView, ProductCardData } from './types';

// ── cart ────────────────────────────────────────────────────────────────────
export function useCart(slug: string) {
  return useQuery('cart.get', { slug }, { staleMs: 10_000 });
}

/** Qty already in the cart for a variant. */
export const qtyInCart = (cart: CartView | undefined, variantId: string | null | undefined) =>
  (variantId && cart?.items.find((i) => i.variantId === variantId)?.qty) || 0;

export function useCartActions(slug: string) {
  const { api } = useApi();
  const setQty = useCallback(
    async (variantId: string, qty: number) => {
      const cart = await api['cart.setItem']({ slug, variantId, qty });
      invalidate('cart.');
      invalidate('checkout.');
      return cart;
    },
    [api, slug],
  );
  return { setQty };
}

// ── wishlist (optimistic overrides on top of wishlist.list) ────────────────
const wishOverrides = createStore<Record<string, boolean>>({});

export function useWishlist(slug: string) {
  const { api } = useApi();
  const q = useQuery('wishlist.list', { slug }, { staleMs: 60_000 });
  const over = useStore(wishOverrides);
  const has = useCallback(
    (id: string) => {
      const k = `${slug}:${id}`;
      if (k in over) return over[k]!;
      return !!q.data?.some((p) => p.id === id);
    },
    [over, q.data, slug],
  );
  const toggle = useCallback(
    async (id: string, current: boolean) => {
      const k = `${slug}:${id}`;
      wishOverrides.set((s) => ({ ...s, [k]: !current }));
      try {
        const r = await api['wishlist.toggle']({ slug, productId: id });
        wishOverrides.set((s) => ({ ...s, [k]: r.wishlisted }));
        invalidate('wishlist.');
        return r.wishlisted;
      } catch (e) {
        wishOverrides.set((s) => ({ ...s, [k]: current }));
        throw e;
      }
    },
    [api, slug],
  );
  return { has, toggle, list: q };
}

// ── recent searches (per store, per device) ─────────────────────────────────
const recentKey = (slug: string) => `dokonim.recent.${slug}`;
const recentStore = createStore<Record<string, string[]>>({});

export function useRecentSearches(slug: string) {
  const all = useStore(recentStore);
  const items = all[slug] ?? local.get<string[]>(recentKey(slug), []);
  const save = (list: string[]) => {
    local.set(recentKey(slug), list);
    recentStore.set((s) => ({ ...s, [slug]: list }));
  };
  return {
    items,
    push(q: string) {
      const v = q.trim();
      if (v.length < 2) return;
      save([v, ...items.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8));
    },
    clear: () => save([]),
  };
}

// ── Continuity hand-off ────────────────────────────────────────────────────
export interface Handoff {
  id: string;
  coverUrl: string | null;
  title: ProductCardData['title'];
  price: number;
  compareAt: number | null;
}
const handoffs = new Map<string, Handoff>();
export const rememberCard = (p: ProductCardData) => {
  const h = { id: p.id, coverUrl: p.coverUrl, title: p.title, price: p.price, compareAt: p.compareAt };
  handoffs.set(p.id, h);
  handoffs.set(p.shortId, h);
};
export const handoffFor = (id: string) => handoffs.get(id) ?? null;

// ── misc ────────────────────────────────────────────────────────────────────
export const productUrl = (slug: string, id: string) => `/s/${slug}/p/${id}`;
export const categoryUrl = (slug: string, path: string[]) => `/s/${slug}/c/${path.map(encodeURIComponent).join('/')}`;

/** Stable idempotency key for one checkout attempt. */
export function newIdempotencyKey(): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `chk-${r}`;
}
