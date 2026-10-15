import { z } from 'zod';
import type { Queryable } from '../db';
import type { Ctx } from '../context';
import { addDaysToDateString, istDateString, istRange, istStartOfDay } from '../lib/dates';
import { isoDate, optional, pagination, uuid } from '../lib/validate';
import { assertCan, dealerScope, requireDealer } from '../middleware/auth';
import { forbidden } from '../lib/errors';
import { effectiveStatusSql, istMonthSql, statusConditionSql } from './policySql';
import { getPlatformSettings } from './settings';
import { paginate, toAudit, toPolicyListItem } from './mappers';

export const reportQuery = z.object({
  from: optional(isoDate),
  to: optional(isoDate),
  dealerId: optional(uuid),
});

const SOLD = `p.status IN ('ACTIVE','RENEWED','CANCELLED','SUSPENDED')`;

/** Dealer reports (scoped) and consolidated Super Admin reports share one implementation. */
export async function policyReport(q: Queryable, ctx: Ctx, f: z.infer<typeof reportQuery>) {
  assertCan(ctx, 'reports.view');
  const settings = await getPlatformSettings(q);
  const scope = dealerScope(ctx, f.dealerId);
  const today = istDateString();
  const to = f.to ?? today;
  const from = f.from ?? `${to.slice(0, 7)}-01`;
  const range = istRange(from, to);
  const params: unknown[] = [range.from, range.to];
  const dealerCond = (alias: string) => (scope ? `AND ${alias}.dealer_id = $3` : '');
  if (scope) params.push(scope);
  const inRange = `p.issued_at >= $1 AND p.issued_at < $2`;
  const exp = settings.expiringSoonDays;

  const { rows: s } = await q.query(
    `SELECT
       count(*) FILTER (WHERE ${inRange})::int AS issued,
       count(*) FILTER (WHERE ${inRange} AND p.renewed_from_policy_id IS NOT NULL)::int AS renewals,
       coalesce(sum(p.base_premium) FILTER (WHERE ${inRange} AND ${SOLD}), 0)::float8 AS premium,
       coalesce(sum(p.gst_amount) FILTER (WHERE ${inRange} AND ${SOLD}), 0)::float8 AS gst,
       coalesce(sum(p.total_premium) FILTER (WHERE ${inRange} AND ${SOLD}), 0)::float8 AS total,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'IN_FORCE', exp)})::int AS active,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRING_SOON', exp)})::int AS expiring,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRED', exp)})::int AS expired,
       count(*) FILTER (WHERE p.status = 'PAYMENT_PENDING')::int AS payment_pending,
       count(*) FILTER (WHERE p.status = 'CANCELLED')::int AS cancelled_total
     FROM policies p WHERE p.status <> 'DRAFT' ${dealerCond('p')}`,
    params,
  );
  const { rows: c } = await q.query(
    `SELECT count(*)::int AS cancellations, coalesce(sum(pc.refund_amount), 0)::float8 AS refunds
       FROM policy_cancellations pc WHERE pc.status = 'APPROVED' AND pc.decided_at >= $1 AND pc.decided_at < $2 ${dealerCond('pc')}`,
    params,
  );
  const { rows: due } = await q.query(
    `SELECT count(*)::int AS due, count(*) FILTER (WHERE p.renewed_to_policy_id IS NOT NULL)::int AS renewed
       FROM policies p WHERE p.status IN ('ACTIVE','RENEWED') AND p.end_date >= $1 AND p.end_date < $2 ${dealerCond('p')}`,
    params,
  );
  const { rows: productWise } = await q.query(
    `SELECT p.product_id, p.plan_name, count(*)::int AS policies, coalesce(sum(p.base_premium), 0)::float8 AS premium,
            coalesce(sum(p.gst_amount), 0)::float8 AS gst, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM policies p WHERE ${inRange} AND ${SOLD} ${dealerCond('p')}
      GROUP BY p.product_id, p.plan_name ORDER BY policies DESC`,
    params,
  );
  const { rows: employeeWise } = await q.query(
    `SELECT u.id AS user_id, u.name, u.role, d.dealer_name, count(*)::int AS policies, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM policies p JOIN users u ON u.id = p.issued_by JOIN dealers d ON d.id = p.dealer_id
      WHERE ${inRange} AND ${SOLD} ${dealerCond('p')}
      GROUP BY u.id, u.name, u.role, d.dealer_name ORDER BY policies DESC LIMIT 50`,
    params,
  );
  const { rows: monthly } = await q.query(
    `SELECT ${istMonthSql('p.issued_at')} AS month, count(*)::int AS policies,
            coalesce(sum(p.total_premium), 0)::float8 AS total, coalesce(sum(p.gst_amount), 0)::float8 AS gst,
            count(*) FILTER (WHERE p.renewed_from_policy_id IS NOT NULL)::int AS renewals
       FROM policies p WHERE ${inRange} AND ${SOLD} ${dealerCond('p')}
      GROUP BY 1 ORDER BY 1`,
    params,
  );
  let dealerWise: any[] = [];
  if (ctx.user.role === 'SUPER_ADMIN' && !scope) {
    const { rows } = await q.query(
      `SELECT d.id AS dealer_id, d.dealer_code, d.dealer_name, d.status,
              count(p.id) FILTER (WHERE ${inRange})::int AS issued,
              coalesce(sum(p.total_premium) FILTER (WHERE ${inRange} AND ${SOLD}), 0)::float8 AS total,
              coalesce(sum(p.gst_amount) FILTER (WHERE ${inRange} AND ${SOLD}), 0)::float8 AS gst,
              count(p.id) FILTER (WHERE ${statusConditionSql('p', 'IN_FORCE', exp)})::int AS active,
              count(p.id) FILTER (WHERE ${inRange} AND p.renewed_from_policy_id IS NOT NULL)::int AS renewals,
              count(p.id) FILTER (WHERE ${inRange} AND p.status = 'CANCELLED')::int AS cancelled
         FROM dealers d LEFT JOIN policies p ON p.dealer_id = d.id AND p.status <> 'DRAFT'
        GROUP BY d.id ORDER BY total DESC, d.dealer_name`,
      params,
    );
    dealerWise = rows;
  }
  const summary = s[0];
  return {
    range: { from, to },
    summary: {
      ...summary,
      cancellations: c[0].cancellations,
      refunds: c[0].refunds,
      net: summary.total - c[0].refunds,
      dueForRenewal: due[0].due,
      renewedOfDue: due[0].renewed,
      renewalRate: due[0].due ? due[0].renewed / due[0].due : null,
      cancellationRate: summary.issued ? c[0].cancellations / summary.issued : null,
    },
    productWise,
    employeeWise,
    monthly,
    dealerWise,
  };
}

// ---------------------------------------------------------------- dashboards

export async function dealerDashboard(q: Queryable, ctx: Ctx) {
  const dealerId = requireDealer(ctx);
  const settings = await getPlatformSettings(q);
  const exp = settings.expiringSoonDays;
  const today = istDateString();
  const todayStart = istStartOfDay(today);
  const monthStart = istStartOfDay(`${today.slice(0, 7)}-01`);
  const { rows } = await q.query(
    `SELECT
       count(*) FILTER (WHERE p.status <> 'DRAFT')::int AS total,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'IN_FORCE', exp)})::int AS active,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRING_SOON', exp)})::int AS expiring,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRED', exp)})::int AS expired,
       count(*) FILTER (WHERE p.issued_at >= $2)::int AS today,
       count(*) FILTER (WHERE p.issued_at >= $3)::int AS this_month,
       coalesce(sum(p.total_premium) FILTER (WHERE p.issued_at >= $3 AND ${SOLD}), 0)::float8 AS month_premium,
       count(*) FILTER (WHERE p.status = 'PAYMENT_PENDING')::int AS payment_pending,
       count(*) FILTER (WHERE p.status = 'DRAFT')::int AS drafts
     FROM policies p WHERE p.dealer_id = $1`,
    [dealerId, todayStart, monthStart],
  );
  const { rows: pendingCancel } = await q.query(
    `SELECT count(*)::int AS n FROM policy_cancellations WHERE dealer_id = $1 AND status = 'REQUESTED'`,
    [dealerId],
  );
  const { rows: recent } = await q.query(
    `SELECT p.*, ${effectiveStatusSql('p', exp)} AS effective_status, c.name AS customer_name, c.mobile AS customer_mobile,
            v.registration_no, v.make, v.model, v.chassis_no, v.engine_no, d.dealer_name, u.name AS issued_by_name
       FROM policies p JOIN customers c ON c.id = p.customer_id JOIN vehicles v ON v.id = p.vehicle_id
       JOIN dealers d ON d.id = p.dealer_id LEFT JOIN users u ON u.id = p.issued_by
      WHERE p.dealer_id = $1 AND p.status <> 'DRAFT' ORDER BY p.issued_at DESC NULLS LAST LIMIT 8`,
    [dealerId],
  );
  const { rows: trend } = await q.query(
    `SELECT ${istMonthSql('p.issued_at')} AS month, count(*)::int AS policies, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM policies p WHERE p.dealer_id = $1 AND ${SOLD} AND p.issued_at >= $2 GROUP BY 1 ORDER BY 1`,
    [dealerId, istStartOfDay(addMonths(`${today.slice(0, 7)}-01`, -5))],
  );
  const { rows: expiringSoon } = await q.query(
    `SELECT p.*, ${effectiveStatusSql('p', exp)} AS effective_status, c.name AS customer_name, c.mobile AS customer_mobile,
            v.registration_no, v.make, v.model, v.chassis_no, v.engine_no, d.dealer_name
       FROM policies p JOIN customers c ON c.id = p.customer_id JOIN vehicles v ON v.id = p.vehicle_id JOIN dealers d ON d.id = p.dealer_id
      WHERE p.dealer_id = $1 AND ${statusConditionSql('p', 'EXPIRING_SOON', exp)} ORDER BY p.end_date LIMIT 6`,
    [dealerId],
  );
  return {
    counts: { ...rows[0], pendingCancellations: pendingCancel[0].n },
    recent: recent.map(toPolicyListItem),
    expiringSoon: expiringSoon.map(toPolicyListItem),
    trend: fillMonths(trend, 6),
    expiringSoonDays: exp,
  };
}

export async function adminDashboard(q: Queryable, ctx: Ctx) {
  if (ctx.user.role !== 'SUPER_ADMIN') throw forbidden();
  const settings = await getPlatformSettings(q);
  const exp = settings.expiringSoonDays;
  const today = istDateString();
  const monthStart = istStartOfDay(`${today.slice(0, 7)}-01`);
  const { rows } = await q.query(
    `SELECT
       (SELECT count(*) FROM dealers)::int AS dealers,
       (SELECT count(*) FROM dealers WHERE status = 'ACTIVE')::int AS active_dealers,
       (SELECT count(*) FROM users WHERE role <> 'SUPER_ADMIN')::int AS dealer_users,
       (SELECT count(*) FROM rsa_products WHERE status = 'ACTIVE')::int AS products,
       count(*) FILTER (WHERE p.status <> 'DRAFT')::int AS total,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'IN_FORCE', exp)})::int AS active,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRING_SOON', exp)})::int AS expiring,
       count(*) FILTER (WHERE ${statusConditionSql('p', 'EXPIRED', exp)})::int AS expired,
       count(*) FILTER (WHERE p.issued_at >= $1)::int AS this_month,
       coalesce(sum(p.total_premium) FILTER (WHERE p.issued_at >= $1 AND ${SOLD}), 0)::float8 AS month_premium,
       coalesce(sum(p.total_premium) FILTER (WHERE ${SOLD}), 0)::float8 AS lifetime_premium,
       coalesce(sum(p.gst_amount) FILTER (WHERE p.issued_at >= $1 AND ${SOLD}), 0)::float8 AS month_gst
     FROM policies p`,
    [monthStart],
  );
  const { rows: trend } = await q.query(
    `SELECT ${istMonthSql('p.issued_at')} AS month, count(*)::int AS policies, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM policies p WHERE ${SOLD} AND p.issued_at >= $1 GROUP BY 1 ORDER BY 1`,
    [istStartOfDay(addMonths(`${today.slice(0, 7)}-01`, -11))],
  );
  const { rows: topDealers } = await q.query(
    `SELECT d.id, d.dealer_name, d.dealer_code, d.status, count(p.id)::int AS policies, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM dealers d LEFT JOIN policies p ON p.dealer_id = d.id AND ${SOLD} AND p.issued_at >= $1
      GROUP BY d.id ORDER BY total DESC LIMIT 6`,
    [monthStart],
  );
  const { rows: productMix } = await q.query(
    `SELECT p.plan_name, count(*)::int AS policies, coalesce(sum(p.total_premium), 0)::float8 AS total
       FROM policies p WHERE ${SOLD} AND p.issued_at >= $1 GROUP BY p.plan_name ORDER BY policies DESC`,
    [istStartOfDay(addMonths(`${today.slice(0, 7)}-01`, -11))],
  );
  const { rows: pendingCancel } = await q.query(`SELECT count(*)::int AS n FROM policy_cancellations WHERE status = 'REQUESTED'`);
  return { counts: { ...rows[0], pendingCancellations: pendingCancel[0].n }, trend: fillMonths(trend, 12), topDealers, productMix };
}

function addMonths(date: string, n: number) {
  const [y, m] = date.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

function fillMonths(rows: { month: string; policies: number; total: number }[], count: number) {
  const today = istDateString();
  const out: { month: string; policies: number; total: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const key = addMonths(`${today.slice(0, 7)}-01`, -i).slice(0, 7);
    const r = rows.find((x) => x.month === key);
    out.push({ month: key, policies: r?.policies ?? 0, total: r?.total ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------- audit log

export const auditQuery = z.object({
  q: optional(z.string().max(100)),
  action: optional(z.string().max(60)),
  entityType: optional(z.string().max(40)),
  entityId: optional(z.string().max(80)),
  userId: optional(uuid),
  dealerId: optional(uuid),
  result: optional(z.enum(['SUCCESS', 'FAILURE'])),
  from: optional(isoDate),
  to: optional(isoDate),
  ...pagination,
});

export async function listAuditLogs(q: Queryable, ctx: Ctx, f: z.infer<typeof auditQuery>) {
  assertCan(ctx, 'audit.view');
  const scope = dealerScope(ctx, f.dealerId);
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (scope) where.push(`a.dealer_id = ${add(scope)}`);
  if (f.action) where.push(`a.action = ${add(f.action)}`);
  if (f.entityType) where.push(`a.entity_type = ${add(f.entityType)}`);
  if (f.entityId) where.push(`a.entity_id = ${add(f.entityId)}`);
  if (f.userId) where.push(`a.user_id = ${add(f.userId)}`);
  if (f.result) where.push(`a.result = ${add(f.result)}`);
  if (f.q) {
    const like = add(`%${f.q}%`);
    where.push(`(a.entity_label ILIKE ${like} OR a.user_name ILIKE ${like} OR a.message ILIKE ${like})`);
  }
  if (f.from || f.to) {
    const r = istRange(f.from ?? '2000-01-01', f.to ?? addDaysToDateString(istDateString(), 0));
    where.push(`a.created_at >= ${add(r.from)} AND a.created_at < ${add(r.to)}`);
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await q.query(
    `SELECT a.*, d.dealer_name, count(*) OVER() AS total_count FROM audit_logs a LEFT JOIN dealers d ON d.id = a.dealer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paginate(rows.map(toAudit), rows[0]?.total_count ?? 0, f.page, f.pageSize);
}
