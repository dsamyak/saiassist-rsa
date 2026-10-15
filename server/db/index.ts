import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { env } from '../env';
import { migrate } from './migrations';
import { seed } from './seed';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Execute one or more statements without parameters (used for migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  kind: 'pg' | 'pglite';
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Consistent value parsing for both drivers: DATE as 'YYYY-MM-DD', NUMERIC and INT8 as JS numbers.
const PARSERS: Record<number, (v: string) => unknown> = {
  1082: (v) => v,
  1700: (v) => parseFloat(v),
  20: (v) => parseInt(v, 10),
};

export async function createPgDb(connectionString: string): Promise<Db> {
  for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn);
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  pool.on('error', (err) => console.error('[db] idle client error', err.message));
  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query(text, params) {
      const r = await c.query(text, params as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await c.query(sql);
    },
  });
  return {
    kind: 'pg',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn(wrap(client));
        await client.query('COMMIT');
        return res;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  // Imported through a variable so serverless bundlers do not pull the WASM build into production bundles.
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(/* @vite-ignore */ moduleName)) as typeof import('@electric-sql/pglite');
  const parsers: Record<number, (v: string) => unknown> = { ...PARSERS };
  if (dataDir && !dataDir.includes('://')) mkdirSync(dataDir, { recursive: true });
  // A single options object: passing `undefined` as the first argument would drop the options.
  const db = new PGlite({ dataDir, parsers });
  await db.waitReady;
  const wrap = (c: { query: Function; exec: Function }): Queryable => ({
    async query(text, params) {
      const r = await (c.query as any)(text, params ?? []);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    async exec(sql) {
      await (c.exec as any)(sql);
    },
  });
  return {
    kind: 'pglite',
    ...wrap(db as any),
    tx: (fn) => db.transaction((tx: any) => fn(wrap(tx))) as any,
    close: () => db.close(),
  };
}

let dbPromise: Promise<Db> | null = null;

/** Returns the process-wide database, running migrations and the initial seed on first use. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = env.databaseUrl ? await createPgDb(env.databaseUrl) : await createPgliteDb(env.pgliteDir);
      await prepareDb(db);
      return db;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function prepareDb(db: Db, opts?: { seedDemo?: boolean }) {
  await migrate(db);
  await seed(db, opts);
}

/** Allows tests to inject an isolated database. */
export function setDb(db: Db | null) {
  dbPromise = db ? Promise.resolve(db) : null;
}
