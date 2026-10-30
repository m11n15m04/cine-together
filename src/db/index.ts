import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _dbChecked: boolean | undefined;
  var _dbAvailable: boolean | undefined;
}

export interface DatabaseTargetInfo {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  source: 'DATABASE_URL' | 'POSTGRES_URL' | 'SQL_*' | 'missing';
}

function connectionString(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

export function getDatabaseTargetInfo(): DatabaseTargetInfo {
  const url = connectionString();
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        configured: true,
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 5432,
        database: parsed.pathname.replace(/^\//, '') || undefined,
        source: process.env.DATABASE_URL ? 'DATABASE_URL' : 'POSTGRES_URL',
      };
    } catch {
      return { configured: false, source: 'DATABASE_URL' };
    }
  }

  const host = process.env.SQL_HOST?.trim();
  const database = process.env.SQL_DB_NAME?.trim();
  const user = process.env.SQL_USER?.trim();
  const configured = Boolean(host && database && user);
  return {
    configured,
    host,
    port: Number(process.env.SQL_PORT || 5432),
    database,
    source: configured ? 'SQL_*' : 'missing',
  };
}

function poolConfig(): PoolConfig {
  const url = connectionString();
  const ssl = process.env.DATABASE_SSL === 'require'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : undefined;
  const shared: PoolConfig = {
    max: Number(process.env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
    idleTimeoutMillis: 30000,
    application_name: 'cinetogether',
  };
  if (url) return { ...shared, connectionString: url, ssl };

  return {
    ...shared,
    host: process.env.SQL_HOST,
    port: Number(process.env.SQL_PORT || 5432),
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl,
  };
}

export function createPool(): Pool {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(poolConfig());
    global._postgresPool.on('error', (err: NodeJS.ErrnoException) => {
      console.warn(`[DATABASE WARNING] Idle pool error: ${err.code || 'connection_error'}`);
    });
  }
  return global._postgresPool;
}

export async function checkDatabaseConnection(): Promise<{
  available: boolean;
  target: DatabaseTargetInfo;
  errorCode?: string;
}> {
  const target = getDatabaseTargetInfo();
  if (!target.configured) {
    global._dbAvailable = false;
    global._dbChecked = true;
    return { available: false, target, errorCode: 'DATABASE_NOT_CONFIGURED' };
  }

  try {
    await createPool().query('SELECT 1');
    global._dbAvailable = true;
    global._dbChecked = true;
    return { available: true, target };
  } catch (err) {
    global._dbAvailable = false;
    global._dbChecked = true;
    const errorCode = (err as NodeJS.ErrnoException)?.code || 'DATABASE_UNAVAILABLE';
    return { available: false, target, errorCode };
  }
}

export function isDatabaseAvailable(): boolean {
  return global._dbAvailable === true;
}

export async function closeDatabaseConnection(): Promise<void> {
  const pool = global._postgresPool;
  global._postgresPool = undefined;
  global._dbAvailable = false;
  global._dbChecked = false;
  if (pool) await pool.end();
}

const pool = createPool();

export const db = drizzle(pool, { schema });
