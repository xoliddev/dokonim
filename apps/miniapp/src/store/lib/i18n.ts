/**
 * Storefront i18n: the shared hook with one tweak — money uses a no-break space instead of U+202F: in the display
 * face the narrow no-break space is ~0.13em, so with tight tracking prices read as "420000UZS".
 */
import { useMemo } from 'react';
import { useI18n as useSharedI18n } from '../../i18n';

const NNBSP = / /g;
export const fixSpaces = (s: string) => s.replace(NNBSP, ' ');

export function useI18n() {
  const i = useSharedI18n();
  return useMemo(() => ({ ...i, money: (minor: number, currency?: Parameters<typeof i.money>[1]) => fixSpaces(i.money(minor, currency)), number: (n: number) => fixSpaces(i.number(n)) }), [i]);
}
