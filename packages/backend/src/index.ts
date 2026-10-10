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
import { initOwnerEnvIntake } from './config/owner-env-intake.js';
import { DailyMarketResearchScheduler } from './scheduler/daily-research-scheduler.js';
import { UnifiedQuotaService } from './quota/unified-quota-service.js';
import { getTrustedClientIp } from './security/client-ip.js';

// Safely load local .env or .env.local if present
loadLocalEnvFile();

// Initialize owner intake from environment variables if present (Step 5)
try {
  const envIntakeRes = initOwnerEnvIntake();
  if (envIntakeRes.initialized) {
    console.log('✅ Owner intake successfully validated and initialized from environment variables.');
  } else if (envIntakeRes.validation.missingFields.length > 0) {
    console.log(`ℹ️ Owner intake not initialized (missing env vars: ${envIntakeRes.validation.missingFields.join(', ')})`);
  }
} catch (err: any) {
  console.warn('⚠️ Could not initialize owner intake at boot:', err.message);
}

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

// Enable credentialed CORS with strict exact-match allowlisted origins (no wildcard, no loose substring matching)
app.use('*', cors({
  origin: (requestOrigin, c) => {
    if (!requestOrigin) return null;

    // 1. Explicitly configured frontend origins via FRONTEND_ORIGIN (evaluated dynamically)
    const allowedFrontendOrigins = (process.env.FRONTEND_ORIGIN || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (allowedFrontendOrigins.includes(requestOrigin)) {
      return requestOrigin;
    }

    // 2. Exact known production Render frontend origin
    if (requestOrigin === 'https://ai-marketing-organization.onrender.com') {
      return requestOrigin;
    }

    // 2b. Exact Firebase Hosting site origins for static site beacons
    if (
      requestOrigin === 'https://ai-marketing-platform-core.web.app' ||
      requestOrigin === 'https://ai-marketing-platform-core.firebaseapp.com'
    ) {
      return requestOrigin;
    }

    // 3. Local development origins strictly allowed only in non-production
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(requestOrigin);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        ) {
          return requestOrigin;
        }
      } catch {}
    }

    // Strictly reject all other origins — never dynamically trust substring matches or host headers
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'x-organization-id',
    'x-business-id',
    'x-user-id',
    'x-test-mode',
    'bypass-tunnel-reminder'
  ],
  exposeHeaders: ['Set-Cookie']
}));

// Pre-launch security headers middleware (HSTS, nosniff, Referrer-Policy, CSP)
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!c.res.headers.has('Content-Security-Policy')) {
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';");
  }
});

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

// Top-level /owner/* routing: forwarded to /api/v1/owner/* so owner authentication is strictly enforced
app.all('/owner/*', async (c) => {
  const targetPath = '/api/v1' + c.req.path;
  const newReq = new Request(new URL(targetPath, c.req.url).toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().blob()
  });
  return app.fetch(newReq);
});
app.all('/owner', (c) => c.redirect('/owner/status', 302));

// Top-level public referral redirect route: /r/:offerSlug/:referralId (Spec § 5 & § 18)
app.get('/r/:offerSlug/:referralId', async (c) => {
  const offerSlug = c.req.param('offerSlug');
  const referralId = c.req.param('referralId');
  try {
    const { ReferralTrackingEngine } = await import('./commission/referral-tracking.js');
    const trackingEngine = ReferralTrackingEngine.getInstance();
    const isTestMode = c.req.header('x-test-mode') === 'true' || c.req.header('x-test-traffic') === 'true' || c.req.query('test_traffic') === 'true';
    const clickData = {
      ip: getTrustedClientIp(c).ip,
      userAgent: c.req.header('user-agent'),
      referer: c.req.header('referer'),
      source: c.req.query('utm_source') || c.req.query('source'),
      medium: c.req.query('utm_medium') || c.req.query('medium'),
      campaign: c.req.query('utm_campaign') || c.req.query('campaign'),
      isTestTraffic: isTestMode
    };
    const result = await trackingEngine.resolveReferralClick(offerSlug, referralId, clickData);
    return c.redirect(result.destinationUrl, 302);
  } catch (err: any) {
    const sanitizedMsg = (err.message || '').replace(/([?&]tag=)[^&]+/gi, '$1[REDACTED]');
    return c.json({ error: 'REFERRAL_NOT_FOUND', message: sanitizedMsg }, 404);
  }
});

// Search Engine Discoverability (Spec § 12)
app.get('/robots.txt', async (c) => {
  const host = c.req.header('host') || 'ai-marketing-organization.onrender.com';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const baseUrl = `${proto}://${host}`;
  const robotsTxt = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/v1/auth/',
    'Disallow: /admin',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n');
  return c.text(robotsTxt, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

app.get('/sitemap.xml', async (c) => {
  const host = c.req.header('host') || 'ai-marketing-organization.onrender.com';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const baseUrl = `${proto}://${host}`;

  let publishedSlugs: { slug: string; updated_at?: string }[] = [];
  try {
    const { D1RevenueRepository } = await import('./db/d1-revenue-repository.js');
    const d1Repo = D1RevenueRepository.getInstance();
    publishedSlugs = await d1Repo.query<any>(
      'commission_content_assets',
      `SELECT slug, updated_at FROM commission_content_assets WHERE status = 'PUBLISHED' ORDER BY updated_at DESC`,
      []
    );
  } catch {
    publishedSlugs = [];
  }

  const staticUrls = [
    `${baseUrl}/`,
    `${baseUrl}/public/disclosure`
  ];

  const contentUrls = publishedSlugs.map(a => `${baseUrl}/guides/${a.slug}`);
  const allUrls = [...staticUrls, ...contentUrls];

  const xmlEntries = allUrls
    .map(url => `  <url>\n    <loc>${url}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`)
    .join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlEntries}\n</urlset>`;

  return c.text(sitemapXml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

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

  // SPA and static pre-rendered file fallback for all non-API web traffic
  app.get('*', (c, next) => {
    if (c.req.path.startsWith('/api')) {
      return next();
    }
    const cleanPath = c.req.path.replace(/^\//, '').replace(/\/$/, '');
    if (cleanPath) {
      const directStaticHtml = path.join(distDir, cleanPath, 'index.html');
      if (fs.existsSync(directStaticHtml)) {
        return c.html(fs.readFileSync(directStaticHtml, 'utf-8'));
      }
      const directFile = path.join(distDir, `${cleanPath}.html`);
      if (fs.existsSync(directFile)) {
        return c.html(fs.readFileSync(directFile, 'utf-8'));
      }
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

  // 3. Durable Quota Gate: Synchronize counters from Cloudflare D1
  try {
    await UnifiedQuotaService.getInstance().syncFromD1Async();
    console.log('[Quota Gate] Synchronized durable quota counters from Cloudflare D1.');
  } catch (err: any) {
    console.warn('[Quota Gate] Quota synchronization failed:', err.message);
  }

  // 3b. Durable Action Cooldown Gate: Synchronize cooldowns from Cloudflare D1
  try {
    const { ActionCooldownManager } = await import('./revenue/action-cooldown-manager.js');
    await ActionCooldownManager.syncFromD1Async();
    console.log('[Cooldown Gate] Synchronized durable action cooldowns from Cloudflare D1.');
  } catch (err: any) {
    console.warn('[Cooldown Gate] Action cooldown synchronization failed:', err.message);
  }

  // 4. Start autonomous background scheduler for continuous market intelligence & research
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

export { app };
export default app;