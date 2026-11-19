import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { seedDatabase } from './db/seed.js';
import { validateProductionSecrets, loadLocalEnvFile, isProduction, getTrustedPublicSiteUrl } from './config/env.js';
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

    // 2b. Exact canonical site origin
    if (
      requestOrigin === 'https://ai-marketing-organization.onrender.com'
    ) {
      return requestOrigin;
    }

    // 3. Local development & AI Studio preview origins strictly allowed only in non-production
    if (process.env.NODE_ENV !== 'production') {
      try {
        const parsed = new URL(requestOrigin);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.endsWith('.run.app'))
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
    'x-owner-api-key',
    'x-owner-session',
    'x-organization-id',
    'x-business-id',
    'x-user-id',
    'x-test-mode',
    'bypass-tunnel-reminder'
  ],
  exposeHeaders: ['Set-Cookie']
}));

// Pre-launch security headers middleware (HSTS, nosniff, Referrer-Policy, CSP, COEP)
app.use('*', async (c, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com",
    "child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com",
    "img-src 'self' data: https: https://*.razorpay.com",
    "style-src 'self' 'unsafe-inline' https:",
    "font-src 'self' data: https:",
    "frame-ancestors 'self'"
  ].join('; ');

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  c.header('Content-Security-Policy', csp);

  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
  c.header('Content-Security-Policy', csp);
});

// Request Logger
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`[HTTP] ${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`);
});

// Health endpoint for stability verification (Zero D1 reads, < 10ms)
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

// Top-level /cron/* routing: forwarded to /api/v1/cron/* for Cloudflare Worker cron ping reliability
app.all('/cron/*', async (c) => {
  const targetPath = '/api/v1' + c.req.path;
  const newReq = new Request(new URL(targetPath, c.req.url).toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().blob()
  });
  return app.fetch(newReq);
});

// Top-level public calculator, site audit tool and capabilities routing
app.get('/tools/site-audit', async (c) => {
  const { renderSiteAuditPage } = await import('./tools/site-audit/site-audit-page.js');
  const { ExperimentEngine, STOREFRONT_SITEFIX_CTA_EXP_ID } = await import('./experiments/experiment-engine.js');
  const visitorKey = c.req.header('x-forwarded-for') || c.req.header('user-agent') || 'site-audit';
  const assignment = ExperimentEngine.assignStorefrontVariant(STOREFRONT_SITEFIX_CTA_EXP_ID, visitorKey);
  return c.html(renderSiteAuditPage(assignment));
});
app.get('/tools/financial-radar', async (c) => {
  const { MultiAssetOpportunityRadar } = await import('./intelligence/multi-asset-opportunity-radar.js');
  const radar = MultiAssetOpportunityRadar.getInstance();
  const summary = await radar.getRadarSummary({ skipLiveNetwork: Boolean(process.env.VITEST) });
  return c.html(radar.renderFinancialRadarHtml(summary));
});
app.all('/tools/*', async (c) => {
  const targetUrl = new URL('/api/v1' + c.req.path, c.req.url);
  return app.fetch(new Request(targetUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().blob()
  }));
});
app.get('/tools/lead-leakage-calculator', async (c) => {
  const { LeadLeakageCalculator } = await import('./revenue/lead-leakage-calculator.js');
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
  const contactEmail = process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : undefined;
  const html = LeadLeakageCalculator.getInstance().renderCalculatorHtml({ siteName, siteUrl, contactEmail });
  return c.html(html);
});
app.get('/capabilities', async (c) => {
  const targetUrl = new URL('/api/v1/capabilities', c.req.url);
  return app.fetch(new Request(targetUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers
  }));
});

// Top-level public homepage route (B2B AI Inbound Lead Triage Storefront + Evolved Featured Deals)
app.get('/', async (c) => {
  const { DirectCommercialOfferPage } = await import('./revenue/direct-offer-page.js');
  const { ExperimentEngine, STOREFRONT_DEAL_CTA_EXP_ID } = await import('./experiments/experiment-engine.js');
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
  const contactEmail = process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : undefined;
  const visitorKey = c.req.header('x-forwarded-for') || c.req.header('user-agent') || 'homepage';
  const dealCtaAssignment = ExperimentEngine.assignStorefrontVariant(STOREFRONT_DEAL_CTA_EXP_ID, visitorKey);

  let featuredDeals: any[] = [];
  try {
    const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
    const eligible = await AutonomousDealDiscoveryEngine.getInstance().getEligiblePublicDeals({ limit: 8 });
    featuredDeals = (eligible.deals || [])
      .filter((d: any) => d.catalogSlot !== 'ROTATED_OUT_STALE' && d.evidenceJson?.catalogSlot !== 'ROTATED_OUT_STALE')
      .slice(0, 4);
  } catch {}

  const html = DirectCommercialOfferPage.getInstance().renderHomepageHtml({
    siteName,
    siteUrl,
    contactEmail,
    featuredDeals,
    dealCtaAssignment
  });
  return c.html(html);
});

// Top-level public Privacy Policy route
app.get('/privacy', async (c) => {
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = getTrustedPublicSiteUrl();
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy | ${siteName}</title>
  <meta name="description" content="Privacy Policy &amp; Data Protection Compliance under DPDP Act 2023 for ${siteName}.">
  <link rel="canonical" href="${siteUrl}/privacy">
  <meta name="robots" content="index, follow">
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card-bg: #111827; --card-border: #1e293b; --text-main: #f8fafc; --text-muted: #94a3b8; --accent: #06b6d4; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text-main); line-height: 1.6; padding: 2rem 1.25rem; max-width: 840px; margin: 0 auto; }
    h1, h2 { color: var(--accent); margin-bottom: 0.5rem; }
    p { margin-bottom: 1rem; color: #cbd5e1; }
    a { color: var(--accent); text-decoration: none; }
    .card { background: var(--card-bg); border-radius: 10px; padding: 1.75rem; margin-top: 1.25rem; border: 1px solid var(--card-border); }
    nav.top { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--card-border); display: flex; gap: 1rem; flex-wrap: wrap; }
  </style>
</head>
<body>
  <nav class="top">
    <a href="/">← Home</a>
    <a href="/tools/site-audit">SiteFix Audit</a>
    <a href="/deals">Verified Deals</a>
    <a href="/terms">Terms of Service</a>
  </nav>
  <h1>Privacy Policy &amp; Consent Notice</h1>
  <p style="color: var(--text-muted);">Last updated: October 2026 • Digital Personal Data Protection (DPDP) Act 2023 Compliance</p>
  <div class="card">
    <h2>1. Data Collection &amp; Use</h2>
    <p>When you use SiteFix AI or submit a business inquiry, we process only the technical domain URL and contact information you explicitly provide. No cookies are used for ad tracking.</p>
    <h2>2. Affiliate Links &amp; Non-PII Attribution (#Ad)</h2>
    <p>Outbound links to verified merchants (Amazon.in, Cuelinks partner stores) utilize purely non-PII first-party <code>clickId</code> tokens and Cuelinks SubID attribution parameters. These parameters contain zero personally identifiable information (PII), zero device fingerprinting, and zero cross-site tracking pixels, serving solely to attribute qualified referral commissions upon verified merchant checkout.</p>
    <h2>3. Data Retention &amp; Erasure</h2>
    <p>Non-converted business inquiries, website audit requests, and price drop alert subscriptions are retained for a maximum of 30 days before automated daily purging under DPDP Act 2023 retention policies, or immediately erased upon user request. In contrast, statutory commercial transaction records, financial ledgers, and tax invoices are retained for mandatory accounting compliance periods as required by applicable Indian tax and financial reporting laws.</p>
    <h2>4. Contact</h2>
    <p>For data privacy requests or erasures, contact: <a href="mailto:${process.env.PUBLIC_CONTACT_EMAIL || 'contact@aimarketing.org'}">${process.env.PUBLIC_CONTACT_EMAIL || 'contact@aimarketing.org'}</a></p>
  </div>
</body>
</html>`);
});

// Top-level public Terms of Service route
app.get('/terms', async (c) => {
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = getTrustedPublicSiteUrl();
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service | ${siteName}</title>
  <meta name="description" content="Terms of Service &amp; Commercial Terms for ${siteName}.">
  <link rel="canonical" href="${siteUrl}/terms">
  <meta name="robots" content="index, follow">
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card-bg: #111827; --card-border: #1e293b; --text-main: #f8fafc; --text-muted: #94a3b8; --accent: #06b6d4; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text-main); line-height: 1.6; padding: 2rem 1.25rem; max-width: 840px; margin: 0 auto; }
    h1, h2 { color: var(--accent); margin-bottom: 0.5rem; }
    p { margin-bottom: 1rem; color: #cbd5e1; }
    a { color: var(--accent); text-decoration: none; }
    .card { background: var(--card-bg); border-radius: 10px; padding: 1.75rem; margin-top: 1.25rem; border: 1px solid var(--card-border); }
    nav.top { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--card-border); display: flex; gap: 1rem; flex-wrap: wrap; }
  </style>
</head>
<body>
  <nav class="top">
    <a href="/">← Home</a>
    <a href="/tools/site-audit">SiteFix Audit</a>
    <a href="/deals">Verified Deals</a>
    <a href="/privacy">Privacy Policy</a>
  </nav>
  <h1>Terms of Service</h1>
  <p style="color: var(--text-muted);">Last updated: October 2026 • Commercial Transparency</p>
  <div class="card">
    <h2>1. SiteFix AI Optimization Packs</h2>
    <p>SiteFix AI delivers deterministic technical diagnostic reports and ready-to-paste code suggestions for review and implementation. It does not directly modify customer servers or guarantee third-party search engine rankings.</p>
    <h2>2. Commercial Deal Directory &amp; Price Drops (#Ad)</h2>
    <p>Reported merchant prices and discounts are point-in-time snapshots. Qualifying purchases through outbound affiliate links may earn referral commissions at zero extra cost to the buyer.</p>
    <h2>3. Refund Policy</h2>
    <p>SiteFix Fix-Packs include a 7-day refund guarantee if technical deliverables fail to generate accurately.</p>
  </div>
</body>
</html>`);
});

// Top-level public verified deals directory route
app.get('/deals', async (c) => {
  const { StaticSiteGenerator } = await import('./commission/static-site-generator.js');
  const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
  const { ExperimentEngine, STOREFRONT_DEAL_CTA_EXP_ID } = await import('./experiments/experiment-engine.js');
  const siteUrl = getTrustedPublicSiteUrl();
  const trustedHost = new URL(siteUrl).host;
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const visitorKey = c.req.header('x-forwarded-for') || c.req.header('user-agent') || 'deals';
  const dealCtaAssignment = ExperimentEngine.assignStorefrontVariant(STOREFRONT_DEAL_CTA_EXP_ID, visitorKey);
  const config = {
    siteName,
    authorName: (process.env.PUBLIC_AUTHOR_NAME || 'Editorial Desk').trim(),
    contactEmail: (process.env.PUBLIC_CONTACT_EMAIL || `editorial@${trustedHost}`).trim(),
    siteUrl
  };
  try {
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const eligible = await dealEngine.getEligiblePublicDeals({ limit: 50 });
    const deals = eligible.deals;
    const html = StaticSiteGenerator.getInstance().renderDealsHtml(deals, config, { dealCtaAssignment });
    return c.html(html);
  } catch (err: any) {
    if (err?.code === 'GUIDE_DATA_UNAVAILABLE' || err?.statusCode === 503) {
      return c.json({ error: 'GUIDE_DATA_UNAVAILABLE', message: err.message }, 503);
    }
    throw err;
  }
});

// Top-level SSR product deal detail route (/deals/:slug) with Schema.org/Product JSON-LD
app.get('/deals/:slug', async (c) => {
  let slug = c.req.param('slug') || '';
  if (slug.endsWith('.html')) {
    slug = slug.substring(0, slug.length - 5);
  }
  const cleanSlug = decodeURIComponent(slug).trim().toLowerCase();
  const { StaticSiteGenerator } = await import('./commission/static-site-generator.js');
  const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
  const siteUrl = getTrustedPublicSiteUrl();
  const trustedHost = new URL(siteUrl).host;
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const config = {
    siteName,
    authorName: (process.env.PUBLIC_AUTHOR_NAME || 'Editorial Desk').trim(),
    contactEmail: (process.env.PUBLIC_CONTACT_EMAIL || `editorial@${trustedHost}`).trim(),
    siteUrl
  };

  try {
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const eligibleRes = await dealEngine.getEligiblePublicDeals({ limit: 1000 });
    const allDeals = eligibleRes.deals || [];
    const targetDeal = allDeals.find((d: any) =>
      String(d.slug || '').toLowerCase() === cleanSlug ||
      String(d.canonicalSlug || '').toLowerCase() === cleanSlug ||
      String(d.id || '').toLowerCase() === cleanSlug
    );

    if (!targetDeal) {
      return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Deal Not Found | ${siteName}</title>
  <meta name="robots" content="noindex, nofollow">
</head>
<body style="font-family:sans-serif;background:#090d16;color:#e2e8f0;padding:3rem;text-align:center;">
  <h1>Verified Deal Unavailable or Expired</h1>
  <p>This product deal is either out of stock or has ended. Browse currently active verified Indian deals below.</p>
  <p><a href="/deals" style="color:#38bdf8;">Return to Verified Deals Directory &rarr;</a></p>
</body>
</html>`, 404);
    }

    const sameSegment = allDeals.filter((d: any) =>
      d.id !== targetDeal.id && d.targetBuyerSegment && d.targetBuyerSegment === targetDeal.targetBuyerSegment
    );
    const sameCategory = allDeals.filter((d: any) =>
      d.id !== targetDeal.id && d.targetBuyerSegment !== targetDeal.targetBuyerSegment &&
      (d.sectorCode === targetDeal.sectorCode || d.category === targetDeal.category)
    );
    const relatedDeals = [...sameSegment, ...sameCategory].slice(0, 4);

    let enrichedTargetDeal = targetDeal;
    try {
      const { YouTubeReviewEnricher } = await import('./integrations/youtube-review-enricher.js');
      enrichedTargetDeal = await YouTubeReviewEnricher.getInstance().enrichDeal(targetDeal);
    } catch {
      enrichedTargetDeal = targetDeal;
    }

    const html = StaticSiteGenerator.getInstance().renderDealDetailHtml(enrichedTargetDeal, relatedDeals, config);
    return c.html(html, 200);
  } catch (err: any) {
    if (err?.code === 'GUIDE_DATA_UNAVAILABLE' || err?.statusCode === 503) {
      return c.json({ error: 'GUIDE_DATA_UNAVAILABLE', message: err.message }, 503);
    }
    throw err;
  }
});

// Top-level public direct commercial offer routes (Part E)
app.get('/offer', async (c) => {
  const { DirectCommercialOfferPage } = await import('./revenue/direct-offer-page.js');
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
  const contactEmail = process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : undefined;
  const html = DirectCommercialOfferPage.getInstance().renderOfferHtml({ siteName, siteUrl, contactEmail });
  return c.html(html);
});
app.get('/offers/lead-conversion-system', (c) => c.redirect('/offer', 301));

// Static QR asset serving
app.get('/images/razorpay-upi-qr.jpg', async (c) => {
  const candidatePaths = [
    path.resolve(process.cwd(), 'packages/backend/public/images/razorpay-upi-qr.jpg'),
    path.resolve(process.cwd(), 'public/images/razorpay-upi-qr.jpg'),
    path.resolve(__dirname, '../public/images/razorpay-upi-qr.jpg'),
    path.resolve(__dirname, '../../frontend/public/images/razorpay-upi-qr.jpg'),
    path.resolve(process.cwd(), 'packages/frontend/public/images/razorpay-upi-qr.jpg'),
    path.resolve(process.cwd(), 'packages/frontend/dist/images/razorpay-upi-qr.jpg'),
    path.resolve(__dirname, '../../frontend/dist/images/razorpay-upi-qr.jpg')
  ];
  const found = candidatePaths.find(p => fs.existsSync(p));
  if (found) {
    const data = fs.readFileSync(found);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }
  return c.text('Image not found', 404);
});
app.get('/assets/razorpay-upi-qr.jpg', (c) => c.redirect('/images/razorpay-upi-qr.jpg', 301));

// Checkout Redirect (Directs to official offer and payment checkout page)
app.get('/checkout', (c) => c.redirect('/offer', 302));

// Proposal Checkout Page (Method A Razorpay Link + Method B UPI QR)
app.get('/proposals/:id/checkout', async (c) => {
  const proposalId = c.req.param('id');
  const { ProposalEngine } = await import('./revenue/proposal-engine.js');
  const { isProduction } = await import('./config/env.js');
  const pe = ProposalEngine.getInstance();
  const proposal = isProduction()
    ? await pe.getProposalAsync(proposalId)
    : pe.getProposal(proposalId);

  if (!proposal) {
    return c.html('<!DOCTYPE html><html><body style="background:#090d16;color:#fff;padding:2rem;"><h1>Proposal Not Found</h1><p>No commercial proposal matches the specified ID.</p></body></html>', 404);
  }

  const { OwnerAuthService } = await import('./auth/owner-auth.js');
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const upiVpa = OwnerAuthService.PLATFORM_UPI_VPA;
  const merchantName = OwnerAuthService.PLATFORM_MERCHANT_NAME;
  const qrAssetPath = OwnerAuthService.PLATFORM_QR_ASSET_PATH;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposal Checkout | ${proposal.title}</title>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card-bg: #111827; --card-border: #1e293b; --text: #f8fafc; --muted: #94a3b8; --accent: #06b6d4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 2rem 1rem; line-height: 1.6; }
    .container { max-width: 840px; margin: 0 auto; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 1.75rem; margin-bottom: 1.5rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .badge { display: inline-block; background: rgba(6, 182, 212, 0.15); color: #67e8f9; padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; margin-bottom: 1rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .btn { display: inline-block; width: 100%; text-align: center; background: var(--accent); color: #090d16; font-weight: 700; padding: 0.8rem 1.2rem; border-radius: 8px; border: none; cursor: pointer; text-decoration: none; font-size: 1rem; }
    .btn:hover { background: #22d3ee; }
    .btn-secondary { background: #1e293b; color: #fff; border: 1px solid #334155; margin-top: 0.5rem; }
    .qr-box { text-align: center; padding: 1rem; background: #0b1120; border-radius: 10px; border: 1px solid #1e293b; }
    .qr-img { max-width: 220px; width: 100%; border-radius: 8px; border: 2px solid #334155; cursor: pointer; }
    input, select, textarea { width: 100%; padding: 0.65rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem; margin-top: 0.25rem; }
    .notice { font-size: 0.85rem; color: var(--muted); margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Approved Proposal Checkout</div>
    <h1>${proposal.title}</h1>
    <p style="color: var(--muted); margin-bottom: 1.5rem;">Proposal ID: <code>${proposal.id}</code> • Status: <strong>${proposal.status}</strong></p>

    <div class="card">
      <h2 style="font-size: 1.25rem; margin-bottom: 1rem;">Deliverables & Commercial Scope</h2>
      <ul style="margin-left: 1.25rem; margin-bottom: 1rem; color: #cbd5e1;">
        ${proposal.deliverables.map(d => `<li>${d}</li>`).join('')}
      </ul>
      <div style="display: flex; gap: 2rem; flex-wrap: wrap; border-top: 1px solid var(--card-border); padding-top: 1rem;">
        <div><span style="color: var(--muted); font-size: 0.85rem;">Setup Investment</span><p style="font-size: 1.5rem; font-weight: 800;">₹${proposal.setupPriceINR.toLocaleString('en-IN')}</p></div>
        <div><span style="color: var(--muted); font-size: 0.85rem;">Monthly Retainer</span><p style="font-size: 1.5rem; font-weight: 800;">₹${proposal.monthlyPriceINR.toLocaleString('en-IN')}/mo</p></div>
        <div><span style="color: var(--muted); font-size: 0.85rem;">Delivery Timeline</span><p style="font-size: 1.5rem; font-weight: 800;">${proposal.timelineDays} Days</p></div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Method A -->
      <div class="card">
        <h3 style="color: #38bdf8; margin-bottom: 0.75rem;">Method A — Razorpay Payment Link</h3>
        <p style="color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem;">Generate an authenticated Razorpay checkout link created for the exact invoice amount (₹${proposal.setupPriceINR.toLocaleString('en-IN')}). Supports UPI, Cards, and Netbanking.</p>
        <button id="gen-link-btn" class="btn" onclick="generateLink()">Generate ₹${proposal.setupPriceINR.toLocaleString('en-IN')} Payment Link</button>
        <div id="link-result" style="display: none; margin-top: 1rem;">
          <a id="pay-link-anchor" href="#" target="_blank" rel="noopener" class="btn">Proceed to Razorpay Checkout</a>
          <p class="notice" id="link-url-text"></p>
        </div>
      </div>

      <!-- Method B -->
      <div class="card">
        <h3 style="color: #34d399; margin-bottom: 0.75rem;">Method B — Scan &amp; Pay via UPI QR</h3>
        <p style="color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem;">Scan using Google Pay, PhonePe, Paytm, or BHIM. Enter invoice amount ₹${proposal.setupPriceINR.toLocaleString('en-IN')}.</p>
        <div class="qr-box">
          <img src="${qrAssetPath}" alt="Razorpay UPI QR" class="qr-img" onclick="window.open(this.src, '_blank')">
          <p style="font-size: 0.85rem; color: #fff; font-weight: 600; margin-top: 0.5rem;">${merchantName}</p>
          <p style="font-size: 0.8rem; color: var(--muted); margin-top: 0.2rem;"><code>${upiVpa}</code></p>
          <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${upiVpa}'); alert('UPI ID copied!')">Copy UPI ID</button>
        </div>
      </div>
    </div>

    <!-- UTR Claim Submission -->
    <div class="card" id="claim-section">
      <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem;">Report Paid UPI Transaction (UTR)</h3>
      <p style="color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem;">If you paid via UPI QR, submit the 12-digit Bank Transaction ID (UTR) from your payment confirmation. Our team will verify against the merchant account.</p>
      <form id="utr-form" onsubmit="submitUtr(event)">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="font-size: 0.85rem; color: var(--muted);">Payer / Business Name *</label>
            <input type="text" id="payer-name" required placeholder="Dr. Rajesh Sharma">
          </div>
          <div>
            <label style="font-size: 0.85rem; color: var(--muted);">Mobile / WhatsApp *</label>
            <input type="tel" id="payer-phone" required placeholder="9876543210">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="font-size: 0.85rem; color: var(--muted);">12-Digit Bank UTR / Reference *</label>
            <input type="text" id="payer-utr" required placeholder="e.g. 428901234567" minlength="6">
          </div>
          <div>
            <label style="font-size: 0.85rem; color: var(--muted);">Amount Paid (INR) *</label>
            <input type="number" id="payer-amount" readonly value="${proposal.setupPriceINR}">
          </div>
        </div>
        <button type="submit" id="claim-btn" class="btn">Submit UPI Payment Claim</button>
        <div id="claim-msg" style="display: none; margin-top: 1rem; padding: 0.8rem; border-radius: 8px; text-align: center;"></div>
      </form>
    </div>

    <footer style="text-align: center; color: var(--muted); font-size: 0.85rem; margin-top: 2rem;">
      <p>&copy; ${new Date().getFullYear()} ${siteName}. Statutory Revenue Truth Active • Fixed ₹100 legacy checkout links disabled.</p>
    </footer>
  </div>

  <script>
    async function generateLink() {
      var btn = document.getElementById('gen-link-btn');
      btn.disabled = true;
      btn.innerText = 'Creating Secure Payment Link...';
      try {
        var res = await fetch('/api/v1/payments/public/create-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offerId: '${proposal.offerId || 'PLATFORM_SETUP'}',
            proposalId: '${proposal.id}',
            customerName: '${proposal.title.replace(/'/g, "\\'")}'
          })
        });
        var data = await res.json();
        if (data.success && data.data && data.data.paymentLinkUrl) {
          btn.style.display = 'none';
          var container = document.getElementById('link-result');
          container.style.display = 'block';
          var a = document.getElementById('pay-link-anchor');
          a.href = data.data.paymentLinkUrl;
          document.getElementById('link-url-text').innerText = 'Link ID: ' + data.data.providerLinkId + ' • Amount: ₹' + data.data.amountINR.toLocaleString('en-IN');
        } else {
          throw new Error(data.error || 'Failed to create payment link');
        }
      } catch (err) {
        alert('Payment link generation error: ' + err.message);
        btn.disabled = false;
        btn.innerText = 'Retry Payment Link Generation';
      }
    }

    async function submitUtr(e) {
      e.preventDefault();
      var btn = document.getElementById('claim-btn');
      var msg = document.getElementById('claim-msg');
      btn.disabled = true;
      btn.innerText = 'Registering Payment Claim...';
      try {
        var res = await fetch('/api/v1/payments/manual-upi/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: '${proposal.businessId}',
            proposalId: '${proposal.id}',
            invoiceRef: '${proposal.id}',
            payerName: document.getElementById('payer-name').value.trim(),
            payerPhone: document.getElementById('payer-phone').value.trim(),
            amountINR: ${proposal.setupPriceINR},
            utr: document.getElementById('payer-utr').value.trim(),
            serviceRendered: 'Proposal Setup: ' + '${proposal.title.replace(/'/g, "\\'")}'
          })
        });
        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          msg.innerHTML = '<strong>✓ Payment Claim Registered!</strong><br>Status: <code>PAYMENT_CLAIMED</code><br>Your bank UTR has been submitted for owner verification. Note: In accordance with statutory revenue integrity rules, verified revenue is recognized only after bank statement reconciliation.';
          btn.style.display = 'none';
        } else {
          throw new Error(data.error || 'Submission failed');
        }
      } catch (err) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: ' + err.message;
        btn.disabled = false;
        btn.innerText = 'Submit UPI Payment Claim';
      }
    }
  </script>
</body>
</html>`;

  return c.html(html);
});

app.post('/offer/inquiry', async (c) => {
  const targetUrl = new URL('/api/v1/offer/inquiry', c.req.url);
  return app.fetch(new Request(targetUrl.toString(), {
    method: 'POST',
    headers: c.req.raw.headers,
    body: await c.req.raw.clone().blob()
  }));
});

// Top-level Owner Digest (Part C)
app.get('/owner/today', async (c) => {
  const { OwnerDigestService } = await import('./revenue/owner-digest.js');
  const digest = await OwnerDigestService.getInstance().generateDigestAsync();
  if (c.req.header('accept')?.includes('text/html') || c.req.query('format') === 'html') {
    return c.html(OwnerDigestService.getInstance().renderHtml(digest));
  }
  return c.json({ success: true, data: digest });
});

// Top-level Owner Automation Dashboard (V3.3 SPRINT § 10)
app.get('/owner/automation', async (c) => {
  const { AutomationRegistryEngine } = await import('./automation/automation-registry-engine.js');
  const engine = AutomationRegistryEngine.getInstance();
  await engine.ensureInitialized();
  const workflows = await engine.listWorkflows();
  const recentLogs = await engine.getRecentLogs(20);
  const isGlobalPaused = await engine.isGloballyPaused();
  if (c.req.header('accept')?.includes('text/html') || c.req.query('format') === 'html') {
    return c.html(engine.renderDashboardHtml(workflows, recentLogs, isGlobalPaused));
  }
  return c.json({ success: true, data: { isGlobalPaused, workflows, recentLogs } });
});

// Top-level Owner Sector Control Centre (V4.2 SPRINT)
app.get('/owner/deals', async (c) => {
  const reqUrl = new URL(c.req.url);
  return app.request(`/api/v1/owner/deals${reqUrl.search}`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

app.get('/owner/deals/summary', async (c) => {
  return app.request('/api/v1/owner/deals/summary', {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Top-level Owner Proposal Generator (Part D.4)
app.all('/owner/proposal', async (c) => {
  const path = await import('path');
  let bioPath = path.resolve(process.cwd(), 'owner', 'BIO.md');
  if (!fs.existsSync(bioPath)) {
    const rootCandidate = path.resolve(process.cwd(), '..', '..', 'owner', 'BIO.md');
    if (fs.existsSync(rootCandidate)) {
      bioPath = rootCandidate;
    }
  }
  if (!fs.existsSync(bioPath)) {
    return c.json({
      success: false,
      error: 'OWNER_BIO_MISSING',
      message: 'owner/BIO.md is missing. Proposal generation refused without verified owner background. Never invent clients or experience.'
    }, 422);
  }

  const bioContent = fs.readFileSync(bioPath, 'utf8');
  const { DirectCommercialOfferPage } = await import('./revenue/direct-offer-page.js');
  const isAttested = DirectCommercialOfferPage.isDirectOfferAttested();

  if (isAttested) {
    return c.json({
      success: true,
      isAttested: true,
      isPayable: true,
      message: 'Authoritative proposal generated from attested owner commercial terms (owner/DIRECT_OFFER.md).',
      ownerBioPreview: bioContent.slice(0, 300),
      data: {
        title: 'AI Inbound Lead Conversion System Implementation',
        setupPriceINR: 15000,
        monthlyPriceINR: 8000,
        source: 'owner/DIRECT_OFFER.md'
      }
    });
  }

  return c.json({
    success: true,
    isAttested: false,
    isPayable: false,
    message: 'Informational proposal draft. Commercial terms not yet attested via owner/DIRECT_OFFER.md; payable payment links are suppressed.',
    ownerBioPreview: bioContent.slice(0, 300),
    data: {
      title: 'AI Inbound Lead Conversion System Implementation',
      setupPriceINR: 15000,
      monthlyPriceINR: 8000,
      source: 'PROVISIONAL_ESTIMATE (Awaiting owner/DIRECT_OFFER.md attestation)'
    }
  });
});

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
    if (err.message?.includes('CLICK_ATTRIBUTION_PERSISTENCE_FAILED') || err.message?.includes('database error') || err.message?.includes('database write')) {
      return c.text('Attribution persistence failed; redirect suppressed to protect monetization', 503);
    }
    return c.json({ error: 'REFERRAL_NOT_FOUND', message: sanitizedMsg }, 404);
  }
});

// Search Engine Discoverability (Spec § 12)
app.get('/robots.txt', async (c) => {
  const baseUrl = getTrustedPublicSiteUrl();
  const robotsTxt = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/v1/auth/',
    'Disallow: /admin',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n');
  return c.text(robotsTxt, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

// IndexNow Protocol Ownership Verification Key Route (Stage C Task H.3)
app.get('/:txtFile', async (c, next) => {
  const file = c.req.param('txtFile');
  const indexNowKey = (process.env.INDEXNOW_KEY || '').trim();
  const isValidFormat = /^[a-zA-Z0-9-]{8,128}$/.test(indexNowKey);

  if (isValidFormat && file === `${indexNowKey}.txt`) {
    return c.text(indexNowKey, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400'
    });
  }
  return next();
});

// Dedicated server-rendered HTML route for published buyer guides & acquisition content
app.get('/guides/:slug', async (c) => {
  let slug = c.req.param('slug');
  if (slug.endsWith('.html')) {
    slug = slug.substring(0, slug.length - 5);
  }
  try {
    const { ContentAssetEngine } = await import('./commission/content-asset-engine.js');
    const { StaticSiteGenerator } = await import('./commission/static-site-generator.js');
    const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');

    const asset = await ContentAssetEngine.getInstance().getAssetBySlug(slug, true);
    if (!asset) {
      c.header('X-Robots-Tag', 'noindex, nofollow');
      return c.html(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>Guide Not Found</title></head><body><h1>404 — Guide Not Found</h1><p>The requested guide is unavailable.</p><p><a href="/deals">Browse Verified Deals</a></p></body></html>`,
        404
      );
    }

    let config: any;
    try {
      config = await StaticSiteGenerator.getInstance().resolveConfig();
    } catch {
      const trustedSiteUrl = getTrustedPublicSiteUrl();
      const trustedHost = new URL(trustedSiteUrl).host;
      config = {
        siteName: 'India Deals & Buying Guides',
        authorName: 'Editorial Desk',
        contactEmail: `editorial@${trustedHost}`,
        siteUrl: trustedSiteUrl
      };
    }

    // Fail closed: Never swallow D1/DB failures into empty deals (200) or 404
    const eligibleRes = await AutonomousDealDiscoveryEngine.getInstance().getEligiblePublicDeals({ limit: 1000 });
    const eligibleDeals = eligibleRes.deals || [];
    const html = StaticSiteGenerator.getInstance().renderGuideHtml(asset, config, eligibleDeals);
    return c.html(html);
  } catch (err: any) {
    console.warn(`[GuideRoute] Failed rendering guide '${slug}': ${err.message}`);
    if (err?.code === 'GUIDE_DATA_UNAVAILABLE') {
      return c.json(
        {
          error: 'GUIDE_DATA_UNAVAILABLE',
          message: err?.message || 'Guide or offer data is temporarily unavailable.'
        },
        503
      );
    }
    // Graceful 301 redirect to /deals so crawlers never hit 502/503 errors on legacy routes
    return c.redirect('/deals', 301);
  }
});

// Top-level public /audit/:domain scorecard route
app.get('/audit/:domain', async (c) => {
  const search = new URL(c.req.url).search || '';
  return app.request(`/api/v1/audit/${c.req.param('domain')}${search}`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Top-level public /compare/:sectorSlug comparison guide route
app.get('/compare/:sectorSlug', async (c) => {
  return app.request(`/api/v1/compare/${c.req.param('sectorSlug')}`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Top-level public /vs/:comparisonSlug Head-to-Head Comparison Engine
app.get('/vs/:comparisonSlug', async (c) => {
  return app.request(`/api/v1/vs/${encodeURIComponent(c.req.param('comparisonSlug'))}`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Top-level public /best/:intentSlug Programmatic Fair-Price Buyer Hub
app.get('/best/:intentSlug', async (c) => {
  return app.request(`/api/v1/best/${encodeURIComponent(c.req.param('intentSlug'))}`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Top-level public /ig and /bestdeals Instagram Bio Link Storefront (@bestdeals0162)
app.get('/ig', async (c) => {
  return app.request('/api/v1/ig', {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

app.get('/bestdeals', async (c) => {
  return app.request('/api/v1/bestdeals', {
    method: 'GET',
    headers: c.req.raw.headers
  });
});

// Dedicated server-rendered HTML route for transparent public revenue funnel
app.get('/revenue', async (c) => {
  const siteUrl = getTrustedPublicSiteUrl();
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();

  // Call the public revenue funnel endpoint internally
  const funnelReq = new Request(`${siteUrl}/api/v1/public/revenue-funnel`, {
    method: 'GET',
    headers: c.req.raw.headers
  });
  const res = await app.fetch(funnelReq);
  const data = await res.json().catch(() => ({ success: false, data: {} }));
  const f = data.data?.funnel || {
    verifiedExternalVisits: 0,
    internalTestSessions: 0,
    externalOutboundClicks: 0,
    internalDiagnosticClicks: 0,
    clickThroughRate: '0.00%',
    conversions: 0,
    estimatedPendingCommissionINR: 0,
    approvedCommissionINR: 0,
    bankCashReceivedINR: 0
  };
  const b2b = data.data?.b2bFunnel || {
    prospectsResearched: 0,
    inquiriesReceived: 0,
    outreachDraftsPrepared: 0,
    proposalsSent: 0,
    proposalsAccepted: 0,
    verifiedClientPaymentsINR: 0.00
  };
  const opCosts = data.data?.operatingCosts || {
    hostingCostINR: 0.00,
    databaseCostINR: 0.00,
    aiModelCostINR: 0.00,
    paidToolCostINR: 0.00,
    totalOperatingCostINR: 0.00
  };
  const profit = data.data?.profitability || {
    grossRevenueCollectedINR: 0.00,
    netOperatingContributionINR: 0.00,
    laborExclusionNote: 'Owner engineering and commercial operations labor is excluded from cash operating costs.'
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transparent Public Revenue Funnel | ${siteName}</title>
  <meta name="description" content="Live, empirical affiliate revenue funnel for AI Marketing Organization. Strict distinction between test clicks, external visitors, conversions, and bank cash.">
  <link rel="canonical" href="${siteUrl}/revenue">
  <meta name="robots" content="index, follow">
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --card-border: #1e293b; --text: #e2e8f0; --accent: #06b6d4; --accent-orange: #f97316; --green: #10b981; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--card-border); padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1000px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.2rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    header nav a:hover, header nav a.active { color: var(--accent); font-weight: 600; }
    main { max-width: 1000px; margin: 2.5rem auto; padding: 0 1.5rem; }
    .hero { text-align: center; max-width: 760px; margin: 0 auto 2.5rem auto; }
    .hero h1 { font-size: 2.2rem; color: #fff; margin-bottom: 0.5rem; }
    .hero p { color: #94a3b8; font-size: 1.05rem; }
    .badge { display: inline-block; background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); color: #38bdf8; padding: 0.3rem 0.8rem; border-radius: 9999px; font-size: 0.78rem; font-weight: 700; margin-bottom: 1rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; margin-bottom: 2.5rem; }
    .metric-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem; }
    .metric-label { font-size: 0.82rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 0.5rem; }
    .metric-value { font-size: 2rem; font-weight: 800; color: #fff; line-height: 1.2; }
    .metric-sub { font-size: 0.78rem; color: #64748b; margin-top: 0.5rem; }
    .section-title { font-size: 1.35rem; color: #fff; margin: 2rem 0 1rem 0; }
    .partners-table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--card-border); border-radius: 12px; overflow: hidden; margin-bottom: 2.5rem; }
    .partners-table th, .partners-table td { padding: 0.9rem 1.2rem; text-align: left; border-bottom: 1px solid var(--card-border); font-size: 0.9rem; }
    .partners-table th { background: #0f172a; color: #cbd5e1; font-weight: 600; font-size: 0.82rem; text-transform: uppercase; }
    .notice-card { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 2.5rem; font-size: 0.9rem; color: #fde68a; }
    footer { border-top: 1px solid var(--card-border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${siteName}</a>
    <nav>
      <a href="/">Home</a>
      <a href="/offer">B2B Services</a>
      <a href="/deals">Verified Deals</a>
      <a href="/guides/student-flight-discounts-india">Student Travel Guide</a>
      <a href="/revenue" class="active">Revenue Funnel</a>
      <a href="/public/disclosure">Disclosure</a>
    </nav>
  </header>
  <main>
    <div class="hero">
      <span class="badge">EMPIRICAL REVENUE TRANSPARENCY</span>
      <h1>Public Commercial Funnel</h1>
      <p>Real-time metrics separating external visitor demand from test runs. We never report test clicks as real visitors, nor pending commissions as cash.</p>
    </div>

    <!-- Direct B2B Lead Conversion Funnel Section -->
    <h2 class="section-title">Direct B2B Lead Conversion Funnel (Healthcare &amp; Local Services)</h2>
    <div class="grid">
      <div class="metric-card">
        <div class="metric-label">Researched Prospects</div>
        <div class="metric-value">${b2b.prospectsResearched}</div>
        <div class="metric-sub">Verified Indian healthcare &amp; dental practices</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Inbound Inquiries</div>
        <div class="metric-value">${b2b.inquiriesReceived}</div>
        <div class="metric-sub">Direct clinic inquiries received</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Outreach Drafts Prepared</div>
        <div class="metric-value">${b2b.outreachDraftsPrepared}</div>
        <div class="metric-sub">Strict owner gate: human_approved = 0</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Proposals Generated</div>
        <div class="metric-value">${b2b.proposalsSent}</div>
        <div class="metric-sub">Formally issued commercial proposals</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Proposals Accepted</div>
        <div class="metric-value">${b2b.proposalsAccepted}</div>
        <div class="metric-sub">Approved client engagements</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Verified Client Payments</div>
        <div class="metric-value" style="color: var(--green);">₹${Number(b2b.verifiedClientPaymentsINR).toFixed(2)}</div>
        <div class="metric-sub">Bank-reconciled client payments</div>
      </div>
    </div>

    <!-- Operating Costs & Cash Profitability Section -->
    <h2 class="section-title">Operating Costs &amp; Cash Profitability (₹0 Outflow Invariant)</h2>
    <div class="grid">
      <div class="metric-card">
        <div class="metric-label">Hosting (Render)</div>
        <div class="metric-value">₹${Number(opCosts.hostingCostINR).toFixed(2)}</div>
        <div class="metric-sub">Free web service tier</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Database (Cloudflare D1)</div>
        <div class="metric-value">₹${Number(opCosts.databaseCostINR).toFixed(2)}</div>
        <div class="metric-sub">Free tier allocation</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">AI Inference (Gemini)</div>
        <div class="metric-value">₹${Number(opCosts.aiModelCostINR).toFixed(2)}</div>
        <div class="metric-sub">Bounded free tier quota</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Software Licenses</div>
        <div class="metric-value">₹${Number(opCosts.paidToolCostINR).toFixed(2)}</div>
        <div class="metric-sub">100% client-owned tools</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Cash Operating Cost</div>
        <div class="metric-value" style="color: #38bdf8;">₹${Number(opCosts.totalOperatingCostINR).toFixed(2)}</div>
        <div class="metric-sub">Total measured cash expense</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Net Operating Contribution</div>
        <div class="metric-value" style="color: var(--green);">₹${Number(profit.netOperatingContributionINR).toFixed(2)}</div>
        <div class="metric-sub">Gross revenue minus cash costs</div>
      </div>
    </div>
    <p style="color: #64748b; font-size: 0.82rem; margin-top: -1.5rem; margin-bottom: 2rem;">
      * Accounting Policy: ${profit.laborExclusionNote}
    </p>

    <!-- Consumer Affiliate Funnel Section -->
    <h2 class="section-title">Consumer Travel &amp; Retail Affiliate Funnel (Offline Mode)</h2>
    <div class="grid">
      <div class="metric-card">
        <div class="metric-label">Verified External Visits</div>
        <div class="metric-value">${f.verifiedExternalVisits}</div>
        <div class="metric-sub">${f.internalTestSessions} internal test sessions separated</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Outbound Partner Clicks</div>
        <div class="metric-value">${f.externalOutboundClicks}</div>
        <div class="metric-sub">${f.internalDiagnosticClicks} diagnostic pings separated</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Click-Through Rate (CTR)</div>
        <div class="metric-value" style="color: var(--accent);">${f.clickThroughRate}</div>
        <div class="metric-sub">Outbound clicks / External visits</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Reported Conversions</div>
        <div class="metric-value">${f.conversions}</div>
        <div class="metric-sub">Cuelinks qualifying transactions</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Pending Commission</div>
        <div class="metric-value" style="color: var(--accent-orange);">₹${Number(f.estimatedPendingCommissionINR).toFixed(2)}</div>
        <div class="metric-sub">Subject to 45–60 day merchant audit</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Cash Received in Bank</div>
        <div class="metric-value" style="color: var(--green);">₹${Number(f.bankCashReceivedINR).toFixed(2)}</div>
        <div class="metric-sub">Strict proof: zero unverified cash claims</div>
      </div>
    </div>

    <div class="notice-card">
      <strong>Accounting &amp; Attribution Disclosures:</strong>
      <ul style="margin: 0.5rem 0 0 1.25rem; padding: 0;">
        <li><strong>Offline Attribution Delay:</strong> Indian airline affiliate campaigns (Air India Express, Akasa Air, Air India, Cleartrip) operate in offline tracking mode. Flight ticket bookings report with a 48–72 hour delay from the carrier.</li>
        <li><strong>Travel Validation Period:</strong> Commissions remain pending until 45–60 days after travel completion to account for ticket cancellations, date shifts, and refunds.</li>
        <li><strong>Zero Speculative Cash:</strong> Cash received is recognized strictly when transferred to our verified business bank account. Internal events or estimated figures are never treated as revenue.</li>
      </ul>
    </div>

    <h2 class="section-title">Active Monetized Commercial Campaigns (India)</h2>
    <table class="partners-table">
      <thead>
        <tr>
          <th>Partner</th>
          <th>Model</th>
          <th>Commercial Payout</th>
          <th>Cookie Window</th>
          <th>Tracking Mode</th>
          <th>Live Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Akasa Air</strong></td>
          <td>Cost Per Sale (CPS)</td>
          <td>₹225.00 per domestic sale</td>
          <td>30 Days</td>
          <td>Offline (48h delay)</td>
          <td><span style="color: #10b981; font-weight: 600;">ACTIVE (Campaign 57507)</span></td>
        </tr>
        <tr>
          <td><strong>Air India Express</strong></td>
          <td>Cost Per Sale (CPS)</td>
          <td>₹101.25 domestic / ₹168.75 intl</td>
          <td>30 Days</td>
          <td>Offline (48h delay)</td>
          <td><span style="color: #10b981; font-weight: 600;">ACTIVE (Campaign 5195)</span></td>
        </tr>
        <tr>
          <td><strong>Air India</strong></td>
          <td>Cost Per Sale (CPS)</td>
          <td>₹112.50 domestic / ₹375.00 intl</td>
          <td>30 Days</td>
          <td>Offline (48h delay)</td>
          <td><span style="color: #10b981; font-weight: 600;">ACTIVE (Campaign 5622)</span></td>
        </tr>
        <tr>
          <td><strong>Cleartrip Flights</strong></td>
          <td>Cost Per Sale (CPS)</td>
          <td>₹67.50 per flight booking</td>
          <td>1 Day</td>
          <td>Offline (48h delay)</td>
          <td><span style="color: #10b981; font-weight: 600;">ACTIVE (Campaign 29)</span></td>
        </tr>
      </tbody>
    </table>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/guides/student-flight-discounts-india">Student Travel Guide</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/public/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
  </footer>
</body>
</html>`;

  return c.html(html);
});

app.get('/public/financial-truth', async (c) => {
  const { FinancialTruthLedger } = await import('./revenue/financial-truth-ledger.js');
  const snapshot = FinancialTruthLedger.getInstance().getFinancialTruthSnapshot();
  return c.json({ success: true, data: snapshot });
});

app.get('/sitemap.xml', async (c) => {
  const baseUrl = getTrustedPublicSiteUrl();

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

  if (publishedSlugs.length === 0) {
    try {
      const { getDb } = await import('./db/client.js');
      const db = getDb();
      publishedSlugs = db.prepare("SELECT slug, updated_at FROM commission_content_assets WHERE status = 'PUBLISHED' ORDER BY updated_at DESC").all() as any[];
    } catch {}
  }

  // Include compare guides ONLY for sectors with verified active deals + editorial-gated SSR /deals/:slug, /vs/:slug & /best/:intentSlug URLs
  let compareUrls: string[] = [];
  let dealUrls: string[] = [];
  let vsUrls: string[] = [];
  let bestUrls: string[] = [];
  try {
    const { COMMERCIAL_SECTORS_LIST } = await import('@ai-marketing/shared');
    const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
    const { passesEditorialQualityGate, generateComparisonPairs, generateBuyerIntentHubs } = await import('./commission/static-site-generator.js');
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const eligibleRes = await engine.getEligiblePublicDeals({ limit: 1000 });
    const activeDeals = eligibleRes.deals || [];
    const activeSectorCodes = new Set(activeDeals.map((d: any) => d.sectorCode).filter(Boolean));
    compareUrls = COMMERCIAL_SECTORS_LIST
      .filter(sec => activeSectorCodes.has(sec.code))
      .map(sec => `${baseUrl}/compare/${sec.id}`);
    dealUrls = activeDeals
      .filter((d: any) => d && (d.slug || d.canonicalSlug || d.id) && passesEditorialQualityGate(d))
      .map((d: any) => `${baseUrl}/deals/${encodeURIComponent(d.slug || d.canonicalSlug || d.id)}`);
    vsUrls = generateComparisonPairs(activeDeals, 15).map(
      p => `${baseUrl}/vs/${encodeURIComponent(p.comparisonSlug)}`
    );
    bestUrls = generateBuyerIntentHubs(activeDeals, baseUrl, 10)
      .filter(h => h && h.intentSlug && !h.intentSlug.includes('object-object') && Array.isArray(h.deals) && h.deals.length >= 2)
      .map(h => `${baseUrl}/best/${encodeURIComponent(h.intentSlug)}`);
  } catch {}

  // Include only publicly authorized audited domain pages (V5.8 Defect 5)
  let auditUrls: string[] = [];
  try {
    const { SiteAuditService } = await import('./tools/site-audit/site-audit-service.js');
    const domains = await SiteAuditService.getInstance().getAllAuditedDomains();
    auditUrls = domains.map(d => `${baseUrl}/audit/${d}`);
  } catch {}

  const { DirectCommercialOfferPage } = await import('./revenue/direct-offer-page.js');
  const isOfferAttested = DirectCommercialOfferPage.isDirectOfferAttested();

  const staticUrls = [
    `${baseUrl}/`,
    `${baseUrl}/deals`,
    ...(isOfferAttested ? [`${baseUrl}/offer`] : []),
    `${baseUrl}/tools/site-audit`,
    `${baseUrl}/tools/financial-radar`,
    `${baseUrl}/tools/lead-leakage-calculator`,
    `${baseUrl}/revenue`,
    `${baseUrl}/privacy`,
    `${baseUrl}/terms`,
    `${baseUrl}/public/disclosure`
  ];

  const contentUrls = publishedSlugs.map(a => `${baseUrl}/guides/${a.slug}`);
  const allUrls = Array.from(new Set([...staticUrls, ...bestUrls, ...compareUrls, ...vsUrls, ...contentUrls, ...auditUrls, ...dealUrls]));

  const xmlEntries = allUrls
    .map(url => `  <url>\n    <loc>${url}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`)
    .join('\n');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlEntries}\n</urlset>`;

  return c.text(sitemapXml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

app.get('/rss.xml', async (c) => {
  const baseUrl = getTrustedPublicSiteUrl();

  let publicDeals: any[] = [];
  try {
    const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    const eligible = await dealEngine.getEligiblePublicDeals({ limit: 50 });
    publicDeals = eligible.deals;
  } catch {}

  const rssItems = publicDeals.map(d => `    <item>
      <title><![CDATA[${d.title} - ₹${d.currentPriceINR} on ${d.merchant}]]></title>
      <link>${baseUrl}/deals</link>
      <guid isPermaLink="false">${d.id}</guid>
      <description><![CDATA[Verified deal: ${d.title} at ₹${d.currentPriceINR}${d.referencePriceINR && d.referencePriceINR > d.currentPriceINR ? ` (MRP ₹${d.referencePriceINR}, ${d.verifiedDiscountPercent || d.claimedDiscountPercent}% off)` : ''} on ${d.merchant}. Direct merchant fulfillment. #Ad - Commission earned on qualifying purchases.]]></description>
      <pubDate>${new Date(d.lastCheckedAt || d.observedAt || Date.now()).toUTCString()}</pubDate>
    </item>`).join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Marketing Organization - Verified Commercial Deals &amp; Buying Guides</title>
    <link>${baseUrl}/deals</link>
    <description>Genuine, provider-attributed commercial deals and buying guides for Indian consumers.</description>
    <language>en-in</language>
    <atom:link href="${baseUrl}/rss.xml" rel="self" type="application/rss+xml"/>
${rssItems}
  </channel>
</rss>`;

  return c.text(rssXml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

// Syndicated JSON & RSS 2.0 deals feeds (Engine 4)
app.get('/feeds/deals.json', (c) => c.redirect('/api/v1/public/feeds/deals.json', 301));
app.get('/feeds/deals.xml', async (c) => {
  const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
  const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
  let eligible: any;
  try {
    eligible = await dealEngine.getEligiblePublicDeals({ limit: 50 });
  } catch (err: any) {
    if (err?.code === 'GUIDE_DATA_UNAVAILABLE' || err?.statusCode === 503) {
      return c.json({ error: 'GUIDE_DATA_UNAVAILABLE', message: err.message }, 503);
    }
    throw err;
  }
  const baseUrl = getTrustedPublicSiteUrl().replace(/\/$/, '');
  const topDeals = (eligible.deals || [])
    .filter((d: any) => d.evolutionStatus !== 'STALE_ROTATED_OUT' && d.catalogSlot !== 'ROTATED_OUT_STALE')
    .slice(0, 25);
  const escXml = (v: unknown): string =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const rssItems = topDeals
    .map((d: any) => {
      const redirectUrl = `${baseUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect`;
      const mrpNote = d.referencePriceINR && d.referencePriceINR > d.currentPriceINR
        ? ` (MRP ₹${Number(d.referencePriceINR).toLocaleString('en-IN')})`
        : '';
      return `    <item>
      <title>${escXml(`${d.title} — ₹${Number(d.currentPriceINR || 0).toLocaleString('en-IN')}${mrpNote} at ${d.merchant}`)}</title>
      <link>${escXml(redirectUrl)}</link>
      <guid isPermaLink="false">${escXml(d.id)}</guid>
      <category>${escXml(d.category || 'Verified Deals')}</category>
      <description><![CDATA[Verified deal: ${d.title} at ₹${d.currentPriceINR}${mrpNote} on ${d.merchant}. Direct merchant fulfillment. #Ad - Commission earned on qualifying purchases.]]></description>
      <pubDate>${new Date(d.lastVerifiedAt || d.lastCheckedAt || d.observedAt || Date.now()).toUTCString()}</pubDate>
    </item>`;
    })
    .join('\n');

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Marketing Organization - Verified Commercial Deals Feed</title>
    <link>${escXml(baseUrl)}/deals</link>
    <description>Top 25 live, verified merchant deals and buying guides.</description>
    <language>en-in</language>
    <atom:link href="${escXml(baseUrl)}/feeds/deals.xml" rel="self" type="application/rss+xml"/>
${rssItems}
  </channel>
</rss>`;

  return c.text(rssXml, 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300'
  });
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

  if (d1.isRemoteD1ReadAllowed() || d1.isRemoteD1WriteAllowed() || isProd) {
    try {
      console.log('[D1 Migration Gate] Verifying and applying remote D1 migrations before opening traffic...');
      const { applyD1Migrations } = await import('./db/d1-migrations/index.js');
      const res = await applyD1Migrations();
      if (res.applied.length > 0) {
        console.log(`[D1 Migration Gate] Applied migrations: ${res.applied.join(', ')}`);
      }
      console.log(`[D1 Migration Gate] Schema verified with ${res.tables.length} tables in Cloudflare D1.`);
    } catch (err: any) {
      const isQuotaErr = D1Client.isDailyQuotaError(err?.status || 0, err?.message || '');
      if (isQuotaErr) {
        d1.tripQuotaCircuitBreakerPublic(err.message || 'D1 migration quota reached');
        console.warn(`[D1 Migration Gate WARNING] Remote D1 daily quota exhausted (${err.message}). Tripping circuit breaker and falling back to local SQLite mirror.`);
      } else {
        console.error('[D1 Migration Gate FATAL] Error during D1 migration:', err.message);
        if (isProd) {
          console.error('[D1 Migration Gate FATAL] Production database migration failed. Halting process before listening for traffic.');
          process.exit(1);
        }
        throw err;
      }
    }
  }

  const server = serve({
    fetch: app.fetch,
    port: PORT,
    hostname: '0.0.0.0'
  });

  console.log(`\n======================================================`);
  console.log(`🚀 AI Marketing Organization Backend Service Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📊 API Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`🏢 Commercial Engine: Universal Multi-Tenant Ready`);
  console.log(`🤖 Agents Active: 80 Specialized Autonomous Agents`);
  console.log(`⏱️ Durable Queue: ACTIVE (09:00 & 21:00 IST CAMPAIGN WINDOWS)`);
  console.log(`======================================================\n`);

  // Run synchronization and warm-up gates asynchronously so HTTP traffic is accepted immediately
  void (async () => {
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

    // 3c. Commercial Funnel Telemetry & Deal Catalog Gate: Synchronize from Cloudflare D1
    try {
      const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
      await AutonomousDealDiscoveryEngine.getInstance().hydrateFunnelTelemetryFromDb();
      await AutonomousDealDiscoveryEngine.getInstance().syncFromD1Async();
      console.log('[Funnel Gate] Synchronized commercial funnel telemetry and deal catalog from Cloudflare D1.');
    } catch (err: any) {
      console.warn('[Funnel Gate] Funnel telemetry/deal synchronization failed:', err.message);
    }

    try {
      const { GrowthExperimentTracker } = await import('./commission/growth-experiment-tracker.js');
      await GrowthExperimentTracker.getInstance().hydrateFromDb();
      console.log('[Experiment Gate] Synchronized growth experiments from Cloudflare D1.');
    } catch (err: any) {
      console.warn('[Experiment Gate] Growth experiment synchronization failed:', err.message);
    }

    try {
      const { ExperimentEngine } = await import('./experiments/experiment-engine.js');
      ExperimentEngine.seedDefaultStorefrontExperiments('org_owner_primary', 'biz_platform_aro');
      console.log('[Experiment Gate] Ensured default non-test Storefront A/B experiments initialized.');
    } catch (err: any) {
      console.warn('[Experiment Gate] Default storefront experiment seed notice:', err.message);
    }

    // 3d. Baseline Content Assets Gate: Ensure baseline acquisition guides exist in Cloudflare D1
    try {
      const { ContentAssetEngine } = await import('./commission/content-asset-engine.js');
      await ContentAssetEngine.getInstance().syncBaselineAssetsAsync();
    } catch (err: any) {
      console.warn('[Content Gate] Baseline content sync failed:', err.message);
    }

    // 3e. Non-Healthcare SMB Prospect Gate: Never seed regulated healthcare/dental domains (Standing Order 8)
    console.log('[Prospect Gate] Healthcare/dental seeding disabled per Standing Order 8; using live non-healthcare SMB discovery.');

    // 3f. Automation Registry Gate: Ensure core workflows initialized in Cloudflare D1
    try {
      const { AutomationRegistryEngine, WORKFLOW_DEFINITIONS } = await import('./automation/automation-registry-engine.js');
      await AutomationRegistryEngine.getInstance().ensureInitialized();
      console.log(`[Automation Gate] Ensured ${WORKFLOW_DEFINITIONS.length} background automation workflows initialized in Cloudflare D1.`);
    } catch (err: any) {
      console.warn('[Automation Gate] Automation registry initialization failed:', err.message);
    }

    // 3g. Multi-Merchant Deals Catalog Gate: Ensure approved Cuelinks merchants feeds are hydrated (V5.7 Phase 1)
    try {
      const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      await dealEngine.syncFromD1Async();
      const inStock = dealEngine.getAllDeals().filter(d => d.availability === 'IN_STOCK' && (d.verificationStatus === 'VERIFIED' || d.verificationStatus === 'VERIFIED_WITH_CONDITIONS'));
      if (inStock.length < 5) {
        console.log('[Catalog Gate] Ingesting live feeds from approved Cuelinks merchants into public_deals...');
        await dealEngine.harvestAllApprovedMerchantFeeds();
        console.log(`[Catalog Gate] Ingested live deals. Total active in-stock: ${dealEngine.getAllDeals().filter(d => d.availability === 'IN_STOCK').length}`);
      } else {
        console.log(`[Catalog Gate] Verified ${inStock.length} active in-stock deals loaded.`);
      }
    } catch (err: any) {
      console.warn('[Catalog Gate] Merchant catalog feed ingestion failed:', err.message);
    }

    // 3h. Live Baseline Autonomy & Non-Healthcare SMB SiteFix Verification Gate
    try {
      const { GoogleSuggestClient } = await import('./integrations/google-suggest-client.js');
      await GoogleSuggestClient.getInstance().fetchSuggestions('electronics verified deals India', 'in');
      console.log('[Autonomy Gate] Live GoogleSuggest baseline query executed.');
    } catch (err: any) {
      console.warn('[Autonomy Gate] GoogleSuggest baseline query notice:', err.message);
    }

    try {
      const { AutomationRegistryEngine } = await import('./automation/automation-registry-engine.js');
      await AutomationRegistryEngine.getInstance().autoAuditNextUnauditedDomain();
      console.log('[Autonomy Gate] Baseline non-healthcare SMB SiteFix audit check completed.');
    } catch (err: any) {
      console.warn('[Autonomy Gate] Baseline SiteFix audit notice:', err.message);
    }

    // 4. Autonomous scheduling powered by durable Cloudflare D1 queue & Worker heartbeat (Spec V4.1 Phase 1 & 2)
    console.log('[Durable Queue] Background operations scheduled via Cloudflare D1 queue (Two daily IST commercial runs: 09:00 & 21:00 IST).');
  })();

  // Stage M Task 1: Execute AutonomousSystemDoctor in-process 2s after boot (non-blocking, unref'd, skipped under Vitest)
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    const bootDoctorTimer = setTimeout(async () => {
      try {
        const { AutonomousSystemDoctor } = await import('./automation/autonomous-system-doctor.js');
        const report = await AutonomousSystemDoctor.getInstance().runSelfHealingPass({
          skipRecoveryRecursion: true,
          skipLlm: true
        });
        console.log(`[Boot Self-Heal] Doctor run ${report.runId}: repaired=${report.priceRepair.repairedCount}, amazonPurged=${report.priceRepair.amazonStaticPricesPurged}, bottleneck=${report.funnelDiagnosis.bottleneckStage}`);
      } catch (err: any) {
        console.warn('[Boot Self-Heal] Doctor scan notice:', err?.message);
      }
    }, 2000);
    if (typeof (bootDoctorTimer as any)?.unref === 'function') {
      (bootDoctorTimer as any).unref();
    }
  }

  // Stage I.2 / I.2-A: Execute once non-blocking 5s after boot — revoke unconsented third-party audits, recover stale/blocked queue jobs, drain due jobs, & hydrate Cuelinks payouts autonomously
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    const bootRecoveryTimer = setTimeout(async () => {
      try {
        const { SiteAuditService } = await import('./tools/site-audit/site-audit-service.js');
        const auditRevoke = await SiteAuditService.getInstance().reconcileUnauthorizedThirdPartyAudits();
        console.log('[Startup Self-Heal] Unauthorized audit reconciliation:', JSON.stringify(auditRevoke));
      } catch (err: any) {
        console.warn('[Startup Self-Heal] Unauthorized audit reconciliation notice:', err?.message);
      }
      try {
        const { DurableJobQueue } = await import('./automation/durable-job-queue.js');
        const { AutomationRegistryEngine } = await import('./automation/automation-registry-engine.js');
        const queue = DurableJobQueue.getInstance();
        const rec = await queue.recoverStaleAndBlockedJobs();
        if (rec.queueStatsAfter.failedTotal > 0 || rec.expiredLeasesRecovered > 0) {
          console.log('[Startup Self-Heal] Queue recovery completed:', JSON.stringify(rec));
        } else {
          console.log(`[Startup Self-Heal] Queue recovery completed: queued=${rec.queueStatsAfter.queued}, completed=${rec.queueStatsAfter.completed}, overdue=${rec.queueStatsAfter.overdueCount}`);
        }

        // Drain overdue/due queued jobs on boot (bounded to 20 jobs / 25s) so overdueCount converges to 0
        const engine = AutomationRegistryEngine.getInstance();
        const startMs = Date.now();
        let drained = 0;
        while (drained < 20 && (Date.now() - startMs) < 25000) {
          const claimed = await queue.claimDueJob('boot_self_heal', 90);
          if (!claimed) break;
          const remaining = Math.max(3000, 25000 - (Date.now() - startMs));
          const execResult = await engine.executeWorkflow(claimed.workflowId, 'CLOUDFLARE_CRON', remaining);
          if (
            execResult.status === 'COMPLETED' ||
            execResult.status === 'COMPLETED_WITH_FINDINGS' ||
            execResult.status === 'COMPLETED_NO_FINDINGS' ||
            execResult.status === 'NO_ACTION_DUE'
          ) {
            await queue.completeJob(claimed.id, execResult.status, execResult.resultSummary, claimed.leaseToken || undefined);
          } else if (execResult.status === 'PARTIAL' || execResult.status === 'BLOCKED') {
            await queue.completeJob(claimed.id, execResult.status, execResult.resultSummary, claimed.leaseToken || undefined);
          } else {
            await queue.failAttempt(claimed.id, execResult.errorMessage || execResult.status, true, undefined, claimed.leaseToken || undefined);
          }
          drained++;
        }
        if (drained > 0) {
          console.log(`[Startup Self-Heal] Drained ${drained} due jobs on boot.`);
        }
      } catch (err: any) {
        console.warn('[Startup Self-Heal] Queue recovery/drain notice:', err?.message);
      }
      try {
        const { CuelinksSyncManager } = await import('./commission/cuelinks-sync-manager.js');
        const hyd = await CuelinksSyncManager.getInstance().hydrateMissingCampaignPayoutsD1('org_owner_primary', 'biz_platform_aro', 100);
        console.log('[Startup Self-Heal] Cuelinks payout hydration completed:', JSON.stringify(hyd));
      } catch (err: any) {
        console.warn('[Startup Self-Heal] Cuelinks hydration notice:', err?.message);
      }
    }, 5000);
    if (typeof (bootRecoveryTimer as any)?.unref === 'function') {
      (bootRecoveryTimer as any).unref();
    }
  }

  return server;
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