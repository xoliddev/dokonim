/**
 * A ~150-line hash router (GitHub Pages has no SPA rewrites, §19.2). Routes are plain objects:
 *
 *   export const routes: RouteDef[] = [{ path: '/s/:slug/p/:productId', component: lazy(() => import('./Product')) }];
 *
 * Patterns: static segments, `:param`, and a trailing `*` splat (`/s/:slug/c/*` → params['*'] = 'a/b').
 * Navigation keeps an index in history.state so screens know the direction (forward/back) for transitions.
 */
import { createElement, type AnchorHTMLAttributes, type ComponentType, type MouseEvent } from 'react';
import { createStore, useStore } from '../lib/store';
import { parseStartParam } from '@dokonim/core';

export interface RouteProps {
  params: Record<string, string>;
  query: URLSearchParams;
}

export interface RouteDef {
  path: string;
  component: ComponentType<RouteProps>;
  /** Which surface the screen belongs to — the shell uses it for the role switcher and chrome. */
  surface?: 'store' | 'seller' | 'shell';
  /** Hide the bottom tab bar / chrome for full-screen flows (checkout, PDP). */
  chromeless?: boolean;
}

export interface Location {
  path: string;
  query: URLSearchParams;
  idx: number;
  direction: 'forward' | 'back' | 'none';
}

function read(direction: Location['direction'] = 'none'): Location {
  const raw = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
  const [p, q = ''] = raw.startsWith('/') ? raw.split('?') : ['/', ''];
  const idx = typeof history !== 'undefined' && history.state && typeof history.state.idx === 'number' ? (history.state.idx as number) : 0;
  return { path: normalize(p ?? '/'), query: new URLSearchParams(q), idx, direction };
}

const normalize = (p: string) => '/' + p.split('/').filter(Boolean).join('/');

export const routerStore = createStore<Location>(read());

if (typeof window !== 'undefined') {
  // Telegram puts launch params in the hash; once its script has parsed them we switch to our own routes.
  if (!location.hash.startsWith('#/')) {
    history.replaceState({ idx: 0 }, '', `${location.pathname}${location.search}#${startRoute()}`);
    routerStore.set(read());
  } else if (!history.state || typeof history.state.idx !== 'number') history.replaceState({ idx: 0 }, '', location.href);
  window.addEventListener('popstate', () => {
    const prev = routerStore.get();
    const next = read();
    routerStore.set({ ...next, direction: next.idx < prev.idx ? 'back' : 'forward' });
  });
}

/** Maps the `startapp` payload (§6.1) to an initial route. */
export function startRoute(): string {
  let raw: string | null = null;
  try {
    raw = window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? new URLSearchParams(location.search).get('startapp');
  } catch {}
  const p = parseStartParam(raw);
  switch (p.kind) {
    case 'store':
      return `/s/${p.slug}${p.campaign ? `?src=${encodeURIComponent(p.campaign)}` : ''}`;
    case 'product':
      return `/s/${p.slug}/p/${p.productShortId}`;
    case 'order':
      return `/s/${p.slug}/orders/${p.orderShortId}`;
    case 'manage':
      return `/m/${p.slug}`;
    case 'new':
      return '/new';
    default:
      return '/';
  }
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const cur = routerStore.get();
  const idx = opts.replace ? cur.idx : cur.idx + 1;
  const url = `${location.pathname}${location.search}#${to.startsWith('/') ? to : `/${to}`}`;
  if (opts.replace) history.replaceState({ idx }, '', url);
  else history.pushState({ idx }, '', url);
  routerStore.set({ ...read(opts.replace ? 'none' : 'forward'), idx });
}

/** Goes back in history, or to `fallback` when this is the first screen. */
export function back(fallback = '/') {
  if (routerStore.get().idx > 0) history.back();
  else {
    navigate(fallback, { replace: true });
    routerStore.set((l) => ({ ...l, direction: 'back' }));
  }
}

export const useLocation = () => useStore(routerStore);
export const canGoBack = () => routerStore.get().idx > 0;

export interface Match {
  route: RouteDef;
  params: Record<string, string>;
}

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p === '*') {
      params['*'] = xs.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    const x = xs[i];
    if (x === undefined) return null;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(x);
    else if (p !== x) return null;
  }
  return xs.length === ps.length ? params : null;
}

/**
 * Specificity of a pattern for one concrete path: a rank per *path* segment (static 3, param 2, splat-covered 1),
 * plus whether the pattern is exact (no splat). Patterns compare lexicographically, and on a tie the exact pattern
 * wins, so `/s/:slug` beats `/s/:slug/*` for `/s/x` even though the splat matches it with an empty rest.
 */
function rank(pattern: string, path: string): { segs: number[]; exact: boolean } {
  const ps = pattern.split('/').filter(Boolean);
  const n = path.split('/').filter(Boolean).length;
  const segs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    if (p === undefined || p === '*') segs.push(1);
    else segs.push(p.startsWith(':') ? 2 : 3);
  }
  return { segs, exact: !ps.includes('*') };
}

/** > 0 when `a` is more specific than `b`. */
function compareRank(a: ReturnType<typeof rank>, b: ReturnType<typeof rank>): number {
  for (let i = 0; i < Math.max(a.segs.length, b.segs.length); i++) {
    const d = (a.segs[i] ?? 0) - (b.segs[i] ?? 0);
    if (d) return d;
  }
  return Number(a.exact) - Number(b.exact);
}

/** Best match: the most specific pattern wins (static > param > splat, exact > splat), regardless of array order. */
export function matchRoute(routes: RouteDef[], path: string): Match | null {
  let best: Match | null = null;
  let bestRank: ReturnType<typeof rank> | null = null;
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (!params) continue;
    const r = rank(route.path, path);
    if (!bestRank || compareRank(r, bestRank) > 0) {
      best = { route, params };
      bestRank = r;
    }
  }
  return best;
}

export function Link({ to, replace, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean }) {
  return createElement('a', {
    ...rest,
    href: `#${to}`,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to, { replace });
    },
  });
}
