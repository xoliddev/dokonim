/**
 * @dokonim/contract — one route table for the whole API surface (§10).
 * Each entry: HTTP verb + path + who may call it + a zod input schema. The Fastify server registers
 * routes from it, the HttpApi client builds requests from it, and the demo's LocalApi validates with it,
 * so all three agree by construction. Output types are inferred from the backend (type-only import).
 */
import { z } from 'zod';
import type { MethodInput, MethodName, MethodOutput } from '@dokonim/db';

const uuid = z.string().uuid();
const slug = z.string().min(1).max(64);
const l10n = z.object({ uz: z.string().max(4000).optional(), ru: z.string().max(4000).optional(), en: z.string().max(4000).optional() });
const money = z.number().int().min(0).max(1e13);
const storeId = z.object({ storeId: uuid });
const sid = <T extends z.ZodRawShape>(shape: T) => storeId.extend(shape);
const locale = z.enum(['uz', 'ru', 'en']);
const provider = z.enum(['payme', 'click', 'uzum', 'paynet', 'telegram', 'stars', 'stripe', 'cod', 'bank_transfer']);
const role = z.enum(['owner', 'admin', 'manager', 'catalog_editor', 'order_operator', 'viewer']);
const optionalCursor = z.string().max(40).nullish();
const link = z.union([
  z.object({ type: z.literal('product'), id: z.string() }),
  z.object({ type: z.literal('category'), id: z.string() }),
  z.object({ type: z.literal('collection'), id: z.string() }),
  z.object({ type: z.literal('url'), url: z.string().url() }),
  z.object({ type: z.literal('none') }),
]);

const listing = z.object({
  slug,
  categoryId: uuid.nullish(),
  collectionId: uuid.nullish(),
  q: z.string().max(100).nullish(),
  sort: z.enum(['popular', 'new', 'price_asc', 'price_desc', 'rating', 'discount', 'relevance']).optional(),
  priceMin: money.nullish(),
  priceMax: money.nullish(),
  options: z.record(z.string().max(60), z.array(z.string().max(60)).max(30)).optional(),
  inStock: z.boolean().optional(),
  onSale: z.boolean().optional(),
  ratingGte: z.number().min(0).max(5).nullish(),
  ids: z.array(uuid).max(60).optional(),
  cursor: optionalCursor,
  limit: z.number().int().min(1).max(60).optional(),
});

const productInput = sid({
  id: uuid.optional(),
  status: z.enum(['draft', 'active', 'archived']),
  title: l10n,
  slug: z.string().max(80).optional(),
  description: l10n,
  categoryId: uuid.nullable(),
  collectionIds: z.array(uuid).max(50),
  tags: z.array(z.string().max(40)).max(30),
  attributes: z.array(z.object({ name: l10n, value: l10n })).max(40),
  isDigital: z.boolean(),
  brand: z.string().max(80),
  vendorCode: z.string().max(80),
  sizeGuide: l10n.nullish(),
  seo: z.object({ title: l10n.optional(), description: l10n.optional() }).optional(),
  media: z.array(z.object({ url: z.string().max(1_500_000), alt: l10n.optional(), kind: z.enum(['image', 'video']).optional(), dominantColor: z.string().max(9).nullish() })).max(15),
  options: z.array(z.object({ id: uuid, name: l10n, display: z.enum(['chips', 'swatch', 'image']), values: z.array(z.object({ id: uuid, label: l10n, swatchHex: z.string().max(9).nullish() })).min(1).max(100) })).max(3),
  variants: z.array(z.object({
    id: uuid, optionValueIds: z.array(uuid).max(3), sku: z.string().max(64), barcode: z.string().max(64), price: money, compareAtPrice: money.nullable(), costPrice: money.nullable(),
    weightG: z.number().int().min(0).max(1_000_000), stock: z.number().int().min(0).max(10_000_000), lowStockThreshold: z.number().int().min(0).max(100_000),
    trackInventory: z.boolean(), allowBackorder: z.boolean(), ikpuCode: z.string().max(20).nullish(), packageCode: z.string().max(20).nullish(), vatPercent: z.number().min(0).max(100).nullish(), mediaUrl: z.string().max(1_500_000).nullish(),
  })).min(1).max(2048),
});

const discountInput = sid({
  id: uuid.optional(), kind: z.enum(['code', 'automatic', 'flash_sale']), title: z.string().max(80), code: z.string().max(32).nullish(),
  valueType: z.enum(['percent', 'fixed', 'free_shipping', 'bxgy']), value: z.number().min(0).max(1e13), bxgy: z.object({ buy: z.number().int().min(1).max(20), get: z.number().int().min(1).max(20) }).nullish(),
  appliesTo: z.object({ type: z.enum(['all', 'products', 'collections', 'category']), ids: z.array(uuid).max(500).optional() }),
  conditions: z.object({ minSubtotal: money.nullish(), firstOrder: z.boolean().optional(), customerTags: z.array(z.string().max(40)).max(20).optional() }).optional(),
  startsAt: z.string().datetime({ offset: true }).nullish(), endsAt: z.string().datetime({ offset: true }).nullish(), usageLimit: z.number().int().min(1).nullish(), perCustomerLimit: z.number().int().min(1).nullish(),
  combines: z.object({ order: z.boolean(), product: z.boolean(), shipping: z.boolean() }).optional(), priority: z.number().int().min(-100).max(100).optional(), status: z.enum(['active', 'disabled']).optional(),
});

const themeTokens = z.record(z.string(), z.unknown());
const sections = z.array(z.record(z.string(), z.unknown())).max(40);
const address = z.object({ regionCode: z.string().regex(/^UZ-[A-Z]{2}$/), district: z.string().max(80).optional(), line1: z.string().max(200), line2: z.string().max(200).optional(), landmark: z.string().max(200).optional(), lat: z.number().nullish(), lng: z.number().nullish(), label: z.string().max(40).optional(), save: z.boolean().optional() });
const rules = z.object({ match: z.enum(['all', 'any']), rules: z.array(z.object({ field: z.enum(['tag', 'price', 'category', 'on_sale', 'created_within_days', 'vendor', 'title', 'in_stock']), op: z.enum(['eq', 'neq', 'lt', 'gt', 'contains', 'in_subtree']), value: z.union([z.string().max(200), z.number(), z.boolean()]) })).max(20) });

export type Auth = 'public' | 'user' | 'internal';
export interface RouteDef {
  verb: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: Auth;
  input: z.ZodType;
  /** Requires an Idempotency-Key header (stored as input.idempotencyKey). */
  idempotent?: boolean;
  rateLimit?: 'auth' | 'checkout' | 'search' | 'default';
}

const r = (verb: RouteDef['verb'], path: string, auth: Auth, input: z.ZodType, extra: Partial<RouteDef> = {}): RouteDef => ({ verb, path, auth, input, ...extra });
const any = z.object({}).passthrough();

export const ROUTES = {
  // ── me ──
  'me.get': r('GET', '/v1/me', 'user', z.object({})),
  'me.update': r('PATCH', '/v1/me', 'user', z.object({ languageCode: locale.optional(), notify: z.object({ orders: z.boolean().optional(), marketing: z.boolean().optional() }).optional() })),
  'me.addresses': r('GET', '/v1/s/:slug/me/addresses', 'user', z.object({ slug })),
  'me.deleteAddress': r('DELETE', '/v1/s/:slug/me/addresses/:id', 'user', z.object({ slug, id: uuid })),
  'invites.accept': r('POST', '/v1/invites/accept', 'user', z.object({ token: z.string().min(8).max(64) })),
  // ── public storefront ──
  'store.get': r('GET', '/v1/s/:slug', 'public', z.object({ slug })),
  'store.summaries': r('POST', '/v1/stores/summaries', 'public', z.object({ slugs: z.array(slug).max(20) })),
  'store.home': r('GET', '/v1/s/:slug/home', 'public', z.object({ slug })),
  'store.categories': r('GET', '/v1/s/:slug/categories', 'public', z.object({ slug })),
  'store.categoryByPath': r('POST', '/v1/s/:slug/categories/by-path', 'public', z.object({ slug, path: z.array(z.string().max(64)).min(1).max(64) })),
  'store.products': r('POST', '/v1/s/:slug/products/search', 'public', listing, { rateLimit: 'search' }),
  'store.facets': r('POST', '/v1/s/:slug/products/facets', 'public', listing, { rateLimit: 'search' }),
  'store.product': r('GET', '/v1/s/:slug/products/:id', 'public', z.object({ slug, id: z.string().max(40), region: z.string().max(8).nullish() })),
  'store.related': r('GET', '/v1/s/:slug/products/:productId/related', 'public', z.object({ slug, productId: z.string().max(40) })),
  'store.suggest': r('GET', '/v1/s/:slug/search/suggest', 'public', z.object({ slug, q: z.string().max(100) }), { rateLimit: 'search' }),
  'store.collection': r('GET', '/v1/s/:slug/collections/:collectionSlug', 'public', z.object({ slug, collectionSlug: z.string().max(80) })),
  'store.reviews': r('GET', '/v1/s/:slug/products/:productId/reviews', 'public', z.object({ slug, productId: z.string().max(40), rating: z.coerce.number().int().min(1).max(5).nullish(), withMedia: z.boolean().optional(), sort: z.enum(['new', 'helpful']).optional(), cursor: optionalCursor })),
  'store.questions': r('GET', '/v1/s/:slug/products/:productId/questions', 'public', z.object({ slug, productId: z.string().max(40) })),
  'store.shippingQuote': r('GET', '/v1/s/:slug/shipping/quote', 'public', z.object({ slug, region: z.string().regex(/^UZ-[A-Z]{2}$/), district: z.string().max(80).nullish(), weightG: z.coerce.number().int().min(0).optional() })),
  'events.track': r('POST', '/v1/s/:slug/events', 'public', z.object({ slug, sessionId: z.string().max(64), source: z.string().max(40).nullish(), events: z.array(z.object({ name: z.string().max(40), props: z.record(z.string(), z.unknown()).optional() })).max(20) })),
  'platform.report': r('POST', '/v1/s/:slug/report', 'user', z.object({ slug, reason: z.string().min(5).max(1000) })),
  // ── buyer ──
  'cart.get': r('GET', '/v1/s/:slug/cart', 'user', z.object({ slug })),
  'cart.setItem': r('PUT', '/v1/s/:slug/cart/items/:variantId', 'user', z.object({ slug, variantId: uuid, qty: z.number().int().min(0).max(99) })),
  'cart.acceptPrices': r('POST', '/v1/s/:slug/cart/accept-prices', 'user', z.object({ slug })),
  'cart.applyPromo': r('POST', '/v1/s/:slug/cart/promo', 'user', z.object({ slug, code: z.string().min(1).max(40) })),
  'cart.removePromo': r('DELETE', '/v1/s/:slug/cart/promo', 'user', z.object({ slug })),
  'checkout.quote': r('POST', '/v1/s/:slug/checkout/quote', 'user', z.object({ slug, methodId: uuid.nullish(), region: z.string().regex(/^UZ-[A-Z]{2}$/).nullish(), district: z.string().max(80).nullish() }), { rateLimit: 'checkout' }),
  'orders.place': r('POST', '/v1/s/:slug/orders', 'user', z.object({ slug, idempotencyKey: z.string().min(8).max(80), contact: z.object({ name: z.string().max(80), phone: z.string().max(20) }), methodId: uuid.nullable(), address: address.nullish(), pickupPointId: z.string().max(40).nullish(), paymentMethod: provider, note: z.string().max(500).optional(), source: z.string().max(40).nullish() }), { idempotent: true, rateLimit: 'checkout' }),
  'orders.mine': r('GET', '/v1/s/:slug/orders', 'user', z.object({ slug })),
  'orders.get': r('GET', '/v1/s/:slug/orders/:id', 'user', z.object({ slug, id: z.string().max(40) })),
  'orders.cancel': r('POST', '/v1/s/:slug/orders/:id/cancel', 'user', z.object({ slug, id: uuid, reason: z.string().max(200).optional() })),
  'orders.reorder': r('POST', '/v1/s/:slug/orders/:id/reorder', 'user', z.object({ slug, id: uuid })),
  'orders.returnRequest': r('POST', '/v1/s/:slug/orders/:id/return-request', 'user', z.object({ slug, id: uuid, reason: z.string().min(3).max(500) })),
  'orders.retryPayment': r('POST', '/v1/s/:slug/orders/:id/payments', 'user', z.object({ slug, id: uuid, provider: provider.optional() }), { rateLimit: 'checkout' }),
  'sandbox.pay': r('POST', '/v1/s/:slug/sandbox/pay', 'user', z.object({ slug, paymentId: uuid, scenario: z.string().max(40).optional() }), { rateLimit: 'checkout' }),
  'wishlist.list': r('GET', '/v1/s/:slug/wishlist', 'user', z.object({ slug })),
  'wishlist.toggle': r('POST', '/v1/s/:slug/wishlist/:productId', 'user', z.object({ slug, productId: uuid })),
  'reviews.pending': r('GET', '/v1/s/:slug/reviews/pending', 'user', z.object({ slug })),
  'reviews.create': r('POST', '/v1/s/:slug/reviews', 'user', z.object({ slug, orderItemId: uuid, rating: z.number().int().min(1).max(5), text: z.string().max(2000).optional(), pros: z.string().max(500).optional(), cons: z.string().max(500).optional(), photos: z.array(z.string().max(400_000)).max(6).optional() })),
  'reviews.helpful': r('POST', '/v1/s/:slug/reviews/:reviewId/helpful', 'user', z.object({ slug, reviewId: uuid })),
  'questions.ask': r('POST', '/v1/s/:slug/products/:productId/questions', 'user', z.object({ slug, productId: z.string().max(40), text: z.string().min(1).max(1000) })),
  // ── stores ──
  'stores.slugAvailable': r('GET', '/v1/stores/slug-available', 'public', z.object({ slug: z.string().max(40).optional(), name: z.string().max(80).optional() })),
  'stores.create': r('POST', '/v1/stores', 'user', z.object({ name: z.string().min(2).max(60), slug: z.string().min(3).max(32), businessType: z.enum(['clothing', 'cosmetics', 'food', 'electronics', 'handmade', 'digital']), brand: z.string().max(9).optional(), presetId: z.string().max(20).optional(), fontPair: z.enum(['unbounded-onest', 'onest-onest', 'serif-onest', 'unbounded-system', 'system-system']).optional(), logoUrl: z.string().max(400_000).nullish(), locale: locale.optional(), firstProduct: z.object({ title: z.string().max(120), price: money, imageUrl: z.string().max(1_500_000).nullish(), sizes: z.array(z.string().max(20)).max(12).optional(), colors: z.array(z.string().max(20)).max(12).optional(), stock: z.number().int().min(0).max(100000).optional() }).nullish(), payments: z.object({ cod: z.boolean().optional(), sandboxPayme: z.boolean().optional(), sandboxClick: z.boolean().optional(), stars: z.boolean().optional() }).optional() })),
  // ── owner / staff ──
  'admin.store.get': r('GET', '/v1/stores/:storeId', 'user', storeId),
  'admin.store.update': r('PATCH', '/v1/stores/:storeId', 'user', sid({ name: l10n.optional(), tagline: l10n.optional(), logoUrl: z.string().max(400_000).nullish(), locales: z.array(locale).max(3).optional(), defaultLocale: locale.optional(), settings: z.record(z.string(), z.unknown()).optional(), installments: z.array(z.object({ months: z.number().int(), markupPercent: z.number().min(0).max(100) })).max(3).optional(), status: z.enum(['active', 'draft']).optional() })),
  'admin.store.close': r('DELETE', '/v1/stores/:storeId', 'user', sid({ confirmSlug: z.string().max(40) })),
  'admin.dashboard': r('GET', '/v1/stores/:storeId/dashboard', 'user', storeId),
  'admin.categories.tree': r('GET', '/v1/stores/:storeId/categories', 'user', storeId),
  'admin.categories.create': r('POST', '/v1/stores/:storeId/categories', 'user', sid({ parentId: uuid.nullable(), name: l10n, slug: z.string().max(64).optional(), icon: z.string().max(40).nullish(), imageUrl: z.string().max(400_000).nullish(), isHidden: z.boolean().optional(), description: l10n.optional() })),
  'admin.categories.update': r('PATCH', '/v1/stores/:storeId/categories/:id', 'user', sid({ id: uuid, name: l10n.optional(), slug: z.string().max(64).optional(), icon: z.string().max(40).nullish(), imageUrl: z.string().max(400_000).nullish(), isHidden: z.boolean().optional(), description: l10n.optional() })),
  'admin.categories.move': r('POST', '/v1/stores/:storeId/categories/:id/move', 'user', sid({ id: uuid, parentId: uuid.nullable(), index: z.number().int().min(0).max(100_000) })),
  'admin.categories.delete': r('DELETE', '/v1/stores/:storeId/categories/:id', 'user', sid({ id: uuid, strategy: z.union([z.object({ kind: z.literal('reparent_children') }), z.object({ kind: z.literal('reassign_products'), targetId: uuid }), z.object({ kind: z.literal('archive_subtree') })]) })),
  'admin.products.list': r('GET', '/v1/stores/:storeId/products', 'user', sid({ q: z.string().max(100).optional(), status: z.enum(['draft', 'active', 'archived', 'all']).optional(), categoryId: uuid.nullish(), lowStock: z.boolean().optional(), cursor: z.string().max(20).optional(), limit: z.number().int().max(100).optional() })),
  'admin.products.get': r('GET', '/v1/stores/:storeId/products/:id', 'user', sid({ id: uuid })),
  'admin.products.save': r('PUT', '/v1/stores/:storeId/products', 'user', productInput),
  'admin.products.duplicate': r('POST', '/v1/stores/:storeId/products/:id/duplicate', 'user', sid({ id: uuid })),
  'admin.products.bulk': r('POST', '/v1/stores/:storeId/products/bulk', 'user', sid({ ids: z.array(uuid).min(1).max(500), action: z.enum(['activate', 'draft', 'archive', 'move_category', 'adjust_price', 'add_tag', 'remove_tag', 'add_to_collection', 'remove_from_collection']), params: z.object({ categoryId: uuid.nullish(), percent: z.number().optional(), tag: z.string().max(40).optional(), collectionId: uuid.optional() }).optional() })),
  'admin.inventory.list': r('GET', '/v1/stores/:storeId/inventory', 'user', sid({ lowStock: z.boolean().optional(), q: z.string().max(100).optional() })),
  'admin.inventory.adjust': r('POST', '/v1/stores/:storeId/inventory/adjust', 'user', sid({ variantId: uuid, delta: z.number().int().min(-1_000_000).max(1_000_000), reason: z.enum(['purchase', 'adjustment', 'return']), note: z.string().max(300).optional() })),
  'admin.inventory.movements': r('GET', '/v1/stores/:storeId/inventory/movements', 'user', sid({ variantId: uuid.optional(), limit: z.number().int().max(500).optional() })),
  'admin.inventory.reservations': r('GET', '/v1/stores/:storeId/inventory/reservations', 'user', storeId),
  'admin.collections.list': r('GET', '/v1/stores/:storeId/collections', 'user', storeId),
  'admin.collections.get': r('GET', '/v1/stores/:storeId/collections/:id', 'user', sid({ id: uuid })),
  'admin.collections.save': r('PUT', '/v1/stores/:storeId/collections', 'user', sid({ id: uuid.optional(), title: l10n, slug: z.string().max(80).optional(), description: l10n.optional(), kind: z.enum(['manual', 'automated']), rules: rules.optional(), productIds: z.array(uuid).max(1000).optional(), imageUrl: z.string().max(400_000).nullish(), isHidden: z.boolean().optional() })),
  'admin.collections.delete': r('DELETE', '/v1/stores/:storeId/collections/:id', 'user', sid({ id: uuid })),
  'admin.collections.previewRules': r('POST', '/v1/stores/:storeId/collections/preview-rules', 'user', sid({ rules })),
  'admin.orders.list': r('GET', '/v1/stores/:storeId/orders', 'user', sid({ status: z.string().max(30).nullish(), q: z.string().max(100).nullish(), cursor: z.string().max(20).nullish() })),
  'admin.orders.get': r('GET', '/v1/stores/:storeId/orders/:id', 'user', sid({ id: z.string().max(40) })),
  'admin.orders.transition': r('POST', '/v1/stores/:storeId/orders/:id/transition', 'user', sid({ id: uuid, event: z.enum(['confirm', 'pack', 'ship', 'ready_for_pickup', 'deliver', 'complete', 'cancel', 'accept_return', 'reject_return']), trackingNumber: z.string().max(60).optional(), carrier: z.string().max(60).optional(), pickupCode: z.string().max(10).optional(), reason: z.string().max(200).optional() })),
  'admin.orders.note': r('POST', '/v1/stores/:storeId/orders/:id/notes', 'user', sid({ id: uuid, text: z.string().min(1).max(1000) })),
  'admin.orders.refund': r('POST', '/v1/stores/:storeId/orders/:id/refunds', 'user', sid({ id: uuid, reason: z.string().max(200) })),
  'admin.customers.list': r('GET', '/v1/stores/:storeId/customers', 'user', sid({ q: z.string().max(100).nullish(), tag: z.string().max(40).nullish() })),
  'admin.customers.get': r('GET', '/v1/stores/:storeId/customers/:id', 'user', sid({ id: uuid })),
  'admin.customers.update': r('PATCH', '/v1/stores/:storeId/customers/:id', 'user', sid({ id: uuid, tags: z.array(z.string().max(40)).max(20).optional(), note: z.string().max(2000).optional(), isBlocked: z.boolean().optional() })),
  'admin.discounts.list': r('GET', '/v1/stores/:storeId/discounts', 'user', storeId),
  'admin.discounts.save': r('PUT', '/v1/stores/:storeId/discounts', 'user', discountInput),
  'admin.discounts.delete': r('DELETE', '/v1/stores/:storeId/discounts/:id', 'user', sid({ id: uuid })),
  'admin.shipping.get': r('GET', '/v1/stores/:storeId/shipping', 'user', storeId),
  'admin.shipping.saveMethod': r('PUT', '/v1/stores/:storeId/shipping/methods', 'user', sid({ id: uuid.optional(), type: z.enum(['courier', 'pickup_point', 'post', 'self_pickup']), name: l10n, processingDays: z.number().int().min(0).max(30), cutoffTime: z.string().max(5), workingDays: z.array(z.number().int().min(1).max(7)).max(7), holidays: z.array(z.string().max(10)).max(60), pickupPoints: z.array(z.object({ id: z.string().max(40), name: l10n, address: z.string().max(200), hours: z.string().max(60).optional() })).max(50).optional(), codAllowed: z.boolean(), enabled: z.boolean() })),
  'admin.shipping.deleteMethod': r('DELETE', '/v1/stores/:storeId/shipping/methods/:id', 'user', sid({ id: uuid })),
  'admin.shipping.saveZone': r('PUT', '/v1/stores/:storeId/shipping/zones', 'user', sid({ id: uuid.optional(), name: z.string().max(60), regions: z.array(z.string().max(6)).max(14), districts: z.array(z.string().max(80)).max(200).optional() })),
  'admin.shipping.deleteZone': r('DELETE', '/v1/stores/:storeId/shipping/zones/:id', 'user', sid({ id: uuid })),
  'admin.shipping.saveRate': r('PUT', '/v1/stores/:storeId/shipping/rates', 'user', sid({ zoneId: uuid, methodId: uuid, calc: z.enum(['flat', 'weight', 'free_over']), amount: money, perKg: money.nullish(), freeOver: money.nullish(), transitDaysMin: z.number().int().min(0).max(60), transitDaysMax: z.number().int().min(0).max(60) })),
  'admin.shipping.deleteRate': r('DELETE', '/v1/stores/:storeId/shipping/rates', 'user', sid({ zoneId: uuid, methodId: uuid })),
  'admin.payments.list': r('GET', '/v1/stores/:storeId/payments/providers', 'user', storeId),
  'admin.payments.save': r('PUT', '/v1/stores/:storeId/payments/providers/:provider', 'user', sid({ provider, mode: z.enum(['sandbox', 'live']), enabled: z.boolean(), credentials: z.record(z.string().max(40), z.string().max(500)).nullish(), publicConfig: z.record(z.string().max(40), z.string().max(500)).optional() })),
  'admin.payments.test': r('POST', '/v1/stores/:storeId/payments/providers/:provider/test', 'user', sid({ provider })),
  'admin.payments.events': r('GET', '/v1/stores/:storeId/payments/events', 'user', sid({ limit: z.number().int().max(200).optional() })),
  'admin.theme.get': r('GET', '/v1/stores/:storeId/theme', 'user', storeId),
  'admin.theme.saveDraft': r('PUT', '/v1/stores/:storeId/theme/draft', 'user', sid({ tokens: themeTokens, sections, preset: z.string().max(20).nullish() })),
  'admin.theme.publish': r('POST', '/v1/stores/:storeId/theme/publish', 'user', storeId),
  'admin.theme.restore': r('POST', '/v1/stores/:storeId/theme/versions/:version/restore', 'user', sid({ version: z.coerce.number().int().min(1) })),
  'admin.stories.list': r('GET', '/v1/stores/:storeId/stories', 'user', storeId),
  'admin.stories.save': r('PUT', '/v1/stores/:storeId/stories', 'user', sid({ id: uuid.optional(), title: l10n, coverUrl: z.string().max(400_000).nullish(), isHighlight: z.boolean(), expiresInHours: z.number().int().min(1).max(720).nullish(), frames: z.array(z.object({ mediaUrl: z.string().max(1_500_000), durationMs: z.number().int().optional(), link, ctaLabel: l10n.optional() })).min(1).max(10) })),
  'admin.stories.delete': r('DELETE', '/v1/stores/:storeId/stories/:id', 'user', sid({ id: uuid })),
  'admin.reviews.list': r('GET', '/v1/stores/:storeId/reviews', 'user', sid({ status: z.enum(['pending', 'published', 'hidden']).nullish(), unanswered: z.boolean().optional() })),
  'admin.reviews.moderate': r('PATCH', '/v1/stores/:storeId/reviews/:id', 'user', sid({ id: uuid, status: z.enum(['published', 'hidden']) })),
  'admin.reviews.reply': r('POST', '/v1/stores/:storeId/reviews/:id/reply', 'user', sid({ id: uuid, text: z.string().max(1000) })),
  'admin.questions.list': r('GET', '/v1/stores/:storeId/questions', 'user', sid({ unanswered: z.boolean().optional() })),
  'admin.questions.answer': r('POST', '/v1/stores/:storeId/questions/:id/answer', 'user', sid({ id: uuid, text: z.string().min(1).max(2000) })),
  'admin.questions.hide': r('PATCH', '/v1/stores/:storeId/questions/:id', 'user', sid({ id: uuid, hidden: z.boolean() })),
  'admin.staff.list': r('GET', '/v1/stores/:storeId/staff', 'user', storeId),
  'admin.staff.invite': r('POST', '/v1/stores/:storeId/staff/invites', 'user', sid({ role, ttlHours: z.number().int().min(1).max(168).optional() })),
  'admin.staff.revokeInvite': r('DELETE', '/v1/stores/:storeId/staff/invites/:id', 'user', sid({ id: uuid })),
  'admin.staff.update': r('PATCH', '/v1/stores/:storeId/staff/:userId', 'user', sid({ userId: uuid, role })),
  'admin.staff.remove': r('DELETE', '/v1/stores/:storeId/staff/:userId', 'user', sid({ userId: uuid })),
  'admin.analytics': r('GET', '/v1/stores/:storeId/analytics', 'user', sid({ range: z.enum(['today', '7d', '30d', '90d']) })),
  'admin.audit': r('GET', '/v1/stores/:storeId/audit', 'user', sid({ entityType: z.string().max(40).nullish(), entityId: z.string().max(80).nullish(), cursor: z.string().max(20).nullish() })),
  'admin.import.products': r('POST', '/v1/stores/:storeId/import/products', 'user', sid({ csv: z.string().max(5_000_000), dryRun: z.boolean() })),
  'admin.export.products': r('GET', '/v1/stores/:storeId/export/products', 'user', storeId),
  'admin.export.orders': r('GET', '/v1/stores/:storeId/export/orders', 'user', sid({ from: z.string().max(30).nullish(), to: z.string().max(30).nullish() })),
  // ── platform admin ──
  'platform.stores': r('GET', '/v1/admin/stores', 'user', z.object({ q: z.string().max(80).nullish() })),
  'platform.suspend': r('POST', '/v1/admin/stores/:storeId/suspend', 'user', sid({ suspended: z.boolean(), reason: z.string().max(300).optional() })),
  'platform.setPlan': r('POST', '/v1/admin/stores/:storeId/plan', 'user', sid({ plan: z.enum(['free', 'pro']), flags: z.object({ productLimit: z.number().int().min(1).max(100000), removeBadge: z.boolean(), customBot: z.boolean() }) })),
  'platform.paymentErrors': r('GET', '/v1/admin/webhook-failures', 'user', z.object({})),
  // ── internal (never exposed over HTTP; called by the bot, jobs and webhook routes) ──
  'auth.issueRefresh': r('POST', '-', 'internal', any),
  'auth.rotateRefresh': r('POST', '-', 'internal', any),
  'auth.savePhone': r('POST', '-', 'internal', any),
  'auth.seenUpdate': r('POST', '-', 'internal', any),
  'bot.inlineProducts': r('POST', '-', 'internal', any),
  'bot.orderAction': r('POST', '-', 'internal', any),
  'hooks.handle': r('POST', '-', 'internal', any),
  'jobs.autoComplete': r('POST', '-', 'internal', any),
  'jobs.expireReservations': r('POST', '-', 'internal', any),
  'outbox.claim': r('POST', '-', 'internal', any),
  'outbox.mark': r('POST', '-', 'internal', any),
} satisfies Record<MethodName, RouteDef>;

export type RouteName = keyof typeof ROUTES;
export type PublicRouteName = { [K in RouteName]: (typeof ROUTES)[K]['auth'] extends 'internal' ? never : K }[RouteName];
export type In<K extends MethodName> = MethodInput<K>;
export type Out<K extends MethodName> = MethodOutput<K>;

/** The client-side API surface (implemented by HttpApi and by the demo's LocalApi). */
export type DokonimApi = { [K in PublicRouteName]: (input: In<K>) => Promise<Out<K>> };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Validates input against the route schema; throws a VALIDATION ApiError with field paths. */
export function validate<K extends RouteName>(name: K, input: unknown): In<K> {
  const def = ROUTES[name] as RouteDef;
  const r = def.input.safeParse(input ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ApiError('VALIDATION', issue?.message ?? 'Invalid input', { field: issue?.path.join('.') ?? '', issues: r.error.issues.slice(0, 5).map((x) => ({ path: x.path.join('.'), message: x.message })) });
  }
  return r.data as In<K>;
}

/** Splits an input into path params / query / body for a route (used by HttpApi). */
export function buildRequest(name: RouteName, input: Record<string, unknown>): { verb: RouteDef['verb']; url: string; body?: unknown; headers: Record<string, string> } {
  const def = ROUTES[name] as RouteDef;
  const rest: Record<string, unknown> = { ...input };
  const url = def.path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    const v = rest[k];
    delete rest[k];
    return encodeURIComponent(String(v));
  });
  const headers: Record<string, string> = {};
  if (def.idempotent && typeof rest.idempotencyKey === 'string') headers['idempotency-key'] = rest.idempotencyKey;
  if (def.verb === 'GET' || def.verb === 'DELETE') {
    const qs = Object.keys(rest).length ? `?input=${encodeURIComponent(JSON.stringify(rest))}` : '';
    return { verb: def.verb, url: url + qs, headers };
  }
  return { verb: def.verb, url, body: rest, headers: { ...headers, 'content-type': 'application/json' } };
}

/** Merges params/query/body back into one input object (used by the Fastify adapter). */
export function mergeRequest(params: Record<string, string>, query: Record<string, unknown>, body: unknown): Record<string, unknown> {
  let q: Record<string, unknown>;
  if (typeof query.input === 'string') {
    try {
      q = JSON.parse(query.input) as Record<string, unknown>;
    } catch {
      q = {};
    }
  } else q = { ...query };
  const merged: Record<string, unknown> = { ...q, ...(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}), ...params };
  return merged;
}
