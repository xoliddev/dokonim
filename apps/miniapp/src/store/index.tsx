/**
 * Buyer storefront routes (§6.1, `/s/:slug/...`). OWNED BY THE BUYER-SCREENS AGENT: add screens under
 * `src/store/` and list them here. The shell imports `storeRoutes` and never needs to change.
 */
import { lazy } from 'react';
import type { RouteDef } from '../router/router';

const Placeholder = lazy(() => import('./screens/Placeholder'));

export const storeRoutes: RouteDef[] = [
  { path: '/s/:slug', component: Placeholder, surface: 'store' },
  { path: '/s/:slug/*', component: Placeholder, surface: 'store' },
];
