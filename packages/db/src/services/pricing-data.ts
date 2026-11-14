/** Loads DB rows into the shapes the pure core functions expect (discount rules, shipping options). */
import {
  deliveryPromise, matchZone, rateAmount, type DeliveryPromise, type DiscountRule, type DiscountScope, type L10n, type MethodType,
} from '@dokonim/core';
import type { Sql } from '../client';
import type { StoreRow } from './ctx';

interface DiscountDb {
  id: string;
  kind: DiscountRule['kind'];
  title: string;
  code: string | null;
  valueType: DiscountRule['valueType'];
  value: number;
  bxgy: DiscountRule['bxgy'];
  appliesTo: { type: string; ids?: string[] };
  conditions: DiscountRule['conditions'];
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  combines: DiscountRule['combines'];
  priority: number;
  status: DiscountRule['status'];
}

/** DB scopes reference categories by id; core evaluates by ltree path. */
export async function loadDiscountRules(tx: Sql, storeId: string, opts: { onlyAutomatic?: boolean } = {}): Promise<DiscountRule[]> {
  const rows = await tx.query<DiscountDb>(
    `select * from discounts where store_id = $1 and status = 'active' ${opts.onlyAutomatic ? `and kind <> 'code'` : ''} order by priority desc, created_at`,
    [storeId],
  );
  const catIds = [...new Set(rows.flatMap((r) => (r.appliesTo.type === 'category' ? r.appliesTo.ids ?? [] : [])))];
  const paths = new Map<string, string>();
  if (catIds.length) {
    const cs = await tx.query<{ id: string; path: string }>('select id, path::text as path from categories where store_id = $1 and id = any($2::uuid[])', [storeId, catIds]);
    for (const c of cs) paths.set(c.id, c.path);
  }
  return rows.map((r) => {
    let scope: DiscountScope;
    const ids = r.appliesTo.ids ?? [];
    if (r.appliesTo.type === 'products') scope = { type: 'products', ids };
    else if (r.appliesTo.type === 'collections') scope = { type: 'collections', ids };
    else if (r.appliesTo.type === 'category') scope = { type: 'category', paths: ids.map((i) => paths.get(i)).filter((p): p is string => !!p) };
    else scope = { type: 'all' };
    return {
      id: r.id, kind: r.kind, title: r.title, code: r.code, valueType: r.valueType, value: r.value, bxgy: r.bxgy, appliesTo: scope,
      conditions: r.conditions ?? {}, startsAt: r.startsAt, endsAt: r.endsAt, usageLimit: r.usageLimit, perCustomerLimit: r.perCustomerLimit,
      usedCount: r.usedCount, combines: r.combines, priority: r.priority, status: r.status,
    };
  });
}

/** product id → {categoryPath, collectionIds} for pricing. */
export async function productPricingMeta(tx: Sql, storeId: string, productIds: string[]): Promise<Map<string, { categoryPath: string | null; collectionIds: string[] }>> {
  const out = new Map<string, { categoryPath: string | null; collectionIds: string[] }>();
  if (!productIds.length) return out;
  const rows = await tx.query<{ id: string; path: string | null }>(
    `select p.id, c.path::text as path from products p left join categories c on c.id = p.category_id where p.store_id = $1 and p.id = any($2::uuid[])`,
    [storeId, productIds],
  );
  for (const r of rows) out.set(r.id, { categoryPath: r.path, collectionIds: [] });
  const cols = await tx.query<{ productId: string; collectionId: string }>('select product_id, collection_id from product_collections where store_id = $1 and product_id = any($2::uuid[])', [storeId, productIds]);
  for (const c of cols) out.get(c.productId)?.collectionIds.push(c.collectionId);
  return out;
}

export interface ShippingOption {
  methodId: string;
  type: MethodType;
  name: L10n;
  amount: number;
  freeOver: number | null;
  promise: DeliveryPromise;
  codAllowed: boolean;
  pickupPoints: Array<{ id: string; name: L10n; address: string; hours?: string }>;
  zoneId: string;
}

export async function shippingOptions(tx: Sql, store: StoreRow, region: string | null, district: string | null, weightG: number, now: Date): Promise<ShippingOption[]> {
  const methods = await tx.query<{ id: string; type: MethodType; name: L10n; processingDays: number; cutoffTime: string; workingDays: number[]; holidays: string[]; pickupPoints: ShippingOption['pickupPoints']; codAllowed: boolean }>(
    'select * from shipping_methods where store_id = $1 and enabled order by position, type',
    [store.id],
  );
  const zones = await tx.query<{ id: string; name: string; regions: string[]; districts: string[] }>('select * from shipping_zones where store_id = $1', [store.id]);
  const rates = await tx.query<{ zoneId: string; methodId: string; calc: 'flat' | 'weight' | 'free_over'; amount: number; perKg: number | null; freeOver: number | null; transitDaysMin: number; transitDaysMax: number }>(
    'select * from shipping_rates where store_id = $1',
    [store.id],
  );
  const out: ShippingOption[] = [];
  for (const m of methods) {
    // the most specific zone that has a rate for this method
    const candidates = zones.filter((z) => rates.some((r) => r.zoneId === z.id && r.methodId === m.id));
    const zone = matchZone(candidates, region, district);
    if (!zone) continue;
    const rate = rates.find((r) => r.zoneId === zone.id && r.methodId === m.id)!;
    out.push({
      methodId: m.id,
      type: m.type,
      name: m.name,
      amount: rateAmount(rate, weightG),
      freeOver: rate.calc === 'free_over' ? rate.freeOver : null,
      promise: deliveryPromise({
        now, timezone: store.timezone, cutoffTime: m.cutoffTime, processingDays: m.processingDays,
        transitMin: rate.transitDaysMin, transitMax: rate.transitDaysMax, calendar: { workingDays: m.workingDays, holidays: m.holidays },
      }),
      codAllowed: m.codAllowed,
      pickupPoints: m.pickupPoints ?? [],
      zoneId: zone.id,
    });
  }
  return out;
}
