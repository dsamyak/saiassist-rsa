// Long-running Node.js server: serves the API and the built web client. Used for local dev, Docker, Render, Railway, VPS.
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { createApp } from './app';
import { getDb } from './db';
import { env } from './env';

export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  frameSrc: ["'self'", 'blob:'],
  objectSrc: ["'self'", 'blob:'],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

const app = new Hono();
app.use('*', compress());
app.route('/', createApp());

const clientDir = path.resolve(process.env.CLIENT_DIST ?? 'dist/client');
const indexFile = path.join(clientDir, 'index.html');
if (fs.existsSync(indexFile)) {
  const root = path.relative(process.cwd(), clientDir) || '.';
  const indexHtml = fs.readFileSync(indexFile, 'utf8');
  app.use('*', secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY, referrerPolicy: 'strict-origin-when-cross-origin' }));
  app.use(
    '/assets/*',
    serveStatic({ root, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }),
  );
  app.use('*', serveStatic({ root }));
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
} else {
  console.warn(`[server] ${indexFile} not found - serving API only (run "npm run build" for the web client)`);
}

await getDb();
serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[server] RSA platform listening on http://localhost:${info.port} (db: ${env.databaseUrl ? 'postgres' : 'embedded pglite'})`);
});
