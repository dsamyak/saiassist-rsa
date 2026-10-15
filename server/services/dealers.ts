import { z } from 'zod';
import type { Db, Queryable } from '../db';
import type { Ctx } from '../context';
import { audit, diff } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { policyFormatProblem } from '../lib/policyNumber';
import { email, optional, pagination, phone, pincode, text, uuid } from '../lib/validate';
import { DEALER_EDITABLE_SECTIONS, type DealerEditableSection } from '../../shared/constants';
import { decodeImageDataUrl, storeFile } from './files';
import { paginate, toDealer } from './mappers';
import { dealerSettingsSchema, getPlatformSettings, parseDealerSettings } from './settings';
import { createUser, userCreateSchema } from './users';
import { statusConditionSql } from './policySql';

const editableKeys = DEALER_EDITABLE_SECTIONS.map((s) => s.key) as [DealerEditableSection, ...DealerEditableSection[]];

export const dealerProfileSchema = z.object({
  dealerName: text('Dealer name', 160),
  legalName: optional(z.string().max(200)),
  issuerName: optional(z.string().max(200)),
  servicingOffice: optional(z.string().max(500)),
  gstin: optional(
    z
      .string()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'GSTIN must be 15 characters'),
  ),
  address: optional(z.string().max(300)),
  city: optional(z.string().max(80)),
  state: optional(z.string().max(80)),
  pincode: optional(pincode),
  phone: optional(phone),
  email: optional(email),
  website: optional(z.string().max(160)),
  rsaPhone: optional(z.string().max(30)),
  rsaEmail: optional(email),
  rsaWebsite: optional(z.string().max(160)),
  policyPrefix: optional(
    z
      .string()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,8}$/, 'Prefix must be 1-8 letters/digits'),
  ),
  policyNumberFormat: optional(z.string().max(60)),
  dealerConditions: optional(z.string().max(2000)),
  allowCustomConditions: z.boolean().default(false),
  settings: z
    .object({
      fieldRequirements: dealerSettingsSchema.shape.fieldRequirements.optional(),
      notifications: dealerSettingsSchema.shape.notifications.optional(),
      editableSections: z.array(z.enum(editableKeys)).optional(),
    })
    .default({}),
  logo: optional(z.string().max(1_500_000)),
});

export const dealerCreateSchema = dealerProfileSchema.extend({
  dealerCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Dealer code must be 2-20 letters, digits or hyphens'),
  productIds: z.array(uuid).optional(),
  admin: userCreateSchema.pick({ name: true, email: true, mobile: true, password: true }),
});

export const dealerProductsSchema = z.object({
  items: z.array(
    z.object({
      productId: uuid,
      isEnabled: z.boolean(),
      prices: z.array(z.object({ termId: uuid, dealerPrice: z.number().min(0).max(1_000_000).nullable() })).default([]),
    }),
  ),
});

type Profile = z.infer<typeof dealerProfileSchema>;

function validateNumbering(p: Pick<Profile, 'policyNumberFormat'>) {
  if (p.policyNumberFormat) {
    const problem = policyFormatProblem(p.policyNumberFormat);
    if (problem) throw badRequest(problem);
    if (!/\{(PREFIX|DEALER)\}/.test(p.policyNumberFormat)) {
      throw badRequest('A dealer-specific format must include {PREFIX} or {DEALER} so numbers stay unique across dealers');
    }
  }
}

function profileColumns(p: Profile) {
  return {
    dealer_name: p.dealerName,
    legal_name: p.legalName,
    issuer_name: p.issuerName,
    servicing_office: p.servicingOffice,
    gstin: p.gstin,
    address: p.address,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    phone: p.phone,
    email: p.email,
    website: p.website,
    rsa_phone: p.rsaPhone,
    rsa_email: p.rsaEmail,
    rsa_website: p.rsaWebsite,
    policy_prefix: p.policyPrefix,
    policy_number_format: p.policyNumberFormat,
    dealer_conditions: p.dealerConditions,
    allow_custom_conditions: p.allowCustomConditions,
  };
}

async function assertPrefixFree(q: Queryable, prefix: string | null, exceptId?: string) {
  if (!prefix) return;
  const { rows } = await q.query('SELECT 1 FROM dealers WHERE policy_prefix = $1 AND ($2::uuid IS NULL OR id <> $2)', [
    prefix,
    exceptId ?? null,
  ]);
  if (rows.length) throw conflict(`Policy prefix ${prefix} is already used by another dealer`);
}

export async function listDealers(
  q: Queryable,
  f: { search?: string | null; status?: string | null; page: number; pageSize: number },
) {
  const settings = await getPlatformSettings(q);
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.search) {
    params.push(`%${f.search}%`);
    where.push(`(d.dealer_name ILIKE $${params.length} OR d.dealer_code ILIKE $${params.length} OR d.city ILIKE $${params.length})`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`d.status = $${params.length}`);
  }
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await q.query(
    `SELECT d.*, count(*) OVER() AS total_count,
       (SELECT count(*) FROM policies p WHERE p.dealer_id = d.id AND p.status <> 'DRAFT')::int AS policy_count,
       (SELECT count(*) FROM policies p WHERE p.dealer_id = d.id AND ${statusConditionSql('p', 'IN_FORCE', settings.expiringSoonDays)})::int AS active_count,
       (SELECT coalesce(sum(p.total_premium), 0) FROM policies p WHERE p.dealer_id = d.id AND p.status IN ('ACTIVE','RENEWED','CANCELLED','SUSPENDED'))::float8 AS revenue,
       (SELECT count(*) FROM users u WHERE u.dealer_id = d.id)::int AS user_count
     FROM dealers d ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const items = rows.map((r) => ({
    ...toDealer(r),
    stats: { policies: r.policy_count, active: r.active_count, revenue: r.revenue, users: r.user_count },
  }));
  return paginate(items, rows[0]?.total_count ?? 0, f.page, f.pageSize);
}

export async function getDealer(q: Queryable, id: string) {
  const { rows } = await q.query('SELECT * FROM dealers WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Dealer');
  return toDealer(rows[0]);
}

export async function createDealer(db: Db, ctx: Ctx, input: z.infer<typeof dealerCreateSchema>) {
  validateNumbering(input);
  return db.tx(async (q) => {
    const dup = await q.query('SELECT 1 FROM dealers WHERE dealer_code = $1', [input.dealerCode]);
    if (dup.rows.length) throw conflict(`Dealer code ${input.dealerCode} already exists`);
    await assertPrefixFree(q, input.policyPrefix);
    const cols = profileColumns(input);
    const settings = dealerSettingsSchema.parse(input.settings ?? {});
    const { rows } = await q.query(
      `INSERT INTO dealers (dealer_code, ${Object.keys(cols).join(', ')}, settings, created_by)
       VALUES ($1, ${Object.keys(cols).map((_, i) => `$${i + 2}`).join(', ')}, $${Object.keys(cols).length + 2}::jsonb, $${Object.keys(cols).length + 3})
       RETURNING *`,
      [input.dealerCode, ...Object.values(cols), JSON.stringify(settings), ctx.user.id],
    );
    let dealer = rows[0];
    if (input.logo) {
      const img = decodeImageDataUrl(input.logo);
      const fileId = await storeFile(q, { dealerId: dealer.id, kind: 'LOGO', mimeType: img.mimeType, bytes: img.bytes, userId: ctx.user.id });
      dealer = (await q.query('UPDATE dealers SET logo_file_id = $2 WHERE id = $1 RETURNING *', [dealer.id, fileId])).rows[0];
    }
    const productIds =
      input.productIds ?? (await q.query<{ id: string }>(`SELECT id FROM rsa_products WHERE status = 'ACTIVE'`)).rows.map((r) => r.id);
    for (const pid of productIds) {
      await q.query(
        `INSERT INTO dealer_products (dealer_id, product_id, is_enabled) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [dealer.id, pid],
      );
    }
    const admin = await createUser(q, ctx, dealer.id, { ...input.admin, role: 'DEALER_ADMIN', permissions: undefined });
    await audit(q, ctx, {
      action: 'DEALER_CREATED',
      dealerId: dealer.id,
      entityType: 'dealer',
      entityId: dealer.id,
      entityLabel: `${dealer.dealer_code} - ${dealer.dealer_name}`,
      newValue: { ...cols, dealer_code: input.dealerCode, products: productIds.length },
    });
    return { dealer: toDealer(dealer), admin: admin.user, temporaryPassword: admin.temporaryPassword };
  });
}

export async function updateDealer(db: Db, ctx: Ctx, id: string, input: Profile) {
  validateNumbering(input);
  return db.tx(async (q) => {
    const { rows } = await q.query('SELECT * FROM dealers WHERE id = $1 FOR UPDATE', [id]);
    const before = rows[0];
    if (!before) throw notFound('Dealer');
    await assertPrefixFree(q, input.policyPrefix, id);
    const cols = profileColumns(input);
    const prev = parseDealerSettings(before.settings);
    const settings = dealerSettingsSchema.parse({
      fieldRequirements: input.settings?.fieldRequirements ?? prev.fieldRequirements,
      notifications: input.settings?.notifications ?? prev.notifications,
      editableSections: input.settings?.editableSections ?? prev.editableSections,
    });
    let logoId = before.logo_file_id;
    if (input.logo) {
      const img = decodeImageDataUrl(input.logo);
      logoId = await storeFile(q, { dealerId: id, kind: 'LOGO', mimeType: img.mimeType, bytes: img.bytes, userId: ctx.user.id });
    }
    const keys = Object.keys(cols);
    const { rows: updated } = await q.query(
      `UPDATE dealers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, settings = $${keys.length + 2}::jsonb,
         logo_file_id = $${keys.length + 3}, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, ...Object.values(cols), JSON.stringify(settings), logoId],
    );
    const d = diff(before, { ...cols, settings, logo_file_id: logoId });
    if (d.changed) {
      await audit(q, ctx, {
        action: 'DEALER_UPDATED',
        dealerId: id,
        entityType: 'dealer',
        entityId: id,
        entityLabel: `${before.dealer_code} - ${before.dealer_name}`,
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    return toDealer(updated[0]);
  });
}

export async function setDealerStatus(db: Db, ctx: Ctx, id: string, status: 'ACTIVE' | 'INACTIVE') {
  return db.tx(async (q) => {
    const { rows } = await q.query('SELECT * FROM dealers WHERE id = $1', [id]);
    if (!rows[0]) throw notFound('Dealer');
    const { rows: updated } = await q.query('UPDATE dealers SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, status]);
    if (status === 'INACTIVE') {
      await q.query(
        `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE dealer_id = $1)`,
        [id],
      );
    }
    await audit(q, ctx, {
      action: 'DEALER_STATUS_CHANGED',
      dealerId: id,
      entityType: 'dealer',
      entityId: id,
      entityLabel: `${rows[0].dealer_code} - ${rows[0].dealer_name}`,
      oldValue: { status: rows[0].status },
      newValue: { status },
    });
    return toDealer(updated[0]);
  });
}

/** All products with this dealer's enablement and term price overrides (Super Admin view). */
export async function getDealerProductConfig(q: Queryable, dealerId: string) {
  const settings = await getPlatformSettings(q);
  const { rows: products } = await q.query(
    `SELECT p.*, coalesce(dp.is_enabled, false) AS is_enabled
       FROM rsa_products p LEFT JOIN dealer_products dp ON dp.product_id = p.id AND dp.dealer_id = $1
      ORDER BY p.sort_order, p.plan_name`,
    [dealerId],
  );
  const { rows: terms } = await q.query(
    `SELECT t.*, dtp.dealer_price FROM rsa_product_terms t
       LEFT JOIN dealer_term_prices dtp ON dtp.term_id = t.id AND dtp.dealer_id = $1
      ORDER BY t.sort_order, t.validity_value`,
    [dealerId],
  );
  return products.map((p) => ({
    productId: p.id,
    productCode: p.product_code,
    planName: p.plan_name,
    status: p.status,
    isEnabled: p.is_enabled,
    priceIncludesGst: p.price_includes_gst,
    gstRate: p.gst_rate ?? settings.defaultGstRate,
    vehicleTypes: p.vehicle_types,
    terms: terms
      .filter((t) => t.product_id === p.id)
      .map((t) => ({ termId: t.id, label: t.label, status: t.status, basePrice: t.price, dealerPrice: t.dealer_price ?? null })),
  }));
}

export async function setDealerProducts(db: Db, ctx: Ctx, dealerId: string, input: z.infer<typeof dealerProductsSchema>) {
  return db.tx(async (q) => {
    const dealer = await getDealer(q, dealerId);
    for (const item of input.items) {
      const prod = await q.query('SELECT id FROM rsa_products WHERE id = $1', [item.productId]);
      if (!prod.rows.length) throw notFound('Product');
      await q.query(
        `INSERT INTO dealer_products (dealer_id, product_id, is_enabled) VALUES ($1, $2, $3)
         ON CONFLICT (dealer_id, product_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()`,
        [dealerId, item.productId, item.isEnabled],
      );
      for (const pr of item.prices) {
        const term = await q.query('SELECT 1 FROM rsa_product_terms WHERE id = $1 AND product_id = $2', [pr.termId, item.productId]);
        if (!term.rows.length) throw badRequest('Validity option does not belong to the product');
        if (pr.dealerPrice === null) {
          await q.query('DELETE FROM dealer_term_prices WHERE dealer_id = $1 AND term_id = $2', [dealerId, pr.termId]);
        } else {
          await q.query(
            `INSERT INTO dealer_term_prices (dealer_id, term_id, dealer_price) VALUES ($1, $2, $3)
             ON CONFLICT (dealer_id, term_id) DO UPDATE SET dealer_price = EXCLUDED.dealer_price, updated_at = now()`,
            [dealerId, pr.termId, pr.dealerPrice],
          );
        }
      }
    }
    await audit(q, ctx, {
      action: 'DEALER_PRODUCTS_UPDATED',
      dealerId,
      entityType: 'dealer',
      entityId: dealerId,
      entityLabel: `${dealer.dealerCode} - ${dealer.dealerName}`,
      newValue: input.items,
    });
    return getDealerProductConfig(q, dealerId);
  });
}

// ---- Dealer Admin self-service settings ----

export const dealerSelfSchema = z.object({
  logo: optional(z.string().max(1_500_000)),
  address: optional(z.string().max(300)).optional(),
  city: optional(z.string().max(80)).optional(),
  state: optional(z.string().max(80)).optional(),
  pincode: optional(pincode).optional(),
  phone: optional(phone).optional(),
  email: optional(email).optional(),
  website: optional(z.string().max(160)).optional(),
  rsaPhone: optional(z.string().max(30)).optional(),
  rsaEmail: optional(email).optional(),
  rsaWebsite: optional(z.string().max(160)).optional(),
  dealerConditions: optional(z.string().max(2000)).optional(),
  notifications: dealerSettingsSchema.shape.notifications.optional(),
});

const SECTION_FIELDS: Record<DealerEditableSection, string[]> = {
  logo: ['logo'],
  contact: ['address', 'city', 'state', 'pincode', 'phone', 'email', 'website'],
  rsaContact: ['rsaPhone', 'rsaEmail', 'rsaWebsite'],
  conditions: ['dealerConditions'],
  notifications: ['notifications'],
};

const COLUMN: Record<string, string> = {
  address: 'address',
  city: 'city',
  state: 'state',
  pincode: 'pincode',
  phone: 'phone',
  email: 'email',
  website: 'website',
  rsaPhone: 'rsa_phone',
  rsaEmail: 'rsa_email',
  rsaWebsite: 'rsa_website',
  dealerConditions: 'dealer_conditions',
};

export async function updateOwnDealerSettings(db: Db, ctx: Ctx, input: z.infer<typeof dealerSelfSchema>) {
  const dealerId = ctx.user.dealerId!;
  return db.tx(async (q) => {
    const { rows } = await q.query('SELECT * FROM dealers WHERE id = $1 FOR UPDATE', [dealerId]);
    const before = rows[0];
    const settings = parseDealerSettings(before.settings);
    const allowed = new Set(
      settings.editableSections.flatMap((s) => SECTION_FIELDS[s as DealerEditableSection] ?? []),
    );
    if (!before.allow_custom_conditions) allowed.delete('dealerConditions');
    const provided = Object.entries(input).filter(([, v]) => v !== undefined);
    for (const [key] of provided) {
      if (!allowed.has(key)) throw forbidden(`You are not permitted to change ${key}. Contact the platform administrator.`);
    }
    const sets: string[] = [];
    const params: unknown[] = [dealerId];
    const after: Record<string, unknown> = {};
    for (const [key, value] of provided) {
      if (key === 'logo' && value) {
        const img = decodeImageDataUrl(value as string);
        const fileId = await storeFile(q, { dealerId, kind: 'LOGO', mimeType: img.mimeType, bytes: img.bytes, userId: ctx.user.id });
        params.push(fileId);
        sets.push(`logo_file_id = $${params.length}`);
        after.logo_file_id = fileId;
      } else if (key === 'notifications') {
        const next = { ...settings, notifications: { ...settings.notifications, ...(value as object) } };
        params.push(JSON.stringify(next));
        sets.push(`settings = $${params.length}::jsonb`);
        after.settings = next;
      } else if (COLUMN[key]) {
        params.push(value);
        sets.push(`${COLUMN[key]} = $${params.length}`);
        after[COLUMN[key]] = value;
      }
    }
    if (!sets.length) return toDealer(before);
    const { rows: updated } = await q.query(`UPDATE dealers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, params);
    const d = diff(before, after);
    await audit(q, ctx, {
      action: 'DEALER_SETTINGS_UPDATED',
      dealerId,
      entityType: 'dealer',
      entityId: dealerId,
      entityLabel: `${before.dealer_code} - ${before.dealer_name}`,
      oldValue: d.oldValue,
      newValue: d.newValue,
    });
    return toDealer(updated[0]);
  });
}

export const listQuery = z.object({
  search: optional(z.string().max(100)),
  status: optional(z.enum(['ACTIVE', 'INACTIVE'])),
  ...pagination,
});
