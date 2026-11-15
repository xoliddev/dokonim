import { describe, expect, it, vi } from 'vitest';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { formatMoney, orderCallback } from '@dokonim/core';
import {
  BASE,
  ORDER_ID,
  WEBAPP,
  callbackUpdate,
  contactUpdate,
  inlineUpdate,
  order,
  outbox,
  preCheckoutUpdate,
  setup,
  successfulPaymentUpdate,
  textUpdate,
} from './fixtures';

const markupOf = (p: Record<string, unknown>) => p.reply_markup as InlineKeyboardMarkup;

describe('/start', () => {
  it('no payload → hub welcome with web_app buttons in private chats', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(textUpdate('/start'));
    const [send] = of('sendMessage');
    expect(send!.payload.parse_mode).toBe('HTML');
    expect(send!.payload.text).toContain('Doʻkonim');
    expect(markupOf(send!.payload).inline_keyboard).toEqual([
      [{ text: 'Doʻkonni ochish', web_app: { url: WEBAPP } }],
      [{ text: 'Doʻkon yaratish', web_app: { url: `${WEBAPP}?startapp=new` } }],
    ]);
    expect(backend.upsertUser).toHaveBeenCalledWith({ telegramId: 42, firstName: 'Sardor', languageCode: 'uz' });
  });

  it.each([
    ['dilnoza-atelier', 'dilnoza-atelier', 'Нажмите кнопку, чтобы открыть магазин.'],
    ['dilnoza-atelier-c-tg_ads', 'dilnoza-atelier-c-tg_ads', 'открыть магазин'],
    ['dilnoza-atelier-p-AB12', 'dilnoza-atelier-p-AB12', 'посмотреть товар'],
    ['dilnoza-atelier-o-K7Q2M9', 'dilnoza-atelier-o-K7Q2M9', 'статус заказа'],
    ['m-dilnoza-atelier', 'm-dilnoza-atelier', 'управление магазином'],
    ['new', 'new', 'за 3 минуты'],
  ])('/start %s → first button opens startapp=%s (ru)', async (raw, sp, text) => {
    const { bot, of } = setup();
    await bot.handleUpdate(textUpdate(`/start ${raw}`, { lang: 'ru' }));
    const [send] = of('sendMessage');
    expect(send!.payload.text).toContain(text);
    expect(markupOf(send!.payload).inline_keyboard[0]![0]).toEqual({ text: expect.any(String), web_app: { url: `${WEBAPP}?startapp=${sp}` } });
  });

  it('invalid payload falls back to the hub', async () => {
    const { bot, of } = setup();
    await bot.handleUpdate(textUpdate('/start <bad payload!>', { lang: 'en' }));
    expect(of('sendMessage')[0]!.payload.text).toContain('shops right inside Telegram');
  });

  it('group chats get url buttons (web_app is private-only)', async () => {
    const { bot, of } = setup();
    await bot.handleUpdate(textUpdate('/start dilnoza-atelier', { chat: 'group' }));
    expect(markupOf(of('sendMessage')[0]!.payload).inline_keyboard[0]![0]).toEqual({ text: 'Doʻkonni ochish', url: `${BASE}?startapp=dilnoza-atelier` });
  });

  it('/help and /paysupport reply in the user locale', async () => {
    const { bot, of } = setup();
    await bot.handleUpdate(textUpdate('/help', { lang: 'en' }));
    await bot.handleUpdate(textUpdate('/paysupport', { lang: 'ru' }));
    const [help, pay] = of('sendMessage');
    expect(help!.payload.text).toContain('@dokonim_bot');
    expect(pay!.payload.text).toContain('Помощь с оплатой');
  });
});

describe('dedupe', () => {
  it('a repeated update_id is processed once', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(textUpdate('/start', { updateId: 9001 }));
    await bot.handleUpdate(textUpdate('/start', { updateId: 9001 }));
    expect(backend.seenUpdate).toHaveBeenCalledTimes(2);
    expect(of('sendMessage')).toHaveLength(1);
  });

  it('a successful_payment that fails is rethrown and processed again on redelivery', async () => {
    const { bot, backend } = setup();
    backend.successfulPayment.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(bot.handleUpdate(successfulPaymentUpdate(9200))).rejects.toThrow();
    expect(backend.forgetUpdate).toHaveBeenCalledWith(9200);
    await bot.handleUpdate(successfulPaymentUpdate(9200));
    expect(backend.successfulPayment).toHaveBeenCalledTimes(2);
  });

  it('a duplicate successful_payment does not call the backend twice', async () => {
    const { bot, backend } = setup();
    await bot.handleUpdate(successfulPaymentUpdate(9100));
    await bot.handleUpdate(successfulPaymentUpdate(9100));
    expect(backend.successfulPayment).toHaveBeenCalledTimes(1);
  });
});

describe('contact verification', () => {
  it('own contact → saveVerifiedPhone with normalised phone + thank-you', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(contactUpdate(42, '998901234567'));
    expect(backend.saveVerifiedPhone).toHaveBeenCalledWith(42, '+998901234567');
    const [send] = of('sendMessage');
    expect(send!.payload.text).toContain('+998901234567');
    expect(send!.payload.reply_markup).toEqual({ remove_keyboard: true });
  });

  it('forwarded / someone else’s contact is ignored', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(contactUpdate(999));
    await bot.handleUpdate(contactUpdate(undefined));
    expect(backend.saveVerifiedPhone).not.toHaveBeenCalled();
    expect(of('sendMessage')).toHaveLength(2);
    expect(of('sendMessage')[0]!.payload.text).toContain('oʻz raqamingizni');
  });
});

describe('order callbacks', () => {
  const keyboard = [
    [
      { text: '✅ Tasdiqlash', callback_data: orderCallback('confirm', ORDER_ID) },
      { text: '📞 Qoʻngʻiroq', url: 'https://t.me/+998901234567' },
    ],
    [{ text: 'Ochish', url: `${BASE}?startapp=m-dilnoza-atelier` }],
  ];

  it('confirm success → toast + keyboard shows the next action in place of the used button', async () => {
    const { bot, of, backend } = setup({
      orderAction: vi.fn(async () => ({
        ok: true as const,
        status: 'confirmed',
        message: outbox({ topic: 'order.status_changed', order: order({ status: 'confirmed', fulfilment: 'delivery' }), from: 'awaiting_confirmation', to: 'confirmed' }, 'buyer'),
      })),
    });
    await bot.handleUpdate(callbackUpdate(orderCallback('confirm', ORDER_ID), keyboard));
    expect(backend.orderAction).toHaveBeenCalledWith(111, ORDER_ID, 'confirm');
    const [ans] = of('answerCallbackQuery');
    expect(ans!.payload).toMatchObject({ callback_query_id: 'cbq-1', text: 'Buyurtma tasdiqlandi' });
    expect(ans!.payload.show_alert).toBeUndefined();
    const [edit] = of('editMessageReplyMarkup');
    expect(edit!.payload).toMatchObject({ chat_id: 111, message_id: 77 });
    expect(markupOf(edit!.payload).inline_keyboard).toEqual([
      [
        { text: '📦 Yigʻish', callback_data: orderCallback('pack', ORDER_ID) },
        { text: '📞 Qoʻngʻiroq', url: 'https://t.me/+998901234567' },
      ],
      [{ text: 'Ochish', url: `${BASE}?startapp=m-dilnoza-atelier` }],
    ]);
  });

  it('terminal status → used button removed, nothing added', async () => {
    const { bot, of } = setup({ orderAction: vi.fn(async () => ({ ok: true as const, status: 'delivered', message: null })) });
    await bot.handleUpdate(callbackUpdate(orderCallback('deliver', ORDER_ID), [[{ text: '✅ Topshirildi', callback_data: orderCallback('deliver', ORDER_ID) }]], 'en'));
    expect(of('answerCallbackQuery')[0]!.payload.text).toBe('Delivered');
    expect(markupOf(of('editMessageReplyMarkup')[0]!.payload).inline_keyboard).toEqual([]);
  });

  it('unknown fulfilment with an ambiguous next step (packing) adds no action', async () => {
    const { bot, of } = setup({ orderAction: vi.fn(async () => ({ ok: true as const, status: 'packing', message: null })) });
    await bot.handleUpdate(callbackUpdate(orderCallback('pack', ORDER_ID), keyboard));
    const rows = markupOf(of('editMessageReplyMarkup')[0]!.payload).inline_keyboard;
    expect(rows.flat().some((b) => 'callback_data' in b)).toBe(false);
  });

  it.each([
    ['FORBIDDEN', 'У вас нет прав на это действие.'],
    ['INVALID_TRANSITION', 'Статус заказа уже изменился. Откройте заказ.'],
    ['NOT_FOUND', 'Заказ не найден.'],
    ['WEIRD', 'Что-то пошло не так. Попробуйте чуть позже.'],
  ])('failure %s → localized alert, keyboard untouched', async (code, text) => {
    const { bot, of } = setup({ orderAction: vi.fn(async () => ({ ok: false as const, code })) });
    await bot.handleUpdate(callbackUpdate(orderCallback('confirm', ORDER_ID), keyboard, 'ru'));
    expect(of('answerCallbackQuery')[0]!.payload).toMatchObject({ text, show_alert: true });
    expect(of('editMessageReplyMarkup')).toHaveLength(0);
  });

  it('backend throws → generic alert, error logged without PII', async () => {
    const { bot, of, logs } = setup({ orderAction: vi.fn(async () => Promise.reject(new Error('db down'))) });
    await bot.handleUpdate(callbackUpdate(orderCallback('confirm', ORDER_ID), keyboard));
    expect(of('answerCallbackQuery')[0]!.payload).toMatchObject({ show_alert: true });
    const entry = logs.find((l) => l.event === 'bot_error')!;
    expect(entry).toMatchObject({ event: 'bot_error', update: ['callback_query'], error: 'Error', message: 'db down' });
    expect(JSON.stringify(entry)).not.toMatch(/Sardor|first_name|from/);
  });

  it('foreign callback data is just acknowledged', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(callbackUpdate('noop', keyboard));
    expect(backend.orderAction).not.toHaveBeenCalled();
    expect(of('answerCallbackQuery')[0]!.payload.text).toBeUndefined();
  });
});

describe('inline mode', () => {
  const products = [
    {
      id: 'p-1',
      shortId: 'AB12',
      storeSlug: 'dilnoza-atelier',
      storeName: 'Dilnoza <A>',
      title: 'Atlas koʻylak',
      price: 45_000_000,
      currency: 'UZS' as const,
      imageUrl: 'https://cdn.example/p1.jpg',
      description: 'Qoʻlda tikilgan',
    },
    { id: 'p-2', shortId: 'CD34', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza', title: 'Stiker', price: 50, currency: 'XTR' as const },
  ];

  it('article results with price, thumbnail and "Ochish" deep link', async () => {
    const { bot, of, backend } = setup({ inlineProducts: vi.fn(async () => products) });
    await bot.handleUpdate(inlineUpdate('  dilnoza-atelier atlas  '));
    expect(backend.inlineProducts).toHaveBeenCalledWith('dilnoza-atelier atlas', 42);
    const [ans] = of('answerInlineQuery');
    expect(ans!.payload).toMatchObject({ inline_query_id: 'iq-1', cache_time: 30, is_personal: true });
    const results = ans!.payload.results as Array<Record<string, any>>;
    expect(results).toHaveLength(2);
    const [a] = results;
    expect(a).toMatchObject({ type: 'article', id: 'p-1', title: 'Atlas koʻylak', thumbnail_url: 'https://cdn.example/p1.jpg' });
    expect(a!.description).toContain(formatMoney(45_000_000, 'UZS', 'uz'));
    expect(a!.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Ochish', url: `${BASE}?startapp=dilnoza-atelier-p-AB12` }]] });
    expect(a!.input_message_content.parse_mode).toBe('HTML');
    expect(a!.input_message_content.message_text).toContain('<b>Atlas koʻylak</b>');
    expect(a!.input_message_content.message_text).toContain('Dilnoza &lt;A&gt;');
    expect(results[1]!.thumbnail_url).toBeUndefined();
    expect(results[1]!.description).toContain(formatMoney(50, 'XTR', 'uz'));
  });

  it('empty results are still answered', async () => {
    const { bot, of } = setup();
    await bot.handleUpdate(inlineUpdate(''));
    expect(of('answerInlineQuery')[0]!.payload.results).toEqual([]);
  });
});

describe('payments', () => {
  it('pre_checkout ok → answerPreCheckoutQuery(ok=true)', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(preCheckoutUpdate());
    expect(backend.preCheckout).toHaveBeenCalledWith({ id: 'pcq-1', payload: 'pay_123', totalAmount: 250, currency: 'XTR', fromId: 42, languageCode: 'uz' });
    expect(of('answerPreCheckoutQuery')[0]!.payload).toEqual({ pre_checkout_query_id: 'pcq-1', ok: true });
  });

  it('pre_checkout rejected → ok=false with the backend error message', async () => {
    const { bot, of } = setup({ preCheckout: vi.fn(async () => ({ ok: false as const, errorMessage: 'Summa oʻzgardi' })) });
    await bot.handleUpdate(preCheckoutUpdate());
    expect(of('answerPreCheckoutQuery')[0]!.payload).toEqual({ pre_checkout_query_id: 'pcq-1', ok: false, error_message: 'Summa oʻzgardi' });
  });

  it('slow backend → answered ok=false within the deadline', async () => {
    const { bot, of } = setup({ preCheckout: vi.fn(() => new Promise<never>(() => undefined)) }, { preCheckoutDeadlineMs: 30 });
    const t0 = Date.now();
    await bot.handleUpdate(preCheckoutUpdate('en'));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(of('answerPreCheckoutQuery')[0]!.payload).toEqual({
      pre_checkout_query_id: 'pcq-1',
      ok: false,
      error_message: 'The shop did not respond in time. Please try again shortly.',
    });
  });

  it('default 9 s deadline with fake timers', async () => {
    vi.useFakeTimers();
    try {
      const { bot, of } = setup({ preCheckout: vi.fn(() => new Promise<never>(() => undefined)) });
      const done = bot.handleUpdate(preCheckoutUpdate('ru'));
      await vi.advanceTimersByTimeAsync(8_999);
      expect(of('answerPreCheckoutQuery')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(of('answerPreCheckoutQuery')[0]!.payload).toMatchObject({ ok: false, error_message: 'Магазин не ответил вовремя. Попробуйте ещё раз чуть позже.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('backend throwing in pre_checkout still answers ok=false', async () => {
    const { bot, of } = setup({ preCheckout: vi.fn(async () => Promise.reject(new Error('boom'))) });
    await bot.handleUpdate(preCheckoutUpdate());
    expect(of('answerPreCheckoutQuery')[0]!.payload).toMatchObject({ ok: false });
  });

  it('successful_payment → backend once + receipt', async () => {
    const { bot, of, backend } = setup();
    await bot.handleUpdate(successfulPaymentUpdate());
    expect(backend.successfulPayment).toHaveBeenCalledTimes(1);
    expect(backend.successfulPayment).toHaveBeenCalledWith({
      payload: 'pay_123',
      totalAmount: 125_000_000,
      currency: 'UZS',
      telegramChargeId: 'tg_charge_1',
      providerChargeId: 'prov_1',
      fromId: 42,
    });
    const [send] = of('sendMessage');
    expect(send!.payload.text).toContain('Toʻlov qabul qilindi');
    expect(send!.payload.text).toContain(formatMoney(125_000_000, 'UZS', 'uz'));
  });
});
