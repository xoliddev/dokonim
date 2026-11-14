/**
 * Cart → checkout → order → payment. Order transitions apply the core state machine and its effects
 * (reservations, stock, refunds, pickup codes, notifications) inside one tenant transaction.
 */
import {
  allowedEvents, decryptSecret, DomainError, fulfillmentOf, isUuid, pick, pickupCode, priceCart, sha256Hex, shortId, transitionOrder,
  uuidv7, variantTitle, type ActorKind, type CheckResult, type FulfilmentKind, type NotificationPayload, type OrderEvent, type OrderStatus,
  type OrderSummary, type PaymentLedgerPort, type PaymentStatus, type PricingResult, type ProviderConfig, type ProviderId, type TxnView,
  type L10n, type OptionDef, type NextAction,
} from '@dokonim/core';
import { SandboxClick, SandboxPayme, SandboxTelegramInvoice, SandboxUzum, sandboxConfig, SANDBOX_CREDENTIALS, type SimulationResult } from '@dokonim/payments';
import { json, type Sql } from '../client';
import { movement, refreshProduct } from './catalog';
import { SYSTEM, type Actor, type Ctx, type StoreRow } from './ctx';
import { loadDiscountRules, productPricingMeta, shippingOptions, type ShippingOption } from './pricing-data';

export const STAR_RATE_SOM = 170; // so'm per Telegram Star (store setting override: settings.starRateSom)

interface CartLineRow {
  variantId: string;
  qty: number;
  addedPrice: number;
  productId: string;
  productTitle: L10n;
  shortId: string;
  status: string;
  isDigital: boolean;
  coverUrl: string | null;
  mediaUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  sku: string;
  weightG: number;
  optionValueIds: string[];
  trackInventory: boolean;
  allowBackorder: boolean;
  available: number;
  onHand: number;
  ikpuCode: string | null;
  packageCode: string | null;
  vatPercent: number | null;
}

async function cartRow(tx: Sql, store: StoreRow, userId: string): Promise<{ id: string; promoCode: string | null }> {
  const [c] = await tx.query<{ id: string; promoCode: string | null }>(`select id, promo_code from carts where store_id = $1 and user_id = $2 and status = 'active'`, [store.id, userId]);
  if (c) return c;
  const id = uuidv7();
  await tx.query(`insert into carts (store_id, id, user_id) values ($1,$2,$3) on conflict do nothing`, [store.id, id, userId]);
  const [again] = await tx.query<{ id: string; promoCode: string | null }>(`select id, promo_code from carts where store_id = $1 and user_id = $2 and status = 'active'`, [store.id, userId]);
  return again!;
}

async function cartLines(tx: Sql, store: StoreRow, cartId: string, lock = false): Promise<CartLineRow[]> {
  if (lock)
    // row locks in variant-id order so concurrent checkouts serialise without deadlocks (§9.3)
    await tx.query(`select l.variant_id from inventory_levels l join cart_items ci on ci.variant_id = l.variant_id where ci.store_id = $1 and ci.cart_id = $2 order by l.variant_id for update of l`, [store.id, cartId]);
  return tx.query<CartLineRow>(
    `select ci.variant_id, ci.qty, ci.added_price, p.id as product_id, p.title as product_title, p.short_id, p.status, p.is_digital, p.cover_url,
       v.media_url, v.price, v.compare_at_price, v.sku, v.weight_g, v.option_value_ids, v.track_inventory, v.allow_backorder, v.ikpu_code, v.package_code, v.vat_percent,
       coalesce(l.on_hand - l.reserved, 0)::int as available, coalesce(l.on_hand, 0)::int as on_hand
     from cart_items ci join product_variants v on v.id = ci.variant_id join products p on p.id = v.product_id left join inventory_levels l on l.variant_id = v.id
     where ci.store_id = $1 and ci.cart_id = $2 order by ci.variant_id`,
    [store.id, cartId],
  );
}

async function optionLabels(tx: Sql, store: StoreRow, productIds: string[]): Promise<Map<string, OptionDef[]>> {
  const rows = await tx.query<{ productId: string; optionId: string; name: L10n; valueId: string; label: L10n }>(
    `select po.product_id, po.id as option_id, po.name, ov.id as value_id, ov.label from product_options po join option_values ov on ov.option_id = po.id
     where po.store_id = $1 and po.product_id = any($2::uuid[]) order by po.position, ov.position`,
    [store.id, productIds],
  );
  const out = new Map<string, OptionDef[]>();
  for (const r of rows) {
    const opts = out.get(r.productId) ?? [];
    let o = opts.find((x) => x.id === r.optionId);
    if (!o) opts.push((o = { id: r.optionId, name: pick(r.name, store.defaultLocale), values: [] }));
    o.values.push({ id: r.valueId, label: pick(r.label, store.defaultLocale) });
    out.set(r.productId, opts);
  }
  return out;
}

async function customerFor(tx: Sql, store: StoreRow, userId: string) {
  const [c] = await tx.query<{ id: string; ordersCount: number; tags: string[]; name: string; phone: string | null; isBlocked: boolean }>(
    'select id, orders_count, tags, name, phone, is_blocked from customers where store_id = $1 and user_id = $2',
    [store.id, userId],
  );
  return c ?? null;
}

async function customerUsage(tx: Sql, store: StoreRow, customerId: string | null): Promise<Record<string, number>> {
  if (!customerId) return {};
  const rows = await tx.query<{ discountId: string; n: number }>('select discount_id, count(*)::int as n from discount_redemptions where store_id = $1 and customer_id = $2 group by 1', [store.id, customerId]);
  return Object.fromEntries(rows.map((r) => [r.discountId, r.n]));
}

export interface CartView {
  id: string;
  promoCode: string | null;
  items: Array<{
    variantId: string;
    productId: string;
    shortId: string;
    title: L10n;
    variantTitle: string;
    imageUrl: string | null;
    qty: number;
    unitPrice: number;
    compareAt: number | null;
    lineTotal: number;
    lineDiscount: number;
    available: number;
    maxQty: number;
    isDigital: boolean;
    weightG: number;
    warnings: Array<'price_changed' | 'out_of_stock' | 'qty_reduced' | 'unavailable'>;
    previousPrice: number | null;
  }>;
  pricing: PricingResult;
  isDigital: boolean;
  mixedDigital: boolean;
  count: number;
}

async function buildCart(s: Ctx, tx: Sql, store: StoreRow, userId: string, opts: { shipping?: { amount: number; freeOver: number | null } | null; promo?: string | null } = {}): Promise<CartView> {
  const cart = await cartRow(tx, store, userId);
  const lines = await cartLines(tx, store, cart.id);
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const labels = await optionLabels(tx, store, productIds);
  const meta = await productPricingMeta(tx, store.id, productIds);
  const discounts = await loadDiscountRules(tx, store.id);
  const customer = await customerFor(tx, store, userId);
  const usage = await customerUsage(tx, store, customer?.id ?? null);
  const live = lines.filter((l) => l.status === 'active');
  // default shipping nudge: cheapest free-over courier rate for the default region
  let shipping = opts.shipping;
  if (shipping === undefined) {
    const so = await shippingOptions(tx, store, 'UZ-TK', null, 0, s.now());
    const free = so.filter((x) => x.freeOver).sort((a, b) => (a.freeOver ?? 0) - (b.freeOver ?? 0))[0];
    shipping = free ? { amount: 0, freeOver: free.freeOver } : null;
  }
  const pricing = priceCart({
    lines: live.map((l) => ({ key: l.variantId, productId: l.productId, categoryPath: meta.get(l.productId)?.categoryPath ?? null, collectionIds: meta.get(l.productId)?.collectionIds ?? [], unitPrice: l.price, qty: l.qty, weightG: l.weightG })),
    discounts,
    promoCode: opts.promo !== undefined ? opts.promo : cart.promoCode,
    customer: customer ? { ordersCount: customer.ordersCount, tags: customer.tags, usage } : { ordersCount: 0, tags: [], usage: {} },
    shipping,
    now: s.now(),
  });
  const items = lines.map((l) => {
    const pl = pricing.lines.find((x) => x.key === l.variantId);
    const purchasable = !l.trackInventory || l.allowBackorder;
    const warnings: CartView['items'][number]['warnings'] = [];
    if (l.status !== 'active') warnings.push('unavailable');
    else if (!purchasable && l.available <= 0) warnings.push('out_of_stock');
    else if (!purchasable && l.qty > l.available) warnings.push('qty_reduced');
    if (l.addedPrice !== l.price) warnings.push('price_changed');
    return {
      variantId: l.variantId,
      productId: l.productId,
      shortId: l.shortId,
      title: l.productTitle,
      variantTitle: variantTitle(labels.get(l.productId) ?? [], l.optionValueIds),
      imageUrl: l.mediaUrl ?? l.coverUrl,
      qty: l.qty,
      unitPrice: l.price,
      compareAt: l.compareAtPrice,
      lineTotal: pl?.total ?? 0,
      lineDiscount: (pl?.productDiscount ?? 0) + (pl?.orderDiscount ?? 0),
      available: l.available,
      maxQty: purchasable ? 99 : Math.max(0, Math.min(99, l.available)),
      isDigital: l.isDigital,
      weightG: l.weightG,
      warnings,
      previousPrice: l.addedPrice !== l.price ? l.addedPrice : null,
    };
  });
  const digital = live.filter((l) => l.isDigital).length;
  return {
    id: cart.id,
    promoCode: cart.promoCode,
    items,
    pricing,
    isDigital: live.length > 0 && digital === live.length,
    mixedDigital: digital > 0 && digital < live.length,
    count: live.reduce((a, l) => a + l.qty, 0),
  };
}

/** Provider configs with decrypted credentials (sandbox mode uses the published sandbox credentials). */
export async function providerConfigs(s: Ctx, tx: Sql, storeId: string): Promise<ProviderConfig[]> {
  const rows = await tx.query<{ provider: ProviderId; mode: 'sandbox' | 'live'; enabled: boolean; credentialsEnc: string | null; publicConfig: Record<string, string> }>(
    'select provider, mode, enabled, credentials_enc, public_config from payment_provider_configs where store_id = $1',
    [storeId],
  );
  const out: ProviderConfig[] = [];
  for (const r of rows) {
    let credentials: Record<string, string> = {};
    if (r.mode === 'sandbox' && r.provider in SANDBOX_CREDENTIALS) credentials = { ...SANDBOX_CREDENTIALS[r.provider as keyof typeof SANDBOX_CREDENTIALS] };
    else if (r.credentialsEnc) {
      try {
        credentials = JSON.parse(await decryptSecret(r.credentialsEnc, s.deps.kek));
      } catch {
        credentials = {};
      }
    }
    out.push({ provider: r.provider, mode: r.mode, enabled: r.enabled, publicConfig: r.publicConfig ?? {}, credentials });
  }
  return out;
}

export interface OrderRow {
  id: string;
  storeId: string;
  number: number;
  shortId: string;
  userId: string | null;
  customerId: string | null;
  status: OrderStatus;
  paymentStatus: string;
  fulfilmentKind: FulfilmentKind;
  paymentMethod: ProviderId;
  currency: 'UZS';
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  total: number;
  contact: { name: string; phone: string };
  shippingAddress: Record<string, unknown> | null;
  shippingMethodName: L10n | null;
  deliveryPromise: { from: string; to: string } | null;
  pickupCodeHash: string | null;
  pickupCode: string | null;
  note: string;
  placedAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  locale: string;
}

async function getOrder(tx: Sql, storeId: string, idOrShort: string, lock = false): Promise<OrderRow> {
  const [o] = await tx.query<OrderRow>(`select * from orders where store_id = $1 and ${isUuid(idOrShort) ? 'id' : 'short_id'} = $2 ${lock ? 'for update' : ''}`, [storeId, idOrShort]);
  if (!o) throw new DomainError('NOT_FOUND', 'Order not found');
  return o;
}

async function orderSummary(tx: Sql, store: StoreRow, o: OrderRow): Promise<OrderSummary> {
  const items = await tx.query<{ title: string; variantTitle: string; qty: number }>('select title, variant_title, qty from order_items where order_id = $1', [o.id]);
  return {
    orderId: o.id, shortId: o.shortId, number: o.number, storeSlug: store.slug, storeName: pick(store.name, store.defaultLocale), total: o.total, currency: o.currency,
    items: items.map((i) => ({ title: i.title, variantTitle: i.variantTitle || undefined, qty: i.qty })), paymentMethod: o.paymentMethod,
    buyerName: o.contact?.name ?? '', buyerPhone: o.contact?.phone ?? null, fulfilment: o.fulfilmentKind,
    deliveryFrom: o.deliveryPromise?.from ?? null, deliveryTo: o.deliveryPromise?.to ?? null, status: o.status,
  };
}

async function event(tx: Sql, o: OrderRow, type: string, from: string | null, to: string | null, actor: string, actorUserId: string | null, data: Record<string, unknown> = {}) {
  await tx.query('insert into order_events (store_id, id, order_id, type, from_status, to_status, actor, actor_user_id, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)', [
    o.storeId, uuidv7(), o.id, type, from, to, actor, actorUserId, json(data),
  ]);
}

/** Applies an order event with all of its effects. The single place where order status changes. */
export async function applyOrderEvent(
  s: Ctx, tx: Sql, store: StoreRow, orderId: string, ev: OrderEvent, actorKind: ActorKind, actor: Actor,
  data: { trackingNumber?: string; carrier?: string; pickupCode?: string; reason?: string; providerRefunded?: boolean } = {},
): Promise<OrderRow> {
  const o = await getOrder(tx, store.id, orderId, true);
  const paid = o.paymentStatus === 'paid';
  const t = transitionOrder(o.status, ev, actorKind, o.fulfilmentKind, { paid });
  const now = s.now().toISOString();
  if (ev === 'deliver' && o.status === 'ready_for_pickup' && actorKind === 'staff') {
    const code = (data.pickupCode ?? '').replace(/\D/g, '');
    if (!code || !o.pickupCodeHash || (await sha256Hex(`${o.id}:${code}`)) !== o.pickupCodeHash)
      throw new DomainError('VALIDATION', 'Pickup code does not match', { field: 'pickupCode' });
  }
  let pickupPlain: string | null = null;
  const items = await tx.query<{ variantId: string | null; productId: string | null; qty: number }>('select variant_id, product_id, qty from order_items where order_id = $1', [o.id]);
  const lowStock: Array<{ productId: string; variantId: string }> = [];
  for (const eff of t.effects) {
    switch (eff) {
      case 'commit_reservation':
        await commitSale(s, tx, store, o, actor, lowStock);
        break;
      case 'release_reservation': {
        const rs = await tx.query<{ variantId: string; qty: number }>('delete from inventory_reservations where store_id = $1 and order_id = $2 returning variant_id, qty', [store.id, o.id]);
        for (const r of rs) await tx.query('update inventory_levels set reserved = greatest(0, reserved - $2) where variant_id = $1', [r.variantId, r.qty]);
        await tx.query(`update discounts set used_count = greatest(0, used_count - 1) where id in (select discount_id from discount_redemptions where order_id = $1)`, [o.id]);
        await tx.query('delete from discount_redemptions where order_id = $1', [o.id]);
        break;
      }
      case 'restock': {
        // only if the sale was committed (reservations gone)
        const [left] = await tx.query<{ n: number }>('select count(*)::int as n from inventory_reservations where order_id = $1', [o.id]);
        if ((left?.n ?? 0) > 0) {
          const rs = await tx.query<{ variantId: string; qty: number }>('delete from inventory_reservations where order_id = $1 returning variant_id, qty', [o.id]);
          for (const r of rs) await tx.query('update inventory_levels set reserved = greatest(0, reserved - $2) where variant_id = $1', [r.variantId, r.qty]);
        } else
          for (const it of items) {
            if (!it.variantId) continue;
            const r = await tx.query('update inventory_levels set on_hand = on_hand + $2 where variant_id = $1 returning variant_id', [it.variantId, it.qty]);
            if (r.length) await movement(tx, store.id, it.variantId, it.qty, ev === 'accept_return' ? 'return' : 'cancel_restock', actor, 'order', o.id, `#${o.number}`);
          }
        for (const pid of new Set(items.map((x) => x.productId).filter(Boolean))) await refreshProduct(s, tx, store, pid!);
        break;
      }
      case 'refund':
        await refundOrder(s, tx, store, o, data.providerRefunded ?? false, data.reason ?? ev);
        break;
      case 'generate_pickup_code':
        pickupPlain = pickupCode();
        await tx.query('update orders set pickup_code_hash = $2, pickup_code_last = $3, pickup_code = $4 where id = $1', [o.id, await sha256Hex(`${o.id}:${pickupPlain}`), pickupPlain.slice(-2), pickupPlain]);
        break;
      case 'set_delivered_at':
        await tx.query('update orders set delivered_at = $2 where id = $1', [o.id, now]);
        await tx.query('update shipments set delivered_at = $2 where order_id = $1 and delivered_at is null', [o.id, now]);
        if (o.paymentMethod === 'cod' || o.paymentMethod === 'bank_transfer') {
          await tx.query(`update orders set payment_status = 'paid', paid_at = coalesce(paid_at, $2) where id = $1`, [o.id, now]);
          await tx.query(`update payments set status = 'paid', paid_at = $2 where order_id = $1 and status in ('created','pending')`, [o.id, now]);
          if (o.customerId) await tx.query('update customers set total_spent = total_spent + $2 where id = $1', [o.customerId, o.total]);
        }
        break;
      default:
        break;
    }
  }
  if (ev === 'confirm' && (o.paymentMethod === 'cod' || o.paymentMethod === 'bank_transfer')) await commitSale(s, tx, store, o, actor, lowStock);
  if (ev === 'ship') {
    await tx.query('insert into shipments (store_id, id, order_id, method, carrier, tracking_number, shipped_at) values ($1,$2,$3,$4,$5,$6,$7)', [
      store.id, uuidv7(), o.id, 'delivery', (data.carrier ?? '').slice(0, 60), (data.trackingNumber ?? '').slice(0, 60), now,
    ]);
  }
  await tx.query(
    `update orders set status = $2, fulfillment_status = $3, updated_at = $4, cancelled_at = case when $2 = 'cancelled' then $4::timestamptz else cancelled_at end,
       cancel_reason = case when $2 = 'cancelled' then $5 else cancel_reason end where id = $1`,
    [o.id, t.to, fulfillmentOf(t.to), now, data.reason ?? null],
  );
  await event(tx, o, 'status_changed', o.status, t.to, actorKind, actor.userId, { trackingNumber: data.trackingNumber, reason: data.reason });
  const updated = await getOrder(tx, store.id, o.id);
  const summary = await orderSummary(tx, store, updated);
  const buyer = await s.userRecipient(tx, o.userId);
  const staff = await s.staffRecipients(tx, store.id, 'orders.manage');
  if (t.to === 'cancelled') {
    const by = actorKind === 'buyer' ? 'buyer' : actorKind === 'staff' ? 'staff' : 'system';
    const p: NotificationPayload = { topic: 'order.cancelled', order: summary, by, reason: data.reason ?? null };
    await s.enqueue(tx, store.id, by === 'buyer' ? staff : [...buyer, ...(by === 'system' ? staff : [])], p);
  } else if (ev === 'pay') {
    await s.enqueue(tx, store.id, [...staff, ...buyer], { topic: 'order.paid', order: summary });
  } else if (t.effects.includes('notify_buyer') || ev === 'complete' || ev === 'pack') {
    await s.enqueue(tx, store.id, buyer, { topic: 'order.status_changed', order: summary, from: o.status, to: t.to, pickupCode: pickupPlain, trackingNumber: data.trackingNumber ?? null });
  }
  if (t.effects.includes('notify_owner') && t.to === 'return_requested')
    await s.enqueue(tx, store.id, staff, { topic: 'order.status_changed', order: summary, from: o.status, to: t.to });
  for (const ls of lowStock) {
    const [v] = await tx.query<{ title: L10n; available: number; optionValueIds: string[]; productId: string }>(
      'select p.title, (l.on_hand - l.reserved)::int as available, v.option_value_ids, v.product_id from product_variants v join products p on p.id = v.product_id join inventory_levels l on l.variant_id = v.id where v.id = $1',
      [ls.variantId],
    );
    if (v) {
      const labels = await optionLabels(tx, store, [v.productId]);
      await s.enqueue(tx, store.id, await s.staffRecipients(tx, store.id, 'inventory.adjust'), {
        topic: 'stock.low', storeSlug: store.slug, storeName: pick(store.name, store.defaultLocale), productId: v.productId, productTitle: pick(v.title, store.defaultLocale),
        variantTitle: variantTitle(labels.get(v.productId) ?? [], v.optionValueIds), available: v.available,
      });
    }
  }
  if (ev === 'pay' && store.settings?.autoConfirmPaid) return applyOrderEvent(s, tx, store, o.id, 'confirm', 'system', SYSTEM);
  return updated;
}

async function commitSale(s: Ctx, tx: Sql, store: StoreRow, o: OrderRow, actor: Actor, lowStock: Array<{ productId: string; variantId: string }>) {
  const rs = await tx.query<{ variantId: string; qty: number }>('delete from inventory_reservations where store_id = $1 and order_id = $2 returning variant_id, qty', [store.id, o.id]);
  rs.sort((a, b) => a.variantId.localeCompare(b.variantId));
  for (const r of rs) {
    const [lvl] = await tx.query<{ onHand: number; reserved: number; lowStockThreshold: number; trackInventory: boolean; productId: string }>(
      `update inventory_levels l set on_hand = greatest(0, l.on_hand - $2), reserved = greatest(0, l.reserved - $2) from product_variants v
       where l.variant_id = $1 and v.id = l.variant_id returning l.on_hand, l.reserved, l.low_stock_threshold, v.track_inventory, v.product_id`,
      [r.variantId, r.qty],
    );
    await movement(tx, store.id, r.variantId, -r.qty, 'sale', actor, 'order', o.id, `#${o.number}`);
    if (lvl?.trackInventory && lvl.onHand - lvl.reserved <= lvl.lowStockThreshold) lowStock.push({ productId: lvl.productId, variantId: r.variantId });
  }
  const items = await tx.query<{ productId: string | null; qty: number }>('select product_id, qty from order_items where order_id = $1', [o.id]);
  const pids = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
  for (const it of items) if (it.productId) await tx.query('update products set sold_count = sold_count + $2 where id = $1', [it.productId, it.qty]);
  for (const a of pids)
    for (const b of pids)
      if (a !== b)
        await tx.query(`insert into co_purchases (store_id, product_a, product_b, count) values ($1,$2,$3,1) on conflict (store_id, product_a, product_b) do update set count = co_purchases.count + 1`, [store.id, a, b]);
  for (const pid of pids) await refreshProduct(s, tx, store, pid);
}

async function refundOrder(s: Ctx, tx: Sql, store: StoreRow, o: OrderRow, providerRefunded: boolean, reason: string) {
  const [p] = await tx.query<{ id: string; provider: ProviderId; mode: string; amount: number; status: PaymentStatus; currency: 'UZS'; providerTxnId: string | null }>(
    `select id, provider, mode, amount, status, currency, provider_txn_id from payments where order_id = $1 and status = 'paid' order by created_at desc limit 1`,
    [o.id],
  );
  if (!p) return;
  let status: 'refunded' | 'manual' | 'pending' = 'manual';
  if (providerRefunded || p.mode === 'sandbox') status = 'refunded';
  else {
    const adapter = s.deps.payments.adapter(p.provider);
    const cfg = (await providerConfigs(s, tx, store.id)).find((c) => c.provider === p.provider);
    if (adapter?.refund && cfg) {
      try {
        const r = await adapter.refund({ id: p.id, orderId: o.id, provider: p.provider, mode: p.mode as 'live', status: p.status, amount: p.amount, currency: p.currency, providerTxnId: p.providerTxnId }, p.amount, cfg);
        status = r.status;
      } catch {
        status = 'manual';
      }
    }
  }
  await tx.query('insert into refunds (store_id, id, payment_id, order_id, amount, reason, status) values ($1,$2,$3,$4,$5,$6,$7)', [store.id, uuidv7(), p.id, o.id, p.amount, reason, status]);
  await tx.query(`update payments set status = $2 where id = $1`, [p.id, status === 'pending' ? 'refund_pending' : 'refunded']);
  await tx.query(`update orders set payment_status = $2 where id = $1`, [o.id, status === 'pending' ? 'paid' : 'refunded']);
  if (o.customerId) await tx.query('update customers set total_spent = greatest(0, total_spent - $2) where id = $1', [o.customerId, o.total]);
  await event(tx, o, 'refund', null, null, 'system', null, { amount: p.amount, status, provider: p.provider });
}

/** SQL implementation of the payments ledger port for one store (§11.3). Each call is its own tenant transaction. */
export function sqlLedger(s: Ctx, storeId: string): PaymentLedgerPort {
  const run = <T>(fn: (tx: Sql, store: StoreRow) => Promise<T>) => s.tx(storeId, SYSTEM, async (tx) => fn(tx, await s.storeById(tx, storeId)));
  type PRow = { id: string; orderId: string; provider: ProviderId; providerTxnId: string; amount: number; status: PaymentStatus; openedAt: string | null; createdAt: string; providerTime: string | null; performedAt: string | null; cancelledAt: string | null; cancelReason: number | null };
  const view = (p: PRow): TxnView => ({
    provider: p.provider, providerTxnId: p.providerTxnId, paymentId: p.id, orderId: p.orderId, amount: p.amount, status: p.status,
    createdAt: new Date(p.openedAt ?? p.createdAt), providerTime: new Date(p.providerTime ?? p.createdAt),
    performedAt: p.performedAt ? new Date(p.performedAt) : null, cancelledAt: p.cancelledAt ? new Date(p.cancelledAt) : null, cancelReason: p.cancelReason,
  });
  const byTxn = async (tx: Sql, provider: ProviderId, txn: string) => (await tx.query<PRow>('select * from payments where store_id = $1 and provider = $2 and provider_txn_id = $3', [storeId, provider, txn]))[0];
  return {
    now: () => s.now(),
    async checkPayable(ref, amount): Promise<CheckResult> {
      return run(async (tx) => {
        let orderId = ref.orderId;
        if (!orderId && ref.paymentId && isUuid(ref.paymentId)) orderId = (await tx.query<{ orderId: string }>('select order_id from payments where id = $1', [ref.paymentId]))[0]?.orderId;
        if (!orderId || !isUuid(orderId)) return { ok: false, reason: 'not_found' };
        const [o] = await tx.query<OrderRow & { isDigital: boolean }>(
          `select o.*, exists(select 1 from order_items i join products p on p.id = i.product_id where i.order_id = o.id and p.is_digital) as is_digital from orders o where o.store_id = $1 and o.id = $2`,
          [storeId, orderId],
        );
        if (!o) return { ok: false, reason: 'not_found' };
        const [p] = await tx.query<{ id: string; amount: number; status: PaymentStatus; currency: 'UZS' }>(
          `select id, amount, status, currency from payments where order_id = $1 ${ref.paymentId && isUuid(ref.paymentId) ? 'and id = $2' : ''} order by (status in ('created','pending')) desc, created_at desc limit 1`,
          ref.paymentId && isUuid(ref.paymentId) ? [o.id, ref.paymentId] : [o.id],
        );
        if (o.status === 'cancelled') return { ok: false, reason: 'cancelled' };
        if (o.paymentStatus === 'paid' || p?.status === 'paid') return { ok: false, reason: 'already_paid' };
        if (o.status !== 'pending_payment' || !p) return { ok: false, reason: 'not_payable' };
        if (amount !== -1 && amount !== p.amount) return { ok: false, reason: 'amount_mismatch' };
        return { ok: true, order: { orderId: o.id, orderNumber: o.number, paymentId: p.id, amount: p.amount, currency: p.currency, orderStatus: o.status, paymentStatus: p.status, isDigital: o.isDigital } };
      });
    },
    async getTransaction(provider, txn) {
      return run(async (tx) => {
        const p = await byTxn(tx, provider, txn);
        return p ? view(p) : null;
      });
    },
    async activeTransactionForOrder(provider, orderId) {
      return run(async (tx) => {
        if (!isUuid(orderId)) return null;
        const [p] = await tx.query<PRow>(`select * from payments where store_id = $1 and order_id = $2 and provider = $3 and provider_txn_id is not null and status in ('created','pending') order by created_at desc limit 1`, [storeId, orderId, provider]);
        return p ? view(p) : null;
      });
    },
    async openTransaction(i) {
      return run(async (tx) => {
        const existing = await byTxn(tx, i.provider, i.providerTxnId);
        if (existing) return view(existing);
        const now = s.now().toISOString();
        const [free] = await tx.query<{ id: string }>(
          `select id from payments where store_id = $1 and order_id = $2 and provider_txn_id is null and status in ('created','pending') order by (provider = $3) desc, created_at desc limit 1`,
          [storeId, i.orderId, i.provider],
        );
        if (free)
          await tx.query(`update payments set provider = $2, provider_txn_id = $3, status = 'pending', provider_time = $4, opened_at = $5, amount = $6 where id = $1`, [
            free.id, i.provider, i.providerTxnId, i.providerTime.toISOString(), now, i.amount,
          ]);
        else {
          const [o] = await tx.query<{ currency: string }>('select currency from orders where id = $1', [i.orderId]);
          await tx.query(
            `insert into payments (store_id, id, order_id, provider, mode, status, amount, currency, provider_txn_id, provider_time, opened_at) values ($1,$2,$3,$4,'sandbox','pending',$5,$6,$7,$8,$9)`,
            [storeId, uuidv7(), i.orderId, i.provider, i.amount, i.provider === 'stars' ? 'XTR' : (o?.currency ?? 'UZS'), i.providerTxnId, i.providerTime.toISOString(), now],
          );
          await tx.query(`update payments set mode = coalesce((select mode from payment_provider_configs c where c.store_id = $1 and c.provider = $2), 'sandbox') where provider_txn_id = $3 and provider = $2`, [storeId, i.provider, i.providerTxnId]);
        }
        await tx.query(`update orders set payment_status = 'pending' where id = $1 and payment_status = 'unpaid'`, [i.orderId]);
        return view((await byTxn(tx, i.provider, i.providerTxnId))!);
      });
    },
    async confirmTransaction(provider, txn) {
      return run(async (tx, store) => {
        const p = await byTxn(tx, provider, txn);
        if (!p) throw new DomainError('NOT_FOUND', 'transaction not found');
        if (p.status === 'paid') return view(p);
        if (p.status !== 'pending' && p.status !== 'created') throw new DomainError('INVALID_TRANSITION', `payment is ${p.status}`);
        const now = s.now().toISOString();
        await tx.query(`update payments set status = 'paid', performed_at = $2, paid_at = $2 where id = $1`, [p.id, now]);
        await tx.query(`update payments set status = 'cancelled', cancelled_at = $2 where order_id = $1 and id <> $3 and status in ('created','pending') and provider_txn_id is null`, [p.orderId, now, p.id]);
        await tx.query(`update orders set payment_status = 'paid', paid_at = $2 where id = $1`, [p.orderId, now]);
        const [o] = await tx.query<{ customerId: string | null; total: number }>('select customer_id, total from orders where id = $1', [p.orderId]);
        if (o?.customerId) await tx.query('update customers set total_spent = total_spent + $2 where id = $1', [o.customerId, o.total]);
        await event(tx, { id: p.orderId, storeId } as OrderRow, 'payment', null, null, 'provider', null, { provider, txn, amount: p.amount });
        await applyOrderEvent(s, tx, store, p.orderId, 'pay', 'provider', SYSTEM);
        return view((await byTxn(tx, provider, txn))!);
      });
    },
    async cancelTransaction(provider, txn, reason) {
      return run(async (tx, store) => {
        const p = await byTxn(tx, provider, txn);
        if (!p) throw new DomainError('NOT_FOUND', 'transaction not found');
        if (p.status === 'cancelled' || p.status === 'refunded' || p.status === 'expired' || p.status === 'failed') return view(p);
        const now = s.now().toISOString();
        if (p.status === 'paid') {
          const o = await getOrder(tx, storeId, p.orderId);
          if (!['paid', 'confirmed', 'packing'].includes(o.status)) throw new DomainError('INVALID_TRANSITION', 'Order already shipped');
          await tx.query(`update payments set cancelled_at = $2, cancel_reason = $3 where id = $1`, [p.id, now, reason]);
          await applyOrderEvent(s, tx, store, p.orderId, 'cancel', 'system', SYSTEM, { providerRefunded: true, reason: `provider_cancel_${reason}` });
        } else {
          await tx.query(`update payments set status = 'cancelled', cancelled_at = $2, cancel_reason = $3 where id = $1`, [p.id, now, reason]);
          // keep the order payable: give it a fresh open payment so the buyer can retry
          const [o] = await tx.query<{ status: string; paymentMethod: string; total: number }>('select status, payment_method, total from orders where id = $1', [p.orderId]);
          if (o?.status === 'pending_payment') {
            await tx.query(
              `insert into payments (store_id, id, order_id, provider, mode, status, amount, currency) select $1, $2, $3, provider, mode, 'created', amount, currency from payments where id = $4`,
              [storeId, uuidv7(), p.orderId, p.id],
            );
            await tx.query(`update orders set payment_status = 'unpaid' where id = $1`, [p.orderId]);
          }
          await event(tx, { id: p.orderId, storeId } as OrderRow, 'payment', null, null, 'provider', null, { provider, txn, cancelled: reason });
        }
        return view((await byTxn(tx, provider, txn))!);
      });
    },
    async statement(provider, from, to) {
      return run(async (tx) =>
        (await tx.query<PRow>(`select * from payments where store_id = $1 and provider = $2 and provider_txn_id is not null and opened_at between $3 and $4 order by opened_at`, [storeId, provider, from.toISOString(), to.toISOString()])).map(view),
      );
    },
    async log(e) {
      await run(async (tx) =>
        tx.query('insert into payment_events (store_id, id, provider, kind, payload_hash, payload, signature_ok, response) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
          storeId, uuidv7(), e.provider, e.kind, await sha256Hex(e.payload), e.payload.slice(0, 8000), e.signatureOk, e.response.slice(0, 8000),
        ]),
      );
    },
  };
}

export interface PlaceOrderInput {
  slug: string;
  idempotencyKey: string;
  contact: { name: string; phone: string };
  methodId: string | null;
  address?: { regionCode: string; district?: string; line1: string; line2?: string; landmark?: string; lat?: number | null; lng?: number | null; label?: string; save?: boolean } | null;
  pickupPointId?: string | null;
  paymentMethod: ProviderId;
  note?: string;
  source?: string | null;
}

const PHONE_RE = /^\+?998\d{9}$/;

export function commerceService(s: Ctx) {
  const view = (actor: Actor, slug: string, opts?: Parameters<typeof buildCart>[4]) => s.buyer(slug, actor, (tx, store, uid) => buildCart(s, tx, store, uid, opts));

  async function quote(tx: Sql, store: StoreRow, uid: string, i: { methodId?: string | null; region?: string | null; district?: string | null }) {
    const base = await buildCart(s, tx, store, uid, { shipping: null });
    const weight = base.items.reduce((a, it) => a + it.qty * it.weightG, 0);
    const options = base.isDigital ? [] : await shippingOptions(tx, store, i.region ?? 'UZ-TK', i.district ?? null, weight, s.now());
    const method = options.find((o) => o.methodId === i.methodId) ?? null;
    const cart = method ? await buildCart(s, tx, store, uid, { shipping: { amount: method.amount, freeOver: method.freeOver } }) : base;
    const configs = await providerConfigs(s, tx, store.id);
    let methods = s.deps.payments.availableMethods(configs, { isDigital: cart.isDigital, currency: cart.isDigital ? 'XTR' : 'UZS' });
    if (method && !method.codAllowed) methods = methods.filter((m) => m !== 'cod');
    const customer = await customerFor(tx, store, uid);
    const addresses = customer ? await tx.query('select * from addresses where store_id = $1 and customer_id = $2 order by is_default desc, created_at desc', [store.id, customer.id]) : [];
    const [user] = await tx.query<{ firstName: string; lastName: string | null; phone: string | null; phoneVerified: boolean }>('select first_name, last_name, phone, phone_verified from users where id = $1', [uid]);
    const starRate = Number((store.settings as { starRateSom?: number })?.starRateSom) || STAR_RATE_SOM;
    return {
      cart,
      shippingOptions: options,
      selectedMethod: method,
      paymentMethods: methods.map((m) => ({ provider: m, mode: configs.find((c) => c.provider === m)?.mode ?? 'sandbox' })),
      stars: cart.isDigital ? Math.ceil(cart.pricing.total / 100 / starRate) : null,
      prefill: { name: customer?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' '), phone: customer?.phone ?? user?.phone ?? '', phoneVerified: !!user?.phoneVerified, addresses },
    };
  }

  async function orderDto(tx: Sql, store: StoreRow, o: OrderRow, as: 'buyer' | 'staff') {
    const items = await tx.query('select * from order_items where order_id = $1', [o.id]);
    const events = await tx.query('select type, from_status, to_status, actor, data, created_at from order_events where order_id = $1 order by created_at', [o.id]);
    const payments = await tx.query('select id, provider, mode, status, amount, currency, provider_txn_id, created_at, paid_at, redirect_url from payments where order_id = $1 order by created_at', [o.id]);
    const shipments = await tx.query('select * from shipments where order_id = $1', [o.id]);
    const refunds = await tx.query('select amount, status, reason, created_at from refunds where order_id = $1', [o.id]);
    const { pickupCodeHash: _h, pickupCode, ...rest } = o;
    return {
      ...rest,
      pickupCode: as === 'buyer' && o.status === 'ready_for_pickup' ? pickupCode : null,
      items, events, payments, shipments, refunds,
      allowed: allowedEvents(o.status, as === 'buyer' ? 'buyer' : 'staff', o.fulfilmentKind),
      storeSlug: store.slug,
    };
  }

  async function nextActionFor(tx: Sql, store: StoreRow, o: OrderRow, paymentId: string, provider: ProviderId, amount: number, currency: string, locale: 'uz' | 'ru' | 'en', isDigital: boolean): Promise<NextAction> {
    const cfg = (await providerConfigs(s, tx, store.id)).find((c) => c.provider === provider);
    const adapter = s.deps.payments.adapter(provider);
    if (!cfg || !adapter) throw new DomainError('PAYMENT_METHOD_UNAVAILABLE');
    const items = await tx.query<{ title: string; qty: number; unitPrice: number; ikpuCode: string | null; packageCode: string | null; vatPercent: number | null }>('select title, qty, unit_price, ikpu_code, package_code, vat_percent from order_items where order_id = $1', [o.id]);
    const na = await adapter.createIntent(
      {
        store: { id: store.id, slug: store.slug, name: pick(store.name, locale) },
        order: { id: o.id, shortId: o.shortId, number: o.number, total: amount, currency: currency as 'UZS', items, isDigital },
        payment: { id: paymentId, orderId: o.id, provider, mode: cfg.mode, status: 'created', amount, currency: currency as 'UZS' },
        returnUrl: `${s.deps.links.miniAppBase}?startapp=${store.slug}-o-${o.shortId}`,
        locale,
      },
      cfg,
    );
    if (na.type === 'redirect' || na.type === 'sandbox') await tx.query('update payments set redirect_url = $2 where id = $1', [paymentId, na.url]);
    return na;
  }

  return {
    'cart.get': async (actor: Actor, i: { slug: string }) => view(actor, i.slug),

    'cart.setItem': async (actor: Actor, i: { slug: string; variantId: string; qty: number }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        if (!isUuid(i.variantId)) throw new DomainError('NOT_FOUND', 'Variant not found');
        const qty = Math.max(0, Math.min(99, Math.floor(i.qty)));
        const cart = await cartRow(tx, store, uid);
        if (qty === 0) await tx.query('delete from cart_items where cart_id = $1 and variant_id = $2', [cart.id, i.variantId]);
        else {
          const [v] = await tx.query<{ price: number; status: string; trackInventory: boolean; allowBackorder: boolean; available: number; isDigital: boolean }>(
            `select v.price, p.status, v.track_inventory, v.allow_backorder, p.is_digital, coalesce(l.on_hand - l.reserved, 0)::int as available
             from product_variants v join products p on p.id = v.product_id left join inventory_levels l on l.variant_id = v.id where v.store_id = $1 and v.id = $2`,
            [store.id, i.variantId],
          );
          if (!v || v.status !== 'active') throw new DomainError('NOT_FOUND', 'Product is not available');
          if (v.trackInventory && !v.allowBackorder && v.available < qty) throw new DomainError('OUT_OF_STOCK', 'Not enough stock', { available: v.available });
          await tx.query(
            `insert into cart_items (store_id, cart_id, variant_id, qty, added_price) values ($1,$2,$3,$4,$5) on conflict (cart_id, variant_id) do update set qty = excluded.qty`,
            [store.id, cart.id, i.variantId, qty, v.price],
          );
        }
        await tx.query('update carts set updated_at = $2 where id = $1', [cart.id, s.now().toISOString()]);
        return buildCart(s, tx, store, uid);
      }),

    /** Accept the new prices after a "price changed" notice. */
    'cart.acceptPrices': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const cart = await cartRow(tx, store, uid);
        await tx.query('update cart_items ci set added_price = v.price from product_variants v where v.id = ci.variant_id and ci.cart_id = $1', [cart.id]);
        return buildCart(s, tx, store, uid);
      }),

    'cart.applyPromo': async (actor: Actor, i: { slug: string; code: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const code = i.code.trim().slice(0, 40);
        const preview = await buildCart(s, tx, store, uid, { promo: code });
        if (preview.pricing.promo?.status === 'applied') {
          await tx.query('update carts set promo_code = $2 where id = $1', [preview.id, code]);
          return { cart: { ...preview, promoCode: code }, promo: preview.pricing.promo, explanation: null };
        }
        return { cart: await buildCart(s, tx, store, uid), promo: preview.pricing.promo, explanation: preview.pricing.explanations.find((e) => e.code.startsWith('PROMO_')) ?? null };
      }),

    'cart.removePromo': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const cart = await cartRow(tx, store, uid);
        await tx.query('update carts set promo_code = null where id = $1', [cart.id]);
        return buildCart(s, tx, store, uid);
      }),

    'checkout.quote': async (actor: Actor, i: { slug: string; methodId?: string | null; region?: string | null; district?: string | null }) =>
      s.buyer(i.slug, actor, (tx, store, uid) => quote(tx, store, uid, i)),

    'orders.place': async (actor: Actor, i: PlaceOrderInput) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        if (!i.idempotencyKey || i.idempotencyKey.length > 80) throw new DomainError('VALIDATION', 'Idempotency-Key is required');
        const [dup] = await tx.query<OrderRow>('select * from orders where store_id = $1 and user_id = $2 and idempotency_key = $3', [store.id, uid, i.idempotencyKey]);
        if (dup) {
          const [p] = await tx.query<{ redirectUrl: string | null; provider: ProviderId; id: string }>('select id, redirect_url, provider from payments where order_id = $1 order by created_at desc limit 1', [dup.id]);
          return { order: await orderDto(tx, store, dup, 'buyer'), nextAction: p?.redirectUrl ? ({ type: p.redirectUrl.startsWith('sandbox:') ? 'sandbox' : 'redirect', url: p.redirectUrl, provider: p.provider, paymentId: p.id, openWith: 'openLink' } as NextAction) : ({ type: 'none', message: '' } as NextAction), replayed: true };
        }
        const name = i.contact?.name?.trim().slice(0, 80) ?? '';
        const phone = (i.contact?.phone ?? '').replace(/[\s()-]/g, '');
        if (!name) throw new DomainError('VALIDATION', 'Enter your name', { field: 'name' });
        if (!PHONE_RE.test(phone)) throw new DomainError('VALIDATION', 'Enter a phone number like +998 90 123 45 67', { field: 'phone' });
        const customer0 = await customerFor(tx, store, uid);
        if (customer0?.isBlocked) throw new DomainError('FORBIDDEN', 'This store cannot accept your orders');
        const q = await quote(tx, store, uid, { methodId: i.methodId, region: i.address?.regionCode ?? 'UZ-TK', district: i.address?.district ?? null });
        const cart = q.cart;
        const live = cart.items.filter((it) => !it.warnings.includes('unavailable'));
        if (!live.length) throw new DomainError('CART_EMPTY');
        if (cart.mixedDigital) throw new DomainError('VALIDATION', 'Digital and physical items must be ordered separately', { field: 'cart' });
        const bad = live.find((it) => it.warnings.includes('out_of_stock') || it.warnings.includes('qty_reduced'));
        if (bad) throw new DomainError('OUT_OF_STOCK', 'Some items are no longer in stock', { variantId: bad.variantId, available: bad.available });
        if (live.some((it) => it.warnings.includes('price_changed'))) throw new DomainError('PRICE_CHANGED', 'Prices changed since you added these items');
        let method: ShippingOption | null = null;
        if (!cart.isDigital) {
          method = q.selectedMethod;
          if (!method) throw new DomainError('SHIPPING_UNAVAILABLE', 'Choose a delivery method', { field: 'method' });
          if (method.type !== 'self_pickup' && method.type !== 'pickup_point' && (!i.address?.line1?.trim() || !i.address.regionCode))
            throw new DomainError('VALIDATION', 'Enter the delivery address', { field: 'address' });
          if (method.type === 'pickup_point' && method.pickupPoints.length && !method.pickupPoints.some((p) => p.id === i.pickupPointId))
            throw new DomainError('VALIDATION', 'Choose a pickup point', { field: 'pickupPoint' });
        }
        if (!q.paymentMethods.some((m) => m.provider === i.paymentMethod)) throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', 'This payment method is not available for this order');
        // lock stock rows in variant-id order (deadlock-free) and re-validate
        const lines = await cartLines(tx, store, cart.id, true);
        for (const l of lines.filter((x) => x.status === 'active'))
          if (l.trackInventory && !l.allowBackorder && l.available < l.qty) throw new DomainError('OUT_OF_STOCK', 'Some items are no longer in stock', { variantId: l.variantId, available: l.available });
        const now = s.now();
        const nowIso = now.toISOString();
        // customer
        let customerId = customer0?.id ?? null;
        if (!customerId) {
          customerId = uuidv7(now.getTime());
          await tx.query('insert into customers (store_id, id, user_id, name, phone) values ($1,$2,$3,$4,$5)', [store.id, customerId, uid, name, phone]);
        } else await tx.query('update customers set name = $2, phone = $3 where id = $1', [customerId, name, phone]);
        await tx.query('update customers set orders_count = orders_count + 1, last_order_at = $2 where id = $1', [customerId, nowIso]);
        if (i.address?.save && i.address.line1) {
          await tx.query('update addresses set is_default = false where customer_id = $1', [customerId]);
          await tx.query(`insert into addresses (store_id, id, customer_id, label, region_code, district, line1, line2, landmark, lat, lng, is_default) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`, [
            store.id, uuidv7(), customerId, (i.address.label ?? '').slice(0, 40), i.address.regionCode, i.address.district ?? '', i.address.line1.slice(0, 200), (i.address.line2 ?? '').slice(0, 200), (i.address.landmark ?? '').slice(0, 200), i.address.lat ?? null, i.address.lng ?? null,
          ]);
        }
        const [{ orderSeq }] = (await tx.query<{ orderSeq: number }>('update stores set order_seq = order_seq + 1 where id = $1 returning order_seq', [store.id])) as [{ orderSeq: number }];
        const orderId = uuidv7(now.getTime());
        const prepaid = !['cod', 'bank_transfer'].includes(i.paymentMethod);
        const status: OrderStatus = prepaid ? 'pending_payment' : 'awaiting_confirmation';
        const fulfil: FulfilmentKind = method && (method.type === 'self_pickup' || method.type === 'pickup_point') ? 'pickup' : 'delivery';
        const p = cart.pricing;
        const pickupPoint = method?.pickupPoints.find((x) => x.id === i.pickupPointId) ?? null;
        await tx.query(
          `insert into orders (store_id, id, number, short_id, user_id, customer_id, status, payment_status, fulfilment_kind, payment_method, currency, subtotal, discount_total, shipping_total, total, pricing,
             contact, shipping_address, shipping_method_id, shipping_method_name, delivery_promise, note, source, locale, idempotency_key, placed_at, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,'unpaid',$8,$9,'UZS',$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$24)`,
          [store.id, orderId, orderSeq, shortId(), uid, customerId, status, fulfil, i.paymentMethod, p.subtotal, p.discountTotal, p.shippingTotal, p.total,
            json({ applied: p.applied, explanations: p.explanations, promo: p.promo }), json({ name, phone }),
            method ? json(fulfil === 'pickup' ? { pickupPoint } : i.address) : null, method?.methodId ?? null, method ? json(method.name) : null,
            method ? json({ from: method.promise.from, to: method.promise.to }) : null, (i.note ?? '').slice(0, 500), i.source ? i.source.slice(0, 40) : null, actor.locale, i.idempotencyKey, nowIso],
        );
        const labels = await optionLabels(tx, store, [...new Set(lines.map((l) => l.productId))]);
        const ttl = prepaid ? (s.deps.reservationTtlMs ?? 30 * 60_000) : (s.deps.codReservationTtlMs ?? 72 * 3600_000);
        for (const l of lines.filter((x) => x.status === 'active')) {
          const pl = p.lines.find((x) => x.key === l.variantId)!;
          await tx.query(
            `insert into order_items (store_id, id, order_id, variant_id, product_id, title, variant_title, sku, image_url, unit_price, qty, line_total, discount_allocations, ikpu_code, package_code, vat_percent)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)`,
            [store.id, uuidv7(now.getTime()), orderId, l.variantId, l.productId, pick(l.productTitle, actor.locale, store.defaultLocale), variantTitle(labels.get(l.productId) ?? [], l.optionValueIds),
              l.sku, l.mediaUrl ?? l.coverUrl, l.price, l.qty, pl.total, json(pl.allocations), l.ikpuCode, l.packageCode, l.vatPercent],
          );
          if (l.trackInventory) {
            await tx.query('update inventory_levels set reserved = reserved + $2 where variant_id = $1', [l.variantId, l.qty]);
            await tx.query('insert into inventory_reservations (store_id, id, variant_id, order_id, qty, expires_at) values ($1,$2,$3,$4,$5,$6)', [
              store.id, uuidv7(), l.variantId, orderId, l.qty, new Date(now.getTime() + ttl).toISOString(),
            ]);
          }
        }
        for (const a of p.applied) {
          await tx.query('update discounts set used_count = used_count + 1 where id = $1', [a.discountId]);
          await tx.query('insert into discount_redemptions (store_id, discount_id, order_id, customer_id, amount) values ($1,$2,$3,$4,$5) on conflict do nothing', [store.id, a.discountId, orderId, customerId, a.amount]);
        }
        const isStars = i.paymentMethod === 'stars';
        const amount = isStars ? (q.stars ?? 1) : p.total;
        const currency = isStars ? 'XTR' : 'UZS';
        const cfgMode = q.paymentMethods.find((m) => m.provider === i.paymentMethod)?.mode ?? 'sandbox';
        const paymentId = uuidv7(now.getTime());
        await tx.query(`insert into payments (store_id, id, order_id, provider, mode, status, amount, currency, expires_at) values ($1,$2,$3,$4,$5,'created',$6,$7,$8)`, [
          store.id, paymentId, orderId, i.paymentMethod, cfgMode, amount, currency, prepaid ? new Date(now.getTime() + ttl).toISOString() : null,
        ]);
        await tx.query(`update carts set status = 'converted', updated_at = $2 where id = $1`, [cart.id, nowIso]);
        const o = await getOrder(tx, store.id, orderId);
        await event(tx, o, 'status_changed', null, status, 'buyer', uid, { paymentMethod: i.paymentMethod });
        const summary = await orderSummary(tx, store, o);
        await s.enqueue(tx, store.id, await s.staffRecipients(tx, store.id, 'orders.manage'), { topic: 'order.placed', order: summary });
        await s.enqueue(tx, store.id, await s.userRecipient(tx, uid), { topic: 'order.placed', order: summary });
        await tx.query(`insert into analytics_events (store_id, id, session_id, user_id, name, props, source, ts) values ($1,$2,$3,$4,'purchase',$5::jsonb,$6,$7)`, [
          store.id, uuidv7(), `u:${uid}`, uid, json({ orderId, total: p.total }), i.source ?? null, nowIso,
        ]);
        const nextAction = await nextActionFor(tx, store, o, paymentId, i.paymentMethod, amount, currency, actor.locale, cart.isDigital);
        return { order: await orderDto(tx, store, o, 'buyer'), nextAction, replayed: false };
      }),

    'orders.mine': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) =>
        tx.query(
          `select o.id, o.short_id, o.number, o.status, o.payment_status, o.total, o.currency, o.placed_at, o.delivery_promise, o.fulfilment_kind,
             (select json_agg(json_build_object('title', i.title, 'imageUrl', i.image_url, 'qty', i.qty)) from order_items i where i.order_id = o.id) as items
           from orders o where o.store_id = $1 and o.user_id = $2 order by o.placed_at desc limit 50`,
          [store.id, uid],
        ),
      ),

    'orders.get': async (actor: Actor, i: { slug: string; id: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const o = await getOrder(tx, store.id, i.id);
        if (o.userId !== uid) throw new DomainError('NOT_FOUND', 'Order not found');
        return orderDto(tx, store, o, 'buyer');
      }),

    'orders.cancel': async (actor: Actor, i: { slug: string; id: string; reason?: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const o = await getOrder(tx, store.id, i.id);
        if (o.userId !== uid) throw new DomainError('NOT_FOUND', 'Order not found');
        const up = await applyOrderEvent(s, tx, store, o.id, 'cancel', 'buyer', actor, { reason: (i.reason ?? 'buyer').slice(0, 200) });
        return orderDto(tx, store, up, 'buyer');
      }),

    'orders.returnRequest': async (actor: Actor, i: { slug: string; id: string; reason: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const o = await getOrder(tx, store.id, i.id);
        if (o.userId !== uid) throw new DomainError('NOT_FOUND', 'Order not found');
        const up = await applyOrderEvent(s, tx, store, o.id, 'request_return', 'buyer', actor, { reason: i.reason.slice(0, 500) });
        return orderDto(tx, store, up, 'buyer');
      }),

    'orders.reorder': async (actor: Actor, i: { slug: string; id: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const o = await getOrder(tx, store.id, i.id);
        if (o.userId !== uid) throw new DomainError('NOT_FOUND', 'Order not found');
        const cart = await cartRow(tx, store, uid);
        const items = await tx.query<{ variantId: string; qty: number }>(
          `select i.variant_id, least(i.qty, case when v.track_inventory and not v.allow_backorder then greatest(0, l.on_hand - l.reserved) else i.qty end)::int as qty
           from order_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id and p.status = 'active' left join inventory_levels l on l.variant_id = v.id where i.order_id = $1`,
          [o.id],
        );
        let added = 0;
        for (const it of items.filter((x) => x.qty > 0)) {
          await tx.query(
            `insert into cart_items (store_id, cart_id, variant_id, qty, added_price) select $1, $2, id, $4, price from product_variants where id = $3 on conflict (cart_id, variant_id) do update set qty = least(99, cart_items.qty + excluded.qty)`,
            [store.id, cart.id, it.variantId, it.qty],
          );
          added++;
        }
        return { added, skipped: items.length - added, cart: await buildCart(s, tx, store, uid) };
      }),

    'orders.retryPayment': async (actor: Actor, i: { slug: string; id: string; provider?: ProviderId }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const o = await getOrder(tx, store.id, i.id);
        if (o.userId !== uid) throw new DomainError('NOT_FOUND', 'Order not found');
        if (o.status !== 'pending_payment') throw new DomainError('INVALID_TRANSITION', 'Order is not awaiting payment');
        const configs = await providerConfigs(s, tx, store.id);
        const provider = i.provider ?? o.paymentMethod;
        const isDigital = (await tx.query('select 1 from order_items it join products p on p.id = it.product_id where it.order_id = $1 and p.is_digital', [o.id])).length > 0;
        if (!s.deps.payments.availableMethods(configs, { isDigital, currency: isDigital ? 'XTR' : 'UZS' }).includes(provider) || ['cod', 'bank_transfer'].includes(provider))
          throw new DomainError('PAYMENT_METHOD_UNAVAILABLE');
        await tx.query(`update payments set status = 'cancelled', cancelled_at = $2 where order_id = $1 and status = 'created' and provider_txn_id is null`, [o.id, s.now().toISOString()]);
        const [last] = await tx.query<{ amount: number; currency: string }>('select amount, currency from payments where order_id = $1 order by created_at desc limit 1', [o.id]);
        const paymentId = uuidv7();
        const amount = provider === 'stars' ? (last?.currency === 'XTR' ? last.amount : Math.ceil(o.total / 100 / STAR_RATE_SOM)) : o.total;
        const currency = provider === 'stars' ? 'XTR' : 'UZS';
        const mode = configs.find((c) => c.provider === provider)?.mode ?? 'sandbox';
        await tx.query(`insert into payments (store_id, id, order_id, provider, mode, status, amount, currency) values ($1,$2,$3,$4,$5,'created',$6,$7)`, [store.id, paymentId, o.id, provider, mode, amount, currency]);
        await tx.query('update orders set payment_method = $2 where id = $1', [o.id, provider]);
        return { nextAction: await nextActionFor(tx, store, { ...o, paymentMethod: provider }, paymentId, provider, amount, currency, actor.locale, isDigital) };
      }),

    /** Drives the provider simulator against the real protocol handlers (sandbox mode only). */
    'sandbox.pay': async (actor: Actor, i: { slug: string; paymentId: string; scenario?: string }) => {
      const { store, payment } = await s.buyer(i.slug, actor, async (tx, store, uid) => {
        const [payment] = await tx.query<{ id: string; orderId: string; provider: ProviderId; mode: string; amount: number; userId: string }>(
          'select p.id, p.order_id, p.provider, p.mode, p.amount, o.user_id from payments p join orders o on o.id = p.order_id where p.store_id = $1 and p.id = $2',
          [store.id, i.paymentId],
        );
        if (!payment || payment.userId !== uid) throw new DomainError('NOT_FOUND', 'Payment not found');
        if (payment.mode !== 'sandbox') throw new DomainError('FORBIDDEN', 'Not a sandbox payment');
        return { store, payment };
      });
      const ledger = sqlLedger(s, store.id);
      const onMessage = (m: Parameters<NonNullable<typeof s.deps.onProtocolMessage>>[1]) => s.deps.onProtocolMessage?.(store.id, m);
      let result: SimulationResult;
      const sc = i.scenario ?? 'success';
      switch (payment.provider) {
        case 'payme':
          result = await new SandboxPayme({ ledger, onMessage, config: sandboxConfig('payme') }).pay(payment.orderId, payment.amount, sc as 'success');
          break;
        case 'click':
          result = await new SandboxClick({ ledger, onMessage, config: sandboxConfig('click') }).pay(payment.orderId, payment.amount, sc as 'success');
          break;
        case 'uzum':
          result = await new SandboxUzum({ ledger, onMessage, config: sandboxConfig('uzum') }).pay(payment.orderId, payment.amount, sc as 'success');
          break;
        case 'telegram':
        case 'stars':
          result = await new SandboxTelegramInvoice({ ledger, onMessage, provider: payment.provider, currency: payment.provider === 'stars' ? 'XTR' : 'UZS', config: sandboxConfig(payment.provider), slowMs: 50 }).pay(payment.id, payment.amount, sc as 'success');
          break;
        default:
          throw new DomainError('PAYMENT_METHOD_UNAVAILABLE');
      }
      return { status: result.status, detail: result.detail ?? null, messages: result.messages };
    },

    /** Incoming provider webhook (server routes /hooks/:provider/:storeId[/:action]). */
    'hooks.handle': async (_actor: Actor, i: { provider: ProviderId; storeId: string; action?: string; method?: string; headers: Record<string, string | undefined>; body: string; ip?: string }) => {
      if (!isUuid(i.storeId)) return { status: 404, headers: {}, body: '{"error":"store"}' };
      const cfg = await s.tx(i.storeId, SYSTEM, async (tx) => (await providerConfigs(s, tx, i.storeId)).find((c) => c.provider === i.provider));
      const handler = s.deps.payments.handler(i.provider);
      if (!cfg || !handler) return { status: 404, headers: { 'content-type': 'application/json' }, body: '{"error":"provider not configured"}' };
      return handler.handle({ action: i.action, method: i.method, headers: i.headers, body: i.body, ip: i.ip }, cfg, sqlLedger(s, i.storeId));
    },

    // ── Owner order management ─────────────────────────────────────────────
    'admin.orders.list': async (actor: Actor, i: { storeId: string; status?: string | null; q?: string | null; cursor?: string | null }) =>
      s.staff(i.storeId, actor, 'orders.read', async (tx) => {
        const params: unknown[] = [i.storeId];
        let w = 'o.store_id = $1';
        if (i.status === 'attention') w += ` and o.status in ('paid','awaiting_confirmation','return_requested')`;
        else if (i.status === 'active') w += ` and o.status in ('confirmed','packing','shipped','ready_for_pickup')`;
        else if (i.status === 'done') w += ` and o.status in ('delivered','completed')`;
        else if (i.status === 'closed') w += ` and o.status in ('cancelled','returned')`;
        else if (i.status) params.push(i.status), (w += ` and o.status = $${params.length}`);
        if (i.q?.trim()) {
          params.push(`%${i.q.trim().toLowerCase().replace(/^#/, '')}%`);
          w += ` and (o.number::text like $${params.length} or lower(o.contact->>'name') like $${params.length} or o.contact->>'phone' like $${params.length} or o.short_id like $${params.length})`;
        }
        const off = Number(i.cursor ?? 0) || 0;
        params.push(off);
        const rows = await tx.query(
          `select o.id, o.short_id, o.number, o.status, o.payment_status, o.payment_method, o.fulfilment_kind, o.total, o.currency, o.contact, o.placed_at, o.delivery_promise,
             (select json_agg(json_build_object('title', i.title, 'imageUrl', i.image_url, 'qty', i.qty, 'variantTitle', i.variant_title)) from order_items i where i.order_id = o.id) as items
           from orders o where ${w} order by o.placed_at desc limit 41 offset $${params.length}`,
          params,
        );
        const counts = await tx.query<{ status: string; n: number }>('select status, count(*)::int as n from orders where store_id = $1 group by status', [i.storeId]);
        return { items: rows.slice(0, 40), nextCursor: rows.length > 40 ? String(off + 40) : null, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
      }, { write: false }),

    'admin.orders.get': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'orders.read', async (tx, m) => {
        const o = await getOrder(tx, i.storeId, i.id);
        const customer = o.customerId ? (await tx.query('select id, name, phone, tags, note, orders_count, total_spent, is_blocked from customers where id = $1', [o.customerId]))[0] : null;
        const notes = await tx.query(`select data, created_at, actor_user_id from order_events where order_id = $1 and type = 'note' order by created_at`, [o.id]);
        return { ...(await orderDto(tx, m.store, o, 'staff')), customer, notes, canManage: m.role !== 'viewer' };
      }, { write: false }),

    'admin.orders.transition': async (actor: Actor, i: { storeId: string; id: string; event: OrderEvent; trackingNumber?: string; carrier?: string; pickupCode?: string; reason?: string }) =>
      s.staff(i.storeId, actor, 'orders.manage', async (tx, m) => {
        if (i.event === 'pay') throw new DomainError('INVALID_TRANSITION', 'Payments are confirmed by the provider');
        const before = await getOrder(tx, i.storeId, i.id);
        const up = await applyOrderEvent(s, tx, m.store, before.id, i.event, 'staff', actor, { trackingNumber: i.trackingNumber, carrier: i.carrier, pickupCode: i.pickupCode, reason: i.reason });
        await s.audit(tx, i.storeId, actor, m.role, `order.${i.event}`, 'order', before.id, { status: before.status }, { status: up.status });
        return orderDto(tx, m.store, up, 'staff');
      }),

    'admin.orders.note': async (actor: Actor, i: { storeId: string; id: string; text: string }) =>
      s.staff(i.storeId, actor, 'orders.manage', async (tx) => {
        const o = await getOrder(tx, i.storeId, i.id);
        if (!i.text.trim()) throw new DomainError('VALIDATION', 'Note is empty', { field: 'text' });
        await event(tx, o, 'note', null, null, 'staff', actor.userId, { text: i.text.trim().slice(0, 1000), author: actor.name ?? '' });
        return { ok: true };
      }),

    'admin.orders.refund': async (actor: Actor, i: { storeId: string; id: string; reason: string }) =>
      s.staff(i.storeId, actor, 'orders.refund', async (tx, m) => {
        const o = await getOrder(tx, i.storeId, i.id, true);
        if (o.paymentStatus !== 'paid') throw new DomainError('INVALID_TRANSITION', 'Nothing to refund');
        if (['paid', 'confirmed', 'packing'].includes(o.status)) {
          const up = await applyOrderEvent(s, tx, m.store, o.id, 'cancel', 'staff', actor, { reason: i.reason });
          await s.audit(tx, i.storeId, actor, m.role, 'order.refund', 'order', o.id, { status: o.status }, { status: up.status });
          return orderDto(tx, m.store, up, 'staff');
        }
        if (o.status === 'return_requested') {
          const up = await applyOrderEvent(s, tx, m.store, o.id, 'accept_return', 'staff', actor, { reason: i.reason });
          await s.audit(tx, i.storeId, actor, m.role, 'order.refund', 'order', o.id, { status: o.status }, { status: up.status });
          return orderDto(tx, m.store, up, 'staff');
        }
        throw new DomainError('INVALID_TRANSITION', 'Shipped orders are refunded through a return');
      }),

    // ── Background jobs ────────────────────────────────────────────────────
    'jobs.expireReservations': async () => {
      const due = await s.tx(null, SYSTEM, (tx) => tx.query<{ storeId: string; orderId: string }>('select * from expired_reservation_orders($1)', [s.now().toISOString()]));
      let cancelled = 0;
      for (const d of due)
        await s.tx(d.storeId, SYSTEM, async (tx) => {
          const store = await s.storeById(tx, d.storeId);
          const [o] = await tx.query<{ status: OrderStatus }>('select status from orders where id = $1', [d.orderId]);
          if (o && (o.status === 'pending_payment' || o.status === 'awaiting_confirmation')) {
            await tx.query(`update payments set status = 'expired' where order_id = $1 and status in ('created','pending')`, [d.orderId]);
            await applyOrderEvent(s, tx, store, d.orderId, 'cancel', 'system', SYSTEM, { reason: 'payment_timeout' });
            cancelled++;
          } else await tx.query('delete from inventory_reservations where order_id = $1 and expires_at <= $2', [d.orderId, s.now().toISOString()]);
        });
      return { cancelled };
    },

    'jobs.autoComplete': async () => {
      const days = s.deps.returnWindowDays ?? 7;
      const due = await s.tx(null, SYSTEM, (tx) => tx.query<{ storeId: string; orderId: string }>('select * from deliverable_orders_due($1)', [new Date(s.now().getTime() - days * 86_400_000).toISOString()]));
      for (const d of due)
        await s.tx(d.storeId, SYSTEM, async (tx) => applyOrderEvent(s, tx, await s.storeById(tx, d.storeId), d.orderId, 'complete', 'system', SYSTEM));
      return { completed: due.length };
    },
  };
}
