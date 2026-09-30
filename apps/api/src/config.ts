import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://saaserp_app:saaserp_app@localhost:5432/saaserp'),
  migrationDatabaseUrl: required(
    'MIGRATION_DATABASE_URL',
    'postgres://saaserp_owner:saaserp_owner@localhost:5432/saaserp',
  ),
  appDbRole: process.env.APP_DB_ROLE ?? 'saaserp_app',
  jwtSecret: isProd ? required('JWT_SECRET') : (process.env.JWT_SECRET ?? 'dev-secret-change-me'),
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
