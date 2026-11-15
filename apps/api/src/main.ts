/**
 * Production entry point: env → Postgres (+ migrations) → backend → optional bot → Fastify + workers.
 *   DATABASE_URL=… JWT_SECRET=… CREDENTIALS_KEK=… PUBLIC_URL=… MINIAPP_URL=… npx tsx apps/api/src/main.ts
 */
import type { Bot } from 'grammy';
import { systemClock } from '@dokonim/core';
import { createBackend, migrate } from '@dokonim/db';
import { createPgDatabase } from '@dokonim/db/pg';
import { createPaymentRegistry } from '@dokonim/payments';
import { createBot } from '@dokonim/bot';
import { buildApp } from './app';
import { createBotBackend } from './bot-backend';
import { loadEnv, miniAppBaseOf } from './env';
import { startWorkers, type WorkerLogger, type Workers } from './workers';

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const db = createPgDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const applied = await migrate(db);
  const miniAppBase = miniAppBaseOf(env);

  let bot: Bot | null = null;
  let workers: Workers | null = null;
  const backend = createBackend({
    db,
    clock: systemClock,
    kek: env.CREDENTIALS_KEK.toLowerCase(),
    payments: createPaymentRegistry({
      createInvoiceLink: env.BOT_TOKEN
        ? (p) => {
            if (!bot) throw new Error('bot is not ready');
            return bot.api.createInvoiceLink(p.title, p.description, p.payload, p.provider_token, p.currency, p.prices, p.photo_url ? { photo_url: p.photo_url } : undefined);
          }
        : undefined,
    }),
    links: { miniAppBase, webhookBase: env.PUBLIC_URL.replace(/\/$/, '') },
    onOutbox: () => workers?.nudge(),
  });

  if (env.BOT_TOKEN && env.BOT_MODE !== 'off') {
    bot = createBot(
      { token: env.BOT_TOKEN, miniAppBase, webAppUrl: env.MINIAPP_URL },
      createBotBackend(backend, { refundStarPayment: (userId, chargeId) => bot!.api.refundStarPayment(userId, chargeId) }),
    );
  }

  const app = await buildApp({
    backend,
    bot,
    logger: true,
    config: {
      botToken: env.BOT_TOKEN ?? '',
      jwtSecret: env.JWT_SECRET,
      corsOrigins: env.CORS_ORIGINS,
      publicUrl: env.PUBLIC_URL,
      miniAppBase,
      initDataMaxAgeSec: env.INITDATA_MAX_AGE_SEC,
      nodeEnv: env.NODE_ENV,
      platformAdminTelegramIds: env.PLATFORM_ADMIN_TELEGRAM_IDS,
      ...(env.BOT_WEBHOOK_SECRET ? { botWebhookSecret: env.BOT_WEBHOOK_SECRET } : {}),
      ...(env.TRUST_PROXY !== undefined ? { trustProxy: env.TRUST_PROXY } : {}),
    },
  });
  const log: WorkerLogger = {
    info: (o, msg) => app.log.info(o, msg),
    warn: (o, msg) => app.log.warn(o, msg),
    error: (o, msg) => app.log.error(o, msg),
  };
  if (applied.length) log.info({ migrations: applied }, 'migrations applied');
  if (!env.BOT_TOKEN) log.warn({}, 'BOT_TOKEN is not set: Telegram login, notifications and invoices are disabled');

  workers = startWorkers(backend, bot, { miniAppBase, logger: log });

  await app.listen({ port: env.PORT, host: env.HOST });

  const mode = env.BOT_MODE ?? (env.BOT_WEBHOOK_SECRET ? 'webhook' : 'polling');
  if (bot) {
    try {
      await bot.init();
      if (mode === 'webhook' && env.BOT_WEBHOOK_SECRET) {
        await bot.api.setWebhook(`${env.PUBLIC_URL.replace(/\/$/, '')}/hooks/telegram`, {
          secret_token: env.BOT_WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query', 'inline_query', 'pre_checkout_query'],
        });
        log.info({ bot: bot.botInfo.username }, 'bot webhook registered');
      } else if (mode === 'polling') {
        void bot.start({ drop_pending_updates: false, onStart: () => log.info({ bot: bot!.botInfo.username }, 'bot polling started') }).catch((e: unknown) => log.error({ error: (e as Error).message }, 'bot polling stopped'));
      }
    } catch (e) {
      log.error({ error: (e as Error).message }, 'bot initialisation failed (API keeps running)');
    }
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      // open SSE streams are ended in preClose; workers stop alongside so an outbox delivery finishes before the pool ends
      await Promise.all([app.close(), workers?.stop()]);
      if (bot && mode === 'polling' && bot.isRunning()) await bot.stop();
      await db.close();
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
