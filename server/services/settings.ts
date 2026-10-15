import { z } from 'zod';
import type { Queryable } from '../db';

export const DEFAULT_CONDITIONS =
  '(a) All additional expenses regarding replacement of a part, additional Fuel and any other service which does not form a part of the standard services provided would be on chargeable basis to the Certificate holder. (b) This Certificate is valid subject to realisation of the payment and is effective from the Payment realisation date or certificate issue date, whichever is later';

const fieldRequirements = z.object({
  customerDob: z.boolean().default(false),
  customerEmail: z.boolean().default(false),
  vehicleRegistration: z.boolean().default(false),
  vehicleEngine: z.boolean().default(true),
  vehicleChassis: z.boolean().default(true),
});

const notificationPrefs = z.object({
  email: z.boolean().default(true),
  sms: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
});

export const certificateTemplateSchema = z.object({
  title: z.string().trim().min(1).max(80).default('Tax Invoice cum Certificate Number'),
  showQr: z.boolean().default(true),
  showCompanyName: z.boolean().default(false),
  showDob: z.boolean().default(true),
  showGstin: z.boolean().default(true),
  borderColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#d2d2d2'),
  conditionsHeading: z.string().trim().max(120).default('Special Conditions (applicable to all coverages):'),
  footerNote: z
    .string()
    .trim()
    .max(300)
    .default('This is a computer generated certificate and does not require a physical signature.'),
});

export const platformSettingsSchema = z.object({
  platformName: z.string().trim().min(1).max(80).default('SaiAssist RSA'),
  rsaBrandName: z.string().trim().min(1).max(80).default('SaiAssist'),
  rsaPhone: z.string().trim().max(30).default('1800-000-0000'),
  rsaEmail: z.string().trim().max(120).default('care@saiassist.example'),
  rsaWebsite: z.string().trim().max(120).default('www.saiassist.example'),
  defaultIssuerName: z.string().trim().max(160).default('SaiAssist Roadside Services'),
  defaultServicingOffice: z.string().trim().max(400).default('Registered Office, Maharashtra, India'),
  defaultGstRate: z.number().min(0).max(40).default(18),
  policyPrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{0,8}$/)
    .default('SA'),
  policyNumberFormat: z.string().trim().default('{PREFIX}{YYYY}{MM}{DD}{SEQ:5}'),
  policySequenceStart: z.number().int().min(1).default(1),
  expiringSoonDays: z.number().int().min(1).max(180).default(30),
  maxFutureStartDays: z.number().int().min(0).max(365).default(30),
  standardConditions: z.string().trim().max(3000).default(DEFAULT_CONDITIONS),
  certificate: certificateTemplateSchema.default({}),
  fieldRequirements: fieldRequirements.default({}),
  notifications: notificationPrefs.default({}),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const dealerSettingsSchema = z.object({
  fieldRequirements: fieldRequirements.partial().default({}),
  notifications: notificationPrefs.partial().default({}),
  editableSections: z.array(z.string()).default(['logo', 'contact', 'notifications']),
});
export type DealerSettings = z.infer<typeof dealerSettingsSchema>;

/** Deep-merges a partial update into the current settings and validates the result. */
export function mergeSettings(current: PlatformSettings, patch: unknown): PlatformSettings {
  const p = (patch ?? {}) as Record<string, any>;
  return platformSettingsSchema.parse({
    ...current,
    ...p,
    certificate: { ...current.certificate, ...(p.certificate ?? {}) },
    fieldRequirements: { ...current.fieldRequirements, ...(p.fieldRequirements ?? {}) },
    notifications: { ...current.notifications, ...(p.notifications ?? {}) },
  });
}

export async function getPlatformSettings(q: Queryable): Promise<PlatformSettings> {
  const { rows } = await q.query<{ data: unknown }>('SELECT data FROM platform_settings WHERE id = 1');
  const parsed = platformSettingsSchema.safeParse(rows[0]?.data ?? {});
  return parsed.success ? parsed.data : platformSettingsSchema.parse({});
}

export function parseDealerSettings(raw: unknown): DealerSettings {
  const r = dealerSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : dealerSettingsSchema.parse({});
}

export function effectiveFieldRequirements(platform: PlatformSettings, dealerRaw: unknown) {
  const d = parseDealerSettings(dealerRaw);
  return { ...platform.fieldRequirements, ...stripUndefined(d.fieldRequirements) };
}

export function effectiveNotifications(platform: PlatformSettings, dealerRaw: unknown) {
  const d = parseDealerSettings(dealerRaw);
  return { ...platform.notifications, ...stripUndefined(d.notifications) };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
