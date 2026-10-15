import { z } from 'zod';
import type { Queryable } from '../db';
import type { Ctx } from '../context';
import { istRange } from '../lib/dates';
import { isoDate, optional, pagination, uuid } from '../lib/validate';
import { PAYMENT_METHOD_VALUES, PAYMENT_STATUSES } from '../../shared/constants';
import { assertCan, dealerScope } from '../middleware/auth';
import { paginate, toPayment } from './mappers';

export const paymentListQuery = z.object({
  q: optional(z.string().max(100)),
  status: optional(z.enum(PAYMENT_STATUSES)),
  method: optional(z.enum(PAYMENT_METHOD_VALUES)),
  dealerId: optional(uuid),
  from: optional(isoDate),
  to: optional(isoDate),
  ...pagination,
});

export async function listPayments(q: Queryable, ctx: Ctx, f: z.infer<typeof paymentListQuery>) {
  assertCan(ctx, 'payments.view');
  const scope = dealerScope(ctx, f.dealerId);
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (scope) where.push(`pm.dealer_id = ${add(scope)}`);
  if (f.status) where.push(`pm.status = ${add(f.status)}`);
  if (f.method) where.push(`pm.payment_method = ${add(f.method)}`);
  if (f.q) {
    const like = add(`%${f.q}%`);
    where.push(`(p.policy_number ILIKE ${like} OR pm.transaction_id ILIKE ${like} OR c.name ILIKE ${like} OR c.mobile LIKE ${like})`);
  }
  if (f.from || f.to) {
    const r = istRange(f.from ?? '2000-01-01', f.to ?? '2999-12-31');
    where.push(`pm.created_at >= ${add(r.from)} AND pm.created_at < ${add(r.to)}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM payments pm
       JOIN policies p ON p.id = pm.policy_id
       JOIN customers c ON c.id = p.customer_id
       JOIN dealers d ON d.id = pm.dealer_id
       LEFT JOIN users u ON u.id = pm.created_by ${whereSql}`;
  const { rows: totals } = await q.query(
    `SELECT
       coalesce(sum(pm.total_amount) FILTER (WHERE pm.status IN ('SUCCESS','REFUNDED','PARTIALLY_REFUNDED')), 0)::float8 AS collected,
       coalesce(sum(pm.refund_amount), 0)::float8 AS refunded,
       coalesce(sum(pm.total_amount) FILTER (WHERE pm.status = 'PENDING'), 0)::float8 AS pending,
       count(*) FILTER (WHERE pm.status = 'PENDING')::int AS pending_count
     ${from}`,
    params,
  );
  const listParams = [...params, f.pageSize, (f.page - 1) * f.pageSize];
  const { rows } = await q.query(
    `SELECT pm.*, p.policy_number, p.status AS policy_status, c.name AS customer_name, d.dealer_name, u.name AS created_by_name,
            count(*) OVER() AS total_count
     ${from} ORDER BY pm.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams,
  );
  return {
    ...paginate(rows.map(toPayment), rows[0]?.total_count ?? 0, f.page, f.pageSize),
    totals: { ...totals[0], net: totals[0].collected - totals[0].refunded },
  };
}
