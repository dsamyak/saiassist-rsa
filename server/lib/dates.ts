// Business dates are expressed in Indian Standard Time (UTC+05:30, no DST).
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** 'YYYY-MM-DD' of the IST calendar day containing `d`. */
export function istDateString(d: Date = new Date()): string {
  const p = istParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 00:00 IST on the given calendar day, as an absolute instant. */
export function istStartOfDay(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

export function addDaysToDateString(date: string, days: number): string {
  return istDateString(new Date(istStartOfDay(date).getTime() + days * DAY_MS));
}

export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Coverage window: starts 00:00 IST on `startDate` and ends one second before the same time after the
 * validity period, e.g. 14-10-2026 00:00 → 13-10-2027 23:59 for a 12-month plan.
 */
export function coveragePeriod(startDate: string, unit: 'DAYS' | 'MONTHS', value: number) {
  const start = istStartOfDay(startDate);
  let endExclusive: Date;
  if (unit === 'DAYS') {
    endExclusive = new Date(start.getTime() + value * DAY_MS);
  } else {
    const [y, m, d] = startDate.split('-').map(Number);
    const totalMonths = y * 12 + (m - 1) + value;
    const ty = Math.floor(totalMonths / 12);
    const tm = totalMonths % 12;
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    endExclusive = new Date(Date.UTC(ty, tm, Math.min(d, lastDay)) - IST_OFFSET_MS);
  }
  return { start, end: new Date(endExclusive.getTime() - 1000) };
}

/** DD-MM-YYYY HH:mm in IST, the format used on certificates. */
export function formatIstDateTime(d: Date | string): string {
  const p = istParts(typeof d === 'string' ? new Date(d) : d);
  return `${pad(p.day)}-${pad(p.month)}-${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatIstDate(d: Date | string): string {
  const p = istParts(typeof d === 'string' ? new Date(d) : d);
  return `${pad(p.day)}-${pad(p.month)}-${p.year}`;
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' */
export function formatDateString(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/** Inclusive IST day range → [from 00:00 IST, to+1 00:00 IST). */
export function istRange(from: string, to: string) {
  return { from: istStartOfDay(from), to: istStartOfDay(addDaysToDateString(to, 1)) };
}
