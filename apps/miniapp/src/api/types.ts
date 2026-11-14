/**
 * The client API surface. Both transports expose the same typed object built from the contract route table:
 *
 *   const { api } = useApi();
 *   const page = await api['store.products']({ slug, limit: 20 });   // typed input & output
 *
 * Errors are always `ApiError` (code, message, details) from @dokonim/contract.
 */
import { ApiError, type DokonimApi, type PublicRouteName } from '@dokonim/contract';

export { ApiError };
export type Api = DokonimApi;
export type ApiName = PublicRouteName;
export type ApiIn<K extends ApiName> = Parameters<Api[K]>[0];
export type ApiOut<K extends ApiName> = Awaited<ReturnType<Api[K]>>;

export type Transport = (name: ApiName, input: unknown) => Promise<unknown>;

export type BootPhase = 'booting' | 'migrating' | 'seeding' | 'ready' | 'error';

export interface BackendStatus {
  phase: BootPhase;
  /** 0..1 while seeding. */
  progress: number;
  /** False when IndexedDB is unavailable (private mode): data lives in memory only. */
  persistent: boolean;
  error?: string;
}

/** Events the in-browser backend pushes (bot chat panel, payment debugger — later screens). */
export type BackendEvent =
  | { type: 'outbox' }
  | { type: 'protocol'; storeId: string; message: unknown };

export interface ApiClient {
  kind: 'http' | 'local';
  api: Api;
  /** Resolves when the backend can serve calls (immediately for HttpApi). */
  ready: Promise<void>;
  status(): BackendStatus;
  subscribe(fn: () => void): () => void;
  onEvent(fn: (e: BackendEvent) => void): () => void;
  /** Demo only: wipe IndexedDB and re-seed. */
  resetDemo?: () => Promise<void>;
}

/** Builds the typed API object over any transport (a Proxy, so the route table is not needed client-side). */
export function makeApi(call: Transport): Api {
  return new Proxy({} as Api, {
    get: (_t, name) => (typeof name === 'string' ? (input: unknown) => call(name as ApiName, input ?? {}) : undefined),
  });
}

export interface SerializedError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  status?: number;
}

export function toApiError(e: SerializedError): ApiError {
  return new ApiError(e.code, e.message, e.details, e.status ?? 422);
}
