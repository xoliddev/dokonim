/**
 * The SQL port. Two adapters implement it: node-postgres (server) and PGlite (browser worker, tests).
 * Rows come back with camelCased top-level keys; jsonb contents are left untouched.
 * Timestamps are ISO strings and int8/numeric are JS numbers in both adapters.
 */
import init0001 from './migrations/0001_init';
import discountCodeArchived0002 from './migrations/0002_discount_code_archived';
import storeStatusBeforeSuspend0003 from './migrations/0003_store_status_before_suspend';

export type Row = Record<string, unknown>;

export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Database extends Sql {
  readonly kind: 'pg' | 'pglite';
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const camelCache = new Map<string, string>();
export function camel(k: string): string {
  let c = camelCache.get(k);
  if (c === undefined) {
    c = k.replace(/_([a-z0-9])/g, (_, x: string) => x.toUpperCase());
    camelCache.set(k, c);
  }
  return c;
}

export function camelRow<T>(r: Row): T {
  const o: Row = {};
  for (const k in r) o[camel(k)] = r[k];
  return o as T;
}

export interface TenantScope {
  storeId: string | null;
  userId: string | null;
}

/**
 * Every application query runs inside a transaction as the non-owner role `dokonim_app`
 * with `app.store_id` / `app.user_id` set — Postgres RLS then enforces tenant isolation (§16.2).
 */
export async function inScope<T>(db: Database, scope: TenantScope, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query('set local role dokonim_app');
    await tx.query(`select set_config('app.store_id', $1, true), set_config('app.user_id', $2, true)`, [scope.storeId ?? '', scope.userId ?? '']);
    return fn(tx);
  });
}

export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  { id: '0001_init', sql: init0001 },
  { id: '0002_discount_code_archived', sql: discountCodeArchived0002 },
  { id: '0003_store_status_before_suspend', sql: storeStatusBeforeSuspend0003 },
];

export async function migrate(db: Database): Promise<string[]> {
  await db.exec('create table if not exists _migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ id: string }>('select id from _migrations')).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.exec(m.sql);
    await db.query('insert into _migrations (id) values ($1)', [m.id]);
    applied.push(m.id);
  }
  return applied;
}

/** jsonb parameter helper (both drivers accept text for jsonb casts). */
export const json = (v: unknown): string => JSON.stringify(v ?? null);
