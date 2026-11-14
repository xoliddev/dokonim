/**
 * PaymentProviderAdapter implementations (§11.3): build the "next action" for checkout.
 * In `sandbox` mode every redirect/invoice adapter returns a `sandbox://` action that the Mini App turns into the
 * Sandbox checkout sheet, which then drives the real webhook handlers through the simulators in ./sandbox.
 */
import { DomainError, utf8b64 } from '@dokonim/core';
import type {
  ConfigCheck,
  CreateIntentInput,
  Locale,
  NextAction,
  PaymentProviderAdapter,
  ProviderCapabilities,
  ProviderConfig,
  ProviderId,
} from '@dokonim/core';
import { CAPABILITIES } from './capabilities';
import type { SupportedProviderId } from './capabilities';
import { tiyinToSom } from './util';

export const PAYME_CHECKOUT_URL = 'https://checkout.paycom.uz';
export const PAYME_TEST_CHECKOUT_URL = 'https://checkout.test.paycom.uz';
export const CLICK_PAY_URL = 'https://my.click.uz/services/pay';
/** VERIFY: Uzum Bank "open-service" deep link (inherited from Apelsin) for Merchant-API services. */
export const UZUM_OPEN_SERVICE_URL = 'https://www.uzumbank.uz/open-service';
/** VERIFY: Uzum Checkout (acquiring) API base URLs; the account manager issues the real ones. */
export const UZUM_CHECKOUT_API = 'https://checkout-key.inplat-tech.com';
export const UZUM_CHECKOUT_TEST_API = 'https://test-chk-api.ipt-merch.com';

export function sandboxAction(provider: ProviderId, paymentId: string): NextAction {
  return { type: 'sandbox', provider, paymentId, url: `sandbox://${provider}?payment=${encodeURIComponent(paymentId)}` };
}

function required(cfg: ProviderConfig, keys: string[]): string[] {
  return keys.filter((k) => !cfg.credentials[k]?.trim()).map((k) => `${k} is required`);
}

function check(problems: string[]): ConfigCheck {
  return { ok: problems.length === 0, problems };
}

abstract class BaseAdapter implements PaymentProviderAdapter {
  abstract readonly id: SupportedProviderId;
  get capabilities(): ProviderCapabilities {
    return CAPABILITIES[this.id];
  }

  /** Live-mode credential checks. Sandbox mode needs no keys (demo keys are built in). */
  protected abstract liveProblems(cfg: ProviderConfig): string[];

  async validateConfig(cfg: ProviderConfig): Promise<ConfigCheck> {
    const problems: string[] = [];
    if (cfg.provider !== this.id) problems.push(`config is for ${cfg.provider}, not ${this.id}`);
    if (cfg.mode === 'live') problems.push(...this.liveProblems(cfg));
    return check(problems);
  }

  /** Shared guards: currency, goods kind (digital → Stars only), and a valid live config. */
  protected guard(input: CreateIntentInput, cfg: ProviderConfig): void {
    const cap = this.capabilities;
    if (!cap.currencies.includes(input.payment.currency)) {
      throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', `${this.id} does not accept ${input.payment.currency}`);
    }
    const goods = input.order.isDigital ? 'digital' : 'physical';
    if (!cap.goods.includes(goods)) {
      throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', `${this.id} cannot be used for ${goods} goods`);
    }
    if (input.payment.amount <= 0 || !Number.isSafeInteger(input.payment.amount)) {
      throw new DomainError('VALIDATION', 'payment amount must be a positive integer');
    }
    if (cfg.mode === 'live') {
      const problems = this.liveProblems(cfg);
      if (problems.length) throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', problems.join('; '), { problems });
    }
  }

  abstract createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction>;
}

// ── Payme ──────────────────────────────────────────────────────────────────

export interface PaymeCheckoutParams {
  merchantId: string;
  orderId: string;
  amount: number;
  returnUrl?: string;
  locale?: Locale;
  test?: boolean;
}

/** `https://checkout.paycom.uz/<base64("m=…;ac.order_id=…;a=<tiyin>;c=<url>;l=<lang>")>` */
export function buildPaymeCheckoutUrl(p: PaymeCheckoutParams): string {
  const parts = [`m=${p.merchantId}`, `ac.order_id=${p.orderId}`, `a=${p.amount}`];
  // ';' separates parameters in Payme's encoded string, so it must not appear raw inside a value.
  if (p.returnUrl) parts.push(`c=${p.returnUrl.replaceAll(';', '%3B')}`);
  if (p.locale) parts.push(`l=${p.locale}`);
  return `${p.test ? PAYME_TEST_CHECKOUT_URL : PAYME_CHECKOUT_URL}/${utf8b64(parts.join(';'))}`;
}

export class PaymeAdapter extends BaseAdapter {
  readonly id = 'payme' as const;
  protected liveProblems(cfg: ProviderConfig): string[] {
    const p = required(cfg, ['merchant_id', 'key']);
    const mid = cfg.credentials.merchant_id?.trim();
    // VERIFY: Payme merchant ids are 24-hex Mongo ObjectIds in every cabinet we have seen.
    if (mid && !/^[0-9a-f]{24}$/i.test(mid)) p.push('merchant_id must be the 24-character id from the Payme cabinet');
    return p;
  }
  async createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction> {
    this.guard(input, cfg);
    if (cfg.mode === 'sandbox') return sandboxAction('payme', input.payment.id);
    const url = buildPaymeCheckoutUrl({
      merchantId: cfg.credentials.merchant_id!.trim(),
      orderId: input.order.id,
      amount: input.payment.amount,
      returnUrl: input.returnUrl,
      locale: input.locale,
      test: cfg.publicConfig.env === 'test',
    });
    return { type: 'redirect', url, openWith: 'openLink' };
  }
}

// ── Click ──────────────────────────────────────────────────────────────────

export interface ClickLinkParams {
  serviceId: string;
  merchantId: string;
  amount: number;
  orderId: string;
  returnUrl?: string;
  merchantUserId?: string;
}

/** `https://my.click.uz/services/pay?service_id&merchant_id&amount=<so'm.00>&transaction_param=<orderId>&return_url` */
export function buildClickPayUrl(p: ClickLinkParams): string {
  const q = new URLSearchParams({
    service_id: p.serviceId,
    merchant_id: p.merchantId,
    amount: tiyinToSom(p.amount),
    transaction_param: p.orderId,
  });
  if (p.returnUrl) q.set('return_url', p.returnUrl);
  if (p.merchantUserId) q.set('merchant_user_id', p.merchantUserId);
  return `${CLICK_PAY_URL}?${q.toString()}`;
}

export class ClickAdapter extends BaseAdapter {
  readonly id = 'click' as const;
  protected liveProblems(cfg: ProviderConfig): string[] {
    const p = required(cfg, ['service_id', 'merchant_id', 'secret_key']);
    for (const k of ['service_id', 'merchant_id', 'merchant_user_id']) {
      const v = cfg.credentials[k]?.trim();
      if (v && !/^\d+$/.test(v)) p.push(`${k} must be a number`);
    }
    return p;
  }
  async createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction> {
    this.guard(input, cfg);
    if (cfg.mode === 'sandbox') return sandboxAction('click', input.payment.id);
    const merchantUserId = cfg.credentials.merchant_user_id?.trim();
    const url = buildClickPayUrl({
      serviceId: cfg.credentials.service_id!.trim(),
      merchantId: cfg.credentials.merchant_id!.trim(),
      amount: input.payment.amount,
      orderId: input.order.id,
      returnUrl: input.returnUrl,
      ...(merchantUserId ? { merchantUserId } : {}),
    });
    return { type: 'redirect', url, openWith: 'openLink' };
  }
}

// ── Uzum Bank ──────────────────────────────────────────────────────────────

/** Minimal fetch shape so tests (and the demo worker) can inject a fake. */
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface UzumRegisterRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    amount: number;
    clientId: string;
    currency: number;
    paymentDetails: string;
    orderNumber: string;
    viewType: 'REDIRECT';
    sessionTimeoutSecs: number;
    successUrl: string;
    failureUrl: string;
  };
}

/**
 * VERIFY: Uzum Checkout `POST /api/v1/payment/register` (headers X-Terminal-Id, X-API-Key; ISO-4217 numeric currency
 * 860 = UZS; response `{ errorCode: 0, result: { orderId, paymentRedirectUrl } }`). Field names follow the public
 * apis.io listing; confirm with the Uzum account manager before going live.
 */
export function buildUzumRegisterRequest(input: CreateIntentInput, cfg: ProviderConfig): UzumRegisterRequest {
  const base = cfg.publicConfig.api_base?.trim() || (cfg.publicConfig.env === 'test' ? UZUM_CHECKOUT_TEST_API : UZUM_CHECKOUT_API);
  return {
    url: `${base.replace(/\/+$/, '')}/api/v1/payment/register`,
    headers: {
      'content-type': 'application/json',
      'x-terminal-id': cfg.credentials.terminal_id!.trim(),
      'x-api-key': cfg.credentials.api_key!.trim(),
      'content-language': input.locale === 'ru' ? 'ru-RU' : input.locale === 'en' ? 'en-US' : 'uz-UZ',
    },
    body: {
      amount: input.payment.amount,
      clientId: input.order.id,
      currency: 860,
      paymentDetails: `${input.store.name} #${input.order.number}`.slice(0, 120),
      // Our payment id doubles as Uzum's idempotency key for the register call.
      orderNumber: input.payment.id,
      viewType: 'REDIRECT',
      sessionTimeoutSecs: 1800,
      successUrl: input.returnUrl,
      failureUrl: input.returnUrl,
    },
  };
}

/** VERIFY: Merchant-API deep link `open-service?serviceId=…&order_id=…&amount=<tiyin>`. */
export function buildUzumOpenServiceUrl(p: { serviceId: string; orderId: string; amount: number; accountField?: string }): string {
  const q = new URLSearchParams({ serviceId: p.serviceId, [p.accountField ?? 'order_id']: p.orderId, amount: String(p.amount) });
  return `${UZUM_OPEN_SERVICE_URL}?${q.toString()}`;
}

export class UzumAdapter extends BaseAdapter {
  readonly id = 'uzum' as const;
  constructor(private readonly httpFetch?: HttpFetch) {
    super();
  }
  /**
   * terminal_id is always required. Then either the Checkout API key (`api_key`) or a Merchant-API service
   * (`service_id`, whose webhooks we authenticate with `webhook_login` + `webhook_password`).
   */
  protected liveProblems(cfg: ProviderConfig): string[] {
    const p = required(cfg, ['terminal_id']);
    const c = cfg.credentials;
    if (!c.api_key?.trim() && !c.service_id?.trim()) p.push('api_key or service_id is required');
    if (c.service_id?.trim()) p.push(...required(cfg, ['webhook_login', 'webhook_password']));
    return p;
  }
  async createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction> {
    this.guard(input, cfg);
    if (cfg.mode === 'sandbox') return sandboxAction('uzum', input.payment.id);
    const serviceId = cfg.credentials.service_id?.trim();
    if (serviceId) {
      const accountField = cfg.publicConfig.account_field?.trim() || 'order_id';
      const url = buildUzumOpenServiceUrl({ serviceId, orderId: input.order.id, amount: input.payment.amount, accountField });
      return { type: 'redirect', url, openWith: 'openLink' };
    }
    const doFetch = this.httpFetch ?? (globalThis.fetch as unknown as HttpFetch | undefined);
    if (!doFetch) throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', 'no fetch available for Uzum Checkout');
    const req = buildUzumRegisterRequest(input, cfg);
    const res = await doFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
    const json = (await res.json().catch(() => null)) as { errorCode?: number; result?: { paymentRedirectUrl?: string } } | null;
    const url = json?.result?.paymentRedirectUrl;
    if (!res.ok || !url || (json?.errorCode ?? 0) !== 0) {
      throw new DomainError('PAYMENT_FAILED', `Uzum Checkout register failed (HTTP ${res.status}, errorCode ${json?.errorCode ?? '?'})`);
    }
    return { type: 'redirect', url, openWith: 'openLink' };
  }
}

// ── Telegram invoices (Payments + Stars) ───────────────────────────────────

/** Parameters of Bot API `createInvoiceLink` that we use. */
export interface InvoiceLinkParams {
  title: string;
  description: string;
  /** Our payment id; comes back as `invoice_payload` in pre_checkout_query / successful_payment. */
  payload: string;
  /** Empty string for Telegram Stars. */
  provider_token: string;
  currency: string;
  prices: Array<{ label: string; amount: number }>;
  photo_url?: string;
}

export type CreateInvoiceLink = (params: InvoiceLinkParams) => Promise<string>;

const INVOICE_TITLE: Record<Locale, (n: number) => string> = {
  uz: (n) => `Buyurtma #${n}`,
  ru: (n) => `Заказ №${n}`,
  en: (n) => `Order #${n}`,
};

/** Bot API limits: title 1–32 chars, description 1–255 chars, payload 1–128 bytes. */
export function buildInvoiceParams(input: CreateIntentInput, currency: string, providerToken: string): InvoiceLinkParams {
  const title = INVOICE_TITLE[input.locale](input.order.number).slice(0, 32);
  const items = input.order.items.map((i) => (i.qty > 1 ? `${i.title} ×${i.qty}` : i.title)).join(', ');
  const description = (`${input.store.name}: ${items}`.trim() || title).slice(0, 255);
  return {
    title,
    description,
    payload: input.payment.id,
    provider_token: providerToken,
    currency,
    prices: [{ label: title, amount: input.payment.amount }],
  };
}

abstract class InvoiceAdapter extends BaseAdapter {
  constructor(protected readonly createInvoiceLink?: CreateInvoiceLink) {
    super();
  }
  protected abstract token(cfg: ProviderConfig): string;
  async createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction> {
    this.guard(input, cfg);
    if (cfg.mode === 'sandbox') return sandboxAction(this.id, input.payment.id);
    if (!this.createInvoiceLink) throw new DomainError('PAYMENT_METHOD_UNAVAILABLE', 'createInvoiceLink is not wired');
    const invoiceLink = await this.createInvoiceLink(buildInvoiceParams(input, input.payment.currency, this.token(cfg)));
    return { type: 'invoice', invoiceLink };
  }
}

export class TelegramPaymentsAdapter extends InvoiceAdapter {
  readonly id = 'telegram' as const;
  protected liveProblems(cfg: ProviderConfig): string[] {
    const p = required(cfg, ['provider_token']);
    const t = cfg.credentials.provider_token?.trim();
    // BotFather tokens look like "<digits>:<TEST|LIVE>:<secret>".
    if (t && !/^\d+:[A-Za-z]+:\S+$/.test(t)) p.push('provider_token does not look like a BotFather payment token');
    return p;
  }
  protected token(cfg: ProviderConfig): string {
    return cfg.credentials.provider_token!.trim();
  }
}

export class StarsAdapter extends InvoiceAdapter {
  readonly id = 'stars' as const;
  protected liveProblems(): string[] {
    return [];
  }
  protected token(): string {
    return '';
  }
}

// ── Offline ────────────────────────────────────────────────────────────────

const COD_MESSAGE: Record<Locale, string> = {
  uz: "To'lov buyurtmani qabul qilganda naqd yoki karta orqali amalga oshiriladi.",
  ru: 'Оплата наличными или картой при получении заказа.',
  en: 'Pay in cash or by card when you receive your order.',
};

const BANK_MESSAGE: Record<Locale, string> = {
  uz: "Buyurtmani bank o'tkazmasi orqali to'lang. Do'kon to'lovni tasdiqlagach buyurtma rasmiylashtiriladi.",
  ru: 'Оплатите заказ банковским переводом. Заказ будет оформлен после подтверждения оплаты магазином.',
  en: 'Pay by bank transfer. The shop confirms your order once the payment arrives.',
};

abstract class OfflineAdapter extends BaseAdapter {
  protected abstract defaults: Record<Locale, string>;
  protected liveProblems(): string[] {
    return [];
  }
  async createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction> {
    this.guard(input, cfg);
    // Owner-written instructions (publicConfig.instructions_<locale> or .instructions) win over our defaults.
    const custom = cfg.publicConfig[`instructions_${input.locale}`] ?? cfg.publicConfig.instructions;
    const message = custom?.trim() ? `${this.defaults[input.locale]}\n\n${custom.trim()}` : this.defaults[input.locale];
    return { type: 'none', message };
  }
}

export class CodAdapter extends OfflineAdapter {
  readonly id = 'cod' as const;
  protected defaults = COD_MESSAGE;
}

export class BankTransferAdapter extends OfflineAdapter {
  readonly id = 'bank_transfer' as const;
  protected defaults = BANK_MESSAGE;
}
