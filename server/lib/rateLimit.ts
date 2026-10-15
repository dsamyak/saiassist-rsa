import type { Queryable } from '../db';
import { tooManyRequests } from './errors';

/**
 * Fixed-window rate limiter stored in the database so it works across serverless instances.
 * Returns the number of hits in the current window.
 */
export async function hit(q: Queryable, key: string, windowSeconds: number): Promise<number> {
  const { rows } = await q.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::int) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSeconds],
  );
  if (Math.random() < 0.02) {
    await q.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  }
  return rows[0].count;
}

export async function enforceRateLimit(q: Queryable, key: string, limit: number, windowSeconds: number, message?: string) {
  const count = await hit(q, key, windowSeconds);
  if (count > limit) throw tooManyRequests(message);
}
