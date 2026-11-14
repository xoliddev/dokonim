import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { arcKeyframes, arcPath } from '../src/motion/arc';
import { detectTier, minTier } from '../src/motion/tier';
import { matchPath, matchRoute, navigate, routerStore, type RouteDef } from '../src/router/router';
import { makeApi } from '../src/api/types';
import { useMainButton, useBackButton, shimStore } from '../src/telegram/shim';
import { surfaceOf } from '../src/shell/session';
import { Odometer } from '../src/motion/Odometer';
import { sellerRoutes } from '../src/seller';
import { storeRoutes } from '../src/store';

afterEach(cleanup);
const C = () => null;

describe('router', () => {
  it('matches params and splats', () => {
    expect(matchPath('/s/:slug/p/:id', '/s/atlas/p/42')).toEqual({ slug: 'atlas', id: '42' });
    expect(matchPath('/s/:slug/c/*', '/s/atlas/c/kiyim/ayollar')).toEqual({ slug: 'atlas', '*': 'kiyim/ayollar' });
    expect(matchPath('/s/:slug', '/s/atlas/cart')).toBeNull();
    expect(matchPath('/s/:slug', '/s/o%CA%BBzbek')).toEqual({ slug: 'oʻzbek' });
  });

  it('prefers the most specific route regardless of order', () => {
    const routes: RouteDef[] = [
      { path: '/s/:slug/*', component: C },
      { path: '/s/:slug/cart', component: C },
      { path: '/s/:slug/:page', component: C },
    ];
    expect(matchRoute(routes, '/s/a/cart')?.route.path).toBe('/s/:slug/cart');
    expect(matchRoute(routes, '/s/a/wishlist')?.route.path).toBe('/s/:slug/:page');
    expect(matchRoute(routes, '/s/a/c/x/y')?.route.path).toBe('/s/:slug/*');
    expect(matchRoute(routes, '/m/a')).toBeNull();
  });

  it('ranks an exact match above a splat that also matches with an empty rest', () => {
    const routes: RouteDef[] = [
      { path: '/s/:slug/*', component: C },
      { path: '/s/:slug', component: C },
      { path: '/s/:slug/c/*', component: C },
      { path: '/s/:slug/:page', component: C },
    ];
    expect(matchRoute(routes, '/s/a')?.route.path).toBe('/s/:slug');
    expect(matchRoute(routes, '/s/a/c')?.route.path).toBe('/s/:slug/c/*');
    expect(matchRoute(routes, '/s/a/c/x/y')?.route.path).toBe('/s/:slug/c/*');
    expect(matchRoute(routes, '/s/a/x/y')?.route.path).toBe('/s/:slug/*');
    expect(matchRoute([...routes].reverse(), '/s/a')?.route.path).toBe('/s/:slug');
  });

  it('real route tables: home screens are not shadowed by the not-found splats', () => {
    expect(matchRoute(storeRoutes, '/s/atlas-adras')?.route.path).toBe('/s/:slug');
    expect(matchRoute(storeRoutes, '/s/atlas-adras/c/a/b/c')?.route.path).toBe('/s/:slug/c/*');
    expect(matchRoute(storeRoutes, '/s/atlas-adras/p/42')?.route.path).toBe('/s/:slug/p/:productId');
    expect(matchRoute(storeRoutes, '/s/atlas-adras/nope/deep')?.route.path).toBe('/s/:slug/*');
    expect(matchRoute(sellerRoutes, '/m/atlas-adras')?.route.path).toBe('/m/:slug');
    expect(matchRoute(sellerRoutes, '/m/atlas-adras/products/new')?.route.path).toBe('/m/:slug/products/new');
    expect(matchRoute(sellerRoutes, '/m/atlas-adras/a/b/c/d')?.route.path).toBe('/m/:slug/*');
  });

  it('navigate updates the hash, index and direction', () => {
    navigate('/s/atlas');
    navigate('/s/atlas/cart');
    const loc = routerStore.get();
    expect(location.hash).toBe('#/s/atlas/cart');
    expect(loc.path).toBe('/s/atlas/cart');
    expect(loc.direction).toBe('forward');
    expect(loc.idx).toBeGreaterThanOrEqual(2);
  });

  it('surface folders own their prefixes', () => {
    expect(storeRoutes.length).toBeGreaterThan(0);
    expect(sellerRoutes.length).toBeGreaterThan(0);
    expect(storeRoutes.every((r) => r.path.startsWith('/s/:slug') && r.surface === 'store')).toBe(true);
    expect(sellerRoutes.every((r) => r.path.startsWith('/m/:slug') && r.surface === 'seller')).toBe(true);
    expect(surfaceOf('/m/texno-bozor/orders/1')).toEqual({ role: 'seller', slug: 'texno-bozor' });
    expect(surfaceOf('/')).toEqual({ role: null, slug: null });
  });
});

describe('The Arc', () => {
  it('is a parabola from start to end whose apex is 120px above the higher point', () => {
    const from = { x: 100, y: 500 };
    const to = { x: 330, y: 760 };
    const pts = arcPath(from, to, 64);
    expect(pts[0]).toEqual(from);
    expect(pts.at(-1)!.x).toBeCloseTo(to.x);
    expect(pts.at(-1)!.y).toBeCloseTo(to.y);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(380, 0);
    const dx = pts.slice(1).map((p, i) => p.x - pts[i]!.x);
    expect(Math.max(...dx) - Math.min(...dx)).toBeLessThan(1e-9); // constant horizontal velocity
  });

  it('pre-samples 16 WAAPI keyframes, scaling 1 → 0.32 and rotating −14° → 0°', () => {
    const k = arcKeyframes({ x: 0, y: 0 }, { x: 200, y: 50 });
    expect(k).toHaveLength(16);
    expect(k[0]!.transform).toContain('scale(1.000) rotate(-14.0deg)');
    expect(k.at(-1)!.transform).toContain('scale(0.320) rotate(0.0deg)');
    expect(k.at(-1)!.offset).toBe(1);
  });
});

describe('motion tiers', () => {
  it('reads the Telegram Android performance class first', () => {
    const ua = (cls: string) => `Mozilla/5.0 (Linux; Android 13) Telegram-Android/11.2.3 (Samsung SM-A515F; Android 13; SDK 33; ${cls})`;
    expect(detectTier({ userAgent: ua('LOW'), hardwareConcurrency: 8 }, false)).toBe('minimal');
    expect(detectTier({ userAgent: ua('AVERAGE') }, false)).toBe('lite');
    expect(detectTier({ userAgent: ua('HIGH'), deviceMemory: 2 }, false)).toBe('full');
  });
  it('falls back to device signals; reduced motion and Data Saver win', () => {
    expect(detectTier({ userAgent: 'Mozilla/5.0 (Linux; Android 12; Mobile)', hardwareConcurrency: 4 }, false)).toBe('lite');
    expect(detectTier({ userAgent: 'Mozilla/5.0 (iPhone)' }, false)).toBe('full');
    expect(detectTier({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', deviceMemory: 2 }, false)).toBe('lite');
    expect(detectTier({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, true)).toBe('minimal');
    expect(detectTier({ userAgent: 'x', connection: { saveData: true } }, false)).toBe('minimal');
    expect(minTier('full', 'lite')).toBe('lite');
  });
});

describe('API proxy', () => {
  it('routes every method name to the transport with a default input', async () => {
    const call = vi.fn(async (name: string, input: unknown) => ({ name, input }));
    const api = makeApi(call as never);
    await expect(api['store.get']({ slug: 'atlas-adras' })).resolves.toEqual({ name: 'store.get', input: { slug: 'atlas-adras' } });
    await api['me.get'](undefined as never);
    expect(call).toHaveBeenLastCalledWith('me.get', {});
  });
});

describe('Telegram shim', () => {
  function Screen({ text, back }: { text: string; back?: () => void }) {
    useMainButton({ text, onClick: () => {} });
    useBackButton(back ?? null);
    return null;
  }

  it('MainButton / BackButton are stacks: the latest mounted owner wins, unmount hands back', () => {
    const outer = render(<Screen text="Savatga qoʻshish" back={() => {}} />);
    expect(shimStore.get().main?.text).toBe('Savatga qoʻshish');
    expect(shimStore.get().back).toBeTypeOf('function');
    const inner = render(<Screen text="Qoʻllash" />);
    expect(shimStore.get().main?.text).toBe('Qoʻllash');
    act(() => inner.unmount());
    expect(shimStore.get().main?.text).toBe('Savatga qoʻshish');
    act(() => outer.unmount());
    expect(shimStore.get().main).toBeNull();
    expect(shimStore.get().back).toBeNull();
  });
});

describe('Odometer', () => {
  it('renders one rolling slot per digit and keeps the accessible label', () => {
    render(<Odometer value="412 000 so‘m/oy" />);
    const el = screen.getByRole('text');
    expect(el.getAttribute('aria-label')).toBe('412 000 so‘m/oy');
    expect(el.querySelectorAll('.odo-slot')).toHaveLength(6);
  });
});

describe('UI money', () => {
  it('uses a regular no-break space on screen, never U+202F', async () => {
    const { uiI18n } = await import('../src/i18n');
    for (const lc of ['uz', 'ru', 'en'] as const) {
      const i = uiI18n(lc);
      const s = i.money(390_000_000);
      expect(s).not.toMatch(/ /);
      expect(s).toMatch(/ /);
      expect(i.t('store.perMonth', { amount: s })).not.toMatch(/ /);
      expect(i.number(1_250_000)).not.toMatch(/ /);
    }
  });
});
