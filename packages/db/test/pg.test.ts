import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPgDatabase } from '../src/pg';

describe('pg pool', () => {
  it('an idle-client error is logged instead of crashing the process', async () => {
    const on = vi.spyOn(pg.Pool.prototype, 'on');
    const seen: string[] = [];
    const db = createPgDatabase('postgres://u@127.0.0.1:1/none', 1, (e) => seen.push(e.message));
    const pool = on.mock.contexts.find((c) => c instanceof pg.Pool) as pg.Pool;
    on.mockRestore();
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(seen).toEqual(['Connection terminated unexpectedly']);
    await db.close();
  });
});
