import pg from 'pg';
import { camelRow, type Database, type Row, type Sql } from './client';

const iso = (v: string) => new Date(v).toISOString();
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(1184, iso); // timestamptz
pg.types.setTypeParser(1114, iso); // timestamp

function wrap(c: pg.Pool | pg.PoolClient): Sql {
  return {
    async query<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const r = await c.query<Row>(text, params);
      return r.rows.map((x) => camelRow<T>(x));
    },
  };
}

export function createPgDatabase(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max });
  const base = wrap(pool);
  return {
    kind: 'pg',
    query: base.query,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}
