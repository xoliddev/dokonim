/**
 * grammY bot (§14.2): /start routing, /help, /paysupport, contact verification, order action callbacks,
 * inline product search, Telegram Payments / Stars pre-checkout + successful_payment.
 * Stateless: every decision goes through `BotBackend`.
 */
import { Bot, webhookCallback } from 'grammy';
import type { BotError, Context } from 'grammy';
import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  InlineQueryResultArticle,
  UserFromGetMe,
} from 'grammy/types';
import { ORDER_STATUSES, parseCallback, parseStartParam, toLocale, truncate } from '@dokonim/core';
import type { FulfilmentKind, Locale, OrderCallbackAction, OrderStatus } from '@dokonim/core';
import type { BotBackend, OrderActionResult } from './backend';
import { escapeHtml, utf8Length } from './html';
import { t } from './messages';
import type { MessageKey } from './messages';
import {
  actionButton,
  appLink,
  formatAmount,
  nextStaffAction,
  normalizePhone,
  renderHelp,
  renderPaySupport,
  renderReceipt,
  renderStart,
} from './render';
import type { RenderedButton, RenderedMessage } from './render';

export interface BotLogger {
  error(entry: Record<string, unknown>): void;
  warn?(entry: Record<string, unknown>): void;
}

export interface BotConfig {
  token: string;
  /** Lets tests (and cold starts) skip getMe. */
  botInfo?: UserFromGetMe;
  /** Deep-link base, e.g. https://t.me/dokonim_bot/shop */
  miniAppBase: string;
  /** https URL of the Mini App, used for web_app buttons in private chats. */
  webAppUrl: string;
  /** Pre-checkout answer deadline (Telegram allows 10 s). Default 9000 ms. */
  preCheckoutDeadlineMs?: number;
  /** Structured logger; defaults to one JSON line on stderr. Never receives PII. */
  logger?: BotLogger;
}

export const PRE_CHECKOUT_DEADLINE_MS = 9_000;
const INLINE_CACHE_TIME = 30;
const INLINE_MAX_RESULTS = 50;

const defaultLogger: BotLogger = {
  error: (e) => console.error(JSON.stringify(e)),
  warn: (e) => console.warn(JSON.stringify(e)),
};

// ── Keyboards & delivery ─────────────────────────────────────────────────

/** RenderedButton[][] → Bot API inline keyboard. web_app buttons are only allowed in private chats. */
export function toInlineKeyboard(buttons: RenderedButton[][], opts: { allowWebApp: boolean }): InlineKeyboardMarkup | undefined {
  const rows: InlineKeyboardButton[][] = [];
  for (const row of buttons) {
    const out: InlineKeyboardButton[] = [];
    for (const b of row) {
      if (b.callback !== undefined) out.push({ text: b.text, callback_data: b.callback });
      else if (b.webApp && opts.allowWebApp) out.push({ text: b.text, web_app: { url: b.webApp } });
      else if (b.url) out.push({ text: b.text, url: b.url });
      else if (b.webApp) out.push({ text: b.text, url: b.webApp });
    }
    if (out.length) rows.push(out);
  }
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export interface SendMessageOptions {
  parse_mode: 'HTML';
  reply_markup?: InlineKeyboardMarkup;
  link_preview_options?: { is_disabled?: boolean };
}

/** Anything with Bot API `sendMessage` — `bot.api` or a fake. */
export interface MessageSender {
  sendMessage(chatId: number, text: string, other?: SendMessageOptions): Promise<{ message_id: number }>;
}

/** Private chats have positive ids (= the user id); groups and channels are negative. */
export function isPrivateChatId(chatId: number): boolean {
  return chatId > 0;
}

/** Sends a rendered outbox message (HTML, inline keyboard) and returns the Telegram message id. */
export async function deliver(api: MessageSender, rendered: RenderedMessage): Promise<number> {
  const reply_markup = toInlineKeyboard(rendered.buttons, { allowWebApp: isPrivateChatId(rendered.chatId) });
  const other: SendMessageOptions = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  if (reply_markup) other.reply_markup = reply_markup;
  const sent = await api.sendMessage(rendered.chatId, rendered.text, other);
  return sent.message_id;
}

/**
 * After a staff action: drop every order-action button for this order from the existing keyboard and put the
 * next step (if any) where the used button was. Other buttons (call, open) stay.
 */
export function nextKeyboard(
  existing: readonly (readonly InlineKeyboardButton[])[] | undefined,
  orderId: string,
  next: { action: OrderCallbackAction; locale: Locale } | null,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  let slot: { row: number; col: number } | null = null;
  for (const row of existing ?? []) {
    const kept: InlineKeyboardButton[] = [];
    for (const b of row) {
      const cb = 'callback_data' in b && typeof b.callback_data === 'string' ? parseCallback(b.callback_data) : null;
      if (cb && cb.orderId === orderId) {
        slot ??= { row: rows.length, col: kept.length };
        continue;
      }
      kept.push(b);
    }
    rows.push(kept);
  }
  if (next) {
    const rb = actionButton(next.locale, next.action, orderId);
    const btn: InlineKeyboardButton = { text: rb.text, callback_data: rb.callback! };
    if (slot) rows[slot.row]!.splice(slot.col, 0, btn);
    else rows.unshift([btn]);
  }
  return { inline_keyboard: rows.filter((r) => r.length > 0) };
}

function isOrderStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s);
}

/** Next staff action after a callback; fulfilment comes from the returned message, else must agree for both kinds. */
export function nextActionAfter(result: Extract<OrderActionResult, { ok: true }>): OrderCallbackAction | null {
  if (!isOrderStatus(result.status)) return null;
  const payload = result.message?.payload;
  const fulfilment: FulfilmentKind | null = payload && 'order' in payload ? payload.order.fulfilment : null;
  if (fulfilment) return nextStaffAction(result.status, fulfilment);
  const a = nextStaffAction(result.status, 'delivery');
  return a === nextStaffAction(result.status, 'pickup') ? a : null;
}

const TOAST_STATUSES = new Set<string>(['confirmed', 'packing', 'shipped', 'ready_for_pickup', 'delivered', 'cancelled']);
const ERROR_CODES = new Set<string>(['FORBIDDEN', 'INVALID_TRANSITION', 'NOT_FOUND']);

export function callbackToast(status: string, locale: Locale): string {
  if (TOAST_STATUSES.has(status)) return t(locale, `toast.${status}` as MessageKey);
  return t(locale, 'toast.generic', { status: isOrderStatus(status) ? t(locale, `os.${status}` as MessageKey) : status });
}

export function callbackError(code: string, locale: Locale): string {
  return t(locale, ERROR_CODES.has(code) ? (`error.${code}` as MessageKey) : 'error.generic');
}

/** Resolves within `ms`: the promise's value, or `fallback` on timeout or rejection. */
export function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function updateKinds(ctx: Context): string[] {
  return Object.keys(ctx.update).filter((k) => k !== 'update_id');
}

// ── Bot ──────────────────────────────────────────────────────────────────

export function createBot(config: BotConfig, backend: BotBackend): Bot {
  const bot = config.botInfo ? new Bot(config.token, { botInfo: config.botInfo }) : new Bot(config.token);
  const log = config.logger ?? defaultLogger;
  const deadlineMs = config.preCheckoutDeadlineMs ?? PRE_CHECKOUT_DEADLINE_MS;
  const startOpts = { miniAppBase: config.miniAppBase, webAppUrl: config.webAppUrl };

  // No PII: ids of the update only, never user ids, names, phones or message text.
  const onError = (err: BotError<Context>): void => {
    const e = err.error;
    log.error({
      event: 'bot_error',
      update_id: err.ctx.update.update_id,
      update: updateKinds(err.ctx),
      error: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? truncate(e.message, 300) : undefined,
    });
  };
  bot.catch(onError);

  const locales = new WeakMap<Context, Promise<Locale>>();
  /** Recipient language: stored user locale (upserted once per update), falling back to the client language. */
  const localeOf = (ctx: Context): Promise<Locale> => {
    const fallback = toLocale(ctx.from?.language_code);
    if (!ctx.from || ctx.from.is_bot) return Promise.resolve(fallback);
    let p = locales.get(ctx);
    if (!p) {
      const f = ctx.from;
      p = backend
        .upsertUser({
          telegramId: f.id,
          firstName: f.first_name,
          ...(f.last_name ? { lastName: f.last_name } : {}),
          ...(f.username ? { username: f.username } : {}),
          ...(f.language_code ? { languageCode: f.language_code } : {}),
        })
        .then((r) => r.locale)
        .catch(() => fallback);
      locales.set(ctx, p);
    }
    return p;
  };

  // Logs and swallows handler errors so webhook mode (where bot.catch does not run) still gets structured logs.
  // A failed successful_payment is rethrown instead: the webhook then answers 500 and Telegram redelivers it.
  const c = bot.errorBoundary((err) => {
    onError(err);
    if (err.ctx.message?.successful_payment) throw err;
  });

  // 1) Dedupe by update_id — first, before any side effect. A failed update is forgotten so a redelivery runs again.
  c.use(async (ctx, next) => {
    if (await backend.seenUpdate(ctx.update.update_id)) return;
    try {
      await next();
    } catch (e) {
      await backend.forgetUpdate?.(ctx.update.update_id).catch(() => undefined);
      throw e;
    }
  });

  // 2) Commands
  c.command('start', async (ctx) => {
    const locale = await localeOf(ctx);
    const payload = parseStartParam(typeof ctx.match === 'string' ? ctx.match.trim() : '');
    const r = renderStart(payload, locale, startOpts);
    const reply_markup = toInlineKeyboard(r.buttons, { allowWebApp: ctx.chat.type === 'private' });
    await ctx.reply(r.text, { parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) });
  });

  c.command('help', async (ctx) => {
    const locale = await localeOf(ctx);
    await ctx.reply(renderHelp(locale, ctx.me.username), { parse_mode: 'HTML' });
  });

  c.command('paysupport', async (ctx) => {
    const locale = await localeOf(ctx);
    await ctx.reply(renderPaySupport(locale), { parse_mode: 'HTML' });
  });

  // 3) Contact verification: only the sender's own contact proves the phone.
  c.on('message:contact', async (ctx) => {
    const locale = await localeOf(ctx);
    const contact = ctx.message.contact;
    const phone = normalizePhone(contact.phone_number);
    if (contact.user_id === undefined || contact.user_id !== ctx.from.id || !phone) {
      await ctx.reply(escapeHtml(t(locale, 'contact.notOwn')), { parse_mode: 'HTML' });
      return;
    }
    await backend.saveVerifiedPhone(ctx.from.id, phone);
    await ctx.reply(escapeHtml(t(locale, 'contact.saved', { phone })), { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } });
  });

  // 4) Order action buttons
  c.on('callback_query:data', async (ctx) => {
    const cb = parseCallback(ctx.callbackQuery.data);
    if (!cb) {
      await ctx.answerCallbackQuery();
      return;
    }
    const locale = await localeOf(ctx);
    let result: OrderActionResult;
    try {
      result = await backend.orderAction(ctx.from.id, cb.orderId, cb.action);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: callbackError('INTERNAL', locale), show_alert: true }).catch(() => undefined);
      throw err;
    }
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: callbackError(result.code, locale), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: callbackToast(result.status, locale) });
    const msg = ctx.callbackQuery.message;
    if (!msg && !ctx.callbackQuery.inline_message_id) return;
    const existing = msg && 'reply_markup' in msg ? msg.reply_markup?.inline_keyboard : undefined;
    const action = nextActionAfter(result);
    const markup = nextKeyboard(existing, cb.orderId, action ? { action, locale } : null);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: markup });
    } catch (err) {
      // "message is not modified" / too old to edit: the action itself succeeded, so only note it.
      log.warn?.({ event: 'bot_edit_markup_failed', update_id: ctx.update.update_id, message: err instanceof Error ? truncate(err.message, 200) : undefined });
    }
  });

  // 5) Inline mode: "@dokonim_bot <store-slug> <query>" or "<query>"
  c.on('inline_query', async (ctx) => {
    const q = ctx.inlineQuery;
    const locale = toLocale(q.from.language_code);
    const products = await backend.inlineProducts(q.query.trim(), q.from.id);
    const seen = new Set<string>();
    const results: InlineQueryResultArticle[] = [];
    for (const p of products) {
      const id = utf8Length(p.id) <= 64 ? p.id : p.id.slice(0, 32);
      if (seen.has(id)) continue;
      seen.add(id);
      const price = formatAmount(p.price, p.currency, locale);
      const link = appLink(config.miniAppBase, { kind: 'product', slug: p.storeSlug, productShortId: p.shortId });
      const desc = p.description?.trim();
      const article: InlineQueryResultArticle = {
        type: 'article',
        id,
        title: truncate(p.title, 100),
        description: [t(locale, 'inline.description', { price, store: p.storeName }), desc ? truncate(desc, 120) : null].filter(Boolean).join('\n'),
        input_message_content: {
          message_text: [
            `<b>${escapeHtml(truncate(p.title, 200))}</b>`,
            `${escapeHtml(price)} · ${escapeHtml(p.storeName)}`,
            desc ? `\n${escapeHtml(truncate(desc, 500))}` : null,
          ]
            .filter((x): x is string => x !== null)
            .join('\n'),
          parse_mode: 'HTML',
          ...(p.imageUrl ? { link_preview_options: { url: p.imageUrl, prefer_large_media: true, show_above_text: true } } : { link_preview_options: { is_disabled: true } }),
        },
        reply_markup: { inline_keyboard: [[{ text: t(locale, 'btn.open'), url: link }]] },
        url: link,
        ...(p.imageUrl ? { thumbnail_url: p.imageUrl } : {}),
      };
      results.push(article);
      if (results.length >= INLINE_MAX_RESULTS) break;
    }
    await ctx.answerInlineQuery(results, { cache_time: INLINE_CACHE_TIME, is_personal: true });
  });

  // 6) Payments: answer within the deadline no matter what the backend does.
  c.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const locale = toLocale(q.from.language_code);
    const timeout = { ok: false as const, errorMessage: t(locale, 'precheckout.timeout') };
    const decision = await withDeadline(
      backend.preCheckout({
        id: q.id,
        payload: q.invoice_payload,
        totalAmount: q.total_amount,
        currency: q.currency,
        fromId: q.from.id,
        ...(q.from.language_code ? { languageCode: q.from.language_code } : {}),
      }),
      deadlineMs,
      timeout,
    );
    if (decision.ok) await ctx.answerPreCheckoutQuery(true);
    else await ctx.answerPreCheckoutQuery(false, { error_message: decision.errorMessage || timeout.errorMessage });
  });

  c.on('message:successful_payment', async (ctx) => {
    const sp = ctx.message.successful_payment;
    await backend.successfulPayment({
      payload: sp.invoice_payload,
      totalAmount: sp.total_amount,
      currency: sp.currency,
      telegramChargeId: sp.telegram_payment_charge_id,
      ...(sp.provider_payment_charge_id ? { providerChargeId: sp.provider_payment_charge_id } : {}),
      fromId: ctx.from.id,
    });
    const locale = await localeOf(ctx);
    await ctx.reply(renderReceipt(sp.total_amount, sp.currency, locale), { parse_mode: 'HTML' });
  });

  return bot;
}

/** Fastify handler for the API: `app.post('/tg/webhook', webhookCallbackFor(bot, secret))`. */
export function webhookCallbackFor(bot: Bot, secretToken: string) {
  return webhookCallback(bot, 'fastify', { secretToken });
}
