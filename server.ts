import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { assertSecurityConfiguration } from './src/security/tokens.ts';
import { assertMediaSourceConfiguration } from './src/services/mediaSources.ts';
import { checkDatabaseConnection, closeDatabaseConnection, getDatabaseTargetInfo } from './src/db/index.ts';
import { seedDemoCatalog } from './src/db/repository.ts';
import { createApiRouter } from './src/routes/api.ts';
import { attachPartyHub } from './src/realtime/partyHub.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) throw new Error('PORT must be an integer between 1 and 65535.');
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.once('finish', () => {
    const safePath = req.path
      .replace(/\/party\/rooms\/[^/]+/g, '/party/rooms/:roomCode')
      .replace(/\/watchlist\/[^/]+/g, '/watchlist/:mediaId')
      .replace(/\/watch-history\/[^/]+/g, '/watch-history/:sessionId')
      .replace(/[\r\n]/g, '')
      .slice(0, 200);
    console.info(`${req.method} ${safePath} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});
app.use(express.json({ limit: '128kb', strict: true }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: 'API route not found.' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const status = (error as { status?: number })?.status === 413 ? 413 : 400;
  res.status(status).json({ error: status === 413 ? 'Request body is too large.' : 'Invalid request.' });
});

const realtime = attachPartyHub(server);

async function startServer() {
  assertSecurityConfiguration();
  assertMediaSourceConfiguration();

  const database = await checkDatabaseConnection();
  if (isProduction && !database.target.configured) {
    throw new Error('DATABASE_URL (or SQL_* settings) must be configured in production.');
  }
  if (isProduction && !database.available) {
    throw new Error(`PostgreSQL is unavailable at startup (${database.errorCode || 'connection_error'}).`);
  }
  if (database.available && process.env.SEED_DEMO_DATA === 'true') await seedDemoCatalog();
  if (!database.available) {
    console.warn(`[STARTUP] PostgreSQL is unavailable (${database.errorCode || 'connection_error'}); persistence routes will return 503.`);
  }

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        ws: { server },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, '../dist');
    app.use(express.static(distPath, { index: false, maxAge: '1h', immutable: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(distPath, 'index.html'), (error) => { if (error) next(error); });
    });
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[HTTP ERROR]', (error as NodeJS.ErrnoException)?.code || 'static_error');
      if (!res.headersSent) res.status(500).send('Server error.');
    });
    server.on('upgrade', (request, socket) => {
      let pathname = '';
      try { pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname; }
      catch { socket.destroy(); return; }
      if (pathname !== '/ws/party' && pathname !== '/ws/live') socket.destroy();
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    const dbTarget = database.target.configured ? `${database.target.host || 'configured host'}:${database.target.port || 5432}` : 'not configured';
    console.info(`CineTogether listening on 0.0.0.0:${PORT} (PostgreSQL ${database.available ? dbTarget : 'unavailable'})`);
  });
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[SHUTDOWN] ${signal}`);
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await realtime.close();
  await closeDatabaseConnection();
  clearTimeout(forceTimer);
}

process.once('SIGTERM', () => { void shutdown('SIGTERM').then(() => process.exit(0)); });
process.once('SIGINT', () => { void shutdown('SIGINT').then(() => process.exit(0)); });

startServer().catch(async (error) => {
  console.error('[STARTUP ERROR]', error instanceof Error ? error.message : 'unknown_error');
  await realtime.close().catch(() => {});
  await closeDatabaseConnection().catch(() => {});
  process.exitCode = 1;
});
