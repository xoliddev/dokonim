/** Seller surface: create-store wizard, 3-level category CRUD with move + delete, a 2×3 variant product. */
import { clickMain, expect, mainButton, open, pathOf, screen, sheet, test, toast } from './fixtures';
import type { Page } from '@playwright/test';

const row = (page: Page, name: string) => page.locator('.ct-row').filter({ has: page.locator('.ct-name', { hasText: new RegExp(`^${name}$`) }) });

test('create a store with the wizard', async ({ page }) => {
  const slug = `e2e-${Date.now().toString(36)}`;
  await open(page, '/m/new/create-store');
  await page.getByLabel('Doʻkon nomi').fill('E2E Doʻkon');
  await page.getByLabel('Doʻkon manzili').fill(slug);
  await expect(page.locator('.wz-slug-status .is-ok')).toBeVisible();
  await clickMain(page, 'Keyingi');

  await expect(page.getByRole('heading', { name: 'Nima sotasiz?' })).toBeVisible();
  await page.getByRole('radio', { name: /Elektronika/ }).click();
  await clickMain(page, 'Keyingi');

  await expect(page.getByRole('heading', { name: 'Brendingiz' })).toBeVisible();
  await clickMain(page, 'Keyingi');

  await expect(page.getByRole('heading', { name: 'Birinchi mahsulot' })).toBeVisible();
  await page.getByLabel('Nomi', { exact: true }).fill('E2E quloqchin');
  await page.getByLabel('Narx', { exact: true }).fill('150000');
  await clickMain(page, 'Keyingi');

  await expect(page.getByRole('heading', { name: 'Toʻlov usullari' })).toBeVisible();
  await clickMain(page, 'Doʻkonni yaratish');

  await expect(page.getByRole('heading', { name: 'Doʻkoningiz tayyor!' })).toBeVisible();
  await expect(page.locator('.wz-link-text')).toContainText(slug);
  await clickMain(page, 'Boshqaruvga oʻtish');
  await expect.poll(() => pathOf(page)).toBe(`/m/${slug}`);

  // the new storefront is live with the first product
  await open(page, `/s/${slug}/search?q=quloqchin`);
  await expect(screen(page).locator('article.st-pcard').filter({ hasText: 'E2E quloqchin' })).toBeVisible();
});

test('category CRUD three levels deep, with a move and a delete', async ({ page }) => {
  await open(page, '/m/atlas-adras/categories');
  await expect(page.getByRole('tree', { name: 'Kategoriyalar' })).toBeVisible();

  const add = async (name: string, parent?: string) => {
    if (parent) await row(page, parent).locator('.ct-add').click();
    else await clickMain(page, 'Kategoriya qoʻshish');
    const s = sheet(page, parent ? 'Ichki kategoriya' : 'Kategoriya qoʻshish');
    await s.getByLabel('Nomi (oʻzbekcha)').fill(name);
    await s.getByRole('button', { name: 'Yaratish' }).click();
    await expect(s).toBeHidden();
    await expect(toast(page).filter({ hasText: `“${name}” qoʻshildi` })).toBeVisible();
    // the parent expands itself when a child is added
    const r = row(page, name);
    await expect(r).toBeVisible();
  };
  await add('E2E Ildiz');
  await add('E2E Ikkinchi', 'E2E Ildiz');
  await add('E2E Uchinchi', 'E2E Ikkinchi');
  await expect(row(page, 'E2E Ildiz')).toHaveAttribute('aria-level', '1');
  await expect(row(page, 'E2E Ikkinchi')).toHaveAttribute('aria-level', '2');
  await expect(row(page, 'E2E Uchinchi')).toHaveAttribute('aria-level', '3');

  // rename the third level
  await row(page, 'E2E Uchinchi').locator('.ct-main').click();
  await sheet(page, 'E2E Uchinchi').getByRole('button', { name: 'Tahrirlash' }).click();
  const edit = sheet(page, 'Tahrirlash');
  await edit.getByLabel('Nomi (oʻzbekcha)').fill('E2E Barg');
  await edit.getByRole('button', { name: 'Saqlash' }).click();
  await expect(row(page, 'E2E Barg')).toBeVisible();

  // move it one level up: directly under the root
  await row(page, 'E2E Barg').locator('.ct-main').click();
  await sheet(page, 'E2E Barg').getByRole('button', { name: /^Boshqa joyga koʻchirish/ }).click();
  const picker = sheet(page, /“E2E Barg”ni qayerga koʻchiramiz\?/);
  await picker.getByPlaceholder('Kategoriya qidirish').fill('E2E Ildiz');
  await picker.locator('.cp-row', { hasText: 'E2E Ildiz' }).first().click();
  await picker.getByRole('button', { name: /^Shu yerga koʻchirish · E2E Ildiz/ }).click();
  await expect(toast(page).filter({ hasText: '“E2E Barg” koʻchirildi' })).toBeVisible();
  await expect(row(page, 'E2E Barg')).toHaveAttribute('aria-level', '2');

  // delete the root with everything inside
  await row(page, 'E2E Ildiz').locator('.ct-main').click();
  await sheet(page, 'E2E Ildiz').locator('button.ct-action.is-danger').click();
  const del = sheet(page, '“E2E Ildiz” kategoriyasini oʻchirish');
  await del.getByRole('radio', { name: /Hammasini oʻchirish/ }).click();
  await del.locator('.ds-go').click();
  await expect(toast(page).filter({ hasText: '“E2E Ildiz” oʻchirildi' })).toBeVisible();
  await expect(page.locator('.ct-name', { hasText: /^E2E / })).toHaveCount(0);
});

test('product with a 2×3 variant matrix', async ({ page }) => {
  await open(page, '/m/atlas-adras/products/new');
  await page.getByLabel('Nomi (oʻzbekcha)').fill('E2E Koʻylak');
  await page.getByLabel('Narx', { exact: true }).fill('250000');
  await page.locator('.oe-add').getByRole('button', { name: '+ Rang' }).click();
  await page.locator('.oe-add').getByRole('button', { name: '+ Oʻlcham' }).click();
  await expect(page.locator('.vm-table tbody tr')).toHaveCount(6);

  await page.locator('button.pe-cat').click();
  const pick = sheet(page, 'Kategoriya');
  await pick.getByPlaceholder('Kategoriya qidirish').fill('Roʻmollar');
  await pick.locator('.cp-row', { hasText: 'Roʻmollar' }).first().click();
  await expect(page.locator('button.pe-cat')).toContainText('Roʻmollar');

  await clickMain(page, 'Saqlash');
  await expect(toast(page).filter({ hasText: 'Mahsulot saqlandi' })).toBeVisible();
  await expect.poll(() => pathOf(page)).toMatch(/^\/m\/atlas-adras\/products\/[0-9a-f-]{36}$/);
  await expect(mainButton(page)).toHaveText('Saqlash');

  // the buyer sees both options with every value
  await open(page, '/s/atlas-adras/search?q=E2E');
  await screen(page).locator('article.st-pcard', { hasText: 'E2E Koʻylak' }).locator('.st-pcard-info').click();
  await expect(page.getByRole('radiogroup', { name: 'Rang' }).getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radiogroup', { name: 'Oʻlcham' }).getByRole('radio')).toHaveCount(3);
});
