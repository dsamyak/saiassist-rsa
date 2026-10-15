import type { Queryable } from '../db';
import type { AnonCtx, Ctx } from '../context';

const SENSITIVE = new Set(['password', 'password_hash', 'passwordHash', 'token', 'token_hash', 'content']);

function scrub(v: unknown): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(scrub);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE.has(k)) continue;
      if (val instanceof Uint8Array) continue;
      out[k] = scrub(val);
    }
    return out;
  }
  return v;
}

/** Returns only the keys whose values differ, as { old, new } objects suitable for the audit trail. */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (SENSITIVE.has(key) || key === 'updated_at') continue;
    const a = before?.[key] instanceof Date ? before[key].toISOString() : before?.[key];
    const b = after[key] instanceof Date ? after[key].toISOString() : after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValue[key] = a ?? null;
      newValue[key] = b ?? null;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}

export interface AuditEntry {
  action: string;
  dealerId?: string | null;
  entityType?: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  result?: 'SUCCESS' | 'FAILURE';
  message?: string | null;
  /** Overrides the acting user (e.g. failed logins). */
  actor?: { id: string | null; name: string | null; role: string | null };
}

export async function audit(q: Queryable, ctx: Ctx | AnonCtx, e: AuditEntry) {
  const actor = e.actor ?? (ctx.user ? { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role } : null);
  await q.query(
    `INSERT INTO audit_logs (dealer_id, user_id, user_name, user_role, action, entity_type, entity_id, entity_label,
       old_value, new_value, result, message, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)`,
    [
      e.dealerId ?? (ctx.user ? ctx.user.dealerId : null),
      actor?.id ?? null,
      actor?.name ?? null,
      actor?.role ?? null,
      e.action,
      e.entityType ?? null,
      e.entityId ?? null,
      e.entityLabel ?? null,
      e.oldValue === undefined ? null : JSON.stringify(scrub(e.oldValue)),
      e.newValue === undefined ? null : JSON.stringify(scrub(e.newValue)),
      e.result ?? 'SUCCESS',
      e.message ?? null,
      ctx.ip,
      ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
    ],
  );
}
