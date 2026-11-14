/**
 * Shared e2e helpers. The `guard` fixture is automatic: any console error or uncaught page error fails the test.
 */
import { expect, test as base, type Locator, type Page } from '@playwright/test';

export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use, info) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      if (process.env.E2E_DEBUG) page.on('console', (m) => console.log(`[${info.title}] ${m.type()}: ${m.text().slice(0, 300)}`));
      // Uzbek UI regardless of the browser locale; remembered like the demo bar does
      await page.addInitScript(() => localStorage.setItem('dokonim.locale', '"uz"'));
      await use();
      if (errors.length) await info.attach('console-errors', { body: errors.join('\n') });
      expect(errors, 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** Opens a hash route and waits until the backend is ready and the first screen rendered. */
export async function open(page: Page, path: string) {
  await page.goto(`./#${path}`);
  await expect(page.locator('.screen-scroll .screen:not([data-leaving])').first()).toBeVisible({ timeout: 90_000 });
}

/** The demo's Telegram MainButton (bottom bar in the phone frame). */
export const mainButton = (page: Page): Locator => page.locator('.tg-bottom-bar .tg-main-btn');

export async function clickMain(page: Page, name: RegExp | string) {
  const btn = mainButton(page);
  await expect(btn).toHaveText(name);
  await expect(btn).toBeEnabled();
  await btn.click();
}

/** The open bottom sheet with this title. */
export const sheet = (page: Page, name: RegExp | string): Locator => page.getByRole('dialog', { name });

/** The current (not leaving) screen. */
export const screen = (page: Page): Locator => page.locator('.screen-scroll .screen:not([data-leaving])');

export const toast = (page: Page): Locator => page.locator('.toast-host .toast-msg');

export const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).hash.replace(/^#/, '').split('?')[0]!);
