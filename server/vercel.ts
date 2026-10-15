// Vercel serverless entry (Build Output API, Node.js launcher). Static files are served by Vercel's CDN.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createApp } from './app';

const listener = getRequestListener(createApp().fetch);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // The routing layer rewrites /api/<path> to this function as /api?__path=<path>; restore the original path
  // so the API router sees exactly what the browser requested (works whether or not the platform keeps it).
  const url = new URL(req.url ?? '/', 'http://internal');
  const path = url.searchParams.get('__path');
  if (path !== null) {
    url.searchParams.delete('__path');
    const qs = url.searchParams.toString();
    req.url = `/api/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
  }
  return listener(req, res);
}
