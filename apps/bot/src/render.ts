/**
 * Pure renderer: OutboxMessage → Telegram message (HTML parse_mode + inline buttons).
 * No grammY import — this module also runs in the demo's in-browser bot chat simulator.
 */
import { allowedEvents, buildStartParam, formatMoney, orderCallback, truncate } from '@dokonim/core';
import type {
  Currency,
  FulfilmentKind,
  Locale,
  OrderCallbackAction,
  OrderEvent,
  OrderStatus,
  OrderSummary,
  OutboxMessage,
  StartPayload,
} from '@dokonim/core';
import { escapeHtml } from './html';
import { MONTHS, actionLabel, paymentMethodLabel, roleLabel, statusLabel, t, tHtml } from './messages';
import type { MessageKey } from './messages';

export { escapeHtml, utf8Length } from './html';

export interface RenderedButton {
  text: string;
  /** callback_data (≤ 64 bytes). */
  callback?: string;
  /** Any http(s)/tg URL, including t.me Mini App deep links. */
  url?: string;
  /** Direct https URL of the Mini App; delivered as a web_app button in private chats only. */
  webApp?: string;
}

export interface RenderedMessage {
  chatId: number;
  /** Telegram HTML parse_mode; every interpolated value is escaped. */
  text: string;
  buttons: RenderedButton[][];
}

export interface RenderOptions {
  /** Mini App deep-link base, e.g. https://t.me/dokonim_bot/shop */
  miniAppBase: string;
}

export interface StartRenderOptions extends RenderOptions {
  /** https URL of the Mini App itself; when set, buttons also carry `webApp` (used in private chats). */
  webAppUrl?: string;
}

export interface StartRendered {
  text: string;
  buttons: RenderedButton[][];
}

const MAX_ITEMS = 10;
const MAX_TEXT = 600;

// ── Links ────────────────────────────────────────────────────────────────

function withQuery(base: string, key: string, value: string): string {
  if (!value) return base;
  return `${base}${base.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

/** `https://t.me/<bot>/<app>?startapp=<payload>` (no query for the hub). */
export function appLink(miniAppBase: string, payload: StartPayload): string {
  return withQuery(miniAppBase, 'startapp', buildStartParam(payload));
}

/** Direct Mini App URL for web_app buttons; the payload rides along as `?startapp=` (initData has no start_param there). */
export function webAppLink(webAppUrl: string, payload: StartPayload): string {
  return withQuery(webAppUrl, 'startapp', buildStartParam(payload));
}

/** Telegram's share sheet for a link. */
export function shareLink(url: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** Normalises a phone to +digits (Telegram sends contacts with or without '+'). Returns null when it has < 7 digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 ? `+${digits}` : null;
}

/**
 * "Call" button target. Telegram rejects `tel:` URLs in inline buttons (BUTTON_URL_INVALID), so we use the
 * `t.me/+<phone>` link, which opens the buyer's Telegram profile (call / chat from there).
 */
export function callLink(phone: string): string | null {
  const p = normalizePhone(phone);
  return p ? `https://t.me/${p}` : null;
}

// ── Order helpers ────────────────────────────────────────────────────────

const EVENT_ACTION: Partial<Record<OrderEvent, OrderCallbackAction>> = {
  confirm: 'confirm',
  pack: 'pack',
  ship: 'ship',
  ready_for_pickup: 'ready',
  deliver: 'deliver',
};

/** The primary next step staff can take from the bot (first allowed event with a callback action; never cancel). */
export function nextStaffAction(status: OrderStatus, fulfilment: FulfilmentKind): OrderCallbackAction | null {
  for (const e of allowedEvents(status, 'staff', fulfilment)) {
    const a = EVENT_ACTION[e];
    if (a) return a;
  }
  return null;
}

export function actionButton(locale: Locale, action: OrderCallbackAction, orderId: string): RenderedButton {
  return { text: actionLabel(locale, action), callback: orderCallback(action, orderId) };
}

function money(minor: number, currency: Currency, locale: Locale): string {
  return formatMoney(minor, currency, locale);
}

/** "15-noyabr" / "15 ноября" / "15 November"; unparseable input is returned as-is. */
export function formatDay(iso: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[locale][Number(m[2]) - 1];
  if (!month) return iso;
  const day = Number(m[3]);
  return locale === 'uz' ? `${day}-${month}` : `${day} ${month}`;
}

export function formatWindow(from: string | null, to: string | null, locale: Locale): string | null {
  if (!from && !to) return null;
  if (!from || !to || from.slice(0, 10) === to.slice(0, 10)) return formatDay((from ?? to)!, locale);
  return `${formatDay(from, locale)} – ${formatDay(to, locale)}`;
}

function itemsBlock(o: OrderSummary, locale: Locale): string {
  const lines = o.items.slice(0, MAX_ITEMS).map((i) => {
    const variant = i.variantTitle ? ` (${escapeHtml(i.variantTitle)})` : '';
    return `• ${escapeHtml(truncate(i.title, 80))}${variant} × ${i.qty}`;
  });
  if (o.items.length > MAX_ITEMS) lines.push(tHtml(locale, 'items.more', { n: o.items.length - MAX_ITEMS }));
  return lines.join('\n');
}

function line(locale: Locale, label: MessageKey, valueHtml: string): string {
  return `<b>${escapeHtml(t(locale, label))}:</b> ${valueHtml}`;
}

function fulfilmentLine(o: OrderSummary, locale: Locale): string {
  const window = formatWindow(o.deliveryFrom, o.deliveryTo, locale) ?? t(locale, 'label.dateTbd');
  return line(locale, o.fulfilment === 'pickup' ? 'label.pickup' : 'label.delivery', escapeHtml(window));
}

function totalLine(o: OrderSummary, locale: Locale): string {
  return line(locale, 'label.total', `<b>${escapeHtml(money(o.total, o.currency, locale))}</b>`);
}

function paymentLine(o: OrderSummary, locale: Locale): string {
  return line(locale, 'label.payment', escapeHtml(paymentMethodLabel(locale, o.paymentMethod)));
}

/** Full order card for staff: items, total, buyer, payment method, delivery window. */
function staffOrderCard(o: OrderSummary, locale: Locale): string {
  const buyer = `${escapeHtml(o.buyerName)}, ${o.buyerPhone ? escapeHtml(o.buyerPhone) : escapeHtml(t(locale, 'label.noPhone'))}`;
  return [itemsBlock(o, locale), '', totalLine(o, locale), line(locale, 'label.buyer', buyer), paymentLine(o, locale), fulfilmentLine(o, locale)].join('\n');
}

function buyerOrderCard(o: OrderSummary, locale: Locale): string {
  return [itemsBlock(o, locale), '', totalLine(o, locale), paymentLine(o, locale), fulfilmentLine(o, locale)].join('\n');
}

function orderVars(o: OrderSummary): { number: number; store: string } {
  return { number: o.number, store: o.storeName };
}

function manageButton(locale: Locale, base: string, slug: string, key: MessageKey = 'btn.open'): RenderedButton {
  return { text: t(locale, key), url: appLink(base, { kind: 'manage', slug }) };
}

function buyerOrderButton(locale: Locale, base: string, o: OrderSummary): RenderedButton {
  return { text: t(locale, 'btn.openOrder'), url: appLink(base, { kind: 'order', slug: o.storeSlug, orderShortId: o.shortId }) };
}

/** Staff keyboard for an order: [next action] [📞 call] then [Open]. */
function staffOrderButtons(locale: Locale, base: string, o: OrderSummary): RenderedButton[][] {
  const first: RenderedButton[] = [];
  const next = nextStaffAction(o.status, o.fulfilment);
  if (next) first.push(actionButton(locale, next, o.orderId));
  const call = o.buyerPhone ? callLink(o.buyerPhone) : null;
  if (call) first.push({ text: t(locale, 'btn.call'), url: call });
  const rows: RenderedButton[][] = [];
  if (first.length) rows.push(first);
  rows.push([manageButton(locale, base, o.storeSlug)]);
  return rows;
}

function isStaff(msg: OutboxMessage): boolean {
  return msg.recipient.kind !== 'buyer';
}

function stars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function quote(s: string): string {
  return `<blockquote>${escapeHtml(truncate(s.trim(), MAX_TEXT))}</blockquote>`;
}

// ── Notification renderer ───────────────────────────────────────────────

export function renderNotification(msg: OutboxMessage, opts: RenderOptions): RenderedMessage {
  const locale = msg.recipient.locale;
  const base = opts.miniAppBase;
  const p = msg.payload;
  const out = (parts: Array<string | null | false | undefined>, buttons: RenderedButton[][]): RenderedMessage => ({
    chatId: msg.recipient.telegramId,
    text: parts.filter((x): x is string => typeof x === 'string').join('\n'),
    buttons: buttons.filter((r) => r.length > 0),
  });

  switch (p.topic) {
    case 'order.placed': {
      const o = p.order;
      if (isStaff(msg)) {
        return out(
          [
            tHtml(locale, 'order.new.owner', orderVars(o)),
            '',
            staffOrderCard(o, locale),
            o.status === 'pending_payment' && `\n${tHtml(locale, 'order.awaitingPayment.owner')}`,
          ],
          staffOrderButtons(locale, base, o),
        );
      }
      return out(
        [
          tHtml(locale, 'order.new.buyer', orderVars(o)),
          '',
          buyerOrderCard(o, locale),
          '',
          tHtml(locale, o.status === 'pending_payment' ? 'order.new.buyer.pay' : 'order.new.buyer.wait'),
        ],
        [[buyerOrderButton(locale, base, o)]],
      );
    }

    case 'order.paid': {
      const o = p.order;
      const amount = `<b>${escapeHtml(money(o.total, o.currency, locale))}</b> · ${escapeHtml(paymentMethodLabel(locale, o.paymentMethod))}`;
      if (isStaff(msg)) {
        const next = nextStaffAction(o.status, o.fulfilment);
        return out(
          [tHtml(locale, 'order.paid.owner', orderVars(o)), amount, next === 'confirm' && `\n${tHtml(locale, 'order.paid.owner.next')}`],
          staffOrderButtons(locale, base, o),
        );
      }
      return out([tHtml(locale, 'order.paid.buyer', orderVars(o)), amount, '', tHtml(locale, 'order.paid.buyer.next')], [
        [buyerOrderButton(locale, base, o)],
      ]);
    }

    case 'order.status_changed': {
      const o = p.order;
      const v = orderVars(o);
      if (isStaff(msg)) {
        return out(
          [tHtml(locale, 'status.staff', { ...v, from: statusLabel(locale, p.from), to: statusLabel(locale, p.to) })],
          staffOrderButtons(locale, base, { ...o, status: p.to }),
        );
      }
      const open = [buyerOrderButton(locale, base, o)];
      switch (p.to) {
        case 'confirmed':
          return out([tHtml(locale, 'status.buyer.confirmed', v)], [open]);
        case 'packing':
          return out([tHtml(locale, 'status.buyer.packing', v)], [open]);
        case 'shipped': {
          const window = formatWindow(o.deliveryFrom, o.deliveryTo, locale);
          return out(
            [
              tHtml(locale, 'status.buyer.shipped', v),
              window && line(locale, 'label.delivery', escapeHtml(window)),
              p.trackingNumber?.trim() ? line(locale, 'label.tracking', `<code>${escapeHtml(p.trackingNumber.trim())}</code>`) : null,
            ],
            [open],
          );
        }
        case 'ready_for_pickup':
          return out(
            [tHtml(locale, 'status.buyer.ready', v), p.pickupCode ? tHtml(locale, 'status.buyer.pickupCode', { code: p.pickupCode }) : null],
            [open],
          );
        case 'delivered':
          return out([tHtml(locale, 'status.buyer.delivered', v)], [
            [{ text: t(locale, 'btn.review'), url: appLink(base, { kind: 'order', slug: o.storeSlug, orderShortId: o.shortId }) }],
          ]);
        case 'completed':
          return out([tHtml(locale, 'status.buyer.completed', v)], [open]);
        case 'returned':
          return out([tHtml(locale, 'status.buyer.returned', v), o.paymentMethod !== 'cod' && tHtml(locale, 'status.buyer.refund')], [open]);
        default:
          return out([tHtml(locale, 'status.generic', { ...v, status: statusLabel(locale, p.to) })], [open]);
      }
    }

    case 'order.cancelled': {
      const o = p.order;
      const by = p.by === 'buyer' ? 'byBuyer' : p.by === 'staff' ? 'byStaff' : 'bySystem';
      const reason = p.reason?.trim() ? line(locale, 'label.reason', escapeHtml(truncate(p.reason.trim(), MAX_TEXT))) : null;
      if (isStaff(msg)) {
        return out([tHtml(locale, 'cancelled.title', orderVars(o)), tHtml(locale, `cancelled.owner.${by}`), reason], [
          [manageButton(locale, base, o.storeSlug)],
        ]);
      }
      return out([tHtml(locale, 'cancelled.title', orderVars(o)), tHtml(locale, `cancelled.buyer.${by}`), reason], [
        [buyerOrderButton(locale, base, o)],
      ]);
    }

    case 'review.created':
      return out(
        [tHtml(locale, 'review.created', { store: p.storeName, product: p.productTitle, stars: stars(p.rating) }), p.text.trim() ? quote(p.text) : null],
        [[manageButton(locale, base, p.storeSlug, 'btn.reply')]],
      );

    case 'question.created':
      return out([tHtml(locale, 'question.created', { store: p.storeName, product: p.productTitle }), quote(p.text)], [
        [manageButton(locale, base, p.storeSlug, 'btn.reply')],
      ]);

    case 'question.answered':
      return out(
        [
          tHtml(locale, 'question.answered', { store: p.storeName, product: p.productTitle }),
          `<i>${escapeHtml(truncate(p.question.trim(), MAX_TEXT))}</i>`,
          quote(p.answer),
        ],
        [[{ text: t(locale, 'btn.openProduct'), url: appLink(base, { kind: 'product', slug: p.storeSlug, productShortId: p.productShortId }) }]],
      );

    case 'stock.low': {
      const product = p.variantTitle ? `${p.productTitle} (${p.variantTitle})` : p.productTitle;
      return out([tHtml(locale, 'stock.low', { store: p.storeName, product, n: p.available })], [
        [manageButton(locale, base, p.storeSlug, 'btn.products')],
      ]);
    }

    case 'store.created': {
      const link = appLink(base, { kind: 'store', slug: p.storeSlug });
      return out([tHtml(locale, 'store.created', { store: p.storeName, link })], [
        [{ text: t(locale, 'btn.share'), url: shareLink(link, t(locale, 'store.shareText', { store: p.storeName })) }],
        [manageButton(locale, base, p.storeSlug, 'btn.openDashboard')],
      ]);
    }

    case 'staff.joined':
      return out([tHtml(locale, 'staff.joined', { store: p.storeName, name: p.memberName, role: roleLabel(locale, p.role) })], [
        [manageButton(locale, base, p.storeSlug, 'btn.team')],
      ]);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────

function openButton(locale: Locale, key: MessageKey, payload: StartPayload, opts: StartRenderOptions): RenderedButton {
  const b: RenderedButton = { text: t(locale, key), url: appLink(opts.miniAppBase, payload) };
  if (opts.webAppUrl) b.webApp = webAppLink(opts.webAppUrl, payload);
  return b;
}

/** Welcome for `/start` and `/start <payload>`: routes like `startapp` (§14.2). */
export function renderStart(payload: StartPayload, locale: Locale, opts: StartRenderOptions): StartRendered {
  const create = openButton(locale, 'btn.createStore', { kind: 'new' }, opts);
  switch (payload.kind) {
    case 'hub':
      return { text: tHtml(locale, 'start.hub'), buttons: [[openButton(locale, 'btn.openStore', payload, opts)], [create]] };
    case 'new':
      return { text: tHtml(locale, 'start.new'), buttons: [[create]] };
    case 'manage':
      return { text: tHtml(locale, 'start.manage'), buttons: [[openButton(locale, 'btn.openDashboard', payload, opts)]] };
    case 'store':
      return { text: `${tHtml(locale, 'start.hub')}\n\n${tHtml(locale, 'start.store')}`, buttons: [[openButton(locale, 'btn.openStore', payload, opts)], [create]] };
    case 'product':
      return { text: tHtml(locale, 'start.product'), buttons: [[openButton(locale, 'btn.openProduct', payload, opts)], [openButton(locale, 'btn.openStore', { kind: 'store', slug: payload.slug }, opts)]] };
    case 'order':
      return { text: tHtml(locale, 'start.order'), buttons: [[openButton(locale, 'btn.openOrder', payload, opts)]] };
  }
}

export function renderHelp(locale: Locale, botUsername = 'dokonim_bot'): string {
  return tHtml(locale, 'help', { bot: botUsername });
}

export function renderPaySupport(locale: Locale): string {
  return tHtml(locale, 'paysupport');
}

/** Short receipt after `successful_payment`; amount is in minor units of `currency`. */
export function renderReceipt(totalAmount: number, currency: string, locale: Locale): string {
  return tHtml(locale, 'payment.receipt', { amount: formatAmount(totalAmount, currency, locale) });
}

export function formatAmount(totalAmount: number, currency: string, locale: Locale): string {
  if (currency === 'UZS' || currency === 'XTR' || currency === 'USD') return formatMoney(totalAmount, currency, locale);
  return `${(totalAmount / 100).toFixed(2)} ${currency}`;
}
