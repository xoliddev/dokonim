/**
 * Background loops of the API process:
 *  - outbox deliverer: outbox.claim → renderNotification → deliver(bot.api) → outbox.mark (retries/backoff live in SQL)
 *  - reservation expiry (jobs.expireReservations) every minute
 *  - auto-complete of delivered orders (jobs.autoComplete) hourly
 * Without a bot, the outbox is left untouched (rows stay `pending`, nothing is claimed) so they are delivered once a
 * bot is configured.
 */
import { SYSTEM, type Backend } from '@dokonim/db';
import { deliver, renderNotification, type MessageSender } from '@dokonim/bot';

export interface WorkerLogger {
  info(o: Record<string, unknown>, msg?: string): void;
  warn(o: Record<string, unknown>, msg?: string): void;
  error(o: Record<string, unknown>, msg?: string): void;
}

export interface WorkerOptions {
  miniAppBase: string;
  /** Outbox poll interval (default 2 s). */
  intervalMs?: number;
  expireEveryMs?: number;
  autoCompleteEveryMs?: number;
  batch?: number;
  logger?: WorkerLogger;
}

export interface Workers {
  /** Deliver one outbox batch now (also called by the backend's onOutbox nudge). */
  deliverNow(): Promise<number>;
  nudge(): void;
  runExpiry(): Promise<number>;
  runAutoComplete(): Promise<number>;
  stop(): Promise<void>;
}

const consoleLogger: WorkerLogger = {
  info: (o, msg) => console.log(JSON.stringify({ level: 'info', msg, ...o })),
  warn: (o, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...o })),
  error: (o, msg) => console.error(JSON.stringify({ level: 'error', msg, ...o })),
};

/** One delivery pass. Returns the number of messages sent. */
export async function deliverOutboxOnce(backend: Backend, api: MessageSender, opts: { miniAppBase: string; batch?: number; logger?: WorkerLogger }): Promise<number> {
  const m = backend.methods;
  const log = opts.logger ?? consoleLogger;
  const msgs = await m['outbox.claim'](SYSTEM, { limit: opts.batch ?? 20 });
  let sent = 0;
  for (const msg of msgs) {
    try {
      const rendered = renderNotification(msg, { miniAppBase: opts.miniAppBase });
      await deliver(api, rendered);
      await m['outbox.mark'](SYSTEM, { id: msg.id, ok: true });
      sent++;
    } catch (e) {
      // No recipient ids, texts or phones in logs: topic + error description only.
      const error = e instanceof Error ? e.message.slice(0, 300) : String(e);
      log.warn({ outboxId: msg.id, topic: msg.payload.topic, error }, 'outbox delivery failed');
      await m['outbox.mark'](SYSTEM, { id: msg.id, ok: false, error }).catch(() => undefined);
    }
  }
  return sent;
}

export function startWorkers(backend: Backend, bot: { api: MessageSender } | null, opts: WorkerOptions): Workers {
  const log = opts.logger ?? consoleLogger;
  const m = backend.methods;
  let stopped = false;
  const running = new Set<Promise<unknown>>();

  /** Runs `fn` unless the same job is still running (no overlap) and tracks it for stop(). */
  const single = <T>(fn: () => Promise<T>, fallback: T) => {
    let current: Promise<T> | null = null;
    return (): Promise<T> => {
      if (stopped) return Promise.resolve(fallback);
      if (current) return current;
      const p = fn()
        .catch((e: unknown) => {
          log.error({ error: e instanceof Error ? e.message.slice(0, 300) : String(e) }, 'worker job failed');
          return fallback;
        })
        .finally(() => {
          current = null;
          running.delete(p);
        });
      current = p;
      running.add(p);
      return p;
    };
  };

  let warned = false;
  const deliverNow = single(async () => {
    if (!bot) {
      if (!warned) log.info({}, 'outbox delivery disabled: no bot configured (messages stay pending)');
      warned = true;
      return 0;
    }
    let total = 0;
    for (;;) {
      const n = await deliverOutboxOnce(backend, bot.api, { miniAppBase: opts.miniAppBase, batch: opts.batch, logger: log });
      total += n;
      if (n < (opts.batch ?? 20) || stopped) return total;
    }
  }, 0);

  const runExpiry = single(async () => (await m['jobs.expireReservations'](SYSTEM, {})).cancelled, 0);
  const runAutoComplete = single(async () => (await m['jobs.autoComplete'](SYSTEM, {})).completed, 0);

  const timers = [
    setInterval(() => void deliverNow(), opts.intervalMs ?? 2_000),
    setInterval(() => void runExpiry(), opts.expireEveryMs ?? 60_000),
    setInterval(() => void runAutoComplete(), opts.autoCompleteEveryMs ?? 3_600_000),
  ];
  for (const t of timers) t.unref?.();

  return {
    deliverNow,
    nudge: () => void deliverNow(),
    runExpiry,
    runAutoComplete,
    async stop() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      await Promise.allSettled([...running]);
    },
  };
}
