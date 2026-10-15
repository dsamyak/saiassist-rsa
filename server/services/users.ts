import { z } from 'zod';
import type { Queryable } from '../db';
import type { Ctx } from '../context';
import { audit, diff } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { generatePassword, hashPassword, passwordProblem } from '../lib/security';
import { email, mobile, optional, text } from '../lib/validate';
import { DEALER_PERMISSION_KEYS, DEFAULT_EMPLOYEE_PERMISSIONS } from '../../shared/constants';
import { toUser } from './mappers';

export const userCreateSchema = z.object({
  name: text('Name', 120),
  email,
  mobile: optional(mobile),
  password: optional(z.string().max(128)),
  role: z.enum(['DEALER_ADMIN', 'DEALER_EMPLOYEE', 'SUPER_ADMIN']).default('DEALER_EMPLOYEE'),
  permissions: z.array(z.enum(DEALER_PERMISSION_KEYS)).optional(),
});

export const userUpdateSchema = z.object({
  name: text('Name', 120).optional(),
  mobile: optional(mobile).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  permissions: z.array(z.enum(DEALER_PERMISSION_KEYS)).optional(),
  role: z.enum(['DEALER_ADMIN', 'DEALER_EMPLOYEE']).optional(),
});

const USER_SELECT = `SELECT u.*, d.dealer_name FROM users u LEFT JOIN dealers d ON d.id = u.dealer_id`;

export async function listUsers(q: Queryable, filter: { dealerId: string | null; superAdmins?: boolean }) {
  const { rows } = filter.superAdmins
    ? await q.query(`${USER_SELECT} WHERE u.role = 'SUPER_ADMIN' ORDER BY u.created_at`)
    : await q.query(`${USER_SELECT} WHERE u.dealer_id = $1 ORDER BY u.role, u.created_at`, [filter.dealerId]);
  return rows.map(toUser);
}

/** Who may manage which accounts: Super Admins manage everyone, Dealer Admins manage their own employees. */
function assertCanManage(ctx: Ctx, target: { role: string; dealer_id: string | null }) {
  if (ctx.user.role === 'SUPER_ADMIN') return;
  if (ctx.user.role === 'DEALER_ADMIN' && target.role === 'DEALER_EMPLOYEE' && target.dealer_id === ctx.user.dealerId) return;
  throw forbidden('You can only manage employees of your own dealership');
}

export async function createUser(
  q: Queryable,
  ctx: Ctx,
  dealerId: string | null,
  input: z.infer<typeof userCreateSchema>,
) {
  const role = dealerId ? (input.role === 'SUPER_ADMIN' ? 'DEALER_EMPLOYEE' : input.role) : 'SUPER_ADMIN';
  assertCanManage(ctx, { role, dealer_id: dealerId });
  const exists = await q.query('SELECT 1 FROM users WHERE email = $1', [input.email]);
  if (exists.rows.length) throw conflict('A user with this email already exists');
  const generated = !input.password;
  const password = input.password || generatePassword();
  const problem = passwordProblem(password);
  if (problem) throw badRequest(problem);
  const permissions = role === 'DEALER_EMPLOYEE' ? input.permissions ?? DEFAULT_EMPLOYEE_PERMISSIONS : [];
  const { rows } = await q.query(
    `INSERT INTO users (dealer_id, name, email, mobile, password_hash, role, permissions, must_change_password, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [dealerId, input.name, input.email, input.mobile, await hashPassword(password), role, permissions, true, ctx.user.id],
  );
  const user = toUser(rows[0]);
  await audit(q, ctx, {
    action: 'USER_CREATED',
    dealerId,
    entityType: 'user',
    entityId: user.id,
    entityLabel: user.email,
    newValue: { name: user.name, email: user.email, role, permissions },
  });
  return { user, temporaryPassword: password, generated };
}

export async function updateUser(q: Queryable, ctx: Ctx, id: string, input: z.infer<typeof userUpdateSchema>) {
  const { rows } = await q.query('SELECT * FROM users WHERE id = $1', [id]);
  const before = rows[0];
  if (!before) throw notFound('User');
  assertCanManage(ctx, before);
  if (id === ctx.user.id && input.status === 'INACTIVE') throw badRequest('You cannot deactivate your own account');
  if (input.role && (ctx.user.role !== 'SUPER_ADMIN' || before.role === 'SUPER_ADMIN')) throw forbidden('Only a Super Admin can change dealer roles');
  const role = input.role ?? before.role;
  const next = {
    name: input.name ?? before.name,
    mobile: input.mobile === undefined ? before.mobile : input.mobile,
    status: input.status ?? before.status,
    role,
    permissions: role === 'DEALER_EMPLOYEE' ? input.permissions ?? before.permissions : [],
  };
  const { rows: updated } = await q.query(
    `UPDATE users SET name = $2, mobile = $3, status = $4, role = $5, permissions = $6, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, next.name, next.mobile, next.status, next.role, next.permissions],
  );
  if (next.status === 'INACTIVE') await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  const d = diff(before, next);
  if (d.changed) {
    await audit(q, ctx, {
      action: 'USER_UPDATED',
      dealerId: before.dealer_id,
      entityType: 'user',
      entityId: id,
      entityLabel: before.email,
      oldValue: d.oldValue,
      newValue: d.newValue,
    });
  }
  return toUser(updated[0]);
}

export async function resetPassword(q: Queryable, ctx: Ctx, id: string) {
  const { rows } = await q.query('SELECT * FROM users WHERE id = $1', [id]);
  const target = rows[0];
  if (!target) throw notFound('User');
  assertCanManage(ctx, target);
  const password = generatePassword();
  await q.query(
    `UPDATE users SET password_hash = $2, must_change_password = true, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
    [id, await hashPassword(password)],
  );
  await q.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  await audit(q, ctx, { action: 'USER_PASSWORD_RESET', dealerId: target.dealer_id, entityType: 'user', entityId: id, entityLabel: target.email });
  return { temporaryPassword: password };
}
