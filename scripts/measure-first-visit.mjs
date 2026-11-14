/**
 * Measures the demo's first visit (empty IndexedDB) and a warm reload, in headless Chromium.
 *   npm run build:demo && npm run preview -w @dokonim/miniapp   # then, in another shell:
 *   node scripts/measure-first-visit.mjs [url] [runs]
 * "Ready" = the backend reported phase "ready" and the first screen rendered (`.screen` inside the router view).
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4173/dokonim/';
const runs = Number(process.argv[3] ?? 3);
const browser = await chromium.launch();
const ready = (page) => page.locator('.screen-scroll .screen').first().waitFor({ state: 'visible', timeout: 15 * 60_000 });
const first = [];
const warm = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let t = Date.now();
  await page.goto(url);
  await ready(page);
  first.push(Date.now() - t);
  // let the background IndexedDB write finish before the warm reload
  await page.waitForTimeout(1500);
  t = Date.now();
  await page.reload();
  await ready(page);
  warm.push(Date.now() - t);
  await ctx.close();
}
await browser.close();
const fmt = (xs) => xs.map((x) => `${(x / 1000).toFixed(2)} s`).join(', ');
console.log(`first visit: ${fmt(first)}\nwarm reload: ${fmt(warm)}`);
