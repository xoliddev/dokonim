/** Reviews (verified buyers, photos, votes, replies), Q&A, wishlist, stories, customers. */
import { DomainError, isUuid, pick, uuidv7, type L10n, type LinkTarget } from '@dokonim/core';
import { json, type Sql } from '../client';
import { type Actor, type Ctx, type StoreRow } from './ctx';
import { toCards } from './storefront';

async function refreshRating(tx: Sql, productId: string) {
  await tx.query(
    `update products set rating_avg = coalesce((select round(avg(rating)::numeric, 1) from reviews where product_id = $1 and status = 'published'), 0),
       rating_count = (select count(*)::int from reviews where product_id = $1 and status = 'published') where id = $1`,
    [productId],
  );
}

const PHOTO_RE = /^(https?:\/\/|data:image\/(webp|jpeg|png);base64,|\.?\/?assets\/)/;

export function socialService(s: Ctx) {
  return {
    /** Order items the buyer can still review (delivered/completed, not yet reviewed). */
    'reviews.pending': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, (tx, store, uid) =>
        tx.query(
          `select it.id as order_item_id, it.title, it.variant_title, it.image_url, it.product_id, o.number, o.short_id
           from order_items it join orders o on o.id = it.order_id where o.store_id = $1 and o.user_id = $2 and o.status in ('delivered','completed') and not it.reviewed order by o.placed_at desc`,
          [store.id, uid],
        ),
      ),

    'reviews.create': async (actor: Actor, i: { slug: string; orderItemId: string; rating: number; text?: string; pros?: string; cons?: string; photos?: string[] }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        if (!isUuid(i.orderItemId)) throw new DomainError('REVIEW_NOT_ALLOWED');
        const [it] = await tx.query<{ id: string; productId: string; variantTitle: string; reviewed: boolean; status: string; userId: string; title: string }>(
          `select it.id, it.product_id, it.variant_title, it.reviewed, it.title, o.status, o.user_id from order_items it join orders o on o.id = it.order_id where it.store_id = $1 and it.id = $2`,
          [store.id, i.orderItemId],
        );
        if (!it || it.userId !== uid) throw new DomainError('REVIEW_NOT_ALLOWED', 'Only buyers of this item can review it');
        if (!['delivered', 'completed'].includes(it.status)) throw new DomainError('REVIEW_NOT_ALLOWED', 'You can review after the order is delivered');
        if (it.reviewed) throw new DomainError('REVIEW_NOT_ALLOWED', 'You already reviewed this item');
        const rating = Math.round(i.rating);
        if (rating < 1 || rating > 5) throw new DomainError('VALIDATION', 'Rating must be 1–5', { field: 'rating' });
        const photos = (i.photos ?? []).filter((p) => PHOTO_RE.test(p) && p.length < 400_000).slice(0, 6);
        const [u] = await tx.query<{ firstName: string; lastName: string | null }>('select first_name, last_name from users where id = $1', [uid]);
        const author = `${u?.firstName ?? ''} ${u?.lastName ? `${u.lastName[0]}.` : ''}`.trim();
        const id = uuidv7();
        await tx.query(
          `insert into reviews (store_id, id, product_id, variant_title, order_item_id, user_id, author_name, rating, text, pros, cons, photos) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::text[])`,
          [store.id, id, it.productId, it.variantTitle, it.id, uid, author || 'Xaridor', rating, (i.text ?? '').trim().slice(0, 2000), (i.pros ?? '').trim().slice(0, 500), (i.cons ?? '').trim().slice(0, 500), photos],
        );
        await tx.query('update order_items set reviewed = true where id = $1', [it.id]);
        await refreshRating(tx, it.productId);
        await s.enqueue(tx, store.id, await s.staffRecipients(tx, store.id, 'reviews.moderate'), {
          topic: 'review.created', storeSlug: store.slug, storeName: pick(store.name, store.defaultLocale), reviewId: id, productId: it.productId, productTitle: it.title, rating, text: (i.text ?? '').slice(0, 300),
        });
        return { id };
      }),

    'reviews.helpful': async (actor: Actor, i: { slug: string; reviewId: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const added = await tx.query('insert into review_votes (store_id, review_id, user_id) values ($1,$2,$3) on conflict do nothing returning review_id', [store.id, i.reviewId, uid]);
        if (added.length) await tx.query('update reviews set helpful_count = helpful_count + 1 where id = $1', [i.reviewId]);
        else {
          await tx.query('delete from review_votes where review_id = $1 and user_id = $2', [i.reviewId, uid]);
          await tx.query('update reviews set helpful_count = greatest(0, helpful_count - 1) where id = $1', [i.reviewId]);
        }
        const [r] = await tx.query<{ helpfulCount: number }>('select helpful_count from reviews where id = $1', [i.reviewId]);
        return { voted: added.length > 0, helpfulCount: r?.helpfulCount ?? 0 };
      }),

    'questions.ask': async (actor: Actor, i: { slug: string; productId: string; text: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const text = i.text.trim();
        if (text.length < 5) throw new DomainError('VALIDATION', 'Write a little more', { field: 'text' });
        const [p] = await tx.query<{ id: string; title: L10n }>(`select id, title from products where store_id = $1 and (id::text = $2 or short_id = $2) and status = 'active'`, [store.id, i.productId]);
        if (!p) throw new DomainError('NOT_FOUND');
        const [u] = await tx.query<{ firstName: string }>('select first_name from users where id = $1', [uid]);
        const id = uuidv7();
        await tx.query('insert into questions (store_id, id, product_id, user_id, author_name, text) values ($1,$2,$3,$4,$5,$6)', [store.id, id, p.id, uid, u?.firstName ?? 'Xaridor', text.slice(0, 1000)]);
        await s.enqueue(tx, store.id, await s.staffRecipients(tx, store.id, 'reviews.moderate'), {
          topic: 'question.created', storeSlug: store.slug, storeName: pick(store.name, store.defaultLocale), questionId: id, productId: p.id, productTitle: pick(p.title, store.defaultLocale), text: text.slice(0, 300),
        });
        return { id };
      }),

    'wishlist.list': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        const rows = await tx.query<Record<string, unknown>>(
          `select p.id, p.short_id, p.title, p.cover_url, p.min_price, p.max_price, p.max_compare_at, p.rating_avg, p.rating_count, p.sold_count, p.in_stock, p.is_digital, p.created_at, null as dominant_color, w.price_at_save
           from wishlists w join products p on p.id = w.product_id where w.store_id = $1 and w.user_id = $2 and p.status = 'active' order by w.created_at desc`,
          [store.id, uid],
        );
        const cards = await toCards(tx, store, rows, s.now());
        return cards.map((c, k) => ({ ...c, priceAtSave: rows[k]!.priceAtSave as number }));
      }),

    'wishlist.toggle': async (actor: Actor, i: { slug: string; productId: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        if (!isUuid(i.productId)) throw new DomainError('NOT_FOUND');
        const del = await tx.query('delete from wishlists where store_id = $1 and user_id = $2 and product_id = $3 returning product_id', [store.id, uid, i.productId]);
        if (del.length) return { wishlisted: false };
        const [p] = await tx.query<{ minPrice: number }>(`select min_price from products where store_id = $1 and id = $2 and status = 'active'`, [store.id, i.productId]);
        if (!p) throw new DomainError('NOT_FOUND');
        await tx.query('insert into wishlists (store_id, user_id, product_id, price_at_save) values ($1,$2,$3,$4)', [store.id, uid, i.productId, p.minPrice]);
        return { wishlisted: true };
      }),

    'events.track': async (actor: Actor, i: { slug: string; sessionId: string; source?: string | null; events: Array<{ name: string; props?: Record<string, unknown> }> }) =>
      s.storefront(i.slug, actor, async (tx, store) => {
        const allowed = new Set(['store_view', 'product_view', 'add_to_cart', 'begin_checkout', 'search', 'share']);
        let n = 0;
        for (const e of i.events.slice(0, 20)) {
          if (!allowed.has(e.name)) continue;
          // analytics events carry no PII: only ids, counts and the campaign tag
          const props = Object.fromEntries(Object.entries(e.props ?? {}).filter(([k, v]) => ['productId', 'variantId', 'q', 'qty', 'value'].includes(k) && (typeof v === 'string' || typeof v === 'number')).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 80) : v]));
          await tx.query('insert into analytics_events (store_id, id, session_id, user_id, name, props, source, ts) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)', [
            store.id, uuidv7(), i.sessionId.slice(0, 64), null, e.name, json(props), i.source?.slice(0, 40) ?? null, s.now().toISOString(),
          ]);
          n++;
        }
        return { accepted: n };
      }),

    // ── Moderation ─────────────────────────────────────────────────────────
    'admin.reviews.list': async (actor: Actor, i: { storeId: string; status?: 'pending' | 'published' | 'hidden' | null; unanswered?: boolean }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(
          `select r.*, p.title as product_title, p.cover_url from reviews r join products p on p.id = r.product_id where r.store_id = $1
           ${i.status ? 'and r.status = $2' : ''} ${i.unanswered ? 'and r.owner_reply is null' : ''} order by r.created_at desc limit 200`,
          i.status ? [i.storeId, i.status] : [i.storeId],
        ), { write: false }),

    'admin.reviews.moderate': async (actor: Actor, i: { storeId: string; id: string; status: 'published' | 'hidden' }) =>
      s.staff(i.storeId, actor, 'reviews.moderate', async (tx, m) => {
        const [r] = await tx.query<{ productId: string; status: string }>('update reviews set status = $3 where store_id = $1 and id = $2 returning product_id, status', [i.storeId, i.id, i.status]);
        if (!r) throw new DomainError('NOT_FOUND');
        await refreshRating(tx, r.productId);
        await s.audit(tx, i.storeId, actor, m.role, 'review.moderate', 'review', i.id, null, { status: i.status });
        return { ok: true };
      }),

    'admin.reviews.reply': async (actor: Actor, i: { storeId: string; id: string; text: string }) =>
      s.staff(i.storeId, actor, 'reviews.moderate', async (tx, m) => {
        const text = i.text.trim().slice(0, 1000);
        await tx.query('update reviews set owner_reply = $3, owner_reply_at = $4 where store_id = $1 and id = $2', [i.storeId, i.id, text || null, text ? s.now().toISOString() : null]);
        await s.audit(tx, i.storeId, actor, m.role, 'review.reply', 'review', i.id, null, { text });
        return { ok: true };
      }),

    'admin.questions.list': async (actor: Actor, i: { storeId: string; unanswered?: boolean }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(
          `select q.*, p.title as product_title, p.cover_url, p.short_id,
             coalesce((select json_agg(json_build_object('id', a.id, 'text', a.text, 'authorName', a.author_name, 'createdAt', a.created_at)) from answers a where a.question_id = q.id), '[]'::json) as answers
           from questions q join products p on p.id = q.product_id where q.store_id = $1 ${i.unanswered ? 'and not exists (select 1 from answers a where a.question_id = q.id)' : ''} order by q.created_at desc limit 200`,
          [i.storeId],
        ), { write: false }),

    'admin.questions.answer': async (actor: Actor, i: { storeId: string; id: string; text: string }) =>
      s.staff(i.storeId, actor, 'reviews.moderate', async (tx, m) => {
        const text = i.text.trim();
        if (!text) throw new DomainError('VALIDATION', 'Answer is empty', { field: 'text' });
        const [q] = await tx.query<{ userId: string | null; text: string; productId: string }>('select user_id, text, product_id from questions where store_id = $1 and id = $2', [i.storeId, i.id]);
        if (!q) throw new DomainError('NOT_FOUND');
        await tx.query('insert into answers (store_id, id, question_id, user_id, author_name, text) values ($1,$2,$3,$4,$5,$6)', [i.storeId, uuidv7(), i.id, actor.userId, pick(m.store.name, m.store.defaultLocale), text.slice(0, 2000)]);
        const [p] = await tx.query<{ title: L10n; shortId: string }>('select title, short_id from products where id = $1', [q.productId]);
        await s.enqueue(tx, i.storeId, await s.userRecipient(tx, q.userId), {
          topic: 'question.answered', storeSlug: m.store.slug, storeName: pick(m.store.name, m.store.defaultLocale), productId: q.productId, productShortId: p?.shortId ?? '', productTitle: pick(p?.title, m.store.defaultLocale), question: q.text.slice(0, 200), answer: text.slice(0, 500),
        });
        await s.audit(tx, i.storeId, actor, m.role, 'question.answer', 'question', i.id, null, { text });
        return { ok: true };
      }),

    'admin.questions.hide': async (actor: Actor, i: { storeId: string; id: string; hidden: boolean }) =>
      s.staff(i.storeId, actor, 'reviews.moderate', async (tx, m) => {
        await tx.query('update questions set status = $3 where store_id = $1 and id = $2', [i.storeId, i.id, i.hidden ? 'hidden' : 'published']);
        await s.audit(tx, i.storeId, actor, m.role, 'question.hide', 'question', i.id, null, { hidden: i.hidden });
        return { ok: true };
      }),

    // ── Stories ────────────────────────────────────────────────────────────
    'admin.stories.list': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(`select s.*, coalesce((select json_agg(f order by f.position) from story_frames f where f.story_id = s.id), '[]'::json) as frames from stories s where s.store_id = $1 order by s.position, s.created_at desc`, [i.storeId]), { write: false }),

    'admin.stories.save': async (actor: Actor, i: { storeId: string; id?: string; title: L10n; coverUrl?: string | null; isHighlight: boolean; expiresInHours?: number | null; frames: Array<{ mediaUrl: string; durationMs?: number; link: LinkTarget; ctaLabel?: L10n }> }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        if (!i.frames.length) throw new DomainError('VALIDATION', 'Add at least one frame', { field: 'frames' });
        const id = i.id && isUuid(i.id) ? i.id : uuidv7();
        const expires = i.isHighlight ? null : new Date(s.now().getTime() + (i.expiresInHours ?? 24) * 3600_000).toISOString();
        await tx.query(
          `insert into stories (store_id, id, title, cover_url, is_highlight, expires_at) values ($1,$2,$3::jsonb,$4,$5,$6)
           on conflict (id) do update set title = excluded.title, cover_url = excluded.cover_url, is_highlight = excluded.is_highlight, expires_at = excluded.expires_at where stories.store_id = excluded.store_id`,
          [i.storeId, id, json(i.title), i.coverUrl ?? i.frames[0]!.mediaUrl, i.isHighlight, expires],
        );
        await tx.query('delete from story_frames where story_id = $1', [id]);
        for (const [k, f] of i.frames.slice(0, 10).entries())
          await tx.query('insert into story_frames (store_id, id, story_id, position, media_url, duration_ms, link, cta_label) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)', [
            i.storeId, uuidv7(), id, k, f.mediaUrl, Math.max(2000, Math.min(15000, f.durationMs ?? 5000)), json(f.link ?? { type: 'none' }), json(f.ctaLabel ?? {}),
          ]);
        await s.audit(tx, i.storeId, actor, m.role, 'story.save', 'story', id, null, { title: i.title, frames: i.frames.length });
        return { id };
      }),

    'admin.stories.delete': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'catalog.write', async (tx, m) => {
        await tx.query('delete from stories where store_id = $1 and id = $2', [i.storeId, i.id]);
        await s.audit(tx, i.storeId, actor, m.role, 'story.delete', 'story', i.id, null, null);
        return { ok: true };
      }),

    // ── Customers ──────────────────────────────────────────────────────────
    'admin.customers.list': async (actor: Actor, i: { storeId: string; q?: string | null; tag?: string | null }) =>
      s.staff(i.storeId, actor, 'customers.read', (tx) => {
        const params: unknown[] = [i.storeId];
        let w = 'store_id = $1';
        if (i.q?.trim()) params.push(`%${i.q.trim().toLowerCase()}%`), (w += ` and (lower(name) like $${params.length} or phone like $${params.length})`);
        if (i.tag) params.push(i.tag), (w += ` and $${params.length} = any(tags)`);
        return tx.query(`select id, name, phone, tags, orders_count, total_spent, last_order_at, is_blocked, created_at from customers where ${w} order by last_order_at desc nulls last limit 300`, params);
      }, { write: false }),

    'admin.customers.get': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'customers.read', async (tx) => {
        const [c] = await tx.query('select * from customers where store_id = $1 and id = $2', [i.storeId, i.id]);
        if (!c) throw new DomainError('NOT_FOUND');
        const orders = await tx.query('select id, number, short_id, status, total, placed_at from orders where store_id = $1 and customer_id = $2 order by placed_at desc', [i.storeId, i.id]);
        const addresses = await tx.query('select * from addresses where store_id = $1 and customer_id = $2', [i.storeId, i.id]);
        const [tg] = await tx.query<{ username: string | null; telegramId: number }>('select u.username, u.telegram_id from customers c join users u on u.id = c.user_id where c.id = $1', [i.id]);
        return { ...c, orders, addresses, telegram: tg ?? null };
      }, { write: false }),

    'admin.customers.update': async (actor: Actor, i: { storeId: string; id: string; tags?: string[]; note?: string; isBlocked?: boolean }) =>
      s.staff(i.storeId, actor, 'orders.manage', async (tx, m) => {
        const [before] = await tx.query<{ tags: string[]; note: string; isBlocked: boolean }>('select tags, note, is_blocked from customers where store_id = $1 and id = $2', [i.storeId, i.id]);
        if (!before) throw new DomainError('NOT_FOUND');
        const tags = i.tags ? [...new Set(i.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : before.tags;
        await tx.query('update customers set tags = $3::text[], note = $4, is_blocked = $5 where store_id = $1 and id = $2', [i.storeId, i.id, tags, (i.note ?? before.note).slice(0, 2000), i.isBlocked ?? before.isBlocked]);
        await s.audit(tx, i.storeId, actor, m.role, 'customer.update', 'customer', i.id, before, { tags, note: i.note ?? before.note, isBlocked: i.isBlocked ?? before.isBlocked });
        return { ok: true };
      }),
  };
}

export type { StoreRow };
