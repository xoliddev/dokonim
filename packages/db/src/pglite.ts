import { PGlite, types, type PGliteOptions } from '@electric-sql/pglite';
import { ltree } from '@electric-sql/pglite/contrib/ltree';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { camelRow, type Database, type Row, type Sql } from './client';

const iso = (v: string) => new Date(v).toISOString();

export const PGLITE_PARSERS = {
  [types.INT8]: (v: string) => Number(v),
  [types.NUMERIC]: (v: string) => Number(v),
  [types.TIMESTAMPTZ]: iso,
  [types.TIMESTAMP]: iso,
};

function wrap(q: { query: PGlite['query'] }): Sql {
  return {
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const r = await q.query<Row>(text, params as unknown[]);
      return r.rows.map((x) => camelRow<T>(x));
    },
  };
}

/** A raw PGlite instance with our extensions and type parsers (for dumpDataDir / loadDataDir). */
export function createPglite(dataDir?: string, opts: Partial<PGliteOptions> = {}): Promise<PGlite> {
  return PGlite.create({ dataDir, extensions: { ltree, pg_trgm }, parsers: PGLITE_PARSERS, ...opts });
}

/** dataDir: undefined → memory, 'idb://name' → IndexedDB persistence (browser), or a filesystem path (Node). */
export async function createPgliteDatabase(dataDir?: string, opts: Partial<PGliteOptions> = {}): Promise<Database> {
  return wrapPglite(await createPglite(dataDir, opts));
}

/** Adapts a PGlite instance to the Database port. */
export function wrapPglite(pg: PGlite): Database {
  const base = wrap(pg);
  return {
    kind: 'pglite',
    query: base.query,
    async transaction(fn) {
      return pg.transaction(async (tx) => fn(wrap(tx as unknown as { query: PGlite['query'] })));
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async close() {
      await pg.close();
    },
  };
}
