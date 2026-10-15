// Applies schema migrations (and the first-run seed) to DATABASE_URL or the embedded database: `npm run db:migrate`
import { getDb } from '../db';
import { env } from '../env';

const db = await getDb();
console.log(`Database ready (${db.kind}${env.databaseUrl ? '' : `, ${env.pgliteDir}`})`);
await db.close();
