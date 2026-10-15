import { FUEL_TYPES, PAYMENT_METHODS, VEHICLE_TYPES } from '@shared/constants';

const IST = 'Asia/Kolkata';

function parts(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') === '24' ? '00' : get('hour'), min: get('minute') };
}

/** DD-MM-YYYY (IST) */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}-${m}-${y}`;
  }
  const p = parts(new Date(v));
  return `${p.d}-${p.m}-${p.y}`;
}

/** DD-MM-YYYY HH:mm (IST) */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const p = parts(new Date(v));
  return `${p.d}-${p.m}-${p.y} ${p.h}:${p.min}`;
}

export function todayIst(): string {
  const p = parts(new Date());
  return `${p.y}-${p.m}-${p.d}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function monthStart(date = todayIst()): string {
  return `${date.slice(0, 7)}-01`;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');

export const formatMoney = (n: number | null | undefined) => (n === null || n === undefined ? '—' : inr.format(n));
export const formatMoney0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : inr0.format(n));
export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num.format(n));

/** Indian compact notation: 12.5K, 3.4L, 1.2Cr */
export function compactINR(n: number): string {
  const a = Math.abs(n);
  const f = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
  if (a >= 1e7) return `${f(n / 1e7)}Cr`;
  if (a >= 1e5) return `${f(n / 1e5)}L`;
  if (a >= 1e3) return `${f(n / 1e3)}K`;
  return String(Math.round(n));
}

export const percent = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
};

export const vehicleTypeLabel = (v?: string | null) => VEHICLE_TYPES.find((t) => t.value === v)?.label ?? v ?? '';
export const fuelTypeLabel = (v?: string | null) => FUEL_TYPES.find((t) => t.value === v)?.label ?? v ?? '';
export const paymentMethodLabel = (v?: string | null) => PAYMENT_METHODS.find((t) => t.value === v)?.label ?? v ?? '';

export const validityLabel = (unit: string, value: number) =>
  unit === 'MONTHS' ? (value % 12 === 0 ? `${value / 12} year${value === 12 ? '' : 's'}` : `${value} months`) : `${value} days`;

/** Renewal is offered from 90 days before expiry (mirrors the server's policy actions). */
export const inRenewalWindow = (endDate: string) => new Date(endDate).getTime() - Date.now() <= 90 * 86400_000;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
