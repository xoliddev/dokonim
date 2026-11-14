import { describe, expect, it } from 'vitest';
import { migrate } from '@dokonim/db';
import { createPgliteDatabase } from '@dokonim/db/pglite';
import { markSnapshot, rebaseSnapshot, snapshotAnchor } from '../src';

const DAY = 86_400_000;

describe('demo snapshot rebase', () => {
  it('shifts every timestamp by now − bakedAt exactly once', async () => {
    const db = await createPgliteDatabase();
    await migrate(db);
    const baked = new Date('2026-01-10T12:00:00Z');
    await db.query(
      `insert into users (id, telegram_id, first_name, created_at, updated_at) values ('018f0000-0000-7000-8000-000000000001', 1, 'A', $1, $1)`,
      [new Date(baked.getTime() - 3 * DAY).toISOString()],
    );
    await markSnapshot(db, baked);
    expect((await snapshotAnchor(db))?.toISOString()).toBe(baked.toISOString());

    const now = new Date('2026-03-01T08:30:00Z');
    expect(await rebaseSnapshot(db, now)).toBe(now.getTime() - baked.getTime());
    const [u] = await db.query<{ createdAt: string; updatedAt: string }>('select created_at, updated_at from users');
    expect(new Date(u!.createdAt).getTime()).toBe(now.getTime() - 3 * DAY);
    expect(u!.updatedAt).toBe(u!.createdAt);

    // a reload of an already rebased database must not shift again
    expect(await snapshotAnchor(db)).toBeNull();
    expect(await rebaseSnapshot(db, new Date(now.getTime() + 5 * DAY))).toBe(0);
    await db.close();
  });

  it('is a no-op on a database that was never marked', async () => {
    const db = await createPgliteDatabase();
    await migrate(db);
    expect(await rebaseSnapshot(db)).toBe(0);
    await db.close();
  });
});
