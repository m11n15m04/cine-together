import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

const url = process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
const hasSplitConfig = Boolean(
  process.env.SQL_HOST &&
  process.env.SQL_DB_NAME &&
  process.env.SQL_USER &&
  process.env.SQL_PASSWORD
);

const dbCredentials = url
  ? { url }
  : hasSplitConfig
  ? {
      host: process.env.SQL_HOST!,
      port: Number(process.env.SQL_PORT || 5432),
      user: process.env.SQL_ADMIN_USER || process.env.SQL_USER!,
      password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD!,
      database: process.env.SQL_DB_NAME!,
      ssl: process.env.DATABASE_SSL === 'require',
    }
  : undefined;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  ...(dbCredentials ? { dbCredentials } : {}),
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  strict: true,
  verbose: true,
});
