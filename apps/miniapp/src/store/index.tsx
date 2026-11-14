/**
 * Buyer storefront routes (§6.1, `/s/:slug/...`). OWNED BY THE BUYER-SCREENS AGENT: add screens under
 * `src/store/` and list them here. The shell imports `storeRoutes` and never needs to change.
 */
import { lazy } from 'react';
import type { RouteDef } from '../router/router';

const Home = lazy(() => import('./screens/Home'));
const Catalog = lazy(() => import('./screens/Catalog'));
const Category = lazy(() => import('./screens/Category'));
const Collection = lazy(() => import('./screens/Collection'));
const Search = lazy(() => import('./screens/Search'));

const r = (path: string, component: RouteDef['component'], chromeless?: boolean): RouteDef => ({ path: `/s/:slug${path}`, component, surface: 'store', chromeless });

export const storeRoutes: RouteDef[] = [
  r('', Home),
  r('/catalog', Catalog),
  r('/c/*', Category),
  r('/collection/:collectionSlug', Collection),
  r('/search', Search),
];
