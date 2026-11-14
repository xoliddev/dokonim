/**
 * The ONLY place in apps/api that runs SQL outside the application services.
 *
 * These queries go through `backend.ctx.db` directly — i.e. as the connecting role (the schema owner that ran the
 * migrations), NOT inside `inScope()` as `dokonim_app`. That is the same privilege the migration's `security definer`
 * functions (claim_outbox, payment_store_for_txn, …) already rely on: the DATABASE_URL role must be the owner and be
 * superuser or BYPASSRLS (true for the docker-compose `postgres` user and for PGlite).
 *
 * Why not a service method: each lookup is a cross-tenant "which store/user is this?" question asked before any tenant
 * scope exists, and keeping them here (4 tiny statements, no writes except the admin flag) avoids widening the
 * backend's public method table.
 */
import type { Database, UserRow } from '@dokonim/db';

/** Liveness probe for /healthz. */
export async function ping(db: Database): Promise<void> {
  await db.query('select 1');
}

/** Bot callbacks only carry the Telegram id; the bot upserts the user before any callback, so a lookup is enough. */
export async function userByTelegramId(db: Database, telegramId: number): Promise<UserRow | null> {
  const [u] = await db.query<UserRow>('select * from users where telegram_id = $1', [telegramId]);
  return u ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Telegram invoices carry our payment id as `invoice_payload`. `payment_store_for_txn` resolves by the provider's
 * transaction id, which does not exist yet at pre_checkout time, so we look the payment up by primary key.
 */
export async function paymentStoreId(db: Database, paymentId: string): Promise<string | null> {
  if (!UUID.test(paymentId)) return null;
  const [p] = await db.query<{ storeId: string }>('select store_id from payments where id = $1', [paymentId]);
  return p?.storeId ?? null;
}

/** PLATFORM_ADMIN_TELEGRAM_IDS: grants users.is_platform_admin on login/refresh (never revokes). */
export async function markPlatformAdmin(db: Database, userId: string): Promise<void> {
  await db.query('update users set is_platform_admin = true where id = $1 and not is_platform_admin', [userId]);
}
