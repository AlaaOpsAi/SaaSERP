import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { activityRoutes } from './routes/activities.js';
import { authRoutes } from './routes/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { crmRoutes } from './routes/crm.js';
import { diaryRoutes } from './routes/diary.js';
import { importRoutes } from './routes/import.js';
import { reportRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';

// Postgres error codes -> HTTP.
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'A record with the same unique value already exists'],
  '23503': [400, 'A referenced record does not exist'],
  '23514': [400, 'The data breaks a business rule'],
  '22P02': [400, 'Invalid value'],
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
    },
    { prefix: '/api' },
  );

  return app;
}
