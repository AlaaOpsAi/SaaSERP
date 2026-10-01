import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { activityRoutes } from './routes/activities.js';
import { authRoutes } from './routes/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { crmRoutes } from './routes/crm.js';
import { delegationRoutes } from './routes/delegations.js';
import { diaryRoutes } from './routes/diary.js';
import { importRoutes } from './routes/import.js';
import { platformRoutes } from './routes/platform.js';
import { reportRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';

// Postgres error codes -> HTTP.
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'A record with the same unique value already exists'],
  '23503': [400, 'A referenced record does not exist'],
  '23514': [400, 'The data breaks a business rule'],
  '22P02': [400, 'Invalid value'],
};

// Plain-language messages for unique constraints.
const UNIQUE_MESSAGES: Record<string, string> = {
  users_tenant_id_email_key: 'Another user in this workspace already uses this email',
  users_tenant_id_code_key: 'Another user in this workspace already uses these initials',
  business_units_tenant_id_code_key: 'A business unit with this code already exists',
  lookups_tenant_id_type_code_key: 'This list already has an entry with that code',
  venues_tenant_id_name_key: 'A venue with this name already exists',
  function_spaces_tenant_id_venue_id_name_key: 'This venue already has a room with that name',
  bookings_tenant_id_booking_no_key: 'A booking with this number already exists',
  tenants_slug_key: 'That workspace ID is already taken',
};

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError | (Error & { code?: string; detail?: string; constraint?: string }), req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', details: err.flatten() });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const constraint = (err as { constraint?: string }).constraint;
    if ((err as { code?: string }).code === '23505' && constraint && UNIQUE_MESSAGES[constraint]) {
      return reply.code(409).send({ error: UNIQUE_MESSAGES[constraint], details: { constraint } });
    }
    const pg = 'code' in err && typeof err.code === 'string' ? PG_ERRORS[err.code] : undefined;
    if (pg) {
      return reply.code(pg[0]).send({ error: pg[1], details: { constraint: (err as { constraint?: string }).constraint } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(settingsRoutes);
      await api.register(crmRoutes);
      await api.register(bookingRoutes);
      await api.register(activityRoutes);
      await api.register(diaryRoutes);
      await api.register(reportRoutes);
      await api.register(importRoutes);
      await api.register(platformRoutes);
      await api.register(delegationRoutes);
    },
    { prefix: '/api' },
  );

  // In production the API also serves the built web app (single deployable).
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: resolve(config.webDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
