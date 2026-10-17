/**
 * DirectCommercialOfferPage — Static & dynamic public commercial offer page for Lane B.
 *
 * Implements Part E: Direct Lane (from owner/OWN_OFFER.md)
 * Gated by explicit owner attestation (P0 Safety Rule).
 *
 * Until explicit owner attestation is confirmed:
 * - /offer renders a safe, non-payment informational overview with zero unverified contact details.
 * - Does not show unconfirmed prices, guarantees, UPI VPAs, WhatsApp CTAs, or payment links.
 * - robots meta tag is set to 'noindex, nofollow'.
 * - Platform checkout endpoints fail closed.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isProduction } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export function computeOwnOfferHash(customFilePath?: string): string | null {
  try {
    let filePath = customFilePath;
    if (!filePath) {
      const candidates = [
        path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md'),
        path.resolve(process.cwd(), '..', 'owner', 'OWN_OFFER.md'),
        path.resolve(process.cwd(), '..', '..', 'owner', 'OWN_OFFER.md')
      ];
      filePath = candidates.find(c => fs.existsSync(c));
    }
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

export interface OfferPageConfig {
  siteName?: string;
  siteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  upiVpa?: string;
  razorpayMeUrl?: string;
}

export class DirectCommercialOfferPage {
  private static instance: DirectCommercialOfferPage;
  private d1Repo = D1RevenueRepository.getInstance();

  public static computeOwnOfferHash(customFilePath?: string): string | null {
    return computeOwnOfferHash(customFilePath);
  }

  public static getInstance(): DirectCommercialOfferPage {
    if (!DirectCommercialOfferPage.instance) {
      DirectCommercialOfferPage.instance = new DirectCommercialOfferPage();
    }
    return DirectCommercialOfferPage.instance;
  }

  /**
   * P0 Safety Gate: Checks whether Lane B commercial terms have been explicitly attested by the owner.
   * /offer opens only when Render env DIRECT_OFFER_TERMS_SHA256 equals SHA-256 of owner/OWN_OFFER.md.
   * Any file edit to owner/OWN_OFFER.md alters the hash and closes the page immediately.
   */
  public static isDirectOfferAttested(customFilePath?: string): boolean {
    const expectedHash = process.env.DIRECT_OFFER_TERMS_SHA256?.trim();
    if (!expectedHash) {
      return false;
    }
    const computedHash = computeOwnOfferHash(customFilePath);
    if (!computedHash) {
      return false;
    }
    return computedHash.toLowerCase() === expectedHash.toLowerCase();
  }

  /**
   * Records a PAYMENT_PAGE_VIEW event for audit trail without recognizing revenue.
   */
  public async recordPageView(clientIpHash: string, userAgent?: string, referer?: string): Promise<void> {
    const id = `ref_view_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const clickId = `clk_view_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;

    const sql = `
      INSERT INTO referrals (
        id, partner_id, offer_id, organization_id, click_id,
        landing_page, source, destination_url, ip, user_agent, referer, created_at
      ) VALUES (
        ?, 'part_direct_own_01', 'PLATFORM_SETUP', ?, ?,
        '/offer', 'direct_offer_page', '/offer', ?, ?, ?, datetime('now')
      )
    `;

    try {
      if (isProduction()) {
        await this.d1Repo.executeWrite('referrals', sql, [
          id, orgId, clickId, clientIpHash || 'unknown',
          (userAgent || 'unknown').slice(0, 150),
          (referer || 'direct').slice(0, 150)
        ]);
      } else {
        const db = getDb();
        db.prepare(sql).run(
          id, orgId, clickId, clientIpHash || 'unknown',
          (userAgent || 'unknown').slice(0, 150),
          (referer || 'direct').slice(0, 150)
        );
      }
    } catch (err: any) {
      console.warn('[DirectOfferPage] Failed to log page view event:', err.message);
    }
  }

  /**
   * Generates a deterministic order reference ID for payment tracking.
   */
  public generateOrderReference(prefix: string = 'LCS'): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${dateStr}-${rand}`;
  }

  /**
   * Renders the HTML offer page.
   * If commercial terms are un-attested, renders a safe informational overview with zero payment links.
   */
  public renderOfferHtml(config: Partial<OfferPageConfig> = {}, customOfferPath?: string): string {
    const isAttested = DirectCommercialOfferPage.isDirectOfferAttested(customOfferPath);
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
    const siteUrl = config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : null);

    if (!isAttested) {
      return this.renderUnattestedOverviewHtml(siteName, siteUrl, contactEmail);
    }

    return this.renderAttestedOfferHtml(siteName, siteUrl, contactEmail, config);
  }

  /**
   * Safe, non-payment informational overview page shown when commercial terms are pending owner attestation.
   * Zero unconfirmed prices, zero guarantees, zero fake UPI VPAs, zero WhatsApp CTAs with unverified numbers.
   */
  private renderUnattestedOverviewHtml(siteName: string, siteUrl: string, contactEmail: string | null): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Inbound Lead Conversion System | Service Overview</title>
  <meta name="description" content="Technical overview of the AI Inbound Lead Conversion System for local businesses in India. Commercial configuration pending owner attestation.">
  <link rel="canonical" href="${siteUrl}/offer">
  <meta name="robots" content="noindex, nofollow">
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2.5rem; }
    .status-badge {
      display: inline-block;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 0.4rem 1rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.25;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.1rem;
      color: var(--text-muted);
      max-width: 680px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.75rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 1.35rem;
      color: #fff;
      margin-bottom: 1rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    ul.check-list {
      list-style: none;
    }
    ul.check-list li {
      padding: 0.4rem 0;
      color: #cbd5e1;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .pending-notice {
      background: rgba(30, 41, 59, 0.6);
      border: 1px dashed #334155;
      border-radius: 10px;
      padding: 1.25rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="status-badge">Configuration Pending Owner Attestation</div>
      <h1>AI Inbound Lead Conversion System</h1>
      <p class="subtitle">24/7 automated inquiry qualification, WhatsApp response bot, and CRM integration architecture for local service businesses in India.</p>
    </header>

    <div class="card">
      <h2>Commercial Terms & Direct Checkout Status</h2>
      <div class="pending-notice">
        <p><strong>Commercial terms, pricing, and payment destinations are currently pending owner attestation.</strong></p>
        <p style="margin-top: 0.5rem;">Direct online checkout is disabled. In accordance with platform governance rules, no unconfirmed pricing, payment rails, or statutory guarantees are displayed until explicitly confirmed by the authorized owner.</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>What The System Delivers</h2>
        <ul class="check-list">
          <li>✓ Custom WhatsApp automated inquiry qualification bot</li>
          <li>✓ Google Business Profile instant lead capture</li>
          <li>✓ Multi-touch follow-up workflow for after-hours leads</li>
          <li>✓ Direct appointment scheduling integration</li>
          <li>✓ System handover report and response logs</li>
        </ul>
      </div>

      <div class="card">
        <h2>Target Fit Criteria</h2>
        <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 0.75rem;"><strong>Ideal for:</strong> High-ticket local service businesses (dental clinics, diagnostic centers, specialized repair services, consultancy firms) receiving &gt; 50 inquiries/month.</p>
        <p style="color: #94a3b8; font-size: 0.95rem;"><strong>Not suitable for:</strong> E-commerce stores without after-hours inquiry delays, or businesses without an active WhatsApp Business number.</p>
      </div>
    </div>

    <div class="card" id="inquiry-card">
      <h2>Request Lead Triage Demonstration</h2>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Are inquiries falling through the cracks outside clinic hours? Submit your practice details for a confidential system demonstration and architecture walkthrough.
      </p>
      <form id="lead-inquiry-form" onsubmit="handleInquirySubmit(event)">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Doctor / Contact Name *</label>
            <input type="text" id="cust-name" required placeholder="Dr. Rajesh Sharma" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">WhatsApp / Mobile Number *</label>
            <input type="tel" id="cust-phone" required placeholder="9876543210" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Clinic / Practice Name &amp; City *</label>
            <input type="text" id="cust-service" required placeholder="Apex Dental Clinic, Hyderabad" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Email (Optional)</label>
            <input type="email" id="cust-email" placeholder="contact@apexdental.com" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Primary Inquiry Challenge (e.g. evening patient calls, WhatsApp FAQ automation)</label>
          <textarea id="cust-notes" rows="2" placeholder="Patients reaching out after 8 PM wait until next morning. Want instant 24/7 WhatsApp qualification." style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem; font-family: inherit;"></textarea>
        </div>
        <button type="submit" id="submit-btn" style="background: #0284c7; color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; width: 100%;">
          Request Lead Triage Demonstration
        </button>
        <div id="form-msg" style="display: none; margin-top: 1rem; padding: 0.75rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
      </form>
    </div>

    <div class="card">
      <h2>Contact & Commercial Verification</h2>
      <p style="color: #cbd5e1; font-size: 0.95rem;">
        ${contactEmail ? `For inquiries regarding this commercial system, contact: <a href="mailto:${contactEmail}" style="color: var(--accent);">${contactEmail}</a>` : 'Owner contact email is currently pending configuration.'}
      </p>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
      <p style="margin-top: 0.35rem;">Technical overview page • Not an offer to contract until terms are owner-attested.</p>
    </footer>
  </div>

  <script>
    async function handleInquirySubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('submit-btn');
      var msg = document.getElementById('form-msg');
      btn.disabled = true;
      btn.innerText = 'Submitting...';

      var payload = {
        customerName: document.getElementById('cust-name').value.trim(),
        customerPhone: document.getElementById('cust-phone').value.trim(),
        customerEmail: document.getElementById('cust-email').value.trim() || undefined,
        serviceOfInterest: document.getElementById('cust-service').value.trim(),
        notes: document.getElementById('cust-notes').value.trim(),
        source: 'offer_page_inquiry',
        channel: 'WHATSAPP'
      };

      try {
        var res = await fetch('/api/v1/offer/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          msg.innerText = '✓ Thank you! Your consultation inquiry has been logged. Our systems have scheduled an automated architecture review.';
          document.getElementById('lead-inquiry-form').reset();
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
        btn.innerText = 'Request Lead Triage Demonstration';
      }
    }

    try {
      fetch('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placement: 'offer_page_view',
          source: 'direct_offer_overview',
          contentSlug: 'offer'
        })
      }).catch(function() {});
    } catch (e) {}
  </script>
</body>
</html>`;
  }

  /**
   * Attested offer page shown when the human owner has explicitly attested Lane B terms.
   */
  private renderAttestedOfferHtml(
    siteName: string,
    siteUrl: string,
    contactEmail: string | null,
    config: Partial<OfferPageConfig>
  ): string {
    const upiVpa = config.upiVpa || process.env.OWNER_UPI_VPA || process.env.PLATFORM_UPI_VPA || null;
    const razorpayUrl = config.razorpayMeUrl || process.env.OWNER_RAZORPAY_ME_URL || process.env.PLATFORM_RAZORPAY_ME_URL || null;
    const whatsappNum = (config.contactPhone || process.env.OWNER_WHATSAPP_NUMBER || process.env.PUBLIC_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
    const orderRef = this.generateOrderReference('LCS');

    const setupPriceINR = 15000;
    const monthlyPriceINR = 8000;

    const upiUri = upiVpa
      ? `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(siteName)}&am=${setupPriceINR}&tr=${encodeURIComponent(orderRef)}&cu=INR&tn=${encodeURIComponent(`Platform Setup Ref ${orderRef}`)}`
      : null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Inbound Lead Conversion System | Commercial Offer</title>
  <meta name="description" content="Turn after-hours inquiries into booked appointments. Complete setup, CRM & WhatsApp integration, and 24/7 lead conversion activation for local businesses in India.">
  <link rel="canonical" href="${siteUrl}/offer">
  <meta name="robots" content="index, follow">
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --accent-hover: #22d3ee;
      --success: #10b981;
      --warning: #f59e0b;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 960px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2.5rem; }
    .badge {
      display: inline-block;
      background: rgba(6, 182, 212, 0.15);
      color: #67e8f9;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 0.35rem 0.9rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 2.4rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.15rem;
      color: var(--text-muted);
      max-width: 720px;
      margin: 0 auto;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.75rem;
      margin: 2.5rem 0;
    }
    .tier-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .tier-card.featured {
      border-color: var(--accent);
      box-shadow: 0 0 25px rgba(6, 182, 212, 0.15);
    }
    .tier-name { font-size: 1.35rem; font-weight: 700; color: #fff; margin-bottom: 0.5rem; }
    .tier-desc { font-size: 0.92rem; color: var(--text-muted); margin-bottom: 1.5rem; min-height: 48px; }
    .price-box { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--card-border); }
    .price-amount { font-size: 2.5rem; font-weight: 800; color: #fff; }
    .price-period { color: var(--text-muted); font-size: 0.95rem; }
    .feature-list { list-style: none; margin-bottom: 2rem; flex-grow: 1; }
    .feature-list li {
      font-size: 0.92rem;
      margin-bottom: 0.85rem;
      color: #cbd5e1;
    }
    .btn {
      display: block;
      width: 100%;
      text-align: center;
      background: var(--accent);
      color: #090d16;
      font-weight: 700;
      padding: 0.85rem 1.25rem;
      border-radius: 8px;
      text-decoration: none;
      font-size: 1rem;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      margin-top: 0.75rem;
    }
    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge">Commercial Offer</div>
      <h1>AI Inbound Lead Conversion System</h1>
      <p class="subtitle">Complete setup, CRM & WhatsApp integration, and 24/7 lead conversion activation for local businesses in India.</p>
    </header>

    <div class="pricing-grid">
      <!-- Tier 1 -->
      <div class="tier-card featured">
        <h2 class="tier-name">Day 0–5 Setup &amp; Integration</h2>
        <p class="tier-desc">Complete setup, qualification rules, and 24/7 lead conversion activation. Delivery Time: 5 Business Days.</p>
        <div class="price-box">
          <span class="price-amount">₹${setupPriceINR.toLocaleString('en-IN')}</span>
          <span class="price-period">one-time investment (5-day delivery)</span>
        </div>
        <ul class="feature-list">
          <li>✓ Custom WhatsApp qualification &amp; FAQ bot (&lt; 2 min response)</li>
          <li>✓ Google Business Profile instant lead capture</li>
          <li>✓ 3-step multi-touch follow-up workflow</li>
          <li>✓ Direct calendar booking integration</li>
          <li>✓ Live system handover report &amp; staff walkthrough</li>
        </ul>
        ${upiUri ? `<a href="${upiUri}" class="btn">Pay ₹${setupPriceINR.toLocaleString('en-IN')} via UPI</a>` : ''}
        ${razorpayUrl ? `<a href="${razorpayUrl}" class="btn btn-secondary" target="_blank" rel="noopener">Pay via Razorpay</a>` : ''}
      </div>

      <!-- Tier 2 -->
      <div class="tier-card">
        <h2 class="tier-name">Monthly Retainer &amp; SLA</h2>
        <p class="tier-desc">Continuous triage optimization, reminder workflows, and monthly conversion reporting. Continuous 30-day service.</p>
        <div class="price-box">
          <span class="price-amount">₹${monthlyPriceINR.toLocaleString('en-IN')}</span>
          <span class="price-period">/ month (cancel anytime)</span>
        </div>
        <ul class="feature-list">
          <li>✓ 24/7 automated lead response under 2 minutes</li>
          <li>✓ Ongoing prompt &amp; qualification tuning</li>
          <li>✓ Weekly show-rate and conversion reporting</li>
          <li>✓ Continuous DPDP compliance monitoring</li>
        </ul>
        ${whatsappNum ? `<a href="https://wa.me/${whatsappNum}?text=${encodeURIComponent(`Hi, I would like to subscribe to the AI Lead Conversion Monthly Retainer for my business.`)}" class="btn btn-secondary" target="_blank" rel="noopener">Inquire via WhatsApp</a>` : ''}
      </div>
    </div>

    <!-- Verified Payment Methods: Method A (Razorpay Dynamic Link) & Method B (Attached UPI QR) -->
    <div style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 16px; padding: 2rem; margin-bottom: 2.5rem;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;">
        <div>
          <h2 style="font-size: 1.5rem; color: #fff;">Verified Payment Options</h2>
          <p style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.25rem;">Choose between authenticated server-side Razorpay checkout or instant UPI scan.</p>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 0.4rem 0.8rem; border-radius: 8px; font-size: 0.8rem; color: #fca5a5;">
          Fixed ₹100 legacy links permanently deactivated
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.75rem;">
        <!-- Method A -->
        <div style="background: #0b1120; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column;">
          <h3 style="color: #38bdf8; font-size: 1.15rem; margin-bottom: 0.5rem;">Method A — Razorpay Payment Link</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1.25rem; flex-grow: 1;">
            Generate an authenticated Razorpay payment link for the exact approved invoice amount. Supports Credit/Debit Cards, Netbanking, and UPI with instant webhook verification.
          </p>
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            <button onclick="createDynamicLink('PLATFORM_SETUP', 'Day 0-5 Setup', 15000)" class="btn" style="padding: 0.75rem; font-size: 0.92rem;">
              Generate ₹15,000 Setup Link
            </button>
            <button onclick="createDynamicLink('PLATFORM_MONTHLY', 'Monthly Retainer', 8000)" class="btn btn-secondary" style="padding: 0.75rem; font-size: 0.92rem; margin-top: 0;">
              Generate ₹8,000 Retainer Link
            </button>
          </div>
          <div id="dynamic-link-box" style="display: none; margin-top: 1rem; padding: 0.85rem; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px;">
            <p style="font-size: 0.82rem; color: #bae6fd; margin-bottom: 0.5rem;" id="dynamic-link-desc"></p>
            <a id="dynamic-link-anchor" href="#" target="_blank" rel="noopener" class="btn" style="padding: 0.6rem; font-size: 0.9rem;">
              Proceed to Razorpay Checkout →
            </a>
          </div>
        </div>

        <!-- Method B -->
        <div style="background: #0b1120; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; text-align: center;">
          <h3 style="color: #34d399; font-size: 1.15rem; margin-bottom: 0.5rem;">Method B — Authentic Razorpay UPI QR</h3>
          <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1rem;">
            Scan with Google Pay, PhonePe, Paytm, or BHIM. Enter invoice amount (₹15,000 Setup or ₹8,000 Retainer).
          </p>
          <div style="background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 1rem; display: inline-block;">
            <img src="${OwnerAuthService.PLATFORM_QR_ASSET_PATH}" alt="Razorpay UPI QR" style="max-width: 200px; width: 100%; border-radius: 8px; cursor: pointer; border: 2px solid #334155;" onclick="window.open(this.src, '_blank')">
            <p style="font-size: 0.85rem; color: #fff; font-weight: 700; margin-top: 0.5rem;">${OwnerAuthService.PLATFORM_MERCHANT_NAME}</p>
            <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 0.15rem;"><code>${OwnerAuthService.PLATFORM_UPI_VPA}</code></p>
            <p style="font-size: 0.75rem; color: #64748b; margin-top: 0.25rem;">Invoice Ref: <strong>${orderRef}</strong></p>
          </div>
          <button class="btn btn-secondary" style="margin-top: 0.75rem; font-size: 0.85rem;" onclick="navigator.clipboard.writeText('${OwnerAuthService.PLATFORM_UPI_VPA}'); alert('Merchant UPI ID copied: ${OwnerAuthService.PLATFORM_UPI_VPA}')">
            Copy Merchant UPI ID
          </button>
        </div>
      </div>

      <!-- Interactive UTR Submission Form -->
      <div id="upi-claim-card" style="margin-top: 2rem; border-top: 1px solid var(--card-border); padding-top: 1.5rem;">
        <h3 style="font-size: 1.15rem; color: #fff; margin-bottom: 0.5rem;">Report Paid UPI Transaction (UTR Claim)</h3>
        <p style="color: var(--text-muted); font-size: 0.88rem; margin-bottom: 1.25rem;">
          If you completed payment via UPI QR, submit the 12-digit Bank Transaction ID (UTR) from your payment receipt for reconciliation.
        </p>
        <form id="offer-upi-claim-form" onsubmit="handleOfferUpiSubmit(event)">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            <div>
              <label style="display: block; font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.25rem;">Business / Contact Name *</label>
              <input type="text" id="offer-payer-name" required placeholder="Dr. Rajesh Sharma" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
            </div>
            <div>
              <label style="display: block; font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.25rem;">Mobile / WhatsApp *</label>
              <input type="tel" id="offer-payer-phone" required placeholder="9876543210" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
            </div>
            <div>
              <label style="display: block; font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.25rem;">Service Tier Paid *</label>
              <select id="offer-service-tier" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;" onchange="updateOfferAmount(this.value)">
                <option value="15000">Day 0-5 Setup (₹15,000)</option>
                <option value="8000">Monthly Retainer (₹8,000)</option>
              </select>
            </div>
            <div>
              <label style="display: block; font-size: 0.82rem; color: #94a3b8; margin-bottom: 0.25rem;">12-Digit Bank UTR / Reference *</label>
              <input type="text" id="offer-payer-utr" required placeholder="e.g. 428901234567" minlength="6" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
            </div>
          </div>
          <button type="submit" id="offer-claim-btn" class="btn" style="max-width: 320px;">
            Submit UPI Payment Claim
          </button>
          <div id="offer-claim-msg" style="display: none; margin-top: 1rem; padding: 0.85rem; border-radius: 8px; font-size: 0.9rem;"></div>
        </form>
      </div>
    </div>

    <!-- Commercial Terms & Scope from owner/OWN_OFFER.md -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
      <div style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem;">
        <h3 style="color: #38bdf8; font-size: 1.1rem; margin-bottom: 0.75rem;">Who It Is For</h3>
        <p style="color: #cbd5e1; font-size: 0.9rem; line-height: 1.5;">Local service businesses, healthcare practices, clinics, dental centers, coaching institutes, and professional service firms in India seeking automated 24/7 inquiry triage without extra ad spend.</p>
      </div>

      <div style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem;">
        <h3 style="color: #f87171; font-size: 1.1rem; margin-bottom: 0.75rem;">Who Should NOT Buy</h3>
        <p style="color: #cbd5e1; font-size: 0.9rem; line-height: 1.5;">E-commerce stores without inquiry response delays, or businesses without an active WhatsApp Business number or without a claimed Google Business Profile.</p>
      </div>

      <div style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 1.5rem;">
        <h3 style="color: #34d399; font-size: 1.1rem; margin-bottom: 0.75rem;">Refund Terms &amp; Guarantee</h3>
        <p style="color: #cbd5e1; font-size: 0.9rem; line-height: 1.5;"><strong>14-Day Performance Guarantee:</strong> 100% full refund of ₹15,000 setup fee if the automated triage fails to capture inquiries within 14 days due to unresolved platform defect. Monthly Retainer: Cancel anytime before the next billing cycle.</p>
      </div>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
      ${contactEmail ? `<p style="margin-top: 0.35rem;">Contact: <a href="mailto:${contactEmail}" style="color: var(--accent);">${contactEmail}</a></p>` : ''}
    </footer>
  </div>

  <script>
    async function createDynamicLink(offerId, title, amount) {
      var box = document.getElementById('dynamic-link-box');
      var desc = document.getElementById('dynamic-link-desc');
      var anchor = document.getElementById('dynamic-link-anchor');
      desc.innerText = 'Creating verified link for ' + title + ' (₹' + amount.toLocaleString('en-IN') + ')...';
      box.style.display = 'block';

      try {
        var res = await fetch('/api/v1/payments/public/create-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offerId: offerId,
            customerName: 'Commercial Client - ' + title
          })
        });
        var data = await res.json();
        if (data.success && data.data && data.data.paymentLinkUrl) {
          desc.innerHTML = '✓ Link Ready: <strong>' + data.data.providerLinkId + '</strong> (₹' + data.data.amountINR.toLocaleString('en-IN') + ')';
          anchor.href = data.data.paymentLinkUrl;
        } else {
          throw new Error(data.error || 'Failed to create payment link');
        }
      } catch (err) {
        desc.innerText = 'Error: ' + err.message;
      }
    }

    async function handleOfferUpiSubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('offer-claim-btn');
      var msg = document.getElementById('offer-claim-msg');
      btn.disabled = true;
      btn.innerText = 'Submitting Claim...';

      var amount = Number(document.getElementById('offer-service-tier').value);
      var payload = {
        businessId: 'biz_platform_aro',
        invoiceRef: '${orderRef}',
        payerName: document.getElementById('offer-payer-name').value.trim(),
        payerPhone: document.getElementById('offer-payer-phone').value.trim(),
        amountINR: amount,
        utr: document.getElementById('offer-payer-utr').value.trim(),
        serviceRendered: amount === 15000 ? 'Day 0-5 Setup & Integration' : 'Monthly Retainer & SLA'
      };

      try {
        var res = await fetch('/api/v1/payments/manual-upi/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          msg.innerHTML = '<strong>✓ Payment Claim Registered!</strong><br>Status: <code>PAYMENT_CLAIMED</code><br>Claim Ref: ' + data.data.claimId + '<br>Awaiting owner bank statement verification. Zero revenue recognized until confirmed by owner.';
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
  }
}
