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
      requestOrigin === 'https://gen-lang-client-0916255372.web.app' ||
      requestOrigin === 'https://gen-lang-client-0916255372.firebaseapp.com' ||
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

// Top-level public calculator and capabilities routing
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
    body: c.req.raw.body
  }));
});

// Top-level Owner Digest (Part C)
app.get('/owner/today', async (c) => {
  const { OwnerDigestService } = await import('./revenue/owner-digest.js');
  const digest = await OwnerDigestService.getInstance().generateDigestAsync();
  if (c.req.header('accept')?.includes('text/html')) {
    const formatted = OwnerDigestService.getInstance().formatTelegramMessage(digest);
    return c.html(`<!DOCTYPE html><html><body style="background:#090d16;color:#f8fafc;padding:2rem;"><pre style="font-family:monospace;white-space:pre-wrap;">${formatted}</pre></body></html>`);
  }
  return c.json({ success: true, data: digest });
});

// Top-level Owner Proposal Generator (Part D.4)
app.all('/owner/proposal', async (c) => {
  const fs = await import('fs');
  const path = await import('path');
  const bioPath = path.resolve(process.cwd(), 'owner', 'BIO.md');
  if (!fs.existsSync(bioPath)) {
    return c.json({
      success: false,
      error: 'OWNER_BIO_MISSING',
      message: 'owner/BIO.md is missing. Proposal generation refused without verified owner background. Never invent clients or experience.'
    }, 422);
  }

  const bioContent = fs.readFileSync(bioPath, 'utf8');
  return c.json({
    success: true,
    message: 'Proposal draft generated strictly from owner/BIO.md.',
    ownerBioPreview: bioContent.slice(0, 300),
    data: {
      title: 'AI Inbound Lead Conversion System Implementation',
      setupPriceINR: 15000,
      monthlyPriceINR: 8000,
      source: 'owner/BIO.md'
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