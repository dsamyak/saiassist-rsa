import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AnonCtx, AppEnv } from '../context';
import { env } from '../env';
import { forbidden } from '../lib/errors';
import { body } from '../lib/validate';
import { clientIp, requestOrigin, requireAuth } from '../middleware/auth';
import { REFRESH_COOKIE, REFRESH_TTL_DAYS, changePassword, login, logout, me, refresh } from '../services/auth';

const cookieOpts = () => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'Strict' as const,
  path: '/api/auth',
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60,
});

/** Cookie-authenticated endpoints require a custom header, which cross-site forms cannot send. */
const requireClientHeader = (c: any) => {
  if (c.req.header('x-requested-with') !== 'XMLHttpRequest') throw forbidden('Missing client header');
};

const anon = (c: any): AnonCtx => ({ user: null, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null, origin: requestOrigin(c) });

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    const input = await body(c, z.object({ email: z.string().trim().min(1, 'Email is required').max(200), password: z.string().min(1, 'Password is required').max(200) }));
    const res = await login(c.get('db'), anon(c), input);
    setCookie(c, REFRESH_COOKIE, res.cookieValue, cookieOpts());
    return c.json({ accessToken: res.accessToken, mustChangePassword: res.mustChangePassword });
  })
  .post('/refresh', async (c) => {
    requireClientHeader(c);
    const cookie = getCookie(c, REFRESH_COOKIE);
    // No session cookie at all is the normal signed-out state, not an error.
    if (!cookie) return c.json({ accessToken: null });
    try {
      const res = await refresh(c.get('db'), cookie);
      setCookie(c, REFRESH_COOKIE, res.cookieValue, cookieOpts());
      return c.json({ accessToken: res.accessToken });
    } catch (e) {
      deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth' });
      throw e;
    }
  })
  .post('/logout', requireAuth, async (c) => {
    requireClientHeader(c);
    await logout(c.get('db'), c.get('ctx'));
    deleteCookie(c, REFRESH_COOKIE, { path: '/api/auth' });
    return c.json({ ok: true });
  })
  .get('/me', requireAuth, async (c) => c.json(await me(c.get('db'), c.get('ctx'))))
  .post('/change-password', requireAuth, async (c) => {
    const input = await body(c, z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }));
    await changePassword(c.get('db'), c.get('ctx'), input);
    return c.json({ ok: true });
  });
