// SQL fragments for policy status. EXPIRING_SOON and EXPIRED are derived from end_date at query time,
// so no background job is required to keep statuses current.

const days = (n: number) => Math.max(1, Math.floor(Number(n) || 30));

export function effectiveStatusSql(alias: string, expiringDays: number) {
  const a = alias;
  return `(CASE
    WHEN ${a}.status = 'ACTIVE' AND ${a}.end_date < now() THEN 'EXPIRED'
    WHEN ${a}.status = 'ACTIVE' AND ${a}.end_date < now() + make_interval(days => ${days(expiringDays)}) THEN 'EXPIRING_SOON'
    ELSE ${a}.status END)`;
}

/** WHERE condition for a status filter. IN_FORCE = Active + Expiring Soon. */
export function statusConditionSql(alias: string, status: string, expiringDays: number): string {
  const a = alias;
  const win = `now() + make_interval(days => ${days(expiringDays)})`;
  switch (status) {
    case 'IN_FORCE':
      return `(${a}.status = 'ACTIVE' AND ${a}.end_date >= now())`;
    case 'ACTIVE':
      return `(${a}.status = 'ACTIVE' AND ${a}.end_date >= ${win})`;
    case 'EXPIRING_SOON':
      return `(${a}.status = 'ACTIVE' AND ${a}.end_date >= now() AND ${a}.end_date < ${win})`;
    case 'EXPIRED':
      return `(${a}.status = 'ACTIVE' AND ${a}.end_date < now())`;
    case 'DRAFT':
    case 'PAYMENT_PENDING':
    case 'CANCELLED':
    case 'SUSPENDED':
    case 'RENEWED':
      return `(${a}.status = '${status}')`;
    default:
      return 'TRUE';
  }
}

/** IST calendar month key, e.g. '2026-10'. */
export const istMonthSql = (col: string) => `to_char((${col} AT TIME ZONE 'UTC') + interval '330 minutes', 'YYYY-MM')`;
