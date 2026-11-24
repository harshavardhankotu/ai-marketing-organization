/**
 * SiteFix AI: Public Interactive Tool UI (/tools/site-audit)
 * Implements V6.2 Specification Phase 4:
 * - Eliminates DOM XSS via strict HTML escaping.
 * - Integrates real Razorpay checkout and /verify-payment loop when attested & configured.
 * - Displays truthful fail-closed status when checkout is locked.
 */

import { getDirectUpiConfig } from '../../config/env.js';
import { CANONICAL_SITEFIX_TERMS } from './site-audit-service.js';
import { renderCustomerDeskWidgetHtml } from '../../revenue/customer-desk-widget.js';

export interface SiteFixAbAssignment {
  experimentId?: string;
  variant?: 'baseline' | 'treatment';
  ctaText?: string;
}

export function renderSiteAuditPage(abAssignment?: SiteFixAbAssignment): string {
  const upiCfg = getDirectUpiConfig();
  const upiVpa = upiCfg.configured && upiCfg.vpa ? upiCfg.vpa : null;
  const upiPayeeName = upiCfg.payeeName || 'AI Marketing Organization';
  const fixpackPrice = CANONICAL_SITEFIX_TERMS.priceINR;
  const sitefixExpId = abAssignment?.experimentId || 'exp_storefront_sitefix_cta';
  const sitefixVariant = abAssignment?.variant || 'baseline';
  const sitefixCtaText = abAssignment?.ctaText || `Fix All Issues for ₹${fixpackPrice} — Instant AI Pack`;
  const safeSitefixCtaText = sitefixCtaText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteFix AI — Instant Website Audit & Optimization Pack</title>
  <meta name="description" content="Free factual technical website audit. Detect HTML metadata gaps, Schema.org syntax errors, search accessibility blockers, and get copy-paste fixes.">
  <link rel="canonical" href="https://ai-marketing-organization.onrender.com/tools/site-audit">
  <meta property="og:title" content="SiteFix AI — Instant Website Audit & Optimization Pack">
  <meta property="og:description" content="Free factual technical website audit. Detect HTML metadata gaps, Schema.org syntax errors, search accessibility blockers, and get copy-paste fixes.">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font);
      line-height: 1.6;
      padding: 0 1rem 4rem 1rem;
    }
    header {
      max-width: 900px;
      margin: 2rem auto;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      margin-bottom: 1rem;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }
    h1 {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      margin-bottom: 0.75rem;
      background: linear-gradient(to right, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      max-width: 650px;
      margin: 0 auto 1.5rem auto;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
    }
    input[type="url"], input[type="email"], select {
      width: 100%;
      padding: 0.75rem 1rem;
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="url"]:focus, input[type="email"]:focus, select:focus {
      border-color: var(--primary);
    }
    .checkbox-group {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin: 1.25rem 0;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .checkbox-group input {
      margin-top: 0.25rem;
      cursor: pointer;
    }
    button.btn-primary {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.875rem;
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.1s;
    }
    button.btn-primary:hover {
      background: var(--primary-hover);
    }
    button.btn-primary:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .disclaimer-box {
      background: rgba(31, 41, 55, 0.5);
      border-left: 4px solid #6b7280;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      color: #9ca3af;
      margin-top: 1rem;
      border-radius: 0 6px 6px 0;
    }
    .results-area {
      display: none;
    }
    .score-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 1.5rem;
      gap: 1rem;
    }
    .score-circle {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #1f2937;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.6rem;
      font-weight: 800;
      border: 3px solid var(--primary);
      flex-shrink: 0;
    }
    .finding-item {
      padding: 1rem;
      border-radius: 8px;
      background: #0d131f;
      margin-bottom: 0.75rem;
      border-left: 4px solid #4b5563;
    }
    .finding-item.ISSUE { border-left-color: var(--danger); }
    .finding-item.WARNING { border-left-color: var(--warning); }
    .finding-item.PASS { border-left-color: var(--success); }
    .finding-header {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .checkout-box {
      margin-top: 2rem;
      padding: 1.5rem;
      background: #0d131f;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .download-success-box {
      display: none;
      margin-top: 1.5rem;
      padding: 1.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid var(--success);
      border-radius: 8px;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="badge">SiteFix AI • Factual Technical Website Audit & Fixes</div>
    <h1>Instant Website Audit & Optimization Pack</h1>
    <p class="subtitle">
      Zero fake scores. Inspect your live website for technical metadata gaps, Schema.org syntax errors,
      and search engine accessibility blockers with strict OWASP SSRF protection.
    </p>
  </header>

  <div class="container">
    <div class="card" id="scan-form-card">
      <form id="auditForm" onsubmit="handleAudit(event)">
        <div class="form-group">
          <label for="targetUrl">Public Website URL (HTTPS)</label>
          <input type="url" id="targetUrl" placeholder="https://example.com" required>
        </div>

        <div class="form-group">
          <label for="websiteType">Website Category (Optional)</label>
          <select id="websiteType">
            <option value="DEVELOPER_LAUNCH_QA" selected>Developer / Website Launch QA</option>
            <option value="SAAS">SaaS / Web App</option>
            <option value="SHOPIFY_ECOMMERCE">Shopify / Ecommerce Store</option>
            <option value="FREELANCER_PORTFOLIO">Freelancer / Portfolio / Agency</option>
            <option value="LOCAL_BUSINESS">Local Business / Service Provider</option>
            <option value="GENERAL_CONTENT">General Blog / Content Website</option>
          </select>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="ownershipConsent" required>
          <label for="ownershipConsent">
            I confirm that I own or am authorized to audit this public website destination.
          </label>
        </div>

        <button type="submit" class="btn-primary" id="scanBtn">
          Start Technical Website Scan
        </button>

        <div class="disclaimer-box">
          <strong>Non-intrusive Diagnostic:</strong> We inspect public HTML headers, meta tags, and structured data with a strict 5s timeout.
          We never crawl internal subpages, submit forms, or run invasive security exploits.
          No Core Web Vitals or search ranking guarantees are claimed.
        </div>
      </form>
    </div>

    <!-- Results Area -->
    <div class="card results-area" id="resultsCard">
      <div class="score-banner">
        <div>
          <h2 id="resultStatus">Audit Completed</h2>
          <p id="resultExplanation" style="color: var(--text-muted); font-size: 0.9rem; max-width: 600px; margin-top: 0.25rem;"></p>
        </div>
        <div class="score-circle" id="scoreDisplay">--</div>
      </div>

      <div id="findingsSummaryBanner" style="display:none;margin:1rem 0;padding:0.75rem 1rem;background:rgba(17,24,39,0.8);border:1px solid var(--card-border);border-radius:8px;font-size:0.92rem;"></div>
      <h3 style="margin-bottom: 1rem;">Diagnostic Findings</h3>
      <div id="findingsContainer"></div>

      <!-- Stage M: Inbound Opt-In Transactional Email Closer -->
      <div id="sendReportBox" style="margin: 1.5rem 0; padding: 1.2rem; background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.45rem;">
          <strong style="color: #38bdf8; font-size: 0.98rem;">Email Me This Private Audit Report &amp; Fix-Pack Link</strong>
          <span style="font-size: 0.75rem; color: #94a3b8;">DPDP Opt-In &bull; Signed Private Scorecard</span>
        </div>
        <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 0.85rem;">
          Receive your top 3 detected SEO &amp; conversion defects, private HMAC-signed scorecard URL, and direct ₹499 Optimization Fix-Pack link directly in your inbox.
        </p>
        <form id="siteAuditSendReportForm" onsubmit="submitSiteAuditSendReport(event)">
          <div style="display: flex; gap: 0.65rem; flex-wrap: wrap; margin-bottom: 0.65rem;">
            <input type="email" id="sendReportEmail" required placeholder="founder@yourbusiness.in" style="flex: 1 1 240px; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.88rem;">
            <button type="submit" id="sendReportBtn" class="btn-primary" style="width: auto; padding: 0.6rem 1.15rem; font-size: 0.88rem; background: #0284c7;">
              Email Report &amp; Fix-Pack Link
            </button>
          </div>
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.8rem; color: #cbd5e1; cursor: pointer;">
            <input type="checkbox" id="sendReportConsent" required style="margin-top: 0.15rem;">
            <span>I consent to receive this private technical website audit report and optional Fix-Pack checkout link by email (1-click unsubscribe anytime under DPDP Act 2023).</span>
          </label>
          <div id="sendReportStatus" style="display: none; margin-top: 0.7rem; padding: 0.65rem 0.8rem; border-radius: 6px; font-size: 0.84rem;"></div>
        </form>
      </div>

      <!-- Commercial Fix-Pack Area -->
      <div class="checkout-box">
        <h3>Downloadable Optimization Pack (Fix-Pack) — ₹499 (SITEFIX_AI_PACK_V1)</h3>
        <p style="color: var(--text-muted); font-size: 0.95rem; margin: 0.5rem 0 1rem 0;">
          Unlock the complete copy-paste technical package generated from your live scan evidence. Everything needed to resolve metadata gaps, social share card errors, and search crawler blockers:
        </p>
        <ul style="color: #cbd5e1; font-size: 0.88rem; line-height: 1.6; text-align: left; margin: 0 0 1.25rem 1.25rem; padding: 0;">
          <li><strong>1. HTML &lt;head&gt; Meta &amp; Social Tags:</strong> Clean title, meta description, Open Graph, and Twitter/X Card tags.</li>
          <li><strong>2. Schema.org Structured Data:</strong> Syntax-validated JSON-LD (Organization, WebSite, or Product) tailored to your detected markup.</li>
          <li><strong>3. Search Engine Directives:</strong> Optimized <code>robots.txt</code> directives and declared <code>sitemap.xml</code> configuration.</li>
          <li><strong>4. Instant Delivery:</strong> instant browser download + email receipt.</li>
          <li><strong>5. 7-Day Verification Recheck:</strong> 1 automated post-deployment recheck within 7 days to verify all tags validate live.</li>
          <li><strong>6. 7-Day Refund Guarantee:</strong> 100% money-back guarantee if technical fixes do not validate.</li>
        </ul>

        <!-- Dynamic Checkout Container -->
        <div id="checkoutActionContainer">
          <div id="checkoutGateNotice" style="background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
            <strong style="color: var(--warning);">Self-Serve Checkout Status:</strong>
            <span id="checkoutStatusText" style="font-size: 0.9rem; color: #d1d5db; display: block; margin-top: 0.25rem;">
              Checking payment gateway availability...
            </span>
          </div>

          <!-- Razorpay Sandbox Test Mode Notice & Mock Credentials (Only displayed when paymentMode === 'SANDBOX') -->
          <div id="sandboxTestModeNotice" style="display: none; background: rgba(30, 58, 138, 0.25); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <strong style="color: #93c5fd; font-size: 0.88rem;">🧪 Razorpay Sandbox / Test Mode Active</strong>
              <span style="font-size: 0.72rem; background: rgba(59, 130, 246, 0.25); color: #bfdbfe; padding: 2px 8px; border-radius: 4px; font-weight: 700;">SANDBOX ONLY</span>
            </div>
            <p style="font-size: 0.82rem; color: #d1d5db; margin: 0 0 0.65rem 0;">
              Checkout operates in <strong>Test Mode</strong>. The Razorpay modal opens in sandbox mode—no real currency is moved. Use standard mock details:
            </p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.82rem; font-family: monospace;">
              <div style="background: rgba(0,0,0,0.35); padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                <span style="color: #9ca3af; display: block; font-family: sans-serif; font-size: 0.75rem;">Mock Card (Any 6-digit OTP)</span>
                <strong style="color: #60a5fa; font-size: 0.9rem;">4100 2800 0000 1007</strong>
                <span style="color: #9ca3af; display: block; font-size: 0.75rem; margin-top: 2px;">Exp: 12/26 • CVV: 123</span>
              </div>
              <div style="background: rgba(0,0,0,0.35); padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                <span style="color: #9ca3af; display: block; font-family: sans-serif; font-size: 0.75rem;">Mock UPI ID (Auto-Approve)</span>
                <strong style="color: #34d399; font-size: 0.9rem;">success@razorpay</strong>
                <span style="color: #9ca3af; display: block; font-size: 0.75rem; margin-top: 2px;">Instant simulated capture</span>
              </div>
            </div>
          </div>

          <!-- Live Buyer Domain & Email Inputs (Spec Stage P.3.2) -->
          <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; text-align: left;">
            <label style="display: block; font-size: 0.78rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.35rem;">Target Website Domain *</label>
            <input type="text" id="checkoutDomainInput" placeholder="example.com" style="width: 100%; box-sizing: border-box; padding: 0.55rem 0.75rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem; margin-bottom: 0.75rem;">
            <label style="display: block; font-size: 0.78rem; font-weight: 600; color: #94a3b8; margin-bottom: 0.35rem;">Buyer Delivery Email (for receipt & fix-pack download token) *</label>
            <input type="email" id="checkoutBuyerEmailInput" required placeholder="name@company.com" style="width: 100%; box-sizing: border-box; padding: 0.55rem 0.75rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem;">
          </div>

          <!-- Pre-Checkout Technical Disclosure (Spec Stage P.3.5 Task 5) -->
          <div style="margin: 0.85rem 0 1.15rem 0; padding: 0.85rem 1rem; border-radius: 6px; background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; font-size: 0.82rem; color: #cbd5e1; line-height: 1.5; text-align: left;">
            Delivers a ready-to-paste HTML, Schema.org, robots.txt, and sitemap.xml Fix-Pack based on your live scan. You review and install the files; automatic live-site edits and search-ranking guarantees are not included.
          </div>

          <button class="btn-primary" id="checkoutBtn" data-ab-experiment="${sitefixExpId}" data-ab-variant="${sitefixVariant}" data-ab-cta="${safeSitefixCtaText}" onclick="initiateCheckout()" disabled>
            ${safeSitefixCtaText}
          </button>

          <!-- Live UPI Fallback Rail (Displayed when paymentMode !== 'LIVE') -->
          <div id="upiFallbackCard" style="display: none; margin-top: 1.5rem; padding: 1.25rem; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
              <strong style="color: #34d399; font-size: 0.95rem;">Direct UPI Payment Option (Live INR via GPay / PhonePe / Paytm)</strong>
              <span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 2px 8px; border-radius: 4px; font-weight: 700;">LIVE INR FALLBACK RAIL</span>
            </div>
            <p style="font-size: 0.85rem; color: #d1d5db; margin-bottom: 1rem;">
              Razorpay card gateway is in Sandbox mode. Pay <strong>₹499</strong> directly via UPI to unlock manual fulfillment upon UTR verification (zero revenue is recognized before owner bank confirmation).
            </p>
            ${upiVpa ? `
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: center; margin-bottom: 1rem;">
              <img src="/images/razorpay-upi-qr.jpg" alt="SiteFix AI Merchant UPI QR" style="width: 110px; height: 110px; border-radius: 8px; border: 1px solid #334155; background: #fff; object-fit: contain;">
              <div>
                <div style="font-size: 0.82rem; color: #9ca3af;">Merchant VPA: <code style="color: #fff; font-weight: 700;">${upiVpa}</code></div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.65rem;">
                  <a id="upiDeepLinkAnchor" href="upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(upiPayeeName)}&cu=INR&am=${fixpackPrice}" class="btn-primary" style="display: inline-block; width: auto; padding: 0.5rem 0.9rem; font-size: 0.82rem; text-decoration: none; background: #10b981;">Pay ₹${fixpackPrice} via UPI App &rarr;</a>
                  <button type="button" onclick="navigator.clipboard.writeText('${upiVpa}'); this.innerText='Copied VPA!';" style="background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 0.5rem 0.85rem; border-radius: 6px; font-size: 0.82rem; cursor: pointer;">Copy UPI ID</button>
                </div>
              </div>
            </div>
            ` : `
            <div id="upiConfigMissingBanner" style="padding: 0.85rem; border-radius: 6px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); color: #fcd34d; font-size: 0.85rem; margin-bottom: 1rem;">
              Direct UPI payment rail is currently unavailable (<code>CONFIGURED_MISSING</code>). Please configure <code>DIRECT_UPI_VPA</code> and <code>DIRECT_UPI_PAYEE_NAME</code>.
            </div>
            `}
            <form id="siteAuditUpiForm" onsubmit="submitSiteAuditUpiClaim(event)">
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.65rem; margin-bottom: 0.75rem;">
                <input type="text" id="upiPayerName" required placeholder="Your Business / Name *" style="padding: 0.55rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem;">
                <input type="email" id="upiBuyerEmail" required placeholder="Buyer Delivery Email *" style="padding: 0.55rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem;">
                <input type="tel" id="upiPayerPhone" required placeholder="WhatsApp / Mobile *" style="padding: 0.55rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem;">
                <input type="text" id="upiUtrInput" required minlength="12" maxlength="12" pattern="[0-9]{12}" inputmode="numeric" placeholder="12-Digit Numeric UPI UTR *" style="padding: 0.55rem; border-radius: 6px; border: 1px solid #374151; background: #1f2937; color: #fff; font-size: 0.85rem;">
              </div>
              <button type="submit" id="upiClaimBtn" class="btn-primary" style="background: #059669; font-size: 0.9rem; padding: 0.65rem 1rem;">
                Submit 12-Digit UPI UTR Claim (₹499)
              </button>
              <div id="upiClaimResultMsg" style="display: none; margin-top: 0.75rem; padding: 0.75rem; border-radius: 6px; font-size: 0.85rem;"></div>
            </form>
          </div>
        </div>

          <!-- Tier 2 Optional Order Bump (Hidden during first-sale conversion focus - Spec Stage P.3.5 Task 5) -->
          <div id="tier2OrderBumpSection" style="display: none; margin-top: 1.5rem; padding: 1.15rem; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 8px; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.45rem;">
              <strong style="color: #93c5fd; font-size: 0.95rem;">Tier 2 Optional Upgrade: Competitor SEO Gap &amp; 30-Day Search Console Action Pack</strong>
              <span style="font-size: 0.85rem; font-weight: 700; color: #fff; background: rgba(59, 130, 246, 0.25); padding: 2px 8px; border-radius: 4px;">₹1,999 One-Time</span>
            </div>
            <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 0.75rem;">
              Add SKU <code>sitefix_competitor_keyword_pack</code>: competitor keyword gap matrix, missing Schema.org templates, and a 30-day Google Search Console indexing sprint.
            </p>
            <button type="button" id="tier2OrderBumpBtn" onclick="requestTier2OrderBump()" style="background: #1d4ed8; color: #fff; border: 1px solid #3b82f6; border-radius: 6px; padding: 0.55rem 0.95rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;">
              Request Tier 2 Order Bump Checkout (₹1,999)
            </button>
            <div id="tier2OrderBumpStatus" style="display: none; margin-top: 0.65rem; font-size: 0.82rem; color: #bfdbfe;"></div>
          </div>

          <!-- Tier 3 B2B Partner Cross-Sell (Hidden during first-sale conversion focus - Spec Stage P.3.5 Task 5) -->
          <div id="tier3PartnerCrossSell" style="display: none; margin-top: 1.25rem; padding: 1.15rem; background: rgba(15, 23, 42, 0.7); border: 1px solid #1e293b; border-radius: 8px; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
              <strong style="color: #e2e8f0; font-size: 0.9rem;">Tier 3 Partner Cross-Sell: Verified Business &amp; Tech Stack Deals</strong>
              <span style="font-size: 0.72rem; color: #94a3b8;">#Ad &bull; Verified Affiliate Catalog</span>
            </div>
            <div id="tier3CrossSellList" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; font-size: 0.82rem; color: #94a3b8;">
              Loading verified partner offers...
            </div>
          </div>
        </div>

        <!-- Download Success Box -->
        <div class="download-success-box" id="downloadSuccessBox">
          <h4 style="color: var(--success); margin-bottom: 0.5rem;">Payment Verified Successfully!</h4>
          <p style="font-size: 0.9rem; color: #d1d5db; margin-bottom: 0.75rem;">
            Your 7-day (168-hour) entitlement token has been issued. Click below to download your complete Optimization Fix-Pack.
          </p>
          <div id="downloadRefDetails" style="font-family: monospace; font-size: 0.82rem; color: #94a3b8; margin-bottom: 1rem; line-height: 1.5;"></div>
          <a id="downloadLink" href="#" class="btn-primary" style="display: inline-block; text-decoration: none; max-width: 300px; padding: 0.75rem 1.5rem;" target="_blank">
            Download Fix-Pack (JSON / Markdown)
          </a>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentAuditId = null;
    let currentAuditTargetUrl = null;
    let currentReadiness = null;

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function checkReadiness() {
      try {
        const res = await fetch('/api/v1/tools/site-audit/readiness');
        const data = await res.json();
        currentReadiness = data;
        updateCheckoutUI();
      } catch (e) {
        currentReadiness = { status: 'LOCKED_MISSING_CONFIGURATION', isReady: false, paymentReadiness: { paymentMode: 'UNCONFIGURED' } };
        updateCheckoutUI();
      }
    }

    function updateCheckoutUI() {
      const notice = document.getElementById('checkoutGateNotice');
      const text = document.getElementById('checkoutStatusText');
      const btn = document.getElementById('checkoutBtn');
      const upiCard = document.getElementById('upiFallbackCard');
      const sandboxNotice = document.getElementById('sandboxTestModeNotice');
      // Default missing or failed readiness mode to UNCONFIGURED (Spec Stage R.1 Task 3.3 & Comment #13)
      const paymentMode = currentReadiness?.paymentReadiness?.paymentMode || 'UNCONFIGURED';

      if (sandboxNotice) {
        sandboxNotice.style.display = (currentReadiness?.isReady && paymentMode === 'SANDBOX') ? 'block' : 'none';
      }

      if (upiCard) {
        upiCard.style.display = paymentMode !== 'LIVE' ? 'block' : 'none';
      }

      const activeCtaText = (btn && btn.getAttribute('data-ab-cta')) || 'Fix All Issues for ₹499 — Instant AI Pack';
      if (!currentReadiness || !currentReadiness.isReady) {
        btn.disabled = true;
        btn.innerText = 'Checkout Unavailable (Gateway Maintenance)';
        notice.style.borderColor = 'var(--warning)';
        text.innerText = 'Online card/gateway checkout is currently undergoing verification or scheduled maintenance. You can complete your order securely using Direct UPI below.';
      } else if (paymentMode === 'LIVE') {
        btn.disabled = false;
        btn.innerText = activeCtaText;
        notice.style.borderColor = 'var(--success)';
        notice.style.background = 'rgba(16, 185, 129, 0.1)';
        text.innerHTML = '<strong style="color: var(--success);">Payment Gateway Active:</strong> Secure 256-bit encrypted checkout via Razorpay.';
      } else {
        btn.disabled = false;
        btn.innerText = activeCtaText;
        notice.style.borderColor = 'var(--success)';
        notice.style.background = 'rgba(16, 185, 129, 0.1)';
        text.innerHTML = '<strong style="color: var(--success);">Ready (Test Sandbox Mode):</strong> Razorpay Sandbox gateway connected. Use mock card or UPI to simulate transaction (Zero real currency moved).';
      }
    }

    // Check readiness on page load & pre-fill ?url= if linked from /audit/:domain
    checkReadiness();
    (function prefillUrlParam() {
      try {
        const params = new URLSearchParams(window.location.search);
        const qUrl = params.get('url');
        if (qUrl && (qUrl.startsWith('http://') || qUrl.startsWith('https://'))) {
          const input = document.getElementById('targetUrl');
          if (input) input.value = qUrl;
        }
      } catch {}
    })();

    function getLaunchAttributionSource() {
      try {
        const raw = (new URLSearchParams(window.location.search).get('source') || '').trim().toLowerCase();
        if (raw === 'cli' || raw === 'action' || raw === 'web' || raw === 'mcp') return raw;
      } catch {}
      return 'web';
    }

    async function handleAudit(e) {
      e.preventDefault();
      const url = document.getElementById('targetUrl').value;
      const websiteType = document.getElementById('websiteType').value;
      const btn = document.getElementById('scanBtn');

      btn.disabled = true;
      btn.innerText = 'Scanning Website (OWASP SSRF Protected)...';

      try {
        const res = await fetch('/api/v1/tools/site-audit/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            websiteType,
            userConfirmedOwnership: true,
            source: getLaunchAttributionSource()
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Scan failed: ' + (data.error || 'Server error'));
          return;
        }

        currentAuditId = data.result.auditId;
        currentAuditTargetUrl = data.result.url || url;
        renderResults(data.result);
      } catch (err) {
        alert('Scan error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Start Technical Website Scan';
      }
    }

    function renderResults(result) {
      document.getElementById('resultsCard').style.display = 'block';
      document.getElementById('scoreDisplay').textContent = String(result.score);
      document.getElementById('resultStatus').textContent = 'Audit Status: ' + result.overallStatus;
      document.getElementById('resultExplanation').textContent = result.scoreExplanation;

      let highCount = 0;
      let medCount = 0;
      (result.findings || []).forEach(f => {
        const sev = String(f.severity || '').toUpperCase();
        if (sev === 'HIGH' || sev === 'CRITICAL' || f.status === 'FAIL') highCount++;
        else if (sev === 'MEDIUM' || f.status === 'ISSUE' || f.status === 'WARNING') medCount++;
      });
      const summaryBanner = document.getElementById('findingsSummaryBanner');
      if (summaryBanner) {
        summaryBanner.style.display = 'block';
        summaryBanner.innerHTML = '<span style="color:#ef4444;font-weight:700;">' + highCount + ' High Priority Issues</span> &bull; <span style="color:#f59e0b;font-weight:700;">' + medCount + ' Medium Priority Issues</span> identified on ' + escapeHtml(result.domain || result.url || '');
      }

      const domainInput = document.getElementById('checkoutDomainInput');
      if (domainInput && !domainInput.value) {
        try {
          const u = new URL(result.url || currentAuditTargetUrl);
          domainInput.value = u.hostname;
        } catch {
          domainInput.value = result.domain || result.url || '';
        }
      }

      const container = document.getElementById('findingsContainer');
      container.innerHTML = '';

      result.findings.forEach(f => {
        const div = document.createElement('div');
        div.className = 'finding-item ' + (f.status === 'PASS' || f.status === 'WARNING' || f.status === 'ISSUE' ? f.status : 'INFO');

        const header = document.createElement('div');
        header.className = 'finding-header';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = '[' + f.category + '] ' + f.title;

        const badgeSpan = document.createElement('span');
        badgeSpan.style.fontSize = '0.8rem';
        badgeSpan.textContent = f.status + ' (' + f.severity + ')';

        header.appendChild(titleSpan);
        header.appendChild(badgeSpan);
        div.appendChild(header);

        if (f.evidence) {
          const evidenceDiv = document.createElement('div');
          evidenceDiv.style.fontSize = '0.85rem';
          evidenceDiv.style.color = '#9ca3af';
          evidenceDiv.style.marginBottom = '0.25rem';
          evidenceDiv.textContent = f.evidence;
          div.appendChild(evidenceDiv);
        }

        const recDiv = document.createElement('div');
        recDiv.style.fontSize = '0.9rem';
        recDiv.style.marginTop = '0.25rem';
        recDiv.innerHTML = '<strong>Action:</strong> ' + escapeHtml(f.recommendation);
        div.appendChild(recDiv);

        container.appendChild(div);
      });

      document.getElementById('resultsCard').scrollIntoView({ behavior: 'smooth' });
    }

    async function initiateCheckout() {
      if (!currentAuditId) {
        alert('Please run a website audit scan first.');
        return;
      }

      const btn = document.getElementById('checkoutBtn');
      const abExp = btn ? btn.getAttribute('data-ab-experiment') : null;
      const abVariant = btn ? btn.getAttribute('data-ab-variant') : null;
      if (abExp && abVariant) {
        try {
          fetch('/api/v1/public/storefront-experiments/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ experimentId: abExp, variant: abVariant, eventType: 'click', targetId: currentAuditId }),
            keepalive: true
          }).catch(function() {});
        } catch {}
      }
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Creating Payment Order...';
      }

      try {
        const domainInput = document.getElementById('checkoutDomainInput');
        const emailInput = document.getElementById('checkoutBuyerEmailInput');
        let targetDomain = (domainInput ? domainInput.value : '').trim() || currentAuditTargetUrl || (document.getElementById('targetUrl') ? document.getElementById('targetUrl').value : '');
        targetDomain = targetDomain.replace(/^https?:\\/\\//i, '').split('/')[0].trim();

        if (!targetDomain || !targetDomain.includes('.')) {
          alert('Please enter a valid website domain (e.g. example.com) to generate your custom Fix-Pack.');
          if (domainInput) domainInput.focus();
          if (btn) {
            btn.disabled = false;
            btn.innerText = (btn && btn.getAttribute('data-ab-cta')) || 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499';
          }
          return;
        }

        const buyerEmail = (emailInput ? emailInput.value : '').trim();
        if (!buyerEmail || !buyerEmail.includes('@') || !buyerEmail.includes('.')) {
          alert('Please provide a valid delivery email address to receive your order receipt and download token.');
          if (emailInput) emailInput.focus();
          if (btn) {
            btn.disabled = false;
            btn.innerText = (btn && btn.getAttribute('data-ab-cta')) || 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499';
          }
          return;
        }

        const checkoutUrl = '/api/v1/payments/razorpay/create-order';
        const checkoutPayload = {
          sku: 'SITEFIX_AI_PACK_V1',
          amountINR: 499,
          domainOrUrl: targetDomain,
          buyerEmail: buyerEmail,
          source: getLaunchAttributionSource()
        };

        const res = await fetch(checkoutUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(checkoutPayload)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Checkout unavailable: ' + (data.error || 'Server error'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = (btn && btn.getAttribute('data-ab-cta')) || 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499';
          }
          return;
        }

        if (!data.keyId) {
          throw new Error('Payment gateway keyId is missing from server checkout response.');
        }

        const isTestMode = Boolean(data.isTestMode || data.keyMode === 'TEST_SANDBOX' || (data.keyId && data.keyId.startsWith('rzp_test_')));
        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: isTestMode ? 'SiteFix AI Core Fix-Pack (Sandbox Test)' : 'SiteFix AI Core Fix-Pack',
          description: isTestMode
            ? 'Sandbox Mode — Simulated Test Payment (No Real Currency Moved)'
            : 'Website Optimization Fix-Pack for ' + targetDomain,
          notes: isTestMode ? {
            mode: 'test',
            sandbox: 'true',
            mock_card: '4100 2800 0000 1007',
            mock_upi: 'success@razorpay'
          } : {},
          handler: async function (response) {
            if (btn) btn.innerText = 'Verifying Payment Capture...';
            try {
              const verifyUrl = '/api/v1/payments/razorpay/verify';
              const verifyPayload = {
                orderId: data.orderId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                sku: 'SITEFIX_AI_PACK_V1',
                domainOrUrl: targetDomain,
                source: getLaunchAttributionSource()
              };

              const verifyRes = await fetch(verifyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(verifyPayload)
              });
              const verifyData = await verifyRes.json();
              const downloadUrl = verifyData.downloadUrl || verifyData.data?.downloadUrl;
              const token = verifyData.recheckToken || verifyData.downloadToken || verifyData.data?.recheckToken || verifyData.data?.downloadToken;
              if (verifyData.success && downloadUrl) {
                showDownloadSuccess(downloadUrl, response.razorpay_payment_id, data.orderId || response.razorpay_order_id, token);
              } else {
                alert('Payment received but verification pending. Please poll: ' + (verifyData.error || 'Unknown error'));
              }
            } catch (vErr) {
              alert('Payment verification request failed: ' + vErr.message);
            }
          },
          prefill: {
            name: 'SiteFix Customer',
            email: buyerEmail,
            contact: '9999999999'
          },
          theme: {
            color: isTestMode ? '#10b981' : '#0284c7'
          }
        };

        if (data.createdViaRazorpayApi === true || (data.order && data.order.createdViaRazorpayApi === true) || data.razorpayOrderId || data.orderId) {
          options.order_id = data.razorpayOrderId || data.orderId;
        }

        if (!options.order_id) {
          throw new Error('A genuine server-generated Razorpay order_id is required to launch Checkout.');
        }

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (resp) {
          alert('Payment Failed: ' + (resp.error?.description || 'Unknown error'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = (btn && btn.getAttribute('data-ab-cta')) || 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499';
          }
        });
        rzp.open();
        try {
          fetch('/api/v1/referrals/beacon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stage: 'checkout_open_invoked',
              event: 'checkout_open_invoked',
              source: 'site-audit',
              auditId: (data && (data.auditId || (data.order && data.order.auditId))) || null,
              orderId: options.order_id
            }),
            keepalive: true
          }).catch(function () {});
        } catch (e) {}
      } catch (err) {
        alert('Checkout error: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = (btn && btn.getAttribute('data-ab-cta')) || 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499';
        }
      }
    }

    function parseEmbeddedTokenExpiry(token) {
      if (!token || typeof token !== 'string') return null;
      const parts = token.trim().split('.');
      let expStr = null;
      if (parts.length === 5) expStr = parts[3];
      else if (parts.length === 4) expStr = parts[2];
      else return null;
      const expMs = Number.parseInt(expStr, 10);
      return Number.isFinite(expMs) && expMs > 0 ? expMs : null;
    }

    function isEmbeddedRecheckTokenValid(token) {
      const expMs = parseEmbeddedTokenExpiry(token);
      return expMs !== null && Date.now() <= expMs;
    }

    let currentPurchaseRecheckToken = '';

    function getValidRecheckToken() {
      try {
        if (currentPurchaseRecheckToken && isEmbeddedRecheckTokenValid(currentPurchaseRecheckToken)) {
          return currentPurchaseRecheckToken;
        }
        const params = new URLSearchParams(window.location.search || '');
        const urlToken = (params.get('recheckToken') || params.get('token') || '').trim();
        if (urlToken) {
          if (isEmbeddedRecheckTokenValid(urlToken)) {
            try { localStorage.setItem('sitefix_recheck_token', urlToken); } catch {}
            return urlToken;
          }
          try { localStorage.removeItem('sitefix_recheck_token'); } catch {}
          return null;
        }
        const storedToken = (localStorage.getItem('sitefix_recheck_token') || '').trim();
        if (storedToken) {
          if (isEmbeddedRecheckTokenValid(storedToken)) {
            return storedToken;
          }
          localStorage.removeItem('sitefix_recheck_token');
        }
      } catch {}
      return null;
    }

    async function runIncludedVerificationRecheck() {
      const token = getValidRecheckToken();
      const outEl = document.getElementById('recheckStatusBox');
      if (!token) {
        if (outEl) {
          outEl.style.display = 'block';
          outEl.style.color = '#f87171';
          outEl.textContent = 'Your Fix-Pack verification token is missing or expired. Expired tokens are automatically cleared.';
        }
        return;
      }
      if (outEl) {
        outEl.style.display = 'block';
        outEl.style.color = '#38bdf8';
        outEl.textContent = 'Running fresh verification recheck...';
      }
      try {
        const res = await fetch('/api/v1/tools/site-audit/recheck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token })
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Recheck failed');
        }
        const cmp = json.data.comparison;
        if (outEl) {
          outEl.style.color = '#34d399';
          outEl.innerHTML = '<strong>Recheck Complete:</strong> Score ' + cmp.baselineScore + ' &rarr; ' + cmp.recheckScore +
            ' (Delta: ' + (cmp.scoreDelta >= 0 ? '+' : '') + cmp.scoreDelta + ') &bull; Resolved: ' +
            cmp.resolvedChecks.length + ' &bull; Remaining: ' + cmp.remainingChecks.length;
        }
      } catch (err) {
        if (outEl) {
          outEl.style.color = '#f87171';
          outEl.textContent = 'Recheck error: ' + err.message;
        }
      }
    }

    function showDownloadSuccess(downloadUrl, paymentId, orderId, token) {
      document.getElementById('checkoutActionContainer').style.display = 'none';
      const box = document.getElementById('downloadSuccessBox');
      box.style.display = 'block';
      const link = document.getElementById('downloadLink');
      link.href = downloadUrl;
      try {
        let dlToken = token || '';
        if (!dlToken && downloadUrl) {
          const parsed = new URL(downloadUrl, window.location.origin);
          dlToken = parsed.searchParams.get('token') || parsed.pathname.split('/').filter(Boolean).pop() || '';
        }
        if (dlToken && isEmbeddedRecheckTokenValid(dlToken)) {
          currentPurchaseRecheckToken = dlToken;
          localStorage.setItem('sitefix_recheck_token', dlToken);
        }
      } catch {}
      const refEl = document.getElementById('downloadRefDetails');
      if (refEl && (paymentId || orderId)) {
        refEl.innerHTML = (orderId ? '<strong>Order ID:</strong> ' + escapeHtml(orderId) + '<br>' : '') +
                          (paymentId ? '<strong>Payment ID:</strong> ' + escapeHtml(paymentId) : '') +
                          '<div style="margin-top:0.75rem;"><button type="button" onclick="runIncludedVerificationRecheck()" class="btn-primary" style="font-size:0.85rem;padding:0.5rem 0.9rem;">Run Included Verification Recheck</button><div id="recheckStatusBox" style="display:none;margin-top:0.5rem;font-size:0.85rem;"></div></div>';
      }
    }

    async function submitSiteAuditSendReport(e) {
      e.preventDefault();
      const emailEl = document.getElementById('sendReportEmail');
      const consentEl = document.getElementById('sendReportConsent');
      const btn = document.getElementById('sendReportBtn');
      const statusEl = document.getElementById('sendReportStatus');
      const targetVal = (currentAuditTargetUrl || document.getElementById('targetUrl')?.value || '').trim();
      const emailVal = (emailEl?.value || '').trim();
      const consentVal = Boolean(consentEl?.checked);

      if (!targetVal || !emailVal || !consentVal) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = 'Please run a scan, enter a valid email, and check the DPDP consent box.';
        }
        return;
      }

      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Sending Private Audit...';
      }

      try {
        const res = await fetch('/api/v1/tools/site-audit/send-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domainOrUrl: targetVal,
            email: emailVal,
            consentGiven: consentVal
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || 'Unable to send audit report');
        }
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.color = '#34d399';
          statusEl.innerHTML = (data.emailDispatched
            ? '<strong>✓ Private Audit Emailed!</strong> '
            : '<strong>✓ Private Audit Link Ready!</strong> ') +
            'Scorecard: <a href="' + escapeHtml(data.previewUrl) + '" style="color:#38bdf8;" target="_blank">Open Signed Report &rarr;</a>' +
            ' &bull; <a href="' + escapeHtml(data.checkoutUrl) + '" style="color:#34d399;">₹499 Fix-Pack Checkout &rarr;</a>';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239, 68, 68, 0.15)';
          statusEl.style.color = '#f87171';
          statusEl.textContent = 'Error: ' + (err.message || 'Unable to send email');
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Email Report & Fix-Pack Link';
        }
      }
    }

    async function submitSiteAuditUpiClaim(e) {
      e.preventDefault();
      if (!currentAuditId) {
        alert('Please run a website audit scan first so your UPI claim binds to a verified auditId.');
        return;
      }
      const claimBtn = document.getElementById('upiClaimBtn');
      const msgEl = document.getElementById('upiClaimResultMsg');
      const domainInput = document.getElementById('checkoutDomainInput');
      const emailInput = document.getElementById('checkoutBuyerEmailInput');
      const upiEmailInput = document.getElementById('upiBuyerEmail');

      let targetDomain = (domainInput ? domainInput.value : '').trim() || (document.getElementById('targetUrl')?.value || '').trim();
      targetDomain = targetDomain.replace(/^https?:\\/\\//i, '').split('/')[0].trim();

      if (!targetDomain || !targetDomain.includes('.')) {
        alert('Please enter a valid website domain (e.g. example.com) before submitting your UPI payment claim.');
        if (domainInput) domainInput.focus();
        return;
      }

      const buyerEmail = ((upiEmailInput ? upiEmailInput.value : '') || (emailInput ? emailInput.value : '')).trim();
      if (!buyerEmail || !buyerEmail.includes('@') || !buyerEmail.includes('.')) {
        alert('Please enter a valid buyer email address to receive your Fix-Pack download token upon bank verification.');
        if (upiEmailInput) upiEmailInput.focus();
        else if (emailInput) emailInput.focus();
        return;
      }

      const utrVal = (document.getElementById('upiUtrInput')?.value || '').trim();
      if (!/^[0-9]{12}$/.test(utrVal)) {
        alert('Please enter a valid 12-digit numeric UPI UTR reference.');
        return;
      }
      const payerName = (document.getElementById('upiPayerName')?.value || '').trim();
      const payerPhone = (document.getElementById('upiPayerPhone')?.value || '').trim();

      claimBtn.disabled = true;
      claimBtn.innerText = 'Submitting UTR Claim...';

      try {
        const res = await fetch('/api/v1/offer/upi-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auditId: currentAuditId,
            domainOrUrl: targetDomain,
            source: getLaunchAttributionSource(),
            buyerEmail,
            payerName,
            payerPhone,
            utr: utrVal,
            amountINR: 499
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          msgEl.style.display = 'block';
          msgEl.style.background = 'rgba(16, 185, 129, 0.15)';
          msgEl.style.color = '#34d399';
          msgEl.innerHTML = '<strong>✓ UPI Claim Submitted (PAYMENT_CLAIMED)!</strong> Ref: <code>' + escapeHtml(data.data?.claimId || currentAuditId) + '</code> &bull; Delivery email: <code>' + escapeHtml(buyerEmail) + '</code> &bull; Awaiting owner bank statement verification on /owner/today before fulfillment.';
          claimBtn.style.display = 'none';
        } else {
          throw new Error(data.error || 'UPI claim submission failed');
        }
      } catch (err) {
        msgEl.style.display = 'block';
        msgEl.style.background = 'rgba(239, 68, 68, 0.15)';
        msgEl.style.color = '#f87171';
        msgEl.innerText = 'Error: ' + err.message;
        claimBtn.disabled = false;
        claimBtn.innerText = 'Submit 12-Digit UPI UTR Claim (₹499)';
      }
    }

    async function requestTier2OrderBump() {
      const btn = document.getElementById('tier2OrderBumpBtn');
      const statusEl = document.getElementById('tier2OrderBumpStatus');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Creating Tier 2 Order Bump Checkout...';
      }
      try {
        const res = await fetch('/api/v1/customer-desk/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'I want to buy sitefix_competitor_keyword_pack Tier 2 order bump',
            productSlugOrContext: 'sitefix_competitor_keyword_pack',
            channel: 'WEB_DESK'
          })
        });
        const data = await res.json();
        const checkout = data?.data?.checkout || data?.checkout;
        if (statusEl) {
          statusEl.style.display = 'block';
          if (checkout?.upiDeepLink) {
            statusEl.innerHTML = 'Order <code>' + escapeHtml(checkout.orderId || 'sitefix_competitor_keyword_pack') + '</code> created (₹1,999). <a href="' + escapeHtml(checkout.upiDeepLink) + '" style="color:#60a5fa;font-weight:600;">Pay via UPI App &rarr;</a>';
          } else {
            statusEl.textContent = data?.data?.responseTemplate || data?.responseTemplate || 'Tier 2 Order Bump brief sent.';
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.textContent = 'Unable to create Tier 2 checkout right now.';
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Request Tier 2 Order Bump Checkout (₹1,999)';
        }
      }
    }

    (async function hydrateTier3CrossSells() {
      const container = document.getElementById('tier3CrossSellList');
      if (!container) return;
      try {
        const res = await fetch('/api/v1/public/deals?limit=3');
        const json = await res.json();
        const deals = json?.data?.deals || [];
        if (!Array.isArray(deals) || deals.length === 0) {
          container.innerHTML = '<div style="color:#94a3b8;">No active verified partner cross-sells currently listed. Browse <a href="/deals" style="color:#38bdf8;">/deals</a> for verified merchant offers.</div>';
          return;
        }
        container.innerHTML = deals.slice(0, 3).map(function(d) {
          const priceStr = Number(d.currentPriceINR || 0) > 0 ? '₹' + Number(d.currentPriceINR).toLocaleString('en-IN') : 'Verified Offer';
          const href = '/api/v1/public/deals/' + encodeURIComponent(d.id) + '/redirect?placement=sitefix_tier3_cross_sell';
          return '<div style="background:rgba(2,6,23,0.65);border:1px solid #334155;border-radius:6px;padding:0.75rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.45rem;">' +
            '<div><div style="font-size:0.7rem;color:#38bdf8;font-weight:700;">' + escapeHtml(d.category || 'Partner Tool') + '</div>' +
            '<div style="color:#f8fafc;font-weight:600;font-size:0.82rem;margin:0.2rem 0;">' + escapeHtml(d.title) + '</div></div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;">' +
            '<span style="color:#e2e8f0;font-weight:700;">' + escapeHtml(priceStr) + '</span>' +
            '<a href="' + escapeHtml(href) + '" target="_blank" rel="sponsored nofollow noopener" style="color:#38bdf8;font-weight:600;text-decoration:none;font-size:0.78rem;">View Partner &rarr;</a>' +
            '</div></div>';
        }).join('');
      } catch {
        container.innerHTML = '<div style="color:#94a3b8;">Browse verified partner deals at <a href="/deals" style="color:#38bdf8;">/deals</a>.</div>';
      }
    })();

    // Sync buyer delivery email across checkout inputs & hydrate ?url= / valid recheck token
    document.addEventListener('DOMContentLoaded', function() {
      var mainEmail = document.getElementById('checkoutBuyerEmailInput');
      var upiEmail = document.getElementById('upiBuyerEmail');
      if (mainEmail && upiEmail) {
        mainEmail.addEventListener('input', function() {
          if (!upiEmail.value || upiEmail.dataset.userEdited !== 'true') {
            upiEmail.value = mainEmail.value;
          }
        });
        upiEmail.addEventListener('input', function() {
          upiEmail.dataset.userEdited = 'true';
        });
      }
      try {
        var params = new URLSearchParams(window.location.search || '');
        var prefillUrl = (params.get('url') || '').trim();
        var urlInput = document.getElementById('targetUrl');
        if (prefillUrl && urlInput && !urlInput.value) {
          urlInput.value = prefillUrl;
        }
        getValidRecheckToken();
      } catch {}

      try {
        var sKey = 'sitefix_session_uuid';
        var sessId = window.sessionStorage.getItem(sKey);
        if (!sessId) {
          sessId = 'sess_' + (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).substring(2) + Date.now().toString(36));
          window.sessionStorage.setItem(sKey, sessId);
        }
        fetch('/api/v1/referrals/beacon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'site-audit',
            sessionId: sessId,
            url: window.location.href,
            referrer: document.referrer || ''
          }),
          keepalive: true
        }).catch(function() {});
      } catch {}
    });
  </script>
  <footer style="margin-top: 3rem; border-top: 1px solid var(--card-border); padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
    <nav style="display: flex; flex-wrap: wrap; justify-content: center; gap: 1.25rem; margin-bottom: 0.75rem;">
      <a href="/" style="color: var(--text-muted); text-decoration: none;">Home</a>
      <a href="/deals" style="color: var(--text-muted); text-decoration: none;">Verified Deals</a>
      <a href="/tools/site-audit" style="color: var(--text-muted); text-decoration: none;">Full Site Audit</a>
      <a href="/privacy" style="color: var(--text-muted); text-decoration: none;">Privacy Policy</a>
      <a href="/terms" style="color: var(--text-muted); text-decoration: none;">Terms of Service</a>
      <a href="/refund" style="color: var(--text-muted); text-decoration: none;">7-Day Refund Policy</a>
      <a href="/contact" style="color: var(--text-muted); text-decoration: none;">Contact &amp; Grievance</a>
      <a href="/disclosure" style="color: var(--text-muted); text-decoration: none;">Affiliate Disclosure</a>
    </nav>
    <p style="margin-bottom: 0.4rem;"><strong>7-Day 100% Refund Policy:</strong> Full refund if Fix-Pack deliverables fail verification recheck. Support: <a href="mailto:support@ai-marketing-organization.com" style="color: var(--primary); text-decoration: underline;">support@ai-marketing-organization.com</a></p>
    <p style="font-size: 0.8rem; color: #6b7280;">&copy; ${new Date().getFullYear()} AI Marketing Organization. All rights reserved. Registered in Hyderabad, Telangana, India.</p>
  </footer>
  ${renderCustomerDeskWidgetHtml('SITEFIX_AI_PACK_V1')}
</body>
</html>`;
}
