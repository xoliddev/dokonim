/**
 * Pre-baked demo snapshot (§19.4). Seeding three stores through the real services takes 15 s to minutes in a
 * browser, so the demo build seeds once under Node, dumps the PGlite data directory and ships it as a static asset.
 * Timestamps are baked relative to the bake time and shifted on load, so order history always ends "today" and
 * flash-sale countdowns stay honest:
 *
 *   // build time (Node):  await seedDemo(db, { now }); await markSnapshot(db, now); const tar = await pg.dumpDataDir('gzip');
 *   // first visit (browser): const pg = await PGlite.create({ loadDataDir: tar }); await rebaseSnapshot(db, new Date());
 */
import type { Database } from '@dokonim/db';

const META = 'demo_snapshot';
const DAY = 86_400_000;

/** Records the anchor ("now") the snapshot was seeded with. */
export async function markSnapshot(db: Database, bakedAt: Date): Promise<void> {
  await db.exec(`create table if not exists ${META} (baked_at timestamptz not null, rebased_at timestamptz)`);
  await db.query(`delete from ${META}`);
  await db.query(`insert into ${META} (baked_at) values ($1)`, [bakedAt.toISOString()]);
}

/** The anchor of a snapshot that has not been rebased yet, or null (fresh seed, or already rebased). */
export async function snapshotAnchor(db: Database): Promise<Date | null> {
  try {
    const r = await db.query<{ bakedAt: string; rebasedAt: string | null }>(`select baked_at, rebased_at from ${META} limit 1`);
    return r[0] && !r[0].rebasedAt ? new Date(r[0].bakedAt) : null;
  } catch {
    return null;
  }
}

/**
 * Moves every timestamp in the public schema by `now − bakedAt` (and calendar dates in delivery promises by whole
 * days), once. Triggers are disabled for the shift so append-only/updated_at triggers neither refuse nor rewrite it.
 * Returns the shift in milliseconds (0 when there was nothing to rebase).
 */
export async function rebaseSnapshot(db: Database, now: Date = new Date()): Promise<number> {
  const anchor = await snapshotAnchor(db);
  if (!anchor) return 0;
  const delta = now.getTime() - anchor.getTime();
  const days = Math.round(delta / DAY);
  const cols = await db.query<{ tableName: string; columnName: string }>(
    `select c.table_name, c.column_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.table_name <> $1
        and c.data_type in ('timestamp with time zone', 'timestamp without time zone')
      order by 1, 2`,
    [META],
  );
  const byTable = new Map<string, string[]>();
  for (const c of cols) byTable.set(c.tableName, [...(byTable.get(c.tableName) ?? []), c.columnName]);
  const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
  await db.transaction(async (tx) => {
    await tx.query(`set local session_replication_role = replica`);
    const shift = `make_interval(secs => ${delta / 1000})`;
    for (const [table, list] of byTable) {
      await tx.query(`update ${q(table)} set ${list.map((c) => `${q(c)} = ${q(c)} + ${shift}`).join(', ')}`);
    }
    // "from"/"to"/"startsOn" are store-local calendar dates (YYYY-MM-DD)
    await tx.query(
      `update orders set delivery_promise = jsonb_build_object(
         'from', ((delivery_promise->>'from')::date + $1::int)::text,
         'to', ((delivery_promise->>'to')::date + $1::int)::text,
         'startsOn', ((delivery_promise->>'startsOn')::date + $1::int)::text)
       where delivery_promise ? 'from' and delivery_promise ? 'to' and delivery_promise ? 'startsOn'`,
      [days],
    );
    await tx.query(`update ${META} set rebased_at = $1`, [now.toISOString()]);
  });
  return delta;
}
