/**
 * Honest countdown (§2.5, §13.7): counts to the real `ends_at`, never restarts, rolls only the digits that
 * change (Odometer), turns accent-coloured under one hour and disappears when the sale is over.
 */
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { Odometer } from '../../motion';

const pad = (n: number) => String(n).padStart(2, '0');

export function remaining(endsAt: string, now = Date.now()): number {
  return Math.max(0, new Date(endsAt).getTime() - now);
}

export function formatRemaining(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0 ? `${d}:${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function Countdown({ endsAt, compact, onEnd }: { endsAt: string; compact?: boolean; onEnd?: () => void }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const left = remaining(endsAt, now);
  useEffect(() => {
    if (left <= 0) {
      onEnd?.();
      return;
    }
    const id = setTimeout(() => setNow(Date.now()), 1000 - (Date.now() % 1000) + 5);
    return () => clearTimeout(id);
  }, [now, left, onEnd]);
  if (left <= 0) return null;
  const urgent = left < 3_600_000;
  const text = formatRemaining(left);
  return (
    <span className={`st-count${compact ? ' is-compact' : ''}${urgent ? ' is-urgent' : ''}`} role="timer" aria-label={t('store.flashSaleEnds', { time: text })}>
      {!compact && <span className="st-count-label">{t('store.endsIn')}</span>}
      <Odometer value={text} />
    </span>
  );
}
