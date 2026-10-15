import type { Queryable } from '../db';
import { istParts } from './dates';

const TOKEN_RE = /\{(PREFIX|DEALER|YYYY|YY|MM|DD|SEQ)(?::(\d{1,2}))?\}/g;

/** Returns an error message when the format is unusable, otherwise null. */
export function policyFormatProblem(format: string): string | null {
  if (!format || format.length > 60) return 'Format must be 1-60 characters';
  if (!/\{SEQ(?::\d{1,2})?\}/.test(format)) return 'Format must contain a {SEQ} or {SEQ:n} token';
  const literal = format.replace(TOKEN_RE, '');
  if (/[{}]/.test(literal)) return 'Unknown token. Allowed: {PREFIX} {DEALER} {YYYY} {YY} {MM} {DD} {SEQ:n}';
  if (!/^[A-Za-z0-9\-_]*$/.test(literal)) return 'Only letters, digits, "-" and "_" are allowed outside tokens';
  return null;
}

export function renderPolicyNumber(
  format: string,
  v: { prefix: string; dealerCode: string; date: Date; seq: number },
): string {
  const p = istParts(v.date);
  return format
    .replace(TOKEN_RE, (_m, token: string, width?: string) => {
      switch (token) {
        case 'PREFIX':
          return v.prefix;
        case 'DEALER':
          return v.dealerCode;
        case 'YYYY':
          return String(p.year);
        case 'YY':
          return String(p.year).slice(-2);
        case 'MM':
          return String(p.month).padStart(2, '0');
        case 'DD':
          return String(p.day).padStart(2, '0');
        case 'SEQ':
          return String(v.seq).padStart(width ? Number(width) : 6, '0');
        default:
          return '';
      }
    })
    .toUpperCase();
}

interface DealerNumbering {
  id: string;
  dealer_code: string;
  policy_prefix: string | null;
  policy_number_format: string | null;
}

interface PlatformNumbering {
  policyPrefix: string;
  policyNumberFormat: string;
  policySequenceStart: number;
}

/**
 * Allocates the next certificate number inside the caller's transaction. Dealers with their own format use a
 * dealer-scoped sequence; everyone else shares the platform sequence so numbers never collide.
 */
export async function allocatePolicyNumber(
  q: Queryable,
  dealer: DealerNumbering,
  platform: PlatformNumbering,
  now = new Date(),
): Promise<string> {
  const custom = !!dealer.policy_number_format;
  const format = dealer.policy_number_format || platform.policyNumberFormat;
  const prefix = dealer.policy_prefix || platform.policyPrefix;
  const scope = custom ? `dealer:${dealer.id}` : 'platform';
  const start = Math.max(1, Math.floor(platform.policySequenceStart || 1));
  for (let attempt = 0; attempt < 10; attempt++) {
    const { rows } = await q.query<{ last_value: number }>(
      `INSERT INTO policy_sequences (scope, last_value) VALUES ($1, $2)
       ON CONFLICT (scope) DO UPDATE SET last_value = policy_sequences.last_value + 1, updated_at = now()
       RETURNING last_value`,
      [scope, start],
    );
    const number = renderPolicyNumber(format, { prefix, dealerCode: dealer.dealer_code, date: now, seq: rows[0].last_value });
    const exists = await q.query('SELECT 1 FROM policies WHERE policy_number = $1', [number]);
    if (exists.rows.length === 0) return number;
  }
  throw new Error('Unable to allocate a unique certificate number; check the numbering format');
}
