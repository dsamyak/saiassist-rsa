import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { notFound } from '../lib/errors';
import { body, query, readJson, uuid } from '../lib/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createDealer,
  dealerCreateSchema,
  dealerProductsSchema,
  dealerProfileSchema,
  getDealer,
  getDealerProductConfig,
  listDealers,
  listQuery,
  setDealerProducts,
  setDealerStatus,
  updateDealer,
} from '../services/dealers';
import { createProduct, getProduct, listProducts, productSchema, updateProduct } from '../services/products';
import { getPlatformSettings } from '../services/settings';
import { templatePreview, updatePlatformSettings } from '../services/platform';
import { createUser, listUsers, resetPassword, updateUser, userCreateSchema, userUpdateSchema } from '../services/users';
import { adminDashboard } from '../services/reports';
import { pdfResponse } from './helpers';

const idParam = (c: any) => {
  const r = uuid.safeParse(c.req.param('id'));
  if (!r.success) throw notFound();
  return r.data;
};

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireRole('SUPER_ADMIN'))
  .get('/dashboard', async (c) => c.json(await adminDashboard(c.get('db'), c.get('ctx'))))

  // Dealers
  .get('/dealers', async (c) => c.json(await listDealers(c.get('db'), query(c, listQuery))))
  .post('/dealers', async (c) => c.json(await createDealer(c.get('db'), c.get('ctx'), await body(c, dealerCreateSchema)), 201))
  .get('/dealers/:id', async (c) => {
    const db = c.get('db');
    const id = idParam(c);
    const [dealer, users] = [await getDealer(db, id), await listUsers(db, { dealerId: id })];
    return c.json({ ...dealer, users });
  })
  .put('/dealers/:id', async (c) => c.json(await updateDealer(c.get('db'), c.get('ctx'), idParam(c), await body(c, dealerProfileSchema))))
  .patch('/dealers/:id/status', async (c) => {
    const { status } = await body(c, z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }));
    return c.json(await setDealerStatus(c.get('db'), c.get('ctx'), idParam(c), status));
  })
  .get('/dealers/:id/products', async (c) => c.json(await getDealerProductConfig(c.get('db'), idParam(c))))
  .put('/dealers/:id/products', async (c) =>
    c.json(await setDealerProducts(c.get('db'), c.get('ctx'), idParam(c), await body(c, dealerProductsSchema))),
  )
  .post('/dealers/:id/users', async (c) => {
    const id = idParam(c);
    await getDealer(c.get('db'), id);
    return c.json(await createUser(c.get('db'), c.get('ctx'), id, await body(c, userCreateSchema)), 201);
  })
  .get('/dealers/:id/certificate-preview', async (c) => {
    const db = c.get('db');
    const { rows } = await db.query('SELECT * FROM dealers WHERE id = $1', [idParam(c)]);
    if (!rows[0]) throw notFound('Dealer');
    return pdfResponse(c, await templatePreview(db, { dealer: rows[0] }), 'sample-certificate.pdf');
  })

  // Platform users (Super Admins) and any user by id
  .get('/users', async (c) => c.json(await listUsers(c.get('db'), { dealerId: null, superAdmins: true })))
  .post('/users', async (c) =>
    c.json(await createUser(c.get('db'), c.get('ctx'), null, { ...(await body(c, userCreateSchema)), role: 'SUPER_ADMIN' }), 201),
  )
  .put('/users/:id', async (c) => c.json(await updateUser(c.get('db'), c.get('ctx'), idParam(c), await body(c, userUpdateSchema))))
  .post('/users/:id/reset-password', async (c) => c.json(await resetPassword(c.get('db'), c.get('ctx'), idParam(c))))

  // RSA products
  .get('/rsa/products', async (c) => c.json(await listProducts(c.get('db'))))
  .get('/rsa/products/:id', async (c) => c.json(await getProduct(c.get('db'), idParam(c))))
  .post('/rsa/products', async (c) => c.json(await createProduct(c.get('db'), c.get('ctx'), await body(c, productSchema)), 201))
  .put('/rsa/products/:id', async (c) => c.json(await updateProduct(c.get('db'), c.get('ctx'), idParam(c), await body(c, productSchema))))

  // Platform settings & certificate template
  .get('/settings', async (c) => c.json(await getPlatformSettings(c.get('db'))))
  .put('/settings', async (c) => c.json(await updatePlatformSettings(c.get('db'), c.get('ctx'), await readJson(c))))
  .post('/settings/preview', async (c) =>
    pdfResponse(c, await templatePreview(c.get('db'), { patch: await readJson(c) }), 'template-preview.pdf'),
  );
