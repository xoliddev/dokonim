/**
 * Fastify HTTP API (§10). Routes are registered generically from the contract's ROUTES table:
 *   params + query(`?input=<json>`) + body → mergeRequest → Idempotency-Key → validate (zod) → Actor → backend method.
 * Plus: Telegram initData auth + JWT/refresh, payment webhooks (raw body), Telegram bot webhook, order SSE,
 * /healthz and a generated OpenAPI document.
 *
 * Media: there is no POST /v1/stores/:storeId/media in this MVP — images travel inside the JSON as data URLs
 * (bounded by the contract's string limits and the 6 MB body limit).
 */
import './types';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Bot } from 'grammy';
import { z } from 'zod';
import { httpStatusFor, isDomainError, timingSafeEqual, type ErrorCode, ERROR_CODES } from '@dokonim/core';
import { ApiError, mergeRequest, ROUTES, validate, type RouteDef, type RouteName } from '@dokonim/contract';
import { ANON, SYSTEM, type Actor, type Backend, type UserRow } from '@dokonim/db';
import { webhookCallbackFor } from '@dokonim/bot';
import { ACCESS_TTL_SEC, bearerOf, createTokenService, type TokenService } from './auth';
import { buildOpenApi } from './openapi';
import { markPlatformAdmin, ping } from './privileged';
import { DEFAULT_LIMITS, routeLimit, SharedStore, type LimitGroup } from './rate-limit';
import { DEFAULT_SSE, streamOrderEvents, type SseOptions } from './sse';

export interface ApiConfig {
  botToken: string;
  /** HS256 secret, ≥ 32 chars. */
  jwtSecret: string;
  corsOrigins: string[];
  /** Public base URL of this API (OpenAPI servers, webhook URLs). */
  publicUrl: string;
  /** t.me deep-link base of the Mini App, e.g. https://t.me/dokonim_bot/shop */
  miniAppBase: string;
  /** initData freshness for session creation (§14.3), default 86400. */
  initDataMaxAgeSec: number;
  nodeEnv: 'development' | 'test' | 'production';
  /** Telegram ids granted users.is_platform_admin on login. */
  platformAdminTelegramIds?: number[];
  /** X-Telegram-Bot-Api-Secret-Token for POST /hooks/telegram (required to mount it). */
  botWebhookSecret?: string;
  /** Fastify trustProxy (set when behind a reverse proxy so per-IP limits see the client IP). */
  trustProxy?: boolean | string;
  /** Overrides for tests/ops. */
  limits?: Partial<Record<LimitGroup, number>>;
  sse?: Partial<SseOptions>;
}

export interface BuildAppOptions {
  backend: Backend;
  config: ApiConfig;
  bot?: Bot | null;
  logger?: boolean;
}

export const BODY_LIMIT = 6 * 1024 * 1024;
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

const KNOWN_CODES = new Set<string>(ERROR_CODES);

const errorBody = (code: string, message: string, details?: Record<string, unknown>) => ({ error: { code, message, details: details ?? {} } });

/** URL without its query string (it may carry `?access_token=` or search terms). */
const pathOnly = (url: string | undefined) => (url ?? '').split('?')[0];

function loggerOptions(nodeEnv: ApiConfig['nodeEnv']) {
  return {
    level: process.env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug'),
    // Defence in depth: nothing below should ever reach a log line.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-telegram-bot-api-secret-token"]', '*.initData', '*.refreshToken', '*.accessToken', '*.phone', '*.token'],
      censor: '[redacted]',
    },
    serializers: {
      req: (req: { method?: string; url?: string; id?: string }) => ({ id: req.id, method: req.method, url: pathOnly(req.url) }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

function flatHeaders(h: FastifyRequest['headers']): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  return out;
}

const authBody = z.object({ initData: z.string().min(1).max(8192) });
const refreshBody = z.object({ refreshToken: z.string().min(16).max(256) });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ApiError('VALIDATION', issue?.message ?? 'Invalid input', { field: issue?.path.join('.') ?? '' });
  }
  return r.data;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { backend, config } = opts;
  const m = backend.methods;
  const limits: Record<LimitGroup, number> = { ...DEFAULT_LIMITS, ...config.limits };
  const sse: SseOptions = { ...DEFAULT_SSE, ...config.sse };
  const tokens: TokenService = createTokenService(config.jwtSecret, () => backend.ctx.now());
  const admins = new Set(config.platformAdminTelegramIds ?? []);

  const app = Fastify({
    logger: opts.logger ? loggerOptions(config.nodeEnv) : false,
    bodyLimit: BODY_LIMIT,
    trustProxy: config.trustProxy ?? false,
  });

  app.decorateRequest('actor', null);
  app.decorateRequest('badToken', false);

  // ── Security headers + bearer parsing (before the rate-limit hooks, which key on the verified user) ──
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('cross-origin-resource-policy', 'same-site');
    if (config.nodeEnv === 'production') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    const token = bearerOf(req.headers.authorization);
    if (token) {
      req.actor = await tokens.verify(token);
      req.badToken = req.actor === null;
    }
  });

  await app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key'],
    exposedHeaders: ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: limits.default,
    timeWindow: 60_000,
    store: SharedStore as never,
    keyGenerator: routeLimit('default', limits).keyGenerator,
    errorResponseBuilder: (_req, ctx) => new ApiError('RATE_LIMITED', `Too many requests, retry in ${ctx.after}`, { retryAfterSec: Math.ceil(ctx.ttl / 1000) }, 429),
  });

  // ── Errors: stable codes, no leaked internals ──
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (isDomainError(err)) {
      const status = httpStatusFor(err.code);
      if (status >= 500) req.log.error({ code: err.code }, 'domain error');
      return reply.code(status).send(errorBody(err.code, err.message, err.details));
    }
    if (err instanceof ApiError) {
      const status = err.status !== 422 ? err.status : KNOWN_CODES.has(err.code) ? httpStatusFor(err.code as ErrorCode) : 422;
      return reply.code(status).send(errorBody(err.code, err.message, err.details));
    }
    const pgCode = (err as { code?: unknown }).code;
    if (pgCode === '23505' || pgCode === '40001' || pgCode === '40P01') {
      req.log.warn({ pgCode }, 'conflict');
      return reply.code(409).send(errorBody('CONFLICT', 'Conflicting concurrent update, please retry'));
    }
    const sc = (err as FastifyError).statusCode;
    if (typeof sc === 'number' && sc >= 400 && sc < 500) {
      const code = sc === 413 ? 'PAYLOAD_TOO_LARGE' : sc === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : sc === 429 ? 'RATE_LIMITED' : sc === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
      return reply.code(sc).send(errorBody(code, sc === 413 ? 'Request body is too large' : 'Bad request'));
    }
    // Never echo the message (it may contain SQL or values); log name/message/stack only, no request data.
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL', 'Internal server error'));
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody('NOT_FOUND', 'Route not found')));

  const requireUser = (req: FastifyRequest): Actor => {
    if (!req.actor) throw new ApiError('UNAUTHENTICATED', req.badToken ? 'Access token is invalid or expired' : 'Authorization required', {}, 401);
    return req.actor;
  };

  // ── Auth ──
  const ensureAdminFlag = async (user: UserRow): Promise<UserRow> => {
    if (!user.isPlatformAdmin && admins.has(Number(user.telegramId))) {
      await markPlatformAdmin(backend.ctx.db, user.id);
      return { ...user, isPlatformAdmin: true };
    }
    return user;
  };
  const tokenPair = async (user: UserRow, refreshToken: string) => ({
    accessToken: await tokens.sign(user),
    refreshToken,
    expiresIn: ACCESS_TTL_SEC,
    user,
  });

  const authLimit = { rateLimit: routeLimit('auth', limits) };
  app.post('/v1/auth/telegram', { config: authLimit }, async (req) => {
    const { initData } = parseBody(authBody, req.body);
    // Without a bot token there is nothing to verify initData against (an empty key would accept forged data).
    if (!config.botToken) throw new ApiError('UNAUTHENTICATED', 'Telegram login is not configured on this server', {}, 401);
    const { user: u, startParam } = await backend.login(initData, config.botToken, { maxAgeSec: config.initDataMaxAgeSec });
    const user = await ensureAdminFlag(u);
    const { token } = await m['auth.issueRefresh'](SYSTEM, { userId: user.id });
    return { ...(await tokenPair(user, token)), startParam: startParam ?? null };
  });

  app.post('/v1/auth/refresh', { config: authLimit }, async (req) => {
    const { refreshToken } = parseBody(refreshBody, req.body);
    const { token, user: u } = await m['auth.rotateRefresh'](SYSTEM, { token: refreshToken });
    const user = await ensureAdminFlag(u);
    return tokenPair(user, token);
  });

  // ── Generic contract routes ──
  for (const [name, def] of Object.entries(ROUTES) as Array<[RouteName, RouteDef]>) {
    if (def.auth === 'internal') continue;
    const group: LimitGroup = def.rateLimit === 'checkout' || def.rateLimit === 'search' || def.rateLimit === 'auth' ? def.rateLimit : 'default';
    app.route({
      method: def.verb,
      url: def.path,
      config: { rateLimit: routeLimit(group, limits) },
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        // public: optional bearer; user: required. A present but invalid/expired bearer is a 401 on both, so the client
        // refreshes instead of silently getting anonymous data (no wishlist flags, no store role).
        if (def.auth !== 'user' && req.badToken) throw new ApiError('UNAUTHENTICATED', 'Access token is invalid or expired', {}, 401);
        const actor = def.auth === 'user' ? requireUser(req) : (req.actor ?? ANON);
        const input = mergeRequest((req.params ?? {}) as Record<string, string>, (req.query ?? {}) as Record<string, unknown>, req.body);
        if (def.idempotent) {
          const key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || !key.trim()) throw new ApiError('VALIDATION', 'Idempotency-Key header is required', { field: 'Idempotency-Key' }, 400);
          input.idempotencyKey = key.trim();
        }
        const fn = m[name] as (actor: Actor, input: unknown) => Promise<unknown>;
        const out = await fn(actor, validate(name, input));
        return reply.send(out === undefined ? { ok: true } : out);
      },
    });
  }

  // ── Order status stream (SSE) ──
  const openStreams = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of [...openStreams]) close();
  });
  app.get('/v1/s/:slug/orders/:id/events', { config: { rateLimit: routeLimit('default', limits) } }, async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    let actor = req.actor;
    if (!actor && typeof q.access_token === 'string') actor = await tokens.verify(q.access_token);
    if (!actor) throw new ApiError('UNAUTHENTICATED', 'Authorization required', {}, 401);
    const p = req.params as { slug: string; id: string };
    const input = validate('orders.get', { slug: p.slug, id: p.id });
    await streamOrderEvents(backend, actor, input, req, reply, sse, openStreams);
  });

  // ── Payment provider webhooks (no JWT; raw body for signatures) ──
  await app.register(async (hooks) => {
    hooks.removeAllContentTypeParsers();
    hooks.addContentTypeParser('*', { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => done(null, body));
    const limit = { rateLimit: routeLimit('webhook', limits) };

    const handle = async (provider: 'payme' | 'click' | 'uzum', req: FastifyRequest, reply: FastifyReply, action?: string) => {
      const { storeId } = req.params as { storeId: string };
      const body = typeof req.body === 'string' ? req.body : '';
      try {
        const res = await m['hooks.handle'](SYSTEM, { provider, storeId, action, method: req.method, headers: flatHeaders(req.headers), body, ip: req.ip });
        if (provider === 'payme' && res.status !== 200) return reply.code(200).header('content-type', 'application/json').send(paymeError(body, -32504, 'Insufficient privilege'));
        return reply.code(res.status).headers(res.headers).send(res.body);
      } catch (err) {
        req.log.error({ provider, err: { name: (err as Error).name, message: (err as Error).message } }, 'webhook failed');
        // Payme: always HTTP 200 with a JSON-RPC error body (§16.4).
        if (provider === 'payme') return reply.code(200).header('content-type', 'application/json').send(paymeError(body, -32400, 'System error'));
        return reply.code(500).send(errorBody('INTERNAL', 'Internal server error'));
      }
    };

    hooks.post('/hooks/payme/:storeId', { config: limit }, (req, reply) => handle('payme', req, reply));
    hooks.post('/hooks/click/:storeId/:action', { config: limit }, (req, reply) => {
      const { action } = req.params as { action: string };
      if (action !== 'prepare' && action !== 'complete') return reply.code(404).send(errorBody('NOT_FOUND', 'Route not found'));
      return handle('click', req, reply, action);
    });
    hooks.post('/hooks/uzum/:storeId/:action', { config: limit }, (req, reply) => {
      const { action } = req.params as { action: string };
      if (!['check', 'create', 'confirm', 'reverse', 'status'].includes(action)) return reply.code(404).send(errorBody('NOT_FOUND', 'Route not found'));
      return handle('uzum', req, reply, action);
    });
  });

  // ── Telegram bot webhook (grammY checks X-Telegram-Bot-Api-Secret-Token) ──
  if (opts.bot && config.botWebhookSecret) {
    const cb = webhookCallbackFor(opts.bot, config.botWebhookSecret);
    const secret = config.botWebhookSecret;
    // Telegram's own deliveries (correct secret) are never counted; junk without it is limited per IP and then rejected by grammY.
    const fromTelegram = (req: FastifyRequest) => timingSafeEqual(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''), secret);
    app.post('/hooks/telegram', { config: { rateLimit: { ...routeLimit('webhook', limits), max: limits.webhook * 10, allowList: fromTelegram } } }, async (req, reply) => {
      await cb(req, reply);
    });
  }

  // ── Ops ──
  app.get('/healthz', { config: { rateLimit: false } }, async (_req, reply) => {
    try {
      await ping(backend.ctx.db);
      return { ok: true, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });

  let openapi: unknown = null;
  app.get('/v1/openapi.json', async () => (openapi ??= buildOpenApi({ publicUrl: config.publicUrl })));

  return app;
}

/** JSON-RPC error body for Payme (id echoed when the body parses). */
function paymeError(body: string, code: number, en: string): string {
  let id: unknown = null;
  try {
    const p = JSON.parse(body) as { id?: unknown };
    id = p?.id ?? null;
  } catch {
    /* unparseable */
  }
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: { uz: en, ru: en, en } } });
}
