import type { Db } from '../db';
import type { AnonCtx, Ctx } from '../context';
import { env } from '../env';
import { audit } from '../lib/audit';
import { HttpError, badRequest, unauthorized } from '../lib/errors';
import { enforceRateLimit } from '../lib/rateLimit';
import { hashPassword, passwordProblem, randomToken, sha256, signJwt, verifyPassword } from '../lib/security';
import {
  DEALER_ADMIN_ONLY_PERMISSIONS,
  DEALER_PERMISSION_KEYS,
  SUPER_ADMIN_DEALER_PERMISSIONS,
} from '../../shared/constants';
import { fileUrl } from './files';
import { effectiveFieldRequirements, getPlatformSettings } from './settings';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 7;
export const REFRESH_COOKIE = 'rsa_session';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export function effectivePermissions(role: string, permissions: string[]): string[] {
  if (role === 'SUPER_ADMIN') return ['platform.admin', ...SUPER_ADMIN_DEALER_PERMISSIONS];
  if (role === 'DEALER_ADMIN') return [...DEALER_PERMISSION_KEYS, ...DEALER_ADMIN_ONLY_PERMISSIONS];
  return permissions.filter((p) => (DEALER_PERMISSION_KEYS as readonly string[]).includes(p));
}

async function createSession(db: Db, userId: string, ctx: AnonCtx | Ctx) {
  const token = randomToken();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3::int), $4, $5) RETURNING id`,
    [userId, sha256(token), REFRESH_TTL_DAYS, ctx.ip, ctx.userAgent?.slice(0, 300) ?? null],
  );
  return { sessionId: rows[0].id, cookieValue: `${rows[0].id}.${token}` };
}

function accessToken(u: { id: string; role: string; dealer_id: string | null }, sessionId: string) {
  return signJwt({ sub: u.id, sid: sessionId, role: u.role, did: u.dealer_id }, env.jwtSecret, ACCESS_TTL_SECONDS);
}

export async function login(db: Db, ctx: AnonCtx, input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  await enforceRateLimit(db, `login-ip:${ctx.ip ?? 'unknown'}`, 30, 15 * 60, 'Too many sign-in attempts. Please wait a few minutes.');
  await enforceRateLimit(db, `login-email:${email}`, 15, 15 * 60, 'Too many sign-in attempts for this account. Please wait a few minutes.');

  const { rows } = await db.query(
    `SELECT u.*, d.status AS dealer_status FROM users u LEFT JOIN dealers d ON d.id = u.dealer_id WHERE u.email = $1`,
    [email],
  );
  const u = rows[0];
  const fail = async (message: string, userRow?: any) => {
    await audit(db, ctx, {
      action: 'LOGIN_FAILED',
      dealerId: userRow?.dealer_id ?? null,
      entityType: 'user',
      entityId: userRow?.id ?? null,
      entityLabel: email,
      result: 'FAILURE',
      message,
      actor: { id: userRow?.id ?? null, name: userRow?.name ?? email, role: userRow?.role ?? null },
    });
  };

  if (!u) {
    await fail('Unknown email');
    throw unauthorized('Invalid email or password');
  }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await fail('Account locked', u);
    throw new HttpError(423, 'ACCOUNT_LOCKED', `Account temporarily locked after repeated failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }
  const ok = await verifyPassword(input.password, u.password_hash);
  if (!ok) {
    const failures = (u.failed_login_count ?? 0) + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await db.query(
      `UPDATE users SET failed_login_count = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4::int) ELSE locked_until END WHERE id = $1`,
      [u.id, lock ? 0 : failures, lock, LOCK_MINUTES],
    );
    await fail(lock ? 'Wrong password - account locked' : 'Wrong password', u);
    throw unauthorized(
      lock
        ? `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`
        : 'Invalid email or password',
    );
  }
  if (u.status !== 'ACTIVE') {
    await fail('Account inactive', u);
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Your account has been deactivated. Contact your administrator.');
  }
  if (u.dealer_id && u.dealer_status !== 'ACTIVE') {
    await fail('Dealer inactive', u);
    throw new HttpError(403, 'DEALER_INACTIVE', 'This dealer workspace is inactive. Contact the platform administrator.');
  }

  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  const session = await createSession(db, u.id, ctx);
  await audit(db, ctx, {
    action: 'LOGIN',
    dealerId: u.dealer_id,
    entityType: 'user',
    entityId: u.id,
    entityLabel: u.email,
    actor: { id: u.id, name: u.name, role: u.role },
  });
  return { accessToken: accessToken(u, session.sessionId), cookieValue: session.cookieValue, mustChangePassword: u.must_change_password };
}

/** Exchanges the refresh cookie for a new access token, rotating the refresh token. */
export async function refresh(db: Db, cookieValue: string | undefined) {
  if (!cookieValue || !cookieValue.includes('.')) throw unauthorized();
  const [sessionId, token] = cookieValue.split('.', 2);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw unauthorized();
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.token_hash, u.id, u.role, u.dealer_id, u.status, d.status AS dealer_status
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN dealers d ON d.id = u.dealer_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sessionId],
  );
  const s = rows[0];
  if (!s || s.token_hash !== sha256(token)) {
    if (s) await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]); // token reuse
    throw unauthorized();
  }
  if (s.status !== 'ACTIVE' || (s.dealer_id && s.dealer_status !== 'ACTIVE')) throw unauthorized();
  const next = randomToken();
  await db.query(
    `UPDATE sessions SET token_hash = $2, last_used_at = now(), expires_at = now() + make_interval(days => $3::int) WHERE id = $1`,
    [sessionId, sha256(next), REFRESH_TTL_DAYS],
  );
  return { accessToken: accessToken(s, sessionId), cookieValue: `${sessionId}.${next}` };
}

export async function logout(db: Db, ctx: Ctx) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [ctx.user.sessionId]);
  await audit(db, ctx, { action: 'LOGOUT', entityType: 'user', entityId: ctx.user.id, entityLabel: ctx.user.email });
}

export async function changePassword(db: Db, ctx: Ctx, input: { currentPassword: string; newPassword: string }) {
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [ctx.user.id]);
  if (!rows[0] || !(await verifyPassword(input.currentPassword, rows[0].password_hash))) {
    throw badRequest('Current password is incorrect');
  }
  const problem = passwordProblem(input.newPassword);
  if (problem) throw badRequest(problem);
  if (input.currentPassword === input.newPassword) throw badRequest('New password must be different from the current one');
  await db.query(
    'UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1',
    [ctx.user.id, await hashPassword(input.newPassword)],
  );
  // Sign out other devices.
  await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [
    ctx.user.id,
    ctx.user.sessionId,
  ]);
  await audit(db, ctx, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: ctx.user.id, entityLabel: ctx.user.email });
}

export async function me(db: Db, ctx: Ctx) {
  const settings = await getPlatformSettings(db);
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.mobile, u.role, u.dealer_id, u.permissions, u.must_change_password, u.last_login_at,
            d.dealer_name, d.dealer_code, d.logo_file_id, d.legal_name, d.settings AS dealer_settings
       FROM users u LEFT JOIN dealers d ON d.id = u.dealer_id WHERE u.id = $1`,
    [ctx.user.id],
  );
  const u = rows[0];
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      role: u.role,
      dealerId: u.dealer_id,
      mustChangePassword: u.must_change_password,
      permissions: effectivePermissions(u.role, u.permissions ?? []),
    },
    dealer: u.dealer_id
      ? {
          id: u.dealer_id,
          name: u.dealer_name,
          code: u.dealer_code,
          legalName: u.legal_name,
          logoUrl: fileUrl(u.logo_file_id),
          fieldRequirements: effectiveFieldRequirements(settings, u.dealer_settings),
        }
      : null,
    platform: { name: settings.platformName, brand: settings.rsaBrandName, expiringSoonDays: settings.expiringSoonDays },
  };
}
