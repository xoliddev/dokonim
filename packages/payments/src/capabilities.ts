/**
 * Static provider capabilities (§11.1 table) and the checkout method filter.
 */
import type { Currency, ProviderCapabilities, ProviderConfig, ProviderId } from '@dokonim/core';

/** Providers this package ships adapters for (paynet/stripe are "Later" in the spec). */
export const SUPPORTED_PROVIDERS = ['payme', 'click', 'uzum', 'telegram', 'stars', 'cod', 'bank_transfer'] as const;
export type SupportedProviderId = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(id: ProviderId): id is SupportedProviderId {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(id);
}

export const CAPABILITIES: Record<SupportedProviderId, ProviderCapabilities> = {
  // Payme: CancelTransaction after perform = full refund; receipts via `detail` / SetFiscalData.
  payme: { currencies: ['UZS'], goods: ['physical'], refunds: 'full', flow: 'redirect', fiscalReceipts: true },
  // Click SHOP-API has no refund call; reversals go through the Click merchant cabinet.
  click: { currencies: ['UZS'], goods: ['physical'], refunds: 'manual', flow: 'redirect', fiscalReceipts: false },
  // Uzum Merchant API `reverse` = full reversal.
  uzum: { currencies: ['UZS'], goods: ['physical'], refunds: 'full', flow: 'redirect', fiscalReceipts: false },
  // Telegram Payments (physical goods, 3rd-party provider token). Refunds happen at the provider.
  telegram: { currencies: ['UZS', 'USD'], goods: ['physical'], refunds: 'manual', flow: 'invoice', fiscalReceipts: false },
  // Telegram Stars: digital goods only, currency XTR, refundStarPayment = full refund.
  stars: { currencies: ['XTR'], goods: ['digital'], refunds: 'full', flow: 'invoice', fiscalReceipts: false },
  cod: { currencies: ['UZS', 'USD'], goods: ['physical'], refunds: 'manual', flow: 'offline', fiscalReceipts: false },
  bank_transfer: { currencies: ['UZS', 'USD'], goods: ['physical'], refunds: 'manual', flow: 'offline', fiscalReceipts: false },
};

export interface MethodFilter {
  isDigital: boolean;
  currency: Currency;
}

/**
 * Methods the buyer may be offered at checkout, in the order of `configs`.
 * - only enabled configs of providers we support;
 * - **digital goods → Stars only** (Telegram's rules, §11.3) and Stars never for physical goods;
 * - the cart currency must be one the provider accepts (digital carts are priced in XTR, so pass currency 'XTR').
 */
export function availableMethods(configs: ProviderConfig[], ctx: MethodFilter): ProviderId[] {
  const out: ProviderId[] = [];
  for (const c of configs) {
    if (!c.enabled || !isSupportedProvider(c.provider) || out.includes(c.provider)) continue;
    const cap = CAPABILITIES[c.provider];
    if (ctx.isDigital ? c.provider !== 'stars' : !cap.goods.includes('physical')) continue;
    if (!cap.currencies.includes(ctx.currency)) continue;
    out.push(c.provider);
  }
  return out;
}
