/**
 * Date formatting without Intl locale data (old Android WebViews often lack `uz`). Business dates are
 * always shown in the **store time zone** (§15): we read wall-clock parts via Intl's timeZone support
 * and fall back to a fixed offset (Asia/Tashkent = UTC+5, no DST) if that is missing too.
 */
import type { Locale } from '@dokonim/core';

const MONTHS: Record<Locale, string[]> = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT: Record<Locale, string[]> = {
  uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
/** Index 0 = Sunday (JS getDay order). */
const WEEKDAYS: Record<Locale, string[]> = {
  uz: ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const RELATIVE: Record<Locale, Record<-1 | 0 | 1, string>> = {
  uz: { [-1]: 'Kecha', 0: 'Bugun', 1: 'Ertaga' },
  ru: { [-1]: 'Вчера', 0: 'Сегодня', 1: 'Завтра' },
  en: { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' },
};

export const DEFAULT_TZ = 'Asia/Tashkent';

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat | null>();
function partsFormatter(tz: string): Intl.DateTimeFormat | null {
  if (!fmtCache.has(tz)) {
    try {
      fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }));
    } catch {
      fmtCache.set(tz, null);
    }
  }
  return fmtCache.get(tz)!;
}

export function zonedParts(date: Date | string | number, tz: string = DEFAULT_TZ): ZonedParts {
  const d = new Date(date);
  const f = partsFormatter(tz);
  if (f) {
    const p: Record<string, number> = {};
    for (const x of f.formatToParts(d)) if (x.type !== 'literal') p[x.type] = Number(x.value);
    const weekday = new Date(Date.UTC(p.year!, p.month! - 1, p.day!)).getUTCDay();
    return { year: p.year!, month: p.month!, day: p.day!, weekday, hour: p.hour! % 24, minute: p.minute! };
  }
  const s = new Date(d.getTime() + 5 * 3600_000);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), weekday: s.getUTCDay(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}

const dayNumber = (p: ZonedParts) => Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
const pad = (n: number) => String(n).padStart(2, '0');

export interface DateOpts {
  tz?: string;
  weekday?: boolean;
  year?: boolean | 'auto';
  short?: boolean;
  now?: Date;
}

/** "14-noyabr" / "14 ноября" / "14 November"; with `weekday`: "Payshanba, 14-noyabr". */
export function formatDate(date: Date | string | number, locale: Locale, opts: DateOpts = {}): string {
  const p = zonedParts(date, opts.tz);
  const months = opts.short ? MONTHS_SHORT : MONTHS;
  const m = months[locale][p.month - 1]!;
  let body = locale === 'uz' ? `${p.day}-${m}` : `${p.day} ${m}`;
  const nowYear = zonedParts(opts.now ?? new Date(), opts.tz).year;
  const withYear = opts.year === true || ((opts.year ?? 'auto') === 'auto' && p.year !== nowYear);
  if (withYear) body = locale === 'uz' ? `${p.year}-yil ${body}` : locale === 'ru' ? `${body} ${p.year} г.` : `${body} ${p.year}`;
  if (opts.weekday) body = `${WEEKDAYS[locale][p.weekday]}, ${body}`;
  return body;
}

export function formatTime(date: Date | string | number, opts: { tz?: string } = {}): string {
  const p = zonedParts(date, opts.tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Whole calendar days from `now` to `date` in the given zone (tomorrow = 1). */
export function daysFrom(date: Date | string | number, now: Date, tz: string = DEFAULT_TZ): number {
  return dayNumber(zonedParts(date, tz)) - dayNumber(zonedParts(now, tz));
}

/** "Bugun" / "Ertaga" / "Kecha", otherwise "Payshanba, 14-noyabr" (§15 relative phrases). */
export function formatRelativeDay(date: Date | string | number, locale: Locale, opts: { tz?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const diff = daysFrom(date, now, opts.tz);
  if (diff >= -1 && diff <= 1) return RELATIVE[locale][diff as -1 | 0 | 1];
  return formatDate(date, locale, { tz: opts.tz, now, weekday: Math.abs(diff) < 7 });
}

/** "Bugun, 14:30" / "12-noyabr, 09:05" for order timelines. */
export function formatDateTime(date: Date | string | number, locale: Locale, opts: { tz?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  const diff = daysFrom(date, now, opts.tz);
  const day = diff >= -1 && diff <= 1 ? RELATIVE[locale][diff as -1 | 0 | 1] : formatDate(date, locale, { tz: opts.tz, now, short: true });
  return `${day}, ${formatTime(date, opts)}`;
}

export const monthName = (month: number, locale: Locale, short = false) => (short ? MONTHS_SHORT : MONTHS)[locale][month - 1] ?? '';
export const weekdayName = (weekday: number, locale: Locale) => WEEKDAYS[locale][weekday] ?? '';
