/** Dashboard home, analytics, CSV import/export, audit log, platform admin, outbox delivery, bot backend. */
import {
  can, DomainError, funnel, isUuid, pick, planProductImport, rangeStart, shortId, toCsv, uuidv7, itemSlug, type OrderCallbackAction,
  type OrderEvent, type OutboxMessage, type RangeKey, type L10n,
} from '@dokonim/core';
import { json, type Sql } from '../client';
import { ensureCategoryPath, refreshProduct } from './catalog';
import { applyOrderEvent, maskContact, requireRefundFor } from './commerce';
import { SYSTEM, type Actor, type Ctx } from './ctx';

const REVENUE_STATUSES = `('paid','confirmed','packing','shipped','ready_for_pickup','delivered','completed')`;

export function insightsService(s: Ctx) {
  async function dayRevenue(tx: Sql, storeId: string, from: Date, days: number, tz: string) {
    const rows = await tx.query<{ d: string; revenue: number; orders: number }>(
      `select to_char((placed_at at time zone $3)::date, 'YYYY-MM-DD') as d, coalesce(sum(total), 0)::bigint as revenue, count(*)::int as orders
       from orders where store_id = $1 and placed_at >= $2 and status in ${REVENUE_STATUSES} group by 1`,
      [storeId, from.toISOString(), tz],
    );
    const m = new Map(rows.map((r) => [r.d, r]));
    const out: Array<{ date: string; revenue: number; orders: number }> = [];
    for (let k = 0; k < days; k++) {
      const d = new Date(from.getTime() + k * 86_400_000).toISOString().slice(0, 10);
      out.push({ date: d, revenue: m.get(d)?.revenue ?? 0, orders: m.get(d)?.orders ?? 0 });
    }
    return out;
  }

  return {
    'admin.dashboard': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx, m) => {
        const now = s.now();
        const today = rangeStart('today', now);
        const week = rangeStart('7d', now);
        const showMoney = can(m.role, 'analytics.read') || can(m.role, 'orders.read');
        const [t] = await tx.query<{ revenue: number; orders: number }>(`select coalesce(sum(total), 0)::bigint as revenue, count(*)::int as orders from orders where store_id = $1 and placed_at >= $2 and status in ${REVENUE_STATUSES}`, [i.storeId, today.toISOString()]);
        const [y] = await tx.query<{ revenue: number }>(`select coalesce(sum(total), 0)::bigint as revenue from orders where store_id = $1 and placed_at >= $2 and placed_at < $3 and status in ${REVENUE_STATUSES}`, [i.storeId, new Date(today.getTime() - 86_400_000).toISOString(), today.toISOString()]);
        const [views] = await tx.query<{ n: number }>(`select count(distinct session_id)::int as n from analytics_events where store_id = $1 and name = 'store_view' and ts >= $2`, [i.storeId, week.toISOString()]);
        const [buys] = await tx.query<{ n: number }>(`select count(*)::int as n from orders where store_id = $1 and placed_at >= $2`, [i.storeId, week.toISOString()]);
        const queue = {
          toConfirm: ((await tx.query<{ n: number }>(`select count(*)::int as n from orders where store_id = $1 and status in ('paid','awaiting_confirmation')`, [i.storeId]))[0]?.n ?? 0),
          toShip: ((await tx.query<{ n: number }>(`select count(*)::int as n from orders where store_id = $1 and status in ('confirmed','packing')`, [i.storeId]))[0]?.n ?? 0),
          returns: ((await tx.query<{ n: number }>(`select count(*)::int as n from orders where store_id = $1 and status = 'return_requested'`, [i.storeId]))[0]?.n ?? 0),
          lowStock: ((await tx.query<{ n: number }>(`select count(*)::int as n from inventory_levels l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id where l.store_id = $1 and p.status = 'active' and v.track_inventory and l.on_hand - l.reserved <= l.low_stock_threshold`, [i.storeId]))[0]?.n ?? 0),
          unanswered: ((await tx.query<{ n: number }>(`select count(*)::int as n from questions q where q.store_id = $1 and q.status = 'published' and not exists (select 1 from answers a where a.question_id = q.id)`, [i.storeId]))[0]?.n ?? 0),
          newReviews: ((await tx.query<{ n: number }>(`select count(*)::int as n from reviews where store_id = $1 and owner_reply is null and created_at >= $2`, [i.storeId, week.toISOString()]))[0]?.n ?? 0),
        };
        const recentRows = await tx.query<{ contact: unknown }>(`select id, number, status, total, contact, placed_at, payment_method from orders where store_id = $1 order by placed_at desc limit 5`, [i.storeId]);
        const recent = can(m.role, 'orders.manage') ? recentRows : recentRows.map(maskContact);
        const [counts] = await tx.query<{ products: number; drafts: number }>(`select count(*) filter (where status = 'active')::int as products, count(*) filter (where status = 'draft')::int as drafts from products where store_id = $1`, [i.storeId]);
        return {
          today: { revenue: showMoney ? (t?.revenue ?? 0) : null, orders: t?.orders ?? 0, yesterdayRevenue: showMoney ? (y?.revenue ?? 0) : null, conversion: views?.n ? (buys?.n ?? 0) / views.n : 0 },
          sparkline: (await dayRevenue(tx, i.storeId, week, 7, m.store.timezone)).map((d) => d.revenue),
          queue,
          recent,
          counts,
          role: m.role,
        };
      }, { write: false }),

    'admin.analytics': async (actor: Actor, i: { storeId: string; range: RangeKey }) =>
      s.staff(i.storeId, actor, 'analytics.read', async (tx, m) => {
        const now = s.now();
        const from = rangeStart(i.range, now);
        const days = Math.round((now.getTime() - from.getTime()) / 86_400_000) + 1;
        const series = await dayRevenue(tx, i.storeId, from, Math.max(1, days), m.store.timezone);
        const revenue = series.reduce((a, d) => a + d.revenue, 0);
        const orders = series.reduce((a, d) => a + d.orders, 0);
        const ev = await tx.query<{ name: string; n: number }>(`select name, count(distinct session_id)::int as n from analytics_events where store_id = $1 and ts >= $2 group by name`, [i.storeId, from.toISOString()]);
        const counts = Object.fromEntries(ev.map((e) => [e.name, e.n]));
        const [paid] = await tx.query<{ n: number }>(`select count(*)::int as n from orders where store_id = $1 and placed_at >= $2 and status in ${REVENUE_STATUSES}`, [i.storeId, from.toISOString()]);
        const top = await tx.query(
          `select it.product_id, max(it.title) as title, max(it.image_url) as image_url, sum(it.qty)::int as units, sum(it.line_total)::bigint as revenue
           from order_items it join orders o on o.id = it.order_id where o.store_id = $1 and o.placed_at >= $2 and o.status in ${REVENUE_STATUSES} group by it.product_id order by revenue desc limit 10`,
          [i.storeId, from.toISOString()],
        );
        const sources = await tx.query(`select coalesce(source, 'direct') as source, count(*)::int as orders, coalesce(sum(total), 0)::bigint as revenue from orders where store_id = $1 and placed_at >= $2 and status in ${REVENUE_STATUSES} group by 1 order by revenue desc`, [i.storeId, from.toISOString()]);
        const [rep] = await tx.query<{ buyers: number; repeat: number }>(
          `select count(*)::int as buyers, count(*) filter (where n > 1)::int as repeat from (select customer_id, count(*) as n from orders where store_id = $1 and placed_at >= $2 and status in ${REVENUE_STATUSES} group by customer_id) t`,
          [i.storeId, from.toISOString()],
        );
        return {
          range: i.range, revenue, orders, aov: orders ? Math.round(revenue / orders / 100) * 100 : 0, series,
          funnel: funnel({ store_view: counts.store_view ?? 0, product_view: counts.product_view ?? 0, add_to_cart: counts.add_to_cart ?? 0, begin_checkout: counts.begin_checkout ?? 0, purchase: paid?.n ?? 0 }),
          topProducts: top, sources, repeatRate: rep?.buyers ? rep.repeat / rep.buyers : 0,
        };
      }, { write: false }),

    'admin.audit': async (actor: Actor, i: { storeId: string; entityType?: string | null; entityId?: string | null; cursor?: string | null }) =>
      s.staff(i.storeId, actor, 'audit.read', async (tx) => {
        const params: unknown[] = [i.storeId];
        let w = 'a.store_id = $1';
        if (i.entityType) params.push(i.entityType), (w += ` and a.entity_type = $${params.length}`);
        if (i.entityId) params.push(i.entityId), (w += ` and a.entity_id = $${params.length}`);
        const off = Number(i.cursor ?? 0) || 0;
        params.push(off);
        const rows = await tx.query(
          `select a.*, u.first_name as actor_name from audit_log a left join users u on u.id = a.actor_user_id where ${w} order by a.created_at desc limit 51 offset $${params.length}`,
          params,
        );
        return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? String(off + 50) : null };
      }, { write: false }),

    // ── CSV import / export ───────────────────────────────────────────────
    'admin.import.products': async (actor: Actor, i: { storeId: string; csv: string; dryRun: boolean }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        if (i.csv.length > 5_000_000) throw new DomainError('IMPORT_INVALID', 'File is larger than 5 MB');
        const plan = planProductImport(i.csv);
        const existing = await tx.query<{ slug: string; id: string }>('select slug, id from products where store_id = $1', [i.storeId]);
        const bySlug = new Map(existing.map((e) => [e.slug, e.id]));
        const preview = {
          products: plan.products.length,
          variants: plan.products.reduce((a, p) => a + p.variants.length, 0),
          updates: plan.products.filter((p) => bySlug.has(itemSlug(p.handle))).length,
          newCategories: [] as string[],
          errors: plan.errors,
          sample: plan.products.slice(0, 5).map((p) => ({ title: p.title, variants: p.variants.length, category: p.categoryPath.join(' / ') })),
        };
        for (const path of plan.categoryPaths) {
          let parent: string | null = null;
          let exists = true;
          for (const n of path) {
            const found: Array<{ id: string }> = await tx.query<{ id: string }>(`select id from categories where store_id = $1 and parent_id is not distinct from $2 and (lower(name->>'uz') = lower($3) or lower(name->>'ru') = lower($3) or lower(name->>'en') = lower($3))`, [i.storeId, parent, n]);
            if (!found[0]) {
              exists = false;
              break;
            }
            parent = found[0].id;
          }
          if (!exists) preview.newCategories.push(path.join(' / '));
        }
        if (i.dryRun) return { dryRun: true, ...preview, imported: 0 };
        const now = s.now();
        let imported = 0;
        for (const p of plan.products) {
          const categoryId = p.categoryPath.length ? await ensureCategoryPath(tx, m.store, p.categoryPath, now) : null;
          const slug = itemSlug(p.handle);
          let pid = bySlug.get(slug);
          const title: L10n = { [m.store.defaultLocale]: p.title };
          if (pid) {
            await tx.query('update products set title = $3::jsonb, category_id = coalesce($4, category_id), tags = $5::text[], brand = $6, status = $7 where store_id = $1 and id = $2', [i.storeId, pid, json(title), categoryId, p.tags, p.vendor, p.status]);
            await tx.query('delete from product_options where product_id = $1', [pid]);
          } else {
            pid = uuidv7(now.getTime());
            await tx.query(
              `insert into products (store_id, id, short_id, status, title, slug, description, category_id, tags, brand, published_at) values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9::text[],$10,$11)`,
              [i.storeId, pid, shortId(), p.status, json(title), slug, json(p.description ? { [m.store.defaultLocale]: { t: 'doc', blocks: [{ t: 'p', children: [{ t: 'text', text: p.description }] }] } } : {}), categoryId, p.tags, p.vendor, p.status === 'active' ? now.toISOString() : null],
            );
          }
          const valueIds: string[][] = [];
          for (const [k, name] of p.optionNames.entries()) {
            const oid = uuidv7();
            await tx.query('insert into product_options (store_id, id, product_id, position, name) values ($1,$2,$3,$4,$5::jsonb)', [i.storeId, oid, pid, k + 1, json({ [m.store.defaultLocale]: name })]);
            const labels = [...new Set(p.variants.map((v) => v.options[k]!))];
            const ids: string[] = [];
            for (const [j, l] of labels.entries()) {
              const vid = uuidv7();
              ids.push(vid);
              await tx.query('insert into option_values (store_id, id, option_id, position, label) values ($1,$2,$3,$4,$5::jsonb)', [i.storeId, vid, oid, j, json({ [m.store.defaultLocale]: l })]);
            }
            valueIds.push(ids);
          }
          const keep: string[] = [];
          for (const [k, v] of p.variants.entries()) {
            const ovIds = v.options.map((label, oi) => valueIds[oi]![[...new Set(p.variants.map((x) => x.options[oi]!))].indexOf(label)]!);
            const [ex] = v.sku ? await tx.query<{ id: string }>('select id from product_variants where store_id = $1 and product_id = $2 and sku = $3', [i.storeId, pid, v.sku]) : [];
            const vid = ex?.id ?? uuidv7();
            keep.push(vid);
            await tx.query(
              `insert into product_variants (store_id, id, product_id, option_value_ids, sku, barcode, price, compare_at_price, weight_g, is_default, position) values ($1,$2,$3,$4::uuid[],$5,$6,$7,$8,$9,$10,$11)
               on conflict (id) do update set option_value_ids = excluded.option_value_ids, price = excluded.price, compare_at_price = excluded.compare_at_price, barcode = excluded.barcode, weight_g = excluded.weight_g`,
              [i.storeId, vid, pid, ovIds, v.sku, v.barcode, Math.round(v.price / 100) * 100, v.compareAt, v.weightG, p.optionNames.length === 0, k],
            );
            const [lvl] = await tx.query<{ onHand: number }>('select on_hand from inventory_levels where variant_id = $1', [vid]);
            if (!lvl) await tx.query('insert into inventory_levels (store_id, variant_id, on_hand) values ($1,$2,$3)', [i.storeId, vid, v.stock ?? 0]);
            else if (v.stock !== null && v.stock !== lvl.onHand) {
              await tx.query('update inventory_levels set on_hand = greatest(reserved, $2) where variant_id = $1', [vid, v.stock]);
              await tx.query(`insert into inventory_movements (store_id, id, variant_id, delta, reason, ref_type, actor_id) values ($1,$2,$3,$4,'import','import',$5)`, [i.storeId, uuidv7(), vid, v.stock - lvl.onHand, actor.userId]);
            }
          }
          await tx.query('delete from product_variants where store_id = $1 and product_id = $2 and not (id = any($3::uuid[]))', [i.storeId, pid, keep]);
          if (p.images.length) {
            await tx.query('delete from product_media where product_id = $1', [pid]);
            for (const [k, url] of p.images.slice(0, 15).entries()) if (/^https?:\/\//.test(url)) await tx.query('insert into product_media (store_id, id, product_id, url, position) values ($1,$2,$3,$4,$5)', [i.storeId, uuidv7(), pid, url, k]);
          }
          await refreshProduct(s, tx, m.store, pid);
          imported++;
        }
        await s.audit(tx, i.storeId, actor, m.role, 'import.products', 'import', null, null, { imported, errors: plan.errors.length });
        return { dryRun: false, ...preview, imported };
      }),

    'admin.export.products': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        const loc = m.store.defaultLocale;
        const rows = await tx.query<Record<string, unknown> & { optionValueIds: string[]; title: L10n; path: string | null; productId: string }>(
          `select p.id as product_id, p.slug, p.title, p.status, p.tags, p.brand, v.sku, v.barcode, v.price, v.compare_at_price, v.weight_g, v.option_value_ids, l.on_hand, p.cover_url, p.category_id
           from products p join product_variants v on v.product_id = p.id left join inventory_levels l on l.variant_id = v.id where p.store_id = $1 and p.status <> 'archived' order by p.created_at, v.position`,
          [i.storeId],
        );
        const cats = await tx.query<{ id: string; parentId: string | null; name: L10n }>('select id, parent_id, name from categories where store_id = $1', [i.storeId]);
        const cm = new Map(cats.map((c) => [c.id, c]));
        const pathOf = (id: string | null): string => {
          const names: string[] = [];
          for (let c = id ? cm.get(id) : undefined; c; c = c.parentId ? cm.get(c.parentId) : undefined) names.unshift(pick(c.name, loc));
          return names.join(' / ');
        };
        const opts = await tx.query<{ productId: string; position: number; name: L10n; valueId: string; label: L10n }>(
          `select po.product_id, po.position, po.name, ov.id as value_id, ov.label from product_options po join option_values ov on ov.option_id = po.id where po.store_id = $1`,
          [i.storeId],
        );
        const header = ['Handle', 'Title', 'Status', 'Tags', 'Vendor', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value', 'Variant SKU', 'Variant Barcode', 'Variant Price', 'Variant Compare At Price', 'Variant Grams', 'Variant Inventory Qty', 'Image Src', 'Category Path'];
        const out: Array<Array<string | number | null>> = [header];
        let last = '';
        for (const r of rows) {
          const first = r.productId !== last;
          last = r.productId;
          const ov = r.optionValueIds.map((vid) => opts.find((o) => o.valueId === vid));
          const cells: Array<string | number | null> = [r.slug as string, first ? pick(r.title, loc) : '', first ? (r.status as string) : '', first ? (r.tags as string[]).join(', ') : '', first ? (r.brand as string) : ''];
          for (let k = 0; k < 3; k++) cells.push(first && ov[k] ? pick(ov[k]!.name, loc) : '', ov[k] ? pick(ov[k]!.label, loc) : '');
          cells.push(r.sku as string, r.barcode as string, (r.price as number) / 100, r.compareAtPrice ? (r.compareAtPrice as number) / 100 : '', r.weightG as number, (r.onHand as number) ?? 0, first ? ((r.coverUrl as string) ?? '') : '', first ? pathOf(r.categoryId as string | null) : '');
          out.push(cells);
        }
        return { filename: `${m.store.slug}-products.csv`, csv: toCsv(out) };
      }),

    'admin.export.orders': async (actor: Actor, i: { storeId: string; from?: string | null; to?: string | null }) =>
      s.staff(i.storeId, actor, 'orders.read', async (tx, m) => {
        const rows = await tx.query<Record<string, unknown> & { contact: { name: string; phone: string } }>(
          `select number, status, payment_status, payment_method, subtotal, discount_total, shipping_total, total, contact, placed_at, (select string_agg(title || ' ×' || qty, '; ') from order_items i where i.order_id = o.id) as items
           from orders o where store_id = $1 and placed_at >= coalesce($2::timestamptz, '-infinity') and placed_at <= coalesce($3::timestamptz, 'infinity') order by placed_at desc`,
          [i.storeId, i.from ?? null, i.to ?? null],
        );
        const phones = can(m.role, 'orders.manage');
        const csv = toCsv([
          ['Number', 'Placed at', 'Status', 'Payment', 'Method', 'Subtotal', 'Discount', 'Shipping', 'Total', 'Customer', 'Phone', 'Items'],
          ...rows.map((r) => [r.number as number, r.placedAt as string, r.status as string, r.paymentStatus as string, r.paymentMethod as string, (r.subtotal as number) / 100, (r.discountTotal as number) / 100, (r.shippingTotal as number) / 100, (r.total as number) / 100, r.contact?.name ?? '', phones ? (r.contact?.phone ?? '') : '•••', r.items as string]),
        ]);
        return { filename: `${m.store.slug}-orders.csv`, csv };
      }),

    // ── Platform admin ────────────────────────────────────────────────────
    'platform.stores': async (actor: Actor, i: { q?: string | null }) => {
      if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN');
      return s.tx(null, actor, async (tx) => {
        const stats = await tx.query<{ storeId: string; products: number; orders: number; revenue: number }>('select * from admin_store_stats()');
        const sm = new Map(stats.map((x) => [x.storeId, x]));
        const rows = await tx.query<Record<string, unknown> & { id: string }>(
          `select s.id, s.slug, s.name, s.status, s.plan, s.plan_flags, s.business_type, s.created_at, s.suspended_reason, u.first_name as owner_name, u.username as owner_username
           from stores s join users u on u.id = s.owner_user_id ${i.q ? `where s.slug ilike '%' || $1 || '%' or s.name->>'uz' ilike '%' || $1 || '%'` : ''} order by s.created_at desc limit 200`,
          i.q ? [i.q] : [],
        );
        return rows.map((r) => ({ ...r, ...(sm.get(r.id) ?? {}) }));
      });
    },

    'platform.suspend': async (actor: Actor, i: { storeId: string; suspended: boolean; reason?: string }) => {
      if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN');
      return s.tx(i.storeId, actor, async (tx) => {
        const before = await s.storeById(tx, i.storeId);
        let status: string;
        if (i.suspended) {
          if (before.status === 'closed') throw new DomainError('INVALID_TRANSITION', 'A closed store cannot be suspended');
          status = 'suspended';
          await tx.query(
            `update stores set status = 'suspended', suspended_reason = $2, status_before_suspend = case when status = 'suspended' then status_before_suspend else status end where id = $1`,
            [i.storeId, (i.reason ?? '').slice(0, 300)],
          );
        } else {
          // only a suspended store can be unsuspended, and it gets back the status it had (a draft is not published)
          if (before.status !== 'suspended') throw new DomainError('INVALID_TRANSITION', 'The store is not suspended');
          const [r] = await tx.query<{ status: string }>(
            `update stores set status = coalesce(status_before_suspend, 'active'), status_before_suspend = null, suspended_reason = null where id = $1 returning status`,
            [i.storeId],
          );
          status = r!.status;
        }
        await s.audit(tx, i.storeId, actor, null, i.suspended ? 'platform.suspend' : 'platform.unsuspend', 'store', i.storeId, { status: before.status }, { status, reason: i.reason });
        return { ok: true };
      });
    },

    'platform.setPlan': async (actor: Actor, i: { storeId: string; plan: 'free' | 'pro'; flags: { productLimit: number; removeBadge: boolean; customBot: boolean } }) => {
      if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN');
      return s.tx(i.storeId, actor, async (tx) => {
        await tx.query('update stores set plan = $2, plan_flags = $3::jsonb where id = $1', [i.storeId, i.plan, json(i.flags)]);
        await s.audit(tx, i.storeId, actor, null, 'platform.plan', 'store', i.storeId, null, i);
        return { ok: true };
      });
    },

    'platform.paymentErrors': async (actor: Actor) => {
      if (!actor.isPlatformAdmin) throw new DomainError('FORBIDDEN');
      return s.tx(null, actor, (tx) => tx.query('select * from admin_payment_errors(100)'));
    },

    'platform.report': async (actor: Actor, i: { slug: string; reason: string }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        await tx.query('insert into reports (id, store_id, reporter_user_id, reason) values ($1,$2,$3,$4)', [uuidv7(), store.id, actor.userId, i.reason.slice(0, 1000)]);
        return { ok: true };
      }),

    // ── Outbox delivery (bot on the server, BotChatSimulator in the demo) ──
    'outbox.claim': async (_a: Actor, i: { limit?: number }) =>
      s.tx(null, SYSTEM, async (tx) => {
        const rows = await tx.query<{ id: string; storeId: string; recipient: OutboxMessage['recipient']; payload: OutboxMessage['payload']; createdAt: string }>('select * from claim_outbox($1)', [i.limit ?? 20]);
        return rows.map((r) => ({ id: r.id, storeId: r.storeId, recipient: r.recipient, payload: r.payload, createdAt: r.createdAt }) as OutboxMessage);
      }),

    'outbox.mark': async (_a: Actor, i: { id: string; ok: boolean; error?: string }) =>
      s.tx(null, SYSTEM, async (tx) => {
        await tx.query('select mark_outbox($1, $2, $3)', [i.id, i.ok, i.error ?? null]);
        return { ok: true };
      }),

    // ── Bot backend ───────────────────────────────────────────────────────
    'bot.orderAction': async (actor: Actor, i: { orderId: string; action: OrderCallbackAction; storeId?: string }) => {
      if (!actor.userId || !isUuid(i.orderId)) return { ok: false as const, code: 'NOT_FOUND' };
      // find the store through the caller's memberships (RLS lets a user see their own memberships)
      const memberships = await s.tx(null, actor, (tx) => tx.query<{ storeId: string }>('select store_id from store_members where user_id = $1', [actor.userId]));
      const map: Record<OrderCallbackAction, OrderEvent> = { confirm: 'confirm', pack: 'pack', ship: 'ship', ready: 'ready_for_pickup', deliver: 'deliver', cancel: 'cancel' };
      for (const m of memberships) {
        try {
          const r = await s.staff(m.storeId, actor, 'orders.manage', async (tx, mm) => {
            const [o] = await tx.query<{ id: string; paymentStatus: string }>('select id, payment_status from orders where store_id = $1 and id = $2 for update', [m.storeId, i.orderId]);
            if (!o) return null;
            requireRefundFor(mm.role, o.paymentStatus, map[i.action]);
            const up = await applyOrderEvent(s, tx, mm.store, o.id, map[i.action], 'staff', actor, {});
            await s.audit(tx, m.storeId, actor, mm.role, `order.${map[i.action]}`, 'order', o.id, null, { status: up.status, via: 'bot' });
            return up.status;
          });
          if (r) return { ok: true as const, status: r };
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'ERROR';
          if (code !== 'NOT_FOUND') return { ok: false as const, code };
        }
      }
      return { ok: false as const, code: memberships.length ? 'NOT_FOUND' : 'FORBIDDEN' };
    },

    'bot.inlineProducts': async (actor: Actor, i: { query: string }) =>
      s.tx(null, actor, async (tx) => {
        const parts = i.query.trim().split(/\s+/);
        let slug: string | null = null;
        let q = i.query.trim();
        if (parts.length > 1) {
          const [st] = await tx.query<{ slug: string }>(`select slug from stores where lower(slug) = lower($1) and status = 'active'`, [parts[0]]);
          if (st) (slug = st.slug), (q = parts.slice(1).join(' '));
        }
        const { searchKey } = await import('@dokonim/core');
        const rows = await tx.query<{ id: string; shortId: string; storeSlug: string; storeName: L10n; title: L10n; minPrice: number; currency: 'UZS'; coverUrl: string | null }>('select * from public_product_search($1, 50)', [searchKey(q)]);
        return rows.filter((r) => !slug || r.storeSlug === slug).slice(0, 20).map((r) => ({
          id: r.id, shortId: r.shortId, storeSlug: r.storeSlug, storeName: pick(r.storeName, actor.locale), title: pick(r.title, actor.locale), price: r.minPrice, currency: r.currency, imageUrl: r.coverUrl && /^https:/.test(r.coverUrl) ? r.coverUrl : undefined,
        }));
      }),
  };
}
