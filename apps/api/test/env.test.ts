import { describe, expect, it } from 'vitest';
import { loadEnv, miniAppBaseOf } from '../src/env';

const BASE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  PUBLIC_URL: 'https://api.dokonim.test',
  MINIAPP_URL: 'https://app.dokonim.test',
  JWT_SECRET: 'a'.repeat(40),
  CREDENTIALS_KEK: 'ab'.repeat(32),
};

describe('env', () => {
  it('parses lists, defaults and the deep-link base', () => {
    const env = loadEnv({ ...BASE, CORS_ORIGINS: 'https://a.test, https://b.test', PLATFORM_ADMIN_TELEGRAM_IDS: '1,22', BOT_USERNAME: 'dokonim_bot', PORT: '' });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(env.PLATFORM_ADMIN_TELEGRAM_IDS).toEqual([1, 22]);
    expect(env.INITDATA_MAX_AGE_SEC).toBe(86_400);
    expect(miniAppBaseOf(env)).toBe('https://t.me/dokonim_bot/shop');
  });

  it('lists every problem without echoing values', () => {
    let msg = '';
    try {
      loadEnv({ ...BASE, JWT_SECRET: '<replace-with-output-of-openssl-rand-hex-32>', CREDENTIALS_KEK: 'secret-kek', DATABASE_URL: 'mysql://x', BOT_TOKEN: '123:short' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/JWT_SECRET: is still the placeholder/);
    expect(msg).toMatch(/CREDENTIALS_KEK: must be 64 hex/);
    expect(msg).toMatch(/DATABASE_URL/);
    expect(msg).toMatch(/BOT_TOKEN/);
    expect(msg).not.toContain('secret-kek');
    expect(() => loadEnv({ ...BASE, NODE_ENV: 'production', PUBLIC_URL: 'http://api.test' })).toThrow(/https in production/);
  });
});
