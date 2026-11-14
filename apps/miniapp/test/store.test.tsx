/** Buyer storefront: variant picker logic, cart & promo UI state, filters ⇄ URL, and the stepper / promo field UI. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiProvider, makeApi, type ApiClient } from '../src/api';
import { setLocale } from '../src/i18n';
import { addableQty, initialSelection, pickerState, selectValue, type PickerOption, type PickerVariant } from '../src/store/lib/variants';
import { blockingLines, canCheckout, clampQty, formatPhone, freeShipping, isPhoneValid, lineWarning, normalisePromo, orderError, promoMessage, type LineLike } from '../src/store/lib/cartState';
import { activeCount, filtersToQuery, parseFilters, toListing, toggleOpt } from '../src/store/lib/filters';
import { PromoField, Stepper } from '../src/store/screens/Cart';
import { uiSpaces } from '../src/i18n';
import { createI18n } from '@dokonim/i18n';

afterEach(cleanup);
beforeAll(() => {
  setLocale('en');
  // jsdom has no WAAPI; motion helpers (shake/squash) call element.animate
  (Element.prototype as unknown as { animate: () => unknown }).animate ??= () => ({ finished: Promise.resolve(), cancel() {} });
});

// ── variant picker ──────────────────────────────────────────────────────────
const size: PickerOption = { id: 'size', values: [{ id: 'S' }, { id: 'M' }, { id: 'L' }] };
const colour: PickerOption = { id: 'colour', values: [{ id: 'red' }, { id: 'blue' }] };
const v = (s: string, c: string, available: number, price = 100_000_00, extra: Partial<PickerVariant> = {}): PickerVariant => ({
  id: `${s}-${c}`, optionValueIds: [s, c], available, trackInventory: true, allowBackorder: false, price, compareAt: null, discountPercent: 0, mediaUrl: `img-${c}`, sku: `SKU-${s}-${c}`, ...extra,
});
// S-red sold out, M-red ok, L-blue ok (cheaper), no S-blue / M-blue / L-red
const variants = [v('S', 'red', 0), v('M', 'red', 3, 120_000_00, { compareAt: 150_000_00, discountPercent: 20 }), v('L', 'blue', 40, 90_000_00)];

describe('variant picker', () => {
  it('starts on the first purchasable variant, or a preferred one', () => {
    expect(initialSelection([size, colour], variants)).toEqual(['M', 'red']);
    expect(initialSelection([size, colour], variants, 'L-blue')).toEqual(['L', 'blue']);
    expect(initialSelection([], [v('S', 'red', 1)])).toEqual([]);
  });

  it('keeps other choices when the combination exists, re-resolves when it does not', () => {
    expect(selectValue([size, colour], variants, ['M', 'red'], 0, 'S')).toEqual(['S', 'red']);
    // blue only exists in L: picking blue from M-red jumps to L-blue instead of a dead end
    expect(selectValue([size, colour], variants, ['M', 'red'], 1, 'blue')).toEqual(['L', 'blue']);
    // partial selections stay partial while still reachable
    expect(selectValue([size, colour], variants, [null, null], 1, 'red')).toEqual([null, 'red']);
  });

  it('drives price, compare-at, stock and image from the chosen variant', () => {
    const m = pickerState([size, colour], variants, ['M', 'red']);
    expect(m.variant?.id).toBe('M-red');
    expect(m.price).toBe(120_000_00);
    expect(m.compareAt).toBe(150_000_00);
    expect(m.discountPercent).toBe(20);
    expect(m.lowStock).toBe(true);
    expect(m.available).toBe(3);
    expect(m.mediaUrl).toBe('img-red');
    const s = pickerState([size, colour], variants, ['S', 'red']);
    expect(s.purchasable).toBe(false);
    expect(s.states[0]!.S).toBe('sold_out');
    expect(s.states[0]!.L).toBe('unavailable'); // no L-red
  });

  it('shows a price range and the missing options until the choice is complete', () => {
    const p = pickerState([size, colour], variants, [null, null]);
    expect(p.variant).toBeUndefined();
    expect(p.missing).toEqual([0, 1]);
    expect(p.price).toBe(90_000_00);
    expect(p.maxPrice).toBe(120_000_00);
    expect(pickerState([size, colour], variants, [null, 'red']).missing).toEqual([0]);
  });

  it('caps how many more can be added by stock already in the cart', () => {
    expect(addableQty(variants[1], 0)).toBe(3);
    expect(addableQty(variants[1], 3)).toBe(0);
    expect(addableQty({ ...variants[0]!, allowBackorder: true }, 5)).toBe(94);
    expect(addableQty(undefined, 0)).toBe(0);
  });
});

// ── cart & promo state ──────────────────────────────────────────────────────
const { t, money } = createI18n('en');
const line = (warnings: LineLike['warnings'], extra: Partial<LineLike> = {}): LineLike => ({ variantId: 'x', qty: 2, available: 5, maxQty: 5, warnings, ...extra });

describe('cart & promo state', () => {
  it('explains exactly why a promo code was rejected', () => {
    const min = promoMessage(t, money, 'TOY50', { promo: { code: 'TOY50', status: 'rejected', reason: 'PROMO_MIN_SUBTOTAL' }, explanation: { code: 'PROMO_MIN_SUBTOTAL', params: { min: 300_000_00, missing: 120_000_00 } } });
    expect(min.ok).toBe(false);
    expect(min.message).toContain(money(300_000_00));
    expect(min.message).toContain(money(120_000_00));
    const nf = promoMessage(t, money, 'NOPE', { promo: { code: 'NOPE', status: 'rejected', reason: 'PROMO_NOT_FOUND' }, explanation: null });
    expect(nf.message).toContain('NOPE');
    const ok = promoMessage(t, money, 'SALOM10', { promo: { code: 'SALOM10', status: 'applied' }, explanation: null });
    expect(ok).toEqual({ ok: true, message: t('checkout.promoApplied', { code: 'SALOM10' }) });
    expect(promoMessage(t, money, 'X', { promo: null, explanation: { code: 'WEIRD' } }).message).toBe(t('checkout.promoInvalid'));
  });

  it('normalises typed codes', () => {
    expect(normalisePromo('  salom 10 ')).toBe('SALOM10');
  });

  it('blocks checkout on stock problems and unaccepted price changes, not on healthy lines', () => {
    expect(canCheckout([line([])])).toBe(true);
    expect(canCheckout([line(['out_of_stock'])])).toBe(false);
    expect(canCheckout([line(['price_changed'])])).toBe(false);
    expect(canCheckout([line(['unavailable'])])).toBe(false);
    expect(blockingLines([line([]), line(['qty_reduced'], { available: 1 })])).toHaveLength(1);
    expect(lineWarning(t, line(['qty_reduced'], { available: 1 }))).toBe(t('store.warn_qty_reduced', { n: 1 }));
    expect(lineWarning(t, line(['price_changed']))).toBeNull();
  });

  it('computes the free-delivery nudge', () => {
    expect(freeShipping({ subtotal: 700_000_00, shippingTotal: 0, freeShippingRemaining: 300_000_00, explanations: [{ code: 'FREE_SHIPPING_THRESHOLD', params: { freeOver: 1_000_000_00 } }] })).toEqual({ remaining: 300_000_00, ratio: 0.7 });
    expect(freeShipping({ subtotal: 1, shippingTotal: 0, freeShippingRemaining: null, explanations: [{ code: 'FREE_SHIPPING_APPLIED' }] })).toEqual({ remaining: 0, ratio: 1 });
    expect(freeShipping({ subtotal: 1, shippingTotal: 0, freeShippingRemaining: null, explanations: [] })).toBeNull();
  });

  it('clamps steppers and formats phones and order errors', () => {
    expect(clampQty({ maxQty: 3 }, 7)).toBe(3);
    expect(clampQty({ maxQty: 3 }, -1)).toBe(0);
    expect(formatPhone('901234567')).toBe('+998 90 123 45 67');
    expect(isPhoneValid('+998 90 123 45 67')).toBe(true);
    expect(isPhoneValid('+998 90 123')).toBe(false);
    expect(orderError(t, 'OUT_OF_STOCK', '')).toBe(t('checkout.err_OUT_OF_STOCK'));
    expect(orderError(t, 'VALIDATION', 'Enter your name')).toBe('Enter your name');
  });
});

describe('listing filters ⇄ URL', () => {
  it('round-trips and maps prices to tiyin', () => {
    let f = parseFilters(new URLSearchParams('q=atlas&sort=price_asc&min=100000&stock=1'));
    f = toggleOpt(toggleOpt(f, 'Rang', 'Qizil'), 'Oʻlcham', 'M');
    const q = filtersToQuery(f, new URLSearchParams('q=atlas'));
    expect(q.get('q')).toBe('atlas');
    expect(parseFilters(q)).toEqual(f);
    expect(activeCount(f)).toBe(4);
    expect(toListing(f)).toMatchObject({ sort: 'price_asc', priceMin: 100_000_00, inStock: true, options: { Rang: ['Qizil'], Oʻlcham: ['M'] } });
    expect(parseFilters(new URLSearchParams('o=not-json&sort=evil')).sort).toBeUndefined();
  });
});

// ── UI ──────────────────────────────────────────────────────────────────────
describe('cart UI', () => {
  it('stepper increments, turns minus into remove at 1, and refuses past stock', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={1} max={2} onChange={onChange} label="Qty" />);
    expect(screen.getByRole('button', { name: t('store.remove') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    rerender(<Stepper value={2} max={2} onChange={onChange} label="Qty" />);
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('promo field shows the server reason, then the applied state', async () => {
    const calls: Array<[string, unknown]> = [];
    let reply: unknown = { cart: {}, promo: { code: 'TOY50', status: 'rejected', reason: 'PROMO_MIN_SUBTOTAL' }, explanation: { code: 'PROMO_MIN_SUBTOTAL', params: { min: 500_000_00, missing: 200_000_00 } } };
    const client = { kind: 'local', api: makeApi(async (name, input) => (calls.push([name, input]), reply)), ready: Promise.resolve(), status: () => ({ phase: 'ready', progress: 1, persistent: true }), subscribe: () => () => {}, onEvent: () => () => {} } as unknown as ApiClient;
    const cart = { promoCode: null, pricing: { promo: null } } as never;
    const { rerender } = render(
      <ApiProvider client={client}>
        <PromoField slug="atlas-adras" cart={cart} />
      </ApiProvider>,
    );
    fireEvent.change(screen.getByLabelText(t('checkout.promoCode')), { target: { value: 'toy 50' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: t('common.apply') })));
    expect(calls[0]).toEqual(['cart.applyPromo', { slug: 'atlas-adras', code: 'TOY50' }]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(uiSpaces(money(200_000_00))));
    reply = {};
    rerender(
      <ApiProvider client={client}>
        <PromoField slug="atlas-adras" cart={{ promoCode: 'SALOM10', pricing: { promo: { code: 'SALOM10', status: 'applied' } } } as never} />
      </ApiProvider>,
    );
    expect(screen.getByText('SALOM10')).toBeTruthy();
    expect(screen.getByRole('button', { name: t('store.remove') })).toBeTruthy();
  });
});

describe('order tracking', () => {
  it('re-fetches and re-renders the timeline when the backend pushes an outbox event', async () => {
    const { default: OrderDetail } = await import('../src/store/screens/OrderDetail');
    let status = 'awaiting_confirmation';
    const listeners = new Set<(e: { type: string }) => void>();
    const order = () => ({
      id: '0190a0a0-0000-7000-8000-000000000001', number: 7, shortId: 'abc', status, paymentStatus: 'unpaid', paymentMethod: 'cod', fulfilmentKind: 'delivery', total: 100_000_00, subtotal: 100_000_00,
      discountTotal: 0, shippingTotal: 0, contact: { name: 'Dilnoza', phone: '+998901234567' }, shippingAddress: null, shippingMethodName: null, deliveryPromise: null, placedAt: '2026-11-14T10:00:00Z',
      items: [], payments: [], allowed: [], pickupCode: null,
      events: [{ type: 'status_changed', fromStatus: null, toStatus: 'awaiting_confirmation', actor: 'buyer', data: {}, createdAt: '2026-11-14T10:00:00Z' }, ...(status === 'confirmed' ? [{ type: 'status_changed', fromStatus: 'awaiting_confirmation', toStatus: 'confirmed', actor: 'staff', data: {}, createdAt: '2026-11-14T10:05:00Z' }] : [])],
    });
    const client = {
      kind: 'local', ready: Promise.resolve(), status: () => ({ phase: 'ready', progress: 1, persistent: true }), subscribe: () => () => {},
      api: makeApi(async (name) => (name === 'orders.get' ? order() : name === 'cart.get' ? { count: 0, items: [] } : null)),
      onEvent: (fn: (e: { type: string }) => void) => (listeners.add(fn), () => listeners.delete(fn)),
    } as unknown as ApiClient;
    render(
      <ApiProvider client={client}>
        <OrderDetail params={{ slug: 'atlas-adras', orderId: 'live-1' }} query={new URLSearchParams()} />
      </ApiProvider>,
    );
    await waitFor(() => expect(document.querySelector('.st-tl-step.is-now')?.textContent).toContain(t('checkout.status_awaiting_confirmation')));
    status = 'confirmed';
    await act(async () => listeners.forEach((fn) => fn({ type: 'outbox' })));
    await waitFor(() => expect(document.querySelector('.st-tl-step.is-now')?.textContent).toContain(t('checkout.status_confirmed')));
  });
});
