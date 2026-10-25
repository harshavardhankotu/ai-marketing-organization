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
        path.resolve(process.cwd(), '..', '..', 'owner', 'OWN_OFFER.md'),
        path.resolve(process.cwd(), 'owner', 'OWN_OFFER.legacy_agent_written.md'),
        path.resolve(process.cwd(), '..', 'owner', 'OWN_OFFER.legacy_agent_written.md'),
        path.resolve(process.cwd(), '..', '..', 'owner', 'OWN_OFFER.legacy_agent_written.md')
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
    // Step 2e: DIRECT_OFFER_TERMS_SHA256 counts as valid ONLY when OWN_OFFER_CONFIRMED=true is set by the owner script.
    // A hash match proves the page equals the file; it does not prove that the owner approved it without explicit confirmation.
    const isConfirmed = (process.env.OWN_OFFER_CONFIRMED || '').trim().toLowerCase() === 'true';
    if (!isConfirmed) {
      return false;
    }
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
   * Public server-rendered homepage (GET /) positioning the B2B AI Inbound Lead Triage solution
   * for Indian healthcare and local practices, with cleanly segregated consumer affiliate links.
   */
  public renderHomepageHtml(config: Partial<OfferPageConfig> = {}): string {
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
    const siteUrl = config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : null);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Inbound Lead Triage &amp; Missed-Inquiry Follow-Up | ${siteName}</title>
  <meta name="description" content="Turn after-hours patient inquiries into booked appointments. 24/7 WhatsApp away triage, top 10 quick replies, and calendar integration for Indian healthcare and dental practices.">
  <link rel="canonical" href="${siteUrl}/">
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
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
    }
    nav.top-nav {
      background: #0b1120;
      border-bottom: 1px solid var(--card-border);
      padding: 1rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .brand { font-weight: 800; font-size: 1.15rem; color: #fff; text-decoration: none; }
    .nav-links { display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; font-weight: 500; }
    .nav-links a:hover, .nav-links a.active { color: var(--accent); }
    .container { max-width: 980px; margin: 0 auto; padding: 2.5rem 1.25rem; }
    .hero { text-align: center; margin-bottom: 3.5rem; }
    .status-badge {
      display: inline-block;
      background: rgba(6, 182, 212, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 0.35rem 0.9rem;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.15rem;
      color: var(--text-muted);
      max-width: 760px;
      margin: 0 auto 1.75rem auto;
    }
    .cta-group { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: var(--accent); color: #090d16; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: #1e293b; color: #fff; border: 1px solid var(--card-border); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 2rem;
      margin-bottom: 2rem;
    }
    .card h2 { font-size: 1.4rem; color: #fff; margin-bottom: 1rem; }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
    }
    .feature-item {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .feature-item h3 { font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem; }
    .feature-item p { font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; }
    .sample-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    footer {
      background: #0b1120;
      border-top: 1px solid var(--card-border);
      padding: 2.5rem 1.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <nav class="top-nav">
    <a href="/" class="brand">${siteName}</a>
    <div class="nav-links">
      <a href="/" class="active">B2B Lead Triage</a>
      <a href="/offer">Commercial Overview</a>
      <a href="#interactive-demo">Interactive Demo</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/deals">Consumer Deals</a>
      <a href="/guides/student-flight-discounts-india">Travel Guides</a>
    </div>
  </nav>

  <div class="container">
    <header class="hero">
      <div class="status-badge">AI Inbound Lead Conversion System • India First</div>
      <h1>Never Lose Another Evening Patient Inquiry</h1>
      <p class="subtitle">
        24/7 automated WhatsApp away triage, instant clinical qualification, and calendar booking integration for Indian healthcare practices, dental clinics, and professional services.
      </p>
      <div class="cta-group">
        <a href="#interactive-demo" class="btn btn-primary">Try Interactive Demo</a>
        <a href="#inquiry-card" class="btn btn-secondary">Request Clinic Walkthrough</a>
      </div>
    </header>

    <!-- The Problem Section -->
    <div class="card">
      <h2>The Problem: The 8 PM to 8 AM Inquiry Gap</h2>
      <p style="color: #cbd5e1; font-size: 1.05rem; margin-bottom: 1.5rem;">
        Indian dental clinics and specialty practices lose high-value patients every evening because prospective clients research treatments outside reception working hours.
      </p>
      <div class="grid-3">
        <div class="feature-item">
          <div style="color: #f87171; font-size: 1.3rem; margin-bottom: 0.35rem;">⏰ 8 PM – 8 AM Dark Hours</div>
          <h3>Evening Inquiries Go Unanswered</h3>
          <p>Patients reach out via Google Business Profile and WhatsApp after work. With clinic desks closed, messages wait until 10 AM next morning.</p>
        </div>
        <div class="feature-item">
          <div style="color: #fbbf24; font-size: 1.3rem; margin-bottom: 0.35rem;">⚡ 15-Minute Window</div>
          <h3>Immediate Competitor Leakage</h3>
          <p>68% of patients in competitive metro areas message another clinic if they do not receive an immediate confirmation within 15 minutes.</p>
        </div>
        <div class="feature-item">
          <div style="color: #38bdf8; font-size: 1.3rem; margin-bottom: 0.35rem;">📉 Lost Lifetime Value</div>
          <h3>High Revenue Opportunity Loss</h3>
          <p>A single lost dental implant or orthodontics inquiry costs ₹25,000 to ₹60,000 in clinic procedural revenue.</p>
        </div>
      </div>
    </div>

    <!-- Defined Deliverables Section -->
    <div class="card">
      <h2>What We Deploy: The 4-Part Triage Architecture</h2>
      <p style="color: #cbd5e1; font-size: 1rem; margin-bottom: 1.5rem;">
        A complete, turnkey technical deployment integrated into your practice's existing WhatsApp Business and Google Workspace in 5 days.
      </p>
      <div class="grid-2">
        <div class="feature-item">
          <h3 style="color: #38bdf8;">1. 24/7 WhatsApp Instant Away Triage</h3>
          <p>Automated sub-60-second response to after-hours WhatsApp inquiries and missed calls with empathetic clinic greetings and emergency triage protocols.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #34d399;">2. Top 10 Practice Quick Replies</h3>
          <p>Trained responses for your clinic's top queries: implant pricing ranges, root canals, braces/aligners, consultation fees, clinic timings, and maps location.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #fbbf24;">3. Direct Calendar Appointment Booking</h3>
          <p>Integrated booking link allowing patients to pick an available doctor consultation slot immediately, eliminating receptionist back-and-forth.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #a78bfa;">4. Shared Real-Time Inquiry Tracking Sheet</h3>
          <p>Zero extra software license fees. Qualified inquiries automatically populate a shared Google Sheet with patient name, phone, procedure interest, and priority tag.</p>
        </div>
      </div>
    </div>

    <!-- Interactive Demonstration with Sample Data Explicitly Labelled -->
    <div class="card" id="interactive-demo">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
        <h2 style="margin: 0;">Interactive Demonstration: Inbound Patient Triage</h2>
        <span class="sample-badge">SAMPLE DATA ONLY — INBOUND PATIENT TRIAGE PREVIEW</span>
      </div>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Experience how an after-hours patient inquiry is triaged in under 30 seconds. Click a sample scenario below to view the simulated conversation:
      </p>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem;">
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('pain')" id="btn-demo-h-pain" style="background: #0284c7; color: #fff; border-color: #38bdf8; font-size: 0.85rem;">1. Tooth Pain Emergency (Sunday 9:15 PM)</button>
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('implants')" id="btn-demo-h-implants" style="font-size: 0.85rem;">2. Dental Implant Inquiry (Saturday 8:30 PM)</button>
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('aligners')" id="btn-demo-h-aligners" style="font-size: 0.85rem;">3. Clear Aligners Consultation (Weekday 10:00 PM)</button>
      </div>

      <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 12px; padding: 1.25rem; max-width: 620px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
        <div style="border-bottom: 1px solid var(--card-border); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">A</div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">Apex Dental Triage Assistant</div>
              <div style="color: #34d399; font-size: 0.75rem;">● Active • Responds in &lt;60s</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: #64748b; background: #111827; padding: 0.2rem 0.5rem; border-radius: 4px;">DEMO PREVIEW</span>
        </div>
        <div id="demo-chat-box-home" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
      </div>
      <p style="text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
        * Notice: The conversation above demonstrates sample triage flows with simulated data. Actual client deployments are customized to the practice's verified schedule, treatment fees, and phone numbers.
      </p>
    </div>

    <!-- Commercial Terms & Pricing Transparency -->
    <div class="card">
      <h2>Transparent Commercial Terms</h2>
      <div class="grid-2">
        <div>
          <h3 style="color: #38bdf8; font-size: 1.2rem; margin-bottom: 0.5rem;">Introductory Pilot Implementation</h3>
          <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 0.75rem;">
            <strong>Setup Investment:</strong> Custom proposal reviewed and approved directly by the human owner (starting from ₹15,000 one-time setup).
          </p>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Includes full workflow configuration, prompt tuning, Google Calendar synchronization, receptionist training, and 14-day handover monitoring.
          </p>
        </div>
        <div>
          <h3 style="color: #34d399; font-size: 1.2rem; margin-bottom: 0.5rem;">Zero Mandatory Third-Party SaaS Fees</h3>
          <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 0.75rem;">
            <strong>100% Free Client-Owned Tools:</strong> Built on your existing free WhatsApp Business application and Google Workspace accounts.
          </p>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            No recurring hidden software licenses. You own all patient records, spreadsheet logs, and calendar schedules directly.
          </p>
        </div>
      </div>
    </div>

    <!-- Genuine Inbound Contact / Enquiry Form -->
    <div class="card" id="inquiry-card">
      <h2>Request System Demonstration For Your Practice</h2>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Submit your practice details for a confidential system demonstration. The owner will review your practice's after-hours setup and provide a tailored walkthrough.
      </p>
      <form id="lead-inquiry-form-home" onsubmit="handleInquirySubmitHome(event)">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Doctor / Contact Name *</label>
            <input type="text" id="cust-name-h" required placeholder="Dr. Rajesh Sharma" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">WhatsApp / Mobile Number *</label>
            <input type="tel" id="cust-phone-h" required placeholder="9876543210" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Clinic / Practice Name &amp; City *</label>
            <input type="text" id="cust-service-h" required placeholder="Apex Dental Clinic, Hyderabad" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Email (Optional)</label>
            <input type="email" id="cust-email-h" placeholder="contact@apexdental.com" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Primary Inquiry Challenge (e.g. evening patient calls, WhatsApp FAQ automation)</label>
          <textarea id="cust-notes-h" rows="2" placeholder="Patients reaching out after 8 PM wait until next morning. Want instant 24/7 WhatsApp qualification." style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem; font-family: inherit;"></textarea>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
            <input type="checkbox" id="cust-consent-h" required style="margin-top: 0.2rem; cursor: pointer;">
            <span>I agree that the name and contact number I submit will be used by the owner to respond to this inquiry. Data is kept for 30 days and deleted on request under DPDP Act 2023. See <a href="/privacy" target="_blank" style="color: var(--accent); text-decoration: underline;">/privacy</a>.</span>
          </label>
        </div>
        <div style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" aria-hidden="true">
          <input type="text" name="website_trap" id="cust-trap-h" tabindex="-1" autocomplete="off" value="">
        </div>
        <button type="submit" id="submit-btn-h" class="btn btn-primary" style="width: 100%; padding: 0.85rem 1.5rem;">
          Request Lead Triage Demonstration
        </button>
        <div id="form-msg-h" style="display: none; margin-top: 1rem; padding: 0.75rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
      </form>
    </div>

    <!-- Segregated Consumer Affiliate Research & Guides -->
    <div class="card" style="border-color: #334155; background: #0b1120;">
      <h2 style="font-size: 1.2rem; color: #94a3b8; margin-bottom: 0.75rem;">Consumer Research &amp; Flight Guides Directory</h2>
      <p style="color: #64748b; font-size: 0.88rem; margin-bottom: 1rem;">
        In addition to our B2B lead triage consultancy, we publish independently verified consumer price intelligence and student travel guides:
      </p>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        <a href="/deals" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          🏷️ Verified Indian Deals Directory &rarr;
        </a>
        <a href="/guides/student-flight-discounts-india" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          ✈️ Student Flight Baggage &amp; Fare Guide &rarr;
        </a>
        <a href="/revenue" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          📊 Transparent Public Revenue Funnel &rarr;
        </a>
      </div>
    </div>
  </div>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${siteName}. All rights reserved.</p>
    <p style="margin-top: 0.5rem; max-width: 780px; margin-left: auto; margin-right: auto; line-height: 1.5; color: #64748b; font-size: 0.8rem;">
      <strong>Statutory Affiliate Disclosure:</strong> Consumer buying guides and promotional deal directories on this platform contain verified affiliate links to partner platforms (Akasa Air, Air India Express, Cleartrip, boAt, Lenovo, Amazon). When visitors make qualifying bookings or purchases through those links, we may receive an affiliate commission at zero additional cost to the purchaser. Our B2B direct lead triage service is a separate professional consulting offering.
    </p>
    <p style="margin-top: 0.75rem;">
      <a href="/privacy">Privacy Policy</a> • <a href="/revenue">Revenue Funnel</a> • <a href="/offer">Service Overview</a> • <a href="/deals">Deals</a> • ${contactEmail ? `Contact: <a href="mailto:${contactEmail}">${contactEmail}</a>` : 'Contact: Inquiries via Form'}
    </p>
  </footer>

  <script>
    var demoScenariosHome = {
      pain: {
        time: 'Sunday, 9:15 PM',
        patient: 'Hi doctor, I am having sharp tooth pain on my lower right molar since this evening. It throbs when lying down. Do you have emergency appointments available?',
        bot: 'Hello, thank you for reaching Apex Dental Care. We are sorry to hear you are in severe pain.\\n\\nWhile our physical clinic is currently closed (hours 9 AM – 8 PM), Dr. Suresh has reserved emergency slots for tomorrow morning starting at 9:30 AM.\\n\\nIn the meantime, rinse gently with warm salt water and avoid chewing on that side. Would you like me to hold the 9:30 AM or 10:15 AM priority slot for you?',
        slot: 'Tomorrow 9:30 AM - Priority Slot'
      },
      implants: {
        time: 'Saturday, 8:30 PM',
        patient: 'Hello, I wanted to know about dental implants. I am missing two teeth in the back. What is the approximate cost and how many visits does it take?',
        bot: 'Hello, thank you for contacting Apex Dental Care! Dental implants are our core specialty, and Dr. Suresh provides complete 3D digital implant planning.\\n\\nFor two missing back teeth, we provide premium Korean and Swiss implants starting from ₹22,000 per implant (including abutment and ceramic crown). The preliminary 3D CBCT scan consultation takes about 30 minutes.\\n\\nWould you like to schedule an implant assessment this Monday or Tuesday?',
        slot: 'Monday 11:00 AM - Implant Assessment'
      },
      aligners: {
        time: 'Weekday, 10:00 PM',
        patient: 'Hi, do you offer invisible aligners? How long does mild crowding take to fix and do you have weekend consultation slots?',
        bot: 'Hello, thanks for reaching out to Apex Dental Care! Yes, we are an authorized Invisalign and ClearCorrect provider.\\n\\nMild front teeth crowding is typically completed in 4 to 6 months with clear aligners. We do have Saturday and Sunday afternoon slots dedicated to digital smile scans.\\n\\nWe can schedule a 3D intraoral scan consultation this Saturday at 11:30 AM or 3:00 PM. Which time suits your schedule best?',
        slot: 'Saturday 11:30 AM - Aligners Scan'
      }
    };

    function switchDemoHome(key) {
      var s = demoScenariosHome[key] || demoScenariosHome.pain;
      var tabs = ['pain', 'implants', 'aligners'];
      tabs.forEach(function(t) {
        var el = document.getElementById('btn-demo-h-' + t);
        if (!el) return;
        if (t === key) {
          el.style.background = '#0284c7';
          el.style.color = '#fff';
          el.style.borderColor = '#38bdf8';
        } else {
          el.style.background = '#1e293b';
          el.style.color = '#94a3b8';
          el.style.borderColor = '#334155';
        }
      });

      var box = document.getElementById('demo-chat-box-home');
      if (!box) return;
      box.innerHTML = 
        '<div style="align-self: flex-end; max-width: 85%; background: #065f46; color: #e6fffa; padding: 0.65rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.88rem; line-height: 1.4;">' +
          '<div>' + s.patient + '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #a7f3d0; margin-top: 0.35rem;">' + s.time + ' ✓✓</div>' +
        '</div>' +
        '<div style="align-self: flex-start; max-width: 85%; background: #1e293b; color: #f8fafc; padding: 0.65rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.88rem; line-height: 1.4; border: 1px solid #334155;">' +
          '<div>' + s.bot.replace(/\\n/g, '<br>') + '</div>' +
          '<div style="margin-top: 0.6rem; border-top: 1px solid #334155; padding-top: 0.5rem;">' +
            '<a href="#inquiry-card" style="display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 0.35rem 0.7rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Reserve Slot: ' + s.slot + '</a>' +
          '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #94a3b8; margin-top: 0.35rem;">Triage Response in 28s ✓✓</div>' +
        '</div>';
    }
    switchDemoHome('pain');

    async function handleInquirySubmitHome(e) {
      e.preventDefault();
      var btn = document.getElementById('submit-btn-h');
      var msg = document.getElementById('form-msg-h');
      var consent = document.getElementById('cust-consent-h');
      if (!consent || !consent.checked) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: Explicit consent is required to submit an inquiry under DPDP Act.';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Submitting Request...';
      msg.style.display = 'block';
      msg.style.background = 'rgba(56, 189, 248, 0.15)';
      msg.style.color = '#38bdf8';
      msg.style.border = '1px solid rgba(56, 189, 248, 0.3)';
      msg.innerText = 'Connecting to server...';

      var payload = {
        customerName: document.getElementById('cust-name-h').value.trim(),
        customerPhone: document.getElementById('cust-phone-h').value.trim(),
        customerEmail: (document.getElementById('cust-email-h') || {}).value ? document.getElementById('cust-email-h').value.trim() : undefined,
        serviceOfInterest: document.getElementById('cust-service-h').value.trim(),
        notes: document.getElementById('cust-notes-h').value.trim(),
        website_trap: (document.getElementById('cust-trap-h') || {}).value || '',
        consentGiven: true,
        source: 'homepage_b2b_inquiry',
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
          var delCodeNotice = data.deletionCode ? '<br><small style="color:#94a3b8;font-size:0.85rem;display:block;margin-top:0.5rem;">Your DPDP deletion code: <strong style="color:#38bdf8;">' + data.deletionCode + '</strong> (keep this to request data deletion)</small>' : '';
          msg.innerHTML = '✓ ' + (data.message || 'Thank you. The owner will review your practice and reach out shortly.') + delCodeNotice;
          document.getElementById('lead-inquiry-form-home').reset();
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
  </script>
</body>
</html>`;
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
      <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem; margin-bottom: 0.75rem;">Direct online checkout is disabled until commercial terms are attested by the owner.</p>
      <h1>AI Inbound Lead Conversion System</h1>
      <p class="subtitle">24/7 automated inquiry qualification, WhatsApp response bot, and CRM integration architecture for local service businesses in India.</p>
    </header>

    <div class="card">
      <h2>The Problem: The 8 PM to 8 AM Inquiry Gap</h2>
      <p style="color: #cbd5e1; font-size: 1.05rem; line-height: 1.6; margin-bottom: 0.75rem;">
        Local service businesses and Indian dental practices lose prospective clients every day when inquiries arrive outside working hours (8 PM to 8 AM) or when Google Business Profile chat features are shut down. When high-intent prospective customers reach out via online profiles or WhatsApp in the evening, responses often wait until the next morning — by which time they have already contacted a competitor.
      </p>
      <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
        Our automated inquiry triage architecture qualifies new inquiries within minutes and coordinates calendar appointments without manual messaging delay.
      </p>
    </div>

    <div class="card">
      <h2>Scope of Technical Deliverables</h2>
      <div class="grid-2">
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #38bdf8; font-size: 1.05rem; margin-bottom: 0.4rem;">1. 24/7 WhatsApp Away Triage</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Sub-60-second response to after-hours patient queries and missed calls with empathetic greetings and triage classification.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #34d399; font-size: 1.05rem; margin-bottom: 0.4rem;">2. Top 10 Practice Quick Replies</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Automated instant answers for implant price guidance, root canals, braces/aligners, clinic timings, and location.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #fbbf24; font-size: 1.05rem; margin-bottom: 0.4rem;">3. Direct Calendar Appointment Booking</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Integrated booking link allowing patients to reserve consultation slots directly without receptionist ping-pong.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #a78bfa; font-size: 1.05rem; margin-bottom: 0.4rem;">4. Shared Inquiry Tracking Sheet</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Real-time Google Sheet synchronization. Zero monthly SaaS cost (100% free client-owned tools).</p>
        </div>
      </div>
    </div>

    <!-- Interactive Demonstration with Sample Data Explicitly Labelled -->
    <div class="card" id="interactive-demo-overview">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
        <h2 style="margin: 0;">Interactive Demonstration: Inbound Patient Triage</h2>
        <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;">SAMPLE DATA ONLY — INBOUND PATIENT TRIAGE PREVIEW</span>
      </div>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Simulate how an after-hours patient inquiry is triaged in under 30 seconds:
      </p>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem;">
        <button type="button" onclick="switchDemoOverview('pain')" id="btn-demo-o-pain" style="background: #0284c7; color: #fff; border: 1px solid #38bdf8; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">1. Tooth Pain Emergency (Sunday 9:15 PM)</button>
        <button type="button" onclick="switchDemoOverview('implants')" id="btn-demo-o-implants" style="background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">2. Dental Implant Inquiry (Saturday 8:30 PM)</button>
        <button type="button" onclick="switchDemoOverview('aligners')" id="btn-demo-o-aligners" style="background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">3. Clear Aligners Consultation (Weekday 10:00 PM)</button>
      </div>

      <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 12px; padding: 1.25rem; max-width: 620px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
        <div style="border-bottom: 1px solid var(--card-border); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">A</div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">Apex Dental Triage Assistant</div>
              <div style="color: #34d399; font-size: 0.75rem;">● Active • Responds in &lt;60s</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: #64748b; background: #111827; padding: 0.2rem 0.5rem; border-radius: 4px;">DEMO PREVIEW</span>
        </div>
        <div id="demo-chat-box-overview" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
      </div>
      <p style="text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
        * Notice: The conversation above demonstrates sample triage flows with simulated data. Actual client deployments are customized to the practice's verified schedule, treatment fees, and phone numbers.
      </p>
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
        <div style="margin-bottom: 1.25rem;">
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
            <input type="checkbox" id="cust-consent" required style="margin-top: 0.2rem; cursor: pointer;">
            <span>I agree that the name and contact number I submit will be used by the owner to respond to this inquiry. Data is kept for 30 days and deleted on request. See <a href="/privacy" target="_blank" style="color: var(--accent); text-decoration: underline;">/privacy</a>.</span>
          </label>
        </div>
        <div style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" aria-hidden="true">
          <input type="text" name="website_trap" id="cust-trap" tabindex="-1" autocomplete="off" value="">
        </div>
        <button type="submit" id="submit-btn" style="background: #0284c7; color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; width: 100%;">
          Request Lead Triage Demonstration
        </button>
        <div id="form-msg" style="display: none; margin-top: 1rem; padding: 0.75rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
      </form>
    </div>

    <!-- Segregated Consumer Affiliate Links -->
    <div class="card" style="border-color: #334155; background: #0b1120;">
      <h3 style="font-size: 1.1rem; color: #94a3b8; margin-bottom: 0.5rem;">Consumer Deals &amp; Travel Guides Directory</h3>
      <p style="color: #64748b; font-size: 0.85rem; margin-bottom: 0.75rem;">
        Explore our independent consumer price intelligence and student travel guides:
      </p>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        <a href="/deals" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">🏷️ Verified Consumer Deals &rarr;</a>
        <a href="/guides/student-flight-discounts-india" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">✈️ Student Flight Baggage Guide &rarr;</a>
        <a href="/revenue" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">📊 Public Revenue Funnel &rarr;</a>
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
      <p style="margin-top: 0.35rem;">Technical overview page • Not an offer to contract until terms are owner-attested. • <a href="/privacy" style="color: var(--text-muted); text-decoration: underline;">Privacy Policy</a> • <a href="/deals" style="color: var(--text-muted); text-decoration: underline;">Deals</a> • <a href="/revenue" style="color: var(--text-muted); text-decoration: underline;">Revenue Funnel</a></p>
    </footer>
  </div>

  <script>
    var demoScenariosOverview = {
      pain: {
        time: 'Sunday, 9:15 PM',
        patient: 'Hi doctor, I am having sharp tooth pain on my lower right molar since this evening. It throbs when lying down. Do you have emergency appointments available?',
        bot: 'Hello, thank you for reaching Apex Dental Care. We are sorry to hear you are in severe pain.\\n\\nWhile our physical clinic is currently closed (hours 9 AM – 8 PM), Dr. Suresh has reserved emergency slots for tomorrow morning starting at 9:30 AM.\\n\\nIn the meantime, rinse gently with warm salt water and avoid chewing on that side. Would you like me to hold the 9:30 AM or 10:15 AM priority slot for you?',
        slot: 'Tomorrow 9:30 AM - Priority Slot'
      },
      implants: {
        time: 'Saturday, 8:30 PM',
        patient: 'Hello, I wanted to know about dental implants. I am missing two teeth in the back. What is the approximate cost and how many visits does it take?',
        bot: 'Hello, thank you for contacting Apex Dental Care! Dental implants are our core specialty, and Dr. Suresh provides complete 3D digital implant planning.\\n\\nFor two missing back teeth, we provide premium Korean and Swiss implants starting from ₹22,000 per implant (including abutment and ceramic crown). The preliminary 3D CBCT scan consultation takes about 30 minutes.\\n\\nWould you like to schedule an implant assessment this Monday or Tuesday?',
        slot: 'Monday 11:00 AM - Implant Assessment'
      },
      aligners: {
        time: 'Weekday, 10:00 PM',
        patient: 'Hi, do you offer invisible aligners? How long does mild crowding take to fix and do you have weekend consultation slots?',
        bot: 'Hello, thanks for reaching out to Apex Dental Care! Yes, we are an authorized Invisalign and ClearCorrect provider.\\n\\nMild front teeth crowding is typically completed in 4 to 6 months with clear aligners. We do have Saturday and Sunday afternoon slots dedicated to digital smile scans.\\n\\nWe can schedule a 3D intraoral scan consultation this Saturday at 11:30 AM or 3:00 PM. Which time suits your schedule best?',
        slot: 'Saturday 11:30 AM - Aligners Scan'
      }
    };

    function switchDemoOverview(key) {
      var s = demoScenariosOverview[key] || demoScenariosOverview.pain;
      var tabs = ['pain', 'implants', 'aligners'];
      tabs.forEach(function(t) {
        var el = document.getElementById('btn-demo-o-' + t);
        if (!el) return;
        if (t === key) {
          el.style.background = '#0284c7';
          el.style.color = '#fff';
          el.style.borderColor = '#38bdf8';
        } else {
          el.style.background = '#1e293b';
          el.style.color = '#94a3b8';
          el.style.borderColor = '#334155';
        }
      });

      var box = document.getElementById('demo-chat-box-overview');
      if (!box) return;
      box.innerHTML = 
        '<div style="align-self: flex-end; max-width: 85%; background: #065f46; color: #e6fffa; padding: 0.65rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.88rem; line-height: 1.4;">' +
          '<div>' + s.patient + '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #a7f3d0; margin-top: 0.35rem;">' + s.time + ' ✓✓</div>' +
        '</div>' +
        '<div style="align-self: flex-start; max-width: 85%; background: #1e293b; color: #f8fafc; padding: 0.65rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.88rem; line-height: 1.4; border: 1px solid #334155;">' +
          '<div>' + s.bot.replace(/\\n/g, '<br>') + '</div>' +
          '<div style="margin-top: 0.6rem; border-top: 1px solid #334155; padding-top: 0.5rem;">' +
            '<a href="#inquiry-card" style="display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 0.35rem 0.7rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Reserve Slot: ' + s.slot + '</a>' +
          '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #94a3b8; margin-top: 0.35rem;">Triage Response in 28s ✓✓</div>' +
        '</div>';
    }
    switchDemoOverview('pain');

    async function handleInquirySubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('submit-btn');
      var msg = document.getElementById('form-msg');
      var consent = document.getElementById('cust-consent');
      if (!consent || !consent.checked) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: Explicit consent is required to submit an inquiry.';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Sending...';
      msg.style.display = 'block';
      msg.style.background = 'rgba(56, 189, 248, 0.15)';
      msg.style.color = '#38bdf8';
      msg.style.border = '1px solid rgba(56, 189, 248, 0.3)';
      msg.innerText = 'Connecting to server...';

      var payload = {
        customerName: document.getElementById('cust-name').value.trim(),
        customerPhone: document.getElementById('cust-phone').value.trim(),
        customerEmail: document.getElementById('cust-email').value.trim() || undefined,
        serviceOfInterest: document.getElementById('cust-service').value.trim(),
        notes: document.getElementById('cust-notes').value.trim(),
        website_trap: (document.getElementById('cust-trap') || {}).value || '',
        consentGiven: true,
        source: 'offer_page_inquiry',
        channel: 'WHATSAPP'
      };

      async function doFetchWithTimeout(timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
        try {
          var response = await fetch('/api/v1/offer/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          clearTimeout(timer);
          return response;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      }

      try {
        var res;
        try {
          res = await doFetchWithTimeout(15000);
        } catch (fetchErr) {
          msg.innerText = 'Server is waking up (takes ~30s on free tier). Retrying...';
          res = await doFetchWithTimeout(35000);
        }

        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          var delCodeNotice = data.deletionCode ? '<br><small style="color:#94a3b8;font-size:0.85rem;display:block;margin-top:0.5rem;">Your DPDP deletion code: <strong style="color:#38bdf8;">' + data.deletionCode + '</strong> (keep this to request data deletion)</small>' : '';
          msg.innerHTML = '✓ ' + (data.message || 'Thank you. The owner will contact you on the number you gave.') + delCodeNotice;
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
      if (typeof window !== 'undefined' && window.location) {
        var params = new URLSearchParams(window.location.search);
        if (params.get('test') === 'true') {
          var elName = document.getElementById('cust-name');
          var elPhone = document.getElementById('cust-phone');
          var elSvc = document.getElementById('cust-service');
          var elNotes = document.getElementById('cust-notes');
          var elConsent = document.getElementById('cust-consent');
          if (elName) elName.value = 'Dr. Smoke Test (TEST)';
          if (elPhone) elPhone.value = '9999988888';
          if (elSvc) elSvc.value = 'Smoke Test Clinic, Hyderabad';
          if (elNotes) elNotes.value = 'Owner end-to-end smoke test inquiry';
          if (elConsent) elConsent.checked = true;
        }
      }
    } catch (e) {}

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
