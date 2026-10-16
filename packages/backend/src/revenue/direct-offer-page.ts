/**
 * DirectCommercialOfferPage — Static & dynamic public commercial offer page for Lane B.
 *
 * Implements Part E: Direct Lane (from owner/OWN_OFFER.md)
 * - Tiers: PLATFORM_SETUP (₹15,000, 5-day delivery) and PLATFORM_MONTHLY (₹8,000, 30-day continuous).
 * - Deliverables, SLAs, and refund conditions matching OWN_OFFER.md exactly.
 * - Payment options:
 *   a) UPI QR code + upi://pay deep link with unique order reference and amount.
 *      Includes statutory NPCI/RBI compliance note on personal vs merchant UPI VPAs.
 *   b) Razorpay.me fallback payment page link with manual matching notice.
 *   c) WhatsApp chat link to confirm requirements before booking.
 * - Enforces the 4-state payment truth:
 *   1. PAYMENT_PAGE_VIEW (visitor opened page — logged, zero revenue)
 *   2. PAYMENT_CLAIMED (visitor submits 12-digit UTR — stored as claim, zero revenue)
 *   3. MANUAL_VERIFIED (owner checks bank statement and certifies UTR — real revenue)
 *   4. EXPORT_VERIFIED (Razorpay bank settlement CSV reconciles — real revenue)
 */

import { isProduction } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export interface OfferPageConfig {
  siteName: string;
  siteUrl: string;
  contactEmail: string;
  contactPhone?: string;
  upiVpa?: string;
  razorpayMeUrl?: string;
}

export class DirectCommercialOfferPage {
  private static instance: DirectCommercialOfferPage;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readonly PLATFORM_SETUP_PRICE_INR = 15000;
  public static readonly PLATFORM_MONTHLY_PRICE_INR = 8000;
  public static readonly DEFAULT_RAZORPAY_ME_URL = 'https://razorpay.me/@venkatasaiharshavardhankotu';

  public static getInstance(): DirectCommercialOfferPage {
    if (!DirectCommercialOfferPage.instance) {
      DirectCommercialOfferPage.instance = new DirectCommercialOfferPage();
    }
    return DirectCommercialOfferPage.instance;
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
   * Generates a deterministic or dynamic order reference ID for payment tracking.
   */
  public generateOrderReference(prefix: string = 'ORD'): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${dateStr}-${rand}`;
  }

  /**
   * Renders the complete, high-converting, fully compliant HTML offer page.
   */
  public renderOfferHtml(config: Partial<OfferPageConfig> = {}): string {
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'AI Lead Conversion Engine').trim();
    const siteUrl = config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL || 'contact@aimarketing.org').trim();
    const razorpayUrl = config.razorpayMeUrl || DirectCommercialOfferPage.DEFAULT_RAZORPAY_ME_URL;
    const upiVpa = config.upiVpa || process.env.PLATFORM_UPI_VPA || 'harshavardhan.kotu@okhdfcbank';
    const orderRef = this.generateOrderReference('LCS');
    const whatsappNum = (process.env.PUBLIC_WHATSAPP_NUMBER || '919849000000').replace(/[^0-9]/g, '');

    // Standard NPCI UPI URI string
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(siteName)}&am=15000&tr=${encodeURIComponent(orderRef)}&cu=INR&tn=${encodeURIComponent(`Platform Setup Ref ${orderRef}`)}`;

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
    .featured-pill {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #090d16;
      font-weight: 700;
      font-size: 0.75rem;
      padding: 0.2rem 0.8rem;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .tier-name { font-size: 1.35rem; font-weight: 700; color: #fff; margin-bottom: 0.5rem; }
    .tier-desc { font-size: 0.92rem; color: var(--text-muted); margin-bottom: 1.5rem; min-height: 48px; }
    .price-box { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--card-border); }
    .price-amount { font-size: 2.5rem; font-weight: 800; color: #fff; }
    .price-period { color: var(--text-muted); font-size: 0.95rem; }
    .sla-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      margin-top: 0.5rem;
    }
    .feature-list { list-style: none; margin-bottom: 2rem; flex-grow: 1; }
    .feature-list li {
      font-size: 0.92rem;
      margin-bottom: 0.85rem;
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      color: #cbd5e1;
    }
    .feature-list li svg { flex-shrink: 0; margin-top: 0.2rem; color: var(--accent); }
    .guarantee-box {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.82rem;
      color: #fde68a;
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
      transition: all 0.15s ease;
    }
    .btn:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      margin-top: 0.75rem;
    }
    .btn-secondary:hover { background: #334155; color: #fff; }
    .payment-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2.25rem;
      margin-top: 3rem;
    }
    .payment-section h2 { font-size: 1.6rem; color: #fff; margin-bottom: 0.5rem; text-align: center; }
    .payment-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin-top: 2rem;
    }
    .payment-box {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .payment-title { font-size: 1.1rem; font-weight: 700; color: #fff; margin-bottom: 0.5rem; }
    .payment-desc { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem; }
    .qr-container {
      text-align: center;
      background: #fff;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      display: inline-block;
      align-self: center;
    }
    .qr-container img { width: 170px; height: 170px; display: block; }
    .order-tag {
      font-family: monospace;
      font-size: 0.85rem;
      background: #1e293b;
      color: #38bdf8;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      display: inline-block;
      margin-bottom: 1rem;
      text-align: center;
    }
    .compliance-notice {
      background: rgba(148, 163, 184, 0.08);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 8px;
      padding: 1rem;
      margin-top: 2rem;
      font-size: 0.82rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .claim-form {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 2rem;
    }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.35rem; color: #cbd5e1; }
    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.65rem 0.85rem;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 6px;
      color: #fff;
      font-size: 0.95rem;
    }
    .four-state-box {
      margin-top: 2.5rem;
      background: #0b1120;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .state-step {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid rgba(30, 41, 59, 0.6);
    }
    .state-step:last-child { border-bottom: none; }
    .state-badge {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.6rem;
      border-radius: 4px;
      font-family: monospace;
      min-width: 160px;
      text-align: center;
    }
    .badge-view { background: #334155; color: #94a3b8; }
    .badge-claim { background: #854d0e; color: #fde047; }
    .badge-verified { background: #065f46; color: #6ee7b7; }
    .badge-export { background: #1e3a8a; color: #93c5fd; }
    footer { text-align: center; margin-top: 4rem; color: var(--text-muted); font-size: 0.85rem; }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge">Commercial Setup & Retainer</span>
      <h1>AI Inbound Lead Conversion System</h1>
      <p class="subtitle">Convert evening, weekend, and after-hours customer inquiries into confirmed bookings with 2-minute automated qualification.</p>
    </header>

    <div class="pricing-grid">
      <!-- Tier 1: Setup -->
      <div class="tier-card featured">
        <span class="featured-pill">Foundation Setup</span>
        <h2 class="tier-name">Day 0-5 Setup &amp; Integration</h2>
        <p class="tier-desc">Complete end-to-end deployment, WhatsApp triage integration, and appointment booking automation.</p>
        
        <div class="price-box">
          <div class="price-amount">₹15,000</div>
          <div class="price-period">One-time investment &bull; Fixed server-side authoritative price</div>
          <div class="sla-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            5 Business Days Delivery SLA
          </div>
        </div>

        <div class="guarantee-box">
          <strong>14-Day Performance Guarantee:</strong> If the automated triage system fails to capture and log customer inquiries within 14 days of go-live due to a platform defect not rectified within 48 hours, you receive a 100% full refund of the ₹15,000 setup fee.
        </div>

        <ul class="feature-list">
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Custom WhatsApp Triage &amp; FAQ Bot:</strong> Instant response under 2 minutes, answers top 20 business FAQs, qualifies intent.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Google Business Profile (GBP) Integration:</strong> Instant routing of messages and missed inquiries directly to chat.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Multi-Touch Follow-Up Workflow:</strong> 3-step automated sequence for leads that stop replying before confirmation.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Direct Calendar Booking:</strong> Integrated scheduling link directly to practitioner or staff calendar.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Handover Report &amp; Verification Run:</strong> Comprehensive live test run and documentation for staff.</span>
          </li>
        </ul>

        <a href="#payment-section" class="btn">Proceed to Setup (₹15,000)</a>
        <a href="https://wa.me/${whatsappNum}?text=${encodeURIComponent('Hello, I am interested in the AI Inbound Lead Conversion System Setup (₹15,000). Could you confirm requirements?')}" target="_blank" class="btn btn-secondary">Chat on WhatsApp to Confirm</a>
      </div>

      <!-- Tier 2: Monthly Retainer -->
      <div class="tier-card">
        <h2 class="tier-name">Monthly Retainer &amp; SLA</h2>
        <p class="tier-desc">Continuous 24/7 triage uptime, monthly conversion reporting, and prompt tuning.</p>
        
        <div class="price-box">
          <div class="price-amount">₹8,000 <span style="font-size: 1.1rem; font-weight: 500; color: var(--text-muted);">/ month</span></div>
          <div class="price-period">Ongoing SLA &bull; Prerequisite: Completed Setup</div>
          <div class="sla-pill" style="background: rgba(139, 92, 246, 0.12); color: #a78bfa;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            Continuous 30-Day SLA &bull; Cancel Anytime
          </div>
        </div>

        <div class="guarantee-box" style="background: rgba(6, 182, 212, 0.08); border-color: rgba(6, 182, 212, 0.25); color: #a5f3fc;">
          <strong>No Lock-In Terms:</strong> Cancel anytime prior to your next monthly billing date. Unused days within a billing period are eligible for prorated credit on written request.
        </div>

        <ul class="feature-list">
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>24/7 Automated Lead Triage (&lt;2 min):</strong> Uninterrupted evening, weekend, and holiday inquiry qualification.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Bi-Weekly Prompt &amp; Rubric Tuning:</strong> Optimization based on actual conversation transcripts and FAQs.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Weekly Show-Rate Reporting:</strong> Quantitative analysis of inquiries, qualified leads, and appointments.</span>
          </li>
          <li>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span><strong>Continuous DPDP Act Compliance:</strong> Data retention lifecycle monitoring in accordance with Indian privacy laws.</span>
          </li>
        </ul>

        <a href="#payment-section" class="btn btn-secondary">Select Monthly Retainer (₹8,000)</a>
      </div>
    </div>

    <!-- Payment Options Section -->
    <div class="payment-section" id="payment-section">
      <h2>Payment Options &amp; Verification</h2>
      <p style="text-align: center; color: var(--text-muted); font-size: 0.95rem;">Choose your preferred payment method. All transactions are logged transparently with verifiable bank references.</p>

      <div class="payment-options">
        <!-- Option A: Direct UPI QR & Link -->
        <div class="payment-box">
          <div>
            <div class="payment-title">Option 1: Direct UPI Transfer</div>
            <p class="payment-desc">Scan QR code using Google Pay, PhonePe, Paytm, or BHIM. Zero payment gateway convenience fees.</p>
            <div style="text-align: center;">
              <div class="qr-container">
                <!-- Fallback QR generator URL for standard UPI string -->
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(upiUri)}" alt="UPI QR Code for ₹15,000" loading="lazy">
              </div>
            </div>
            <div style="text-align: center;">
              <div class="order-tag">Order Ref: ${orderRef}</div>
            </div>
          </div>
          <div>
            <a href="${upiUri}" class="btn">Pay ₹15,000 via UPI App</a>
            <p style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 0.5rem;">VPA: <code>${upiVpa}</code></p>
          </div>
        </div>

        <!-- Option B: Razorpay Hosted Page -->
        <div class="payment-box">
          <div>
            <div class="payment-title">Option 2: Razorpay Hosted Page</div>
            <p class="payment-desc">Pay via NetBanking, Debit/Credit Card, or Corporate UPI on our verified Razorpay checkout page.</p>
            <div style="background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; font-size: 0.85rem; color: #cbd5e1;">
              <p><strong>Note on Razorpay.me:</strong> This hosted link is a manual remittance fallback without order-specific webhooks. Please include your business name and order ref (<code>${orderRef}</code>) in the transfer notes.</p>
            </div>
          </div>
          <div>
            <a href="${razorpayUrl}" target="_blank" rel="noopener noreferrer" class="btn" style="background: #2563eb; color: #fff;">Open Razorpay Payment Page &rarr;</a>
          </div>
        </div>

        <!-- Option C: WhatsApp Requirement Discussion -->
        <div class="payment-box">
          <div>
            <div class="payment-title">Option 3: Chat on WhatsApp First</div>
            <p class="payment-desc">Have questions about your CRM or Google Business listing? Confirm technical eligibility directly before payment.</p>
            <div style="background: rgba(30, 41, 59, 0.5); border: 1px dashed #334155; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0; font-size: 0.85rem; color: #cbd5e1;">
              <p>We review your active Google listing and WhatsApp business setup to confirm compatibility before initiating payment.</p>
            </div>
          </div>
          <div>
            <a href="https://wa.me/${whatsappNum}?text=${encodeURIComponent(`Hi, I'm reviewing the AI Inbound Lead Conversion System (Order Ref: ${orderRef}). Let's discuss setup requirements.`)}" target="_blank" rel="noopener noreferrer" class="btn" style="background: #059669; color: #fff;">Chat on WhatsApp &rarr;</a>
          </div>
        </div>
      </div>

      <!-- Claim Submission Form -->
      <div class="claim-form">
        <h3 style="color: #fff; font-size: 1.15rem; margin-bottom: 0.5rem;">Already Transferred? Register Your 12-Digit Bank UTR Reference</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem;">Enter the 12-digit UTR from your bank or UPI app. Your submission enters the <code>PAYMENT_CLAIMED</code> queue and will be confirmed against bank records by the owner.</p>

        <form id="claimForm" onsubmit="handleClaimSubmit(event)">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            <div class="form-group">
              <label for="claimUtr">12-Digit Bank UTR / UPI Ref</label>
              <input type="text" id="claimUtr" placeholder="e.g. 428901234567" required maxlength="20">
            </div>
            <div class="form-group">
              <label for="claimAmount">Amount Transferred (₹)</label>
              <input type="number" id="claimAmount" value="15000" required>
            </div>
            <div class="form-group">
              <label for="claimBusiness">Business / Contact Name</label>
              <input type="text" id="claimBusiness" placeholder="Your business name" required>
            </div>
          </div>
          <button type="submit" class="btn" id="claimSubmitBtn">Register Payment Claim (UTR) &rarr;</button>
          <div id="claimFeedback" style="margin-top: 1rem; font-size: 0.9rem; display: none;"></div>
        </form>
      </div>

      <!-- 4-State Payment Truth Explanation -->
      <div class="four-state-box">
        <h4 style="font-size: 0.95rem; color: #f8fafc; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">Our Four-State Payment Truth Protocol</h4>
        <div class="state-step">
          <span class="state-badge badge-view">1. PAYMENT_PAGE_VIEW</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">You opened this page. Logged as navigation traffic; never counted as money.</span>
        </div>
        <div class="state-step">
          <span class="state-badge badge-claim">2. PAYMENT_CLAIMED</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">You submitted your 12-digit UTR reference. Marked as claimed; zero revenue recognized.</span>
        </div>
        <div class="state-step">
          <span class="state-badge badge-verified">3. MANUAL_VERIFIED</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Owner certifies bank statement credit matching UTR. Ledgered as verified REAL revenue.</span>
        </div>
        <div class="state-step">
          <span class="state-badge badge-export">4. EXPORT_VERIFIED</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Reconciled via Razorpay bank settlement export CSV. Permanent immutable ledger entry.</span>
        </div>
      </div>

      <!-- Statutory Regulatory Note -->
      <div class="compliance-notice">
        <strong>Statutory Regulatory Notice (NPCI / RBI UPI Guidelines):</strong> Under National Payments Corporation of India (NPCI) directives and RBI Merchant Acquiring frameworks, personal peer-to-peer (P2P) UPI VPAs are restricted to individual non-commercial remittances. Enterprise and commercial service collections require authorized payment aggregator processing (P2M) or designated current account settlement. For provisional direct onboarding, transfers are audited individually and only recognized upon explicit bank account statement credit.
      </div>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
      <p style="margin-top: 0.5rem;"><a href="/tools/lead-leakage-calculator">Lead Leakage Calculator</a> &bull; <a href="/privacy">Privacy Policy</a> &bull; <a href="/terms">Terms of Service</a> &bull; <a href="mailto:${contactEmail}">${contactEmail}</a></p>
    </footer>
  </div>

  <script>
    // Record page view event immediately on mount
    (function recordView() {
      try {
        fetch('/api/v1/payments/page-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: 'offer', referer: document.referrer })
        }).catch(function() {});
      } catch(e) {}
    })();

    async function handleClaimSubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('claimSubmitBtn');
      var feedback = document.getElementById('claimFeedback');
      var utr = document.getElementById('claimUtr').value.trim();
      var amount = parseInt(document.getElementById('claimAmount').value, 10);
      var business = document.getElementById('claimBusiness').value.trim();

      if (!utr || utr.length < 6) {
        feedback.style.display = 'block';
        feedback.style.color = '#f43f5e';
        feedback.innerText = 'Please enter a valid 12-digit bank UTR reference number.';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Submitting Claim...';

      try {
        var res = await fetch('/api/v1/payments/manual-upi/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: 'biz_platform_aro',
            utr: utr,
            amountINR: amount,
            serviceRendered: 'AI Inbound Lead Conversion System Setup (₹' + amount + ')',
            notes: 'Submitted via direct offer page for ' + business
          })
        });

        var data = await res.json();
        feedback.style.display = 'block';

        if (res.ok && data.success) {
          feedback.style.color = '#34d399';
          feedback.innerHTML = '<strong>Payment Claim Registered!</strong> Status: <code>PAYMENT_CLAIMED</code>. Awaiting owner bank verification. You will receive confirmation once verified against bank records.';
          document.getElementById('claimForm').reset();
        } else {
          feedback.style.color = '#f43f5e';
          feedback.innerText = data.error || 'Submission failed. Please check inputs and retry.';
        }
      } catch (err) {
        feedback.style.display = 'block';
        feedback.style.color = '#f43f5e';
        feedback.innerText = 'Network error submitting claim. Please check your connection.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Register Payment Claim (UTR) →';
      }
    }
  </script>
</body>
</html>`;
  }
}
