import { describe, expect, it } from 'vitest';
import { md5 } from '@dokonim/core';
import { CLICK_ERROR, ClickWebhookHandler, MemoryLedger, clickConfirmId, clickPrepareId, clickSignString, sandboxConfig, stableNumericId } from '../src';
import type { ProviderConfig } from '@dokonim/core';
import { NOW, ORDER_ID, PAYMENT_ID, liveConfig, setup } from './helpers';

const cfg = sandboxConfig('click');
const SECRET = 'sandbox-click-secret';
const CLICK_TRANS_ID = '2091403245';
const PREPARE_ID = 921693100; // stableNumericId(PAYMENT_ID), see vector test below
const CONFIRM_ID = 1577885388;

const prepareFields = (over: Record<string, string> = {}) => ({
  click_trans_id: CLICK_TRANS_ID,
  service_id: '10001',
  click_paydoc_id: '3300112233',
  merchant_trans_id: ORDER_ID,
  amount: '15000.00',
  action: '0',
  error: '0',
  error_note: 'Success',
  sign_time: '2026-11-14 10:00:00',
  ...over,
});

const completeFields = (over: Record<string, string> = {}) =>
  prepareFields({ action: '1', merchant_prepare_id: String(PREPARE_ID), sign_time: '2026-11-14 10:00:05', ...over });

function sign(f: Record<string, string>, secret = SECRET): Record<string, string> {
  return {
    ...f,
    sign_string: clickSignString(
      {
        click_trans_id: f.click_trans_id!,
        service_id: f.service_id!,
        merchant_trans_id: f.merchant_trans_id!,
        merchant_prepare_id: f.merchant_prepare_id ?? '',
        amount: f.amount!,
        action: f.action!,
        sign_time: f.sign_time!,
      },
      secret,
    ),
  };
}

async function post(ledger: MemoryLedger, action: 'prepare' | 'complete', fields: Record<string, string>, opts: { handler?: ClickWebhookHandler; cfg?: ProviderConfig; raw?: boolean } = {}) {
  const body = new URLSearchParams(opts.raw ? fields : sign(fields)).toString();
  const res = await (opts.handler ?? new ClickWebhookHandler()).handle(
    { action, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body },
    opts.cfg ?? cfg,
    ledger,
  );
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  return JSON.parse(res.body) as Record<string, unknown>;
}

describe('Click signatures (known md5 vectors)', () => {
  it('Prepare sign_string = md5(click_trans_id + service_id + SECRET + merchant_trans_id + amount + action + sign_time)', () => {
    const literal = '209140324510001sandbox-click-secretord-115000.0002026-11-14 10:00:00';
    expect(md5(literal)).toBe('5925a2f4945cf1dec2d057d8d3e03f92');
    expect(sign(prepareFields()).sign_string).toBe('5925a2f4945cf1dec2d057d8d3e03f92');
  });

  it('Complete sign_string includes merchant_prepare_id', () => {
    const literal = '209140324510001sandbox-click-secretord-192169310015000.0012026-11-14 10:00:05';
    expect(md5(literal)).toBe('b1ea37634751e697fb9ab4f63c46f7a5');
    expect(sign(completeFields()).sign_string).toBe('b1ea37634751e697fb9ab4f63c46f7a5');
  });

  it('merchant_prepare_id / merchant_confirm_id are stable 31-bit ids derived from the payment id', () => {
    expect(clickPrepareId(PAYMENT_ID)).toBe(PREPARE_ID);
    expect(clickConfirmId(PAYMENT_ID)).toBe(CONFIRM_ID);
    expect(stableNumericId(PAYMENT_ID)).toBe(parseInt(md5(PAYMENT_ID).slice(0, 8), 16) & 0x7fffffff);
  });
});

describe('Click Prepare', () => {
  it('fixture: valid Prepare → error 0 with merchant_prepare_id; payment pending', async () => {
    const ledger = setup();
    expect(await post(ledger, 'prepare', prepareFields())).toEqual({
      click_trans_id: 2091403245,
      merchant_trans_id: ORDER_ID,
      merchant_prepare_id: PREPARE_ID,
      error: 0,
      error_note: 'Success',
    });
    expect(ledger.payment(PAYMENT_ID)?.status).toBe('pending');
    expect(ledger.events.at(-1)).toMatchObject({ provider: 'click', kind: 'prepare', signatureOk: true });
  });

  it('duplicate Prepare returns the same merchant_prepare_id', async () => {
    const ledger = setup();
    const a = await post(ledger, 'prepare', prepareFields());
    const b = await post(ledger, 'prepare', prepareFields({ sign_time: '2026-11-14 10:00:02' }));
    expect(b).toEqual(a);
    expect(ledger.transactions('click')).toHaveLength(1);
  });

  it('bad signature → −1 and nothing changes', async () => {
    const ledger = setup();
    const f = { ...sign(prepareFields()), sign_string: md5('forged') };
    const r = await post(ledger, 'prepare', f, { raw: true });
    expect(r).toMatchObject({ error: CLICK_ERROR.SIGN_FAILED, error_note: 'SIGN CHECK FAILED!', merchant_prepare_id: null });
    expect(ledger.transactions()).toHaveLength(0);
    expect(ledger.events.at(-1)?.signatureOk).toBe(false);
  });

  it('signature made with another secret → −1', async () => {
    const ledger = setup();
    const r = await post(ledger, 'prepare', sign(prepareFields(), 'other-secret'), { raw: true });
    expect(r.error).toBe(-1);
  });

  it('amount mismatch → −2', async () => {
    expect((await post(setup(), 'prepare', prepareFields({ amount: '14999.00' }))).error).toBe(CLICK_ERROR.BAD_AMOUNT);
  });

  it('amount without decimals is accepted (signature uses the raw string)', async () => {
    expect((await post(setup(), 'prepare', prepareFields({ amount: '15000' }))).error).toBe(0);
  });

  it('unknown order → −5', async () => {
    const r = await post(setup(), 'prepare', prepareFields({ merchant_trans_id: 'ord-404' }));
    expect(r).toMatchObject({ error: CLICK_ERROR.ORDER_NOT_FOUND, error_note: 'User does not exist' });
  });

  it('already paid order → −4', async () => {
    expect((await post(setup({ status: 'paid' }), 'prepare', prepareFields())).error).toBe(CLICK_ERROR.ALREADY_PAID);
  });

  it('cancelled order → −9', async () => {
    expect((await post(setup({ status: 'cancelled' }), 'prepare', prepareFields())).error).toBe(CLICK_ERROR.CANCELLED);
  });

  it('missing fields → −8', async () => {
    const f = sign(prepareFields());
    delete (f as Record<string, string | undefined>).sign_time;
    expect((await post(setup(), 'prepare', f, { raw: true })).error).toBe(CLICK_ERROR.BAD_REQUEST);
  });

  it('unknown action → −3; action/route mismatch → −3', async () => {
    expect((await post(setup(), 'prepare', prepareFields({ action: '2' }))).error).toBe(CLICK_ERROR.ACTION_NOT_FOUND);
    expect((await post(setup(), 'complete', prepareFields())).error).toBe(CLICK_ERROR.ACTION_NOT_FOUND);
  });

  it('service_id of another store → −8', async () => {
    expect((await post(setup(), 'prepare', prepareFields({ service_id: '99999' }))).error).toBe(CLICK_ERROR.BAD_REQUEST);
  });

  it('a new Prepare supersedes an abandoned pending attempt (old one cancelled)', async () => {
    const ledger = setup();
    await post(ledger, 'prepare', prepareFields());
    const r = await post(ledger, 'prepare', prepareFields({ click_trans_id: '2091403300' }));
    expect(r.error).toBe(0);
    expect((await ledger.getTransaction('click', CLICK_TRANS_ID))?.status).toBe('cancelled');
    // a late Complete of the abandoned attempt can no longer charge
    expect((await post(ledger, 'complete', completeFields())).error).toBe(CLICK_ERROR.CANCELLED);
  });
});

describe('Click Complete', () => {
  async function prepared() {
    const ledger = setup();
    await post(ledger, 'prepare', prepareFields());
    return ledger;
  }

  it('fixture: valid Complete → error 0 with merchant_confirm_id; order paid', async () => {
    const ledger = await prepared();
    expect(await post(ledger, 'complete', completeFields())).toEqual({
      click_trans_id: 2091403245,
      merchant_trans_id: ORDER_ID,
      merchant_confirm_id: CONFIRM_ID,
      error: 0,
      error_note: 'Success',
    });
    expect(ledger.order(ORDER_ID)?.status).toBe('paid');
  });

  it('duplicate Complete is idempotent: success again, paid exactly once', async () => {
    const ledger = await prepared();
    const a = await post(ledger, 'complete', completeFields());
    const b = await post(ledger, 'complete', completeFields());
    expect(b).toEqual(a);
    expect(ledger.paidCount.get(ORDER_ID)).toBe(1);
  });

  it('Complete with Click error < 0 cancels the transaction → −9 (and stays cancelled)', async () => {
    const ledger = await prepared();
    const r = await post(ledger, 'complete', completeFields({ error: '-5017', error_note: 'Insufficient funds' }));
    expect(r).toMatchObject({ error: CLICK_ERROR.CANCELLED, error_note: 'Transaction cancelled', merchant_confirm_id: null });
    const t = await ledger.getTransaction('click', CLICK_TRANS_ID);
    expect(t).toMatchObject({ status: 'cancelled', cancelReason: -5017 });
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
    expect((await post(ledger, 'complete', completeFields())).error).toBe(CLICK_ERROR.CANCELLED);
  });

  it('unknown click_trans_id → −6', async () => {
    const ledger = await prepared();
    expect((await post(ledger, 'complete', completeFields({ click_trans_id: '1' }))).error).toBe(CLICK_ERROR.TXN_NOT_FOUND);
  });

  it('wrong merchant_prepare_id → −6', async () => {
    const ledger = await prepared();
    expect((await post(ledger, 'complete', completeFields({ merchant_prepare_id: '12345' }))).error).toBe(CLICK_ERROR.TXN_NOT_FOUND);
  });

  it('amount mismatch on Complete → −2', async () => {
    const ledger = await prepared();
    expect((await post(ledger, 'complete', completeFields({ amount: '1.00' }))).error).toBe(CLICK_ERROR.BAD_AMOUNT);
  });

  it('bad signature on Complete → −1, order unpaid', async () => {
    const ledger = await prepared();
    const r = await post(ledger, 'complete', { ...sign(completeFields()), sign_string: '0'.repeat(32) }, { raw: true });
    expect(r.error).toBe(-1);
    expect(ledger.order(ORDER_ID)?.status).toBe('pending_payment');
  });

  it('Prepare of a new click_trans_id after the order was paid → −4', async () => {
    const ledger = await prepared();
    await post(ledger, 'complete', completeFields());
    expect((await post(ledger, 'prepare', prepareFields({ click_trans_id: '2091409999' }))).error).toBe(CLICK_ERROR.ALREADY_PAID);
  });

  it('order cancelled by the shop before Complete → −9', async () => {
    const ledger = await prepared();
    ledger.order(ORDER_ID)!.status = 'cancelled';
    expect((await post(ledger, 'complete', completeFields())).error).toBe(CLICK_ERROR.CANCELLED);
    expect((await ledger.getTransaction('click', CLICK_TRANS_ID))?.status).toBe('cancelled');
  });
});

describe('Click sign_time freshness window', () => {
  it('live mode rejects a sign_time older than 24 h by default', async () => {
    const ledger = setup();
    ledger.setNow(NOW + 25 * 3_600_000);
    const r = await post(ledger, 'prepare', prepareFields(), { cfg: liveConfig('click') });
    expect(r.error).toBe(CLICK_ERROR.SIGN_FAILED);
    expect(String(r.error_note)).toMatch(/stale/);
  });

  it('sandbox mode has no window by default', async () => {
    const ledger = setup();
    ledger.setNow(NOW + 30 * 24 * 3_600_000);
    expect((await post(ledger, 'prepare', prepareFields())).error).toBe(0);
  });

  it('the window is configurable', async () => {
    const ledger = setup();
    ledger.setNow(NOW + 120_000);
    const strict = new ClickWebhookHandler({ signTimeWindowMs: 60_000 });
    expect((await post(ledger, 'prepare', prepareFields(), { handler: strict })).error).toBe(-1);
    const off = new ClickWebhookHandler({ signTimeWindowMs: null });
    expect((await post(ledger, 'prepare', prepareFields(), { handler: off, cfg: liveConfig('click') })).error).toBe(0);
  });
});
