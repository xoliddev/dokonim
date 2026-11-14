/**
 * The demo's in-browser backend (§19.4): PGlite persisted in IndexedDB, the same SQL migrations as the server,
 * the same @dokonim/db services, sandbox payment adapters and real initData HMAC auth — inside a Web Worker so
 * the UI thread never blocks on SQL.
 */
import { ApiError, ROUTES, validate, type RouteDef, type RouteName } from '@dokonim/contract';
import { DomainError, signInitData, systemClock } from '@dokonim/core';
import { createBackend, migrate, SYSTEM, type Actor, type Backend, type Database } from '@dokonim/db';
import { createPgliteDatabase } from '@dokonim/db/pglite';
import { createPaymentRegistry } from '@dokonim/payments';
import { DEMO_BOT_TOKEN, DEMO_KEK, DEMO_USER, isSeeded, seedDemo } from '@dokonim/seed';
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
let live: Promise<Live> = boot();

async function openDb(): Promise<{ db: Database; persistent: boolean }> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
    return { db: await createPgliteDatabase(`idb://${IDB_NAME}`, { relaxedDurability: true }), persistent: true };
  } catch {
    return { db: await createPgliteDatabase(), persistent: false };
  }
}

async function boot(): Promise<Live> {
  try {
    setStatus({ phase: 'booting', progress: 0, error: undefined });
    const { db, persistent } = await openDb();
    setStatus({ phase: 'migrating', persistent });
    await migrate(db);
    if (!(await isSeeded(db))) {
      setStatus({ phase: 'seeding', progress: 0 });
      await seedDemo(db, { onProgress: (_s, done, total) => setStatus({ progress: total ? done / total : 0 }) });
    }
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
  await new Promise<void>((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(IDB_PATH);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
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
