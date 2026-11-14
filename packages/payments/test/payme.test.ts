import { describe, expect, it } from 'vitest';
import { PAYME_TXN_TIMEOUT_MS } from '@dokonim/core';
import { MemoryLedger, PAYME_ERROR, PaymeWebhookHandler, paymeAuthHeader, sandboxConfig } from '../src';
import { AMOUNT, NOW, ORDER_ID, PAYMENT_ID, jsonReq, setup } from './helpers';

const cfg = sandboxConfig('payme');
const AUTH = 'Basic UGF5Y29tOnNhbmRib3gtcGF5bWUta2V5'; // base64("Paycom:sandbox-payme-key")
const TXN = '5e730e8e0b852a417aa49ceb';
const TXN2 = '5e730e8e0b852a417aa49cec';
const handler = new PaymeWebhookHandler();

async function rpc(ledger: MemoryLedger, method: string, params: Record<string, unknown>, id: number = 1) {
  const res = await handler.handle(jsonReq({ jsonrpc: '2.0', id, method, params }, { authorization: AUTH }), cfg, ledger);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  return JSON.parse(res.body) as { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: Record<string, string>; data?: string } };
}

const account = { order_id: ORDER_ID };
const create = (ledger: MemoryLedger, id = TXN, amount = AMOUNT) => rpc(ledger, 'CreateTransaction', { id, time: NOW - 1000, amount, account });

function expectError(r: Awaited<ReturnType<typeof rpc>>, code: number) {
  expect(r.result).toBeUndefined();
  expect(r.error?.code).toBe(code);
  expect(Object.keys(r.error?.message ?? {}).sort()).toEqual(['en', 'ru', 'uz']);
}

describe('Payme auth & transport', () => {
  it('builds the exact Basic header Payme sends', () => {
    expect(paymeAuthHeader('sandbox-payme-key')).toBe(AUTH);
  });

  it('wrong key → −32504 with HTTP 200', async () => {
    const ledger = setup();
    const res = await handler.handle(
      jsonReq({ jsonrpc: '2.0', id: 7, method: 'CheckPerformTransaction', params: { amount: AMOUNT, account } }, { authorization: paymeAuthHeader('wrong') }),
      cfg,
      ledger,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ id: 7, error: { code: -32504 } });
    expect(body.error.message.ru).toBe('Недостаточно привилегий для выполнения метода');
    expect(ledger.events.at(-1)).toMatchObject({ provider: 'payme', kind: 'CheckPerformTransaction', signatureOk: false });
  });

  it('missing Authorization header → −32504', async () => {
    const ledger = setup();
    const res = await handler.handle(jsonReq({ jsonrpc: '2.0', id: 1, method: 'CheckTransaction', params: { id: TXN } }), cfg, ledger);
    expect(JSON.parse(res.body).error.code).toBe(PAYME_ERROR.INSUFFICIENT_PRIVILEGE);
  });

  it('wrong login (not "Paycom") → −32504', async () => {
    const ledger = setup();
    const bad = `Basic ${btoa('Admin:sandbox-payme-key')}`;
    const res = await handler.handle(jsonReq({ jsonrpc: '2.0', id: 1, method: 'CheckTransaction', params: { id: TXN } }, { authorization: bad }), cfg, ledger);
    expect(JSON.parse(res.body).error.code).toBe(-32504);
  });

  it('authenticate() is case-insensitive on the header name', () => {
    expect(handler.authenticate(jsonReq('{}', { Authorization: AUTH }), cfg)).toEqual({ ok: true });
    expect(handler.authenticate(jsonReq('{}', { Authorization: AUTH }), { ...cfg, credentials: {} }).ok).toBe(false);
  });

  it('malformed JSON → −32700 with id null', async () => {
    const ledger = setup();
    const res = await handler.handle(jsonReq('{"jsonrpc":"2.0",', { authorization: AUTH }), cfg, ledger);
    expect(JSON.parse(res.body)).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it('non-POST → −32300', async () => {
    const ledger = setup();
    const res = await handler.handle(jsonReq('', { authorization: AUTH }, { method: 'GET' }), cfg, ledger);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).error.code).toBe(-32300);
  });

  it('unknown method → −32601', async () => {
    const r = await rpc(setup(), 'ChangeEverything', {});
    expectError(r, -32601);
    expect(r.error?.data).toBe('ChangeEverything');
  });

  it('missing params / bad field types → −32600', async () => {
    const ledger = setup();
    const res = await handler.handle(jsonReq({ jsonrpc: '2.0', id: 3, method: 'CheckTransaction' }, { authorization: AUTH }), cfg, ledger);
    expect(JSON.parse(res.body)).toMatchObject({ id: 3, error: { code: -32600 } });
    expectError(await rpc(ledger, 'CreateTransaction', { id: TXN, time: 'yesterday', amount: AMOUNT, account }), -32600);
    expectError(await rpc(ledger, 'PerformTransaction', {}), -32600);
  });

  it('logs every call with the raw payload and the exact response', async () => {
    const ledger = setup();
    await rpc(ledger, 'CheckPerformTransaction', { amount: AMOUNT, account });
    const e = ledger.events.at(-1)!;
    expect(e).toMatchObject({ provider: 'payme', kind: 'CheckPerformTransaction', signatureOk: true });
    expect(JSON.parse(e.payload).params.account.order_id).toBe(ORDER_ID);
    expect(JSON.parse(e.response)).toEqual({ jsonrpc: '2.0', id: 1, result: { allow: true } });
  });
});

describe('Payme CheckPerformTransaction', () => {
  it('fixture: payable order → { allow: true }', async () => {
    expect(await rpc(setup(), 'CheckPerformTransaction', { amount: AMOUNT, account }, 101)).toEqual({ jsonrpc: '2.0', id: 101, result: { allow: true } });
  });

  it('wrong amount → −31001', async () => {
    const r = await rpc(setup(), 'CheckPerformTransaction', { amount: AMOUNT - 100, account });
    expectError(r, -31001);
    expect(r.error?.data).toBe('amount');
    expect(r.error?.message.en).toBe('Incorrect amount');
  });

  it('non-positive / fractional amount → −31001', async () => {
    expectError(await rpc(setup(), 'CheckPerformTransaction', { amount: 0, account }), -31001);
    expectError(await rpc(setup(), 'CheckPerformTransaction', { amount: 10.5, account }), -31001);
  });

  it('unknown order → −31050 (order_id)', async () => {
    const r = await rpc(setup(), 'CheckPerformTransaction', { amount: AMOUNT, account: { order_id: 'nope' } });
    expectError(r, -31050);
    expect(r.error?.data).toBe('order_id');
    expect(r.error?.message.en).toBe('Order not found');
  });

  it('missing account → −31050', async () => {
    expectError(await rpc(setup(), 'CheckPerformTransaction', { amount: AMOUNT }), -31050);
  });

  it('already paid / cancelled / not payable order → −31050', async () => {
    for (const status of ['paid', 'cancelled', 'awaiting_confirmation'] as const) {
      const r = await rpc(setup({ status }), 'CheckPerformTransaction', { amount: AMOUNT, account });
      expectError(r, -31050);
    }
  });

  it('order busy (another live Payme transaction) → −31050', async () => {
    const ledger = setup();
    await create(ledger);
    const r = await rpc(ledger, 'CheckPerformTransaction', { amount: AMOUNT, account });
    expectError(r, -31050);
    expect(r.error?.message.en).toMatch(/already in progress/);
  });
});

describe('Payme CreateTransaction', () => {
  it('fixture: creates and returns our create_time, payment id and state 1', async () => {
    const ledger = setup();
    expect(await create(ledger)).toEqual({ jsonrpc: '2.0', id: 1, result: { create_time: NOW, transaction: PAYMENT_ID, state: 1 } });
    expect(ledger.payment(PAYMENT_ID)?.status).toBe('pending');
  });

  it('idempotent: the same id returns the same result and creates nothing new', async () => {
    const ledger = setup();
    const a = await create(ledger);
    ledger.advance(5_000);
    const b = await create(ledger);
    expect(b.result).toEqual(a.result);
    expect(ledger.transactions('payme')).toHaveLength(1);
  });

  it('a second transaction id for the same order → −31050 (busy)', async () => {
    const ledger = setup();
    await create(ledger);
    expectError(await create(ledger, TXN2), -31050);
  });

  it('wrong amount → −31001; unknown order → −31050', async () => {
    const ledger = setup();
    expectError(await create(ledger, TXN, AMOUNT + 1), -31001);
    expectError(await rpc(ledger, 'CreateTransaction', { id: TXN, time: NOW, amount: AMOUNT, account: { order_id: 'x' } }), -31050);
  });

  it('re-create of an existing transaction after 12 h → cancelled with reason 4 and −31008', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(PAYME_TXN_TIMEOUT_MS + 1);
    const r = await create(ledger);
    expectError(r, -31008);
    const t = await ledger.getTransaction('payme', TXN);
    expect(t).toMatchObject({ status: 'cancelled', cancelReason: 4 });
  });

  it('an expired other transaction no longer blocks the order: it is cancelled (reason 4) and the new one is created', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(PAYME_TXN_TIMEOUT_MS + 1);
    const r = await create(ledger, TXN2);
    expect(r.result).toMatchObject({ state: 1 });
    expect(r.result?.transaction).not.toBe(PAYMENT_ID); // a new payment attempt
    expect((await ledger.getTransaction('payme', TXN))?.cancelReason).toBe(4);
  });

  it('create of a cancelled transaction → −31008', async () => {
    const ledger = setup();
    await create(ledger);
    await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 3 });
    expectError(await create(ledger), -31008);
  });
});

describe('Payme PerformTransaction', () => {
  it('fixture: performs → state 2 with our perform_time, order becomes paid', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(30_000);
    expect(await rpc(ledger, 'PerformTransaction', { id: TXN }, 2)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { transaction: PAYMENT_ID, perform_time: NOW + 30_000, state: 2 },
    });
    expect(ledger.order(ORDER_ID)?.status).toBe('paid');
  });

  it('idempotent: repeated perform returns the same perform_time and pays once', async () => {
    const ledger = setup();
    await create(ledger);
    const a = await rpc(ledger, 'PerformTransaction', { id: TXN });
    ledger.advance(60_000);
    const b = await rpc(ledger, 'PerformTransaction', { id: TXN });
    expect(b.result).toEqual(a.result);
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
  });

  it('unknown transaction → −31003', async () => {
    const r = await rpc(setup(), 'PerformTransaction', { id: 'missing' });
    expectError(r, -31003);
    expect(r.error?.message.uz).toBe('Tranzaksiya topilmadi');
  });

  it('12 h timeout: perform after 43 200 001 ms → cancelled with reason 4 and −31008', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(PAYME_TXN_TIMEOUT_MS + 1);
    expectError(await rpc(ledger, 'PerformTransaction', { id: TXN }), -31008);
    const check = await rpc(ledger, 'CheckTransaction', { id: TXN });
    expect(check.result).toMatchObject({ state: -1, reason: 4, perform_time: 0, cancel_time: NOW + PAYME_TXN_TIMEOUT_MS + 1 });
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
  });

  it('exactly 12 h is still in time', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(PAYME_TXN_TIMEOUT_MS);
    expect((await rpc(ledger, 'PerformTransaction', { id: TXN })).result).toMatchObject({ state: 2 });
  });

  it('perform of a cancelled transaction → −31008', async () => {
    const ledger = setup();
    await create(ledger);
    await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 3 });
    expectError(await rpc(ledger, 'PerformTransaction', { id: TXN }), -31008);
  });

  it('order cancelled by the shop meanwhile → −31008', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.order(ORDER_ID)!.status = 'cancelled';
    expectError(await rpc(ledger, 'PerformTransaction', { id: TXN }), -31008);
  });
});

describe('Payme CancelTransaction', () => {
  it('fixture: before perform → state −1, order stays payable', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(1_000);
    expect(await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 3 }, 9)).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: { transaction: PAYMENT_ID, cancel_time: NOW + 1_000, state: -1 },
    });
    expect(ledger.payment(PAYMENT_ID)?.status).toBe('cancelled');
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
  });

  it('after perform → state −2 (refund), order cancelled', async () => {
    const ledger = setup();
    await create(ledger);
    await rpc(ledger, 'PerformTransaction', { id: TXN });
    const r = await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 5 });
    expect(r.result).toMatchObject({ state: -2, transaction: PAYMENT_ID });
    expect(ledger.payment(PAYMENT_ID)?.status).toBe('refunded');
    expect(ledger.order(ORDER_ID)?.status).toBe('cancelled');
  });

  it('idempotent: repeating returns the same cancel_time and keeps the first reason', async () => {
    const ledger = setup();
    await create(ledger);
    const a = await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 3 });
    ledger.advance(10_000);
    const b = await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 10 });
    expect(b.result).toEqual(a.result);
    expect((await ledger.getTransaction('payme', TXN))?.cancelReason).toBe(3);
  });

  it('unknown transaction → −31003', async () => {
    expectError(await rpc(setup(), 'CancelTransaction', { id: 'missing', reason: 1 }), -31003);
  });

  it('after the goods shipped the ledger refuses an automatic refund → −31007', async () => {
    const ledger = setup();
    await create(ledger);
    await rpc(ledger, 'PerformTransaction', { id: TXN });
    ledger.order(ORDER_ID)!.status = 'shipped';
    expectError(await rpc(ledger, 'CancelTransaction', { id: TXN, reason: 5 }), -31007);
  });
});

describe('Payme CheckTransaction / GetStatement / SetFiscalData', () => {
  it('fixture: CheckTransaction of a performed transaction', async () => {
    const ledger = setup();
    await create(ledger);
    ledger.advance(2_000);
    await rpc(ledger, 'PerformTransaction', { id: TXN });
    expect((await rpc(ledger, 'CheckTransaction', { id: TXN })).result).toEqual({
      create_time: NOW,
      perform_time: NOW + 2_000,
      cancel_time: 0,
      transaction: PAYMENT_ID,
      state: 2,
      reason: null,
    });
  });

  it('CheckTransaction of an unknown id → −31003', async () => {
    expectError(await rpc(setup(), 'CheckTransaction', { id: 'missing' }), -31003);
  });

  it('GetStatement returns transactions whose create_time is within [from, to], oldest first', async () => {
    const ledger = new MemoryLedger({ now: NOW });
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      ledger.addOrder({ id: `o-${id}`, amount: 100_000 * (i + 1) });
    }
    const times: number[] = [];
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      times.push(ledger.now().getTime());
      await rpc(ledger, 'CreateTransaction', { id: `t-${id}`, time: ledger.now().getTime(), amount: 100_000 * (i + 1), account: { order_id: `o-${id}` } });
      ledger.advance(60_000);
    }
    await rpc(ledger, 'PerformTransaction', { id: 't-b' });
    const r = await rpc(ledger, 'GetStatement', { from: times[1], to: times[2] });
    const list = (r.result?.transactions ?? []) as Array<Record<string, unknown>>;
    expect(list.map((t) => t.id)).toEqual(['t-b', 't-c']);
    expect(list[0]).toMatchObject({
      time: times[1],
      amount: 200_000,
      account: { order_id: 'o-b' },
      create_time: times[1],
      state: 2,
      cancel_time: 0,
      reason: null,
    });
    expect((await rpc(ledger, 'GetStatement', { from: 0, to: times[0]! - 1 })).result).toEqual({ transactions: [] });
  });

  it('GetStatement with to < from → −32600', async () => {
    expectError(await rpc(setup(), 'GetStatement', { from: NOW, to: NOW - 1 }), -32600);
  });

  it('SetFiscalData is acknowledged', async () => {
    const r = await rpc(setup(), 'SetFiscalData', { id: TXN, type: 'PERFORM', fiscal_data: { receipt_id: 1 } });
    expect(r.result).toEqual({ success: true });
  });
});
