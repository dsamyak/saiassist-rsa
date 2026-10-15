import { z } from 'zod';
import type { Queryable } from '../db';
import type { Ctx } from '../context';
import { audit, diff } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { email, identifier, isoDate, mobile, optional, pagination, pincode, text, uuid } from '../lib/validate';
import { isValidDateString, istDateString } from '../lib/dates';
import { FUEL_TYPE_VALUES, VEHICLE_TYPE_VALUES } from '../../shared/constants';
import { assertCan, dealerScope, requireDealer } from '../middleware/auth';
import { paginate, toCustomer, toVehicle } from './mappers';
import { effectiveFieldRequirements, getPlatformSettings } from './settings';
import { statusConditionSql } from './policySql';

export const customerSchema = z.object({
  name: text('Customer name', 120),
  dob: optional(isoDate),
  mobile,
  email: optional(email),
  address: text('Address', 300),
  city: text('City', 80),
  state: text('State', 80),
  pincode,
});
export type CustomerInput = z.infer<typeof customerSchema>;

const currentYear = () => new Date().getFullYear();

export const vehicleSchema = z.object({
  customerId: uuid,
  registrationNo: optional(identifier('Registration number', 4, 12)),
  vehicleType: z.enum(VEHICLE_TYPE_VALUES),
  make: text('Make', 60),
  model: text('Model', 80),
  variant: text('Variant', 120),
  engineNo: optional(identifier('Engine number', 5, 25)),
  chassisNo: optional(identifier('Chassis number', 6, 25)),
  fuelType: z.enum(FUEL_TYPE_VALUES),
  manufacturingYear: z.coerce
    .number()
    .int()
    .min(1980, 'Manufacturing year looks incorrect')
    .refine((y) => y <= currentYear() + 1, 'Manufacturing year cannot be in the future'),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const customerListQuery = z.object({
  search: optional(z.string().max(100)),
  dealerId: optional(uuid),
  ...pagination,
});

export const vehicleListQuery = z.object({
  search: optional(z.string().max(100)),
  customerId: optional(uuid),
  dealerId: optional(uuid),
  ...pagination,
});

async function requirements(q: Queryable, dealerId: string) {
  const platform = await getPlatformSettings(q);
  const { rows } = await q.query('SELECT settings FROM dealers WHERE id = $1', [dealerId]);
  return effectiveFieldRequirements(platform, rows[0]?.settings);
}

function checkCustomerRules(input: CustomerInput, req: Awaited<ReturnType<typeof requirements>>) {
  if (req.customerDob && !input.dob) throw badRequest('Date of birth is required', { fields: { dob: 'Date of birth is required' } });
  if (req.customerEmail && !input.email) throw badRequest('Email is required', { fields: { email: 'Email is required' } });
  if (input.dob) {
    if (!isValidDateString(input.dob)) throw badRequest('Date of birth is not a valid date', { fields: { dob: 'Invalid date' } });
    if (input.dob > istDateString()) throw badRequest('Date of birth cannot be in the future', { fields: { dob: 'Cannot be in the future' } });
    if (input.dob < '1900-01-01') throw badRequest('Date of birth looks incorrect', { fields: { dob: 'Looks incorrect' } });
  }
}

function checkVehicleRules(input: VehicleInput, req: Awaited<ReturnType<typeof requirements>>) {
  if (req.vehicleRegistration && !input.registrationNo) {
    throw badRequest('Registration number is required', { fields: { registrationNo: 'Registration number is required' } });
  }
  if (req.vehicleEngine && !input.engineNo) throw badRequest('Engine number is required', { fields: { engineNo: 'Engine number is required' } });
  if (req.vehicleChassis && !input.chassisNo) throw badRequest('Chassis number is required', { fields: { chassisNo: 'Chassis number is required' } });
}

// ---- Customers ----

export async function listCustomers(q: Queryable, ctx: Ctx, f: z.infer<typeof customerListQuery>) {
  const scope = dealerScope(ctx, f.dealerId);
  const params: unknown[] = [];
  const where: string[] = [];
  if (scope) {
    params.push(scope);
    where.push(`c.dealer_id = $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    const i = params.length;
    where.push(
      `(c.name ILIKE $${i} OR c.mobile LIKE $${i} OR c.email ILIKE $${i} OR c.city ILIKE $${i}
        OR EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND (v.registration_no ILIKE $${i} OR v.chassis_no ILIKE $${i})))`,
    );
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await q.query(
    `SELECT c.*, d.dealer_name, count(*) OVER() AS total_count,
       (SELECT count(*) FROM vehicles v WHERE v.customer_id = c.id)::int AS vehicle_count,
       (SELECT count(*) FROM policies p WHERE p.customer_id = c.id AND p.status <> 'DRAFT')::int AS policy_count
     FROM customers c JOIN dealers d ON d.id = c.dealer_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return paginate(rows.map(toCustomer), rows[0]?.total_count ?? 0, f.page, f.pageSize);
}

export async function loadCustomer(q: Queryable, scope: string | null, id: string) {
  const { rows } = await q.query(
    `SELECT c.*, d.dealer_name FROM customers c JOIN dealers d ON d.id = c.dealer_id WHERE c.id = $1 AND ($2::uuid IS NULL OR c.dealer_id = $2)`,
    [id, scope],
  );
  if (!rows[0]) throw notFound('Customer');
  return rows[0];
}

export async function getCustomer(q: Queryable, ctx: Ctx, id: string) {
  const scope = dealerScope(ctx);
  const c = await loadCustomer(q, scope, id);
  const vehicles = await listVehiclesRaw(q, c.dealer_id, { customerId: id });
  return { ...toCustomer(c), vehicles };
}

export async function createCustomer(q: Queryable, ctx: Ctx, input: CustomerInput) {
  assertCan(ctx, 'customers.create');
  const dealerId = requireDealer(ctx);
  checkCustomerRules(input, await requirements(q, dealerId));
  const { rows } = await q.query(
    `INSERT INTO customers (dealer_id, name, dob, mobile, email, address, city, state, pincode, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [dealerId, input.name, input.dob, input.mobile, input.email, input.address, input.city, input.state, input.pincode, ctx.user.id],
  );
  const c = toCustomer(rows[0]);
  await audit(q, ctx, { action: 'CUSTOMER_CREATED', entityType: 'customer', entityId: c.id, entityLabel: `${c.name} (${c.mobile})`, newValue: input });
  return c;
}

export async function updateCustomer(q: Queryable, ctx: Ctx, id: string, input: CustomerInput) {
  assertCan(ctx, 'customers.update');
  const dealerId = requireDealer(ctx);
  const before = await loadCustomer(q, dealerId, id);
  checkCustomerRules(input, await requirements(q, dealerId));
  const { rows } = await q.query(
    `UPDATE customers SET name = $3, dob = $4, mobile = $5, email = $6, address = $7, city = $8, state = $9, pincode = $10,
       updated_by = $11, updated_at = now()
     WHERE id = $1 AND dealer_id = $2 RETURNING *`,
    [id, dealerId, input.name, input.dob, input.mobile, input.email, input.address, input.city, input.state, input.pincode, ctx.user.id],
  );
  const d = diff(before, {
    name: input.name,
    dob: input.dob,
    mobile: input.mobile,
    email: input.email,
    address: input.address,
    city: input.city,
    state: input.state,
    pincode: input.pincode,
  });
  if (d.changed) {
    await audit(q, ctx, {
      action: 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: id,
      entityLabel: `${input.name} (${input.mobile})`,
      oldValue: d.oldValue,
      newValue: d.newValue,
    });
  }
  return toCustomer(rows[0]);
}

// ---- Vehicles ----

async function listVehiclesRaw(
  q: Queryable,
  scope: string | null,
  f: { customerId?: string | null; search?: string | null; limit?: number; offset?: number },
) {
  const settings = await getPlatformSettings(q);
  const params: unknown[] = [];
  const where: string[] = [];
  if (scope) {
    params.push(scope);
    where.push(`v.dealer_id = $${params.length}`);
  }
  if (f.customerId) {
    params.push(f.customerId);
    where.push(`v.customer_id = $${params.length}`);
  }
  if (f.search) {
    params.push(`%${f.search}%`);
    const i = params.length;
    where.push(
      `(v.registration_no ILIKE $${i} OR v.chassis_no ILIKE $${i} OR v.engine_no ILIKE $${i} OR v.make ILIKE $${i} OR v.model ILIKE $${i} OR c.name ILIKE $${i} OR c.mobile LIKE $${i})`,
    );
  }
  params.push(f.limit ?? 500, f.offset ?? 0);
  const { rows } = await q.query(
    `SELECT v.*, c.name AS customer_name, c.mobile AS customer_mobile, count(*) OVER() AS total_count,
            ap.id AS active_policy_id, ap.policy_number AS active_policy_number, ap.end_date AS active_policy_end, ap.status AS active_policy_status
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
       LEFT JOIN LATERAL (
         SELECT p.id, p.policy_number, p.end_date, p.status FROM policies p
          WHERE p.vehicle_id = v.id AND (${statusConditionSql('p', 'IN_FORCE', settings.expiringSoonDays)} OR p.status = 'PAYMENT_PENDING')
          ORDER BY p.end_date DESC LIMIT 1
       ) ap ON true
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY v.updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return Object.assign(rows.map(toVehicle), { total: rows[0]?.total_count ?? 0 });
}

export async function listVehicles(q: Queryable, ctx: Ctx, f: z.infer<typeof vehicleListQuery>) {
  const scope = dealerScope(ctx, f.dealerId);
  const items = await listVehiclesRaw(q, scope, {
    customerId: f.customerId,
    search: f.search,
    limit: f.pageSize,
    offset: (f.page - 1) * f.pageSize,
  });
  return paginate([...items], items.total, f.page, f.pageSize);
}

export async function loadVehicle(q: Queryable, scope: string | null, id: string) {
  const { rows } = await q.query(
    `SELECT v.*, c.name AS customer_name, c.mobile AS customer_mobile FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.id = $1 AND ($2::uuid IS NULL OR v.dealer_id = $2)`,
    [id, scope],
  );
  if (!rows[0]) throw notFound('Vehicle');
  return rows[0];
}

export async function getVehicle(q: Queryable, ctx: Ctx, id: string) {
  return toVehicle(await loadVehicle(q, dealerScope(ctx), id));
}

async function assertChassisFree(q: Queryable, dealerId: string, chassisNo: string | null, exceptId?: string) {
  if (!chassisNo) return;
  const { rows } = await q.query(
    `SELECT v.id, c.name FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.dealer_id = $1 AND v.chassis_no = $2 AND ($3::uuid IS NULL OR v.id <> $3)`,
    [dealerId, chassisNo, exceptId ?? null],
  );
  if (rows.length) throw conflict(`A vehicle with chassis number ${chassisNo} is already registered (customer: ${rows[0].name})`);
}

export async function createVehicle(q: Queryable, ctx: Ctx, input: VehicleInput) {
  assertCan(ctx, 'vehicles.create');
  const dealerId = requireDealer(ctx);
  await loadCustomer(q, dealerId, input.customerId); // tenant check on the parent record
  checkVehicleRules(input, await requirements(q, dealerId));
  await assertChassisFree(q, dealerId, input.chassisNo);
  const { rows } = await q.query(
    `INSERT INTO vehicles (dealer_id, customer_id, registration_no, vehicle_type, make, model, variant, engine_no, chassis_no,
       fuel_type, manufacturing_year, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
    [
      dealerId,
      input.customerId,
      input.registrationNo,
      input.vehicleType,
      input.make,
      input.model,
      input.variant,
      input.engineNo,
      input.chassisNo,
      input.fuelType,
      input.manufacturingYear,
      ctx.user.id,
    ],
  );
  const v = toVehicle(rows[0]);
  await audit(q, ctx, {
    action: 'VEHICLE_CREATED',
    entityType: 'vehicle',
    entityId: v.id,
    entityLabel: `${v.make} ${v.model} ${v.registrationNo ?? 'New'}`,
    newValue: input,
  });
  return v;
}

export async function updateVehicle(q: Queryable, ctx: Ctx, id: string, input: VehicleInput) {
  assertCan(ctx, 'vehicles.update');
  const dealerId = requireDealer(ctx);
  const before = await loadVehicle(q, dealerId, id);
  if (input.customerId !== before.customer_id) throw badRequest('A vehicle cannot be moved to another customer');
  checkVehicleRules(input, await requirements(q, dealerId));
  await assertChassisFree(q, dealerId, input.chassisNo, id);
  const { rows } = await q.query(
    `UPDATE vehicles SET registration_no = $3, vehicle_type = $4, make = $5, model = $6, variant = $7, engine_no = $8,
       chassis_no = $9, fuel_type = $10, manufacturing_year = $11, updated_by = $12, updated_at = now()
     WHERE id = $1 AND dealer_id = $2 RETURNING *`,
    [
      id,
      dealerId,
      input.registrationNo,
      input.vehicleType,
      input.make,
      input.model,
      input.variant,
      input.engineNo,
      input.chassisNo,
      input.fuelType,
      input.manufacturingYear,
      ctx.user.id,
    ],
  );
  const d = diff(before, {
    registration_no: input.registrationNo,
    vehicle_type: input.vehicleType,
    make: input.make,
    model: input.model,
    variant: input.variant,
    engine_no: input.engineNo,
    chassis_no: input.chassisNo,
    fuel_type: input.fuelType,
    manufacturing_year: input.manufacturingYear,
  });
  if (d.changed) {
    await audit(q, ctx, {
      action: 'VEHICLE_UPDATED',
      entityType: 'vehicle',
      entityId: id,
      entityLabel: `${input.make} ${input.model} ${input.registrationNo ?? 'New'}`,
      oldValue: d.oldValue,
      newValue: d.newValue,
    });
  }
  return toVehicle(rows[0]);
}
