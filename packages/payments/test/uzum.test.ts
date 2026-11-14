import { describe, expect, it } from 'vitest';
import { UZUM_ERROR, UzumMerchantHandler, basicHeader, sandboxConfig } from '../src';
import type { MemoryLedger } from '../src';
import { AMOUNT, NOW, ORDER_ID, jsonReq, setup } from './helpers';

const cfg = sandboxConfig('uzum');
const AUTH = basicHeader('uzum', 'sandbox-uzum-password');
const TRANS = '9f1c2d3e-0000-4000-a000-000000000001';
const handler = new UzumMerchantHandler();

async function call(ledger: MemoryLedger, action: string, body: Record<string, unknown>, auth = AUTH) {
  const res = await handler.handle(jsonReq({ serviceId: 40001, timestamp: NOW, ...body }, { authorization: auth }, { action }), cfg, ledger);
  return { status: res.status, body: JSON.parse(res.body) as Record<string, unknown> };
}

const params = { order_id: ORDER_ID };

describe('Uzum Merchant API webhooks', () => {
  it('check (no amount) → OK when the order exists and is payable', async () => {
    const r = await call(setup(), 'check', { params });
    expect(r).toEqual({ status: 200, body: { serviceId: 40001, timestamp: NOW, status: 'OK', data: { order_id: { value: ORDER_ID } } } });
  });

  it('check with an amount validates it and echoes it back', async () => {
    expect((await call(setup(), 'check', { params, amount: AMOUNT })).body.data).toEqual({ order_id: { value: ORDER_ID }, amount: { value: AMOUNT } });
    expect((await call(setup(), 'check', { params, amount: AMOUNT + 1 })).body.errorCode).toBe(UZUM_ERROR.WRONG_AMOUNT);
    expect((await call(setup({ status: 'paid' }), 'check', { params })).body.errorCode).toBe(UZUM_ERROR.ALREADY_PAID);
  });

  it('check of an unknown order → HTTP 400 FAILED 10007', async () => {
    const r = await call(setup(), 'check', { params: { order_id: 'nope' } });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ status: 'FAILED', errorCode: UZUM_ERROR.ORDER_NOT_FOUND });
  });

  it('create → confirm → status: CREATED, CONFIRMED, order paid; create is idempotent', async () => {
    const ledger = setup();
    const c1 = await call(ledger, 'create', { transId: TRANS, params, amount: AMOUNT });
    expect(c1.body).toMatchObject({ status: 'CREATED', transId: TRANS, transTime: NOW, amount: AMOUNT });
    const c2 = await call(ledger, 'create', { transId: TRANS, params, amount: AMOUNT });
    expect(c2.body.status).toBe('CREATED');
    ledger.advance(5_000);
    const conf = await call(ledger, 'confirm', { transId: TRANS, paymentSource: 'UZCARD' });
    expect(conf.body).toMatchObject({ status: 'CONFIRMED', confirmTime: NOW + 5_000 });
    expect((await call(ledger, 'confirm', { transId: TRANS })).body.status).toBe('CONFIRMED');
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
    expect((await call(ledger, 'status', { transId: TRANS })).body).toMatchObject({ status: 'CONFIRMED' });
  });

  it('reverse after confirm → REVERSED, order cancelled + refunded', async () => {
    const ledger = setup();
    await call(ledger, 'create', { transId: TRANS, params, amount: AMOUNT });
    await call(ledger, 'confirm', { transId: TRANS });
    const r = await call(ledger, 'reverse', { transId: TRANS });
    expect(r.body).toMatchObject({ status: 'REVERSED' });
    expect(ledger.order(ORDER_ID)?.status).toBe('cancelled');
  });

  it('wrong amount on create → 10011; unknown transaction → 10014', async () => {
    const ledger = setup();
    expect((await call(ledger, 'create', { transId: TRANS, params, amount: AMOUNT + 1 })).body.errorCode).toBe(UZUM_ERROR.WRONG_AMOUNT);
    expect((await call(ledger, 'confirm', { transId: 'missing' })).body.errorCode).toBe(UZUM_ERROR.TXN_NOT_FOUND);
  });

  it('bad Basic credentials → 10001; wrong serviceId → 10006; unknown route → 10003', async () => {
    const ledger = setup();
    const bad = await call(ledger, 'check', { params }, basicHeader('uzum', 'nope'));
    expect(bad).toMatchObject({ status: 400, body: { errorCode: UZUM_ERROR.ACCESS_DENIED } });
    expect(ledger.events.at(-1)?.signatureOk).toBe(false);
    expect((await call(ledger, 'check', { params, serviceId: 1 })).body.errorCode).toBe(UZUM_ERROR.WRONG_SERVICE_ID);
    expect((await call(ledger, 'refund', { params })).body.errorCode).toBe(UZUM_ERROR.INVALID_OPERATION);
  });

  it('a second transId while one is live → 10010 (order busy)', async () => {
    const ledger = setup();
    await call(ledger, 'create', { transId: TRANS, params, amount: AMOUNT });
    expect((await call(ledger, 'create', { transId: 'other', params, amount: AMOUNT })).body.errorCode).toBe(UZUM_ERROR.ORDER_BUSY);
  });
});
