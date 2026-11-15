/**
 * The demo's in-browser backend (§19.4): PGlite persisted in IndexedDB, the same SQL migrations as the server,
 * the same @dokonim/db services, sandbox payment adapters and real initData HMAC auth — inside a Web Worker so
 * the UI thread never blocks on SQL.
 */
import { ApiError, ROUTES, validate, type RouteDef, type RouteName } from '@dokonim/contract';
import { DomainError, signInitData, systemClock } from '@dokonim/core';
import { createBackend, migrate, SYSTEM, type Actor, type Backend, type Database } from '@dokonim/db';
import { createPglite, createPgliteDatabase, wrapPglite } from '@dokonim/db/pglite';
import { createPaymentRegistry } from '@dokonim/payments';
import { DEMO_BOT_TOKEN, DEMO_KEK, DEMO_USER, isSeeded, rebaseSnapshot, seedDemo } from '@dokonim/seed';
import type { BackendStatus, SerializedError } from '../types';
import { IDB_NAME, IDB_PATH, type FromWorker, type ToWorker } from './protocol';

interface WorkerScope {
  postMessage(m: FromWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<ToWorker>) => void): void;
}
const scope = self as unknown as WorkerScope;
const post = (m: FromWorker) => scope.postMessage(m);

let status: BackendStatus = { phase: 'booting', progress: 0, persistent: true };
const setStatus = (s: Partial<BackendStatus>) => {
  status = { ...status, ...s };
  post({ type: 'status', status });
};

interface Live {
  db: Database;
  backend: Backend;
  actor: Actor;
  timer: ReturnType<typeof setInterval>;
}
/**
 * Deletes the persisted store. A `blocked` delete is not done: opening the database again would queue behind it
 * and hang, so we report `waiting` (another tab still has it open) and finish once that connection goes away.
 */
const deleteIdb = () =>
  new Promise<void>((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(IDB_PATH);
      let blocked = false;
      r.onsuccess = r.onerror = () => {
        if (blocked) setStatus({ phase: 'booting' });
        resolve();
      };
      r.onblocked = () => {
        blocked = true;
        setStatus({ phase: 'waiting' });
      };
    } catch {
      resolve();
    }
  });

/**
 * One tab at a time owns the persisted database: PGlite's IDBFS keeps a full copy in memory and syncs files back
 * newest-wins, so two tabs writing the same idb:// store mix two cluster states. Resolves once this tab holds the
 * lock, which it keeps until the tab (and so this worker) goes away; meanwhile the status says `waiting`.
 */
function ownDatabase(): Promise<void> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) return Promise.resolve();
  return new Promise<void>((owned) => {
    const hold = () => {
      owned();
      return new Promise<never>(() => {});
    };
    locks
      .request('dokonim-demo-db', { ifAvailable: true }, (lock) => {
        if (lock) return hold();
        setStatus({ phase: 'waiting' });
        return locks.request('dokonim-demo-db', hold);
      })
      .catch(() => owned());
  });
}
const owner = ownDatabase();

/** False only when the browser can list databases and ours is not there (first visit). */
async function idbMayExist(): Promise<boolean> {
  try {
    const list = await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }).databases?.();
    return list ? list.some((d) => d.name === IDB_PATH) : true;
  } catch {
    return true;
  }
}

/**
 * The pre-baked snapshot (`scripts/bake-demo.ts`): the three demo stores seeded at build time, as a gzipped PGlite
 * data directory. Null when it is missing (plain `vite` dev without a bake) so we fall back to seeding in place.
 */
async function fetchSnapshot(): Promise<Blob | null> {
  try {
    const res = await fetch(new URL(`${import.meta.env.BASE_URL}demo/snapshot.tar.gz`, self.location.origin));
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // a server that sets Content-Encoding hands us the tar already inflated: label it by its magic bytes
    const gzip = buf[0] === 0x1f && buf[1] === 0x8b;
    return buf.length > 1024 ? new Blob([buf], { type: gzip ? 'application/x-gzip' : 'application/x-tar' }) : null;
  } catch {
    return null;
  }
}

/** Seeds in an in-memory PGlite and dumps it: the slow path, only when the snapshot is unavailable. */
async function seedToTar(): Promise<Blob> {
  setStatus({ phase: 'seeding', progress: 0 });
  const mem = await createPglite();
  const memDb = wrapPglite(mem);
  await migrate(memDb);
  await seedDemo(memDb, { onProgress: (_s, done, total) => setStatus({ progress: total ? (done / total) * 0.95 : 0 }) });
  const tar = await mem.dumpDataDir('none');
  await mem.close();
  return tar;
}

/** Shifts a fresh snapshot's dates to now and applies migrations added after it was baked. */
async function prepare(db: Database) {
  setStatus({ phase: 'migrating' });
  await rebaseSnapshot(db, new Date());
  await migrate(db);
}

/**
 * Opens the persisted database. First visit (and Reset demo): download the snapshot and load it straight into
 * `idb://`; reloads open IndexedDB as is. Without IndexedDB (private mode) the snapshot is loaded into memory.
 */
async function openDb(): Promise<{ db: Database; persistent: boolean }> {
  let idb: Database | null = null;
  let existing = false; // a seeded store from an earlier visit was opened
  const snapshot = fetchSnapshot();
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    // Opening an empty idb:// store runs initdb and syncs a whole fresh cluster to IndexedDB — skip it on first run.
    if (await idbMayExist()) {
      idb = await createPgliteDatabase(`idb://${IDB_NAME}`);
      if (await isSeeded(idb)) {
        existing = true;
        setStatus({ phase: 'migrating', persistent: true });
        await migrate(idb); // applies only migrations added since the visitor's last visit
        return { db: idb, persistent: true };
      }
      await idb.close();
      idb = null;
    }
    setStatus({ phase: 'booting', progress: 0.3 });
    const tar = (await snapshot) ?? (await seedToTar());
    await deleteIdb();
    setStatus({ progress: 0.6 });
    idb = wrapPglite(await createPglite(`idb://${IDB_NAME}`, { loadDataDir: tar }));
    await prepare(idb);
    return { db: idb, persistent: true };
  } catch (e) {
    await idb?.close().catch(() => {});
    // The visitor's own store opened but failed later (a migration, quota…): falling back to a fresh in-memory
    // demo would hide their data behind a "private mode" label, so surface the error (Boot screen offers a reset).
    if (existing) throw e;
    console.warn('[demo] persistent database unavailable, running in memory:', e);
    // Private mode / no IndexedDB: everything lives in memory and the label says it won't persist.
    const tar = await snapshot;
    const db = tar ? wrapPglite(await createPglite(undefined, { loadDataDir: tar })) : await createPgliteDatabase();
    setStatus({ phase: 'migrating', persistent: false });
    if (tar) await prepare(db);
    else {
      await migrate(db);
      if (!(await isSeeded(db))) await seedDemo(db);
    }
    return { db, persistent: false };
  }
}

async function boot(): Promise<Live> {
  try {
    setStatus({ phase: 'booting', progress: 0, error: undefined });
    await owner;
    setStatus({ phase: 'booting' });
    const { db, persistent } = await openDb();
    setStatus({ persistent });
    const backend = createBackend({
      db,
      clock: systemClock,
      kek: DEMO_KEK,
      payments: createPaymentRegistry({}),
      links: { miniAppBase: 'https://t.me/dokonim_demo_bot/shop', webhookBase: 'https://demo.dokonim.local' },
      onOutbox: () => post({ type: 'outbox' }),
      onProtocolMessage: (storeId, message) => post({ type: 'protocol', storeId, message: JSON.parse(JSON.stringify(message)) }),
    });
    // Real auth path: initData is HMAC-signed with the demo bot token and verified by core.validateInitData.
    const initData = await signInitData({ user: DEMO_USER, authDate: new Date() }, DEMO_BOT_TOKEN);
    const { actor } = await backend.login(initData, DEMO_BOT_TOKEN);
    // Job runner: reservation TTL and auto-complete, as the server's workers do.
    const timer = setInterval(() => {
      void backend.methods['jobs.expireReservations'](SYSTEM, {}).catch(() => {});
      void backend.methods['jobs.autoComplete'](SYSTEM, {}).catch(() => {});
    }, 60_000);
    setStatus({ phase: 'ready', progress: 1 });
    return { db, backend, actor, timer };
  } catch (e) {
    setStatus({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

let live: Promise<Live> = boot();

function serialize(e: unknown): SerializedError {
  if (e instanceof ApiError) return { code: e.code, message: e.message, details: e.details, status: e.status };
  if (e instanceof DomainError) return { code: e.code, message: e.message, details: e.details };
  return { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e), status: 500 };
}

async function call(name: RouteName, input: unknown): Promise<unknown> {
  const def = (ROUTES as Record<string, RouteDef>)[name];
  if (!def || def.auth === 'internal') throw new ApiError('NOT_FOUND', `Unknown method ${name}`, {}, 404);
  const { backend, actor } = await live;
  const fn = backend.methods[name] as (a: Actor, i: unknown) => Promise<unknown>;
  const out = await fn(actor, validate(name, input));
  return out === undefined ? { ok: true } : out;
}

async function reset() {
  const l = await live.catch(() => null);
  if (l) {
    clearInterval(l.timer);
    await l.db.close().catch(() => {});
  }
  await deleteIdb();
  live = boot();
  await live;
}

scope.addEventListener('message', (e) => {
  const m = e.data;
  const run = m.type === 'call' ? call(m.name as RouteName, m.input) : reset().then(() => ({ ok: true }));
  run.then(
    (value) => post({ type: 'result', id: m.id, ok: true, value }),
    (err) => post({ type: 'result', id: m.id, ok: false, error: serialize(err) }),
  );
});

post({ type: 'status', status });
