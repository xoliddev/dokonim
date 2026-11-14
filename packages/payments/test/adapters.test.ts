import { describe, expect, it, vi } from 'vitest';
import { DomainError, utf8fromb64 } from '@dokonim/core';
import type { CreateIntentInput, ProviderConfig } from '@dokonim/core';
import {
  CAPABILITIES,
  ClickAdapter,
  PaymeAdapter,
  UzumAdapter,
  availableMethods,
  buildClickPayUrl,
  buildPaymeCheckoutUrl,
  createPaymentRegistry,
  sandboxConfig,
} from '../src';
import type { HttpFetch, InvoiceLinkParams } from '../src';
import { AMOUNT, ORDER_ID, PAYMENT_ID, liveConfig } from './helpers';

const RETURN = 'https://t.me/dokonim_bot/shop?startapp=bozor-o-ab12cd34';

function input(over: { amount?: number; currency?: 'UZS' | 'XTR' | 'USD'; isDigital?: boolean; locale?: 'uz' | 'ru' | 'en' } = {}): CreateIntentInput {
  const amount = over.amount ?? AMOUNT;
  const currency = over.currency ?? 'UZS';
  return {
    store: { id: 'st-1', slug: 'bozor', name: 'Bozor' },
    order: { id: ORDER_ID, shortId: 'ab12cd34', number: 1001, total: amount, currency, items: [{ title: 'Choynak', qty: 2, unitPrice: amount / 2 }], isDigital: over.isDigital ?? false },
    payment: { id: PAYMENT_ID, orderId: ORDER_ID, provider: 'payme', mode: 'live', status: 'created', amount, currency },
    returnUrl: RETURN,
    locale: over.locale ?? 'uz',
  };
}

const reg = createPaymentRegistry();

function decodePayme(url: string): Record<string, string> {
  // standard base64 may itself contain '/', so strip the host prefix instead of splitting on '/'
  const b64 = url.replace(/^https:\/\/checkout(\.test)?\.paycom\.uz\//, '');
  return Object.fromEntries(utf8fromb64(b64).split(';').map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
}

describe('Payme adapter', () => {
  it('builds checkout.paycom.uz/<base64(m;ac.order_id;a;c;l)> in live mode', async () => {
    const a = await reg.adapters.payme.createIntent(input({ locale: 'ru' }), liveConfig('payme'));
    expect(a.type).toBe('redirect');
    if (a.type !== 'redirect') return;
    expect(a.openWith).toBe('openLink');
    expect(a.url.startsWith('https://checkout.paycom.uz/')).toBe(true);
    expect(decodePayme(a.url)).toEqual({ m: '64d0c0ffee0000000000d0c0', 'ac.order_id': ORDER_ID, a: String(AMOUNT), c: RETURN, l: 'ru' });
  });

  it('uses the test checkout host when publicConfig.env = test and escapes ";" in the return URL', () => {
    const url = buildPaymeCheckoutUrl({ merchantId: 'm1', orderId: 'o1', amount: 100, returnUrl: 'https://x.uz/a;b', test: true });
    expect(url.startsWith('https://checkout.test.paycom.uz/')).toBe(true);
    expect(decodePayme(url)).toEqual({ m: 'm1', 'ac.order_id': 'o1', a: '100', c: 'https://x.uz/a%3Bb' });
  });

  it('sandbox mode → sandbox action', async () => {
    expect(await reg.adapters.payme.createIntent(input(), sandboxConfig('payme'))).toEqual({
      type: 'sandbox',
      provider: 'payme',
      paymentId: PAYMENT_ID,
      url: `sandbox://payme?payment=${PAYMENT_ID}`,
    });
  });

  it('validateConfig lists missing / malformed credentials (live only)', async () => {
    const empty: ProviderConfig = { ...liveConfig('payme'), credentials: {} };
    expect(await new PaymeAdapter().validateConfig(empty)).toEqual({ ok: false, problems: ['merchant_id is required', 'key is required'] });
    const bad = await new PaymeAdapter().validateConfig({ ...empty, credentials: { merchant_id: 'xyz', key: 'k' } });
    expect(bad.problems).toEqual(['merchant_id must be the 24-character id from the Payme cabinet']);
    expect(await new PaymeAdapter().validateConfig({ ...sandboxConfig('payme'), credentials: {} })).toEqual({ ok: true, problems: [] });
  });

  it('refuses live intents with a broken config, digital goods and foreign currency', async () => {
    await expect(reg.adapters.payme.createIntent(input(), { ...liveConfig('payme'), credentials: {} })).rejects.toThrow(DomainError);
    await expect(reg.adapters.payme.createIntent(input({ isDigital: true }), liveConfig('payme'))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
    await expect(reg.adapters.payme.createIntent(input({ currency: 'XTR' }), liveConfig('payme'))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
  });
});

describe('Click adapter', () => {
  it("builds my.click.uz/services/pay with so'm amount (2 decimals) and transaction_param = order id", async () => {
    const a = await reg.adapters.click.createIntent(input({ amount: 1_234_567 }), liveConfig('click'));
    if (a.type !== 'redirect') throw new Error('expected redirect');
    const u = new URL(a.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://my.click.uz/services/pay');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      service_id: '10001',
      merchant_id: '20001',
      amount: '12345.67',
      transaction_param: ORDER_ID,
      return_url: RETURN,
      merchant_user_id: '30001',
    });
  });

  it('formats whole amounts with .00 and omits optional merchant_user_id', () => {
    const u = new URL(buildClickPayUrl({ serviceId: '1', merchantId: '2', amount: 1_500_000, orderId: 'o' }));
    expect(u.searchParams.get('amount')).toBe('15000.00');
    expect(u.searchParams.has('merchant_user_id')).toBe(false);
  });

  it('validateConfig requires service_id, merchant_id, secret_key (numeric ids); merchant_user_id optional', async () => {
    const c = new ClickAdapter();
    expect((await c.validateConfig({ ...liveConfig('click'), credentials: {} })).problems).toEqual([
      'service_id is required',
      'merchant_id is required',
      'secret_key is required',
    ]);
    const r = await c.validateConfig({ ...liveConfig('click'), credentials: { service_id: 'abc', merchant_id: '2', secret_key: 's' } });
    expect(r.problems).toEqual(['service_id must be a number']);
    expect((await c.validateConfig(liveConfig('click'))).ok).toBe(true);
  });
});

describe('Uzum adapter', () => {
  it('Merchant-API service → open-service deep link', async () => {
    const a = await reg.adapters.uzum.createIntent(input(), liveConfig('uzum'));
    if (a.type !== 'redirect') throw new Error('expected redirect');
    const u = new URL(a.url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ serviceId: '40001', order_id: ORDER_ID, amount: String(AMOUNT) });
  });

  it('Checkout API (no service_id) → registers through injected fetch and redirects', async () => {
    const fetch = vi.fn<HttpFetch>(async () => ({ ok: true, status: 200, json: async () => ({ errorCode: 0, result: { orderId: 'u1', paymentRedirectUrl: 'https://pay.uzum.example/u1' } }) }));
    const cfg = liveConfig('uzum', { credentials: { terminal_id: 'T1', api_key: 'K1' } });
    const a = await new UzumAdapter(fetch).createIntent(input(), cfg);
    expect(a).toEqual({ type: 'redirect', url: 'https://pay.uzum.example/u1', openWith: 'openLink' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toMatch(/\/api\/v1\/payment\/register$/);
    expect(init.headers).toMatchObject({ 'x-terminal-id': 'T1', 'x-api-key': 'K1' });
    expect(JSON.parse(init.body)).toMatchObject({ amount: AMOUNT, currency: 860, orderNumber: PAYMENT_ID, successUrl: RETURN });
  });

  it('validateConfig: terminal_id plus api_key or service_id (+ webhook credentials)', async () => {
    const u = new UzumAdapter();
    expect((await u.validateConfig({ ...liveConfig('uzum'), credentials: {} })).problems).toEqual(['terminal_id is required', 'api_key or service_id is required']);
    expect((await u.validateConfig({ ...liveConfig('uzum'), credentials: { terminal_id: 't', service_id: '1' } })).problems).toEqual([
      'webhook_login is required',
      'webhook_password is required',
    ]);
  });
});

describe('Telegram invoice adapters', () => {
  it('stars: createInvoiceLink with XTR, empty provider token, payload = payment id → invoice', async () => {
    const calls: InvoiceLinkParams[] = [];
    const r = createPaymentRegistry({ createInvoiceLink: async (p) => (calls.push(p), 'https://t.me/$abc') });
    const a = await r.adapters.stars.createIntent(input({ amount: 250, currency: 'XTR', isDigital: true, locale: 'en' }), liveConfig('stars'));
    expect(a).toEqual({ type: 'invoice', invoiceLink: 'https://t.me/$abc' });
    expect(calls[0]).toMatchObject({ title: 'Order #1001', payload: PAYMENT_ID, provider_token: '', currency: 'XTR', prices: [{ label: 'Order #1001', amount: 250 }] });
    expect(calls[0]!.description).toBe('Bozor: Choynak ×2');
  });

  it('stars refuses physical goods; telegram refuses digital goods', async () => {
    const r = createPaymentRegistry({ createInvoiceLink: async () => 'x' });
    await expect(r.adapters.stars.createIntent(input({ amount: 250, currency: 'XTR' }), liveConfig('stars'))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
    await expect(r.adapters.telegram.createIntent(input({ isDigital: true }), liveConfig('telegram'))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
  });

  it('telegram: passes the provider token and tiyin amounts', async () => {
    const calls: InvoiceLinkParams[] = [];
    const r = createPaymentRegistry({ createInvoiceLink: async (p) => (calls.push(p), 'https://t.me/$inv') });
    await r.adapters.telegram.createIntent(input(), liveConfig('telegram'));
    expect(calls[0]).toMatchObject({ provider_token: '1234567890:TEST:sandbox', currency: 'UZS', prices: [{ amount: AMOUNT }] });
    expect((await r.adapters.telegram.validateConfig({ ...liveConfig('telegram'), credentials: {} })).problems).toEqual(['provider_token is required']);
    expect((await r.adapters.stars.validateConfig({ ...liveConfig('stars'), credentials: {} })).ok).toBe(true);
  });

  it('sandbox mode never calls Telegram', async () => {
    const spy = vi.fn(async () => 'x');
    const r = createPaymentRegistry({ createInvoiceLink: spy });
    expect(await r.adapters.telegram.createIntent(input(), sandboxConfig('telegram'))).toMatchObject({ type: 'sandbox', url: `sandbox://telegram?payment=${PAYMENT_ID}` });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Offline adapters', () => {
  it('cod / bank_transfer → none with localized message (+ owner instructions)', async () => {
    const cod = await reg.adapters.cod.createIntent(input({ locale: 'ru' }), { provider: 'cod', mode: 'live', enabled: true, publicConfig: {}, credentials: {} });
    expect(cod).toEqual({ type: 'none', message: 'Оплата наличными или картой при получении заказа.' });
    const bank = await reg.adapters.bank_transfer.createIntent(input({ locale: 'en' }), {
      provider: 'bank_transfer',
      mode: 'live',
      enabled: true,
      publicConfig: { instructions_en: 'Use the order number as the payment reference.' },
      credentials: {},
    });
    expect(bank.type).toBe('none');
    if (bank.type === 'none') expect(bank.message).toMatch(/bank transfer[\s\S]*order number as the payment reference/);
  });
});

describe('availableMethods & registry', () => {
  const cfgs = (ids: Array<ProviderConfig['provider']>, disabled: string[] = []): ProviderConfig[] =>
    ids.map((provider) => ({ provider, mode: 'sandbox', enabled: !disabled.includes(provider), publicConfig: {}, credentials: {} }));
  const all = cfgs(['payme', 'click', 'uzum', 'telegram', 'stars', 'cod', 'bank_transfer', 'paynet', 'stripe']);

  it('digital goods → Stars only', () => {
    expect(availableMethods(all, { isDigital: true, currency: 'XTR' })).toEqual(['stars']);
    expect(availableMethods(all, { isDigital: true, currency: 'UZS' })).toEqual([]);
  });

  it('physical UZS → every enabled UZS provider, never Stars, never unsupported providers', () => {
    expect(availableMethods(all, { isDigital: false, currency: 'UZS' })).toEqual(['payme', 'click', 'uzum', 'telegram', 'cod', 'bank_transfer']);
  });

  it('disabled configs and currency filters apply', () => {
    expect(availableMethods(cfgs(['payme', 'click', 'cod'], ['click']), { isDigital: false, currency: 'UZS' })).toEqual(['payme', 'cod']);
    expect(availableMethods(all, { isDigital: false, currency: 'USD' })).toEqual(['telegram', 'cod', 'bank_transfer']);
    expect(availableMethods(cfgs(['payme', 'payme']), { isDigital: false, currency: 'UZS' })).toEqual(['payme']);
  });

  it('registry exposes adapters and handlers by provider id; capabilities follow the spec table', () => {
    expect(reg.adapter('payme')?.id).toBe('payme');
    expect(reg.adapter('paynet')).toBeUndefined();
    expect(reg.handler('click')?.id).toBe('click');
    expect(reg.handler('stars')?.id).toBe('stars');
    expect(reg.handler('cod')).toBeUndefined();
    expect(CAPABILITIES.stars).toEqual({ currencies: ['XTR'], goods: ['digital'], refunds: 'full', flow: 'invoice', fiscalReceipts: false });
    expect(reg.adapters.payme.capabilities.fiscalReceipts).toBe(true);
    expect(reg.adapters.cod.capabilities.flow).toBe('offline');
  });
});
