/**
 * Rate limits (§16.5) on top of @fastify/rate-limit.
 *
 * The plugin gives every route with its own `config.rateLimit` a separate child store, which would make "checkout
 * 20/min per user" a per-route budget. `SharedStore.child()` returns the same store instead, and every key is
 * namespaced by its group (`checkout:u:<userId>`), so a group's budget is shared by all routes in it:
 *
 *   auth      10/min per IP        POST /v1/auth/telegram, /v1/auth/refresh
 *   checkout  20/min per user      routes marked rateLimit:'checkout' in the contract
 *   search    60/min per user/IP   routes marked rateLimit:'search'
 *   webhook  300/min per store+IP  /hooks/:provider/:storeId… (×10 for /hooks/telegram; a correct secret is never limited)
 *   default  300/min per user/IP   everything else
 *
 * In-memory fixed window (single API instance). Behind a load balancer swap in a Redis store.
 */
import type { FastifyRequest } from 'fastify';

export type LimitGroup = 'auth' | 'checkout' | 'search' | 'webhook' | 'default';

export const DEFAULT_LIMITS: Record<LimitGroup, number> = { auth: 10, checkout: 20, search: 60, webhook: 300, default: 300 };
export const WINDOW_MS = 60_000;

type Cb = (err: Error | null, res: { current: number; ttl: number }) => void;

export class SharedStore {
  private readonly m = new Map<string, { n: number; start: number }>();
  private ops = 0;

  incr(key: string, cb: Cb, timeWindow: number): void {
    const now = Date.now();
    if (++this.ops % 1000 === 0) this.sweep(now, timeWindow);
    let e = this.m.get(key);
    if (!e || e.start + timeWindow <= now) {
      e = { n: 0, start: now };
      this.m.set(key, e);
    }
    e.n++;
    cb(null, { current: e.n, ttl: e.start + timeWindow - now });
  }

  read(key: string, cb: Cb, timeWindow: number): void {
    const now = Date.now();
    const e = this.m.get(key);
    if (!e || e.start + timeWindow <= now) cb(null, { current: 0, ttl: 0 });
    else cb(null, { current: e.n, ttl: e.start + timeWindow - now });
  }

  child(): SharedStore {
    return this;
  }

  private sweep(now: number, timeWindow: number): void {
    for (const [k, e] of this.m) if (e.start + timeWindow <= now) this.m.delete(k);
  }
}

/** Set by the auth hook (runs before the rate-limit hooks), so per-user keys use the verified subject only. */
export function userOrIp(req: FastifyRequest): string {
  const uid = req.actor?.userId;
  return uid ? `u:${uid}` : `ip:${req.ip}`;
}

export function keyFor(group: LimitGroup): (req: FastifyRequest) => string {
  switch (group) {
    case 'auth':
      return (req) => `auth:ip:${req.ip}`;
    case 'webhook':
      return (req) => {
        const p = req.params as Record<string, string | undefined>;
        // per source IP too: store ids are public, so a shared bucket would let anyone starve the real provider callbacks
        return `webhook:${p.storeId ?? 'telegram'}:ip:${req.ip}`;
      };
    default:
      return (req) => `${group}:${userOrIp(req)}`;
  }
}

export function routeLimit(group: LimitGroup, limits: Record<LimitGroup, number>) {
  return { max: limits[group], timeWindow: WINDOW_MS, keyGenerator: keyFor(group) };
}
