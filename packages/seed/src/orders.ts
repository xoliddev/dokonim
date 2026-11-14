/**
 * Historical orders: real carts → real checkout quotes → real orders → real sandbox payments → real
 * status transitions, replayed at past clock times so the dashboard, analytics and buyer history look alive.
 */
import { DomainError } from '@dokonim/core';
import type { Actor } from '@dokonim/db';
import type { BuiltStore, SeedCtx } from './build';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Buyer {
  actor: Actor;
  name: string;
  phone: string;
}

const REGIONS = ['UZ-TK', 'UZ-TK', 'UZ-TK', 'UZ-TK', 'UZ-SA', 'UZ-BU', 'UZ-FA', 'UZ-AN', 'UZ-NG'];
const DISTRICTS: Record<string, string> = { 'UZ-TK': 'Yunusobod', 'UZ-SA': 'Samarqand sh.', 'UZ-BU': 'Buxoro sh.', 'UZ-FA': 'Margʻilon', 'UZ-AN': 'Andijon sh.', 'UZ-NG': 'Namangan sh.' };
const STREETS = ['Amir Temur koʻchasi', 'Mustaqillik shoh koʻchasi', 'Navoiy koʻchasi', 'Bobur koʻchasi', 'Shota Rustaveli koʻchasi', 'Labzak koʻchasi'];
const LANDMARKS = ['Metro yonida', 'Maktab roʻparasida', 'Bozor yonida', 'Masjid orqasida', ''];

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

type Stage = 'new' | 'confirmed' | 'packing' | 'shipped' | 'delivered' | 'cancelled';

function stageFor(ageMs: number, rand: () => number): Stage {
  if (rand() < 0.08) return 'cancelled';
  if (ageMs < 0.6 * DAY) return 'new';
  if (ageMs < 1.5 * DAY) return rand() < 0.5 ? 'confirmed' : 'packing';
  if (ageMs < 3 * DAY) return 'shipped';
  return 'delivered';
}

export interface OrderStats {
  placed: number;
  delivered: number;
  cancelled: number;
  reviews: number;
  skipped: number;
}

export async function seedOrders(c: SeedCtx, b: BuiltStore, buyers: Buyer[], promoCodes: string[]): Promise<OrderStats> {
  const m = c.be.methods;
  const slug = b.store.slug;
  const { count, days } = b.spec.orders;
  const stats: OrderStats = { placed: 0, delivered: 0, cancelled: 0, reviews: 0, skipped: 0 };
  const left = new Map(b.products.flatMap((p) => p.variants.map((v) => [v.id, v.stock] as const)));
  // Order times: spread over `days`, denser recently, during shop hours (09–21 Tashkent = 04–16 UTC).
  const times = Array.from({ length: count }, () => {
    const d = Math.floor(Math.pow(c.rand(), 1.4) * days);
    const dayStart = Math.floor((c.anchor - d * DAY) / DAY) * DAY;
    return dayStart + (4 + c.rand() * 12) * HOUR;
  })
    .map((t) => Math.min(t, c.anchor - 20 * 60_000))
    .sort((a, b2) => a - b2);

  for (const [n, at] of times.entries()) {
    const buyer = buyers[n % buyers.length]!;
    c.clock.set(at);
    const lines = 1 + Math.floor(c.rand() * c.rand() * 3);
    let added = 0;
    for (let k = 0; k < lines; k++) {
      const p = pick(c.rand, b.products);
      const v = p.variants.filter((x) => (left.get(x.id) ?? 0) > 0);
      if (!v.length) continue;
      const variant = pick(c.rand, v);
      const qty = (left.get(variant.id) ?? 0) > 3 && c.rand() < 0.3 ? 2 : 1;
      try {
        await m['cart.setItem'](buyer.actor, { slug, variantId: variant.id, qty });
        left.set(variant.id, (left.get(variant.id) ?? 0) - qty);
        added++;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
    if (!added) {
      stats.skipped++;
      continue;
    }
    if (promoCodes.length && c.rand() < 0.2) {
      const r = await m['cart.applyPromo'](buyer.actor, { slug, code: pick(c.rand, promoCodes) });
      if (r.promo?.status !== 'applied') await m['cart.removePromo'](buyer.actor, { slug });
    }
    const region = pick(c.rand, REGIONS);
    const q = await m['checkout.quote'](buyer.actor, { slug, region });
    const pickup = region === 'UZ-TK' && c.rand() < 0.2 ? q.shippingOptions.find((o) => o.type === 'self_pickup') : undefined;
    const ship = pickup ?? q.shippingOptions.find((o) => o.type === (region === 'UZ-TK' ? 'courier' : 'post')) ?? q.shippingOptions[0];
    const online = c.rand() < 0.45;
    const { order, nextAction } = await m['orders.place'](buyer.actor, {
      slug, idempotencyKey: `seed-${slug}-${n}`, contact: { name: buyer.name, phone: buyer.phone }, methodId: ship?.methodId ?? null,
      ...(pickup ? { pickupPointId: pickup.pickupPoints[0]?.id ?? null } : { address: { regionCode: region, district: DISTRICTS[region], line1: `${pick(c.rand, STREETS)}, ${1 + Math.floor(c.rand() * 120)}-uy`, landmark: pick(c.rand, LANDMARKS) || undefined } }),
      paymentMethod: online ? (c.rand() < 0.6 ? 'payme' : 'click') : 'cod',
      source: pick(c.rand, ['telegram', 'telegram', 'instagram', 'story', 'direct']),
    });
    stats.placed++;
    if (nextAction.type === 'sandbox') {
      c.clock.set(at + 2 * 60_000);
      await m['sandbox.pay'](buyer.actor, { slug, paymentId: (nextAction as { paymentId: string }).paymentId, scenario: 'success' });
    }
    const stage = stageFor(c.anchor - at, c.rand);
    const t = async (event: 'confirm' | 'pack' | 'ship' | 'ready_for_pickup' | 'deliver' | 'cancel', dt: number, extra: Record<string, string> = {}) => {
      c.clock.set(Math.min(at + dt, c.anchor - 60_000));
      await m['admin.orders.transition'](c.owner, { storeId: b.store.id, id: order.id, event, ...extra });
    };
    if (stage === 'new') continue;
    if (stage === 'cancelled') {
      await t('cancel', 1.5 * HOUR, { reason: 'Mijoz bekor qildi' });
      stats.cancelled++;
      continue;
    }
    await t('confirm', 0.7 * HOUR);
    if (stage === 'confirmed') continue;
    await t('pack', 3 * HOUR);
    if (stage === 'packing') continue;
    if (pickup) {
      await t('ready_for_pickup', 5 * HOUR);
      if (stage === 'shipped') continue;
      const mine = await m['orders.get'](buyer.actor, { slug, id: order.id });
      const code = (mine as { pickupCode?: string | null }).pickupCode;
      if (!code) continue;
      await t('deliver', 26 * HOUR, { pickupCode: code });
    } else {
      await t('ship', 5 * HOUR, { trackingNumber: `UZ${String(100000 + Math.floor(c.rand() * 899999))}`, carrier: region === 'UZ-TK' ? 'Kuryer' : 'Oʻzbekiston pochtasi' });
      if (stage === 'shipped') continue;
      await t('deliver', (region === 'UZ-TK' ? 22 : 60) * HOUR);
    }
    stats.delivered++;
    // verified reviews after delivery
    if (c.rand() < 0.7) {
      c.clock.set(Math.min(at + 3 * DAY, c.anchor - 30_000));
      const pending = (await m['reviews.pending'](buyer.actor, { slug })) as Array<{ orderItemId: string }>;
      for (const it of pending.slice(0, 2)) {
        const rating = c.rand() < 0.75 ? 5 : c.rand() < 0.7 ? 4 : 3;
        await m['reviews.create'](buyer.actor, { slug, orderItemId: it.orderItemId, rating, text: pick(c.rand, b.spec.reviews) });
        stats.reviews++;
      }
    }
  }
  return stats;
}
