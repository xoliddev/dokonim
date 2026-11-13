import { defineConfig } from 'vitest/config';

const node = (name: string, dir: string, extra: Record<string, unknown> = {}) => ({
  test: { name, root: `./${dir}`, include: ['test/**/*.test.ts', 'test/**/*.test.tsx'], environment: 'node', testTimeout: 30_000, ...extra },
});

export default defineConfig({
  test: {
    projects: [
      node('core', 'packages/core'),
      node('payments', 'packages/payments'),
      node('i18n', 'packages/i18n'),
      node('contract', 'packages/contract'),
      node('seed', 'packages/seed', { testTimeout: 120_000 }),
      node('db', 'packages/db', { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false }),
      node('api', 'apps/api', { testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false }),
      node('bot', 'apps/bot'),
      {
        test: {
          name: 'miniapp',
          root: './apps/miniapp',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
