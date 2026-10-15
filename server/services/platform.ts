import type { Db } from '../db';
import type { Ctx } from '../context';
import { audit, diff } from '../lib/audit';
import { badRequest } from '../lib/errors';
import { policyFormatProblem } from '../lib/policyNumber';
import { validationError } from '../lib/validate';
import { renderCertificatePdf } from '../pdf/certificate';
import { sampleSnapshot } from '../pdf/sample';
import { getFile } from './files';
import { getPlatformSettings, mergeSettings, type PlatformSettings } from './settings';
import { ZodError } from 'zod';

function merged(current: PlatformSettings, patch: unknown) {
  try {
    return mergeSettings(current, patch);
  } catch (e) {
    if (e instanceof ZodError) throw validationError(e);
    throw e;
  }
}

export async function updatePlatformSettings(db: Db, ctx: Ctx, patch: unknown) {
  return db.tx(async (q) => {
    const current = await getPlatformSettings(q);
    const next = merged(current, patch);
    const problem = policyFormatProblem(next.policyNumberFormat);
    if (problem) throw badRequest(problem);
    await q.query(
      `INSERT INTO platform_settings (id, data, updated_by, updated_at) VALUES (1, $1::jsonb, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(next), ctx.user.id],
    );
    const d = diff(current, next);
    if (d.changed) {
      await audit(q, ctx, {
        action: 'SETTINGS_UPDATED',
        dealerId: null,
        entityType: 'settings',
        entityId: 'platform',
        entityLabel: 'Platform settings',
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    return next;
  });
}

/** Renders a sample certificate with fictional data using (optionally unsaved) settings and dealer branding. */
export async function templatePreview(
  db: Db,
  opts: { patch?: unknown; dealer?: any | null },
): Promise<Uint8Array> {
  const current = await getPlatformSettings(db);
  const settings = opts.patch ? merged(current, opts.patch) : current;
  const d = opts.dealer;
  const snap = sampleSnapshot(
    settings,
    d
      ? {
          id: d.id,
          code: d.dealer_code,
          name: d.dealer_name,
          legalName: d.legal_name,
          logoFileId: d.logo_file_id,
          issuerName: d.issuer_name || d.legal_name || d.dealer_name,
          servicingOffice: d.servicing_office || [d.address, d.city, d.state, d.pincode].filter(Boolean).join(', ') || settings.defaultServicingOffice,
          gstin: d.gstin,
          rsaPhone: d.rsa_phone || settings.rsaPhone,
          rsaEmail: d.rsa_email || settings.rsaEmail,
          rsaWebsite: d.rsa_website || settings.rsaWebsite,
        }
      : undefined,
  );
  if (d) {
    snap.conditions = [settings.standardConditions, d.allow_custom_conditions ? d.dealer_conditions : null].filter(Boolean).join(' ');
  }
  const logo = d?.logo_file_id ? await getFile(db, d.logo_file_id) : null;
  return renderCertificatePdf(snap, {
    logo: logo ? { bytes: logo.content, mimeType: logo.mime_type } : null,
    watermark: { text: 'SAMPLE', color: [0.45, 0.45, 0.45] },
  });
}
