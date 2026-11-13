/** Stable error codes shared by the API, the demo worker and the UI (which localises them). */
export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'SLUG_INVALID',
  'SLUG_TAKEN',
  'CATEGORY_CYCLE',
  'CATEGORY_NOT_EMPTY',
  'CATEGORY_DEPTH',
  'VARIANT_LIMIT',
  'OPTION_LIMIT',
  'OUT_OF_STOCK',
  'CART_EMPTY',
  'PRICE_CHANGED',
  'INVALID_TRANSITION',
  'PROMO_INVALID',
  'PAYMENT_METHOD_UNAVAILABLE',
  'PAYMENT_FAILED',
  'SHIPPING_UNAVAILABLE',
  'REVIEW_NOT_ALLOWED',
  'INVITE_INVALID',
  'STORE_SUSPENDED',
  'IMPORT_INVALID',
  'IDEMPOTENCY_CONFLICT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return (
    e instanceof DomainError ||
    (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'DomainError' && 'code' in e)
  );
}

export function assert(cond: unknown, code: ErrorCode, message?: string, details?: Record<string, unknown>): asserts cond {
  if (!cond) throw new DomainError(code, message, details);
}

/** HTTP status for an error code (used by the API; the demo maps the same codes). */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'UNAUTHENTICATED':
      return 401;
    case 'FORBIDDEN':
    case 'STORE_SUSPENDED':
      return 403;
    case 'RATE_LIMITED':
      return 429;
    case 'CONFLICT':
    case 'SLUG_TAKEN':
    case 'IDEMPOTENCY_CONFLICT':
    case 'INVALID_TRANSITION':
      return 409;
    default:
      return 422;
  }
}
