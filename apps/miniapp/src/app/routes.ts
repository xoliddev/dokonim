/**
 * The route table = shell routes + the two surface folders. Buyer screens live in src/store/, seller screens in
 * src/seller/; each folder exports its own array, so the two can grow in parallel without touching this file.
 */
import { lazy } from 'react';
import type { RouteDef } from '../router/router';
import { sellerRoutes } from '../seller';
import { storeRoutes } from '../store';

const Hub = lazy(() => import('../shell/Hub'));

export const shellRoutes: RouteDef[] = [{ path: '/', component: Hub, surface: 'shell' }];

export const routes: RouteDef[] = [...shellRoutes, ...storeRoutes, ...sellerRoutes];
