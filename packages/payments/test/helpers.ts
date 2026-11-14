import type { ProviderConfig, RawWebhookRequest } from '@dokonim/core';
import { MemoryLedger, sandboxConfig } from '../src';

/** 2026-11-14 05:00:00 UTC = 10:00:00 in Tashkent. */
export const NOW = Date.UTC(2026, 10, 14, 5, 0, 0);
export const ORDER_ID = 'ord-1';
export const PAYMENT_ID = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
/** 15 000 so'm in tiyin. */
export const AMOUNT = 1_500_000;

export function setup(over: Partial<Parameters<MemoryLedger['addOrder']>[0]> = {}) {
  const ledger = new MemoryLedger({ now: NOW });
  ledger.addOrder({ id: ORDER_ID, number: 1001, amount: AMOUNT, paymentId: PAYMENT_ID, ...over });
  return ledger;
}

export function liveConfig(provider: Parameters<typeof sandboxConfig>[0], over: Partial<ProviderConfig> = {}): ProviderConfig {
  return { ...sandboxConfig(provider), mode: 'live', ...over };
}

export function jsonReq(body: unknown, headers: Record<string, string | undefined> = {}, extra: Partial<RawWebhookRequest> = {}): RawWebhookRequest {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...extra };
}
