/**
 * Environment → typed config. Fails fast with one readable message listing every problem (values are never echoed).
 */
import { z } from 'zod';

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    PUBLIC_URL: z.string().url('must be the public https URL of this API'),
    MINIAPP_URL: z.string().url('must be the https URL of the Mini App'),
    /** Mini App short name registered in BotFather (t.me/<bot>/<short_name>). */
    MINIAPP_SHORT_NAME: z.string().regex(/^[A-Za-z0-9_]{1,64}$/).default('shop'),
    BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'must look like 123456:ABC…').optional(),
    BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/, 'Telegram username without @').optional(),
    BOT_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, '16–256 chars of A-Z a-z 0-9 _ -').optional(),
    /** 'webhook' (default when BOT_WEBHOOK_SECRET is set) or 'polling' (local development). */
    BOT_MODE: z.enum(['webhook', 'polling', 'off']).optional(),
    JWT_SECRET: z
      .string()
      .min(32, 'must be at least 32 characters')
      .refine((v) => !/[<>]|change|replace|example/i.test(v), 'is still the placeholder from .env.example'),
    CREDENTIALS_KEK: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)'),
    CORS_ORIGINS: z.string().optional().transform(list).pipe(z.array(z.string().url('each CORS origin must be a URL'))),
    PLATFORM_ADMIN_TELEGRAM_IDS: z
      .string()
      .optional()
      .transform(list)
      .pipe(z.array(z.string().regex(/^\d{1,20}$/, 'comma-separated numeric Telegram ids')))
      .transform((a) => a.map(Number)),
    INITDATA_MAX_AGE_SEC: z.coerce.number().int().min(60).max(7 * 86_400).default(86_400),
    TRUST_PROXY: bool.optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production') {
      if (!e.PUBLIC_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'must be https in production' });
      if (e.BOT_TOKEN && !e.BOT_WEBHOOK_SECRET && e.BOT_MODE !== 'polling') ctx.addIssue({ code: 'custom', path: ['BOT_WEBHOOK_SECRET'], message: 'is required for webhook mode in production' });
    }
    if (e.BOT_TOKEN && !e.BOT_USERNAME) ctx.addIssue({ code: 'custom', path: ['BOT_USERNAME'], message: 'is required when BOT_TOKEN is set (deep links)' });
  });

export type Env = z.output<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty strings as unset so `KEY=` lines in .env files do not fail format checks.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') cleaned[k] = v;
  const r = EnvSchema.safeParse(cleaned);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return r.data;
}

/** t.me deep-link base used in notifications and invite links. */
export function miniAppBaseOf(env: Env): string {
  return env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}/${env.MINIAPP_SHORT_NAME}` : env.MINIAPP_URL;
}
