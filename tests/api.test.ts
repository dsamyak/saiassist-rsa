import { beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDb, prepareDb, setDb, type Db } from '../server/db';
import { createApp } from '../server/app';
import { istDateString, addDaysToDateString } from '../server/lib/dates';

process.env.SUPERADMIN_EMAIL = 'root@test.local';
process.env.SUPERADMIN_PASSWORD = 'Root@12345';
process.env.DEMO_PASSWORD = 'Demo@12345';
process.env.PUBLIC_BASE_URL = 'https://rsa.test';

let app: ReturnType<typeof createApp>;
let db: Db;

type CallOpts = { token?: string; body?: unknown; headers?: Record<string, string> };
async function call(method: string, path: string, opts: CallOpts = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '10.0.0.1',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const ct = res.headers.get('content-type') ?? '';
  const data: any = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data, res };
}

async function login(email: string, password = 'Demo@12345') {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  expect(r.status, JSON.stringify(r.data)).toBe(200);
  return r.data.accessToken as string;
}

const isPdf = (b: Uint8Array) => String.fromCharCode(...b.slice(0, 5)) === '%PDF-';

let rootToken: string;
let saiAdmin: string;
let saiEmployee: string;
let shreeAdmin: string;

beforeAll(async () => {
  db = await createPgliteDb();
  await prepareDb(db, { seedDemo: true });
  setDb(db);
  app = createApp();
  rootToken = await login('root@test.local', 'Root@12345');
  saiAdmin = await login('admin@saimotors.demo');
  saiEmployee = await login('pooja@saimotors.demo');
  shreeAdmin = await login('admin@shreeauto.demo');
});

describe('public endpoints', () => {
  it('reports health and branding', async () => {
    expect((await call('GET', '/api/health')).status).toBe(200);
    const b = await call('GET', '/api/public/branding');
    expect(b.data.platformName).toBe('SaiAssist RSA');
  });

  it('rejects unauthenticated workspace access', async () => {
    expect((await call('GET', '/api/policies')).status).toBe(401);
    expect((await call('GET', '/api/admin/dealers')).status).toBe(401);
  });
});

describe('authentication', () => {
  it('locks an account after repeated wrong passwords', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await call('POST', '/api/auth/login', { body: { email: 'amit@saimotors.demo', password: 'wrong-pass-1' } })).status).toBe(401);
    }
    const fifth = await call('POST', '/api/auth/login', { body: { email: 'amit@saimotors.demo', password: 'wrong-pass-1' } });
    expect(fifth.data.error.message).toMatch(/locked/i);
    const locked = await call('POST', '/api/auth/login', { body: { email: 'amit@saimotors.demo', password: 'Demo@12345' } });
    expect(locked.status).toBe(423);
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: 'kiran@shreeauto.demo', password: 'Demo@12345' } });
    const cookie = r.res.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^rsa_session=/);
    expect(r.res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const noHeader = await call('POST', '/api/auth/refresh', { headers: { cookie } });
    expect(noHeader.status).toBe(403);
    const ok = await call('POST', '/api/auth/refresh', { headers: { cookie, 'x-requested-with': 'XMLHttpRequest' } });
    expect(ok.status).toBe(200);
    expect(ok.data.accessToken).toBeTruthy();
    const reuse = await call('POST', '/api/auth/refresh', { headers: { cookie, 'x-requested-with': 'XMLHttpRequest' } });
    expect(reuse.status).toBe(401);
  });

  it('returns the profile with effective permissions', async () => {
    const me = await call('GET', '/api/auth/me', { token: saiEmployee });
    expect(me.data.user.role).toBe('DEALER_EMPLOYEE');
    expect(me.data.user.permissions).toContain('policies.issue');
    expect(me.data.user.permissions).not.toContain('employees.manage');
    expect(me.data.dealer.name).toBe('Sai Motors (Demo)');
  });
});

describe('super admin', () => {
  it('sees all dealers and the consolidated dashboard', async () => {
    const d = await call('GET', '/api/admin/dealers', { token: rootToken });
    expect(d.data.total).toBe(2);
    const dash = await call('GET', '/api/admin/dashboard', { token: rootToken });
    expect(dash.data.counts.total).toBeGreaterThan(20);
    expect(dash.data.trend).toHaveLength(12);
  });

  it('dealer users cannot reach admin APIs', async () => {
    expect((await call('GET', '/api/admin/dealers', { token: saiAdmin })).status).toBe(403);
  });

  it('creates a dealer with its admin and a dealer-specific number format', async () => {
    const r = await call('POST', '/api/admin/dealers', {
      token: rootToken,
      body: {
        dealerCode: 'NEW-01',
        dealerName: 'New Wheels',
        issuerName: 'NEW WHEELS PVT LTD',
        servicingOffice: 'Main Road, Satara',
        city: 'Satara',
        state: 'Maharashtra',
        pincode: '415001',
        policyPrefix: 'NW',
        policyNumberFormat: '{PREFIX}-{YYYY}-{SEQ:6}',
        admin: { name: 'Owner', email: 'owner@newwheels.test', password: 'Owner@123' },
      },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.admin.role).toBe('DEALER_ADMIN');
    const bad = await call('POST', '/api/admin/dealers', {
      token: rootToken,
      body: { dealerCode: 'NEW-02', dealerName: 'X', policyNumberFormat: '{YYYY}{SEQ:4}', admin: { name: 'A', email: 'a@x.test' } },
    });
    expect(bad.status).toBe(400);
  });

  it('creates and updates RSA products with benefits and validity options', async () => {
    const body = {
      productCode: 'TEST-PLAN',
      planName: 'Test Plan',
      vehicleTypes: ['TWO_WHEELER'],
      numberOfServices: 3,
      priceIncludesGst: false,
      gstRate: 18,
      terms: [{ label: '1 Year', validityUnit: 'MONTHS', validityValue: 12, price: 500 }],
      benefits: [{ name: 'Jump Start', description: 'Battery jump start' }],
      enableForAllDealers: true,
    };
    const created = await call('POST', '/api/admin/rsa/products', { token: rootToken, body });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const updated = await call('PUT', `/api/admin/rsa/products/${created.data.id}`, {
      token: rootToken,
      body: { ...body, terms: [{ ...body.terms[0], id: created.data.terms[0].id, price: 600 }], numberOfServices: 4 },
    });
    expect(updated.data.numberOfServices).toBe(4);
    expect(updated.data.terms[0].price).toBe(600);
  });

  it('renders the certificate template preview', async () => {
    const r = await app.request('/api/admin/settings/preview', {
      method: 'POST',
      headers: { authorization: `Bearer ${rootToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ certificate: { title: 'RSA Certificate' } }),
    });
    expect(r.status).toBe(200);
    expect(isPdf(new Uint8Array(await r.arrayBuffer()))).toBe(true);
  });
});

describe('policy lifecycle', () => {
  let customerId: string;
  let vehicleId: string;
  let productId: string;
  let termId: string;
  let policyId: string;
  let policyNumber: string;

  it('creates a customer and vehicle in the dealer workspace', async () => {
    const c = await call('POST', '/api/customers', {
      token: saiEmployee,
      body: { name: 'TEST CUSTOMER', mobile: '+91 98765 43210', email: 'test@example.com', address: 'Main Road', city: 'Kolhapur', state: 'Maharashtra', pincode: '416001' },
    });
    expect(c.status, JSON.stringify(c.data)).toBe(201);
    expect(c.data.mobile).toBe('9876543210');
    customerId = c.data.id;
    const v = await call('POST', '/api/vehicles', {
      token: saiEmployee,
      body: {
        customerId,
        registrationNo: null,
        vehicleType: 'TWO_WHEELER',
        make: 'HONDA',
        model: 'SP125',
        variant: 'DLX',
        engineNo: 'jc94-eg1234567',
        chassisNo: 'ME4JC94FHTG999999',
        fuelType: 'PETROL',
        manufacturingYear: new Date().getFullYear(),
      },
    });
    expect(v.status, JSON.stringify(v.data)).toBe(201);
    expect(v.data.engineNo).toBe('JC94EG1234567');
    vehicleId = v.data.id;
    const dup = await call('POST', '/api/vehicles', { token: saiEmployee, body: { ...v.data, customerId, chassisNo: 'ME4JC94FHTG999999' } });
    expect(dup.status).toBe(409);
  });

  it('lists eligible products and quotes premium with GST back-calculated', async () => {
    const p = await call('GET', `/api/rsa/products?vehicleId=${vehicleId}`, { token: saiEmployee });
    const basic = p.data.find((x: any) => x.productCode === 'TW-BASIC');
    const car = p.data.find((x: any) => x.productCode === 'FW-STD');
    expect(basic.eligibility.eligible).toBe(true);
    expect(car.eligibility.eligible).toBe(false);
    productId = basic.id;
    termId = basic.terms[0].id;
    const q = await call('POST', '/api/policies/quote', { token: saiEmployee, body: { customerId, vehicleId, productId, termId } });
    expect(q.status, JSON.stringify(q.data)).toBe(200);
    expect(q.data.basePremium).toBe(847.46);
    expect(q.data.gstAmount).toBe(152.54);
    expect(q.data.totalPremium).toBe(1000);
    const past = await call('POST', '/api/policies/quote', {
      token: saiEmployee,
      body: { customerId, vehicleId, productId, termId, startDate: addDaysToDateString(istDateString(), -1) },
    });
    expect(past.status).toBe(400);
  });

  it('previews the certificate as a PDF', async () => {
    const r = await call('POST', '/api/policies/preview', { token: saiEmployee, body: { customerId, vehicleId, productId, termId } });
    expect(r.status).toBe(200);
    expect(isPdf(r.data)).toBe(true);
  });

  it('requires a transaction reference for UPI payments', async () => {
    const r = await call('POST', '/api/policies/issue', {
      token: saiEmployee,
      body: { customerId, vehicleId, productId, termId, payment: { method: 'UPI', status: 'SUCCESS' } },
    });
    expect(r.status).toBe(400);
  });

  it('issues an active policy with a unique certificate number and stored PDF', async () => {
    const r = await call('POST', '/api/policies/issue', {
      token: saiEmployee,
      body: { customerId, vehicleId, productId, termId, payment: { method: 'UPI', status: 'SUCCESS', transactionId: 'UPI123' } },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.status).toBe('ACTIVE');
    expect(r.data.policyNumber).toMatch(/^SA\d{8}\d{5}$/);
    expect(r.data.documents).toHaveLength(1);
    expect(r.data.snapshot.verifyUrl).toBe(`https://rsa.test/verify/${r.data.policyNumber}`);
    policyId = r.data.id;
    policyNumber = r.data.policyNumber;
    const pdf = await call('GET', `/api/policies/${policyId}/pdf`, { token: saiEmployee });
    expect(isPdf(pdf.data)).toBe(true);
  });

  it('blocks a second overlapping policy for the same vehicle', async () => {
    const r = await call('POST', '/api/policies/issue', {
      token: saiEmployee,
      body: { customerId, vehicleId, productId, termId, payment: { method: 'CASH', status: 'SUCCESS' } },
    });
    expect(r.status).toBe(409);
    expect(r.data.error.message).toMatch(/Renew/);
  });

  it('verifies publicly without exposing personal data', async () => {
    const r = await call('GET', `/api/public/policies/verify/${policyNumber}`);
    expect(r.data.found).toBe(true);
    expect(r.data.status).toBe('ACTIVE');
    expect(r.data.customerName).toBe('T*** C******');
    expect(JSON.stringify(r.data)).not.toContain('9876543210');
    expect(r.data.vehicle.chassisNo).not.toContain('99999');
    expect((await call('GET', '/api/public/policies/verify/NOPE12345')).status).toBe(404);
  });

  it('isolates tenants: another dealer cannot read or use this data', async () => {
    expect((await call('GET', `/api/policies/${policyId}`, { token: shreeAdmin })).status).toBe(404);
    expect((await call('GET', `/api/customers/${customerId}`, { token: shreeAdmin })).status).toBe(404);
    expect((await call('GET', `/api/vehicles/${vehicleId}`, { token: shreeAdmin })).status).toBe(404);
    expect((await call('GET', `/api/policies/${policyId}/pdf`, { token: shreeAdmin })).status).toBe(404);
    const steal = await call('POST', '/api/vehicles', {
      token: shreeAdmin,
      body: { customerId, vehicleType: 'TWO_WHEELER', make: 'X', model: 'Y', variant: 'Z', engineNo: 'ENG12345', chassisNo: 'CHS123456', fuelType: 'PETROL', manufacturingYear: 2024 },
    });
    expect(steal.status).toBe(404);
    const issue = await call('POST', '/api/policies/issue', {
      token: shreeAdmin,
      body: { customerId, vehicleId, productId, termId, payment: { method: 'CASH', status: 'SUCCESS' } },
    });
    expect(issue.status).toBe(404);
    const list = await call('GET', `/api/policies?q=${policyNumber}`, { token: shreeAdmin });
    expect(list.data.total).toBe(0);
    // Even an explicit dealerId filter cannot widen a dealer user's scope.
    const sneaky = await call('GET', `/api/customers?dealerId=${(await call('GET', `/api/policies/${policyId}`, { token: saiAdmin })).data.dealerId}`, { token: shreeAdmin });
    expect(sneaky.data.items.every((c: any) => c.dealerName === 'Shree Automobiles (Demo)')).toBe(true);
  });

  it('super admin can view any dealer policy', async () => {
    const r = await call('GET', `/api/policies/${policyId}`, { token: rootToken });
    expect(r.status).toBe(200);
    expect(r.data.actions.canRenew).toBe(false);
  });

  it('endorses the registration number and preserves the original document', async () => {
    const r = await call('POST', `/api/policies/${policyId}/endorse`, {
      token: saiEmployee,
      body: { registrationNo: 'MH 09 AB 1234', reason: 'RTO registration completed' },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.snapshot.vehicle.registrationNo).toBe('MH09AB1234');
    expect(r.data.documents.map((d: any) => d.version)).toEqual([2, 1]);
    const v1 = await call('GET', `/api/policies/${policyId}/documents/1`, { token: saiEmployee });
    expect(isPdf(v1.data)).toBe(true);
  });

  it('renews: new cover starts after the current one ends and the old policy is marked renewed', async () => {
    const r = await call('POST', `/api/policies/${policyId}/renew`, {
      token: saiEmployee,
      body: { productId, termId, payment: { method: 'CASH', status: 'SUCCESS' } },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const old = await call('GET', `/api/policies/${policyId}`, { token: saiEmployee });
    expect(old.data.status).toBe('RENEWED');
    expect(new Date(r.data.startDate).getTime()).toBe(new Date(old.data.endDate).getTime() + 1000);
    expect(r.data.renewedFrom.policyNumber).toBe(policyNumber);
    const again = await call('POST', `/api/policies/${policyId}/renew`, {
      token: saiEmployee,
      body: { productId, termId, payment: { method: 'CASH', status: 'SUCCESS' } },
    });
    expect(again.status).toBe(409);

    // Employee requests cancellation of the renewal; the dealer admin approves with a partial refund.
    const req = await call('POST', `/api/policies/${r.data.id}/cancel-request`, { token: saiEmployee, body: { reason: 'Customer changed mind' } });
    expect(req.status, JSON.stringify(req.data)).toBe(200);
    expect((await call('POST', `/api/policies/${r.data.id}/cancel`, { token: saiEmployee, body: { reason: 'x' } })).status).toBe(403);
    const pending = await call('GET', '/api/cancellations?status=REQUESTED', { token: saiAdmin });
    const request = pending.data.find((x: any) => x.policyId === r.data.id);
    const cancel = await call('POST', `/api/policies/${r.data.id}/cancel`, {
      token: saiAdmin,
      body: { reason: 'Approved', refundAmount: 400, requestId: request.id },
    });
    expect(cancel.status, JSON.stringify(cancel.data)).toBe(200);
    expect(cancel.data.status).toBe('CANCELLED');
    expect(cancel.data.payments[0].status).toBe('PARTIALLY_REFUNDED');
    // Cancelling the renewal restores the previous policy.
    const restored = await call('GET', `/api/policies/${policyId}`, { token: saiEmployee });
    expect(restored.data.status).toBe('ACTIVE');
    const tooMuch = await call('POST', `/api/policies/${policyId}/cancel`, { token: saiAdmin, body: { reason: 'x', refundAmount: 5000 } });
    expect(tooMuch.status).toBe(400);
  });

  it('handles payment-pending issuance and later payment realisation', async () => {
    const v = await call('POST', '/api/vehicles', {
      token: saiEmployee,
      body: { customerId, vehicleType: 'TWO_WHEELER', make: 'TVS', model: 'Jupiter', variant: 'ZX', engineNo: 'ENG55555', chassisNo: 'MD626PENDING01', fuelType: 'PETROL', manufacturingYear: 2025 },
    });
    const r = await call('POST', '/api/policies/issue', {
      token: saiEmployee,
      body: { customerId, vehicleId: v.data.id, productId, termId, payment: { method: 'CHEQUE', status: 'PENDING' } },
    });
    expect(r.data.status).toBe('PAYMENT_PENDING');
    expect(r.data.documents).toHaveLength(0);
    const pay = await call('PATCH', `/api/payments/${r.data.payments[0].id}`, {
      token: saiAdmin,
      body: { status: 'SUCCESS', transactionId: 'CHQ000123' },
    });
    expect(pay.status, JSON.stringify(pay.data)).toBe(200);
    expect(pay.data.status).toBe('ACTIVE');
    expect(pay.data.documents).toHaveLength(1);
  });

  it('saves a quotation (draft) and issues it later', async () => {
    const v = await call('POST', '/api/vehicles', {
      token: saiEmployee,
      body: { customerId, vehicleType: 'TWO_WHEELER', make: 'Hero', model: 'Splendor', variant: 'Plus', engineNo: 'ENG77777', chassisNo: 'MBLHADRAFT001', fuelType: 'PETROL', manufacturingYear: 2025 },
    });
    const d = await call('POST', '/api/policies/drafts', { token: saiEmployee, body: { customerId, vehicleId: v.data.id, productId, termId } });
    expect(d.status, JSON.stringify(d.data)).toBe(201);
    expect(d.data.status).toBe('DRAFT');
    expect(d.data.policyNumber).toBeNull();
    const quotePdf = await call('GET', `/api/policies/${d.data.id}/pdf`, { token: saiEmployee });
    expect(isPdf(quotePdf.data)).toBe(true);
    const issued = await call('POST', '/api/policies/issue', {
      token: saiEmployee,
      body: { customerId, vehicleId: v.data.id, productId, termId, draftId: d.data.id, payment: { method: 'CASH', status: 'SUCCESS' } },
    });
    expect(issued.status, JSON.stringify(issued.data)).toBe(201);
    expect(issued.data.id).toBe(d.data.id);
    expect(issued.data.status).toBe('ACTIVE');
  });

  it('uses the dealer-specific numbering format', async () => {
    const list = await call('GET', '/api/policies?pageSize=5', { token: shreeAdmin });
    expect(list.data.items[0].policyNumber).toMatch(/^SHR-\d{4}-\d{6}$/);
  });

  it('searches policies by several fields', async () => {
    const byNumber = await call('GET', `/api/policies?q=${policyNumber}`, { token: saiEmployee });
    expect(byNumber.data.items[0].policyNumber).toBe(policyNumber);
    const byReg = await call('GET', '/api/policies?q=MH09AB1234&field=registrationNo', { token: saiEmployee });
    expect(byReg.status, JSON.stringify(byReg.data)).toBe(200);
    expect(byReg.data.total).toBeGreaterThan(0);
    const expiring = await call('GET', '/api/policies?status=EXPIRING_SOON', { token: saiAdmin });
    expect(expiring.status).toBe(200);
  });

  it('records the audit trail', async () => {
    const r = await call('GET', `/api/audit-logs?entityId=${policyId}`, { token: saiAdmin });
    const actions = r.data.items.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['POLICY_ISSUED', 'POLICY_ENDORSED', 'POLICY_RENEWED', 'CERTIFICATE_DOWNLOADED']));
    expect((await call('GET', '/api/audit-logs', { token: saiEmployee })).status).toBe(403);
  });
});

describe('dealer administration and reports', () => {
  it('dealer admin manages employees with permissions; employees cannot', async () => {
    const r = await call('POST', '/api/dealer/users', {
      token: saiAdmin,
      body: { name: 'New Staff', email: 'staff@saimotors.demo', permissions: ['policies.view', 'policies.download'] },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.temporaryPassword).toBeTruthy();
    expect(r.data.user.mustChangePassword).toBe(true);
    expect((await call('GET', '/api/dealer/users', { token: saiEmployee })).status).toBe(403);

    // The new employee must change the password first, then is limited to granted permissions.
    const t = await login('staff@saimotors.demo', r.data.temporaryPassword);
    expect((await call('GET', '/api/policies', { token: t })).status).toBe(403);
    const changed = await call('POST', '/api/auth/change-password', {
      token: t,
      body: { currentPassword: r.data.temporaryPassword, newPassword: 'Staff@2026' },
    });
    expect(changed.status).toBe(200);
    expect((await call('GET', '/api/policies', { token: t })).status).toBe(200);
    expect(
      (await call('POST', '/api/customers', { token: t, body: { name: 'X', mobile: '9999999999', address: 'a', city: 'b', state: 'c', pincode: '111111' } })).status,
    ).toBe(403);
  });

  it('dealer reports are scoped; consolidated reports include dealer-wise data', async () => {
    const dealer = await call('GET', '/api/reports/summary?from=2020-01-01', { token: saiAdmin });
    expect(dealer.status).toBe(200);
    expect(dealer.data.dealerWise).toHaveLength(0);
    expect(dealer.data.summary.issued).toBeGreaterThan(0);
    const admin = await call('GET', '/api/reports/summary?from=2020-01-01', { token: rootToken });
    expect(admin.data.dealerWise.length).toBeGreaterThanOrEqual(2);
    expect(admin.data.summary.issued).toBeGreaterThan(dealer.data.summary.issued);
    expect((await call('GET', '/api/reports/summary', { token: saiEmployee })).status).toBe(403);
  });

  it('dealer admin can only edit settings sections the Super Admin allows', async () => {
    expect((await call('PUT', '/api/dealer/settings', { token: saiAdmin, body: { phone: '0231-2659999' } })).status).toBe(200);
    expect((await call('PUT', '/api/dealer/settings', { token: saiAdmin, body: { rsaPhone: '1800-111-2222' } })).status).toBe(403);
  });

  it('deactivating a dealer immediately blocks its users', async () => {
    const dealers = await call('GET', '/api/admin/dealers?search=SHREE', { token: rootToken });
    const id = dealers.data.items[0].id;
    await call('PATCH', `/api/admin/dealers/${id}/status`, { token: rootToken, body: { status: 'INACTIVE' } });
    const blocked = await call('GET', '/api/dashboard', { token: shreeAdmin });
    expect([401, 403]).toContain(blocked.status);
    await call('PATCH', `/api/admin/dealers/${id}/status`, { token: rootToken, body: { status: 'ACTIVE' } });
  });
});
