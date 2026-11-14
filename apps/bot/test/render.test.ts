import { describe, expect, it } from 'vitest';
import { formatMoney, parseCallback, parseStartParam } from '@dokonim/core';
import type { NotificationPayload } from '@dokonim/core';
import {
  appLink,
  callLink,
  formatWindow,
  nextStaffAction,
  normalizePhone,
  renderHelp,
  renderNotification,
  renderPaySupport,
  renderReceipt,
  renderStart,
  utf8Length,
} from '../src/render';
import type { RenderedMessage } from '../src/render';
import { messages } from '../src/messages';
import { BASE, LOCALES, ORDER_ID, WEBAPP, order, outbox } from './fixtures';

const opts = { miniAppBase: BASE };

function allButtons(r: RenderedMessage) {
  return r.buttons.flat();
}

function assertSafe(r: RenderedMessage) {
  expect(r.text).not.toMatch(/<script>/);
  expect(r.text).not.toMatch(/<Atelier>/);
  for (const b of allButtons(r)) {
    expect(b.text.length).toBeGreaterThan(0);
    if (b.callback !== undefined) expect(utf8Length(b.callback)).toBeLessThanOrEqual(64);
    if (b.url) expect(b.url).toMatch(/^(https:\/\/|tg:\/\/)/);
  }
  // Only Telegram-supported tags appear.
  for (const m of r.text.matchAll(/<\/?([a-z]+)[^>]*>/g)) expect(['b', 'i', 'code', 'blockquote', 'a']).toContain(m[1]);
}

const TOPICS: Array<{ name: string; payload: NotificationPayload; kind: 'owner' | 'buyer' }> = [
  { name: 'order.placed owner', payload: { topic: 'order.placed', order: order() }, kind: 'owner' },
  { name: 'order.placed buyer', payload: { topic: 'order.placed', order: order({ status: 'pending_payment' }) }, kind: 'buyer' },
  { name: 'order.paid owner', payload: { topic: 'order.paid', order: order({ status: 'paid' }) }, kind: 'owner' },
  { name: 'order.paid buyer', payload: { topic: 'order.paid', order: order({ status: 'paid' }) }, kind: 'buyer' },
  { name: 'status confirmed', payload: { topic: 'order.status_changed', order: order({ status: 'confirmed' }), from: 'paid', to: 'confirmed' }, kind: 'buyer' },
  { name: 'status packing', payload: { topic: 'order.status_changed', order: order({ status: 'packing' }), from: 'confirmed', to: 'packing' }, kind: 'buyer' },
  {
    name: 'status shipped',
    payload: { topic: 'order.status_changed', order: order({ status: 'shipped' }), from: 'packing', to: 'shipped', trackingNumber: 'UZ<123>' },
    kind: 'buyer',
  },
  {
    name: 'status ready',
    payload: { topic: 'order.status_changed', order: order({ status: 'ready_for_pickup', fulfilment: 'pickup' }), from: 'packing', to: 'ready_for_pickup', pickupCode: '482913' },
    kind: 'buyer',
  },
  { name: 'status delivered', payload: { topic: 'order.status_changed', order: order({ status: 'delivered' }), from: 'shipped', to: 'delivered' }, kind: 'buyer' },
  { name: 'status completed', payload: { topic: 'order.status_changed', order: order({ status: 'completed' }), from: 'delivered', to: 'completed' }, kind: 'buyer' },
  { name: 'status returned', payload: { topic: 'order.status_changed', order: order({ status: 'returned' }), from: 'return_requested', to: 'returned' }, kind: 'buyer' },
  {
    name: 'status return_requested owner',
    payload: { topic: 'order.status_changed', order: order({ status: 'return_requested' }), from: 'delivered', to: 'return_requested' },
    kind: 'owner',
  },
  { name: 'cancelled buyer', payload: { topic: 'order.cancelled', order: order({ status: 'cancelled' }), by: 'staff', reason: 'Tugadi <b>' }, kind: 'buyer' },
  { name: 'cancelled owner', payload: { topic: 'order.cancelled', order: order({ status: 'cancelled' }), by: 'buyer' }, kind: 'owner' },
  {
    name: 'review.created',
    payload: { topic: 'review.created', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza', reviewId: 'r1', productId: 'p1', productTitle: 'Atlas', rating: 4, text: 'Zoʻr! <script>x</script>' },
    kind: 'owner',
  },
  {
    name: 'question.created',
    payload: { topic: 'question.created', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza', questionId: 'q1', productId: 'p1', productTitle: 'Atlas', text: 'Razmer bormi?' },
    kind: 'owner',
  },
  {
    name: 'question.answered',
    payload: {
      topic: 'question.answered',
      storeSlug: 'dilnoza-atelier',
      storeName: 'Dilnoza',
      productId: 'p1',
      productShortId: 'AB12',
      productTitle: 'Atlas',
      question: 'Razmer bormi?',
      answer: 'Ha, M va L',
    },
    kind: 'buyer',
  },
  {
    name: 'stock.low',
    payload: { topic: 'stock.low', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza', productId: 'p1', productTitle: 'Atlas', variantTitle: 'M', available: 2 },
    kind: 'owner',
  },
  { name: 'store.created', payload: { topic: 'store.created', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza' }, kind: 'owner' },
  {
    name: 'staff.joined',
    payload: { topic: 'staff.joined', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza', memberName: 'Kamola <3', role: 'order_operator' },
    kind: 'owner',
  },
];

describe('renderNotification — every topic × locale', () => {
  for (const tc of TOPICS) {
    for (const locale of LOCALES) {
      it(`${tc.name} [${locale}]`, () => {
        const r = renderNotification(outbox(tc.payload, tc.kind, locale), opts);
        expect(r.chatId).toBe(tc.kind === 'buyer' ? 222 : 111);
        expect(r.text.length).toBeGreaterThan(10);
        expect(r.text.length).toBeLessThanOrEqual(4096);
        expect(r.buttons.length).toBeGreaterThan(0);
        assertSafe(r);
        expect({ text: r.text, buttons: r.buttons }).toMatchSnapshot();
      });
    }
  }
});

describe('renderNotification — key content', () => {
  it('owner new order: items, formatted total, buyer, payment, window, buttons', () => {
    const r = renderNotification(outbox({ topic: 'order.placed', order: order() }, 'owner', 'uz'), opts);
    expect(r.text).toContain('Yangi buyurtma #1042');
    expect(r.text).toContain(formatMoney(125_000_000, 'UZS', 'uz'));
    expect(r.text).toContain('Atlas koʻylak (M / qizil) × 1');
    expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; × 2');
    expect(r.text).toContain('&lt;script&gt;Sardor&lt;/script&gt;');
    expect(r.text).toContain('Dilnoza &lt;Atelier&gt; &amp; Co');
    expect(r.text).toContain('Payme');
    expect(r.text).toContain('15-noyabr – 17-noyabr');
    const [row1, row2] = r.buttons;
    expect(row1![0]).toEqual({ text: '✅ Tasdiqlash', callback: `o:confirm:${ORDER_ID}` });
    expect(parseCallback(row1![0]!.callback!)).toEqual({ kind: 'order', action: 'confirm', orderId: ORDER_ID });
    expect(row1![1]!.text).toBe('📞 Qoʻngʻiroq');
    expect(row1![1]!.url).toBe('https://t.me/+998901234567');
    expect(row2![0]).toEqual({ text: 'Ochish', url: `${BASE}?startapp=m-dilnoza-atelier` });
  });

  it('owner new order without phone: no call button; pending payment → no confirm button', () => {
    const r = renderNotification(outbox({ topic: 'order.placed', order: order({ buyerPhone: null, status: 'pending_payment' }) }, 'owner', 'ru'), opts);
    expect(allButtons(r).map((b) => b.text)).toEqual(['Открыть']);
    expect(r.text).toContain('без номера');
    expect(r.text).toContain('Ждём оплату.');
  });

  it('owner paid: next action from allowedEvents (confirm)', () => {
    const r = renderNotification(outbox({ topic: 'order.paid', order: order({ status: 'paid' }) }, 'staff', 'en'), opts);
    expect(r.text).toContain('Payment received');
    expect(r.buttons[0]![0]).toEqual({ text: '✅ Confirm', callback: `o:confirm:${ORDER_ID}` });
  });

  it('buyer: pickup code in bold, open order deep link', () => {
    const r = renderNotification(
      outbox({ topic: 'order.status_changed', order: order({ fulfilment: 'pickup', status: 'ready_for_pickup' }), from: 'packing', to: 'ready_for_pickup', pickupCode: '482913' }, 'buyer', 'uz'),
      opts,
    );
    expect(r.text).toContain('<b>482913</b>');
    expect(r.buttons[0]![0]).toEqual({ text: 'Buyurtmani ochish', url: `${BASE}?startapp=dilnoza-atelier-o-K7Q2M9` });
    expect(parseStartParam('dilnoza-atelier-o-K7Q2M9')).toEqual({ kind: 'order', slug: 'dilnoza-atelier', orderShortId: 'K7Q2M9' });
  });

  it('buyer shipped: date window and escaped tracking number', () => {
    const r = renderNotification(
      outbox({ topic: 'order.status_changed', order: order(), from: 'packing', to: 'shipped', trackingNumber: 'UZ<1>' }, 'buyer', 'ru'),
      opts,
    );
    expect(r.text).toContain('15 ноября – 17 ноября');
    expect(r.text).toContain('<code>UZ&lt;1&gt;</code>');
  });

  it('buyer delivered → review request button to the order', () => {
    const r = renderNotification(outbox({ topic: 'order.status_changed', order: order(), from: 'shipped', to: 'delivered' }, 'buyer', 'en'), opts);
    expect(r.buttons[0]![0]!.text).toBe('⭐ Leave a review');
    expect(r.buttons[0]![0]!.url).toBe(`${BASE}?startapp=dilnoza-atelier-o-K7Q2M9`);
  });

  it('returned: refund line only when not cash on delivery', () => {
    const p = (pm: 'cod' | 'payme'): NotificationPayload => ({ topic: 'order.status_changed', order: order({ paymentMethod: pm }), from: 'return_requested', to: 'returned' });
    expect(renderNotification(outbox(p('payme'), 'buyer', 'uz'), opts).text).toContain('Pul toʻlov');
    expect(renderNotification(outbox(p('cod'), 'buyer', 'uz'), opts).text).not.toContain('Pul toʻlov');
  });

  it('cancelled: direction-specific copy and escaped reason', () => {
    const buyer = renderNotification(outbox({ topic: 'order.cancelled', order: order(), by: 'staff', reason: '<i>x</i>' }, 'buyer', 'uz'), opts);
    expect(buyer.text).toContain('Doʻkon buyurtmani bekor qildi.');
    expect(buyer.text).toContain('&lt;i&gt;x&lt;/i&gt;');
    const owner = renderNotification(outbox({ topic: 'order.cancelled', order: order(), by: 'buyer' }, 'owner', 'uz'), opts);
    expect(owner.text).toContain('Xaridor bekor qildi.');
    expect(owner.buttons[0]![0]!.url).toBe(`${BASE}?startapp=m-dilnoza-atelier`);
  });

  it('review / question → [Javob berish] to the dashboard', () => {
    for (const payload of [TOPICS.find((x) => x.name === 'review.created')!.payload, TOPICS.find((x) => x.name === 'question.created')!.payload]) {
      const r = renderNotification(outbox(payload, 'owner', 'uz'), opts);
      expect(r.buttons[0]![0]).toEqual({ text: 'Javob berish', url: `${BASE}?startapp=m-dilnoza-atelier` });
    }
    const review = renderNotification(outbox(TOPICS.find((x) => x.name === 'review.created')!.payload, 'owner', 'uz'), opts);
    expect(review.text).toContain('★★★★☆');
  });

  it('question.answered → product deep link', () => {
    const r = renderNotification(outbox(TOPICS.find((x) => x.name === 'question.answered')!.payload, 'buyer', 'uz'), opts);
    expect(r.buttons[0]![0]!.url).toBe(`${BASE}?startapp=dilnoza-atelier-p-AB12`);
    expect(r.text).toContain('Ha, M va L');
  });

  it('store.created: share link + open dashboard', () => {
    const r = renderNotification(outbox({ topic: 'store.created', storeSlug: 'dilnoza-atelier', storeName: 'Dilnoza' }, 'owner', 'uz'), opts);
    expect(r.text).toContain(`${BASE}?startapp=dilnoza-atelier`);
    expect(r.buttons[0]![0]!.url).toMatch(/^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ft\.me%2Fdokonim_bot%2Fshop%3Fstartapp%3Ddilnoza-atelier&text=/);
    expect(r.buttons[1]![0]).toEqual({ text: 'Boshqaruvni ochish', url: `${BASE}?startapp=m-dilnoza-atelier` });
  });

  it('staff.joined: localized role, escaped name', () => {
    const r = renderNotification(outbox(TOPICS.find((x) => x.name === 'staff.joined')!.payload, 'owner', 'ru'), opts);
    expect(r.text).toContain('Оператор заказов');
    expect(r.text).toContain('Kamola &lt;3');
  });

  it('long item lists are capped', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ title: `Item ${i}`, qty: 1 }));
    const r = renderNotification(outbox({ topic: 'order.placed', order: order({ items }) }, 'owner', 'en'), opts);
    expect(r.text).toContain('… and 4 more');
    expect(r.text).not.toContain('Item 10');
  });
});

describe('renderStart / help / paysupport', () => {
  const sopts = { miniAppBase: BASE, webAppUrl: WEBAPP };

  it('hub: open + create buttons', () => {
    const r = renderStart({ kind: 'hub' }, 'uz', sopts);
    expect(r.buttons).toEqual([
      [{ text: 'Doʻkonni ochish', url: BASE, webApp: WEBAPP }],
      [{ text: 'Doʻkon yaratish', url: `${BASE}?startapp=new`, webApp: `${WEBAPP}?startapp=new` }],
    ]);
  });

  it.each([
    ['dilnoza-atelier', 'dilnoza-atelier'],
    ['dilnoza-atelier-c-insta_bio', 'dilnoza-atelier-c-insta_bio'],
    ['dilnoza-atelier-p-AB12', 'dilnoza-atelier-p-AB12'],
    ['dilnoza-atelier-o-K7Q2M9', 'dilnoza-atelier-o-K7Q2M9'],
    ['m-dilnoza-atelier', 'm-dilnoza-atelier'],
    ['new', 'new'],
  ])('payload %s routes its first button to startapp=%s', (raw, expected) => {
    const r = renderStart(parseStartParam(raw), 'en', sopts);
    expect(r.buttons[0]![0]!.url).toBe(`${BASE}?startapp=${expected}`);
    expect(r.buttons[0]![0]!.webApp).toBe(`${WEBAPP}?startapp=${expected}`);
  });

  it('without webAppUrl there is no webApp field', () => {
    const r = renderStart({ kind: 'new' }, 'ru', { miniAppBase: BASE });
    expect(r.buttons[0]![0]).toEqual({ text: 'Создать магазин', url: `${BASE}?startapp=new` });
  });

  it('help mentions the bot username; paysupport exists in all locales', () => {
    expect(renderHelp('uz', 'dokonim_bot')).toContain('<code>@dokonim_bot');
    for (const l of LOCALES) expect(renderPaySupport(l).length).toBeGreaterThan(40);
  });

  it('receipt formats the amount', () => {
    expect(renderReceipt(125_000_000, 'UZS', 'uz')).toContain(`<b>${formatMoney(125_000_000, 'UZS', 'uz')}</b>`);
    expect(renderReceipt(250, 'XTR', 'en')).toContain('250');
  });
});

describe('helpers & catalog', () => {
  it('every catalog entry has uz/ru/en; uz uses canonical oʻ/gʻ (no ASCII apostrophes)', () => {
    for (const [key, e] of Object.entries(messages)) {
      for (const l of LOCALES) expect(e[l], `${key}.${l}`).toBeTruthy();
      expect(e.uz, key).not.toMatch(/['`‘’]/);
    }
  });

  it('callback data for every action fits 64 bytes', () => {
    for (const a of ['confirm', 'pack', 'ship', 'ready', 'deliver', 'cancel'] as const) {
      expect(utf8Length(`o:${a}:${ORDER_ID}`)).toBeLessThanOrEqual(64);
    }
  });

  it('nextStaffAction follows allowedEvents and fulfilment', () => {
    expect(nextStaffAction('awaiting_confirmation', 'delivery')).toBe('confirm');
    expect(nextStaffAction('confirmed', 'delivery')).toBe('pack');
    expect(nextStaffAction('packing', 'delivery')).toBe('ship');
    expect(nextStaffAction('packing', 'pickup')).toBe('ready');
    expect(nextStaffAction('shipped', 'delivery')).toBe('deliver');
    expect(nextStaffAction('pending_payment', 'delivery')).toBeNull();
    expect(nextStaffAction('cancelled', 'delivery')).toBeNull();
  });

  it('links, phones, windows', () => {
    expect(appLink(BASE, { kind: 'hub' })).toBe(BASE);
    expect(appLink(`${BASE}?x=1`, { kind: 'new' })).toBe(`${BASE}?x=1&startapp=new`);
    expect(normalizePhone('998 90 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('12')).toBeNull();
    expect(callLink('+998901234567')).toBe('https://t.me/+998901234567');
    expect(formatWindow('2026-11-15', '2026-11-15', 'en')).toBe('15 November');
    expect(formatWindow(null, null, 'uz')).toBeNull();
    expect(formatWindow('soon', null, 'uz')).toBe('soon');
  });
});
