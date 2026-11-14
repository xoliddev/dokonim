import { describe, expect, it, vi } from 'vitest';
import { orderCallback } from '@dokonim/core';
import { callbackError, callbackToast, deliver, nextKeyboard, toInlineKeyboard, webhookCallbackFor, withDeadline } from '../src/bot';
import type { MessageSender } from '../src/bot';
import { renderNotification } from '../src/render';
import type { RenderedMessage } from '../src/render';
import { BASE, ORDER_ID, WEBAPP, order, outbox, setup } from './fixtures';

function fakeSender() {
  const sendMessage = vi.fn(async () => ({ message_id: 321 }));
  return { api: { sendMessage } satisfies MessageSender, sendMessage };
}

describe('deliver()', () => {
  it('sends HTML with callback + url buttons and returns the message id', async () => {
    const { api, sendMessage } = fakeSender();
    const rendered = renderNotification(outbox({ topic: 'order.placed', order: order() }, 'owner', 'uz'), { miniAppBase: BASE });
    const id = await deliver(api, rendered);
    expect(id).toBe(321);
    expect(sendMessage).toHaveBeenCalledWith(111, rendered.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Tasdiqlash', callback_data: orderCallback('confirm', ORDER_ID) },
            { text: '📞 Qoʻngʻiroq', url: 'https://t.me/+998901234567' },
          ],
          [{ text: 'Ochish', url: `${BASE}?startapp=m-dilnoza-atelier` }],
        ],
      },
    });
  });

  it('web_app only for private chats; groups fall back to url', async () => {
    const msg = (chatId: number): RenderedMessage => ({ chatId, text: 'x', buttons: [[{ text: 'Open', url: `${BASE}?startapp=new`, webApp: `${WEBAPP}?startapp=new` }]] });
    const a = fakeSender();
    await deliver(a.api, msg(42));
    expect((a.sendMessage.mock.calls[0] as unknown[])[2]).toMatchObject({ reply_markup: { inline_keyboard: [[{ text: 'Open', web_app: { url: `${WEBAPP}?startapp=new` } }]] } });
    const b = fakeSender();
    await deliver(b.api, msg(-100500));
    expect((b.sendMessage.mock.calls[0] as unknown[])[2]).toMatchObject({ reply_markup: { inline_keyboard: [[{ text: 'Open', url: `${BASE}?startapp=new` }]] } });
  });

  it('no buttons → no reply_markup', async () => {
    const { api, sendMessage } = fakeSender();
    await deliver(api, { chatId: 1, text: 'hi', buttons: [] });
    expect((sendMessage.mock.calls[0] as unknown[])[2]).not.toHaveProperty('reply_markup');
  });

  it('works with a real grammY bot.api (through a transformer)', async () => {
    const { bot, of } = setup();
    const id = await deliver(bot.api, { chatId: 42, text: '<b>hi</b>', buttons: [[{ text: 'A', callback: 'o:confirm:x' }]] });
    expect(id).toBeGreaterThan(0);
    expect(of('sendMessage')[0]!.payload).toMatchObject({ chat_id: 42, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'o:confirm:x' }]] } });
  });
});

describe('keyboard helpers', () => {
  it('toInlineKeyboard drops empty rows and buttons without a target', () => {
    expect(toInlineKeyboard([[], [{ text: 'none' }]], { allowWebApp: true })).toBeUndefined();
  });

  it('nextKeyboard inserts a new row when no action button existed', () => {
    const rows = nextKeyboard([[{ text: 'Open', url: BASE }]], ORDER_ID, { action: 'ship', locale: 'ru' }).inline_keyboard;
    expect(rows).toEqual([[{ text: '🚚 Отправить', callback_data: orderCallback('ship', ORDER_ID) }], [{ text: 'Open', url: BASE }]]);
  });

  it('nextKeyboard keeps buttons of other orders', () => {
    const other = orderCallback('confirm', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
    const rows = nextKeyboard([[{ text: 'X', callback_data: other }, { text: 'Y', callback_data: orderCallback('confirm', ORDER_ID) }]], ORDER_ID, null).inline_keyboard;
    expect(rows).toEqual([[{ text: 'X', callback_data: other }]]);
  });

  it('toasts and errors are localized', () => {
    expect(callbackToast('shipped', 'uz')).toBe('Joʻnatildi');
    expect(callbackToast('completed', 'en')).toBe('Status: Completed');
    expect(callbackError('NOT_FOUND', 'uz')).toBe('Buyurtma topilmadi.');
  });
});

describe('withDeadline / webhook', () => {
  it('resolves value, fallback on timeout, fallback on rejection', async () => {
    expect(await withDeadline(Promise.resolve(1), 50, 0)).toBe(1);
    expect(await withDeadline(new Promise<number>(() => undefined), 5, 0)).toBe(0);
    expect(await withDeadline(Promise.reject(new Error('x')), 50, 0)).toBe(0);
  });

  it('webhookCallbackFor returns a fastify handler that checks the secret token', async () => {
    const { bot, of } = setup();
    const handler = webhookCallbackFor(bot, 's3cret');
    expect(typeof handler).toBe('function');
    const reply = { code: vi.fn(() => reply), status: vi.fn(() => reply), headers: vi.fn(() => reply), send: vi.fn(() => reply) };
    await handler({ body: { update_id: 1 }, headers: { 'x-telegram-bot-api-secret-token': 'wrong' } }, reply as never);
    expect(reply.code.mock.calls.length + reply.status.mock.calls.length).toBeGreaterThan(0);
    expect(of('sendMessage')).toHaveLength(0);
  });
});
