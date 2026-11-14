/** A minimal external store + React hook (no dependency). */
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const v = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (Object.is(v, state)) return;
      state = v;
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, select: (s: T) => S): S;
export function useStore<T, S>(store: Store<T>, select?: (s: T) => S): T | S {
  const get = () => (select ? select(store.get()) : store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Safe localStorage access (private mode, previews and sandboxed iframes can throw). */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
