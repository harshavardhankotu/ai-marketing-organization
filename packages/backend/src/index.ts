import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { apiRouter } from './routes/api.js';
import { seedDatabase } from './db/seed.js';
import { validateProductionSecrets } from './config/env.js';

// Enforce production secret validation immediately
try {
  validateProductionSecrets();
} catch (err: any) {
  console.error(`\n🚨 FATAL CONFIGURATION ERROR: ${err.message}\n`);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const app = new Hono();

// Enable CORS for frontend
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-user-id']
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

const PORT = Number(process.env.PORT) || 3001;

if (process.env.NODE_ENV !== 'test') {
  // Auto-seed if running fresh
  seedDatabase();

  console.log(`\n======================================================`);
  console.log(`🚀 AI Marketing Organization Backend Service Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`🏢 Seed Business: SmileKraft Dental Hyderabad (₹50k INR Budget)`);
  console.log(`🤖 Agents Active: 80 Specialized Autonomous Agents`);
  console.log(`======================================================\n`);

  serve({
    fetch: app.fetch,
    port: PORT
  });
}

export default app;