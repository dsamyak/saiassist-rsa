import { z, type ZodError, type ZodTypeAny } from 'zod';
import type { Context } from 'hono';
import { HttpError, badRequest } from './errors';

const humanize = (path: (string | number)[]) =>
  path
    .map((p) => String(p))
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

export function validationError(err: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = err.issues[0];
  const message = first
    ? first.path.length && !first.message.toLowerCase().includes(String(first.path[first.path.length - 1]).toLowerCase())
      ? `${humanize(first.path)}: ${first.message}`
      : first.message
    : 'Invalid input';
  return new HttpError(400, 'VALIDATION_ERROR', message, { fields });
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
}

export async function body<T extends ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  return parse(schema, await readJson(c));
}

export function query<T extends ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query());
}

/** Treats '', undefined and whitespace-only strings as null before applying the schema. */
export const optional = <T extends ZodTypeAny>(schema: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'string') {
      const t = v.trim();
      return t === '' ? null : t;
    }
    return v;
  }, schema.nullable());

export const text = (label: string, max = 200) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long (max ${max} characters)`);

export const mobile = z
  .string({ required_error: 'Mobile number is required' })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number');

export const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => /^[0-9+()\-\s]{6,30}$/.test(v), 'Enter a valid phone number');

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(200);
export const pincode = z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');
export const uuid = z.string().uuid('Invalid identifier');

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
};

/** Upper-cases and strips spaces/hyphens from vehicle identifiers. */
export const identifier = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
    .refine((v) => new RegExp(`^[A-Z0-9]{${min},${max}}$`).test(v), `${label} must be ${min}-${max} letters/digits`);
