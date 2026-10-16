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

import { isProduction } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

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

  public static getInstance(): DirectCommercialOfferPage {
    if (!DirectCommercialOfferPage.instance) {
      DirectCommercialOfferPage.instance = new DirectCommercialOfferPage();
    }
    return DirectCommercialOfferPage.instance;
  }

  /**
   * P0 Safety Gate: Checks whether Lane B commercial terms have been explicitly attested by the owner.
   * Does NOT treat unconfirmed repo drafts or default environment fallbacks as owner approval.
   */
  public static isDirectOfferAttested(): boolean {
    if (process.env.DIRECT_OFFER_TERMS_ATTESTED === 'true' && process.env.OWN_OFFER_CONFIRMED === 'true') {
      return true;
    }
    try {
      const db = getDb();
      const row = db.prepare("SELECT id FROM direct_offer_attestation WHERE offer_id = 'PLATFORM_SETUP' AND status = 'ATTESTED' LIMIT 1").get() as any;
      if (row) return true;
    } catch {}
    return false;
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
  public renderOfferHtml(config: Partial<OfferPageConfig> = {}): string {
    const isAttested = DirectCommercialOfferPage.isDirectOfferAttested();
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
        <p class="tier-desc">Complete setup, qualification rules, and 24/7 lead conversion activation.</p>
        <div class="price-box">
          <span class="price-amount">₹${setupPriceINR.toLocaleString('en-IN')}</span>
          <span class="price-period">one-time investment</span>
        </div>
        <ul class="feature-list">
          <li>✓ Custom WhatsApp qualification &amp; FAQ bot</li>
          <li>✓ Google Business Profile instant lead capture</li>
          <li>✓ Multi-touch follow-up sequence</li>
          <li>✓ Direct appointment scheduling integration</li>
          <li>✓ Live system handover report</li>
        </ul>
        ${upiUri ? `<a href="${upiUri}" class="btn">Pay ₹${setupPriceINR.toLocaleString('en-IN')} via UPI</a>` : ''}
        ${razorpayUrl ? `<a href="${razorpayUrl}" class="btn btn-secondary" target="_blank" rel="noopener">Pay via Razorpay</a>` : ''}
      </div>

      <!-- Tier 2 -->
      <div class="tier-card">
        <h2 class="tier-name">Monthly Retainer &amp; SLA</h2>
        <p class="tier-desc">Continuous triage optimization, reminder workflows, and monthly conversion reporting.</p>
        <div class="price-box">
          <span class="price-amount">₹${monthlyPriceINR.toLocaleString('en-IN')}</span>
          <span class="price-period">/ month (cancel anytime)</span>
        </div>
        <ul class="feature-list">
          <li>✓ 24/7 automated lead response under 2 minutes</li>
          <li>✓ Ongoing prompt & qualification tuning</li>
          <li>✓ Weekly show-rate and conversion reporting</li>
          <li>✓ Continuous DPDP compliance monitoring</li>
        </ul>
        ${whatsappNum ? `<a href="https://wa.me/${whatsappNum}?text=${encodeURIComponent(`Hi, I would like to subscribe to the AI Lead Conversion Monthly Retainer for my business.`)}" class="btn btn-secondary" target="_blank" rel="noopener">Inquire via WhatsApp</a>` : ''}
      </div>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
      ${contactEmail ? `<p style="margin-top: 0.35rem;">Contact: <a href="mailto:${contactEmail}" style="color: var(--accent);">${contactEmail}</a></p>` : ''}
    </footer>
  </div>
</body>
</html>`;
  }
}
