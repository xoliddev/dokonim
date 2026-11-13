/**
 * Delivery-date promise (§9.5) and shipping rate calculation. Business rules always use the STORE time zone.
 */
import type { Minor } from './money';

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  weekday: number; // 1=Mon … 7=Sun (ISO)
}

const OFFSETS: Record<string, number> = { 'Asia/Tashkent': 300, 'Asia/Samarkand': 300, UTC: 0 };

/** Wall-clock parts of `now` in `tz`. Uses Intl when available, else a fixed offset table (UZ has no DST). */
export function toLocal(now: Date, tz = 'Asia/Tashkent'): LocalDateTime {
  try {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    const date = `${p.year}-${p.month}-${p.day}`;
    return { date, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: isoWeekday(date) };
  } catch {
    const off = OFFSETS[tz] ?? 300;
    const d = new Date(now.getTime() + off * 60_000);
    const date = d.toISOString().slice(0, 10);
    return { date, minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: isoWeekday(date) };
  }
}

export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export interface WorkCalendar {
  /** ISO weekdays the store ships on (default Mon–Sat). */
  workingDays: number[];
  holidays: string[];
}

export function isWorkingDay(date: string, cal: WorkCalendar): boolean {
  return cal.workingDays.includes(isoWeekday(date)) && !cal.holidays.includes(date);
}

export function nextWorkingDay(date: string, cal: WorkCalendar, includeSelf = false): string {
  let d = includeSelf ? date : addDays(date, 1);
  for (let i = 0; i < 370; i++) {
    if (isWorkingDay(d, cal)) return d;
    d = addDays(d, 1);
  }
  return d;
}

export function addWorkingDays(date: string, n: number, cal: WorkCalendar): string {
  let d = date;
  for (let i = 0; i < n; i++) d = nextWorkingDay(d, cal);
  return d;
}

export interface PromiseInput {
  now: Date;
  timezone: string;
  cutoffTime: string; // "14:00"
  processingDays: number;
  transitMin: number;
  transitMax: number;
  calendar: WorkCalendar;
}

export interface DeliveryPromise {
  from: string;
  to: string;
  /** The day the order starts processing (today if before cutoff on a working day). */
  startsOn: string;
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function deliveryPromise(i: PromiseInput): DeliveryPromise {
  const local = toLocal(i.now, i.timezone);
  const beforeCutoff = local.minutes < parseHm(i.cutoffTime);
  const startsOn =
    isWorkingDay(local.date, i.calendar) && beforeCutoff ? local.date : nextWorkingDay(local.date, i.calendar);
  const shipDay = addWorkingDays(startsOn, i.processingDays, i.calendar);
  const from = addWorkingDays(shipDay, i.transitMin, i.calendar);
  const to = addWorkingDays(shipDay, Math.max(i.transitMin, i.transitMax), i.calendar);
  return { from, to, startsOn };
}

// ── Shipping rates ─────────────────────────────────────────────────────────

export type MethodType = 'courier' | 'pickup_point' | 'post' | 'self_pickup';
export type RateCalc = 'flat' | 'weight' | 'free_over';

export interface RateDef {
  calc: RateCalc;
  amount: Minor;
  perKg?: Minor | null;
  freeOver?: Minor | null;
}

/** Base rate before discounts. "free_over" returns the full amount; the pricing pipeline zeroes it over the threshold. */
export function rateAmount(rate: RateDef, weightG: number): Minor {
  if (rate.calc === 'weight') return rate.amount + (rate.perKg ?? 0) * Math.max(0, Math.ceil(weightG / 1000) - 1);
  return rate.amount;
}

export interface ZoneDef {
  id: string;
  regions: string[];
  districts: string[];
}

/** The most specific zone: district match beats region match beats a catch-all zone (no regions). */
export function matchZone<Z extends ZoneDef>(zones: Z[], region: string | null, district?: string | null): Z | null {
  if (district) {
    const z = zones.find((x) => x.districts.includes(district));
    if (z) return z;
  }
  if (region) {
    const z = zones.find((x) => x.regions.includes(region));
    if (z) return z;
  }
  return zones.find((x) => x.regions.length === 0 && x.districts.length === 0) ?? null;
}

/** Uzbekistan's regions (ISO 3166-2:UZ). Names are UZ Latin; UI localises via i18n. */
export const UZ_REGIONS: Array<{ code: string; uz: string; ru: string; en: string }> = [
  { code: 'UZ-TK', uz: 'Toshkent shahri', ru: 'г. Ташкент', en: 'Tashkent city' },
  { code: 'UZ-TO', uz: 'Toshkent viloyati', ru: 'Ташкентская обл.', en: 'Tashkent region' },
  { code: 'UZ-AN', uz: 'Andijon', ru: 'Андижан', en: 'Andijan' },
  { code: 'UZ-FA', uz: 'Fargʻona', ru: 'Фергана', en: 'Fergana' },
  { code: 'UZ-NG', uz: 'Namangan', ru: 'Наманган', en: 'Namangan' },
  { code: 'UZ-SA', uz: 'Samarqand', ru: 'Самарканд', en: 'Samarkand' },
  { code: 'UZ-BU', uz: 'Buxoro', ru: 'Бухара', en: 'Bukhara' },
  { code: 'UZ-NW', uz: 'Navoiy', ru: 'Навои', en: 'Navoiy' },
  { code: 'UZ-QA', uz: 'Qashqadaryo', ru: 'Кашкадарья', en: 'Kashkadarya' },
  { code: 'UZ-SU', uz: 'Surxondaryo', ru: 'Сурхандарья', en: 'Surkhandarya' },
  { code: 'UZ-JI', uz: 'Jizzax', ru: 'Джизак', en: 'Jizzakh' },
  { code: 'UZ-SI', uz: 'Sirdaryo', ru: 'Сырдарья', en: 'Syrdarya' },
  { code: 'UZ-XO', uz: 'Xorazm', ru: 'Хорезм', en: 'Khorezm' },
  { code: 'UZ-QR', uz: 'Qoraqalpogʻiston', ru: 'Каракалпакстан', en: 'Karakalpakstan' },
];

// ── Installments (§9.6, informational) ─────────────────────────────────────

export interface InstallmentPlan {
  months: number;
  markupPercent: number;
}

export function installment(total: Minor, plan: InstallmentPlan): { monthly: Minor; totalPayable: Minor } {
  const withMarkup = (total * (100 + plan.markupPercent)) / 100;
  const monthly = Math.ceil(withMarkup / plan.months / 100) * 100;
  return { monthly, totalPayable: monthly * plan.months };
}
