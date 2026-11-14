/**
 * HttpApi: talks to apps/api. Logs in with Telegram initData (POST /v1/auth/telegram), keeps the JWT pair in
 * memory (refresh token in sessionStorage), retries once after a refresh on 401, and builds every request from
 * the shared contract route table so the URL/verb/body split always matches the server.
 */
import { buildRequest, type RouteName } from '@dokonim/contract';
import { toApiError, makeApi, type ApiClient, type ApiName, type BackendStatus, type SerializedError } from './types';

const REFRESH_KEY = 'dokonim.refresh';

export function createHttpApi(baseUrl: string, getInitData: () => string): ApiClient {
  let access: string | null = null;
  let loginP: Promise<void> | null = null;

  const store = {
    get: () => {
      try {
        return sessionStorage.getItem(REFRESH_KEY);
      } catch {
        return null;
      }
    },
    set: (v: string | null) => {
      try {
        if (v) sessionStorage.setItem(REFRESH_KEY, v);
        else sessionStorage.removeItem(REFRESH_KEY);
      } catch {}
    },
  };

  async function post(path: string, body: unknown) {
    const res = await fetch(baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw toApiError({ code: String(json.code ?? 'UNAUTHENTICATED'), message: String(json.message ?? res.statusText), details: json.details as Record<string, unknown>, status: res.status });
    return json as { accessToken: string; refreshToken: string };
  }

  async function authenticate(): Promise<void> {
    const refresh = store.get();
    if (refresh) {
      try {
        const t = await post('/v1/auth/refresh', { refreshToken: refresh });
        access = t.accessToken;
        store.set(t.refreshToken);
        return;
      } catch {
        store.set(null);
      }
    }
    const initData = getInitData();
    if (!initData) return; // anonymous: public routes still work
    const t = await post('/v1/auth/telegram', { initData });
    access = t.accessToken;
    store.set(t.refreshToken);
  }

  // A failed login degrades to anonymous (public routes still work); the next call tries again.
  const ensureAuth = () =>
    (loginP ??= authenticate().catch(() => {
      loginP = null;
    }));

  async function call(name: ApiName, input: unknown, retried = false): Promise<unknown> {
    await ensureAuth();
    const r = buildRequest(name as RouteName, (input ?? {}) as Record<string, unknown>);
    const res = await fetch(baseUrl + r.url, {
      method: r.verb,
      headers: { ...r.headers, ...(access ? { authorization: `Bearer ${access}` } : {}) },
      body: r.body === undefined ? undefined : JSON.stringify(r.body),
    });
    if (res.status === 401 && !retried) {
      access = null;
      loginP = null;
      return call(name, input, true);
    }
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const e = (json ?? {}) as Partial<SerializedError>;
      throw toApiError({ code: e.code ?? 'INTERNAL', message: e.message ?? res.statusText, details: e.details, status: res.status });
    }
    return json;
  }

  const status: BackendStatus = { phase: 'ready', progress: 1, persistent: true };
  return {
    kind: 'http',
    api: makeApi((n, i) => call(n, i)),
    ready: Promise.resolve(),
    status: () => status,
    subscribe: () => () => {},
    onEvent: () => () => {},
  };
}
