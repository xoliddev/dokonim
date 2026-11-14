/**
 * Bakes the demo database at build time: migrate + seed the three demo stores in an in-memory PGlite under Node,
 * record the anchor time, then dump the data directory to `public/demo/snapshot.tar.gz`. The demo worker loads it
 * with `loadDataDir` and shifts every timestamp to "now" (`rebaseSnapshot`), so a first visit no longer seeds.
 *
 *   npx tsx apps/miniapp/scripts/bake-demo.ts      (run by `npm run build:demo`)
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '@dokonim/db';
import { createPglite, wrapPglite } from '@dokonim/db/pglite';
import { isSeeded, markSnapshot, rebaseSnapshot, seedDemo } from '@dokonim/seed';
import { trimWal } from './trim-wal';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/demo/snapshot.tar.gz');

const t0 = Date.now();
const pg = await createPglite();
const db = wrapPglite(pg);
await migrate(db);
const now = new Date();
const res = await seedDemo(db, { now });
await markSnapshot(db, now);
// smaller tar: drop dead tuples left by hundreds of seeding transactions, then trim the WAL (see trim-wal.ts)
await pg.exec('vacuum full');
await pg.exec('checkpoint');
const [pos] = (await pg.query<{ lsn: string; file: string }>('select pg_current_wal_insert_lsn()::text as lsn, pg_walfile_name(pg_current_wal_insert_lsn()) as file')).rows;
const raw = new Uint8Array(await (await pg.dumpDataDir('none')).arrayBuffer());
await pg.close();

/** Opens a candidate snapshot exactly like the browser does and checks the seed survived and rebases. */
async function verify(gz: Uint8Array): Promise<boolean> {
  try {
    const copy = await createPglite(undefined, { loadDataDir: new Blob([new Uint8Array(gz)], { type: 'application/x-gzip' }) });
    const cdb = wrapPglite(copy);
    const ok = (await isSeeded(cdb)) && (await rebaseSnapshot(cdb, new Date(now.getTime() + 86_400_000))) > 0;
    await copy.close();
    return ok;
  } catch (e) {
    console.warn('snapshot verify failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

const trimmed = trimWal(raw, pos!.file, pos!.lsn);
let gz = gzipSync(trimmed.tar, { level: 9 });
if (!(await verify(gz))) {
  console.warn('trimmed snapshot did not open, shipping the full dump');
  gz = gzipSync(raw, { level: 9 });
  if (!(await verify(gz))) throw new Error('demo snapshot does not open');
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);
const kb = Math.round(statSync(out).size / 1024);
const summary = res.stores.map((s) => `${s.slug} ${s.products}p`).join(', ');
console.log(`demo snapshot (WAL trimmed: ${trimmed.dropped.length} segment(s) dropped): ${summary} → public/demo/snapshot.tar.gz (${kb} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
