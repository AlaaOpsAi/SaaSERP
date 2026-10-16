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
  webDist: process.env.WEB_DIST ?? '',
  // When false (the default), new workspaces wait for a platform operator.
  autoApproveSignups: process.env.AUTO_APPROVE_SIGNUPS === 'true',
  // Optional incoming-webhook URL (Slack, Teams, Zapier...) pinged on every sign-up.
  signupWebhookUrl: process.env.SIGNUP_WEBHOOK_URL ?? '',
  // Uploaded files (signed contracts, templates, issued documents). Back this folder up with the database.
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  // LibreOffice, to turn issued Word documents into PDF. Without it only the Word file is produced.
  soffice: process.env.SOFFICE_PATH ?? 'soffice',
};
