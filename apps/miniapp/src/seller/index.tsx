/**
 * Owner / staff dashboard routes (§6.1, `/m/:slug/...`). OWNED BY THE SELLER-SCREENS AGENT: add screens under
 * `src/seller/` and list them here. The shell imports `sellerRoutes` and never needs to change.
 */
import { lazy } from 'react';
import type { RouteDef } from '../router/router';

const Placeholder = lazy(() => import('./screens/Placeholder'));

export const sellerRoutes: RouteDef[] = [
  { path: '/m/:slug', component: Placeholder, surface: 'seller' },
  { path: '/m/:slug/*', component: Placeholder, surface: 'seller' },
];
