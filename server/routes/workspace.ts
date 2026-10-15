import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { forbidden, notFound } from '../lib/errors';
import { body, optional, query, uuid } from '../lib/validate';
import { formatDateString, formatIstDateTime } from '../lib/dates';
import { assertCan, can, requireAuth, requireDealer } from '../middleware/auth';
import {
  createCustomer,
  createVehicle,
  customerListQuery,
  customerSchema,
  getCustomer,
  getVehicle,
  listCustomers,
  listVehicles,
  loadVehicle,
  updateCustomer,
  updateVehicle,
  vehicleListQuery,
  vehicleSchema,
} from '../services/customers';
import { checkEligibility, listDealerProducts, listProducts } from '../services/products';
import {
  cancelPolicy,
  cancelRequestSchema,
  cancelSchema,
  decisionSchema,
  deleteDraft,
  endorsePolicy,
  endorseSchema,
  exportPolicies,
  getCertificatePdf,
  getDocumentVersion,
  getPolicy,
  issuePolicy,
  issueSchema,
  listCancellations,
  listPolicies,
  paymentUpdateSchema,
  policyDraftSchema,
  policyListQuery,
  previewPolicyPdf,
  quotePolicy,
  reasonSchema,
  rejectCancellation,
  renewPolicy,
  renewSchema,
  requestCancellation,
  resendNotifications,
  saveDraft,
  saveDraftSchema,
  setSuspension,
  updatePayment,
} from '../services/policies';
import { listPayments, paymentListQuery } from '../services/payments';
import { auditQuery, dealerDashboard, listAuditLogs, policyReport, reportQuery } from '../services/reports';
import { createUser, listUsers, resetPassword, updateUser, userCreateSchema, userUpdateSchema } from '../services/users';
import { dealerSelfSchema, getDealer, updateOwnDealerSettings } from '../services/dealers';
import { templatePreview } from '../services/platform';
import { csvResponse, pdfResponse, toCsv } from './helpers';
import { POLICY_STATUS_LABELS, vehicleTypeLabel } from '../../shared/constants';

const idParam = (c: any, name = 'id') => {
  const r = uuid.safeParse(c.req.param(name));
  if (!r.success) throw notFound();
  return r.data;
};

const requireAdminOfDealer = (c: any) => {
  const ctx = c.get('ctx');
  if (ctx.user.role !== 'DEALER_ADMIN') throw forbidden('Only the Dealer Admin can do this');
  return ctx;
};

export const workspaceRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ---- Dashboard & reports
  .get('/dashboard', async (c) => c.json(await dealerDashboard(c.get('db'), c.get('ctx'))))
  .get('/reports/summary', async (c) => c.json(await policyReport(c.get('db'), c.get('ctx'), query(c, reportQuery))))
  .get('/audit-logs', async (c) => c.json(await listAuditLogs(c.get('db'), c.get('ctx'), query(c, auditQuery))))

  // ---- Customers & vehicles
  .get('/customers', async (c) => c.json(await listCustomers(c.get('db'), c.get('ctx'), query(c, customerListQuery))))
  .post('/customers', async (c) => c.json(await createCustomer(c.get('db'), c.get('ctx'), await body(c, customerSchema)), 201))
  .get('/customers/:id', async (c) => c.json(await getCustomer(c.get('db'), c.get('ctx'), idParam(c))))
  .put('/customers/:id', async (c) => c.json(await updateCustomer(c.get('db'), c.get('ctx'), idParam(c), await body(c, customerSchema))))
  .get('/vehicles', async (c) => c.json(await listVehicles(c.get('db'), c.get('ctx'), query(c, vehicleListQuery))))
  .post('/vehicles', async (c) => c.json(await createVehicle(c.get('db'), c.get('ctx'), await body(c, vehicleSchema)), 201))
  .get('/vehicles/:id', async (c) => c.json(await getVehicle(c.get('db'), c.get('ctx'), idParam(c))))
  .put('/vehicles/:id', async (c) => c.json(await updateVehicle(c.get('db'), c.get('ctx'), idParam(c), await body(c, vehicleSchema))))

  // ---- RSA products available to the dealer (with eligibility for a vehicle)
  .get('/rsa/products', async (c) => {
    const ctx = c.get('ctx');
    const db = c.get('db');
    if (ctx.user.role === 'SUPER_ADMIN') return c.json(await listProducts(db));
    const dealerId = requireDealer(ctx);
    const { vehicleId } = query(c, z.object({ vehicleId: optional(uuid) }));
    const products = await listDealerProducts(db, dealerId);
    if (!vehicleId) return c.json(products);
    const vehicle = await loadVehicle(db, dealerId, vehicleId);
    return c.json(products.map((p) => ({ ...p, eligibility: checkEligibility(p, vehicle) })));
  })

  // ---- Policies
  .get('/policies', async (c) => c.json(await listPolicies(c.get('db'), c.get('ctx'), query(c, policyListQuery))))
  .get('/policies/export', async (c) => {
    const rows = await exportPolicies(c.get('db'), c.get('ctx'), query(c, policyListQuery.extend({ pageSize: z.coerce.number().default(20000) })));
    const csv = toCsv(
      ['Certificate No', 'Status', 'Issued At', 'Start', 'End', 'Dealer', 'Customer', 'Mobile', 'Registration', 'Vehicle', 'Chassis No', 'Engine No', 'Plan', 'Base Premium', 'GST', 'Total Premium', 'Issued By'],
      rows.map((r) => [
        r.policy_number ?? 'QUOTATION',
        POLICY_STATUS_LABELS[r.effective_status as keyof typeof POLICY_STATUS_LABELS] ?? r.effective_status,
        r.issued_at ? formatIstDateTime(r.issued_at) : '',
        formatIstDateTime(r.start_date),
        formatIstDateTime(r.end_date),
        r.dealer_name,
        r.customer_name,
        r.customer_mobile,
        r.registration_no ?? 'New',
        `${r.make} ${r.model}`,
        r.chassis_no,
        r.engine_no,
        r.plan_name,
        r.base_premium,
        r.gst_amount,
        r.total_premium,
        r.issued_by_name,
      ]),
    );
    return csvResponse(csv, `rsa-policies-${formatDateString(new Date().toISOString().slice(0, 10))}.csv`);
  })
  .post('/policies/quote', async (c) => c.json(await quotePolicy(c.get('db'), c.get('ctx'), await body(c, policyDraftSchema))))
  .post('/policies/preview', async (c) =>
    pdfResponse(c, await previewPolicyPdf(c.get('db'), c.get('ctx'), await body(c, policyDraftSchema)), 'certificate-preview.pdf'),
  )
  .post('/policies/drafts', async (c) => c.json(await saveDraft(c.get('db'), c.get('ctx'), await body(c, saveDraftSchema)), 201))
  .delete('/policies/drafts/:id', async (c) => {
    await deleteDraft(c.get('db'), c.get('ctx'), idParam(c));
    return c.json({ ok: true });
  })
  .post('/policies/issue', async (c) => c.json(await issuePolicy(c.get('db'), c.get('ctx'), await body(c, issueSchema)), 201))
  .get('/policies/:id', async (c) => c.json(await getPolicy(c.get('db'), c.get('ctx'), idParam(c))))
  .get('/policies/:id/pdf', async (c) => {
    const { bytes, filename } = await getCertificatePdf(c.get('db'), c.get('ctx'), idParam(c));
    return pdfResponse(c, bytes, filename, c.req.query('download') ? 'attachment' : 'inline');
  })
  .get('/policies/:id/documents/:version', async (c) => {
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version) || version < 1) throw notFound();
    const { bytes, filename } = await getDocumentVersion(c.get('db'), c.get('ctx'), idParam(c), version);
    return pdfResponse(c, bytes, filename);
  })
  .post('/policies/:id/renew', async (c) => c.json(await renewPolicy(c.get('db'), c.get('ctx'), idParam(c), await body(c, renewSchema)), 201))
  .post('/policies/:id/cancel', async (c) => c.json(await cancelPolicy(c.get('db'), c.get('ctx'), idParam(c), await body(c, cancelSchema))))
  .post('/policies/:id/cancel-request', async (c) =>
    c.json(await requestCancellation(c.get('db'), c.get('ctx'), idParam(c), await body(c, cancelRequestSchema))),
  )
  .post('/policies/:id/endorse', async (c) => c.json(await endorsePolicy(c.get('db'), c.get('ctx'), idParam(c), await body(c, endorseSchema))))
  .post('/policies/:id/suspend', async (c) =>
    c.json(await setSuspension(c.get('db'), c.get('ctx'), idParam(c), true, (await body(c, reasonSchema)).reason)),
  )
  .post('/policies/:id/reinstate', async (c) =>
    c.json(await setSuspension(c.get('db'), c.get('ctx'), idParam(c), false, (await body(c, reasonSchema)).reason)),
  )
  .post('/policies/:id/notify', async (c) => c.json(await resendNotifications(c.get('db'), c.get('ctx'), idParam(c))))

  // ---- Cancellation approvals
  .get('/cancellations', async (c) =>
    c.json(
      await listCancellations(
        c.get('db'),
        c.get('ctx'),
        query(c, z.object({ status: optional(z.enum(['REQUESTED', 'APPROVED', 'REJECTED'])), dealerId: optional(uuid) })),
      ),
    ),
  )
  .post('/cancellations/:id/reject', async (c) => c.json(await rejectCancellation(c.get('db'), c.get('ctx'), idParam(c), await body(c, decisionSchema))))

  // ---- Payments
  .get('/payments', async (c) => c.json(await listPayments(c.get('db'), c.get('ctx'), query(c, paymentListQuery))))
  .patch('/payments/:id', async (c) => c.json(await updatePayment(c.get('db'), c.get('ctx'), idParam(c), await body(c, paymentUpdateSchema))))

  // ---- Dealer administration (employees & own settings)
  .get('/dealer/users', async (c) => {
    const ctx = requireAdminOfDealer(c);
    return c.json(await listUsers(c.get('db'), { dealerId: ctx.user.dealerId }));
  })
  .post('/dealer/users', async (c) => {
    const ctx = requireAdminOfDealer(c);
    const input = await body(c, userCreateSchema);
    return c.json(await createUser(c.get('db'), ctx, ctx.user.dealerId, { ...input, role: 'DEALER_EMPLOYEE' }), 201);
  })
  .put('/dealer/users/:id', async (c) => {
    const ctx = requireAdminOfDealer(c);
    const input = await body(c, userUpdateSchema.omit({ role: true }));
    return c.json(await updateUser(c.get('db'), ctx, idParam(c), input));
  })
  .post('/dealer/users/:id/reset-password', async (c) => c.json(await resetPassword(c.get('db'), requireAdminOfDealer(c), idParam(c))))
  .get('/dealer/settings', async (c) => {
    const ctx = c.get('ctx');
    const dealerId = requireDealer(ctx);
    if (!can(ctx.user, 'settings.manage')) throw forbidden();
    return c.json(await getDealer(c.get('db'), dealerId));
  })
  .put('/dealer/settings', async (c) => {
    const ctx = c.get('ctx');
    requireDealer(ctx);
    assertCan(ctx, 'settings.manage');
    return c.json(await updateOwnDealerSettings(c.get('db'), ctx, await body(c, dealerSelfSchema)));
  })
  .get('/dealer/certificate-preview', async (c) => {
    const ctx = c.get('ctx');
    const dealerId = requireDealer(ctx);
    const { rows } = await c.get('db').query('SELECT * FROM dealers WHERE id = $1', [dealerId]);
    return pdfResponse(c, await templatePreview(c.get('db'), { dealer: rows[0] }), 'sample-certificate.pdf');
  });

// Silence unused import warnings for helpers kept for future use.
void vehicleTypeLabel;
