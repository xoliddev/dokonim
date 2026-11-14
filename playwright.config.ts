/**
 * End-to-end tests against `vite preview` of the demo build (LocalApi: PGlite in a Web Worker, pre-baked snapshot).
 *
 *   npm run build:demo && npm run e2e                 # local (PW_CHANNEL=chrome to use the system Chrome)
 *   E2E_BASE_URL=https://xoliddev.github.io/dokonim/ npm run e2e   # against the live demo, no local server
 *
 * Two viewports: 1440 px (desktop: the app inside the phone frame next to the demo bar) and 375 px (full-bleed phone).
 * Every test runs in a fresh browser context, i.e. a fresh IndexedDB loaded from the snapshot.
 */
import { defineConfig, devices } from '@playwright/test';

const external = process.env.E2E_BASE_URL;
const baseURL = external ?? 'http://localhost:4173/dokonim/';
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // each context boots its own PGlite (WASM + a 40 MB data dir into IndexedDB); more than 2 at once starves the CPU
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    locale: 'uz-UZ',
    timezoneId: 'Asia/Tashkent',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } } },
    { name: 'phone-375', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
  webServer: external
    ? undefined
    : {
        command: 'npm run preview -w @dokonim/miniapp',
        url: 'http://localhost:4173/dokonim/',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
