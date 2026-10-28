import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
  var _dbChecked: boolean | undefined;
  var _dbAvailable: boolean | undefined;
}

export interface DatabaseTargetInfo {
  host: string;
  port: number;
  database: string;
  user: string;
  isExplicitlyConfigured: boolean;
}

export function getDatabaseTargetInfo(): DatabaseTargetInfo {
  const host = process.env.SQL_HOST || '127.0.0.1';
  const port = Number(process.env.SQL_PORT || 5432);
  const database = process.env.SQL_DB_NAME || 'postgres';
  const user = process.env.SQL_USER || 'app_user';
  const isExplicitlyConfigured = Boolean(
    process.env.SQL_HOST ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );

  return {
    host,
    port,
    database,
    user,
    isExplicitlyConfigured,
  };
}

export const createPool = (): Pool => {
  if (!global._postgresPool) {
    const target = getDatabaseTargetInfo();
    global._postgresPool = new Pool({
      host: target.host,
      port: target.port,
      user: target.user,
      password: process.env.SQL_PASSWORD || '',
      database: target.database,
      max: 5,
      connectionTimeoutMillis: 2500,
    });

    // Handle pool errors cleanly without crashing or spamming stdout
    global._postgresPool.on('error', (err: any) => {
      // If the database has already been diagnosed as offline, suppress noise
      if (global._dbAvailable === true) {
        console.warn(`[DATABASE WARNING] Background pool error: ${err.code || err.message}`);
      }
    });
  }
  return global._postgresPool;
};

export async function checkDatabaseConnection(): Promise<{
  available: boolean;
  target: DatabaseTargetInfo;
  errorCode?: string;
  errorMessage?: string;
}> {
  const target = getDatabaseTargetInfo();
  const pool = createPool();

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      global._dbAvailable = true;
      global._dbChecked = true;
      return {
        available: true,
        target,
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    global._dbAvailable = false;
    global._dbChecked = true;
    const errorCode = err?.code || 'ECONNREFUSED';
    const errorMessage = err?.message || 'Database connection refused';

    return {
      available: false,
      target,
      errorCode,
      errorMessage,
    };
  }
}

export function isDatabaseAvailable(): boolean {
  return global._dbAvailable === true;
}

const pool = createPool();

export const db = drizzle(pool, { schema });
