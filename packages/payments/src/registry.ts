/**
 * One place that wires adapters + webhook handlers by ProviderId.
 */
import type { PaymentProviderAdapter, ProviderConfig, ProviderId, WebhookHandler } from '@dokonim/core';
import {
  BankTransferAdapter,
  ClickAdapter,
  CodAdapter,
  PaymeAdapter,
  StarsAdapter,
  TelegramPaymentsAdapter,
  UzumAdapter,
} from './adapters';
import type { CreateInvoiceLink, HttpFetch } from './adapters';
import { availableMethods } from './capabilities';
import type { MethodFilter, SupportedProviderId } from './capabilities';
import { ClickWebhookHandler } from './click';
import type { ClickHandlerOptions } from './click';
import { PaymeWebhookHandler } from './payme';
import { TelegramPaymentsHandler } from './telegram';
import { UzumMerchantHandler } from './uzum';

export interface PaymentRegistryDeps {
  /** Bot API createInvoiceLink (needed for live 'telegram' / 'stars'). */
  createInvoiceLink?: CreateInvoiceLink;
  /** fetch used by Uzum Checkout (defaults to globalThis.fetch). */
  httpFetch?: HttpFetch;
  click?: ClickHandlerOptions;
  /** pre_checkout_query answer deadline (default 9 s). */
  telegramDeadlineMs?: number;
}

export type WebhookProviderId = 'payme' | 'click' | 'uzum' | 'telegram' | 'stars';

export interface PaymentRegistry {
  adapters: Record<SupportedProviderId, PaymentProviderAdapter>;
  handlers: Record<WebhookProviderId, WebhookHandler>;
  adapter(id: ProviderId): PaymentProviderAdapter | undefined;
  handler(id: ProviderId): WebhookHandler | undefined;
  availableMethods(configs: ProviderConfig[], ctx: MethodFilter): ProviderId[];
}

export function createPaymentRegistry(deps: PaymentRegistryDeps = {}): PaymentRegistry {
  const adapters: Record<SupportedProviderId, PaymentProviderAdapter> = {
    payme: new PaymeAdapter(),
    click: new ClickAdapter(),
    uzum: new UzumAdapter(deps.httpFetch),
    telegram: new TelegramPaymentsAdapter(deps.createInvoiceLink),
    stars: new StarsAdapter(deps.createInvoiceLink),
    cod: new CodAdapter(),
    bank_transfer: new BankTransferAdapter(),
  };
  const tg = deps.telegramDeadlineMs !== undefined ? { deadlineMs: deps.telegramDeadlineMs } : {};
  const handlers: Record<WebhookProviderId, WebhookHandler> = {
    payme: new PaymeWebhookHandler(),
    click: new ClickWebhookHandler(deps.click),
    uzum: new UzumMerchantHandler(),
    telegram: new TelegramPaymentsHandler('telegram', tg),
    stars: new TelegramPaymentsHandler('stars', tg),
  };
  return {
    adapters,
    handlers,
    adapter: (id) => (id in adapters ? adapters[id as SupportedProviderId] : undefined),
    handler: (id) => (id in handlers ? handlers[id as WebhookProviderId] : undefined),
    availableMethods,
  };
}
