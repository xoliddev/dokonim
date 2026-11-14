import { vi } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Locale, NotificationPayload, OrderSummary, OutboxMessage, Recipient } from '@dokonim/core';
import { createBot } from '../src/bot';
import type { BotConfig } from '../src/bot';
import type { BotBackend } from '../src/backend';

export const ORDER_ID = '0b9f3c1e-2d4a-4f6b-8c7d-9e0a1b2c3d4e';
export const BASE = 'https://t.me/dokonim_bot/shop';
export const WEBAPP = 'https://dokonim.uz/app';
export const LOCALES: Locale[] = ['uz', 'ru', 'en'];

export const botInfo = {
  id: 7000000001,
  is_bot: true,
  first_name: 'Doʻkonim',
  username: 'dokonim_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
  can_connect_to_business: false,
  has_main_web_app: true,
} as unknown as UserFromGetMe;

export function order(over: Partial<OrderSummary> = {}): OrderSummary {
  return {
    orderId: ORDER_ID,
    shortId: 'K7Q2M9',
    number: 1042,
    storeSlug: 'dilnoza-atelier',
    storeName: 'Dilnoza <Atelier> & Co',
    total: 125_000_000, // 1 250 000 so'm
    currency: 'UZS',
    items: [
      { title: 'Atlas koʻylak', variantTitle: 'M / qizil', qty: 1 },
      { title: '<script>alert(1)</script>', qty: 2 },
    ],
    paymentMethod: 'payme',
    buyerName: '<script>Sardor</script>',
    buyerPhone: '+998 90 123-45-67',
    fulfilment: 'delivery',
    deliveryFrom: '2026-11-15',
    deliveryTo: '2026-11-17',
    status: 'awaiting_confirmation',
    ...over,
  };
}

export function outbox(payload: NotificationPayload, kind: Recipient['kind'] = 'owner', locale: Locale = 'uz'): OutboxMessage {
  return {
    id: 'msg-1',
    storeId: 'store-1',
    recipient: { kind, telegramId: kind === 'buyer' ? 222 : 111, userId: 'u-1', locale },
    payload,
    createdAt: '2026-11-14T10:00:00Z',
  };
}

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

export function fakeBackend(over: Partial<BotBackend> = {}): BotBackend & { [K in keyof BotBackend]: ReturnType<typeof vi.fn> } {
  const seen = new Set<number>();
  return {
    seenUpdate: vi.fn(async (id: number) => {
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    }),
    upsertUser: vi.fn(async (u: { languageCode?: string }) => ({ locale: (u.languageCode === 'ru' ? 'ru' : u.languageCode === 'en' ? 'en' : 'uz') as Locale })),
    saveVerifiedPhone: vi.fn(async () => undefined),
    orderAction: vi.fn(async () => ({ ok: true as const, message: null, status: 'confirmed' })),
    inlineProducts: vi.fn(async () => []),
    preCheckout: vi.fn(async () => ({ ok: true as const })),
    successfulPayment: vi.fn(async () => undefined),
    ...over,
  } as never;
}

export function setup(backendOver: Partial<BotBackend> = {}, configOver: Partial<BotConfig> = {}) {
  const backend = fakeBackend(backendOver);
  const logs: Array<Record<string, unknown>> = [];
  const bot = createBot(
    {
      token: '123:TEST',
      botInfo,
      miniAppBase: BASE,
      webAppUrl: WEBAPP,
      logger: { error: (e) => logs.push(e), warn: (e) => logs.push(e) },
      ...configOver,
    },
    backend,
  );
  const calls: ApiCall[] = [];
  let mid = 500;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const p = payload as Record<string, unknown>;
    const result =
      method === 'sendMessage'
        ? { message_id: ++mid, date: 0, chat: { id: p.chat_id, type: 'private' }, text: p.text }
        : true;
    return { ok: true, result } as never;
  });
  const of = (method: string) => calls.filter((c) => c.method === method);
  return { bot, backend, calls, of, logs };
}

let uid = 1000;
const user = (lang = 'uz', id = 42) => ({ id, is_bot: false, first_name: 'Sardor', language_code: lang });
const privateChat = (id = 42) => ({ id, type: 'private' as const, first_name: 'Sardor' });

export function textUpdate(text: string, opts: { lang?: string; updateId?: number; chat?: 'private' | 'group' } = {}): Update {
  const isCmd = text.startsWith('/');
  const cmdLen = isCmd ? (text.split(' ')[0] ?? '').length : 0;
  return {
    update_id: opts.updateId ?? ++uid,
    message: {
      message_id: 1,
      date: 1_700_000_000,
      chat: opts.chat === 'group' ? { id: -100123, type: 'group', title: 'Group' } : privateChat(),
      from: user(opts.lang),
      text,
      ...(isCmd ? { entities: [{ type: 'bot_command', offset: 0, length: cmdLen }] } : {}),
    },
  } as unknown as Update;
}

export function contactUpdate(contactUserId: number | undefined, phone = '998901234567'): Update {
  return {
    update_id: ++uid,
    message: {
      message_id: 2,
      date: 1_700_000_000,
      chat: privateChat(),
      from: user(),
      contact: { phone_number: phone, first_name: 'Sardor', ...(contactUserId !== undefined ? { user_id: contactUserId } : {}) },
    },
  } as unknown as Update;
}

export function callbackUpdate(data: string, keyboard: unknown[][], lang = 'uz'): Update {
  return {
    update_id: ++uid,
    callback_query: {
      id: 'cbq-1',
      from: user(lang, 111),
      chat_instance: 'ci',
      data,
      message: {
        message_id: 77,
        date: 1_700_000_000,
        chat: privateChat(111),
        from: botInfo,
        text: 'order',
        reply_markup: { inline_keyboard: keyboard },
      },
    },
  } as unknown as Update;
}

export function inlineUpdate(query: string, lang = 'uz'): Update {
  return { update_id: ++uid, inline_query: { id: 'iq-1', from: user(lang), query, offset: '' } } as unknown as Update;
}

export function preCheckoutUpdate(lang = 'uz'): Update {
  return {
    update_id: ++uid,
    pre_checkout_query: { id: 'pcq-1', from: user(lang), currency: 'XTR', total_amount: 250, invoice_payload: 'pay_123' },
  } as unknown as Update;
}

export function successfulPaymentUpdate(updateId?: number): Update {
  return {
    update_id: updateId ?? ++uid,
    message: {
      message_id: 3,
      date: 1_700_000_000,
      chat: privateChat(),
      from: user(),
      successful_payment: {
        currency: 'UZS',
        total_amount: 125_000_000,
        invoice_payload: 'pay_123',
        telegram_payment_charge_id: 'tg_charge_1',
        provider_payment_charge_id: 'prov_1',
      },
    },
  } as unknown as Update;
}
