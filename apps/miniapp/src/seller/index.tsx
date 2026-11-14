/**
 * Owner / staff dashboard routes (§6.1, `/m/:slug/...`). OWNED BY THE SELLER-SCREENS AGENT: add screens under
 * `src/seller/` and list them here. The shell imports `sellerRoutes` and never needs to change.
 *
 * The create-store wizard lives at `/m/:slug/create-store`; from the hub (no store yet) use `/m/new/create-store`
 * — `new` is a reserved slug, so it can never collide with a real store.
 */
import { lazy } from 'react';
import type { RouteDef } from '../router/router';

const Wizard = lazy(() => import('./screens/onboarding/Wizard'));
const Dashboard = lazy(() => import('./screens/Dashboard'));
const Categories = lazy(() => import('./screens/categories/Categories'));
const Placeholder = lazy(() => import('./screens/Placeholder'));

const r = (path: string, component: RouteDef['component']): RouteDef => ({ path: `/m/:slug${path}`, component, surface: 'seller' });

export const sellerRoutes: RouteDef[] = [
  r('', Dashboard),
  r('/create-store', Wizard),
  r('/categories', Categories),
  r('/*', Placeholder),
];
