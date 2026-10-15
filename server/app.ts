import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './context';
import { getDb } from './db';
import { HttpError } from './lib/errors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { workspaceRoutes } from './routes/workspace';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use(
    '/api/*',
    secureHeaders({ crossOriginResourcePolicy: 'same-origin', referrerPolicy: 'strict-origin-when-cross-origin' }),
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large (max 2 MB)' } }, 413),
    }),
    async (c, next) => {
      c.set('db', await getDb());
      await next();
      if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
    },
  );

  app.route('/api', publicRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api', workspaceRoutes);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as any);
    }
    const pgCode = (err as any)?.code;
    if (pgCode === '23505') return c.json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } }, 409);
    if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22008') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid value supplied' } }, 400);
    }
    // Never echo internals to clients; log without request bodies (which may hold personal data).
    console.error(`[api] ${c.req.method} ${c.req.path} failed:`, err instanceof Error ? err.stack ?? err.message : err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } }, 500);
  });

  return app;
}
