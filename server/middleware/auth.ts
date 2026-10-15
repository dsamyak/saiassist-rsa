import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AppEnv, AuthUser, Ctx } from '../context';
import { env } from '../env';
import { HttpError, forbidden, unauthorized } from '../lib/errors';
import { verifyJwt } from '../lib/security';
import {
  DEALER_ADMIN_ONLY_PERMISSIONS,
  DEALER_PERMISSION_KEYS,
  SUPER_ADMIN_DEALER_PERMISSIONS,
  type Role,
} from '../../shared/constants';

export function clientIp(c: Context): string | null {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (c.req.header('x-real-ip') || c.req.header('cf-connecting-ip') || null)?.slice(0, 64) ?? null;
}

export function requestOrigin(c: Context): string {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() || c.req.header('host') || url.host;
  return `${proto}://${host}`;
}

const PASSWORD_CHANGE_ALLOWED = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

/** Authenticates the bearer token and loads the user, session and dealer status from the database. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();
  const payload = verifyJwt(token, env.jwtSecret);
  if (!payload) throw new HttpError(401, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');

  const db = c.get('db');
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.dealer_id, u.permissions, u.status, u.must_change_password,
            d.status AS dealer_status
       FROM users u
       JOIN sessions s ON s.id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
       LEFT JOIN dealers d ON d.id = u.dealer_id
      WHERE u.id = $1`,
    [payload.sub, payload.sid],
  );
  const u = rows[0];
  if (!u || u.status !== 'ACTIVE') throw unauthorized('Your session is no longer valid. Please sign in again.');
  if (u.dealer_id && u.dealer_status !== 'ACTIVE') {
    throw new HttpError(403, 'DEALER_INACTIVE', 'This dealer workspace is inactive. Please contact the platform administrator.');
  }
  const user: AuthUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    dealerId: u.dealer_id,
    permissions: u.permissions ?? [],
    mustChangePassword: u.must_change_password,
    sessionId: payload.sid,
  };
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.includes(c.req.path)) {
    throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please change your password to continue.');
  }
  const ctx: Ctx = { user, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null, origin: requestOrigin(c) };
  c.set('ctx', ctx);
  await next();
});

export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.get('ctx').user.role)) throw forbidden();
    await next();
  });

const dealerPerms = new Set<string>([...DEALER_PERMISSION_KEYS, ...DEALER_ADMIN_ONLY_PERMISSIONS]);
const superPerms = new Set<string>(SUPER_ADMIN_DEALER_PERMISSIONS);

export function can(user: AuthUser, permission: string): boolean {
  switch (user.role) {
    case 'SUPER_ADMIN':
      return superPerms.has(permission);
    case 'DEALER_ADMIN':
      return dealerPerms.has(permission);
    case 'DEALER_EMPLOYEE':
      return user.permissions.includes(permission);
    default:
      return false;
  }
}

export function assertCan(ctx: Ctx, permission: string, message?: string) {
  if (!can(ctx.user, permission)) throw forbidden(message);
}

/**
 * Tenant scope for a request. Dealer users are always pinned to their own dealer (input is ignored);
 * Super Admins see everything unless they filter by a dealer.
 */
export function dealerScope(ctx: Ctx, requestedDealerId?: string | null): string | null {
  if (ctx.user.role === 'SUPER_ADMIN') return requestedDealerId || null;
  if (!ctx.user.dealerId) throw forbidden();
  return ctx.user.dealerId;
}

/** For actions that only make sense inside a dealer workspace (issuing, creating customers, ...). */
export function requireDealer(ctx: Ctx): string {
  if (ctx.user.role === 'SUPER_ADMIN' || !ctx.user.dealerId) {
    throw forbidden('This action is performed from a dealer workspace');
  }
  return ctx.user.dealerId;
}
