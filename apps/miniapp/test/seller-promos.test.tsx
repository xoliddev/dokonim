/** Promo editor: bxgy value, and the stored stacking flags / priority / customer tags survive a save. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiProvider, makeApi, type ApiClient } from '../src/api';
import { setLocale } from '../src/i18n';
import { PromoForm, type Promo } from '../src/seller/screens/promos/PromoForm';

afterEach(cleanup);
beforeAll(() => {
  setLocale('en');
  (Element.prototype as unknown as { animate: () => unknown }).animate ??= () => ({ finished: Promise.resolve(), cancel() {} });
});

const promo = (over: Partial<Promo>): Promo => ({
  id: '00000000-0000-4000-8000-000000000001', kind: 'automatic', title: 'Promo', code: null, valueType: 'percent', value: 10, bxgy: null,
  appliesTo: { type: 'all' }, conditions: { minSubtotal: null, firstOrder: false, customerTags: ['vip'] }, startsAt: null, endsAt: null,
  usageLimit: null, perCustomerLimit: null, usedCount: 0, status: 'active', combines: { order: true, product: true, shipping: true }, priority: 5, ...over,
});

function saveOf(p: Promo) {
  const calls: [string, Record<string, unknown>][] = [];
  const client = {
    kind: 'local', ready: Promise.resolve(), status: () => ({ phase: 'ready', progress: 1, persistent: true }), subscribe: () => () => {}, onEvent: () => () => {},
    api: makeApi(async (name, input) => (calls.push([name, input as Record<string, unknown>]), { id: p.id })),
  } as unknown as ApiClient;
  render(
    <ApiProvider client={client}>
      <PromoForm open promo={p} storeId="00000000-0000-4000-8000-0000000000aa" onClose={() => {}} />
    </ApiProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return waitFor(() => {
    const c = calls.find(([n]) => n === 'admin.discounts.save');
    expect(c).toBeTruthy();
    return c![1];
  });
}

describe('PromoForm', () => {
  it('saves a buy-X-get-Y promo with the free units at 100 % off', async () => {
    const body = await saveOf(promo({ valueType: 'bxgy', value: 0, bxgy: { buy: 2, get: 1 } }));
    expect(body).toMatchObject({ valueType: 'bxgy', value: 100, bxgy: { buy: 2, get: 1 } });
  });

  it('keeps combines, priority and customer tags', async () => {
    const body = await saveOf(promo({}));
    expect(body).toMatchObject({ combines: { order: true, product: true, shipping: true }, priority: 5, conditions: { customerTags: ['vip'] } });
  });
});
