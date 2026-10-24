import { buildApp } from './app.js';
import { config } from './config.js';
import { checkAllExpiries } from './lib/hr.js';

const app = await buildApp({ logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });

// HR module: expiry alerts (civil ID, passport, work permit …), checked shortly after start and every 6 hours.
setTimeout(() => void checkAllExpiries(), 60_000).unref();
setInterval(() => void checkAllExpiries(), 6 * 3600_000).unref();
