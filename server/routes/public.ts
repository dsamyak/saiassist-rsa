import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { notFound } from '../lib/errors';
import { uuid } from '../lib/validate';
import { clientIp, requestOrigin } from '../middleware/auth';
import { getFile } from '../services/files';
import { verifyPolicy } from '../services/policies';
import { getPlatformSettings } from '../services/settings';

export const publicRoutes = new Hono<AppEnv>()
  .get('/health', async (c) => {
    await c.get('db').query('SELECT 1');
    return c.json({ ok: true, time: new Date().toISOString() });
  })
  .get('/public/branding', async (c) => {
    const s = await getPlatformSettings(c.get('db'));
    return c.json({ platformName: s.platformName, brand: s.rsaBrandName, helpline: s.rsaPhone, email: s.rsaEmail, website: s.rsaWebsite });
  })
  .get('/public/policies/verify/:policyNumber', async (c) => {
    const ctx = { user: null, ip: clientIp(c), userAgent: c.req.header('user-agent') ?? null, origin: requestOrigin(c) };
    const res = await verifyPolicy(c.get('db'), ctx, c.req.param('policyNumber'));
    c.header('Cache-Control', 'no-store');
    return c.json(res, res.found ? 200 : 404);
  })
  // Dealer logos are referenced from certificates and the verification page, so they are public by id.
  .get('/files/:id', async (c) => {
    const r = uuid.safeParse(c.req.param('id'));
    if (!r.success) throw notFound('File');
    const f = await getFile(c.get('db'), r.data);
    if (!f || f.kind !== 'LOGO') throw notFound('File');
    return new Response(f.content as unknown as BodyInit, {
      headers: {
        'Content-Type': f.mime_type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
