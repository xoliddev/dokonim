/** Buyer-side view types. Typed outputs come from the API; raw SQL rows (stories, orders, reviews) get local shapes. */
import type { L10n } from '@dokonim/core';
import type { ApiOut } from '../../api';

export type ProductCardData = ApiOut<'store.products'>['items'][number];
export type HomeData = ApiOut<'store.home'>;
export type ProductData = ApiOut<'store.product'>;
export type ProductVariant = ProductData['variants'][number];
export type ProductOption = ProductData['options'][number];
export type CartView = ApiOut<'cart.get'>;
export type CartItem = CartView['items'][number];
export type Quote = ApiOut<'checkout.quote'>;
export type ShippingOpt = Quote['shippingOptions'][number];
export type Facets = ApiOut<'store.facets'>;
export type StoreInfo = ApiOut<'store.get'>;
export type NavCategory = StoreInfo['nav'][number];
export type CategoryNode = ApiOut<'store.categories'>[number];

export type LinkTarget =
  | { type: 'product'; id: string }
  | { type: 'category'; id: string }
  | { type: 'collection'; id: string }
  | { type: 'url'; url: string }
  | { type: 'none' };

/** story_frames rows come through json_agg, so keys stay snake_case. */
export interface StoryFrame {
  id: string;
  media_url: string;
  duration_ms: number;
  link: LinkTarget;
  cta_label: L10n;
}
export interface Story {
  id: string;
  title: L10n;
  coverUrl: string | null;
  isHighlight: boolean;
  frames: StoryFrame[];
}
export interface CollectionTile {
  id: string;
  slug: string;
  title: L10n;
  imageUrl: string | null;
  kind: string;
  productCount: number;
  covers: string[];
}
export interface Testimonial {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  photos: string[];
  createdAt: string;
  productTitle: L10n;
  productShortId: string;
}
export interface ReviewItem {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  pros: string | null;
  cons: string | null;
  photos: string[];
  variantTitle: string | null;
  helpfulCount: number;
  ownerReply: string | null;
  createdAt: string;
  voted: boolean;
}
export interface QuestionItem {
  id: string;
  authorName: string;
  text: string;
  createdAt: string;
  answers: Array<{ id: string; text: string; authorName: string; isOfficial: boolean; createdAt: string }>;
}
export interface OrderListItem {
  id: string;
  shortId: string;
  number: number;
  status: string;
  paymentStatus: string;
  total: number;
  placedAt: string;
  deliveryPromise: { from: string; to: string } | null;
  fulfilmentKind: 'delivery' | 'pickup';
  items: Array<{ title: string; imageUrl: string | null; qty: number }> | null;
}
export interface OrderItemRow {
  id: string;
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}
export interface OrderEventRow {
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string;
  data: Record<string, unknown>;
  createdAt: string;
}
export interface PaymentRow {
  id: string;
  provider: string;
  mode: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
}
