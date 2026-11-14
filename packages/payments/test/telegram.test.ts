import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramPaymentsHandler, answerPreCheckout, processSuccessfulPayment, sandboxConfig, telegramProviderFor } from '../src';
import type { PreCheckoutQuery, SuccessfulPayment } from '../src';
import { AMOUNT, ORDER_ID, PAYMENT_ID, jsonReq, liveConfig, setup } from './helpers';

const STARS = 250;
const starsSetup = () => setup({ amount: STARS, currency: 'XTR', isDigital: true });

const query = (over: Partial<PreCheckoutQuery> = {}): PreCheckoutQuery => ({
  id: '4382bfdwdsb323b2d9',
  from: { id: 42, language_code: 'ru' },
  currency: 'XTR',
  total_amount: STARS,
  invoice_payload: PAYMENT_ID,
  ...over,
});

const success = (over: Partial<SuccessfulPayment> = {}): SuccessfulPayment => ({
  currency: 'XTR',
  total_amount: STARS,
  invoice_payload: PAYMENT_ID,
  telegram_payment_charge_id: 'stxABC123',
  provider_payment_charge_id: '',
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pre_checkout_query', () => {
  it('payable invoice → ok', async () => {
    const ledger = starsSetup();
    expect(await answerPreCheckout(query(), ledger, { provider: 'stars' })).toEqual({ ok: true });
    expect(ledger.events.at(-1)).toMatchObject({ provider: 'stars', kind: 'pre_checkout_query', response: '{"ok":true}' });
  });

  it('changed total → ok=false with a localized message', async () => {
    const a = await answerPreCheckout(query({ total_amount: STARS + 1 }), starsSetup(), { provider: 'stars' });
    expect(a).toEqual({ ok: false, reason: 'amount_mismatch', error_message: 'Сумма заказа изменилась. Пожалуйста, обновите корзину.' });
  });

  it('unknown payment / paid order / wrong currency → ok=false', async () => {
    expect((await answerPreCheckout(query({ invoice_payload: 'nope' }), starsSetup(), { provider: 'stars' })).ok).toBe(false);
    const paid = await answerPreCheckout(query(), setup({ amount: STARS, currency: 'XTR', status: 'paid' }), { provider: 'stars' });
    expect(paid).toMatchObject({ ok: false, reason: 'already_paid' });
    const cur = await answerPreCheckout(query({ currency: 'UZS' }), starsSetup(), { provider: 'stars' });
    expect(cur).toMatchObject({ ok: false, reason: 'currency_mismatch' });
    const tg = await answerPreCheckout(query({ currency: 'USD', total_amount: AMOUNT }), setup(), { provider: 'telegram' });
    expect(tg).toMatchObject({ ok: false, reason: 'currency_mismatch' });
  });

  it('deadline: validation slower than 9 s → ok=false "timeout" exactly at 9 s (fake timers)', async () => {
    vi.useFakeTimers();
    const ledger = starsSetup();
    ledger.latencyMs = 9_500;
    let settled = false;
    const p = answerPreCheckout(query(), ledger, { provider: 'stars' }).then((a) => {
      settled = true;
      return a;
    });
    await vi.advanceTimersByTimeAsync(8_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('deadline: validation taking 8 s still answers ok', async () => {
    vi.useFakeTimers();
    const ledger = starsSetup();
    ledger.latencyMs = 8_000;
    const p = answerPreCheckout(query(), ledger, { provider: 'stars' });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await p).toEqual({ ok: true });
  });

  it('deadline is configurable (real timers, injected slow ledger)', async () => {
    const ledger = starsSetup();
    ledger.latencyMs = 80;
    const a = await answerPreCheckout(query(), ledger, { provider: 'stars', deadlineMs: 20 });
    expect(a).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('successful_payment', () => {
  it('opens + confirms the transaction keyed by telegram_payment_charge_id', async () => {
    const ledger = starsSetup();
    const r = await processSuccessfulPayment(success(), ledger, { provider: 'stars' });
    expect(r).toMatchObject({ ok: true, duplicate: false, txn: { status: 'paid', providerTxnId: 'stxABC123', paymentId: PAYMENT_ID } });
    expect(ledger.order(ORDER_ID)?.status).toBe('paid');
  });

  it('is idempotent: the same charge twice pays once and reports duplicate', async () => {
    const ledger = starsSetup();
    await processSuccessfulPayment(success(), ledger, { provider: 'stars' });
    const again = await processSuccessfulPayment(success(), ledger, { provider: 'stars' });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
    expect(ledger.transactions('stars')).toHaveLength(1);
  });

  it('charge for an order that can no longer be paid → needsRefund', async () => {
    const ledger = starsSetup();
    ledger.order(ORDER_ID)!.status = 'cancelled';
    expect(await processSuccessfulPayment(success(), ledger, { provider: 'stars' })).toMatchObject({ ok: false, needsRefund: true, reason: 'cancelled' });
  });

  it('routes XTR to stars and everything else to telegram', () => {
    expect(telegramProviderFor('XTR')).toBe('stars');
    expect(telegramProviderFor('UZS')).toBe('telegram');
  });
});

describe('TelegramPaymentsHandler (raw webhook updates)', () => {
  const cfg = sandboxConfig('stars');
  const SECRET = { 'x-telegram-bot-api-secret-token': 'sandbox-telegram-secret' };

  it('answers pre_checkout_query in the webhook response body', async () => {
    const ledger = starsSetup();
    const res = await new TelegramPaymentsHandler('stars').handle(jsonReq({ update_id: 1, pre_checkout_query: query() }, SECRET), cfg, ledger);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ method: 'answerPreCheckoutQuery', pre_checkout_query_id: '4382bfdwdsb323b2d9', ok: true });
  });

  it('answers ok=false with error_message when the deadline passes', async () => {
    const ledger = starsSetup();
    ledger.latencyMs = 60;
    const res = await new TelegramPaymentsHandler('stars', { deadlineMs: 15 }).handle(jsonReq({ update_id: 1, pre_checkout_query: query() }, SECRET), cfg, ledger);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, error_message: expect.stringMatching(/вовремя/) });
  });

  it('records successful_payment from a message update', async () => {
    const ledger = starsSetup();
    const update = { update_id: 2, message: { message_id: 5, date: 1_700_000_000, chat: { id: 42, type: 'private' }, successful_payment: success() } };
    const res = await new TelegramPaymentsHandler('stars').handle(jsonReq(update, SECRET), cfg, ledger);
    expect(res.status).toBe(200);
    expect((await ledger.getTransaction('stars', 'stxABC123'))?.providerTime.getTime()).toBe(1_700_000_000_000);
  });

  it('rejects a wrong secret token (401) and requires a secret in live mode', async () => {
    const ledger = starsSetup();
    const h = new TelegramPaymentsHandler('stars');
    const bad = await h.handle(jsonReq({ update_id: 1, pre_checkout_query: query() }, { 'x-telegram-bot-api-secret-token': 'nope' }), cfg, ledger);
    expect(bad.status).toBe(401);
    expect(ledger.events.at(-1)).toMatchObject({ kind: 'unauthenticated', signatureOk: false });
    expect(h.authenticate(jsonReq('{}'), liveConfig('stars', { credentials: {} }))).toEqual({ ok: false, reason: 'webhook_secret is not configured' });
    expect(h.authenticate(jsonReq('{}'), sandboxConfig('stars'))).toEqual({ ok: false, reason: 'bad secret token' });
  });

  it('ignores unrelated updates with 200', async () => {
    const ledger = starsSetup();
    const res = await new TelegramPaymentsHandler('stars').handle(jsonReq({ update_id: 3, message: { text: 'hi' } }, SECRET), cfg, ledger);
    expect(res.status).toBe(200);
    expect(ledger.events.at(-1)?.kind).toBe('ignored_update');
  });
});
