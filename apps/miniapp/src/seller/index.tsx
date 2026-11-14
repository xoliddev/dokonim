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
const Products = lazy(() => import('./screens/products/Products'));
const ProductEditor = lazy(() => import('./screens/products/ProductEditor'));
const Orders = lazy(() => import('./screens/orders/Orders'));
const OrderDetail = lazy(() => import('./screens/orders/OrderDetail'));
const More = lazy(() => import('./screens/More'));
const Promos = lazy(() => import('./screens/promos/Promos'));
const Collections = lazy(() => import('./screens/collections/Collections'));
const ThemeEditor = lazy(() => import('./screens/settings/ThemeEditor'));
const Payments = lazy(() => import('./screens/settings/Payments'));
const Shipping = lazy(() => import('./screens/settings/Shipping'));
const StoreSettings = lazy(() => import('./screens/settings/StoreSettings'));
const Staff = lazy(() => import('./screens/settings/Staff'));
const NotFound = lazy(() => import('./screens/NotFound'));

const r = (path: string, component: RouteDef['component']): RouteDef => ({ path: `/m/:slug${path}`, component, surface: 'seller' });

export const sellerRoutes: RouteDef[] = [
  r('', Dashboard),
  r('/create-store', Wizard),
  r('/categories', Categories),
  r('/products', Products),
  r('/products/new', ProductEditor),
  r('/products/:id', ProductEditor),
  r('/orders', Orders),
  r('/orders/:id', OrderDetail),
  r('/more', More),
  r('/promos', Promos),
  r('/collections', Collections),
  r('/settings', More),
  r('/settings/theme', ThemeEditor),
  r('/settings/payments', Payments),
  r('/settings/shipping', Shipping),
  r('/settings/store', StoreSettings),
  r('/settings/staff', Staff),
  // last resort: the router ranks exact matches above a splat, so this never shadows `/m/:slug` itself
  r('/*', NotFound),
];
