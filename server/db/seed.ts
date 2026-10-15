import type { Db, Queryable } from './index';
import { env } from '../env';
import { coveragePeriod, istDateString, addDaysToDateString, istStartOfDay } from '../lib/dates';
import { allocatePolicyNumber } from '../lib/policyNumber';
import { hashPassword, sha256 } from '../lib/security';
import { DEFAULT_EMPLOYEE_PERMISSIONS } from '../../shared/constants';
import { platformSettingsSchema, type PlatformSettings } from '../services/settings';
import { listDealerProducts } from '../services/products';
import { buildSnapshot, type IssuanceContext } from '../services/policies';
import { DEFAULT_PRODUCTS } from './catalog';
import { DEMO_LOGO_SAI, DEMO_LOGO_SHREE } from './demo-logos';

const SEED_LOCK = 7_272_775;

/** Runs once on an empty database: platform settings, Super Admin, RSA catalogue and (optionally) demo data. */
export async function seed(db: Db, opts?: { seedDemo?: boolean }) {
  const exists = await db.query('SELECT 1 FROM platform_settings WHERE id = 1');
  if (exists.rows.length) return;
  await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    const again = await q.query('SELECT 1 FROM platform_settings WHERE id = 1');
    if (again.rows.length) return;
    const settings = platformSettingsSchema.parse({});
    await q.query('INSERT INTO platform_settings (id, data) VALUES (1, $1::jsonb)', [JSON.stringify(settings)]);
    const sa = env.superAdmin;
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'SUPER_ADMIN') RETURNING id`,
      [sa.name, sa.email, await hashPassword(sa.password)],
    );
    const adminId = rows[0].id;
    for (const [i, p] of DEFAULT_PRODUCTS.entries()) {
      const { rows: pr } = await q.query<{ id: string }>(
        `INSERT INTO rsa_products (product_code, plan_name, certificate_plan_name, description, vehicle_types, fuel_types,
           max_vehicle_age_years, number_of_services, towing_limit_km, price_includes_gst, special_conditions, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [p.code, p.planName, p.certificatePlanName, p.description, p.vehicleTypes, p.fuelTypes, p.maxVehicleAgeYears,
          p.numberOfServices, p.towingLimitKm, p.priceIncludesGst, p.specialConditions, i, adminId],
      );
      for (const [j, t] of p.terms.entries()) {
        await q.query(
          `INSERT INTO rsa_product_terms (product_id, label, validity_unit, validity_value, price, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
          [pr[0].id, t.label, t.unit, t.value, t.price, j],
        );
      }
      for (const [j, b] of p.benefits.entries()) {
        await q.query(
          `INSERT INTO rsa_benefits (product_id, benefit_name, description, is_applicable, applicable_text, sort_order) VALUES ($1,$2,$3,true,$4,$5)`,
          [pr[0].id, b.name, b.description, b.applicable ?? null, j],
        );
      }
    }
    if (opts?.seedDemo ?? env.seedDemo) await seedDemo(q, settings, adminId);
  });
}

// ---------------------------------------------------------------- demo data (fictional)

function prng(seedValue: number) {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikas', 'Pooja', 'Sachin', 'Anjali', 'Rohit', 'Kavita', 'Suresh', 'Meera', 'Nitin', 'Swati', 'Ganesh', 'Ashwini', 'Prakash', 'Shubham', 'Komal', 'Yogesh', 'Deepak', 'Manisha', 'Ajay', 'Rutuja'];
const LAST = ['Patil', 'Deshmukh', 'Jadhav', 'Pawar', 'Shinde', 'Kulkarni', 'Joshi', 'More', 'Chavan', 'Gaikwad', 'Salunkhe', 'Mane', 'Kadam', 'Bhosale', 'Sawant'];
const AREAS: Record<string, string[]> = {
  Kolhapur: ['Rajarampuri', 'Tarabai Park', 'Shahupuri', 'Kasaba Bawada', 'Ruikar Colony', 'Nagala Park'],
  Pune: ['Kothrud', 'Hadapsar', 'Baner', 'Wakad', 'Aundh', 'Bibwewadi'],
};
const PINCODES: Record<string, string[]> = { Kolhapur: ['416001', '416003', '416008', '416012'], Pune: ['411038', '411028', '411045', '411057', '411007', '411037'] };

const VEHICLES = [
  { type: 'TWO_WHEELER', make: 'Honda', model: 'Activa 6G', variant: 'DLX', fuel: 'PETROL', chassis: 'ME4JF', weight: 4 },
  { type: 'TWO_WHEELER', make: 'Honda', model: 'SP125', variant: 'DLX DISC BRAKE', fuel: 'PETROL', chassis: 'ME4JC', weight: 3 },
  { type: 'TWO_WHEELER', make: 'Hero', model: 'Splendor Plus', variant: 'i3S', fuel: 'PETROL', chassis: 'MBLHA', weight: 3 },
  { type: 'TWO_WHEELER', make: 'TVS', model: 'Jupiter', variant: 'ZX', fuel: 'PETROL', chassis: 'MD626', weight: 2 },
  { type: 'TWO_WHEELER', make: 'Bajaj', model: 'Pulsar 150', variant: 'Twin Disc', fuel: 'PETROL', chassis: 'MD2A1', weight: 2 },
  { type: 'TWO_WHEELER', make: 'Ather', model: '450X', variant: 'Gen 3', fuel: 'ELECTRIC', chassis: 'MEXAT', weight: 1 },
  { type: 'FOUR_WHEELER', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXI', fuel: 'PETROL', chassis: 'MA3EW', weight: 2 },
  { type: 'FOUR_WHEELER', make: 'Hyundai', model: 'Creta', variant: 'SX', fuel: 'DIESEL', chassis: 'MALPC', weight: 1 },
  { type: 'FOUR_WHEELER', make: 'Tata', model: 'Nexon EV', variant: 'Max', fuel: 'ELECTRIC', chassis: 'MAT62', weight: 1 },
  { type: 'THREE_WHEELER', make: 'Bajaj', model: 'RE', variant: 'Compact 4S', fuel: 'CNG', chassis: 'MD2AR', weight: 1 },
];

const PLAN_FOR: Record<string, string[]> = {
  TWO_WHEELER: ['TW-BASIC', 'TW-BASIC', 'TW-STD'],
  FOUR_WHEELER: ['FW-STD', 'FW-PREM'],
  THREE_WHEELER: ['THW-STD'],
};

const DEMO_DEALERS = [
  {
    code: 'SAI-KOP',
    name: 'Sai Motors (Demo)',
    legal: 'Sai Motors Private Limited',
    issuer: 'SAI MOTORS PRIVATE LIMITED',
    office: '1205/A, Station Road, Shahupuri, Kolhapur,\nMaharashtra, India 416001',
    gstin: '27AAACS1234A1Z5',
    address: '1205/A, Station Road, Shahupuri',
    city: 'Kolhapur',
    pincode: '416001',
    phone: '0231-2650000',
    email: 'rsa@saimotors.demo',
    website: 'www.saimotors.demo',
    logo: DEMO_LOGO_SAI,
    rto: 'MH09',
    prefix: null as string | null,
    format: null as string | null,
    conditions: null as string | null,
    customers: 60,
    users: [
      { name: 'Ravi Deshmukh', email: 'admin@saimotors.demo', role: 'DEALER_ADMIN' },
      { name: 'Pooja Shinde', email: 'pooja@saimotors.demo', role: 'DEALER_EMPLOYEE' },
      { name: 'Amit Jadhav', email: 'amit@saimotors.demo', role: 'DEALER_EMPLOYEE' },
    ],
  },
  {
    code: 'SHREE-PUNE',
    name: 'Shree Automobiles (Demo)',
    legal: 'Shree Automobiles LLP',
    issuer: 'SHREE AUTOMOBILES LLP',
    office: 'Plot 42, Pune-Satara Road, Market Yard, Pune,\nMaharashtra, India 411037',
    gstin: '27AAKFS5678B1Z2',
    address: 'Plot 42, Pune-Satara Road, Market Yard',
    city: 'Pune',
    pincode: '411037',
    phone: '020-24260000',
    email: 'rsa@shreeauto.demo',
    website: 'www.shreeauto.demo',
    logo: DEMO_LOGO_SHREE,
    rto: 'MH12',
    prefix: 'SHR',
    format: '{PREFIX}-{YYYY}-{SEQ:6}',
    conditions: '(c) Towing beyond the plan limit is charged at actuals as per the service partner rate card.',
    customers: 45,
    users: [
      { name: 'Neha Joshi', email: 'admin@shreeauto.demo', role: 'DEALER_ADMIN' },
      { name: 'Kiran Pawar', email: 'kiran@shreeauto.demo', role: 'DEALER_EMPLOYEE' },
    ],
  },
];

async function seedDemo(q: Queryable, platform: PlatformSettings, adminId: string) {
  const rnd = prng(20261015);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const chars = (n: number, set = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789') => Array.from({ length: n }, () => set[Math.floor(rnd() * set.length)]).join('');
  const weighted = VEHICLES.flatMap((v) => Array(v.weight).fill(v));
  const passwordHash = await hashPassword(env.demoPassword);
  const today = istDateString();
  const audit = (dealerId: string, user: { id: string; name: string; role: string }, action: string, entityId: string, label: string, at: Date, value?: unknown) =>
    q.query(
      `INSERT INTO audit_logs (dealer_id, user_id, user_name, user_role, action, entity_type, entity_id, entity_label, new_value, created_at)
       VALUES ($1,$2,$3,$4,$5,'policy',$6,$7,$8::jsonb,$9)`,
      [dealerId, user.id, user.name, user.role, action, entityId, label, value === undefined ? null : JSON.stringify(value), at],
    );

  for (const dd of DEMO_DEALERS) {
    const logoBytes = Buffer.from(dd.logo, 'base64');
    const { rows: f } = await q.query<{ id: string }>(
      `INSERT INTO files (kind, mime_type, size_bytes, sha256, content, created_by) VALUES ('LOGO','image/png',$1,$2,$3,$4) RETURNING id`,
      [logoBytes.length, sha256(logoBytes), logoBytes, adminId],
    );
    const { rows: dr } = await q.query(
      `INSERT INTO dealers (dealer_code, dealer_name, legal_name, logo_file_id, issuer_name, servicing_office, gstin, address, city, state,
         pincode, phone, email, website, policy_prefix, policy_number_format, dealer_conditions, allow_custom_conditions, settings, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Maharashtra',$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19, now() - interval '430 days')
       RETURNING *`,
      [dd.code, dd.name, dd.legal, f[0].id, dd.issuer, dd.office, dd.gstin, dd.address, dd.city, dd.pincode, dd.phone, dd.email, dd.website,
        dd.prefix, dd.format, dd.conditions, !!dd.conditions,
        JSON.stringify({ editableSections: ['logo', 'contact', 'notifications', ...(dd.conditions ? ['conditions'] : [])] }), adminId],
    );
    const dealer = dr[0];
    await q.query('UPDATE files SET dealer_id = $1 WHERE id = $2', [dealer.id, f[0].id]);
    await q.query(`INSERT INTO dealer_products (dealer_id, product_id) SELECT $1, id FROM rsa_products`, [dealer.id]);
    if (dd.code === 'SHREE-PUNE') {
      await q.query(
        `INSERT INTO dealer_term_prices (dealer_id, term_id, dealer_price)
         SELECT $1, t.id, 2400 FROM rsa_product_terms t JOIN rsa_products p ON p.id = t.product_id WHERE p.product_code = 'FW-STD'`,
        [dealer.id],
      );
    }
    const users: { id: string; name: string; role: string }[] = [];
    for (const u of dd.users) {
      const { rows } = await q.query<{ id: string }>(
        `INSERT INTO users (dealer_id, name, email, mobile, password_hash, role, permissions, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - interval '420 days') RETURNING id`,
        [dealer.id, u.name, u.email, `9${chars(9, '0123456789')}`, passwordHash, u.role,
          u.role === 'DEALER_EMPLOYEE' ? [...DEFAULT_EMPLOYEE_PERMISSIONS, 'policies.cancel_request', 'policies.endorse'] : [], adminId],
      );
      users.push({ id: rows[0].id, name: u.name, role: u.role });
    }
    const products = await listDealerProducts(q, dealer.id);
    const byCode = (code: string) => products.find((p) => p.productCode === code)!;

    // Customers and vehicles
    interface Planned {
      issuedAt: Date;
      startDate: string;
      customer: any;
      vehicle: any;
      productCode: string;
      termIndex: number;
      renewalKey?: number;
      key: number;
    }
    const planned: Planned[] = [];
    let key = 0;
    for (let i = 0; i < dd.customers; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const created = new Date(Date.now() - int(30, 430) * 86400_000);
      const { rows: cr } = await q.query(
        `INSERT INTO customers (dealer_id, name, dob, mobile, email, address, city, state, pincode, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Maharashtra',$8,$9,$10,$10) RETURNING *`,
        [dealer.id, name.toUpperCase(), `${int(1968, 2002)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
          `${pick(['9', '8', '7'])}${chars(9, '0123456789')}`, rnd() < 0.7 ? `${name.split(' ')[0].toLowerCase()}.${name.split(' ')[1].toLowerCase()}${int(1, 99)}@example.com` : null,
          `${int(1, 250)}, ${pick(['Shivaji Road', 'Main Road', 'Gandhi Nagar', 'Station Road', 'MG Road'])}, ${pick(AREAS[dd.city])}`,
          dd.city, pick(PINCODES[dd.city]), pick(users).id, created],
      );
      const customer = cr[0];
      const vehicleCount = rnd() < 0.25 ? 2 : 1;
      for (let k = 0; k < vehicleCount; k++) {
        const vt = pick(weighted);
        // A few sales today and yesterday so the dashboard shows live activity; the rest spread over ~14 months.
        const daysAgo = i < 3 && k === 0 ? [0, 0, 1][i] : int(0, 420);
        const isNew = daysAgo < 20 && rnd() < 0.6;
        const year = Number(today.slice(0, 4)) - (daysAgo > 365 ? 1 : 0) - (rnd() < 0.2 ? 1 : 0);
        const { rows: vr } = await q.query(
          `INSERT INTO vehicles (dealer_id, customer_id, registration_no, vehicle_type, make, model, variant, engine_no, chassis_no,
             fuel_type, manufacturing_year, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
          [dealer.id, customer.id, isNew ? null : `${dd.rto}${chars(2, 'ABCDEFGHJKLMNPRSTUVWXYZ')}${chars(4, '0123456789')}`, vt.type, vt.make, vt.model, vt.variant,
            chars(12), `${vt.chassis}${chars(12)}`, vt.fuel, year, customer.created_by, created],
        );
        const vehicle = vr[0];
        const code = vt.fuel === 'ELECTRIC' ? 'EV-RSA' : pick(PLAN_FOR[vt.type]);
        const issueDay = addDaysToDateString(today, -daysAgo);
        // Business hours, but never in the future for today's sales.
        const issuedAt = new Date(Math.min(istStartOfDay(issueDay).getTime() + int(10 * 60, 18 * 60) * 60_000, Date.now() - int(5, 90) * 60_000));
        const first: Planned = { issuedAt, startDate: issueDay, customer, vehicle, productCode: code, termIndex: 0, key: key++ };
        planned.push(first);
        if (daysAgo > 372 && rnd() < 0.6) {
          // Renewal around the previous expiry.
          const prevEnd = coveragePeriod(issueDay, 'MONTHS', 12).end;
          const renewDay = addDaysToDateString(istDateString(prevEnd), int(-12, 15));
          if (renewDay <= today) {
            const startDay = renewDay > istDateString(prevEnd) ? renewDay : addDaysToDateString(istDateString(prevEnd), 1);
            planned.push({
              issuedAt: new Date(Math.min(istStartOfDay(renewDay).getTime() + int(10 * 60, 18 * 60) * 60_000, Date.now() - int(5, 90) * 60_000)),
              startDate: startDay,
              customer,
              vehicle,
              productCode: code,
              termIndex: 0,
              renewalKey: first.key,
              key: key++,
            });
          }
        }
      }
    }
    planned.sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());

    const idByKey = new Map<number, { id: string; number: string; status: string }>();
    const recentActive: { id: string; number: string; total: number; user: (typeof users)[number] }[] = [];
    for (const pl of planned) {
      const product = byCode(pl.productCode);
      const term = product.terms[pl.termIndex];
      const { start, end } = coveragePeriod(pl.startDate, term.validityUnit, term.validityValue);
      const renewalOf = pl.renewalKey !== undefined ? idByKey.get(pl.renewalKey) : undefined;
      const ic: IssuanceContext = {
        dealer,
        platform,
        customer: pl.customer,
        vehicle: pl.vehicle,
        product,
        term,
        premium: term.premium!,
        startDate: pl.startDate,
        start,
        end,
        conditions: [platform.standardConditions, product.specialConditions, dealer.allow_custom_conditions ? dealer.dealer_conditions : null]
          .filter(Boolean)
          .join(' '),
        renewalOf: renewalOf ? { id: renewalOf.id } : null,
      };
      const number = await allocatePolicyNumber(q, dealer, platform, pl.issuedAt);
      const daysAgo = (Date.now() - pl.issuedAt.getTime()) / 86400_000;
      const pending = daysAgo < 4 && rnd() < 0.35;
      const status = pending ? 'PAYMENT_PENDING' : 'ACTIVE';
      const user = pick(users);
      const snapshot = buildSnapshot(ic, { policyNumber: number, issuedAt: pl.issuedAt, origin: env.publicBaseUrl });
      const { rows: pr } = await q.query<{ id: string }>(
        `INSERT INTO policies (dealer_id, customer_id, vehicle_id, product_id, term_id, plan_name, start_date, end_date, base_premium, gst_rate,
           gst_amount, total_premium, number_of_services, status, snapshot, policy_number, issued_by, issued_at, renewed_from_policy_id,
           created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$17,$18,$18) RETURNING id`,
        [dealer.id, pl.customer.id, pl.vehicle.id, product.id, term.id, product.planName, start, end, term.premium!.basePremium,
          term.premium!.gstRate, term.premium!.gstAmount, term.premium!.totalPremium, product.numberOfServices, status,
          JSON.stringify(snapshot), number, user.id, pl.issuedAt, renewalOf?.id ?? null],
      );
      const id = pr[0].id;
      if (renewalOf) {
        await q.query(`UPDATE policies SET status = 'RENEWED', renewed_to_policy_id = $2 WHERE id = $1`, [renewalOf.id, id]);
      }
      const method = pick(['UPI', 'UPI', 'CASH', 'CARD', 'NET_BANKING', 'DEALER_ACCOUNT']);
      await q.query(
        `INSERT INTO payments (dealer_id, policy_id, amount, gst_amount, total_amount, payment_method, transaction_id, status, paid_at, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [dealer.id, id, term.premium!.basePremium, term.premium!.gstAmount, term.premium!.totalPremium, method,
          ['UPI', 'CARD', 'NET_BANKING'].includes(method) ? `TXN${chars(10, '0123456789')}` : null,
          pending ? 'PENDING' : 'SUCCESS', pending ? null : pl.issuedAt, user.id, pl.issuedAt],
      );
      await audit(dealer.id, user, 'POLICY_ISSUED', id, number, pl.issuedAt, { plan: product.planName, total: term.premium!.totalPremium, status });
      if (renewalOf) await audit(dealer.id, user, 'POLICY_RENEWED', renewalOf.id, renewalOf.number, pl.issuedAt, { renewedTo: number });
      idByKey.set(pl.key, { id, number, status });
      if (!pending && !renewalOf && daysAgo > 5 && daysAgo < 120) recentActive.push({ id, number, total: term.premium!.totalPremium, user });
    }

    // A few cancellations (approved with refunds) and one pending request for the approval workflow.
    const admin = users[0];
    for (const [i, c] of recentActive.slice(0, 2).entries()) {
      const refund = i === 0 ? c.total : Math.round(c.total * 50) / 100;
      const at = new Date(Date.now() - int(1, 4) * 86400_000);
      await q.query(`UPDATE policies SET status = 'CANCELLED', cancelled_at = $2 WHERE id = $1`, [c.id, at]);
      await q.query(
        `UPDATE payments SET status = $2, refund_amount = $3, refunded_at = $4, refund_reference = $5 WHERE policy_id = $1`,
        [c.id, i === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refund, at, `RF${chars(8, '0123456789')}`],
      );
      await q.query(
        `INSERT INTO policy_cancellations (policy_id, dealer_id, status, reason, requested_by, requested_at, approved_by, decided_at, cancellation_date, refund_amount, payment_status)
         VALUES ($1,$2,'APPROVED',$3,$4,$5,$6,$5,$5,$7,$8)`,
        [c.id, dealer.id, i === 0 ? 'Customer cancelled vehicle booking' : 'Duplicate RSA purchased by customer', c.user.id, at, admin.id, refund,
          i === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED'],
      );
      await audit(dealer.id, admin, 'POLICY_CANCELLED', c.id, c.number, at, { refundAmount: refund });
    }
    const req = recentActive[2];
    if (req && users[1]) {
      await q.query(
        `INSERT INTO policy_cancellations (policy_id, dealer_id, status, reason, requested_by, requested_at) VALUES ($1,$2,'REQUESTED',$3,$4, now() - interval '5 hours')`,
        [req.id, dealer.id, 'Customer requested cancellation within 7 days of purchase', users[1].id],
      );
    }
  }
}
