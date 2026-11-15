/**
 * Store lifecycle (onboarding), settings, users & sessions, discounts, shipping, payment settings, theme, staff.
 */
import {
  BUSINESS_TYPES, canAssignRole, checkStoreSlug, DEFAULT_TOKENS, defaultSections, DomainError, encryptSecret, isUuid, itemSlug,
  pathFor, permissionsOf, pick, PRESETS, presetsFor, ROLES, sanitizeSections, sanitizeTokens, sha256Hex, shortId,
  slugAlternatives, slugify, toHex, uuidv7, type BusinessType, type L10n, type Locale, type ProviderId, type Role, type Section,
  type TelegramUser, type ThemeTokens,
} from '@dokonim/core';
import { isSupportedProvider, sandboxConfig } from '@dokonim/payments';
import { json, type Sql } from '../client';
import { refreshProduct } from './catalog';
import { providerConfigs } from './commerce';
import { SYSTEM, toLoc, type Actor, type Ctx, type StoreRow, type StoreSettings } from './ctx';
import { CATEGORY_TEMPLATES, SHIPPING_TEMPLATE, type CategorySeed } from './templates';

const cleanL10n = (v: unknown, max = 200): L10n => {
  const o: L10n = {};
  if (v && typeof v === 'object')
    for (const k of ['uz', 'ru', 'en'] as const) {
      const s = (v as Record<string, unknown>)[k];
      if (typeof s === 'string' && s.trim()) o[k] = s.trim().slice(0, max);
    }
  return o;
};

export interface UserRow {
  id: string;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  languageCode: Locale;
  photoUrl: string | null;
  phone: string | null;
  phoneVerified: boolean;
  isPlatformAdmin: boolean;
  notify: { orders: boolean; marketing: boolean };
}

export async function upsertTelegramUser(s: Ctx, u: TelegramUser): Promise<UserRow> {
  return s.tx(null, SYSTEM, async (tx) => {
    const [existing] = await tx.query<UserRow>('select * from users where telegram_id = $1', [u.id]);
    if (existing) {
      await tx.query('update users set first_name = $2, last_name = $3, username = $4, photo_url = coalesce($5, photo_url), updated_at = $6 where id = $1', [
        existing.id, u.first_name.slice(0, 64), u.last_name?.slice(0, 64) ?? null, u.username ?? null, u.photo_url ?? null, s.now().toISOString(),
      ]);
      return { ...existing, firstName: u.first_name, lastName: u.last_name ?? null, username: u.username ?? null };
    }
    const id = uuidv7(s.now().getTime());
    await tx.query('insert into users (id, telegram_id, first_name, last_name, username, language_code, photo_url) values ($1,$2,$3,$4,$5,$6,$7)', [
      id, u.id, u.first_name.slice(0, 64), u.last_name?.slice(0, 64) ?? null, u.username ?? null, toLoc(u.language_code), u.photo_url ?? null,
    ]);
    const [row] = await tx.query<UserRow>('select * from users where id = $1', [id]);
    return row!;
  });
}

export function actorFor(u: UserRow): Actor {
  return { userId: u.id, telegramId: u.telegramId, isPlatformAdmin: u.isPlatformAdmin, locale: toLoc(u.languageCode), name: [u.firstName, u.lastName].filter(Boolean).join(' ') };
}

async function seedCategories(tx: Sql, storeId: string, seeds: CategorySeed[], parent: { id: string; path: string } | null, now: number): Promise<string[]> {
  const ids: string[] = [];
  const used = new Set<string>();
  for (const [i, c] of seeds.entries()) {
    const id = uuidv7(now);
    let slug = itemSlug(c.name.uz ?? 'kategoriya');
    for (let k = 2; used.has(slug); k++) slug = `${itemSlug(c.name.uz ?? 'k')}-${k}`;
    used.add(slug);
    const path = pathFor(parent?.path ?? null, id);
    await tx.query('insert into categories (store_id, id, parent_id, path, slug, name, icon, position) values ($1,$2,$3,$4::ltree,$5,$6::jsonb,$7,$8)', [
      storeId, id, parent?.id ?? null, path, slug, json(c.name), c.icon ?? null, (i + 1) * 1024,
    ]);
    ids.push(id);
    if (c.children) ids.push(...(await seedCategories(tx, storeId, c.children, { id, path }, now)));
  }
  return ids;
}

export interface CreateStoreInput {
  name: string;
  slug: string;
  businessType: BusinessType;
  brand?: string;
  presetId?: string;
  fontPair?: ThemeTokens['fontPair'];
  logoUrl?: string | null;
  locale?: Locale;
  firstProduct?: { title: string; price: number; imageUrl?: string | null; sizes?: string[]; colors?: string[]; stock?: number } | null;
  payments?: { cod?: boolean; sandboxPayme?: boolean; sandboxClick?: boolean; stars?: boolean };
}

export function manageService(s: Ctx) {
  const audit = s.audit.bind(s);

  async function createStore(actor: Actor, i: CreateStoreInput) {
    if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
    const slug = i.slug.trim().toLowerCase();
    const problem = checkStoreSlug(slug);
    if (problem) throw new DomainError('SLUG_INVALID', 'This address cannot be used', { problem });
    const name = i.name.trim().slice(0, 60);
    if (name.length < 2) throw new DomainError('VALIDATION', 'Store name is too short', { field: 'name' });
    if (!BUSINESS_TYPES.includes(i.businessType)) throw new DomainError('VALIDATION', 'Unknown business type', { field: 'businessType' });
    const taken = await s.tx(null, actor, (tx) => tx.query('select 1 from stores where lower(slug) = $1', [slug]));
    if (taken.length) throw new DomainError('SLUG_TAKEN', 'This address is taken', { slug });
    const storeId = uuidv7(s.now().getTime());
    const locale = i.locale ?? actor.locale;
    const now = s.now().getTime();
    return s.tx(storeId, actor, async (tx) => {
      const nameL: L10n = { uz: name, ru: name, en: name };
      try {
        await tx.query(
          `insert into stores (id, slug, name, owner_user_id, business_type, default_locale, logo_url, installments, settings) values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
          [storeId, slug, json(nameL), actor.userId, i.businessType, locale, i.logoUrl ?? null, json([{ months: 3, markupPercent: 0 }, { months: 6, markupPercent: 4 }, { months: 12, markupPercent: 9 }]),
            json({ contacts: {}, notifications: { newOrder: true, payment: true, lowStock: true, reviews: true }, autoConfirmPaid: false } satisfies StoreSettings)],
        );
      } catch (e) {
        if (String((e as Error).message).includes('stores_slug_key')) throw new DomainError('SLUG_TAKEN', 'This address is taken', { slug });
        throw e;
      }
      await tx.query(`insert into store_members (store_id, user_id, role) values ($1,$2,'owner')`, [storeId, actor.userId]);
      const preset = PRESETS.find((p) => p.id === i.presetId) ?? presetsFor(i.businessType)[0]!;
      const tokens = sanitizeTokens({ ...preset.tokens, ...(i.brand ? { brand: i.brand } : {}), ...(i.fontPair ? { fontPair: i.fontPair } : {}) });
      const sections = defaultSections(i.businessType, nameL);
      const themeId = uuidv7(now);
      await tx.query(`insert into store_themes (store_id, id, version, status, tokens, sections, preset, created_by) values ($1,$2,1,'published',$3::jsonb,$4::jsonb,$5,$6)`, [storeId, themeId, json(tokens), json(sections), preset.id, actor.userId]);
      await tx.query(`insert into store_themes (store_id, id, version, status, tokens, sections, preset, created_by) values ($1,$2,2,'draft',$3::jsonb,$4::jsonb,$5,$6)`, [storeId, uuidv7(now), json(tokens), json(sections), preset.id, actor.userId]);
      await tx.query('update stores set published_theme_id = $2 where id = $1', [storeId, themeId]);
      const catIds = await seedCategories(tx, storeId, CATEGORY_TEMPLATES[i.businessType], null, now);
      // shipping defaults
      const mIds: Record<string, string> = {};
      for (const [k, m] of SHIPPING_TEMPLATE.methods.entries()) {
        if (i.businessType === 'digital') break;
        mIds[m.key] = uuidv7(now);
        const pickupPoints = m.type === 'self_pickup' ? [{ id: 'main', name: { uz: 'Doʻkon', ru: 'Магазин', en: 'Shop' }, address: '', hours: '10:00–20:00' }] : [];
        await tx.query('insert into shipping_methods (store_id, id, type, name, processing_days, cutoff_time, position, pickup_points) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)', [
          storeId, mIds[m.key], m.type, json(m.name), m.processingDays, m.cutoffTime, k, json(pickupPoints),
        ]);
      }
      if (i.businessType !== 'digital') {
        const zIds: Record<string, string> = {};
        for (const z of SHIPPING_TEMPLATE.zones) {
          zIds[z.key] = uuidv7(now);
          await tx.query('insert into shipping_zones (store_id, id, name, regions) values ($1,$2,$3,$4::text[])', [storeId, zIds[z.key], z.name, z.regions]);
        }
        for (const r of SHIPPING_TEMPLATE.rates)
          await tx.query('insert into shipping_rates (store_id, id, zone_id, method_id, calc, amount, per_kg, free_over, transit_days_min, transit_days_max) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
            storeId, uuidv7(now), zIds[r.zone], mIds[r.method], r.calc, r.amount, (r as { perKg?: number }).perKg ?? null, (r as { freeOver?: number }).freeOver ?? null, r.min, r.max,
          ]);
      }
      // payments: sandbox on by default, no blocking credential forms (§6.4 step 5)
      const pay = i.payments ?? {};
      const providers: Array<[ProviderId, boolean]> = [
        ['cod', i.businessType !== 'digital' && pay.cod !== false],
        ['payme', pay.sandboxPayme !== false && i.businessType !== 'digital'],
        ['click', pay.sandboxClick !== false && i.businessType !== 'digital'],
        ['uzum', false],
        ['stars', i.businessType === 'digital' || !!pay.stars],
        ['bank_transfer', false],
        ['telegram', false],
      ];
      for (const [p, enabled] of providers)
        await tx.query(`insert into payment_provider_configs (store_id, provider, mode, enabled, public_config) values ($1,$2,'sandbox',$3,$4::jsonb)`, [storeId, p, enabled, json({})]);
      // first product (photo-first)
      const store = await s.storeById(tx, storeId);
      if (i.firstProduct?.title?.trim()) await createSimpleProduct(s, tx, store, actor, { ...i.firstProduct, categoryId: catIds[0] ?? null });
      await audit(tx, storeId, actor, 'owner', 'store.create', 'store', storeId, null, { slug, name, businessType: i.businessType });
      const owner = await s.userRecipient(tx, actor.userId);
      await s.enqueue(tx, storeId, owner.map((r) => ({ ...r, kind: 'owner' as const })), { topic: 'store.created', storeSlug: slug, storeName: name });
      return { store: await s.storeById(tx, storeId) };
    });
  }

  async function themeRows(tx: Sql, storeId: string) {
    const rows = await tx.query<{ id: string; version: number; status: string; tokens: unknown; sections: unknown; preset: string | null; createdAt: string }>(
      `select id, version, status, tokens, sections, preset, created_at from store_themes where store_id = $1 order by version desc`,
      [storeId],
    );
    return rows;
  }

  async function currentDraft(tx: Sql, storeId: string) {
    const rows = await themeRows(tx, storeId);
    const draft = rows.find((r) => r.status === 'draft');
    const published = rows.find((r) => r.status === 'published');
    return { draft, published, rows };
  }

  return {
    'me.get': async (actor: Actor) => {
      if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
      return s.tx(null, actor, async (tx) => {
        const [user] = await tx.query<UserRow>('select * from users where id = $1', [actor.userId]);
        const stores = await tx.query(
          `select s.id, s.slug, s.name, s.logo_url, s.status, s.business_type, m.role from store_members m join stores s on s.id = m.store_id where m.user_id = $1 and s.status <> 'closed' order by m.created_at`,
          [actor.userId],
        );
        return { user, stores };
      });
    },

    'me.update': async (actor: Actor, i: { languageCode?: Locale; notify?: { orders?: boolean; marketing?: boolean } }) => {
      if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
      return s.tx(null, actor, async (tx) => {
        if (i.languageCode) await tx.query('update users set language_code = $2 where id = $1', [actor.userId, toLoc(i.languageCode)]);
        if (i.notify) await tx.query(`update users set notify = notify || $2::jsonb where id = $1`, [actor.userId, json({ ...(i.notify.orders !== undefined ? { orders: !!i.notify.orders } : {}), ...(i.notify.marketing !== undefined ? { marketing: !!i.notify.marketing } : {}) })]);
        const [user] = await tx.query('select * from users where id = $1', [actor.userId]);
        return user;
      });
    },

    'me.addresses': async (actor: Actor, i: { slug: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => tx.query('select a.* from addresses a join customers c on c.id = a.customer_id where c.store_id = $1 and c.user_id = $2 order by a.is_default desc, a.created_at desc', [store.id, uid])),

    'me.deleteAddress': async (actor: Actor, i: { slug: string; id: string }) =>
      s.buyer(i.slug, actor, async (tx, store, uid) => {
        await tx.query('delete from addresses a using customers c where c.id = a.customer_id and c.user_id = $2 and a.store_id = $1 and a.id = $3', [store.id, uid, i.id]);
        return { ok: true };
      }),

    'auth.savePhone': async (_a: Actor, i: { telegramId: number; phone: string }) =>
      s.tx(null, SYSTEM, async (tx) => {
        const phone = i.phone.replace(/[^\d+]/g, '');
        await tx.query('update users set phone = $2, phone_verified = true where telegram_id = $1', [i.telegramId, phone.startsWith('+') ? phone : `+${phone}`]);
        return { ok: true };
      }),

    'auth.seenUpdate': async (_a: Actor, i: { updateId: number }) =>
      s.tx(null, SYSTEM, async (tx) => (await tx.query('insert into processed_updates (update_id) values ($1) on conflict do nothing returning update_id', [i.updateId])).length === 0),

    'auth.forgetUpdate': async (_a: Actor, i: { updateId: number }) =>
      s.tx(null, SYSTEM, async (tx) => {
        await tx.query('delete from processed_updates where update_id = $1', [i.updateId]);
        return { ok: true };
      }),

    'auth.issueRefresh': async (_a: Actor, i: { userId: string; familyId?: string; ttlDays?: number }) =>
      s.tx(null, SYSTEM, async (tx) => {
        const raw = new Uint8Array(32);
        globalThis.crypto.getRandomValues(raw);
        const token = toHex(raw);
        await tx.query('insert into refresh_tokens (id, user_id, family_id, token_hash, expires_at) values ($1,$2,$3,$4,$5)', [
          uuidv7(), i.userId, i.familyId ?? uuidv7(), await sha256Hex(token), new Date(s.now().getTime() + (i.ttlDays ?? 30) * 86_400_000).toISOString(),
        ]);
        return { token };
      }),

    /** Rotating refresh tokens with reuse detection: a reused token revokes its whole family. */
    'auth.rotateRefresh': async (_a: Actor, i: { token: string }): Promise<{ token: string; user: UserRow }> => {
      const r = await s.tx(null, SYSTEM, async (tx) => {
        const [t] = await tx.query<{ id: string; userId: string; familyId: string; expiresAt: string; usedAt: string | null; revokedAt: string | null }>('select * from refresh_tokens where token_hash = $1', [await sha256Hex(i.token)]);
        if (!t) throw new DomainError('UNAUTHENTICATED', 'Unknown refresh token');
        const revokeFamily = async () => {
          // Revoke the whole family and COMMIT that before failing (throwing here would roll the revocation back).
          await tx.query('update refresh_tokens set revoked_at = $2 where family_id = $1 and revoked_at is null', [t.familyId, s.now().toISOString()]);
          return { reused: true as const };
        };
        if (t.usedAt || t.revokedAt) return revokeFamily();
        if (Date.parse(t.expiresAt) < s.now().getTime()) throw new DomainError('UNAUTHENTICATED', 'Refresh token expired');
        // atomic claim: a concurrent rotation of the same token waits on the row lock, then finds it used → reuse
        const claimed = await tx.query('update refresh_tokens set used_at = $2 where id = $1 and used_at is null and revoked_at is null returning id', [t.id, s.now().toISOString()]);
        if (!claimed.length) return revokeFamily();
        const raw = new Uint8Array(32);
        globalThis.crypto.getRandomValues(raw);
        const token = toHex(raw);
        await tx.query('insert into refresh_tokens (id, user_id, family_id, token_hash, expires_at) values ($1,$2,$3,$4,$5)', [uuidv7(), t.userId, t.familyId, await sha256Hex(token), new Date(s.now().getTime() + 30 * 86_400_000).toISOString()]);
        const [user] = await tx.query<UserRow>('select * from users where id = $1', [t.userId]);
        return { token, user: user! };
      });
      if ('reused' in r) throw new DomainError('UNAUTHENTICATED', 'Refresh token reuse detected');
      return r;
    },

    // ── Store lifecycle ─────────────────────────────────────────────────────
    'stores.slugAvailable': async (actor: Actor, i: { slug?: string; name?: string }) =>
      s.tx(null, actor, async (tx) => {
        const slug = (i.slug ?? slugify(i.name ?? '')).toLowerCase();
        const problem = checkStoreSlug(slug);
        const rows = await tx.query<{ slug: string }>(`select lower(slug) as slug from stores where lower(slug) like $1 || '%'`, [slug.slice(0, 20)]);
        const taken = new Set(rows.map((r) => r.slug));
        const available = !problem && !taken.has(slug);
        return { slug, available, problem: problem ?? (taken.has(slug) ? 'taken' : null), suggestions: available ? [] : slugAlternatives(slug.length >= 3 ? slug : `${slug}-shop`, (x) => taken.has(x)) };
      }),

    'stores.create': createStore,

    'admin.store.get': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx, m) => ({ store: m.store, role: m.role, permissions: permissionsOf(m.role) }), { write: false }),

    'admin.store.update': async (actor: Actor, i: { storeId: string; name?: L10n; tagline?: L10n; logoUrl?: string | null; locales?: Locale[]; defaultLocale?: Locale; settings?: StoreSettings; installments?: Array<{ months: number; markupPercent: number }>; status?: 'active' | 'draft' }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        const before = m.store;
        const name = i.name ? cleanL10n(i.name, 60) : before.name;
        if (!Object.keys(name).length) throw new DomainError('VALIDATION', 'Store name is required', { field: 'name' });
        const locales = i.locales?.filter((l) => ['uz', 'ru', 'en'].includes(l)) ?? before.locales;
        if (!locales.length) throw new DomainError('VALIDATION', 'Keep at least one language', { field: 'locales' });
        const def = i.defaultLocale && locales.includes(i.defaultLocale) ? i.defaultLocale : locales.includes(before.defaultLocale) ? before.defaultLocale : locales[0]!;
        const inst = (i.installments ?? before.installments).filter((p) => [3, 6, 12].includes(p.months) && p.markupPercent >= 0 && p.markupPercent <= 100).slice(0, 3);
        await tx.query(
          `update stores set name = $2::jsonb, tagline = $3::jsonb, logo_url = $4, locales = $5::text[], default_locale = $6, settings = $7::jsonb, installments = $8::jsonb, status = $9, updated_at = $10 where id = $1`,
          [i.storeId, json(name), json(i.tagline ? cleanL10n(i.tagline, 120) : before.tagline), i.logoUrl !== undefined ? i.logoUrl : before.logoUrl, locales, def,
            json({ ...before.settings, ...(i.settings ?? {}) }), json(inst), i.status ?? before.status, s.now().toISOString()],
        );
        const after = await s.storeById(tx, i.storeId);
        await audit(tx, i.storeId, actor, m.role, 'store.update', 'store', i.storeId, before, after);
        return after;
      }),

    'admin.store.close': async (actor: Actor, i: { storeId: string; confirmSlug: string }) =>
      s.staff(i.storeId, actor, 'payments.configure', async (tx, m) => {
        if (i.confirmSlug !== m.store.slug) throw new DomainError('VALIDATION', 'Type the store address to confirm', { field: 'confirmSlug' });
        await tx.query(`update stores set status = 'closed' where id = $1`, [i.storeId]);
        await audit(tx, i.storeId, actor, m.role, 'store.close', 'store', i.storeId, { status: m.store.status }, { status: 'closed' });
        return { ok: true };
      }),

    // ── Discounts ───────────────────────────────────────────────────────────
    'admin.discounts.list': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', (tx) =>
        tx.query(`select d.*, coalesce((select sum(amount) from discount_redemptions r where r.discount_id = d.id), 0)::bigint as total_discounted from discounts d where d.store_id = $1 and d.status <> 'archived' order by d.created_at desc`, [i.storeId]), { write: false }),

    'admin.discounts.save': async (actor: Actor, i: { storeId: string; id?: string; kind: 'code' | 'automatic' | 'flash_sale'; title: string; code?: string | null; valueType: 'percent' | 'fixed' | 'free_shipping' | 'bxgy'; value: number; bxgy?: { buy: number; get: number } | null; appliesTo: { type: 'all' | 'products' | 'collections' | 'category'; ids?: string[] }; conditions?: { minSubtotal?: number | null; firstOrder?: boolean; customerTags?: string[] }; startsAt?: string | null; endsAt?: string | null; usageLimit?: number | null; perCustomerLimit?: number | null; combines?: { order: boolean; product: boolean; shipping: boolean }; priority?: number; status?: 'active' | 'disabled' }) =>
      s.staff(i.storeId, actor, 'discounts.manage', async (tx, m) => {
        const id = i.id && isUuid(i.id) ? i.id : uuidv7(s.now().getTime());
        const [before] = await tx.query('select * from discounts where store_id = $1 and id = $2', [i.storeId, id]);
        if (i.kind === 'code') {
          const code = (i.code ?? '').trim().toUpperCase();
          if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new DomainError('VALIDATION', 'Code: 3–32 letters, digits, - or _', { field: 'code' });
          const dup = await tx.query(`select 1 from discounts where store_id = $1 and lower(code) = lower($2) and id <> $3 and status <> 'archived'`, [i.storeId, code, id]);
          if (dup.length) throw new DomainError('CONFLICT', 'This code already exists', { field: 'code' });
          i.code = code;
        } else i.code = null;
        if (i.valueType === 'percent' && (i.value <= 0 || i.value > 100)) throw new DomainError('VALIDATION', 'Percent must be between 1 and 100', { field: 'value' });
        if (i.valueType === 'fixed' && i.value <= 0) throw new DomainError('VALIDATION', 'Amount must be positive', { field: 'value' });
        if (i.valueType === 'bxgy' && (!i.bxgy || i.bxgy.buy < 1 || i.bxgy.get < 1)) throw new DomainError('VALIDATION', 'Set “buy” and “get” quantities', { field: 'bxgy' });
        if (i.kind === 'flash_sale' && !i.endsAt) throw new DomainError('VALIDATION', 'A flash sale needs an end time', { field: 'endsAt' });
        if (i.startsAt && i.endsAt && Date.parse(i.endsAt) <= Date.parse(i.startsAt)) throw new DomainError('VALIDATION', 'End must be after start', { field: 'endsAt' });
        const appliesTo = { type: i.appliesTo.type, ids: (i.appliesTo.ids ?? []).filter(isUuid) };
        if (appliesTo.type !== 'all' && !appliesTo.ids.length) throw new DomainError('VALIDATION', 'Pick at least one item', { field: 'appliesTo' });
        const value = i.valueType === 'fixed' ? Math.round(i.value / 100) * 100 : Math.round(i.value);
        await tx.query(
          `insert into discounts (store_id, id, kind, title, code, value_type, value, bxgy, applies_to, conditions, starts_at, ends_at, usage_limit, per_customer_limit, combines, priority, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16,$17)
           on conflict (id) do update set kind = excluded.kind, title = excluded.title, code = excluded.code, value_type = excluded.value_type, value = excluded.value, bxgy = excluded.bxgy,
             applies_to = excluded.applies_to, conditions = excluded.conditions, starts_at = excluded.starts_at, ends_at = excluded.ends_at, usage_limit = excluded.usage_limit,
             per_customer_limit = excluded.per_customer_limit, combines = excluded.combines, priority = excluded.priority, status = excluded.status where discounts.store_id = excluded.store_id`,
          [i.storeId, id, i.kind, i.title.trim().slice(0, 80), i.code, i.valueType, value, i.bxgy ? json(i.bxgy) : null, json(appliesTo), json(i.conditions ?? {}), i.startsAt || null, i.endsAt || null,
            i.usageLimit ?? null, i.perCustomerLimit ?? null, json(i.combines ?? { order: false, product: false, shipping: true }), i.priority ?? 0, i.status ?? 'active'],
        );
        const [after] = await tx.query('select * from discounts where id = $1', [id]);
        await audit(tx, i.storeId, actor, m.role, before ? 'discount.update' : 'discount.create', 'discount', id, before ?? null, after);
        return after;
      }),

    'admin.discounts.delete': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'discounts.manage', async (tx, m) => {
        const [before] = await tx.query(`update discounts set status = 'archived' where store_id = $1 and id = $2 returning *`, [i.storeId, i.id]);
        if (!before) throw new DomainError('NOT_FOUND');
        await audit(tx, i.storeId, actor, m.role, 'discount.archive', 'discount', i.id, before, { status: 'archived' });
        return { ok: true };
      }),

    // ── Shipping ────────────────────────────────────────────────────────────
    'admin.shipping.get': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => ({
        methods: await tx.query('select * from shipping_methods where store_id = $1 order by position', [i.storeId]),
        zones: await tx.query('select * from shipping_zones where store_id = $1 order by name', [i.storeId]),
        rates: await tx.query('select * from shipping_rates where store_id = $1', [i.storeId]),
      }), { write: false }),

    'admin.shipping.saveMethod': async (actor: Actor, i: { storeId: string; id?: string; type: 'courier' | 'pickup_point' | 'post' | 'self_pickup'; name: L10n; processingDays: number; cutoffTime: string; workingDays: number[]; holidays: string[]; pickupPoints?: Array<{ id: string; name: L10n; address: string; hours?: string }>; codAllowed: boolean; enabled: boolean }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(i.cutoffTime)) throw new DomainError('VALIDATION', 'Cutoff time like 14:00', { field: 'cutoffTime' });
        const days = [...new Set(i.workingDays.filter((d) => d >= 1 && d <= 7))].sort();
        if (!days.length) throw new DomainError('VALIDATION', 'Pick at least one working day', { field: 'workingDays' });
        const name = cleanL10n(i.name, 80);
        if (!Object.keys(name).length) throw new DomainError('VALIDATION', 'Name is required', { field: 'name' });
        const id = i.id && isUuid(i.id) ? i.id : uuidv7();
        const [before] = await tx.query('select * from shipping_methods where store_id = $1 and id = $2', [i.storeId, id]);
        await tx.query(
          `insert into shipping_methods (store_id, id, type, name, processing_days, cutoff_time, working_days, holidays, pickup_points, cod_allowed, enabled) values ($1,$2,$3,$4::jsonb,$5,$6,$7::int[],$8::text[],$9::jsonb,$10,$11)
           on conflict (id) do update set type = excluded.type, name = excluded.name, processing_days = excluded.processing_days, cutoff_time = excluded.cutoff_time, working_days = excluded.working_days,
             holidays = excluded.holidays, pickup_points = excluded.pickup_points, cod_allowed = excluded.cod_allowed, enabled = excluded.enabled where shipping_methods.store_id = excluded.store_id`,
          [i.storeId, id, i.type, json(name), Math.max(0, Math.min(30, i.processingDays | 0)), i.cutoffTime, days, i.holidays.filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)), json(i.pickupPoints ?? []), i.codAllowed, i.enabled],
        );
        const [after] = await tx.query('select * from shipping_methods where id = $1', [id]);
        await audit(tx, i.storeId, actor, m.role, 'shipping.method.save', 'shipping_method', id, before ?? null, after);
        return after;
      }),

    'admin.shipping.deleteMethod': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        const [before] = await tx.query('delete from shipping_methods where store_id = $1 and id = $2 returning *', [i.storeId, i.id]);
        if (!before) throw new DomainError('NOT_FOUND');
        await audit(tx, i.storeId, actor, m.role, 'shipping.method.delete', 'shipping_method', i.id, before, null);
        return { ok: true };
      }),

    'admin.shipping.saveZone': async (actor: Actor, i: { storeId: string; id?: string; name: string; regions: string[]; districts?: string[] }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        if (!i.name.trim()) throw new DomainError('VALIDATION', 'Name is required', { field: 'name' });
        const id = i.id && isUuid(i.id) ? i.id : uuidv7();
        await tx.query(
          `insert into shipping_zones (store_id, id, name, regions, districts) values ($1,$2,$3,$4::text[],$5::text[]) on conflict (id) do update set name = excluded.name, regions = excluded.regions, districts = excluded.districts where shipping_zones.store_id = excluded.store_id`,
          [i.storeId, id, i.name.trim().slice(0, 60), i.regions.filter((r) => /^UZ-[A-Z]{2}$/.test(r)), (i.districts ?? []).slice(0, 200)],
        );
        await audit(tx, i.storeId, actor, m.role, 'shipping.zone.save', 'shipping_zone', id, null, i);
        return (await tx.query('select * from shipping_zones where id = $1', [id]))[0];
      }),

    'admin.shipping.deleteZone': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        await tx.query('delete from shipping_zones where store_id = $1 and id = $2', [i.storeId, i.id]);
        await audit(tx, i.storeId, actor, m.role, 'shipping.zone.delete', 'shipping_zone', i.id, null, null);
        return { ok: true };
      }),

    'admin.shipping.saveRate': async (actor: Actor, i: { storeId: string; zoneId: string; methodId: string; calc: 'flat' | 'weight' | 'free_over'; amount: number; perKg?: number | null; freeOver?: number | null; transitDaysMin: number; transitDaysMax: number }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        if (i.amount < 0 || i.transitDaysMin < 0 || i.transitDaysMax < i.transitDaysMin) throw new DomainError('VALIDATION', 'Check amount and transit days', { field: 'amount' });
        if (i.calc === 'free_over' && !i.freeOver) throw new DomainError('VALIDATION', 'Set the free-delivery threshold', { field: 'freeOver' });
        await tx.query(
          `insert into shipping_rates (store_id, id, zone_id, method_id, calc, amount, per_kg, free_over, transit_days_min, transit_days_max) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (zone_id, method_id) do update set calc = excluded.calc, amount = excluded.amount, per_kg = excluded.per_kg, free_over = excluded.free_over,
             transit_days_min = excluded.transit_days_min, transit_days_max = excluded.transit_days_max`,
          [i.storeId, uuidv7(), i.zoneId, i.methodId, i.calc, Math.round(i.amount / 100) * 100, i.perKg ?? null, i.freeOver ?? null, i.transitDaysMin, i.transitDaysMax],
        );
        await audit(tx, i.storeId, actor, m.role, 'shipping.rate.save', 'shipping_rate', `${i.zoneId}:${i.methodId}`, null, i);
        return { ok: true };
      }),

    'admin.shipping.deleteRate': async (actor: Actor, i: { storeId: string; zoneId: string; methodId: string }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx, m) => {
        await tx.query('delete from shipping_rates where store_id = $1 and zone_id = $2 and method_id = $3', [i.storeId, i.zoneId, i.methodId]);
        await audit(tx, i.storeId, actor, m.role, 'shipping.rate.delete', 'shipping_rate', `${i.zoneId}:${i.methodId}`, null, null);
        return { ok: true };
      }),

    // ── Payment providers (credentials never leave the server) ─────────────
    'admin.payments.list': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'store.settings', async (tx) => {
        const rows = await tx.query<{ provider: ProviderId; mode: string; enabled: boolean; credentialsEnc: string | null; publicConfig: Record<string, string>; lastVerifiedAt: string | null }>(
          'select provider, mode, enabled, credentials_enc, public_config, last_verified_at from payment_provider_configs where store_id = $1 order by provider',
          [i.storeId],
        );
        const base = s.deps.links.webhookBase;
        const hook: Partial<Record<ProviderId, string[]>> = {
          payme: [`${base}/hooks/payme/${i.storeId}`],
          click: [`${base}/hooks/click/${i.storeId}/prepare`, `${base}/hooks/click/${i.storeId}/complete`],
          uzum: ['check', 'create', 'confirm', 'reverse', 'status'].map((a) => `${base}/hooks/uzum/${i.storeId}/${a}`),
        };
        return rows.map(({ credentialsEnc, ...r }) => ({ ...r, hasCredentials: !!credentialsEnc, webhookUrls: hook[r.provider] ?? [] }));
      }),

    'admin.payments.save': async (actor: Actor, i: { storeId: string; provider: ProviderId; mode: 'sandbox' | 'live'; enabled: boolean; credentials?: Record<string, string> | null; publicConfig?: Record<string, string> }) =>
      s.staff(i.storeId, actor, 'payments.configure', async (tx, m) => {
        if (!isSupportedProvider(i.provider)) throw new DomainError('VALIDATION', 'Unknown provider', { field: 'provider' });
        const [before] = await tx.query<{ mode: string; enabled: boolean; credentialsEnc: string | null }>('select mode, enabled, credentials_enc from payment_provider_configs where store_id = $1 and provider = $2', [i.storeId, i.provider]);
        let enc = before?.credentialsEnc ?? null;
        if (i.credentials && Object.keys(i.credentials).length) {
          const clean = Object.fromEntries(Object.entries(i.credentials).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k.slice(0, 40), v.trim().slice(0, 500)]));
          enc = await encryptSecret(JSON.stringify(clean), s.deps.kek);
        }
        if (i.mode === 'live' && !['cod', 'bank_transfer'].includes(i.provider)) {
          const adapter = s.deps.payments.adapter(i.provider);
          const creds = enc ? JSON.parse(await (await import('@dokonim/core')).decryptSecret(enc, s.deps.kek)) : {};
          const check = await adapter!.validateConfig({ provider: i.provider, mode: 'live', enabled: i.enabled, publicConfig: i.publicConfig ?? {}, credentials: creds });
          if (!check.ok && i.enabled) throw new DomainError('VALIDATION', 'Credentials are incomplete', { problems: check.problems });
        }
        await tx.query(
          `insert into payment_provider_configs (store_id, provider, mode, enabled, credentials_enc, public_config, updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7)
           on conflict (store_id, provider) do update set mode = excluded.mode, enabled = excluded.enabled, credentials_enc = excluded.credentials_enc, public_config = excluded.public_config, updated_at = excluded.updated_at`,
          [i.storeId, i.provider, i.mode, i.enabled, enc, json(i.publicConfig ?? {}), s.now().toISOString()],
        );
        await audit(tx, i.storeId, actor, m.role, 'payments.configure', 'payment_provider', i.provider, { mode: before?.mode, enabled: before?.enabled, credentials: before?.credentialsEnc ? '***' : null }, { mode: i.mode, enabled: i.enabled, credentials: enc ? '***' : null });
        return { ok: true };
      }),

    'admin.payments.test': async (actor: Actor, i: { storeId: string; provider: ProviderId }) =>
      s.staff(i.storeId, actor, 'payments.configure', async (tx) => {
        const cfg = (await providerConfigs(s, tx, i.storeId)).find((c) => c.provider === i.provider) ?? (i.provider in { payme: 1, click: 1, uzum: 1, telegram: 1, stars: 1 } ? sandboxConfig(i.provider as 'payme') : null);
        const adapter = s.deps.payments.adapter(i.provider);
        if (!cfg || !adapter) throw new DomainError('NOT_FOUND');
        const r = await adapter.validateConfig(cfg);
        if (r.ok) await tx.query('update payment_provider_configs set last_verified_at = $3 where store_id = $1 and provider = $2', [i.storeId, i.provider, s.now().toISOString()]);
        return r;
      }),

    'admin.payments.events': async (actor: Actor, i: { storeId: string; limit?: number }) =>
      s.staff(i.storeId, actor, 'payments.configure', (tx) => tx.query('select id, provider, kind, signature_ok, payload, response, created_at from payment_events where store_id = $1 order by created_at desc limit $2', [i.storeId, Math.min(200, i.limit ?? 50)])),

    // ── Theme editor (draft → publish, last 10 versions) ───────────────────
    'admin.theme.get': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => {
        const { draft, published, rows } = await currentDraft(tx, i.storeId);
        return {
          draft: draft ? { tokens: sanitizeTokens(draft.tokens), sections: sanitizeSections(draft.sections), version: draft.version, preset: draft.preset } : null,
          published: published ? { tokens: sanitizeTokens(published.tokens), sections: sanitizeSections(published.sections), version: published.version } : null,
          versions: rows.filter((r) => r.status !== 'draft').slice(0, 10).map((r) => ({ version: r.version, status: r.status, createdAt: r.createdAt, preset: r.preset })),
          presets: PRESETS,
        };
      }, { write: false }),

    'admin.theme.saveDraft': async (actor: Actor, i: { storeId: string; tokens: ThemeTokens; sections: Section[]; preset?: string | null }) =>
      s.staff(i.storeId, actor, 'theme.edit', async (tx) => {
        const tokens = sanitizeTokens(i.tokens);
        const sections = sanitizeSections(i.sections);
        const { draft, rows } = await currentDraft(tx, i.storeId);
        if (draft) await tx.query('update store_themes set tokens = $2::jsonb, sections = $3::jsonb, preset = coalesce($4, preset) where id = $1', [draft.id, json(tokens), json(sections), i.preset ?? null]);
        else await tx.query(`insert into store_themes (store_id, id, version, status, tokens, sections, preset, created_by) values ($1,$2,$3,'draft',$4::jsonb,$5::jsonb,$6,$7)`, [i.storeId, uuidv7(), (rows[0]?.version ?? 0) + 1, json(tokens), json(sections), i.preset ?? null, actor.userId]);
        return { tokens, sections };
      }),

    'admin.theme.publish': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'theme.edit', async (tx, m) => {
        const { draft, published, rows } = await currentDraft(tx, i.storeId);
        if (!draft) throw new DomainError('VALIDATION', 'Nothing to publish');
        if (published) await tx.query(`update store_themes set status = 'archived' where id = $1`, [published.id]);
        await tx.query(`update store_themes set status = 'published', created_at = $2 where id = $1`, [draft.id, s.now().toISOString()]);
        await tx.query('update stores set published_theme_id = $2 where id = $1', [i.storeId, draft.id]);
        await tx.query(`insert into store_themes (store_id, id, version, status, tokens, sections, preset, created_by) values ($1,$2,$3,'draft',$4::jsonb,$5::jsonb,$6,$7)`, [
          i.storeId, uuidv7(), Math.max(...rows.map((r) => r.version)) + 1, json(draft.tokens), json(draft.sections), draft.preset, actor.userId,
        ]);
        // keep the last 10 archived versions
        await tx.query(`delete from store_themes where store_id = $1 and status = 'archived' and version not in (select version from store_themes where store_id = $1 and status = 'archived' order by version desc limit 10)`, [i.storeId]);
        await audit(tx, i.storeId, actor, m.role, 'theme.publish', 'theme', draft.id, published ? { tokens: published.tokens } : null, { tokens: draft.tokens, version: draft.version });
        return { version: draft.version };
      }),

    'admin.theme.restore': async (actor: Actor, i: { storeId: string; version: number }) =>
      s.staff(i.storeId, actor, 'theme.edit', async (tx) => {
        const [v] = await tx.query<{ tokens: unknown; sections: unknown; preset: string | null }>('select tokens, sections, preset from store_themes where store_id = $1 and version = $2', [i.storeId, i.version]);
        if (!v) throw new DomainError('NOT_FOUND', 'Version not found');
        await tx.query(`update store_themes set tokens = $2::jsonb, sections = $3::jsonb, preset = $4 where store_id = $1 and status = 'draft'`, [i.storeId, json(v.tokens), json(v.sections), v.preset]);
        return { tokens: sanitizeTokens(v.tokens), sections: sanitizeSections(v.sections) };
      }),

    // ── Staff & roles ──────────────────────────────────────────────────────
    'admin.staff.list': async (actor: Actor, i: { storeId: string }) =>
      s.staff(i.storeId, actor, 'dashboard.read', async (tx) => ({
        members: await tx.query(`select m.user_id, m.role, m.created_at, u.first_name, u.last_name, u.username, u.photo_url from store_members m join users u on u.id = m.user_id where m.store_id = $1 order by m.created_at`, [i.storeId]),
        invites: await tx.query(`select id, role, expires_at, created_at from invites where store_id = $1 and used_at is null and revoked_at is null and expires_at > $2 order by created_at desc`, [i.storeId, s.now().toISOString()]),
        roles: ROLES.map((r) => ({ role: r, permissions: permissionsOf(r) })),
      }), { write: false }),

    'admin.staff.invite': async (actor: Actor, i: { storeId: string; role: Role; ttlHours?: number }) =>
      s.staff(i.storeId, actor, 'staff.manage', async (tx, m) => {
        if (!canAssignRole(m.role, i.role)) throw new DomainError('FORBIDDEN', 'You cannot invite this role');
        const token = shortId(24);
        const id = uuidv7();
        await tx.query('insert into invites (store_id, id, token_hash, role, created_by, expires_at) values ($1,$2,$3,$4,$5,$6)', [
          i.storeId, id, await sha256Hex(token), i.role, actor.userId, new Date(s.now().getTime() + Math.min(168, i.ttlHours ?? 48) * 3600_000).toISOString(),
        ]);
        await audit(tx, i.storeId, actor, m.role, 'staff.invite', 'invite', id, null, { role: i.role });
        return { id, token, link: `${s.deps.links.miniAppBase}?startapp=i-${token}` };
      }),

    'admin.staff.revokeInvite': async (actor: Actor, i: { storeId: string; id: string }) =>
      s.staff(i.storeId, actor, 'staff.manage', async (tx, m) => {
        await tx.query('update invites set revoked_at = $3 where store_id = $1 and id = $2', [i.storeId, i.id, s.now().toISOString()]);
        await audit(tx, i.storeId, actor, m.role, 'staff.invite.revoke', 'invite', i.id, null, null);
        return { ok: true };
      }),

    'admin.staff.update': async (actor: Actor, i: { storeId: string; userId: string; role: Role }) =>
      s.staff(i.storeId, actor, 'staff.manage', async (tx, m) => {
        const target = await s.roleOf(tx, i.storeId, i.userId);
        if (!target) throw new DomainError('NOT_FOUND');
        if (target === 'owner' || !canAssignRole(m.role, i.role) || (m.role !== 'owner' && target === 'admin')) throw new DomainError('FORBIDDEN', 'You cannot change this member');
        await tx.query('update store_members set role = $3 where store_id = $1 and user_id = $2', [i.storeId, i.userId, i.role]);
        await audit(tx, i.storeId, actor, m.role, 'staff.role', 'member', i.userId, { role: target }, { role: i.role });
        return { ok: true };
      }),

    'admin.staff.remove': async (actor: Actor, i: { storeId: string; userId: string }) =>
      s.staff(i.storeId, actor, 'staff.manage', async (tx, m) => {
        const target = await s.roleOf(tx, i.storeId, i.userId);
        if (!target) throw new DomainError('NOT_FOUND');
        if (target === 'owner' || (m.role !== 'owner' && target === 'admin')) throw new DomainError('FORBIDDEN', 'You cannot remove this member');
        await tx.query('delete from store_members where store_id = $1 and user_id = $2', [i.storeId, i.userId]);
        await audit(tx, i.storeId, actor, m.role, 'staff.remove', 'member', i.userId, { role: target }, null);
        return { ok: true };
      }),

    'invites.accept': async (actor: Actor, i: { token: string }) => {
      if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
      const hash = await sha256Hex(i.token);
      const found = await s.tx(null, actor, (tx) => tx.query<{ storeId: string | null }>("select invite_store($1) as store_id", [hash]));
      const sid = found[0]?.storeId;
      if (!sid) throw new DomainError('INVITE_INVALID', 'Invite not found');
      for (const st of [{ id: sid }]) {
        const r = await s.tx(st.id, actor, async (tx) => {
          const [inv] = await tx.query<{ id: string; role: Role; expiresAt: string; usedAt: string | null; revokedAt: string | null }>('select * from invites where store_id = $1 and token_hash = $2', [st.id, hash]);
          if (!inv) return null;
          if (inv.usedAt || inv.revokedAt || Date.parse(inv.expiresAt) < s.now().getTime()) throw new DomainError('INVITE_INVALID', 'This invite link has expired or was used');
          const existing = await s.roleOf(tx, st.id, actor.userId);
          if (!existing) await tx.query('insert into store_members (store_id, user_id, role) values ($1,$2,$3)', [st.id, actor.userId, inv.role]);
          await tx.query('update invites set used_by = $2, used_at = $3 where id = $1', [inv.id, actor.userId, s.now().toISOString()]);
          const store = await s.storeById(tx, st.id);
          await s.audit(tx, st.id, actor, inv.role, 'staff.join', 'member', actor.userId, null, { role: inv.role });
          await s.enqueue(tx, st.id, await s.staffRecipients(tx, st.id, 'staff.manage'), { topic: 'staff.joined', storeSlug: store.slug, storeName: pick(store.name, store.defaultLocale), memberName: actor.name ?? '', role: inv.role });
          return { storeId: st.id, slug: store.slug, role: existing ?? inv.role };
        });
        if (r) return r;
      }
      throw new DomainError('INVITE_INVALID', 'Invite not found');
    },
  };
}

export async function createSimpleProduct(
  s: Ctx, tx: Sql, store: StoreRow, actor: Actor,
  p: { title: string; price: number; imageUrl?: string | null; sizes?: string[]; colors?: string[]; stock?: number; categoryId?: string | null },
): Promise<string> {
  const now = s.now().getTime();
  const id = uuidv7(now);
  const title: L10n = { [store.defaultLocale]: p.title.trim().slice(0, 120) };
  await tx.query(
    `insert into products (store_id, id, short_id, status, title, slug, category_id, published_at) values ($1,$2,$3,'active',$4::jsonb,$5,$6,$7)`,
    [store.id, id, shortId(), json(title), itemSlug(p.title), p.categoryId ?? null, s.now().toISOString()],
  );
  const dims: Array<{ name: L10n; values: string[] }> = [];
  if (p.sizes?.length) dims.push({ name: { uz: 'Oʻlcham', ru: 'Размер', en: 'Size' }, values: p.sizes.slice(0, 12) });
  if (p.colors?.length) dims.push({ name: { uz: 'Rang', ru: 'Цвет', en: 'Colour' }, values: p.colors.slice(0, 12) });
  const valueIds: string[][] = [];
  for (const [k, d] of dims.entries()) {
    const oid = uuidv7(now);
    await tx.query('insert into product_options (store_id, id, product_id, position, name, display) values ($1,$2,$3,$4,$5::jsonb,$6)', [store.id, oid, id, k + 1, json(d.name), k === 1 ? 'swatch' : 'chips']);
    const ids: string[] = [];
    for (const [j, v] of d.values.entries()) {
      const vid = uuidv7(now);
      ids.push(vid);
      await tx.query('insert into option_values (store_id, id, option_id, position, label) values ($1,$2,$3,$4,$5::jsonb)', [store.id, vid, oid, j, json({ uz: v, ru: v, en: v })]);
    }
    valueIds.push(ids);
  }
  let combos: string[][] = [[]];
  for (const ids of valueIds) combos = combos.flatMap((c) => ids.map((x) => [...c, x]));
  for (const [k, combo] of combos.entries()) {
    const vid = uuidv7(now);
    await tx.query('insert into product_variants (store_id, id, product_id, option_value_ids, price, is_default, position) values ($1,$2,$3,$4::uuid[],$5,$6,$7)', [store.id, vid, id, combo, Math.round(p.price / 100) * 100, combos.length === 1, k]);
    await tx.query('insert into inventory_levels (store_id, variant_id, on_hand) values ($1,$2,$3)', [store.id, vid, p.stock ?? 10]);
  }
  if (p.imageUrl) await tx.query('insert into product_media (store_id, id, product_id, url, position) values ($1,$2,$3,$4,0)', [store.id, uuidv7(now), id, p.imageUrl]);
  await refreshProduct(s, tx, store, id);
  return id;
}

export { DEFAULT_TOKENS };
