/** Main thread ⇄ worker messages for LocalApi. */
import type { ApiName, BackendStatus, SerializedError } from '../types';

export type ToWorker =
  | { type: 'call'; id: number; name: ApiName; input: unknown }
  | { type: 'reset'; id: number };

export type FromWorker =
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: SerializedError }
  | { type: 'status'; status: BackendStatus }
  | { type: 'outbox' }
  | { type: 'protocol'; storeId: string; message: unknown };

/** IndexedDB database name PGlite uses for `idb://dokonim-demo`. */
export const IDB_NAME = 'dokonim-demo';
export const IDB_PATH = `/pglite/${IDB_NAME}`;
