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

// Top-level public homepage route (B2B AI Inbound Lead Triage Storefront)
app.get('/', async (c) => {
  const { DirectCommercialOfferPage } = await import('./revenue/direct-offer-page.js');
  const siteName = (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
  const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
  const contactEmail = process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : undefined;
  const html = DirectCommercialOfferPage.getInstance().renderHomepageHtml({ siteName, siteUrl, contactEmail });
  return c.html(html);
});

// Top-level public verified deals directory route
app.get('/deals', async (c) => {
  const { StaticSiteGenerator } = await import('./commission/static-site-generator.js');
  const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
  const host = c.req.header('host') || 'ai-marketing-organization.onrender.com';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const config = {
    siteName: 'Verified Deals & Price Evidence',
    authorName: 'Editorial Desk',
    contactEmail: `editorial@${host}`,
    siteUrl: `${proto}://${host}`
  };
  const deals = AutonomousDealDiscoveryEngine.getInstance().queryPublicDeals({ limit: 50 }).deals;
  const html = StaticSiteGenerator.getInstance().renderDealsHtml(deals, config);
  return c.html(html);
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
  if (c.req.header('accept')?.includes('text/html') || c.req.query('format') === 'html') {
    return c.html(OwnerDigestService.getInstance().renderHtml(digest));
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

// Dedicated server-rendered HTML route for published buyer guides & acquisition content
app.get('/guides/:slug', async (c) => {
  let slug = c.req.param('slug');
  if (slug.endsWith('.html')) {
    slug = slug.substring(0, slug.length - 5);
  }
  try {
    const { ContentAssetEngine } = await import('./commission/content-asset-engine.js');
    const { StaticSiteGenerator } = await import('./commission/static-site-generator.js');
    const asset = await ContentAssetEngine.getInstance().getAssetBySlug(slug, true);
    if (asset) {
      let config: any;
      try {
        config = await StaticSiteGenerator.getInstance().resolveConfig();
      } catch {
        const host = c.req.header('host') || 'ai-marketing-organization.onrender.com';
        const proto = c.req.header('x-forwarded-proto') || 'https';
        config = {
          siteName: 'India Deals & Buying Guides',
          authorName: 'Editorial Desk',
          contactEmail: `editorial@${host}`,
          siteUrl: `${proto}://${host}`
        };
      }
      const html = StaticSiteGenerator.getInstance().renderGuideHtml(asset, config);
      return c.html(html);
    }
  } catch (err: any) {
    console.warn(`[GuideRoute] Error resolving guide '${slug}': ${err.message}`);
  }
  return c.text('Guide not found', 404);
});

// Dedicated server-rendered HTML route for transparent public revenue funnel
app.get('/revenue', async (c) => {
  const host = c.req.header('host') || 'ai-marketing-organization.onrender.com';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const siteUrl = `${proto}://${host}`;
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

  if (publishedSlugs.length === 0) {
    try {
      const { getDb } = await import('./db/client.js');
      const db = getDb();
      publishedSlugs = db.prepare("SELECT slug, updated_at FROM commission_content_assets WHERE status = 'PUBLISHED' ORDER BY updated_at DESC").all() as any[];
    } catch {}
  }

  const staticUrls = [
    `${baseUrl}/`,
    `${baseUrl}/deals`,
    `${baseUrl}/revenue`,
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

  // 3c. Commercial Funnel Telemetry & Growth Experiments Gate: Synchronize from Cloudflare D1
  try {
    const { AutonomousDealDiscoveryEngine } = await import('./commission/autonomous-deal-discovery-engine.js');
    await AutonomousDealDiscoveryEngine.getInstance().hydrateFunnelTelemetryFromDb();
    console.log('[Funnel Gate] Synchronized commercial funnel telemetry from Cloudflare D1.');
  } catch (err: any) {
    console.warn('[Funnel Gate] Funnel telemetry synchronization failed:', err.message);
  }

  try {
    const { GrowthExperimentTracker } = await import('./commission/growth-experiment-tracker.js');
    await GrowthExperimentTracker.getInstance().hydrateFromDb();
    console.log('[Experiment Gate] Synchronized growth experiments from Cloudflare D1.');
  } catch (err: any) {
    console.warn('[Experiment Gate] Growth experiment synchronization failed:', err.message);
  }

  // 3d. Baseline Content Assets Gate: Ensure baseline acquisition guides exist in Cloudflare D1
  try {
    const { ContentAssetEngine } = await import('./commission/content-asset-engine.js');
    await ContentAssetEngine.getInstance().syncBaselineAssetsAsync();
  } catch (err: any) {
    console.warn('[Content Gate] Baseline content sync failed:', err.message);
  }

  // 3e. Curated Healthcare SMB Prospects Gate: Ensure 10 researched Indian healthcare practices exist
  try {
    const { PlatformProspectDiscoveryEngine } = await import('./revenue/platform-prospect-discovery-engine.js');
    await PlatformProspectDiscoveryEngine.getInstance().ensureCuratedQualifiedProspectBatch();
    console.log('[Prospect Gate] Ensured curated Indian healthcare SMB prospects & drafts in Cloudflare D1.');
  } catch (err: any) {
    console.warn('[Prospect Gate] Curated prospect batch synchronization failed:', err.message);
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