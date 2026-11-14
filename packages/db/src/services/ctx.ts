/**
 * Application-service context: the shared plumbing every service module uses
 * (tenant-scoped transactions, permission checks, audit log, transactional outbox).
 */
import {
  can, diff, DomainError, requirePermission, uuidv7, type Clock, type Locale, type NotificationPayload, type OutboxMessage,
  type Permission, type Recipient, type Role, type ProviderId,
} from '@dokonim/core';
import type { createPaymentRegistry, ProtocolMessage } from '@dokonim/payments';
import { inScope, json, type Database, type Sql } from '../client';

export interface Actor {
  userId: string | null;
  telegramId: number | null;
  isPlatformAdmin: boolean;
  locale: Locale;
  name?: string;
}

export const SYSTEM: Actor = { userId: null, telegramId: null, isPlatformAdmin: false, locale: 'uz', name: 'system' };
export const ANON: Actor = { userId: null, telegramId: null, isPlatformAdmin: false, locale: 'uz' };

export type PaymentRegistry = ReturnType<typeof createPaymentRegistry>;

export interface BackendDeps {
  db: Database;
  clock: Clock;
  /** 64-hex key-encryption key for provider credentials. */
  kek: string;
  payments: PaymentRegistry;
  links: { miniAppBase: string; webhookBase: string };
  reservationTtlMs?: number;
  codReservationTtlMs?: number;
  returnWindowDays?: number;
  /** Called after a transaction that wrote outbox rows commits (nudges the deliverer / demo bot chat). */
  onOutbox?: () => void;
  /** Sandbox protocol messages for the payment debugger. */
  onProtocolMessage?: (storeId: string, m: ProtocolMessage) => void;
}

export interface StoreRow {
  id: string;
  slug: string;
  name: Record<string, string>;
  tagline: Record<string, string>;
  status: 'draft' | 'active' | 'suspended' | 'closed';
  ownerUserId: string;
  businessType: string;
  defaultLocale: Locale;
  locales: Locale[];
  currency: 'UZS';
  timezone: string;
  plan: string;
  planFlags: { productLimit: number; removeBadge: boolean; customBot: boolean };
  logoUrl: string | null;
  settings: StoreSettings;
  installments: Array<{ months: number; markupPercent: number }>;
  publishedThemeId: string | null;
  createdAt: string;
  suspendedReason: string | null;
}

export interface StoreSettings {
  contacts?: { phone?: string; telegram?: string; instagram?: string; address?: string; mapUrl?: string };
  hours?: string;
  policies?: { returns?: Record<string, string>; delivery?: Record<string, string>; privacy?: Record<string, string> };
  autoConfirmPaid?: boolean;
  notifications?: { newOrder?: boolean; payment?: boolean; lowStock?: boolean; reviews?: boolean; dailySummaryAt?: string };
  legal?: { companyName?: string; inn?: string };
}

export interface Member {
  role: Role;
  store: StoreRow;
}

export class Ctx {
  readonly db: Database;
  readonly deps: BackendDeps;
  private pendingOutbox = false;

  constructor(deps: BackendDeps) {
    this.db = deps.db;
    this.deps = deps;
  }

  now(): Date {
    return this.deps.clock.now();
  }

  /** Tenant-scoped transaction. */
  async tx<T>(storeId: string | null, actor: Actor, fn: (tx: Sql) => Promise<T>): Promise<T> {
    const out = await inScope(this.db, { storeId, userId: actor.userId }, fn);
    if (this.pendingOutbox) {
      this.pendingOutbox = false;
      this.deps.onOutbox?.();
    }
    return out;
  }

  async storeBySlug(tx: Sql, slug: string, opts: { allowSuspended?: boolean } = {}): Promise<StoreRow> {
    const [s] = await tx.query<StoreRow>('select * from stores where lower(slug) = lower($1)', [slug]);
    if (!s || s.status === 'closed') throw new DomainError('NOT_FOUND', 'Store not found', { slug });
    if (s.status === 'suspended' && !opts.allowSuspended) throw new DomainError('STORE_SUSPENDED');
    return s;
  }

  async storeById(tx: Sql, id: string): Promise<StoreRow> {
    const [s] = await tx.query<StoreRow>('select * from stores where id = $1', [id]);
    if (!s) throw new DomainError('NOT_FOUND', 'Store not found');
    return s;
  }

  /** Public storefront access: resolve the store by slug, then run inside its tenant scope. */
  async storefront<T>(slug: string, actor: Actor, fn: (tx: Sql, store: StoreRow) => Promise<T>): Promise<T> {
    const store = await this.tx(null, actor, (tx) => this.storeBySlug(tx, slug));
    return this.tx(store.id, actor, (tx) => fn(tx, store));
  }

  /** Buyer access: like storefront, but requires a signed-in user. */
  async buyer<T>(slug: string, actor: Actor, fn: (tx: Sql, store: StoreRow, userId: string) => Promise<T>): Promise<T> {
    if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
    const uid = actor.userId;
    return this.storefront(slug, actor, (tx, store) => fn(tx, store, uid));
  }

  async roleOf(tx: Sql, storeId: string, userId: string | null): Promise<Role | null> {
    if (!userId) return null;
    const [m] = await tx.query<{ role: Role }>('select role from store_members where store_id = $1 and user_id = $2', [storeId, userId]);
    return m?.role ?? null;
  }

  /** Staff access with a permission check (§16.3). Writes are blocked for suspended stores. */
  async staff<T>(storeId: string, actor: Actor, perm: Permission, fn: (tx: Sql, m: Member) => Promise<T>, opts: { write?: boolean } = {}): Promise<T> {
    if (!actor.userId) throw new DomainError('UNAUTHENTICATED');
    return this.tx(storeId, actor, async (tx) => {
      const store = await this.storeById(tx, storeId);
      let role = await this.roleOf(tx, storeId, actor.userId);
      if (!role && actor.isPlatformAdmin && !opts.write) role = 'viewer';
      if (!role) throw new DomainError('FORBIDDEN', 'Not a member of this store');
      requirePermission(role, perm);
      if (opts.write !== false && store.status === 'suspended' && perm !== 'dashboard.read' && perm !== 'analytics.read' && perm !== 'orders.read')
        throw new DomainError('STORE_SUSPENDED');
      return fn(tx, { role, store });
    });
  }

  async audit(tx: Sql, storeId: string, actor: Actor, role: Role | null, action: string, entityType: string, entityId: string | null, before: unknown, after: unknown): Promise<void> {
    await tx.query(
      `insert into audit_log (store_id, id, actor_user_id, actor_role, action, entity_type, entity_id, diff) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [storeId, uuidv7(this.now().getTime()), actor.userId, role ?? (actor.isPlatformAdmin ? 'platform_admin' : 'system'), action, entityType, entityId, json(diff(before ?? {}, after ?? {}))],
    );
  }

  async enqueue(tx: Sql, storeId: string, recipients: Recipient[], payload: NotificationPayload): Promise<OutboxMessage[]> {
    const out: OutboxMessage[] = [];
    const seen = new Set<number>();
    for (const r of recipients) {
      if (seen.has(r.telegramId)) continue;
      seen.add(r.telegramId);
      const id = uuidv7(this.now().getTime());
      const createdAt = this.now().toISOString();
      await tx.query(`insert into outbox (store_id, id, topic, recipient, payload, created_at) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`, [
        storeId, id, payload.topic, json(r), json(payload), createdAt,
      ]);
      out.push({ id, storeId, recipient: r, payload, createdAt });
    }
    if (out.length) this.pendingOutbox = true;
    return out;
  }

  /** Owner + staff who hold `perm` and did not mute this kind of notification. */
  async staffRecipients(tx: Sql, storeId: string, perm: Permission): Promise<Recipient[]> {
    const rows = await tx.query<{ role: Role; userId: string; telegramId: number; languageCode: string }>(
      `select m.role, u.id as user_id, u.telegram_id, u.language_code from store_members m join users u on u.id = m.user_id where m.store_id = $1`,
      [storeId],
    );
    return rows
      .filter((r) => can(r.role, perm))
      .map((r) => ({ kind: r.role === 'owner' ? 'owner' : 'staff', telegramId: r.telegramId, userId: r.userId, locale: toLoc(r.languageCode) }) as Recipient);
  }

  async userRecipient(tx: Sql, userId: string | null): Promise<Recipient[]> {
    if (!userId) return [];
    const [u] = await tx.query<{ telegramId: number; languageCode: string; notify: { orders?: boolean } }>(
      'select telegram_id, language_code, notify from users where id = $1',
      [userId],
    );
    if (!u || u.notify?.orders === false) return [];
    return [{ kind: 'buyer', telegramId: u.telegramId, userId, locale: toLoc(u.languageCode) }];
  }

  async paymentLog(storeId: string, provider: ProviderId, m: ProtocolMessage): Promise<void> {
    this.deps.onProtocolMessage?.(storeId, m);
  }
}

export function toLoc(v: string | null | undefined): Locale {
  return v === 'ru' || v === 'en' ? v : 'uz';
}

export function clampLimit(v: number | undefined, d = 24, max = 100): number {
  return Math.max(1, Math.min(max, Math.floor(v ?? d)));
}

export function encodeCursor(offset: number): string {
  return offset.toString(36);
}

export function decodeCursor(c: string | null | undefined): number {
  const n = c ? parseInt(c, 36) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
