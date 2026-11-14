/**
 * @dokonim/seed — deterministic demo content (§19.5) built through the real backend services.
 *
 *   const db = await createPgliteDatabase('idb://dokonim-demo');
 *   await migrate(db);
 *   if (!(await isSeeded(db))) await seedDemo(db);
 *
 * Three stores: "Atlas & Adras" (clothing), "Texno Bozor" (electronics), "Choyxona Market" (bakery & tea),
 * each with a 3-level category tree, variant products with stock and discounts, promo codes, collections,
 * stories, and a month of historical orders with sandbox payments and verified reviews.
 */
import { prng, type TelegramUser } from '@dokonim/core';
import { createBackend, migrate, type BackendDeps, type Database } from '@dokonim/db';
import { createPaymentRegistry } from '@dokonim/payments';
import { artDataUrl, artUrl } from './art';
import { buildStore, SeedClock, type BuiltStore, type SeedCtx } from './build';
import { seedOrders, type Buyer, type OrderStats } from './orders';
import type { StoreSpec } from './spec';
import { atlas } from './stores/atlas';
import { choyxona } from './stores/choyxona';
import { texno } from './stores/texno';

export * from './art';
export type { StoreSpec, ProductSpec, CatSpec, PromoSpec } from './spec';
export { SeedClock } from './build';
export { markSnapshot, rebaseSnapshot, snapshotAnchor } from './snapshot';

export const DEMO_STORES: StoreSpec[] = [atlas, texno, choyxona];
export const DEMO_SLUGS = DEMO_STORES.map((s) => s.slug);

/** The visitor's identity in demo mode: owns every demo store and also shops as a buyer. */
export const DEMO_USER: TelegramUser = { id: 777_000_001, first_name: 'Dilnoza', last_name: 'Karimova', username: 'dilnoza_demo', language_code: 'uz' };
/** Demo-only bot token: initData is signed with it in the browser and verified by the same core code. */
export const DEMO_BOT_TOKEN = '7770000001:DEMO-dokonim-browser-only-not-a-secret';
/** Key-encryption key for provider credentials in the demo (sandbox only, never real keys). */
export const DEMO_KEK = 'de'.repeat(32);

const BUYERS: Array<[string, string, string]> = [
  ['Aziza', 'Rahimova', '+998901112233'], ['Sardor', 'Toshmatov', '+998935554411'], ['Malika', 'Yusupova', '+998977001122'],
  ['Jasur', 'Aliyev', '+998909876543'], ['Nodira', 'Qodirova', '+998946663300'], ['Bekzod', 'Ergashev', '+998998887766'],
  ['Laylo', 'Saidova', '+998912223344'], ['Otabek', 'Nazarov', '+998933332211'], ['Gulnora', 'Mirzayeva', '+998950001199'],
];

export interface SeedResult {
  stores: Array<{ id: string; slug: string; name: string; products: number; orders: OrderStats }>;
  ms: number;
}

export interface SeedOpts {
  /** Anchor time ("now") for relative dates. Default: real now. */
  now?: Date;
  /** Override backend deps (payments registry, kek…). */
  deps?: Partial<BackendDeps>;
  /** Progress callback for the boot screen. */
  onProgress?: (step: string, done: number, total: number) => void;
}

export async function isSeeded(db: Database): Promise<boolean> {
  try {
    const r = await db.query<{ n: number }>('select count(*)::int as n from stores where slug = any($1::text[])', [DEMO_SLUGS]);
    return (r[0]?.n ?? 0) >= DEMO_SLUGS.length;
  } catch {
    return false;
  }
}

async function addStories(c: SeedCtx, b: BuiltStore) {
  const picks = b.products.filter((_, i) => i % 5 === 0).slice(0, 3);
  for (const p of picks) {
    const spec = b.spec.products.find((x) => x.key === p.key)!;
    const media = artDataUrl(artUrl(spec.art.kind, { c: spec.colors?.[0]?.hex ?? spec.art.c, c2: spec.art.c2, p: spec.art.p }));
    await c.be.methods['admin.stories.save'](c.owner, {
      storeId: b.store.id, title: { uz: spec.title.uz!.split(/[“"]/)[0]!.trim().slice(0, 24) }, coverUrl: media, isHighlight: true, expiresInHours: null,
      frames: [{ mediaUrl: media, link: { type: 'product', id: p.id }, ctaLabel: { uz: 'Koʻrish', ru: 'Смотреть', en: 'View' } }],
    });
  }
}

/** Seeds the three demo stores. Idempotent only via `isSeeded` (call it first); runs migrations itself. */
export async function seedDemo(db: Database, opts: SeedOpts = {}): Promise<SeedResult> {
  const started = Date.now();
  await migrate(db);
  const anchor = (opts.now ?? new Date()).getTime();
  const clock = new SeedClock(anchor - 100 * 86_400_000);
  const be = createBackend({
    db, clock, kek: DEMO_KEK, payments: createPaymentRegistry({}),
    links: { miniAppBase: 'https://t.me/dokonim_demo_bot/shop', webhookBase: 'https://demo.dokonim.local' },
    ...opts.deps,
  });
  const { actor: owner } = await be.upsertUser(DEMO_USER);
  const buyers: Buyer[] = [];
  for (const [i, [first, last, phone]] of BUYERS.entries()) {
    const { actor } = await be.upsertUser({ id: 777_100_000 + i, first_name: first, last_name: last, language_code: i % 4 === 3 ? 'ru' : 'uz' });
    buyers.push({ actor, name: `${first} ${last}`, phone });
  }
  buyers.splice(4, 0, { actor: owner, name: `${DEMO_USER.first_name} ${DEMO_USER.last_name}`, phone: '+998901234567' });

  const out: SeedResult['stores'] = [];
  const total = DEMO_STORES.length * 2;
  let step = 0;
  for (const [si, spec] of DEMO_STORES.entries()) {
    const c: SeedCtx = { be, clock, anchor, rand: prng(spec.orders.seed), owner };
    opts.onProgress?.(`store:${spec.slug}`, step++, total);
    const built = await buildStore(c, spec);
    await addStories(c, built);
    opts.onProgress?.(`orders:${spec.slug}`, step++, total);
    const codes = spec.promos.filter((p) => p.kind === 'code' && p.valueType !== 'free_shipping').map((p) => p.code!);
    const stats = await seedOrders(c, built, buyers.slice(si).concat(buyers.slice(0, si)), codes);
    clock.set(anchor);
    for (const p of built.products.slice(0, 2)) await be.methods['wishlist.toggle'](owner, { slug: spec.slug, productId: p.id });
    out.push({ id: built.store.id, slug: spec.slug, name: spec.name, products: built.products.length, orders: stats });
  }
  clock.set(anchor);
  await be.methods['jobs.autoComplete']();
  opts.onProgress?.('done', total, total);
  return { stores: out, ms: Date.now() - started };
}
