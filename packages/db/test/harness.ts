/**
 * Adapter-parity harness: every suite runs against PGlite and — when TEST_DATABASE_URL is set — real PostgreSQL.
 */
import { uuidv7, type TelegramUser } from '@dokonim/core';
import { createPaymentRegistry } from '@dokonim/payments';
import { createBackend, migrate, type Actor, type Database } from '../src';
import { createPgliteDatabase } from '../src/pglite';

export const KEK = 'ab'.repeat(32);

export const ADAPTERS: Array<{ name: string; make: () => Promise<Database> }> = [{ name: 'pglite', make: () => createPgliteDatabase() }];

if (process.env.TEST_DATABASE_URL) {
  ADAPTERS.push({
    name: 'postgres',
    make: async () => {
      const { createPgDatabase } = await import('../src/pg');
      const db = createPgDatabase(process.env.TEST_DATABASE_URL!, 4);
      await db.exec('drop schema if exists public cascade; create schema public; grant all on schema public to public;');
      return db;
    },
  });
}

export class TestClock {
  t: number;
  constructor(iso = '2026-11-13T07:00:00Z') {
    this.t = Date.parse(iso);
  }
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export async function setup(make: () => Promise<Database>) {
  const db = await make();
  await migrate(db);
  const clock = new TestClock();
  const outbox: unknown[] = [];
  const be = createBackend({
    db,
    clock,
    kek: KEK,
    payments: createPaymentRegistry({}),
    links: { miniAppBase: 'https://t.me/dokonim_bot/shop', webhookBase: 'https://api.test' },
    onOutbox: () => outbox.push(1),
  });
  let tg = 1000;
  const user = async (first_name: string, extra: Partial<TelegramUser> = {}): Promise<Actor> => (await be.upsertUser({ id: ++tg, first_name, language_code: 'uz', ...extra })).actor;
  const m = be.methods;
  return { db, be, m, clock, user, outbox, close: () => db.close() };
}

export type H = Awaited<ReturnType<typeof setup>>;

/** Owner + store with a nested tree and a variant product, ready for buyer flows. */
export async function seedStore(h: H, slug = 'atlas-test') {
  const owner = await h.user('Dilnoza');
  const { store } = await h.m['stores.create'](owner, { name: 'Atlas Test', slug, businessType: 'clothing' });
  const kiyim = await h.m['admin.categories.create'](owner, { storeId: store.id, parentId: null, name: { uz: 'Kiyim', ru: 'Одежда' } });
  const ayollar = await h.m['admin.categories.create'](owner, { storeId: store.id, parentId: kiyim.id, name: { uz: 'Ayollar' } });
  const koylak = await h.m['admin.categories.create'](owner, { storeId: store.id, parentId: ayollar.id, name: { uz: 'Koʻylaklar', ru: 'Платья' } });
  const atlas = await h.m['admin.categories.create'](owner, { storeId: store.id, parentId: koylak.id, name: { uz: 'Atlas koʻylaklar' } });
  const product = await h.m['admin.products.save'](owner, variantProduct(store.id, atlas.id));
  return { owner, store, cats: { kiyim, ayollar, koylak, atlas }, product };
}

export function variantProduct(storeId: string, categoryId: string | null, over: Partial<{ title: string; price: number; stock: number }> = {}) {
  const size = { id: uuidv7(), name: { uz: 'Oʻlcham' }, display: 'chips' as const, values: ['S', 'M'].map((l) => ({ id: uuidv7(), label: { uz: l } })) };
  const color = { id: uuidv7(), name: { uz: 'Rang' }, display: 'swatch' as const, values: [{ id: uuidv7(), label: { uz: 'Qizil' }, swatchHex: '#c0392b' }, { id: uuidv7(), label: { uz: 'Koʻk' }, swatchHex: '#2c3e90' }] };
  const variants = size.values.flatMap((s) =>
    color.values.map((c) => ({
      id: uuidv7(), optionValueIds: [s.id, c.id], sku: `AD-${s.label.uz}-${c.label.uz}`, barcode: '', price: over.price ?? 45_000_000, compareAtPrice: 52_000_000, costPrice: 20_000_000,
      weightG: 400, stock: over.stock ?? 5, lowStockThreshold: 1, trackInventory: true, allowBackorder: false,
    })),
  );
  return {
    storeId, status: 'active' as const, title: { uz: over.title ?? 'Atlas koʻylak', ru: 'Платье из атласа' }, description: { uz: 'Qoʻlda **tikilgan** atlas.' }, categoryId,
    collectionIds: [], tags: ['atlas', 'yangi'], attributes: [{ name: { uz: 'Mato' }, value: { uz: 'Ipak atlas' } }], isDigital: false, brand: 'Margʻilon', vendorCode: 'AD-1',
    media: [{ url: 'https://cdn.example/atlas.webp' }], options: [size, color], variants,
  };
}

export const ADDRESS = { regionCode: 'UZ-TK', district: 'Yunusobod', line1: 'Amir Temur 1', landmark: 'Metro yonida' };
