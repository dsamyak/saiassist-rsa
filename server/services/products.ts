import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Ctx } from '../context';
import { audit, diff } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { calculatePremium } from '../lib/money';
import { optional, text, uuid } from '../lib/validate';
import { FUEL_TYPE_VALUES, VEHICLE_TYPE_VALUES, fuelTypeLabel, vehicleTypeLabel } from '../../shared/constants';
import { getPlatformSettings, type PlatformSettings } from './settings';

export const productSchema = z.object({
  productCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Product code must be 2-20 letters, digits or hyphens'),
  planName: text('Plan name', 120),
  certificatePlanName: optional(z.string().max(60)),
  description: optional(z.string().max(1000)),
  vehicleTypes: z.array(z.enum(VEHICLE_TYPE_VALUES)).min(1, 'Select at least one vehicle type'),
  fuelTypes: z.array(z.enum(FUEL_TYPE_VALUES)).default([]),
  maxVehicleAgeYears: z.number().int().min(0).max(50).nullable().default(null),
  numberOfServices: z.number().int().min(0).max(99),
  towingLimitKm: z.number().int().min(0).max(5000).nullable().default(null),
  gstRate: z.number().min(0).max(40).nullable().default(null),
  priceIncludesGst: z.boolean().default(true),
  specialConditions: optional(z.string().max(2000)),
  eligibilityNotes: optional(z.string().max(1000)),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  sortOrder: z.number().int().default(0),
  terms: z
    .array(
      z.object({
        id: uuid.optional(),
        label: text('Validity label', 40),
        validityUnit: z.enum(['DAYS', 'MONTHS']),
        validityValue: z.number().int().min(1).max(120),
        price: z.number().min(0).max(1_000_000),
        status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
      }),
    )
    .min(1, 'Add at least one validity option'),
  benefits: z
    .array(
      z.object({
        name: text('Benefit name', 120),
        description: z.string().trim().max(500).default(''),
        isApplicable: z.boolean().default(true),
        applicableText: optional(z.string().max(40)),
      }),
    )
    .min(1, 'Add at least one benefit'),
  enableForAllDealers: z.boolean().optional(),
});
export type ProductInput = z.infer<typeof productSchema>;

export interface TermView {
  id: string;
  label: string;
  validityUnit: 'DAYS' | 'MONTHS';
  validityValue: number;
  price: number;
  status: string;
  dealerPrice?: number | null;
  effectivePrice?: number;
  premium?: ReturnType<typeof calculatePremium>;
}

export interface ProductView {
  id: string;
  productCode: string;
  planName: string;
  certificatePlanName: string | null;
  description: string | null;
  vehicleTypes: string[];
  fuelTypes: string[];
  maxVehicleAgeYears: number | null;
  numberOfServices: number;
  towingLimitKm: number | null;
  gstRate: number | null;
  effectiveGstRate: number;
  priceIncludesGst: boolean;
  specialConditions: string | null;
  eligibilityNotes: string | null;
  status: string;
  sortOrder: number;
  terms: TermView[];
  benefits: { id: string; name: string; description: string; isApplicable: boolean; applicableText: string | null }[];
  dealerCount?: number;
  policyCount?: number;
}

function toProduct(r: any, terms: any[], benefits: any[], settings: PlatformSettings): ProductView {
  return {
    id: r.id,
    productCode: r.product_code,
    planName: r.plan_name,
    certificatePlanName: r.certificate_plan_name,
    description: r.description,
    vehicleTypes: r.vehicle_types,
    fuelTypes: r.fuel_types ?? [],
    maxVehicleAgeYears: r.max_vehicle_age_years,
    numberOfServices: r.number_of_services,
    towingLimitKm: r.towing_limit_km,
    gstRate: r.gst_rate,
    effectiveGstRate: r.gst_rate ?? settings.defaultGstRate,
    priceIncludesGst: r.price_includes_gst,
    specialConditions: r.special_conditions,
    eligibilityNotes: r.eligibility_notes,
    status: r.status,
    sortOrder: r.sort_order,
    terms: terms
      .filter((t) => t.product_id === r.id)
      .map((t) => ({
        id: t.id,
        label: t.label,
        validityUnit: t.validity_unit,
        validityValue: t.validity_value,
        price: t.price,
        status: t.status,
        ...(t.dealer_price !== undefined ? { dealerPrice: t.dealer_price } : {}),
      })),
    benefits: benefits
      .filter((b) => b.product_id === r.id)
      .map((b) => ({ id: b.id, name: b.benefit_name, description: b.description, isApplicable: b.is_applicable, applicableText: b.applicable_text })),
    dealerCount: r.dealer_count ?? undefined,
    policyCount: r.policy_count ?? undefined,
  };
}

export async function listProducts(q: Queryable, opts: { productId?: string } = {}) {
  const settings = await getPlatformSettings(q);
  const where = opts.productId ? 'WHERE p.id = $1' : '';
  const params = opts.productId ? [opts.productId] : [];
  const { rows } = await q.query(
    `SELECT p.*,
       (SELECT count(*) FROM dealer_products dp WHERE dp.product_id = p.id AND dp.is_enabled)::int AS dealer_count,
       (SELECT count(*) FROM policies x WHERE x.product_id = p.id AND x.status <> 'DRAFT')::int AS policy_count
     FROM rsa_products p ${where} ORDER BY p.sort_order, p.plan_name`,
    params,
  );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const { rows: terms } = await q.query(
    `SELECT * FROM rsa_product_terms WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order, validity_value`,
    [ids],
  );
  const { rows: benefits } = await q.query(`SELECT * FROM rsa_benefits WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order`, [ids]);
  return rows.map((r) => toProduct(r, terms, benefits, settings));
}

export async function getProduct(q: Queryable, id: string) {
  const [p] = await listProducts(q, { productId: id });
  if (!p) throw notFound('Product');
  return p;
}

async function writeChildren(q: Queryable, productId: string, input: ProductInput) {
  const { rows: existing } = await q.query<{ id: string }>('SELECT id FROM rsa_product_terms WHERE product_id = $1', [productId]);
  const existingIds = new Set(existing.map((t) => t.id));
  const kept = new Set<string>();
  for (const [i, t] of input.terms.entries()) {
    if (t.id && existingIds.has(t.id)) {
      kept.add(t.id);
      await q.query(
        `UPDATE rsa_product_terms SET label = $2, validity_unit = $3, validity_value = $4, price = $5, status = $6, sort_order = $7, updated_at = now() WHERE id = $1`,
        [t.id, t.label, t.validityUnit, t.validityValue, t.price, t.status, i],
      );
    } else {
      await q.query(
        `INSERT INTO rsa_product_terms (product_id, label, validity_unit, validity_value, price, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [productId, t.label, t.validityUnit, t.validityValue, t.price, t.status, i],
      );
    }
  }
  // Terms referenced by issued policies are never deleted, only deactivated.
  for (const id of existingIds) {
    if (!kept.has(id)) await q.query(`UPDATE rsa_product_terms SET status = 'INACTIVE', updated_at = now() WHERE id = $1`, [id]);
  }
  await q.query('DELETE FROM rsa_benefits WHERE product_id = $1', [productId]);
  for (const [i, b] of input.benefits.entries()) {
    await q.query(
      `INSERT INTO rsa_benefits (product_id, benefit_name, description, is_applicable, applicable_text, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
      [productId, b.name, b.description, b.isApplicable, b.applicableText, i],
    );
  }
}

const productCols = (p: ProductInput) => [
  p.planName,
  p.certificatePlanName,
  p.description,
  p.vehicleTypes,
  p.fuelTypes,
  p.maxVehicleAgeYears,
  p.numberOfServices,
  p.towingLimitKm,
  p.gstRate,
  p.priceIncludesGst,
  p.specialConditions,
  p.eligibilityNotes,
  p.status,
  p.sortOrder,
];

export async function createProduct(db: Db, ctx: Ctx, input: ProductInput) {
  return db.tx(async (q) => {
    const dup = await q.query('SELECT 1 FROM rsa_products WHERE product_code = $1', [input.productCode]);
    if (dup.rows.length) throw conflict(`Product code ${input.productCode} already exists`);
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO rsa_products (product_code, plan_name, certificate_plan_name, description, vehicle_types, fuel_types,
         max_vehicle_age_years, number_of_services, towing_limit_km, gst_rate, price_includes_gst, special_conditions,
         eligibility_notes, status, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [input.productCode, ...productCols(input), ctx.user.id],
    );
    const id = rows[0].id;
    await writeChildren(q, id, input);
    if (input.enableForAllDealers) {
      await q.query(
        `INSERT INTO dealer_products (dealer_id, product_id, is_enabled) SELECT id, $1, true FROM dealers ON CONFLICT DO NOTHING`,
        [id],
      );
    }
    const product = await getProduct(q, id);
    await audit(q, ctx, {
      action: 'PRODUCT_CREATED',
      dealerId: null,
      entityType: 'product',
      entityId: id,
      entityLabel: `${product.productCode} - ${product.planName}`,
      newValue: product,
    });
    return product;
  });
}

export async function updateProduct(db: Db, ctx: Ctx, id: string, input: ProductInput) {
  return db.tx(async (q) => {
    const before = await getProduct(q, id);
    const dup = await q.query('SELECT 1 FROM rsa_products WHERE product_code = $1 AND id <> $2', [input.productCode, id]);
    if (dup.rows.length) throw conflict(`Product code ${input.productCode} already exists`);
    await q.query(
      `UPDATE rsa_products SET product_code = $2, plan_name = $3, certificate_plan_name = $4, description = $5, vehicle_types = $6,
         fuel_types = $7, max_vehicle_age_years = $8, number_of_services = $9, towing_limit_km = $10, gst_rate = $11,
         price_includes_gst = $12, special_conditions = $13, eligibility_notes = $14, status = $15, sort_order = $16,
         updated_by = $17, updated_at = now()
       WHERE id = $1`,
      [id, input.productCode, ...productCols(input), ctx.user.id],
    );
    await writeChildren(q, id, input);
    if (input.enableForAllDealers) {
      await q.query(
        `INSERT INTO dealer_products (dealer_id, product_id, is_enabled) SELECT id, $1, true FROM dealers
         ON CONFLICT (dealer_id, product_id) DO UPDATE SET is_enabled = true, updated_at = now()`,
        [id],
      );
    }
    const after = await getProduct(q, id);
    const strip = ({ dealerCount, policyCount, ...rest }: ProductView) => rest;
    const d = diff(strip(before), strip(after));
    await audit(q, ctx, {
      action: 'PRODUCT_UPDATED',
      dealerId: null,
      entityType: 'product',
      entityId: id,
      entityLabel: `${after.productCode} - ${after.planName}`,
      oldValue: d.oldValue,
      newValue: d.newValue,
    });
    return after;
  });
}

// ---- Dealer-facing catalogue ----

export interface VehicleForEligibility {
  vehicle_type: string;
  fuel_type: string;
  manufacturing_year: number;
}

export function checkEligibility(p: ProductView, v: VehicleForEligibility, now = new Date()) {
  const reasons: string[] = [];
  if (!p.vehicleTypes.includes(v.vehicle_type)) {
    reasons.push(`Only for ${p.vehicleTypes.map(vehicleTypeLabel).join(' / ')}`);
  }
  if (p.fuelTypes.length && !p.fuelTypes.includes(v.fuel_type)) {
    reasons.push(`Only for ${p.fuelTypes.map(fuelTypeLabel).join(' / ')} vehicles`);
  }
  if (p.maxVehicleAgeYears !== null) {
    const age = now.getFullYear() - v.manufacturing_year;
    if (age > p.maxVehicleAgeYears) reasons.push(`Vehicle must be at most ${p.maxVehicleAgeYears} years old`);
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Products enabled for the dealer, with effective (dealer-specific) prices and premium breakup per term. */
export async function listDealerProducts(q: Queryable, dealerId: string, opts: { includeDisabledTerms?: boolean } = {}) {
  const settings = await getPlatformSettings(q);
  const { rows } = await q.query(
    `SELECT p.* FROM rsa_products p JOIN dealer_products dp ON dp.product_id = p.id AND dp.dealer_id = $1 AND dp.is_enabled
      WHERE p.status = 'ACTIVE' ORDER BY p.sort_order, p.plan_name`,
    [dealerId],
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { rows: terms } = await q.query(
    `SELECT t.*, dtp.dealer_price FROM rsa_product_terms t
       LEFT JOIN dealer_term_prices dtp ON dtp.term_id = t.id AND dtp.dealer_id = $2
      WHERE t.product_id = ANY($1::uuid[]) ${opts.includeDisabledTerms ? '' : `AND t.status = 'ACTIVE'`}
      ORDER BY t.sort_order, t.validity_value`,
    [ids, dealerId],
  );
  const { rows: benefits } = await q.query(`SELECT * FROM rsa_benefits WHERE product_id = ANY($1::uuid[]) ORDER BY sort_order`, [ids]);
  return rows
    .map((r) => toProduct(r, terms, benefits, settings))
    .map((p) => ({
      ...p,
      terms: p.terms.map((t) => {
        const effectivePrice = t.dealerPrice ?? t.price;
        return { ...t, effectivePrice, premium: calculatePremium(effectivePrice, p.priceIncludesGst, p.effectiveGstRate) };
      }),
    }))
    .filter((p) => p.terms.length > 0);
}

export async function getDealerProduct(q: Queryable, dealerId: string, productId: string) {
  const products = await listDealerProducts(q, dealerId);
  const p = products.find((x) => x.id === productId);
  if (!p) throw badRequest('This RSA product is not available for your dealership');
  return p;
}
