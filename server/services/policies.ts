import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { AnonCtx, Ctx } from '../context';
import { audit } from '../lib/audit';
import {
  addDaysToDateString,
  coveragePeriod,
  formatDateString,
  formatIstDate,
  istDateString,
  istRange,
  isValidDateString,
} from '../lib/dates';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { maskMiddle, maskName } from '../lib/mask';
import { allocatePolicyNumber } from '../lib/policyNumber';
import { enforceRateLimit } from '../lib/rateLimit';
import { email, identifier, isoDate, mobile, optional, pagination, pincode, text, uuid } from '../lib/validate';
import { PAYMENT_METHOD_VALUES, POLICY_STATUSES, vehicleTypeLabel } from '../../shared/constants';
import { assertCan, can, dealerScope, requireDealer } from '../middleware/auth';
import { renderCertificatePdf, stampPdf, type CertificateSnapshot, type RenderOptions } from '../pdf/certificate';
import { loadCustomer, loadVehicle } from './customers';
import { fileUrl, getFile } from './files';
import { paginate, toCancellation, toPayment, toPolicyListItem } from './mappers';
import { notifyPolicyIssued } from './notifications';
import { checkEligibility, getDealerProduct } from './products';
import { effectiveStatusSql, statusConditionSql } from './policySql';
import { getPlatformSettings, type PlatformSettings } from './settings';
import { sha256 } from '../lib/security';
import { env } from '../env';

// ---------------------------------------------------------------- schemas

export const policyDraftSchema = z.object({
  customerId: uuid,
  vehicleId: uuid,
  productId: uuid,
  termId: uuid,
  startDate: optional(isoDate),
  renewalOfPolicyId: optional(uuid),
});
export type PolicyDraftInput = z.infer<typeof policyDraftSchema>;

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHOD_VALUES),
  status: z.enum(['SUCCESS', 'PENDING']),
  transactionId: optional(z.string().max(80)),
  paidAt: optional(z.string().datetime({ offset: true })),
  notes: optional(z.string().max(300)),
});

export const issueSchema = policyDraftSchema.extend({
  draftId: optional(uuid),
  payment: paymentSchema,
});
export type IssueInput = z.infer<typeof issueSchema>;

export const saveDraftSchema = policyDraftSchema.extend({ draftId: optional(uuid) });

export const renewSchema = z.object({
  productId: uuid,
  termId: uuid,
  startDate: optional(isoDate),
  draftId: optional(uuid),
  payment: paymentSchema,
});

export const cancelSchema = z.object({
  reason: text('Cancellation reason', 500),
  refundAmount: z.number().min(0).default(0),
  refundReference: optional(z.string().max(80)),
  requestId: optional(uuid),
});

export const cancelRequestSchema = z.object({ reason: text('Cancellation reason', 500) });
export const decisionSchema = z.object({ notes: optional(z.string().max(500)) });
export const reasonSchema = z.object({ reason: text('Reason', 500) });

export const endorseSchema = z.object({
  registrationNo: optional(identifier('Registration number', 4, 12)).optional(),
  mobile: mobile.optional(),
  email: optional(email).optional(),
  address: text('Address', 300).optional(),
  city: text('City', 80).optional(),
  state: text('State', 80).optional(),
  pincode: pincode.optional(),
  reason: text('Reason', 300),
});

export const paymentUpdateSchema = z.object({
  status: z.enum(['SUCCESS', 'FAILED']),
  method: z.enum(PAYMENT_METHOD_VALUES).optional(),
  transactionId: optional(z.string().max(80)),
  paidAt: optional(z.string().datetime({ offset: true })),
  notes: optional(z.string().max(300)),
});

export const policyListQuery = z.object({
  q: optional(z.string().max(100)),
  field: optional(z.enum(['policyNumber', 'customerName', 'mobile', 'registrationNo', 'chassisNo', 'engineNo'])),
  status: optional(z.enum([...POLICY_STATUSES, 'IN_FORCE', 'ALL'])),
  productId: optional(uuid),
  dealerId: optional(uuid),
  customerId: optional(uuid),
  vehicleId: optional(uuid),
  issuedBy: optional(uuid),
  from: optional(isoDate),
  to: optional(isoDate),
  dateField: optional(z.enum(['issued', 'start', 'end'])),
  ...pagination,
});
export type PolicyListQuery = z.infer<typeof policyListQuery>;

// ---------------------------------------------------------------- helpers

const PAYMENT_REF_REQUIRED = ['UPI', 'CARD', 'NET_BANKING', 'CHEQUE'];
const SYSTEM_CTX: AnonCtx = { user: null, ip: null, userAgent: 'system', origin: '' };

function validatePayment(p: { method: string; status: string; transactionId?: string | null; paidAt?: string | null }) {
  if (p.status === 'SUCCESS' && PAYMENT_REF_REQUIRED.includes(p.method) && !p.transactionId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Enter the transaction / reference number for this payment', {
      fields: { 'payment.transactionId': 'Transaction reference is required' },
    });
  }
  if (p.paidAt && new Date(p.paidAt).getTime() > Date.now() + 5 * 60_000) throw badRequest('Payment date cannot be in the future');
}

function assertCanQuote(ctx: Ctx) {
  if (!['policies.quote', 'policies.issue', 'policies.renew'].some((p) => can(ctx.user, p))) throw forbidden();
}

function assertCanViewPolicy(ctx: Ctx) {
  if (!['policies.view', 'policies.issue', 'policies.renew'].some((p) => can(ctx.user, p))) throw forbidden();
}

async function loadDealerRow(q: Queryable, dealerId: string) {
  const { rows } = await q.query('SELECT * FROM dealers WHERE id = $1', [dealerId]);
  if (!rows[0]) throw notFound('Dealer');
  if (rows[0].status !== 'ACTIVE') throw forbidden('This dealer workspace is inactive');
  return rows[0];
}

async function loadPolicyRow(q: Queryable, scope: string | null, id: string, forUpdate = false) {
  const { rows } = await q.query(
    `SELECT * FROM policies WHERE id = $1 AND ($2::uuid IS NULL OR dealer_id = $2) ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id, scope],
  );
  if (!rows[0]) throw notFound('Policy');
  return rows[0];
}

async function loadRenewable(q: Queryable, dealerId: string, id: string) {
  const p = await loadPolicyRow(q, dealerId, id, true);
  if (p.renewed_to_policy_id || p.status === 'RENEWED') throw conflict('This policy has already been renewed');
  if (p.status !== 'ACTIVE') throw conflict(`Only active or expired policies can be renewed (current status: ${p.status})`);
  return p;
}

async function loadDraft(q: Queryable, dealerId: string, id: string) {
  const p = await loadPolicyRow(q, dealerId, id, true);
  if (p.status !== 'DRAFT') throw conflict('This quotation has already been issued');
  return p;
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

export interface IssuanceContext {
  dealer: any;
  platform: PlatformSettings;
  customer: any;
  vehicle: any;
  product: Awaited<ReturnType<typeof getDealerProduct>>;
  term: Awaited<ReturnType<typeof getDealerProduct>>['terms'][number];
  premium: { basePremium: number; gstRate: number; gstAmount: number; totalPremium: number };
  startDate: string;
  start: Date;
  end: Date;
  conditions: string;
  renewalOf: any | null;
}

/** Validates the full issuance request against the dealer's own data and configuration. */
async function buildContext(q: Queryable, dealerId: string, input: PolicyDraftInput, now = new Date()): Promise<IssuanceContext> {
  const dealer = await loadDealerRow(q, dealerId);
  const platform = await getPlatformSettings(q);
  let renewalOf: any = null;
  if (input.renewalOfPolicyId) {
    renewalOf = await loadRenewable(q, dealerId, input.renewalOfPolicyId);
    if (renewalOf.customer_id !== input.customerId || renewalOf.vehicle_id !== input.vehicleId) {
      throw badRequest('A renewal must be for the same customer and vehicle');
    }
  }
  const customer = await loadCustomer(q, dealerId, input.customerId);
  const vehicle = await loadVehicle(q, dealerId, input.vehicleId);
  if (vehicle.customer_id !== customer.id) throw badRequest('The selected vehicle does not belong to this customer');
  const product = await getDealerProduct(q, dealerId, input.productId);
  const term = product.terms.find((t) => t.id === input.termId);
  if (!term) throw badRequest('Select a valid validity option for this plan');
  const elig = checkEligibility(product, vehicle, now);
  if (!elig.eligible) throw badRequest(`This vehicle is not eligible for ${product.planName}: ${elig.reasons.join('; ')}`);

  const today = istDateString(now);
  const earliest = renewalOf ? maxDate(today, istDateString(new Date(new Date(renewalOf.end_date).getTime() + 1000))) : today;
  const startDate = input.startDate ?? earliest;
  if (!isValidDateString(startDate)) throw badRequest('Start date is not a valid date');
  if (startDate < earliest) {
    throw badRequest(renewalOf ? `Renewal cover can start from ${formatDateString(earliest)}` : 'Certificate start date cannot be in the past');
  }
  const latest = addDaysToDateString(earliest, platform.maxFutureStartDays);
  if (startDate > latest) throw badRequest(`Start date can be at most ${platform.maxFutureStartDays} days ahead (${formatDateString(latest)})`);
  const { start, end } = coveragePeriod(startDate, term.validityUnit, term.validityValue);
  const conditions = [platform.standardConditions, product.specialConditions, dealer.allow_custom_conditions ? dealer.dealer_conditions : null]
    .filter(Boolean)
    .join(' ');
  return { dealer, platform, customer, vehicle, product, term, premium: term.premium!, startDate, start, end, conditions, renewalOf };
}

export function buildSnapshot(
  ic: IssuanceContext,
  extra: { policyNumber: string | null; issuedAt: Date | null; origin: string },
): CertificateSnapshot {
  const { dealer: d, platform: p, customer: c, vehicle: v, product: pr } = ic;
  const officeFallback = [d.address, d.city, [d.state, d.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return {
    version: 1,
    platformName: p.platformName,
    policyNumber: extra.policyNumber,
    issuedAt: extra.issuedAt ? extra.issuedAt.toISOString() : null,
    startDate: ic.start.toISOString(),
    endDate: ic.end.toISOString(),
    dealer: {
      id: d.id,
      code: d.dealer_code,
      name: d.dealer_name,
      legalName: d.legal_name,
      logoFileId: d.logo_file_id,
      issuerName: d.issuer_name || d.legal_name || d.dealer_name,
      servicingOffice: d.servicing_office || officeFallback || p.defaultServicingOffice,
      gstin: d.gstin,
      rsaPhone: d.rsa_phone || p.rsaPhone,
      rsaEmail: d.rsa_email || p.rsaEmail,
      rsaWebsite: d.rsa_website || p.rsaWebsite,
    },
    customer: { name: c.name, dob: c.dob, mobile: c.mobile, email: c.email, address: c.address, city: c.city, state: c.state, pincode: c.pincode },
    vehicle: {
      registrationNo: v.registration_no,
      vehicleType: v.vehicle_type,
      make: v.make,
      model: v.model,
      variant: v.variant,
      engineNo: v.engine_no,
      chassisNo: v.chassis_no,
      fuelType: v.fuel_type,
      manufacturingYear: v.manufacturing_year,
    },
    plan: {
      productId: pr.id,
      productCode: pr.productCode,
      planName: pr.planName,
      certificatePlanName: pr.certificatePlanName || pr.planName,
      termLabel: ic.term.label,
      numberOfServices: pr.numberOfServices,
      benefits: pr.benefits.map((b) => ({ name: b.name, description: b.description, applicable: b.applicableText || (b.isApplicable ? 'Yes' : 'No') })),
    },
    premium: ic.premium,
    conditions: ic.conditions,
    template: p.certificate,
    verifyUrl: extra.policyNumber ? `${extra.origin}/verify/${encodeURIComponent(extra.policyNumber)}` : null,
  };
}

async function writePolicy(
  q: Queryable,
  ic: IssuanceContext,
  w: { status: string; policyNumber: string | null; snapshot: CertificateSnapshot; userId: string; issuedAt: Date | null; draftId?: string | null },
) {
  const values = [
    ic.dealer.id,
    ic.customer.id,
    ic.vehicle.id,
    ic.product.id,
    ic.term.id,
    ic.product.planName,
    ic.start,
    ic.end,
    ic.premium.basePremium,
    ic.premium.gstRate,
    ic.premium.gstAmount,
    ic.premium.totalPremium,
    ic.product.numberOfServices,
    w.status,
    JSON.stringify(w.snapshot),
    w.policyNumber,
    w.issuedAt ? w.userId : null,
    w.issuedAt,
    ic.renewalOf?.id ?? null,
  ];
  if (w.draftId) {
    const { rows } = await q.query(
      `UPDATE policies SET customer_id = $2, vehicle_id = $3, product_id = $4, term_id = $5, plan_name = $6, start_date = $7,
         end_date = $8, base_premium = $9, gst_rate = $10, gst_amount = $11, total_premium = $12, number_of_services = $13,
         status = $14, snapshot = $15::jsonb, policy_number = $16, issued_by = $17, issued_at = $18, renewed_from_policy_id = $19,
         updated_at = now()
       WHERE id = $20 AND dealer_id = $1 AND status = 'DRAFT' RETURNING *`,
      [...values, w.draftId],
    );
    if (!rows[0]) throw conflict('This quotation has already been issued');
    return rows[0];
  }
  const { rows } = await q.query(
    `INSERT INTO policies (dealer_id, customer_id, vehicle_id, product_id, term_id, plan_name, start_date, end_date, base_premium,
       gst_rate, gst_amount, total_premium, number_of_services, status, snapshot, policy_number, issued_by, issued_at,
       renewed_from_policy_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20) RETURNING *`,
    [...values, w.userId],
  );
  return rows[0];
}

async function overlapping(q: Queryable, dealerId: string, vehicleId: string, start: Date, exceptId?: string | null) {
  const { rows } = await q.query(
    `SELECT policy_number, end_date FROM policies
      WHERE dealer_id = $1 AND vehicle_id = $2 AND status IN ('ACTIVE', 'PAYMENT_PENDING') AND end_date >= $3
        AND ($4::uuid IS NULL OR id <> $4)
      ORDER BY end_date DESC LIMIT 1`,
    [dealerId, vehicleId, start, exceptId ?? null],
  );
  return rows[0] ?? null;
}

const overlapMessage = (o: { policy_number: string; end_date: Date }) =>
  `This vehicle already has RSA cover ${o.policy_number} valid till ${formatIstDate(o.end_date)}. Use Renew to extend the cover.`;

/** Seeded/imported policies may carry a relative verification link; resolve it against the serving origin. */
function withAbsoluteVerifyUrl(s: CertificateSnapshot, origin?: string): CertificateSnapshot {
  if (!s.verifyUrl || /^https?:\/\//i.test(s.verifyUrl)) return s;
  const base = origin || env.publicBaseUrl;
  return { ...s, verifyUrl: base ? `${base}${s.verifyUrl}` : null };
}

async function renderSnapshot(
  q: Queryable,
  snapshot: CertificateSnapshot,
  opts: Omit<RenderOptions, 'logo'> & { origin?: string } = {},
) {
  const logo = snapshot.dealer.logoFileId ? await getFile(q, snapshot.dealer.logoFileId) : null;
  return renderCertificatePdf(withAbsoluteVerifyUrl(snapshot, opts.origin), {
    ...opts,
    logo: logo ? { bytes: logo.content, mimeType: logo.mime_type } : null,
  });
}

async function storeDocument(
  q: Queryable,
  p: { id: string; dealer_id: string },
  version: number,
  reason: string,
  original: CertificateSnapshot,
  userId: string | null,
  origin?: string,
) {
  const generatedAt = new Date();
  const snapshot = withAbsoluteVerifyUrl(original, origin);
  const bytes = await renderSnapshot(q, snapshot, { generatedAt });
  await q.query(
    `INSERT INTO policy_documents (policy_id, dealer_id, version, reason, content, sha256, size_bytes, snapshot, generated_by, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT (policy_id, version) DO NOTHING`,
    [p.id, p.dealer_id, version, reason, Buffer.from(bytes), sha256(bytes), bytes.length, JSON.stringify(snapshot), userId, generatedAt],
  );
  return bytes;
}

/** Generates and stores the issued certificate once; later downloads return the preserved original. */
export async function ensureCertificateDocument(q: Queryable, policyId: string, ctx: Ctx | null) {
  const { rows } = await q.query('SELECT id, dealer_id, policy_number, snapshot, document_version, status FROM policies WHERE id = $1', [
    policyId,
  ]);
  const p = rows[0];
  if (!p) throw notFound('Policy');
  if (p.document_version === 0) {
    await storeDocument(q, p, 1, 'ISSUED', p.snapshot, ctx?.user.id ?? null, ctx?.origin);
    await q.query('UPDATE policies SET document_version = 1 WHERE id = $1 AND document_version = 0', [policyId]);
    await audit(q, ctx ?? SYSTEM_CTX, {
      action: 'CERTIFICATE_GENERATED',
      dealerId: p.dealer_id,
      entityType: 'policy',
      entityId: policyId,
      entityLabel: p.policy_number,
      newValue: { version: 1 },
    });
  }
  const { rows: docs } = await q.query<{ content: Uint8Array; version: number; sha256: string }>(
    `SELECT content, version, sha256 FROM policy_documents WHERE policy_id = $1 ORDER BY version DESC LIMIT 1`,
    [policyId],
  );
  return { ...docs[0], content: new Uint8Array(docs[0].content) };
}

async function afterActivation(db: Db, ctx: Ctx, policyId: string) {
  try {
    await ensureCertificateDocument(db, policyId, ctx);
  } catch (e) {
    console.error('[certificate] generation failed', (e as Error).message);
  }
  try {
    await notifyPolicyIssued(db, policyId);
  } catch (e) {
    console.error('[notify] failed', (e as Error).message);
  }
}

// ---------------------------------------------------------------- quote / preview / drafts

export async function quotePolicy(db: Db, ctx: Ctx, input: PolicyDraftInput) {
  assertCanQuote(ctx);
  const dealerId = requireDealer(ctx);
  const ic = await buildContext(db, dealerId, input);
  const overlap = ic.renewalOf ? null : await overlapping(db, dealerId, ic.vehicle.id, ic.start);
  return {
    productId: ic.product.id,
    productCode: ic.product.productCode,
    planName: ic.product.planName,
    certificatePlanName: ic.product.certificatePlanName || ic.product.planName,
    termId: ic.term.id,
    termLabel: ic.term.label,
    startDate: ic.start.toISOString(),
    endDate: ic.end.toISOString(),
    startDateInput: ic.startDate,
    numberOfServices: ic.product.numberOfServices,
    priceIncludesGst: ic.product.priceIncludesGst,
    ...ic.premium,
    benefits: ic.product.benefits,
    warning: overlap ? overlapMessage(overlap) : null,
  };
}

export async function previewPolicyPdf(db: Db, ctx: Ctx, input: PolicyDraftInput) {
  assertCanQuote(ctx);
  const dealerId = requireDealer(ctx);
  const ic = await buildContext(db, dealerId, input);
  const snapshot = buildSnapshot(ic, { policyNumber: null, issuedAt: null, origin: ctx.origin });
  return renderSnapshot(db, snapshot, { watermark: { text: 'PREVIEW', color: [0.45, 0.45, 0.45] }, placeholderNumber: 'PREVIEW' });
}

export async function saveDraft(db: Db, ctx: Ctx, input: z.infer<typeof saveDraftSchema>) {
  assertCan(ctx, 'policies.quote');
  const dealerId = requireDealer(ctx);
  const id = await db.tx(async (q) => {
    if (input.draftId) await loadDraft(q, dealerId, input.draftId);
    const ic = await buildContext(q, dealerId, input);
    const snapshot = buildSnapshot(ic, { policyNumber: null, issuedAt: null, origin: ctx.origin });
    const row = await writePolicy(q, ic, { status: 'DRAFT', policyNumber: null, snapshot, userId: ctx.user.id, issuedAt: null, draftId: input.draftId });
    await audit(q, ctx, {
      action: 'POLICY_DRAFT_SAVED',
      entityType: 'policy',
      entityId: row.id,
      entityLabel: `Quotation for ${ic.customer.name}`,
      newValue: { plan: ic.product.planName, term: ic.term.label, premium: ic.premium },
    });
    return row.id as string;
  });
  return getPolicy(db, ctx, id);
}

export async function deleteDraft(db: Db, ctx: Ctx, id: string) {
  assertCan(ctx, 'policies.quote');
  const dealerId = requireDealer(ctx);
  await db.tx(async (q) => {
    const d = await loadDraft(q, dealerId, id);
    await q.query(`DELETE FROM policies WHERE id = $1 AND status = 'DRAFT'`, [id]);
    await audit(q, ctx, {
      action: 'POLICY_DRAFT_DELETED',
      entityType: 'policy',
      entityId: id,
      entityLabel: `Quotation (${d.plan_name})`,
      oldValue: { plan: d.plan_name, total: d.total_premium },
    });
  });
}

// ---------------------------------------------------------------- issue / renew

export async function issuePolicy(db: Db, ctx: Ctx, input: IssueInput) {
  assertCan(ctx, input.renewalOfPolicyId ? 'policies.renew' : 'policies.issue');
  const dealerId = requireDealer(ctx);
  validatePayment(input.payment);
  const res = await db.tx(async (q) => {
    if (input.draftId) await loadDraft(q, dealerId, input.draftId);
    const ic = await buildContext(q, dealerId, input);
    const overlap = await overlapping(q, dealerId, ic.vehicle.id, ic.start, input.draftId);
    if (overlap) throw conflict(overlapMessage(overlap), { policyNumber: overlap.policy_number });
    const now = new Date();
    const policyNumber = await allocatePolicyNumber(q, ic.dealer, ic.platform, now);
    const status = input.payment.status === 'SUCCESS' ? 'ACTIVE' : 'PAYMENT_PENDING';
    const snapshot = buildSnapshot(ic, { policyNumber, issuedAt: now, origin: ctx.origin });
    const row = await writePolicy(q, ic, { status, policyNumber, snapshot, userId: ctx.user.id, issuedAt: now, draftId: input.draftId });
    const pay = input.payment;
    const { rows: pm } = await q.query(
      `INSERT INTO payments (dealer_id, policy_id, amount, gst_amount, total_amount, payment_method, transaction_id, status, paid_at, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
      [
        dealerId,
        row.id,
        ic.premium.basePremium,
        ic.premium.gstAmount,
        ic.premium.totalPremium,
        pay.method,
        pay.transactionId,
        pay.status,
        pay.status === 'SUCCESS' ? (pay.paidAt ? new Date(pay.paidAt) : now) : null,
        pay.notes,
        ctx.user.id,
      ],
    );
    if (ic.renewalOf) {
      await q.query(`UPDATE policies SET status = 'RENEWED', renewed_to_policy_id = $2, updated_at = now() WHERE id = $1`, [
        ic.renewalOf.id,
        row.id,
      ]);
      await audit(q, ctx, {
        action: 'POLICY_RENEWED',
        entityType: 'policy',
        entityId: ic.renewalOf.id,
        entityLabel: ic.renewalOf.policy_number,
        oldValue: { status: ic.renewalOf.status },
        newValue: { status: 'RENEWED', renewedTo: policyNumber },
      });
    }
    await audit(q, ctx, {
      action: 'POLICY_ISSUED',
      entityType: 'policy',
      entityId: row.id,
      entityLabel: policyNumber,
      newValue: {
        policyNumber,
        status,
        plan: ic.product.planName,
        term: ic.term.label,
        customer: ic.customer.name,
        vehicle: `${ic.vehicle.make} ${ic.vehicle.model} ${ic.vehicle.registration_no ?? 'New'}`,
        startDate: ic.start.toISOString(),
        endDate: ic.end.toISOString(),
        premium: ic.premium,
        renewalOf: ic.renewalOf?.policy_number ?? null,
      },
    });
    await audit(q, ctx, {
      action: 'PAYMENT_RECORDED',
      entityType: 'payment',
      entityId: pm[0].id,
      entityLabel: policyNumber,
      newValue: { method: pay.method, status: pay.status, total: ic.premium.totalPremium, transactionId: pay.transactionId },
    });
    return { id: row.id as string, status };
  });
  if (res.status === 'ACTIVE') await afterActivation(db, ctx, res.id);
  return getPolicy(db, ctx, res.id);
}

export async function renewPolicy(db: Db, ctx: Ctx, oldId: string, input: z.infer<typeof renewSchema>) {
  const dealerId = requireDealer(ctx);
  const old = await loadPolicyRow(db, dealerId, oldId);
  return issuePolicy(db, ctx, { ...input, customerId: old.customer_id, vehicleId: old.vehicle_id, renewalOfPolicyId: oldId });
}

// ---------------------------------------------------------------- read

const LIST_SELECT = (expDays: number) => `
  SELECT p.*, ${effectiveStatusSql('p', expDays)} AS effective_status,
         d.dealer_name, c.name AS customer_name, c.mobile AS customer_mobile,
         v.registration_no, v.make, v.model, v.chassis_no, v.engine_no, ui.name AS issued_by_name
    FROM policies p
    JOIN dealers d ON d.id = p.dealer_id
    JOIN customers c ON c.id = p.customer_id
    JOIN vehicles v ON v.id = p.vehicle_id
    LEFT JOIN users ui ON ui.id = p.issued_by`;

function buildListFilters(f: PolicyListQuery, scope: string | null, expDays: number) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (scope) where.push(`p.dealer_id = ${add(scope)}`);
  if (f.status && f.status !== 'ALL') where.push(statusConditionSql('p', f.status, expDays));
  else if (!f.status) where.push(`p.status <> 'DRAFT'`);
  if (f.q) {
    // Parameters are bound only when referenced, otherwise Postgres cannot infer their type.
    let like: string | null = null;
    let compact: string | null = null;
    const L = () => (like ??= add(`%${f.q!.trim()}%`));
    const C = () => (compact ??= add(`%${f.q!.replace(/[\s-]/g, '').toUpperCase()}%`));
    const by: Record<string, () => string> = {
      policyNumber: () => `p.policy_number ILIKE ${L()}`,
      customerName: () => `c.name ILIKE ${L()}`,
      mobile: () => `c.mobile LIKE ${L()}`,
      registrationNo: () => `v.registration_no LIKE ${C()}`,
      chassisNo: () => `v.chassis_no LIKE ${C()}`,
      engineNo: () => `v.engine_no LIKE ${C()}`,
    };
    where.push(f.field ? by[f.field]() : `(${Object.values(by).map((fn) => fn()).join(' OR ')})`);
  }
  if (f.productId) where.push(`p.product_id = ${add(f.productId)}`);
  if (f.customerId) where.push(`p.customer_id = ${add(f.customerId)}`);
  if (f.vehicleId) where.push(`p.vehicle_id = ${add(f.vehicleId)}`);
  if (f.issuedBy) where.push(`p.issued_by = ${add(f.issuedBy)}`);
  if (f.from || f.to) {
    const col = f.dateField === 'start' ? 'p.start_date' : f.dateField === 'end' ? 'p.end_date' : 'coalesce(p.issued_at, p.created_at)';
    const range = istRange(f.from ?? '2000-01-01', f.to ?? '2999-12-31');
    where.push(`${col} >= ${add(range.from)} AND ${col} < ${add(range.to)}`);
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listPolicies(q: Queryable, ctx: Ctx, f: PolicyListQuery) {
  assertCan(ctx, 'policies.view');
  const settings = await getPlatformSettings(q);
  const scope = dealerScope(ctx, f.dealerId);
  const { where, params } = buildListFilters(f, scope, settings.expiringSoonDays);
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await q.query(
    `SELECT x.*, count(*) OVER() AS total_count FROM (${LIST_SELECT(settings.expiringSoonDays)} ${where}) x
     ORDER BY coalesce(x.issued_at, x.created_at) DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paginate(rows.map(toPolicyListItem), rows[0]?.total_count ?? 0, f.page, f.pageSize);
}

export async function exportPolicies(q: Queryable, ctx: Ctx, f: PolicyListQuery) {
  assertCan(ctx, 'policies.view');
  const settings = await getPlatformSettings(q);
  const scope = dealerScope(ctx, f.dealerId);
  const { where, params } = buildListFilters(f, scope, settings.expiringSoonDays);
  const { rows } = await q.query(
    `SELECT x.* FROM (${LIST_SELECT(settings.expiringSoonDays)} ${where}) x ORDER BY coalesce(x.issued_at, x.created_at) DESC LIMIT 20000`,
    params,
  );
  return rows;
}

export async function getPolicy(q: Queryable, ctx: Ctx, id: string) {
  assertCanViewPolicy(ctx);
  const settings = await getPlatformSettings(q);
  const scope = dealerScope(ctx);
  const { rows } = await q.query(
    `SELECT x.*, t.label AS term_label, pr.product_code, rf.policy_number AS renewed_from_number, rt.policy_number AS renewed_to_number,
            uc.name AS created_by_name, d2.dealer_code
       FROM (${LIST_SELECT(settings.expiringSoonDays)} WHERE p.id = $1 AND ($2::uuid IS NULL OR p.dealer_id = $2)) x
       JOIN dealers d2 ON d2.id = x.dealer_id
       LEFT JOIN rsa_product_terms t ON t.id = x.term_id
       LEFT JOIN rsa_products pr ON pr.id = x.product_id
       LEFT JOIN policies rf ON rf.id = x.renewed_from_policy_id
       LEFT JOIN policies rt ON rt.id = x.renewed_to_policy_id
       LEFT JOIN users uc ON uc.id = x.created_by`,
    [id, scope],
  );
  const r = rows[0];
  if (!r) throw notFound('Policy');
  const payments = can(ctx.user, 'payments.view')
    ? (
        await q.query(
          `SELECT pm.*, u.name AS created_by_name FROM payments pm LEFT JOIN users u ON u.id = pm.created_by WHERE pm.policy_id = $1 ORDER BY pm.created_at`,
          [id],
        )
      ).rows.map(toPayment)
    : [];
  const cancellations = (
    await q.query(
      `SELECT pc.*, ur.name AS requested_by_name, ua.name AS approved_by_name FROM policy_cancellations pc
         LEFT JOIN users ur ON ur.id = pc.requested_by LEFT JOIN users ua ON ua.id = pc.approved_by
        WHERE pc.policy_id = $1 ORDER BY pc.requested_at DESC`,
      [id],
    )
  ).rows.map(toCancellation);
  const documents = (
    await q.query(
      `SELECT pd.id, pd.version, pd.reason, pd.sha256, pd.size_bytes, pd.generated_at, u.name AS generated_by_name
         FROM policy_documents pd LEFT JOIN users u ON u.id = pd.generated_by WHERE pd.policy_id = $1 ORDER BY pd.version DESC`,
      [id],
    )
  ).rows.map((d) => ({
    id: d.id,
    version: d.version,
    reason: d.reason,
    sha256: d.sha256,
    sizeBytes: d.size_bytes,
    generatedAt: d.generated_at,
    generatedByName: d.generated_by_name,
  }));
  const notifications = (await q.query('SELECT * FROM notifications WHERE policy_id = $1 ORDER BY created_at DESC', [id])).rows.map((n) => ({
    id: n.id,
    channel: n.channel,
    recipient: n.recipient,
    subject: n.subject,
    body: n.body,
    status: n.status,
    error: n.error,
    createdAt: n.created_at,
    sentAt: n.sent_at,
  }));
  const isDealerUser = ctx.user.role !== 'SUPER_ADMIN';
  const inForce = r.status === 'ACTIVE' && new Date(r.end_date) >= new Date();
  // Renewal is offered from 90 days before expiry (and any time after it) to avoid accidental early renewals.
  const renewalWindowOpen = new Date(r.end_date).getTime() - Date.now() <= 90 * 86400_000;
  const pendingRequest = cancellations.some((c) => c.status === 'REQUESTED');
  return {
    ...toPolicyListItem(r),
    dealerCode: r.dealer_code,
    termId: r.term_id,
    termLabel: r.term_label,
    productCode: r.product_code,
    gstRate: r.gst_rate,
    numberOfServices: r.number_of_services,
    documentVersion: r.document_version,
    snapshot: r.snapshot as CertificateSnapshot,
    createdByName: r.created_by_name,
    cancelledAt: r.cancelled_at,
    renewedFrom: r.renewed_from_policy_id ? { id: r.renewed_from_policy_id, policyNumber: r.renewed_from_number } : null,
    renewedTo: r.renewed_to_policy_id ? { id: r.renewed_to_policy_id, policyNumber: r.renewed_to_number } : null,
    payments,
    cancellations,
    documents,
    notifications,
    actions: {
      canDownload: can(ctx.user, 'policies.download'),
      canRenew: isDealerUser && can(ctx.user, 'policies.renew') && r.status === 'ACTIVE' && !r.renewed_to_policy_id && renewalWindowOpen,
      canCancel: can(ctx.user, 'policies.cancel') && ['ACTIVE', 'PAYMENT_PENDING', 'SUSPENDED'].includes(r.status),
      canRequestCancel:
        ctx.user.role === 'DEALER_EMPLOYEE' && can(ctx.user, 'policies.cancel_request') && ['ACTIVE', 'PAYMENT_PENDING'].includes(r.status) && !pendingRequest,
      canEndorse: isDealerUser && can(ctx.user, 'policies.endorse') && inForce,
      canRecordPayment: isDealerUser && can(ctx.user, 'payments.manage') && r.status === 'PAYMENT_PENDING',
      canSuspend: can(ctx.user, 'policies.cancel') && r.status === 'ACTIVE',
      canReinstate: can(ctx.user, 'policies.cancel') && r.status === 'SUSPENDED',
      canIssueDraft: isDealerUser && r.status === 'DRAFT' && can(ctx.user, 'policies.issue'),
      canDeleteDraft: isDealerUser && r.status === 'DRAFT' && can(ctx.user, 'policies.quote'),
      canNotify: isDealerUser && ['ACTIVE'].includes(r.status),
    },
  };
}

export async function getCertificatePdf(db: Db, ctx: Ctx, id: string) {
  assertCan(ctx, 'policies.download');
  const p = await loadPolicyRow(db, dealerScope(ctx), id);
  let bytes: Uint8Array;
  if (p.status === 'DRAFT') {
    bytes = await renderSnapshot(db, p.snapshot, {
      watermark: { text: 'QUOTATION - NOT A CERTIFICATE', color: [0.1, 0.3, 0.7] },
      placeholderNumber: 'QUOTATION',
      origin: ctx.origin,
    });
  } else if (p.status === 'PAYMENT_PENDING') {
    bytes = await renderSnapshot(db, p.snapshot, { watermark: { text: 'PAYMENT PENDING', color: [0.85, 0.45, 0] }, origin: ctx.origin });
  } else {
    bytes = (await ensureCertificateDocument(db, id, ctx)).content;
    if (p.status === 'CANCELLED') bytes = await stampPdf(bytes, 'CANCELLED', [0.85, 0.1, 0.1]);
    if (p.status === 'SUSPENDED') bytes = await stampPdf(bytes, 'SUSPENDED', [0.85, 0.45, 0]);
  }
  await audit(db, ctx, {
    action: 'CERTIFICATE_DOWNLOADED',
    dealerId: p.dealer_id,
    entityType: 'policy',
    entityId: id,
    entityLabel: p.policy_number ?? 'Quotation',
  });
  return { bytes, filename: `${p.policy_number ?? 'RSA-Quotation'}.pdf` };
}

/** Fetches a specific preserved document version (original issue or later endorsements). */
export async function getDocumentVersion(db: Db, ctx: Ctx, policyId: string, version: number) {
  assertCan(ctx, 'policies.download');
  const p = await loadPolicyRow(db, dealerScope(ctx), policyId);
  const { rows } = await db.query<{ content: Uint8Array }>('SELECT content FROM policy_documents WHERE policy_id = $1 AND version = $2', [
    policyId,
    version,
  ]);
  if (!rows[0]) throw notFound('Document version');
  await audit(db, ctx, {
    action: 'CERTIFICATE_DOWNLOADED',
    dealerId: p.dealer_id,
    entityType: 'policy',
    entityId: policyId,
    entityLabel: p.policy_number,
    message: `Version ${version}`,
  });
  return { bytes: new Uint8Array(rows[0].content), filename: `${p.policy_number}-v${version}.pdf` };
}

// ---------------------------------------------------------------- post-issuance changes

export async function endorsePolicy(db: Db, ctx: Ctx, id: string, input: z.infer<typeof endorseSchema>) {
  assertCan(ctx, 'policies.endorse');
  const dealerId = requireDealer(ctx);
  await db.tx(async (q) => {
    const p = await loadPolicyRow(q, dealerId, id, true);
    if (p.status !== 'ACTIVE' || new Date(p.end_date) < new Date()) throw conflict('Only policies currently in force can be endorsed');
    if (p.document_version === 0) {
      await storeDocument(q, p, 1, 'ISSUED', p.snapshot, ctx.user.id, ctx.origin);
      p.document_version = 1;
    }
    const snap: CertificateSnapshot = withAbsoluteVerifyUrl(JSON.parse(JSON.stringify(p.snapshot)), ctx.origin);
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    const apply = <T extends object>(path: string, obj: T, key: keyof T, value: unknown) => {
      if (value === undefined || (obj[key] ?? null) === value) return;
      oldValue[path] = obj[key] ?? null;
      newValue[path] = value;
      (obj as any)[key] = value;
    };
    apply('vehicle.registrationNo', snap.vehicle, 'registrationNo', input.registrationNo);
    apply('customer.mobile', snap.customer, 'mobile', input.mobile);
    apply('customer.email', snap.customer, 'email', input.email);
    apply('customer.address', snap.customer, 'address', input.address);
    apply('customer.city', snap.customer, 'city', input.city);
    apply('customer.state', snap.customer, 'state', input.state);
    apply('customer.pincode', snap.customer, 'pincode', input.pincode);
    if (!Object.keys(newValue).length) throw badRequest('Nothing to endorse - no field was changed');

    if ('vehicle.registrationNo' in newValue) {
      await q.query('UPDATE vehicles SET registration_no = $2, updated_by = $3, updated_at = now() WHERE id = $1', [
        p.vehicle_id,
        snap.vehicle.registrationNo,
        ctx.user.id,
      ]);
    }
    if (Object.keys(newValue).some((k) => k.startsWith('customer.'))) {
      const c = snap.customer;
      await q.query(
        `UPDATE customers SET mobile = $2, email = $3, address = $4, city = $5, state = $6, pincode = $7, updated_by = $8, updated_at = now() WHERE id = $1`,
        [p.customer_id, c.mobile, c.email, c.address, c.city, c.state, c.pincode, ctx.user.id],
      );
    }
    const version = p.document_version + 1;
    await storeDocument(q, p, version, 'ENDORSEMENT', snap, ctx.user.id, ctx.origin);
    await q.query('UPDATE policies SET snapshot = $2::jsonb, document_version = $3, updated_at = now() WHERE id = $1', [
      id,
      JSON.stringify(snap),
      version,
    ]);
    await audit(q, ctx, {
      action: 'POLICY_ENDORSED',
      entityType: 'policy',
      entityId: id,
      entityLabel: p.policy_number,
      oldValue,
      newValue,
      message: input.reason,
    });
  });
  return getPolicy(db, ctx, id);
}

export async function cancelPolicy(db: Db, ctx: Ctx, id: string, input: z.infer<typeof cancelSchema>) {
  assertCan(ctx, 'policies.cancel');
  const scope = dealerScope(ctx);
  await db.tx(async (q) => {
    const p = await loadPolicyRow(q, scope, id, true);
    if (!['ACTIVE', 'PAYMENT_PENDING', 'SUSPENDED'].includes(p.status)) throw conflict(`A ${p.status.toLowerCase()} policy cannot be cancelled`);
    const { rows: pays } = await q.query(
      `SELECT * FROM payments WHERE policy_id = $1 AND status IN ('SUCCESS', 'PARTIALLY_REFUNDED', 'PENDING') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [id],
    );
    const pay = pays[0];
    const paid = pay && pay.status !== 'PENDING' ? Number(pay.total_amount) - Number(pay.refund_amount) : 0;
    const refund = Math.round(input.refundAmount * 100) / 100;
    if (refund > paid + 0.001) throw badRequest(`Refund cannot exceed the amount collected (Rs. ${paid.toFixed(2)})`);
    let paymentStatus: string | null = pay?.status ?? null;
    if (pay?.status === 'PENDING') {
      paymentStatus = 'FAILED';
      await q.query(`UPDATE payments SET status = 'FAILED', notes = coalesce(notes || ' | ', '') || 'Policy cancelled before payment', updated_by = $2, updated_at = now() WHERE id = $1`, [
        pay.id,
        ctx.user.id,
      ]);
    } else if (pay && refund > 0) {
      const totalRefunded = Number(pay.refund_amount) + refund;
      paymentStatus = totalRefunded >= Number(pay.total_amount) - 0.001 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await q.query(
        `UPDATE payments SET status = $2, refund_amount = $3, refunded_at = now(), refund_reference = $4, updated_by = $5, updated_at = now() WHERE id = $1`,
        [pay.id, paymentStatus, totalRefunded, input.refundReference, ctx.user.id],
      );
      await audit(q, ctx, {
        action: 'PAYMENT_REFUNDED',
        dealerId: p.dealer_id,
        entityType: 'payment',
        entityId: pay.id,
        entityLabel: p.policy_number,
        newValue: { refund, status: paymentStatus, reference: input.refundReference },
      });
    }
    if (input.requestId) {
      const { rows } = await q.query(
        `UPDATE policy_cancellations SET status = 'APPROVED', approved_by = $3, decided_at = now(), cancellation_date = now(),
           refund_amount = $4, refund_reference = $5, payment_status = $6, decision_notes = $7
         WHERE id = $1 AND policy_id = $2 AND status = 'REQUESTED' RETURNING id`,
        [input.requestId, id, ctx.user.id, refund, input.refundReference, paymentStatus, input.reason],
      );
      if (!rows[0]) throw conflict('The cancellation request is no longer pending');
    } else {
      await q.query(
        `INSERT INTO policy_cancellations (policy_id, dealer_id, status, reason, requested_by, approved_by, decided_at, cancellation_date,
           refund_amount, refund_reference, payment_status)
         VALUES ($1, $2, 'APPROVED', $3, $4, $4, now(), now(), $5, $6, $7)`,
        [id, p.dealer_id, input.reason, ctx.user.id, refund, input.refundReference, paymentStatus],
      );
    }
    await q.query(`UPDATE policies SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1`, [id]);
    // Cancelling a renewal restores the previous policy so the customer is not left without history.
    if (p.renewed_from_policy_id) {
      await q.query(
        `UPDATE policies SET status = 'ACTIVE', renewed_to_policy_id = NULL, updated_at = now() WHERE id = $1 AND renewed_to_policy_id = $2 AND status = 'RENEWED'`,
        [p.renewed_from_policy_id, id],
      );
    }
    await audit(q, ctx, {
      action: 'POLICY_CANCELLED',
      dealerId: p.dealer_id,
      entityType: 'policy',
      entityId: id,
      entityLabel: p.policy_number,
      oldValue: { status: p.status },
      newValue: { status: 'CANCELLED', refundAmount: refund, paymentStatus },
      message: input.reason,
    });
  });
  return getPolicy(db, ctx, id);
}

export async function requestCancellation(db: Db, ctx: Ctx, id: string, input: z.infer<typeof cancelRequestSchema>) {
  assertCan(ctx, 'policies.cancel_request');
  const dealerId = requireDealer(ctx);
  await db.tx(async (q) => {
    const p = await loadPolicyRow(q, dealerId, id, true);
    if (!['ACTIVE', 'PAYMENT_PENDING'].includes(p.status)) throw conflict('Only active or payment-pending policies can be cancelled');
    const pending = await q.query(`SELECT 1 FROM policy_cancellations WHERE policy_id = $1 AND status = 'REQUESTED'`, [id]);
    if (pending.rows.length) throw conflict('A cancellation request is already pending for this policy');
    await q.query(
      `INSERT INTO policy_cancellations (policy_id, dealer_id, status, reason, requested_by) VALUES ($1, $2, 'REQUESTED', $3, $4)`,
      [id, dealerId, input.reason, ctx.user.id],
    );
    await audit(q, ctx, { action: 'CANCELLATION_REQUESTED', entityType: 'policy', entityId: id, entityLabel: p.policy_number, message: input.reason });
  });
  return getPolicy(db, ctx, id);
}

export async function rejectCancellation(db: Db, ctx: Ctx, requestId: string, input: z.infer<typeof decisionSchema>) {
  assertCan(ctx, 'policies.cancel');
  const scope = dealerScope(ctx);
  const policyId = await db.tx(async (q) => {
    const { rows } = await q.query(
      `SELECT pc.*, p.policy_number FROM policy_cancellations pc JOIN policies p ON p.id = pc.policy_id
        WHERE pc.id = $1 AND ($2::uuid IS NULL OR pc.dealer_id = $2) FOR UPDATE OF pc`,
      [requestId, scope],
    );
    const r = rows[0];
    if (!r) throw notFound('Cancellation request');
    if (r.status !== 'REQUESTED') throw conflict('This request has already been decided');
    await q.query(
      `UPDATE policy_cancellations SET status = 'REJECTED', approved_by = $2, decided_at = now(), decision_notes = $3 WHERE id = $1`,
      [requestId, ctx.user.id, input.notes],
    );
    await audit(q, ctx, {
      action: 'CANCELLATION_REJECTED',
      dealerId: r.dealer_id,
      entityType: 'policy',
      entityId: r.policy_id,
      entityLabel: r.policy_number,
      message: input.notes,
    });
    return r.policy_id as string;
  });
  return getPolicy(db, ctx, policyId);
}

export async function listCancellations(q: Queryable, ctx: Ctx, f: { status?: string | null; dealerId?: string | null }) {
  assertCan(ctx, 'policies.cancel');
  const scope = dealerScope(ctx, f.dealerId);
  const { rows } = await q.query(
    `SELECT pc.*, p.policy_number, p.total_premium, c.name AS customer_name, d.dealer_name,
            ur.name AS requested_by_name, ua.name AS approved_by_name
       FROM policy_cancellations pc
       JOIN policies p ON p.id = pc.policy_id
       JOIN customers c ON c.id = p.customer_id
       JOIN dealers d ON d.id = pc.dealer_id
       LEFT JOIN users ur ON ur.id = pc.requested_by
       LEFT JOIN users ua ON ua.id = pc.approved_by
      WHERE ($1::uuid IS NULL OR pc.dealer_id = $1) AND ($2::text IS NULL OR pc.status = $2)
      ORDER BY pc.requested_at DESC LIMIT 200`,
    [scope, f.status ?? null],
  );
  return rows.map(toCancellation);
}

export async function setSuspension(db: Db, ctx: Ctx, id: string, suspend: boolean, reason: string) {
  assertCan(ctx, 'policies.cancel');
  const scope = dealerScope(ctx);
  await db.tx(async (q) => {
    const p = await loadPolicyRow(q, scope, id, true);
    if (suspend && p.status !== 'ACTIVE') throw conflict('Only active policies can be suspended');
    if (!suspend && p.status !== 'SUSPENDED') throw conflict('Only suspended policies can be reinstated');
    const next = suspend ? 'SUSPENDED' : 'ACTIVE';
    await q.query('UPDATE policies SET status = $2, updated_at = now() WHERE id = $1', [id, next]);
    await audit(q, ctx, {
      action: suspend ? 'POLICY_SUSPENDED' : 'POLICY_REINSTATED',
      dealerId: p.dealer_id,
      entityType: 'policy',
      entityId: id,
      entityLabel: p.policy_number,
      oldValue: { status: p.status },
      newValue: { status: next },
      message: reason,
    });
  });
  return getPolicy(db, ctx, id);
}

export async function updatePayment(db: Db, ctx: Ctx, paymentId: string, input: z.infer<typeof paymentUpdateSchema>) {
  assertCan(ctx, 'payments.manage');
  const dealerId = requireDealer(ctx);
  const res = await db.tx(async (q) => {
    const { rows } = await q.query('SELECT * FROM payments WHERE id = $1 AND dealer_id = $2 FOR UPDATE', [paymentId, dealerId]);
    const pm = rows[0];
    if (!pm) throw notFound('Payment');
    if (pm.status !== 'PENDING') throw conflict('Only pending payments can be updated');
    const method = input.method ?? pm.payment_method;
    const transactionId = input.transactionId ?? pm.transaction_id;
    if (input.status === 'SUCCESS') validatePayment({ method, status: 'SUCCESS', transactionId, paidAt: input.paidAt });
    await q.query(
      `UPDATE payments SET status = $2, payment_method = $3, transaction_id = $4, paid_at = $5, notes = coalesce($6, notes), updated_by = $7, updated_at = now() WHERE id = $1`,
      [paymentId, input.status, method, transactionId, input.status === 'SUCCESS' ? (input.paidAt ? new Date(input.paidAt) : new Date()) : null, input.notes, ctx.user.id],
    );
    const policy = await loadPolicyRow(q, dealerId, pm.policy_id, true);
    let activated = false;
    if (input.status === 'SUCCESS' && policy.status === 'PAYMENT_PENDING') {
      await q.query(`UPDATE policies SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [policy.id]);
      activated = true;
      await audit(q, ctx, {
        action: 'POLICY_ACTIVATED',
        entityType: 'policy',
        entityId: policy.id,
        entityLabel: policy.policy_number,
        oldValue: { status: 'PAYMENT_PENDING' },
        newValue: { status: 'ACTIVE' },
      });
    }
    await audit(q, ctx, {
      action: 'PAYMENT_UPDATED',
      entityType: 'payment',
      entityId: paymentId,
      entityLabel: policy.policy_number,
      oldValue: { status: pm.status },
      newValue: { status: input.status, method, transactionId },
    });
    return { policyId: policy.id as string, activated };
  });
  if (res.activated) await afterActivation(db, ctx, res.policyId);
  return getPolicy(db, ctx, res.policyId);
}

export async function resendNotifications(db: Db, ctx: Ctx, id: string) {
  assertCanViewPolicy(ctx);
  const p = await loadPolicyRow(db, requireDealer(ctx), id);
  if (p.status !== 'ACTIVE') throw conflict('Notifications can be sent for active policies only');
  await notifyPolicyIssued(db, id);
  return getPolicy(db, ctx, id);
}

// ---------------------------------------------------------------- public verification

export async function verifyPolicy(db: Db, ctx: AnonCtx, policyNumber: string) {
  await enforceRateLimit(db, `verify:${ctx.ip ?? 'unknown'}`, 60, 60, 'Too many verification requests. Please wait a minute.');
  const settings = await getPlatformSettings(db);
  const number = policyNumber.trim().toUpperCase();
  if (!/^[A-Z0-9\-_]{4,60}$/.test(number)) return { found: false as const };
  const { rows } = await db.query(
    `SELECT p.policy_number, p.plan_name, p.start_date, p.end_date, p.issued_at, p.number_of_services, p.snapshot,
            ${effectiveStatusSql('p', settings.expiringSoonDays)} AS effective_status, d.dealer_name
       FROM policies p JOIN dealers d ON d.id = p.dealer_id
      WHERE p.policy_number = $1 AND p.status <> 'DRAFT'`,
    [number],
  );
  const r = rows[0];
  if (!r) return { found: false as const };
  const s = r.snapshot as CertificateSnapshot;
  return {
    found: true as const,
    platformName: settings.platformName,
    policyNumber: r.policy_number,
    status: r.effective_status as string,
    planName: s.plan.certificatePlanName || r.plan_name,
    productName: r.plan_name,
    startDate: r.start_date,
    endDate: r.end_date,
    issuedAt: r.issued_at,
    numberOfServices: r.number_of_services,
    dealerName: r.dealer_name,
    dealerLogoUrl: fileUrl(s.dealer.logoFileId),
    helpline: s.dealer.rsaPhone,
    customerName: maskName(s.customer.name),
    vehicle: {
      type: vehicleTypeLabel(s.vehicle.vehicleType),
      makeModel: [s.vehicle.make, s.vehicle.model].filter(Boolean).join(' '),
      registrationNo: s.vehicle.registrationNo ? maskMiddle(s.vehicle.registrationNo, 4, 2) : 'New',
      chassisNo: maskMiddle(s.vehicle.chassisNo, 3, 4),
    },
  };
}
