/**
 * API error → human message. Known domain codes have their own seller strings; VALIDATION errors carry the
 * server's own (English) message as a fallback, and `details.field` lets forms put it next to the input.
 *
 *   try { await save.run(input) } catch (e) { toastError(e, t) }
 *   const fe = fieldError(e, 'name')   // message for <Input error={…}> or undefined
 */
import type { MessageKey } from '@dokonim/i18n';
import { toast } from '../../ui';
import { haptic } from '../../telegram/shim';

type T = (k: MessageKey, p?: Record<string, string | number>) => string;

export interface ApiErr {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const KNOWN = new Set([
  'VALIDATION', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'SLUG_TAKEN', 'SLUG_INVALID', 'CATEGORY_CYCLE', 'CATEGORY_NOT_EMPTY',
  'CATEGORY_DEPTH', 'VARIANT_LIMIT', 'OPTION_LIMIT', 'INVALID_TRANSITION', 'RATE_LIMITED', 'UNAUTHENTICATED',
]);

export function errorMessage(e: unknown, t: T): string {
  const err = (e ?? {}) as ApiErr;
  const code = err.code ?? '';
  // VALIDATION messages from the domain are specific ("Percent must be between 1 and 100"): prefer them.
  if (code === 'VALIDATION' && err.message && err.message !== 'Invalid input') return `${t('seller.err_VALIDATION')}: ${err.message}`;
  if (KNOWN.has(code)) return t(`seller.err_${code}` as MessageKey);
  if (code === 'NETWORK') return t('common.errorNetwork');
  return err.message && code ? err.message : t('common.errorGeneric');
}

export function toastError(e: unknown, t: T) {
  haptic.notify('error');
  toast.error(errorMessage(e, t));
}

/** The error text for a given form field, if the API pointed at it. */
export function fieldError(e: unknown, field: string, t: T): string | undefined {
  const err = (e ?? {}) as ApiErr;
  const f = err.details?.field;
  if (typeof f !== 'string') return undefined;
  if (f === field || f.startsWith(`${field}.`)) return errorMessage(e, t);
  return undefined;
}
