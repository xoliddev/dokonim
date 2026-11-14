/**
 * Buyer surface on two stores: 3rd-level category, search with filters, variants, cart, promo (rejected, then
 * accepted), sandbox Payme / cash on delivery, My orders, and the seller's status change on the buyer timeline.
 */
import { clickMain, expect, mainButton, open, pathOf, screen, sheet, test, toast } from './fixtures';

interface Case {
  slug: string;
  path: string[]; // uz names: root › level 2 › level 3
  urlTail: string;
  product: string;
  pick: Array<[option: string, value: string]>;
  search: { q: string; min: string; max: string };
  badPromo: { code: string; error: RegExp };
  goodPromo: string;
  pay: 'payme' | 'cod';
}

const CASES: Case[] = [
  {
    slug: 'atlas-adras',
    path: ['Kiyim', 'Ayollar', 'Koʻylaklar'],
    urlTail: '/c/kiyim/ayollar/koylaklar',
    product: 'Adras koʻylak “Bahor”',
    pick: [['Oʻlcham', 'M'], ['Rang', 'Binafsha']],
    search: { q: 'koʻylak', min: '300000', max: '500000' },
    // 380 000 so‘m is below TOY50's 800 000 minimum
    badPromo: { code: 'TOY50', error: /Promokod .* dan yuqori buyurtmalarga ishlaydi/ },
    goodPromo: 'SALOM10',
    pay: 'payme',
  },
  {
    slug: 'texno-bozor',
    path: ['Telefonlar', 'Smartfonlar', 'Flagmanlar'],
    urlTail: '/c/telefonlar/smartfonlar/flagmanlar',
    product: 'Smartfon “Samarqand X5”',
    pick: [['Xotira', '256 GB'], ['Rang', 'Kumush']],
    search: { q: 'smartfon', min: '1000000', max: '6000000' },
    badPromo: { code: 'XATO1', error: /“XATO1” promokodi topilmadi/ },
    goodPromo: 'TEXNO5',
    pay: 'cod',
  },
];

for (const c of CASES) {
  test(`buyer journey on ${c.slug} (${c.pay === 'cod' ? 'cash on delivery' : 'sandbox Payme'})`, async ({ page }) => {
    await test.step('browse to a 3rd-level subcategory', async () => {
      await open(page, `/s/${c.slug}/catalog`);
      await screen(page).locator('button.st-cat', { hasText: c.path[0] }).first().click();
      for (const name of c.path.slice(1)) {
        await screen(page).locator('.st-subcats button.chip', { hasText: new RegExp(`^${name}`) }).click();
        await expect(page.locator('.screen:not([data-leaving]) h1.st-top-title')).toHaveText(name);
      }
      await expect.poll(() => pathOf(page)).toBe(`/s/${c.slug}${c.urlTail}`);
      await expect(screen(page).locator('article.st-pcard', { hasText: c.product })).toBeVisible();
    });

    await test.step('search with a price filter', async () => {
      await open(page, `/s/${c.slug}/search?q=${encodeURIComponent(c.search.q)}`);
      await expect(screen(page).locator('article.st-pcard').first()).toBeVisible();
      await screen(page).locator('.st-fbar').getByRole('button', { name: /^Filtrlar/ }).click();
      const f = sheet(page, 'Filtrlar');
      await f.getByLabel('dan').fill(c.search.min);
      await f.getByLabel('gacha').fill(c.search.max);
      const apply = f.locator('.sheet-footer button').last();
      await expect(apply).toHaveText(/\d+ ta natijani koʻrsatish/);
      await apply.click();
      await expect(f).toBeHidden();
      await expect.poll(() => new URL(page.url()).hash).toContain(`min=${c.search.min}`);
      await expect(screen(page).locator('.st-count-line')).toContainText('ta mahsulot');
      await expect(screen(page).locator('article.st-pcard', { hasText: c.product })).toBeVisible();
    });

    await test.step('pick variants and add to cart', async () => {
      await screen(page).locator('article.st-pcard', { hasText: c.product }).locator('.st-pcard-info').click();
      await expect.poll(() => pathOf(page)).toMatch(new RegExp(`^/s/${c.slug}/p/`));
      for (const [option, value] of c.pick) {
        const radio = page.getByRole('radiogroup', { name: option }).getByRole('radio', { name: value, exact: true });
        await radio.click();
        await expect(radio).toHaveAttribute('aria-checked', 'true');
      }
      await clickMain(page, /^Savatga qoʻshish · /);
      await expect(page.locator('.st-incart')).toContainText('Savatda 1 ta');
    });

    await test.step('promo code: rejected, then accepted', async () => {
      await open(page, `/s/${c.slug}/cart`);
      const promo = screen(page).locator('form.st-promo');
      await promo.getByLabel('Promokod').fill(c.badPromo.code);
      await promo.getByRole('button', { name: 'Qoʻllash' }).click();
      await expect(promo.locator('.field-error')).toHaveText(c.badPromo.error);
      await promo.getByLabel('Promokod').fill(c.goodPromo);
      await promo.getByRole('button', { name: 'Qoʻllash' }).click();
      await expect(screen(page).locator('.st-promo-on')).toContainText(c.goodPromo);
      await expect(screen(page).getByText('Chegirma', { exact: true })).toBeVisible();
      await clickMain(page, /^Rasmiylashtirish · /);
    });

    let orderId = '';
    await test.step(`checkout and pay (${c.pay})`, async () => {
      await expect.poll(() => pathOf(page)).toBe(`/s/${c.slug}/checkout`);
      await page.getByLabel('Ismingiz').fill('Dilnoza Karimova');
      await page.getByLabel('Telefon raqam').fill('901234567');
      await page.getByLabel('Koʻcha, uy, xonadon').fill('Amir Temur koʻchasi, 15-uy');
      if (c.pay === 'cod') {
        await page.getByRole('radiogroup', { name: 'Toʻlov usuli' }).getByRole('radio', { name: /Qabul qilganda naqd/ }).click();
        await clickMain(page, /^Buyurtma berish · /);
      } else {
        await page.getByRole('radiogroup', { name: 'Toʻlov usuli' }).getByRole('radio', { name: /^Payme/ }).click();
        await clickMain(page, /toʻlash$/);
        const pay = sheet(page, /Payme — test toʻlov/);
        await expect(pay.getByText('Muvaffaqiyatli toʻlov')).toBeVisible();
        await pay.getByRole('button', { name: /^\d.*toʻlash$/ }).click();
      }
      await expect.poll(() => pathOf(page)).toMatch(new RegExp(`^/s/${c.slug}/orders/[0-9a-f-]{36}$`));
      orderId = pathOf(page).split('/').pop()!;
      await expect(page.locator('.st-receipt-sub')).toHaveText('Buyurtma qabul qilindi!');
      await expect(page.locator('.st-stamp')).toHaveAttribute('aria-label', c.pay === 'cod' ? 'Qabul qilindi' : 'Toʻlandi');
    });

    const number = (await page.locator('.st-receipt').getByText(/Buyurtma №\d+/).first().innerText()).match(/№(\d+)/)![1]!;

    await test.step('find it in My orders', async () => {
      await open(page, `/s/${c.slug}/profile`);
      await screen(page).getByRole('button', { name: /Buyurtmalarim/ }).click();
      const card = screen(page).locator('button.st-order', { hasText: `Buyurtma №${number}` });
      await expect(card).toBeVisible();
      await expect(card.locator('.st-status')).toHaveText(c.pay === 'cod' ? 'Tasdiqlash kutilmoqda' : 'Toʻlandi');
    });

    await test.step('the seller confirms it', async () => {
      await open(page, `/m/${c.slug}/orders/${orderId}`);
      await expect(page.locator('.od-status-label')).toHaveText(c.pay === 'cod' ? 'Tasdiqlash kutilmoqda' : 'Toʻlandi');
      await clickMain(page, 'Tasdiqlash');
      await expect(toast(page).filter({ hasText: 'Holat: Tasdiqlandi' })).toBeVisible();
      await expect(page.locator('.od-status-label')).toHaveText('Tasdiqlandi');
      await expect(mainButton(page)).toHaveText('Yigʻish');
    });

    await test.step('the buyer timeline shows the new status', async () => {
      await open(page, `/s/${c.slug}/orders/${orderId}`);
      const step = page.locator('ol.st-timeline li.st-tl-step', { hasText: 'Tasdiqlandi' });
      await expect(step).toHaveClass(/is-done/);
      await expect(step).toHaveClass(/is-now/);
    });
  });
}
