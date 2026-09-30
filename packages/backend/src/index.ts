import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { seedDatabase } from './db/seed.js';
import { validateProductionSecrets, loadLocalEnvFile } from './config/env.js';
import { DailyMarketResearchScheduler } from './scheduler/daily-research-scheduler.js';

// Safely load local .env or .env.local if present
loadLocalEnvFile();

// Enforce production secret validation
try {
  validateProductionSecrets();
} catch (err: any) {
  console.warn(`\n⚠️ CONFIGURATION WARNING: ${err.message}\nAI generation and autonomous research will be inactive until valid credentials are added.\n`);
  if (process.env.STRICT_SECRET_EXIT === 'true') {
    process.exit(1);
  }
}

const app = new Hono();

// Enable CORS for frontend
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-business-id', 'x-user-id', 'x-test-mode', 'bypass-tunnel-reminder']
}));

// Request Logger
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[HTTP] ${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`);
});

// Health endpoint for stability verification
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'ai-marketing-organization'
  });
});

// Mount domain routes under /api/v1
app.route('/api/v1', apiRouter);

// Static frontend assets and public landing page routing
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidateDistDirs = [
  path.resolve(process.cwd(), 'packages/frontend/dist'),
  path.resolve(process.cwd(), '../frontend/dist'),
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(__dirname, '../packages/frontend/dist')
];
const distDir = candidateDistDirs.find(d => fs.existsSync(d));

if (distDir) {
  const indexHtmlPath = path.join(distDir, 'index.html');
  const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf-8') : null;
  const relRoot = path.relative(process.cwd(), distDir);

  // Serve compiled frontend assets
  app.use('/assets/*', serveStatic({ root: relRoot }));

  // SPA fallback for all non-API web traffic
  app.get('*', (c, next) => {
    if (c.req.path.startsWith('/api')) {
      return next();
    }
    if (indexHtml) {
      return c.html(indexHtml);
    }
    return next();
  });
}

const PORT = Number(process.env.PORT) || 3001;

export async function startServer(): Promise<any> {
  // 1. Auto-seed SQLite if running local fresh
  seedDatabase();

  // 2. D1 Migrations Gate: Must complete and verify schema before accepting traffic in production
  const { D1Client } = await import('./db/d1-client.js');
  const d1 = D1Client.getInstance();
  const isProd = process.env.NODE_ENV === 'production';

  if (d1.isRemoteD1Configured() || isProd) {
    try {
      console.log('[D1 Migration Gate] Verifying and applying remote D1 migrations before opening traffic...');
      const { applyD1Migrations } = await import('./db/d1-migrations/index.js');
      const res = await applyD1Migrations();
      if (res.applied.length > 0) {
        console.log(`[D1 Migration Gate] Applied migrations: ${res.applied.join(', ')}`);
      }
      console.log(`[D1 Migration Gate] Schema verified with ${res.tables.length} tables in Cloudflare D1.`);
    } catch (err: any) {
      console.error('[D1 Migration Gate FATAL] Error during D1 migration:', err.message);
      if (isProd) {
        console.error('[D1 Migration Gate FATAL] Production database migration failed. Halting process before listening for traffic.');
        process.exit(1);
      }
      throw err;
    }
  }

  // 3. Start autonomous background scheduler for continuous market intelligence & research
  try {
    DailyMarketResearchScheduler.getInstance().startScheduler();
  } catch (err: any) {
    console.warn('[SCHEDULER] Could not start daily research scheduler:', err.message);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 AI Marketing Organization Backend Service Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`🏢 Commercial Engine: Universal Multi-Tenant Ready`);
  console.log(`🤖 Agents Active: 80 Specialized Autonomous Agents`);
  console.log(`⏱️ Daily Autonomous Research Scheduler: RUNNING`);
  console.log(`======================================================\n`);

  return serve({
    fetch: app.fetch,
    port: PORT
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch(err => {
    console.error('[SERVER BOOT ERROR]', err);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  });
}

export default app;