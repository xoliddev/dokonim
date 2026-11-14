/**
 * @dokonim/db — schema, migrations and the application services ("backend") shared by the
 * Fastify API (node-postgres) and the GitHub Pages demo (PGlite in a Web Worker).
 */
import { validateInitData, type TelegramUser } from '@dokonim/core';
import { catalogService } from './services/catalog';
import { commerceService } from './services/commerce';
import { Ctx, type Actor, type BackendDeps } from './services/ctx';
import { insightsService } from './services/insights';
import { actorFor, manageService, upsertTelegramUser, type UserRow } from './services/manage';
import { socialService } from './services/social';
import { storefrontService } from './services/storefront';

export * from './client';
export type { Actor, BackendDeps, StoreRow, StoreSettings } from './services/ctx';
export { ANON, SYSTEM } from './services/ctx';
export type { UserRow, CreateStoreInput } from './services/manage';
export type { ProductInput, CategoryNode, CategoryRow } from './services/catalog';
export type { ProductCard, ListingQuery, SortKey } from './services/storefront';
export type { CartView, PlaceOrderInput } from './services/commerce';
export type { ShippingOption } from './services/pricing-data';
export { sqlLedger } from './services/commerce';
export { createSimpleProduct } from './services/manage';
export { refreshProduct } from './services/catalog';
export { Ctx };

export function createBackend(deps: BackendDeps) {
  const ctx = new Ctx(deps);
  const methods = {
    ...manageService(ctx),
    ...storefrontService(ctx),
    ...catalogService(ctx),
    ...commerceService(ctx),
    ...socialService(ctx),
    ...insightsService(ctx),
  };
  return {
    ctx,
    methods,
    /** Validates Telegram initData (real HMAC) and upserts the user. */
    async login(initData: string, botToken: string, opts: { maxAgeSec?: number } = {}): Promise<{ user: UserRow; actor: Actor; startParam?: string }> {
      const v = await validateInitData(initData, botToken, { now: deps.clock.now(), maxAgeSec: opts.maxAgeSec });
      const user = await upsertTelegramUser(ctx, v.user);
      return { user, actor: actorFor(user), startParam: v.startParam };
    },
    async upsertUser(u: TelegramUser): Promise<{ user: UserRow; actor: Actor }> {
      const user = await upsertTelegramUser(ctx, u);
      return { user, actor: actorFor(user) };
    },
    actorFor,
  };
}

export type Backend = ReturnType<typeof createBackend>;
export type Methods = Backend['methods'];
export type MethodName = keyof Methods;
export type MethodInput<K extends MethodName> = Parameters<Methods[K]>[1];
export type MethodOutput<K extends MethodName> = Awaited<ReturnType<Methods[K]>>;
