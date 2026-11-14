/** LocalApi (main-thread side): forwards calls to the PGlite worker and mirrors its boot status. */
import { makeApi, toApiError, type ApiClient, type BackendEvent, type BackendStatus } from '../types';
import type { FromWorker, ToWorker } from './protocol';

export function createLocalApi(): ApiClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dokonim-backend' });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let status: BackendStatus = { phase: 'booting', progress: 0, persistent: true };
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(e: BackendEvent) => void>();
  let markReady!: () => void;
  const ready = new Promise<void>((r) => (markReady = r));

  worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'result') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) return;
      if (m.ok) p.resolve(m.value);
      else p.reject(toApiError(m.error));
    } else if (m.type === 'status') {
      status = m.status;
      if (status.phase === 'ready') markReady();
      listeners.forEach((fn) => fn());
    } else {
      eventListeners.forEach((fn) => fn(m));
    }
  });
  worker.addEventListener('error', (e) => {
    status = { ...status, phase: 'error', error: e.message || 'Worker failed to start' };
    listeners.forEach((fn) => fn());
  });

  type Msg = ToWorker extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;
  const send = (msg: Msg): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id } as ToWorker);
    });

  return {
    kind: 'local',
    api: makeApi((name, input) => send({ type: 'call', name, input })),
    ready,
    status: () => status,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onEvent(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    async resetDemo() {
      await send({ type: 'reset' });
    },
  };
}
