/**
 * React glue for the API: <ApiProvider>, useApi(), and a tiny cached query hook.
 *
 *   const q = useQuery('store.home', { slug });            // { data, error, loading, reload }
 *   const save = useMutation('admin.products.save', { invalidates: ['admin.products', 'store.'] });
 *   await save.run(input);
 *
 * The cache is keyed by method + JSON input; `invalidate(prefix)` refetches every mounted query whose method
 * name starts with the prefix. Pass `null` as input to skip a query (e.g. while a param is unknown).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ApiClient, ApiError, ApiIn, ApiName, ApiOut, BackendStatus } from './types';

const Ctx = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

export function useApi(): ApiClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApi() outside <ApiProvider>');
  return c;
}

export function useBackendStatus(): BackendStatus {
  const c = useApi();
  return useSyncExternalStore(c.subscribe, c.status, c.status);
}

// ── query cache ─────────────────────────────────────────────────────────────
interface Entry {
  value?: unknown;
  error?: ApiError;
  promise?: Promise<unknown>;
  at: number;
  fetch: () => Promise<unknown>;
}
/** Entries are replaced (never mutated) so useSyncExternalStore sees a new snapshot on every change. */
const cache = new Map<string, Entry>();
const keySubs = new Map<string, Set<() => void>>();

function put(key: string, e: Entry) {
  cache.set(key, e);
  keySubs.get(key)?.forEach((fn) => fn());
}

function run(key: string, fetch: () => Promise<unknown>, fresh: boolean, staleMs: number) {
  const hit = cache.get(key);
  if (!fresh && hit && (hit.promise || Date.now() - hit.at < staleMs)) return;
  const promise = fetch().then(
    (value) => put(key, { value, at: Date.now(), fetch }),
    (error: ApiError) => put(key, { error, value: cache.get(key)?.value, at: Date.now(), fetch }),
  );
  put(key, { value: hit?.value, error: hit?.error, promise, at: hit?.at ?? 0, fetch });
}

/** Drops cached results for methods starting with `prefix`; mounted queries refetch immediately. */
export function invalidate(prefix = '') {
  for (const [k, e] of [...cache.entries()]) {
    if (!k.startsWith(prefix)) continue;
    if (keySubs.get(k)?.size) run(k, e.fetch, true, 0);
    else cache.delete(k);
  }
}

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => void;
}

export function useQuery<K extends ApiName>(name: K, input: ApiIn<K> | null, opts: { staleMs?: number } = {}): QueryState<ApiOut<K>> {
  const { api } = useApi();
  const key = input === null ? null : `${name}:${JSON.stringify(input ?? {})}`;
  const inputRef = useRef(input);
  inputRef.current = input;
  const staleMs = opts.staleMs ?? 30_000;

  const subscribe = useCallback(
    (fn: () => void) => {
      if (!key) return () => {};
      let set = keySubs.get(key);
      if (!set) keySubs.set(key, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    },
    [key],
  );
  const e = useSyncExternalStore(subscribe, () => (key ? cache.get(key) : undefined), () => undefined);
  const fetcher = useCallback(() => (api[name] as (i: unknown) => Promise<unknown>)(inputRef.current), [api, name]);

  useEffect(() => {
    if (key) run(key, fetcher, false, staleMs);
  }, [key, fetcher, staleMs]);

  return {
    data: e?.value as ApiOut<K> | undefined,
    error: e?.error,
    loading: !!key && (!e || !!e.promise),
    reload: () => key && run(key, fetcher, true, 0),
  };
}

export function useMutation<K extends ApiName>(name: K, opts: { invalidates?: string[] } = {}) {
  const { api } = useApi();
  const [state, setState] = useState<{ loading: boolean; error?: ApiError; data?: ApiOut<K> }>({ loading: false });
  const inv = opts.invalidates;
  const run = useCallback(
    async (input: ApiIn<K>): Promise<ApiOut<K>> => {
      setState({ loading: true });
      try {
        const data = (await (api[name] as (i: unknown) => Promise<unknown>)(input)) as ApiOut<K>;
        setState({ loading: false, data });
        (inv ?? []).forEach((p) => invalidate(p));
        return data;
      } catch (e) {
        setState({ loading: false, error: e as ApiError });
        throw e;
      }
    },
    [api, name, inv],
  );
  return { ...state, run };
}
