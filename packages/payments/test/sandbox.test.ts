import { describe, expect, it } from 'vitest';
import { PAYME_TXN_TIMEOUT_MS } from '@dokonim/core';
import {
  ClickWebhookHandler,
  MemoryLedger,
  SandboxClick,
  SandboxPayme,
  SandboxTelegramInvoice,
  SandboxUzum,
  TelegramPaymentsHandler,
  delayedLedger,
  formatTashkentTime,
  parseTashkentTime,
  somToTiyin,
  tiyinToSom,
  withDeadline,
} from '../src';
import type { ProtocolMessage } from '../src';
import { AMOUNT, NOW, ORDER_ID, PAYMENT_ID, setup } from './helpers';

const labels = (m: ProtocolMessage[]) => m.filter((x) => x.direction === 'request').map((x) => x.label);

describe('SandboxPayme drives the real PaymeWebhookHandler', () => {
  it('success: Check → Create → Perform, order paid, live log streamed', async () => {
    const ledger = setup();
    const seen: ProtocolMessage[] = [];
    const r = await new SandboxPayme({ ledger, onMessage: (m) => seen.push(m) }).pay(ORDER_ID, AMOUNT, 'success');
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['CheckPerformTransaction', 'CreateTransaction', 'PerformTransaction']);
    expect(seen).toEqual(r.messages);
    expect(seen.map((m) => m.direction)).toEqual(['request', 'response', 'request', 'response', 'request', 'response']);
    expect(seen[1]).toMatchObject({ provider: 'payme', body: { result: { allow: true } }, status: 200, at: NOW });
    expect(ledger.order(ORDER_ID)?.status).toBe('paid');
    // every simulator call went through authentication
    expect(ledger.events.every((e) => e.signatureOk)).toBe(true);
  });

  it('insufficient_funds: Create then Cancel with reason 2 → failed, order still payable', async () => {
    const ledger = setup();
    const r = await new SandboxPayme({ ledger }).pay(ORDER_ID, AMOUNT, 'insufficient_funds');
    expect(r.status).toBe('failed');
    expect(labels(r.messages)).toEqual(['CheckPerformTransaction', 'CreateTransaction', 'CancelTransaction', 'CheckTransaction']);
    expect(ledger.transactions('payme')[0]).toMatchObject({ status: 'cancelled', cancelReason: 2 });
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
  });

  it('timeout: advances the merchant clock past 12 h; Perform answers −31008 and the txn is cancelled with reason 4', async () => {
    const ledger = setup();
    const r = await new SandboxPayme({ ledger }).pay(ORDER_ID, AMOUNT, 'timeout');
    expect(r.status).toBe('cancelled');
    const perform = r.messages.find((m) => m.direction === 'response' && m.label === 'PerformTransaction');
    expect(perform?.body).toMatchObject({ error: { code: -31008 } });
    expect(ledger.transactions('payme')[0]).toMatchObject({ status: 'cancelled', cancelReason: 4 });
    expect(ledger.now().getTime()).toBeGreaterThan(NOW + PAYME_TXN_TIMEOUT_MS);
  });

  it('timeout without a controllable clock falls back to CancelTransaction(reason 4)', async () => {
    const base = setup();
    const r = await new SandboxPayme({ ledger: delayedLedger(base, 0) }).pay(ORDER_ID, AMOUNT, 'timeout');
    expect(r.status).toBe('cancelled');
    expect(labels(r.messages)).toContain('CancelTransaction');
    expect(base.transactions('payme')[0]?.cancelReason).toBe(4);
  });

  it('wrong_amount: stops at CheckPerformTransaction with −31001', async () => {
    const ledger = setup();
    const r = await new SandboxPayme({ ledger }).pay(ORDER_ID, AMOUNT, 'wrong_amount');
    expect(r).toMatchObject({ status: 'failed', detail: 'Incorrect amount' });
    expect(labels(r.messages)).toEqual(['CheckPerformTransaction']);
  });
});

describe('SandboxClick drives the real ClickWebhookHandler', () => {
  it('success: Prepare → Complete with real md5 signatures', async () => {
    const ledger = setup();
    const r = await new SandboxClick({ ledger }).pay(ORDER_ID, AMOUNT);
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['prepare', 'complete']);
    expect((r.messages[0]!.body as Record<string, string>).sign_string).toMatch(/^[0-9a-f]{32}$/);
    expect(ledger.order(ORDER_ID)?.status).toBe('paid');
  });

  it('duplicate_complete: second Complete answers 0 again, paid once', async () => {
    const ledger = setup();
    const r = await new SandboxClick({ ledger }).pay(ORDER_ID, AMOUNT, 'duplicate_complete');
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['prepare', 'complete', 'complete']);
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
  });

  it('bad_signature → −1, failed', async () => {
    const ledger = setup();
    const r = await new SandboxClick({ ledger }).pay(ORDER_ID, AMOUNT, 'bad_signature');
    expect(r).toMatchObject({ status: 'failed', detail: 'SIGN CHECK FAILED!' });
    expect(ledger.transactions()).toHaveLength(0);
  });

  it('wrong_amount → −2, failed', async () => {
    const r = await new SandboxClick({ ledger: setup() }).pay(ORDER_ID, AMOUNT, 'wrong_amount');
    expect(r).toMatchObject({ status: 'failed', detail: 'Incorrect parameter amount' });
  });

  it('user_cancelled: Complete with error < 0 → −9, cancelled', async () => {
    const ledger = setup();
    const r = await new SandboxClick({ ledger }).pay(ORDER_ID, AMOUNT, 'user_cancelled');
    expect(r).toMatchObject({ status: 'cancelled', detail: 'Transaction cancelled' });
    expect(ledger.transactions('click')[0]?.status).toBe('cancelled');
  });

  it('works against a live-mode handler with a freshness window (sign_time from the provider clock)', async () => {
    const ledger = setup();
    const r = await new SandboxClick({ ledger, handler: new ClickWebhookHandler({ signTimeWindowMs: 60_000 }) }).pay(ORDER_ID, AMOUNT);
    expect(r.status).toBe('paid');
  });
});

describe('SandboxUzum drives the real UzumMerchantHandler', () => {
  it('success: check → create → confirm → status', async () => {
    const ledger = setup();
    const r = await new SandboxUzum({ ledger }).pay(ORDER_ID, AMOUNT);
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['check', 'create', 'confirm', 'status']);
  });

  it('reversed: create → reverse → cancelled', async () => {
    const ledger = setup();
    const r = await new SandboxUzum({ ledger }).pay(ORDER_ID, AMOUNT, 'reversed');
    expect(r.status).toBe('cancelled');
    expect(ledger.transactions('uzum')[0]?.status).toBe('cancelled');
  });

  it('wrong_amount → failed at create', async () => {
    const r = await new SandboxUzum({ ledger: setup() }).pay(ORDER_ID, AMOUNT, 'wrong_amount');
    expect(r.status).toBe('failed');
    expect(r.messages.at(-1)?.status).toBe(400);
  });
});

describe('SandboxTelegramInvoice drives the real TelegramPaymentsHandler', () => {
  const starsLedger = () => setup({ amount: 250, currency: 'XTR', isDigital: true });

  it('stars success: pre_checkout_query → successful_payment', async () => {
    const ledger = starsLedger();
    const r = await new SandboxTelegramInvoice({ ledger, provider: 'stars' }).pay(PAYMENT_ID, 250);
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['pre_checkout_query', 'successful_payment']);
    expect(r.messages[1]?.body).toMatchObject({ method: 'answerPreCheckoutQuery', ok: true });
  });

  it('telegram (UZS) success', async () => {
    const ledger = setup();
    const r = await new SandboxTelegramInvoice({ ledger, provider: 'telegram' }).pay(PAYMENT_ID, AMOUNT);
    expect(r.status).toBe('paid');
    expect(ledger.transactions('telegram')).toHaveLength(1);
  });

  it('duplicate_success is recorded once', async () => {
    const ledger = starsLedger();
    const r = await new SandboxTelegramInvoice({ ledger }).pay(PAYMENT_ID, 250, 'duplicate_success');
    expect(r.status).toBe('paid');
    expect(labels(r.messages)).toEqual(['pre_checkout_query', 'successful_payment', 'successful_payment']);
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
  });

  it('wrong_amount → pre_checkout rejected, failed', async () => {
    const r = await new SandboxTelegramInvoice({ ledger: starsLedger() }).pay(PAYMENT_ID, 250, 'wrong_amount');
    expect(r.status).toBe('failed');
    expect(r.messages[1]?.body).toMatchObject({ ok: false });
  });

  it('slow_merchant: validation misses the deadline → ok=false, nothing charged', async () => {
    const ledger = starsLedger();
    const sim = new SandboxTelegramInvoice({ ledger, handler: new TelegramPaymentsHandler('stars', { deadlineMs: 20 }), slowMs: 80 });
    const r = await sim.pay(PAYMENT_ID, 250, 'slow_merchant');
    expect(r.status).toBe('failed');
    expect(labels(r.messages)).toEqual(['pre_checkout_query']);
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
  });
});

describe('MemoryLedger semantics', () => {
  it('cancel before perform → cancelled (order payable); after perform → refunded (order cancelled); both idempotent', async () => {
    const ledger = new MemoryLedger({ now: NOW });
    const a = ledger.addOrder({ id: 'a', amount: 100 });
    const b = ledger.addOrder({ id: 'b', amount: 100 });
    await ledger.openTransaction({ provider: 'payme', providerTxnId: 'ta', orderId: 'a', amount: 100, providerTime: new Date(NOW) });
    await ledger.openTransaction({ provider: 'payme', providerTxnId: 'tb', orderId: 'b', amount: 100, providerTime: new Date(NOW) });
    await ledger.confirmTransaction('payme', 'tb');
    expect((await ledger.cancelTransaction('payme', 'ta', 3)).status).toBe('cancelled');
    expect((await ledger.cancelTransaction('payme', 'tb', 5)).status).toBe('refunded');
    expect((await ledger.cancelTransaction('payme', 'tb', 1)).cancelReason).toBe(5);
    expect(ledger.order(a.orderId)?.status).toBe('pending_payment');
    expect(ledger.order(b.orderId)?.status).toBe('cancelled');
  });

  it('openTransaction is idempotent and binds the initial payment; a second attempt gets a new payment', async () => {
    const ledger = setup();
    const t1 = await ledger.openTransaction({ provider: 'click', providerTxnId: '1', orderId: ORDER_ID, amount: AMOUNT, providerTime: new Date(NOW) });
    const again = await ledger.openTransaction({ provider: 'click', providerTxnId: '1', orderId: ORDER_ID, amount: AMOUNT, providerTime: new Date(NOW + 5) });
    expect(again).toEqual(t1);
    expect(t1.paymentId).toBe(PAYMENT_ID);
    await ledger.cancelTransaction('click', '1', 1);
    const t2 = await ledger.openTransaction({ provider: 'click', providerTxnId: '2', orderId: ORDER_ID, amount: AMOUNT, providerTime: new Date(NOW) });
    expect(t2.paymentId).not.toBe(PAYMENT_ID);
    expect(ledger.paymentsOf(ORDER_ID)).toHaveLength(2);
  });

  it('checkPayable resolves by order id, payment id and order number', async () => {
    const ledger = setup();
    expect((await ledger.checkPayable({ orderId: ORDER_ID }, AMOUNT)).ok).toBe(true);
    expect((await ledger.checkPayable({ paymentId: PAYMENT_ID }, AMOUNT)).ok).toBe(true);
    expect((await ledger.checkPayable({ orderId: '1001' }, AMOUNT)).ok).toBe(true);
    expect(await ledger.checkPayable({ orderId: ORDER_ID }, 1)).toEqual({ ok: false, reason: 'amount_mismatch' });
    expect(await ledger.checkPayable({}, AMOUNT)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('helpers', () => {
  it("tiyin ↔ so'm conversions are exact", () => {
    expect(tiyinToSom(1_234_567)).toBe('12345.67');
    expect(tiyinToSom(5)).toBe('0.05');
    expect(somToTiyin('12345.67')).toBe(1_234_567);
    expect(somToTiyin('15000')).toBe(1_500_000);
    expect(somToTiyin('15000.5')).toBe(1_500_050);
    expect(somToTiyin('1.000')).toBe(100);
    expect(somToTiyin('1.001')).toBeNull();
    expect(somToTiyin('-1')).toBeNull();
    expect(somToTiyin('abc')).toBeNull();
  });

  it('Tashkent time (UTC+5) round-trips', () => {
    expect(formatTashkentTime(new Date(NOW))).toBe('2026-11-14 10:00:00');
    expect(parseTashkentTime('2026-11-14 10:00:00')?.getTime()).toBe(NOW);
    expect(parseTashkentTime('yesterday')).toBeNull();
  });

  it('withDeadline resolves the work or times out', async () => {
    expect(await withDeadline(Promise.resolve(1), 50)).toEqual({ ok: true, value: 1 });
    expect(await withDeadline(new Promise((r) => setTimeout(() => r(1), 100)), 10)).toEqual({ ok: false, timedOut: true });
  });
});
