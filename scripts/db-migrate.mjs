import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
const hasSplitConfig = Boolean(
  process.env.SQL_HOST?.trim()
  && process.env.SQL_DB_NAME?.trim()
  && process.env.SQL_USER?.trim()
  && process.env.SQL_PASSWORD
);

if (!connectionString && !hasSplitConfig) {
  console.error('Database migration requires DATABASE_URL or complete SQL_* connection settings.');
  process.exit(1);
}

const ssl = process.env.DATABASE_SSL === 'require'
  ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : undefined;
const pool = new Pool(connectionString
  ? {
      connectionString,
      ssl,
      max: 1,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
      application_name: 'cinetogether-migrations',
    }
  : {
      host: process.env.SQL_HOST,
      port: Number(process.env.SQL_PORT || 5432),
      user: process.env.SQL_ADMIN_USER || process.env.SQL_USER,
      password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl,
      max: 1,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
      application_name: 'cinetogether-migrations',
    });

try {
  const db = drizzle(pool);
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(db, {
    migrationsFolder: path.resolve(migrationsFolder),
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations',
  });
  console.info('CineTogether database migrations applied successfully.');
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'migration_error';
  const message = error instanceof Error ? error.message : 'Unknown migration failure.';
  console.error(`[DB MIGRATION ERROR] ${code}: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
