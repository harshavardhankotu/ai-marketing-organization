/**
 * DirectCommercialOfferPage — Static & dynamic public commercial offer & homepage renderer.
 *
 * Single Verified Offer Snapshot Architecture (SiteFix Launch Gate):
 * - Prefers `owner/DIRECT_OFFER.md` (with `owner/OWN_OFFER.md` fallback).
 * - Reads the offer file ONCE into a single snapshot buffer, computes SHA-256 on those exact
 *   bytes, and parses SKU, product name, price, and TBD status strictly from that snapshot.
 * - Keeps `TBD` (or missing price) strictly non-payable with zero hardcoded legacy ₹15,000/₹8,000
 *   fallbacks and zero `upi://pay` links.
 * - Positions `GET /` around SiteFix Launch Gate (Web UI, npx CLI, GitHub Action, Public MCP)
 *   and Verified Consumer Deals / Fair-Price Checker with zero legacy healthcare/dental copy.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isProduction, resolveVerificationTokens, getDirectUpiConfig } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { renderCustomerDeskWidgetHtml } from './customer-desk-widget.js';

export interface VerifiedDirectOfferSnapshot {
  filePath: string;
  sha256: string;
  rawText: string;
  sku: string;
  productName: string;
  priceINR: number | null;
  monthlyPriceINR: number | null;
  isTbd: boolean;
  currency: string;
  fulfillmentModel: string | null;
  refundPolicy: string | null;
  disclaimer: string | null;
}

function resolveOfferFilePath(customFilePath?: string): string | null {
  if (customFilePath) {
    return fs.existsSync(customFilePath) ? customFilePath : null;
  }
  const candidates = [
    path.resolve(process.cwd(), 'owner', 'DIRECT_OFFER.md'),
    path.resolve(process.cwd(), '..', 'owner', 'DIRECT_OFFER.md'),
    path.resolve(process.cwd(), '..', '..', 'owner', 'DIRECT_OFFER.md'),
    path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md'),
    path.resolve(process.cwd(), '..', 'owner', 'OWN_OFFER.md'),
    path.resolve(process.cwd(), '..', '..', 'owner', 'OWN_OFFER.md')
  ];
  return candidates.find(c => fs.existsSync(c)) || null;
}

function parseOfferMarkdown(rawText: string): Omit<VerifiedDirectOfferSnapshot, 'filePath' | 'sha256' | 'rawText'> {
  const extractField = (patterns: RegExp[]): string | null => {
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/^`|`$/g, '').trim();
      }
    }
    return null;
  };

  const sku = extractField([
    /Product\s+SKU:\*?\*?\s*`?([A-Za-z0-9_-]+)`?/i,
    /SKU:\*?\*?\s*`?([A-Za-z0-9_-]+)`?/i
  ]) || 'SITEFIX_AI_PACK_V1';

  const productName = extractField([
    /Product\s+Name:\*?\*?\s*(.+)/i,
    /^#\s+(.+)/m
  ]) || 'SiteFix AI — Website Audit & Optimization Fix-Pack';

  const currency = (extractField([/Currency:\*?\*?\s*([A-Z]{3})/i]) || 'INR').toUpperCase();
  const fulfillmentModel = extractField([/Fulfillment\s+Model:\*?\*?\s*(.+)/i]);
  const refundPolicy = extractField([/Refund\s+Policy:\*?\*?\s*(.+)/i]);
  const disclaimer = extractField([/Disclaimer:\*?\*?\s*(.+)/i]);

  const priceLine = extractField([
    /Authorized\s+Price:\*?\*?\s*(.+)/i,
    /Setup\s+Price:\*?\*?\s*(.+)/i,
    /Price:\*?\*?\s*(.+)/i
  ]);

  const monthlyLine = extractField([
    /Monthly\s+(?:Retainer|Price):\*?\*?\s*(.+)/i
  ]);

  const parseInrAmount = (line: string | null): { value: number | null; isTbd: boolean } => {
    if (!line) return { value: null, isTbd: true };
    if (/\bTBD\b|\bUNSET\b|\bPENDING\b|\bTO BE DECIDED\b/i.test(line)) {
      return { value: null, isTbd: true };
    }
    const m = line.match(/(?:₹|INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) || line.match(/\b([0-9,]+(?:\.[0-9]{1,2})?)\b/);
    if (!m || !m[1]) return { value: null, isTbd: true };
    const num = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) return { value: null, isTbd: true };
    return { value: Math.round(num), isTbd: false };
  };

  const primaryPrice = parseInrAmount(priceLine);
  const monthlyPrice = monthlyLine ? parseInrAmount(monthlyLine) : { value: null, isTbd: false };

  return {
    sku,
    productName,
    priceINR: primaryPrice.isTbd ? null : primaryPrice.value,
    monthlyPriceINR: monthlyPrice.isTbd ? null : monthlyPrice.value,
    isTbd: primaryPrice.isTbd || primaryPrice.value === null,
    currency,
    fulfillmentModel,
    refundPolicy,
    disclaimer
  };
}

/**
 * Reads the canonical direct offer specification file (`owner/DIRECT_OFFER.md` or fallback
 * `owner/OWN_OFFER.md`) ONCE into a single verified snapshot and computes SHA-256 on those
 * exact bytes. Eliminates TOCTOU drift between attestation and HTML rendering.
 */
export function readVerifiedDirectOfferSnapshot(customFilePath?: string): VerifiedDirectOfferSnapshot | null {
  try {
    const filePath = resolveOfferFilePath(customFilePath);
    if (!filePath) return null;
    const rawBuffer = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const rawText = rawBuffer.toString('utf8');
    const parsed = parseOfferMarkdown(rawText);
    return {
      filePath,
      sha256,
      rawText,
      ...parsed
    };
  } catch {
    return null;
  }
}

export function computeOwnOfferHash(customFilePath?: string): string | null {
  return readVerifiedDirectOfferSnapshot(customFilePath)?.sha256 ?? null;
}

export interface OfferPageConfig {
  siteName?: string;
  siteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  upiVpa?: string;
  razorpayMeUrl?: string;
  googleSiteVerification?: string;
  cuelinksVerificationCode?: string;
  featuredDeals?: Array<Record<string, any>>;
  dealCtaAssignment?: {
    experimentId: string;
    variant: 'baseline' | 'treatment';
    ctaText: string;
    promoted?: boolean;
  };
}

function escapeMetaAttr(val: string): string {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(val: string): string {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class DirectCommercialOfferPage {
  private static instance: DirectCommercialOfferPage;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readVerifiedDirectOfferSnapshot(customFilePath?: string): VerifiedDirectOfferSnapshot | null {
    return readVerifiedDirectOfferSnapshot(customFilePath);
  }

  public static computeOwnOfferHash(customFilePath?: string): string | null {
    return computeOwnOfferHash(customFilePath);
  }

  public static getInstance(): DirectCommercialOfferPage {
    if (!DirectCommercialOfferPage.instance) {
      DirectCommercialOfferPage.instance = new DirectCommercialOfferPage();
    }
    return DirectCommercialOfferPage.instance;
  }

  private static verifyAttestationAgainstHash(computedHash: string | null): boolean {
    const isConfirmed = (process.env.OWN_OFFER_CONFIRMED || '').trim().toLowerCase() === 'true';
    if (!isConfirmed || !computedHash) {
      return false;
    }
    const expectedHash = process.env.DIRECT_OFFER_TERMS_SHA256?.trim();
    if (!expectedHash || expectedHash.length !== computedHash.length) {
      return false;
    }
    return crypto.timingSafeEqual(
      Buffer.from(computedHash.toLowerCase(), 'utf8'),
      Buffer.from(expectedHash.toLowerCase(), 'utf8')
    );
  }

  /**
   * P0 Safety Gate: Checks whether commercial terms have been explicitly attested by the owner.
   * /offer opens only when OWN_OFFER_CONFIRMED=true AND DIRECT_OFFER_TERMS_SHA256 equals
   * the SHA-256 of the single verified offer snapshot (owner/DIRECT_OFFER.md or owner/OWN_OFFER.md).
   */
  public static isDirectOfferAttested(customFilePath?: string): boolean {
    const snapshot = readVerifiedDirectOfferSnapshot(customFilePath);
    return DirectCommercialOfferPage.verifyAttestationAgainstHash(snapshot?.sha256 ?? null);
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
        ?, 'part_direct_own_01', 'SITEFIX_AI_PACK_V1', ?, ?,
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
  public generateOrderReference(prefix: string = 'SFX'): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${dateStr}-${rand}`;
  }

  /**
   * Renders the HTML offer page using ONE verified snapshot read.
   * - If unattested -> renders safe informational overview (noindex, zero prices/payment links).
   * - If attested with TBD / missing price -> renders strictly non-payable TBD notice.
   * - If attested with explicit price -> renders exact snapshot product & price with zero legacy fallbacks.
   */
  public renderOfferHtml(config: Partial<OfferPageConfig> = {}, customOfferPath?: string): string {
    const snapshot = readVerifiedDirectOfferSnapshot(customOfferPath);
    const isAttested = DirectCommercialOfferPage.verifyAttestationAgainstHash(snapshot?.sha256 ?? null);
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'SiteFix AI').trim();
    const siteUrl = config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : null);

    if (!isAttested || !snapshot) {
      return this.renderUnattestedOverviewHtml(siteName, siteUrl, contactEmail);
    }

    return this.renderAttestedOfferHtml(siteName, siteUrl, contactEmail, config, snapshot);
  }

  /**
   * Public server-rendered homepage (GET /) positioned cleanly around Website Enquiry Path Repair
   * for Training Institutes (Founding Pilot ₹1,999, Hyderabad founder-led execution, /demo CTA,
   * clean 390x844 mobile-first layout, OG + Schema.org JSON-LD, and statutory legal links).
   */
  public renderHomepageHtml(config: Partial<OfferPageConfig> = {}): string {
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization').trim();
    const siteUrl = (config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim()).replace(/\/+$/, '');
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : null);
    const {
      cuelinksVerificationCode: cuelinksCode = '',
      googleSiteVerification: googleCode = ''
    } = resolveVerificationTokens(config);
    const verificationMetaHtml = [
      cuelinksCode ? `  <meta name="cuelinks-verification" content="${escapeMetaAttr(cuelinksCode)}" />` : '',
      googleCode ? `  <meta name="google-site-verification" content="${escapeMetaAttr(googleCode)}" />` : ''
    ].filter(Boolean).join('\n');

    const pageTitle = `Website Enquiry Path Repair for Training Institutes | ${escapeHtmlText(siteName)}`;
    const pageDesc = 'Founder-led Website Enquiry Path Repair for coaching and training institutes in Hyderabad and India. Fix broken mobile enquiry forms, add WhatsApp click-to-chat, and set up structured lead tracking. Founding Pilot ₹1,999.';
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ProfessionalService',
      name: siteName,
      url: `${siteUrl}/`,
      description: pageDesc,
      areaServed: {
        '@type': 'City',
        name: 'Hyderabad'
      },
      ...(contactEmail ? { email: contactEmail } : {}),
      offers: {
        '@type': 'Offer',
        name: 'Founding Pilot — Website Enquiry Path Repair for Training Institutes',
        price: '1999',
        priceCurrency: 'INR',
        url: `${siteUrl}/offer`
      }
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeMetaAttr(pageDesc)}">
  <link rel="canonical" href="${escapeMetaAttr(siteUrl)}/">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${escapeMetaAttr(pageTitle)}">
  <meta property="og:description" content="${escapeMetaAttr(pageDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeMetaAttr(siteUrl)}/">
  <meta property="og:site_name" content="${escapeMetaAttr(siteName)}">
${verificationMetaHtml ? verificationMetaHtml + '\n' : ''}  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b14;
      --surface: #0f172a;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --accent-hover: #22d3ee;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    nav.top-nav {
      background: rgba(11, 17, 32, 0.94);
      border-bottom: 1px solid var(--card-border);
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
      position: sticky;
      top: 0;
      z-index: 40;
      backdrop-filter: blur(8px);
    }
    .brand { font-weight: 800; font-size: 0.98rem; color: #fff; text-decoration: none; white-space: nowrap; }
    .nav-links { display: flex; gap: 0.9rem; align-items: center; flex-wrap: nowrap; overflow-x: auto; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
    .nav-links a:hover, .nav-links a.active { color: var(--accent); }
    .container { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 2.5rem; }
    .hero { text-align: left; padding: 1.5rem 0 2rem; }
    .status-badge {
      display: inline-block;
      background: rgba(6, 182, 212, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(6, 182, 212, 0.35);
      padding: 0.3rem 0.75rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      margin-bottom: 1rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: clamp(1.75rem, 4.5vw, 2.6rem);
      font-weight: 800;
      color: #ffffff;
      line-height: 1.18;
      margin-bottom: 0.9rem;
      letter-spacing: -0.02em;
    }
    p.subtitle {
      font-size: 1rem;
      color: #cbd5e1;
      max-width: 680px;
      margin-bottom: 1.4rem;
    }
    .cta-group { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.78rem 1.25rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.92rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: var(--accent); color: #04101d; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: #1e293b; color: #f8fafc; border: 1px solid #334155; }
    .btn-secondary:hover { border-color: var(--accent); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 { font-size: 1.25rem; color: #fff; margin-bottom: 0.75rem; }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
    }
    .feature-item {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.1rem;
    }
    .feature-item h3 { font-size: 0.98rem; color: #f8fafc; margin-bottom: 0.35rem; }
    .feature-item p { font-size: 0.87rem; color: #cbd5e1; line-height: 1.5; }
    .price-pill {
      display: inline-block;
      background: rgba(16, 185, 129, 0.14);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      font-size: 0.76rem;
      font-weight: 700;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.85rem;
    }
    label { display: block; font-size: 0.8rem; color: #cbd5e1; margin-bottom: 0.3rem; font-weight: 600; }
    input[type="text"], input[type="tel"], input[type="email"], textarea {
      width: 100%;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.62rem 0.75rem;
      color: #fff;
      font-size: 0.88rem;
    }
    footer {
      background: #0b1120;
      border-top: 1px solid var(--card-border);
      padding: 2rem 1rem 5.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.84rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
    @media (max-width: 480px) {
      nav.top-nav { padding: 0.65rem 0.85rem; }
      .brand { font-size: 0.9rem; }
      .nav-links { gap: 0.7rem; }
      .nav-links a { font-size: 0.8rem; }
      .cta-group .btn { width: 100%; }
    }
  </style>
</head>
<body>
  <nav class="top-nav" aria-label="Primary Navigation">
    <a href="/" class="brand">${escapeHtmlText(siteName)}</a>
    <div class="nav-links">
      <a href="/" class="active">Home</a>
      <a href="/demo">Live Demo</a>
      <a href="/offer">Founding Pilot</a>
      <a href="/contact">Contact</a>
    </div>
  </nav>

  <main class="container">
    <header class="hero">
      <div class="status-badge">Hyderabad &bull; Founder-Led B2B Service</div>
      <h1>Website Enquiry Path Repair for Training Institutes</h1>
      <p class="subtitle">
        Stop losing mobile student admissions enquiries to broken forms, slow phone-only contact pages, and missed WhatsApp follow-ups. See a live working repair flow before you commit.
      </p>
      <div class="cta-group">
        <a href="/demo" class="btn btn-primary">Try Live Interactive Demo &rarr;</a>
        <a href="#founding-pilot" class="btn btn-secondary">Founding Pilot &bull; ₹1,999</a>
        <a href="#pilot-enquiry" class="btn btn-secondary">Request Pilot Setup</a>
      </div>
    </header>

    <section class="card" aria-labelledby="scope-heading">
      <h2 id="scope-heading">Transparent Done-For-You Scope</h2>
      <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem;">
        Built for coaching centers and skill academies whose mobile visitors bounce before submitting a course enquiry.
      </p>
      <div class="grid-2">
        <div class="feature-item">
          <h3>1. Mobile-First Enquiry Form (390&times;844)</h3>
          <p>Fix overflowing mobile layouts and broken submission flows so prospective students can enquire in under 30 seconds from any phone.</p>
        </div>
        <div class="feature-item">
          <h3>2. Direct WhatsApp Click-to-Chat</h3>
          <p>Pre-filled <code>wa.me</code> course enquiry button routed straight to your official institute WhatsApp number with zero recurring software fees.</p>
        </div>
        <div class="feature-item">
          <h3>3. Structured Lead Tracker</h3>
          <p>Every enquiry lands in a clean tracker (<code>New &rarr; Contacted &rarr; Demo Scheduled &rarr; Enrolled</code>) with instant email notification.</p>
        </div>
        <div class="feature-item">
          <h3>4. Clean SEO &amp; Schema Metadata</h3>
          <p>Verified <code>&lt;title&gt;</code>, meta description, canonical URL, Open Graph preview, and <code>EducationalOrganization</code> JSON-LD.</p>
        </div>
      </div>
    </section>

    <section class="card" id="founding-pilot" style="border-color: rgba(6, 182, 212, 0.45); background: linear-gradient(180deg, #111827 0%, #0b1120 100%);">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.85rem;">
        <h2 style="margin: 0;">Founding Pilot &mdash; ₹1,999 Total</h2>
        <span class="price-pill">₹999 Advance + ₹1,000 After Live Handover</span>
      </div>
      <p style="color: #cbd5e1; font-size: 0.93rem; margin-bottom: 1rem;">
        Honest milestone billing: pay <strong>₹999</strong> advance to kick off implementation, inspect your live working mobile enquiry path, and pay the remaining <strong>₹1,000</strong> only after live handover. Includes a <strong>7-day post-handover bug-fix window</strong>.
      </p>
      <ul style="color: #94a3b8; font-size: 0.86rem; padding-left: 1.2rem; margin-bottom: 1.15rem; display: grid; gap: 0.35rem;">
        <li>Founder-operated in Hyderabad — direct 1:1 execution without agency hand-offs.</li>
        <li>No fabricated testimonials, no fake client logos, and no guaranteed admission counts.</li>
        <li>Test the exact deliverables yourself right now on the interactive <a href="/demo" style="color: #38bdf8; font-weight: 600;">/demo page</a>.</li>
      </ul>
      <div class="cta-group">
        <a href="/demo" class="btn btn-primary">Explore Interactive /demo &rarr;</a>
        <a href="/offer" class="btn btn-secondary">View Full Founding Pilot Details</a>
      </div>
    </section>

    <section class="card" id="pilot-enquiry" aria-labelledby="enquiry-heading">
      <h2 id="enquiry-heading">Request a Founding Pilot Walkthrough</h2>
      <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1rem;">
        Share your institute website or city and we will respond directly with a concrete fix checklist for your enquiry path.
      </p>
      <form onsubmit="handlePilotEnquiry(event)" style="display: grid; gap: 0.85rem;">
        <div class="form-grid">
          <div>
            <label for="b2b-name">Your Name *</label>
            <input id="b2b-name" type="text" required maxlength="100" placeholder="e.g. Kiran Reddy">
          </div>
          <div>
            <label for="b2b-phone">WhatsApp / Mobile Number *</label>
            <input id="b2b-phone" type="tel" required maxlength="20" placeholder="e.g. 9849012345">
          </div>
        </div>
        <div class="form-grid">
          <div>
            <label for="b2b-institute">Training Institute &amp; City *</label>
            <input id="b2b-institute" type="text" required maxlength="140" placeholder="e.g. Pragati Coaching Academy, Hyderabad">
          </div>
          <div>
            <label for="b2b-email">Email Address (Optional)</label>
            <input id="b2b-email" type="email" maxlength="120" placeholder="founder@institute.in">
          </div>
        </div>
        <div>
          <label for="b2b-notes">Website URL or Enquiry Issue</label>
          <textarea id="b2b-notes" rows="2" maxlength="500" placeholder="e.g. https://ourinstitute.in — mobile enquiry button is hard to reach"></textarea>
        </div>
        <input type="text" id="b2b-trap" name="website_trap" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px;width:1px;height:1px;" aria-hidden="true">
        <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-weight: 400; font-size: 0.82rem; color: #cbd5e1; cursor: pointer;">
          <input type="checkbox" id="b2b-consent" required style="margin-top: 0.2rem;">
          <span>I agree to be contacted regarding this Founding Pilot enquiry in accordance with the <a href="/privacy" style="color: #38bdf8;">Privacy Policy</a>.</span>
        </label>
        <div>
          <button type="submit" id="b2b-submit" class="btn btn-primary">Send Pilot Enquiry &rarr;</button>
        </div>
        <div id="b2b-status" style="font-size: 0.85rem;"></div>
      </form>
    </section>
  </main>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)} &bull; Hyderabad, India</p>
    <p style="margin-top: 0.6rem;">
      <a href="/terms">Terms</a> &bull;
      <a href="/privacy">Privacy Policy</a> &bull;
      <a href="/refund">Refund Policy</a> &bull;
      <a href="/contact">Contact</a>${contactEmail ? ` &bull; <a href="mailto:${escapeMetaAttr(contactEmail)}">${escapeHtmlText(contactEmail)}</a>` : ''}
    </p>
  </footer>

  <script>
    async function handlePilotEnquiry(e) {
      e.preventDefault();
      var btn = document.getElementById('b2b-submit');
      var statusEl = document.getElementById('b2b-status');
      var payload = {
        customerName: (document.getElementById('b2b-name') || {}).value || '',
        customerPhone: (document.getElementById('b2b-phone') || {}).value || '',
        serviceOfInterest: (document.getElementById('b2b-institute') || {}).value || '',
        customerEmail: (document.getElementById('b2b-email') || {}).value || '',
        notes: (document.getElementById('b2b-notes') || {}).value || '',
        website_trap: (document.getElementById('b2b-trap') || {}).value || '',
        consentGiven: Boolean((document.getElementById('b2b-consent') || {}).checked),
        source: 'homepage_b2b_inquiry',
        channel: 'WHATSAPP'
      };
      if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
      if (statusEl) { statusEl.style.color = '#94a3b8'; statusEl.textContent = 'Recording your enquiry...'; }
      try {
        var res = await fetch('/api/v1/offer/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || data.message || 'Submission failed');
        }
        if (statusEl) {
          statusEl.style.color = '#34d399';
          statusEl.textContent = data.message || 'Enquiry recorded. We will follow up directly.';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.style.color = '#f87171';
          statusEl.textContent = err && err.message ? err.message : 'Could not submit enquiry.';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Pilot Enquiry \\u2192'; }
      }
    }
  </script>
  ${renderCustomerDeskWidgetHtml('B2B_WEBSITE_ENQUIRY_SETUP')}
</body>
</html>`;
  }

  /**
   * Safe, non-payment informational overview page shown when commercial terms are pending owner attestation.
   * Zero unconfirmed prices, zero guarantees, zero UPI VPAs, zero payment links.
   */
  private renderUnattestedOverviewHtml(siteName: string, siteUrl: string, contactEmail: string | null): string {
    const cleanSiteUrl = siteUrl.replace(/\/+$/, '');
    const pageTitle = `Founding Pilot Overview — Website Enquiry Path Repair | ${escapeHtmlText(siteName)}`;
    const pageDesc = 'Informational overview of Website Enquiry Path Repair for Training Institutes. Review scope, demo workflow, and owner-confirmed checkout verification.';
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: 'Website Enquiry Path Repair — Founding Pilot Overview',
      provider: {
        '@type': 'Organization',
        name: siteName,
        url: cleanSiteUrl
      },
      url: `${cleanSiteUrl}/offer`,
      description: pageDesc
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${escapeMetaAttr(pageDesc)}">
  <link rel="canonical" href="${escapeMetaAttr(cleanSiteUrl)}/offer">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${escapeMetaAttr(pageTitle)}">
  <meta property="og:description" content="${escapeMetaAttr(pageDesc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeMetaAttr(cleanSiteUrl)}/offer">
  <meta property="og:site_name" content="${escapeMetaAttr(siteName)}">
  <script type="application/ld+json">${jsonLd}</script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b14;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
    }
    nav.top-nav {
      background: rgba(11, 17, 32, 0.94);
      border-bottom: 1px solid var(--card-border);
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.75rem;
    }
    .brand { font-weight: 800; font-size: 0.98rem; color: #fff; text-decoration: none; white-space: nowrap; }
    .nav-links { display: flex; gap: 0.9rem; align-items: center; flex-wrap: nowrap; overflow-x: auto; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.85rem; font-weight: 600; white-space: nowrap; }
    .nav-links a:hover, .nav-links a.active { color: var(--accent); }
    .container { max-width: 860px; margin: 0 auto; padding: 2rem 1rem 3rem; }
    header { text-align: center; margin-bottom: 2rem; }
    .status-badge {
      display: inline-block;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 0.35rem 0.9rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      margin-bottom: 1rem;
      text-transform: uppercase;
    }
    h1 { font-size: clamp(1.6rem, 4.2vw, 2.2rem); font-weight: 800; color: #ffffff; line-height: 1.2; margin-bottom: 0.85rem; }
    p.subtitle { font-size: 1rem; color: var(--text-muted); max-width: 680px; margin: 0 auto; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 { font-size: 1.2rem; color: #fff; margin-bottom: 0.85rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
    footer {
      text-align: center;
      padding: 2rem 1rem 3rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.84rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <nav class="top-nav" aria-label="Primary Navigation">
    <a href="/" class="brand">${escapeHtmlText(siteName)}</a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/demo">Live Demo</a>
      <a href="/offer" class="active">Founding Pilot</a>
      <a href="/contact">Contact</a>
    </div>
  </nav>

  <div class="container">
    <header>
      <div class="status-badge">Configuration Pending Owner Attestation</div>
      <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 0.75rem;">Direct online checkout is disabled until commercial terms are attested by the owner.</p>
      <h1>Website Enquiry Path Repair &mdash; Founding Pilot</h1>
      <p class="subtitle">Mobile-first admissions enquiry forms, WhatsApp click-to-chat routing, and structured lead tracking for training institutes.</p>
      <div style="margin-top: 1.25rem; display: flex; justify-content: center; gap: 0.75rem; flex-wrap: wrap;">
        <a href="/demo" class="btn btn-primary" style="display: inline-block; background: #06b6d4; color: #090d16; font-weight: 700; padding: 0.75rem 1.35rem; border-radius: 8px; text-decoration: none; font-size: 0.92rem;">Try Live Interactive Demo &rarr;</a>
        <a href="/#pilot-enquiry" class="btn btn-secondary" style="display: inline-block; background: #1e293b; color: #fff; border: 1px solid #334155; font-weight: 600; padding: 0.75rem 1.35rem; border-radius: 8px; text-decoration: none; font-size: 0.92rem;">Request Pilot Walkthrough</a>
      </div>
    </header>

    <div class="card">
      <h2>Pilot Scope &amp; Verification Policy</h2>
      <div class="grid-2">
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #38bdf8; font-size: 1.02rem; margin-bottom: 0.4rem;">1. Interactive Working Sample</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1;">Inspect the sample course enquiry form, live WhatsApp preview, and interactive lead tracker at <a href="/demo" style="color: #38bdf8;">/demo</a> before requesting implementation.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #34d399; font-size: 1.02rem; margin-bottom: 0.4rem;">2. Owner-Attested Terms Gate</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1;">Direct online checkout activates only after the founder attests live commercial terms via SHA-256 verification. Unattested specifications remain strictly non-payable.</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Contact &amp; Verification</h2>
      <p style="color: #cbd5e1; font-size: 0.92rem;">
        ${contactEmail ? `For Hyderabad Founding Pilot inquiries, contact: <a href="mailto:${escapeMetaAttr(contactEmail)}" style="color: var(--accent);">${escapeHtmlText(contactEmail)}</a>` : 'Reach the founder directly via our <a href="/contact" style="color: var(--accent);">Contact page</a> or <a href="/#pilot-enquiry" style="color: var(--accent);">pilot enquiry form</a>.'}
      </p>
    </div>
  </div>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)} &bull; Hyderabad, India</p>
    <p style="margin-top: 0.45rem;">
      <a href="/terms">Terms</a> &bull;
      <a href="/privacy">Privacy Policy</a> &bull;
      <a href="/refund">Refund Policy</a> &bull;
      <a href="/contact">Contact</a>
    </p>
  </footer>
  <script>
    (function() {
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
          body: JSON.stringify({ path: '/offer', source: 'web', sessionId: sessId, referrer: document.referrer || '' })
        }).catch(function() {});
      } catch (e) {}
    })();
  </script>
</body>
</html>`;
  }

  /**
   * Attested offer page strictly rendered from a SINGLE verified snapshot.
   * - If snapshot has `isTbd === true` or `priceINR === null`: strictly non-payable (zero upi://pay, zero checkout links, zero ₹15,000/₹8,000 fallbacks).
   * - Otherwise renders ONLY the exact parsed price(s), SKU, refund terms, and disclaimer from that snapshot.
   */
  private renderAttestedOfferHtml(
    siteName: string,
    siteUrl: string,
    contactEmail: string | null,
    config: Partial<OfferPageConfig>,
    snapshot: VerifiedDirectOfferSnapshot
  ): string {
    if (snapshot.isTbd || snapshot.priceINR === null) {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlText(snapshot.productName)} | Pricing TBD</title>
  <meta name="description" content="Commercial specification verified, pricing currently TBD. Online checkout is disabled.">
  <link rel="canonical" href="${escapeMetaAttr(siteUrl)}/offer">
  <meta name="robots" content="noindex, nofollow">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; padding: 2rem 1rem; line-height: 1.6; }
    .container { max-width: 780px; margin: 0 auto; }
    .card { background: #111827; border: 1px solid #1e293b; border-radius: 14px; padding: 1.75rem; margin-top: 1.5rem; }
    .badge { display: inline-block; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.35rem 0.9rem; border-radius: 999px; font-size: 0.82rem; font-weight: 700; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">Pricing TBD — Non-Payable Specification</div>
    <h1 style="margin-top: 1rem;">${escapeHtmlText(snapshot.productName)}</h1>
    <p style="color: #94a3b8; margin-top: 0.5rem;">SKU: <code>${escapeHtmlText(snapshot.sku)}</code> · Verified SHA-256: <code>${snapshot.sha256.slice(0, 12)}...</code></p>
    <div class="card">
      <h2>Pricing Status: TBD</h2>
      <p style="color: #cbd5e1; margin-top: 0.5rem;">Direct online checkout is disabled while commercial pricing is marked <strong>TBD</strong> in the attested offer specification.</p>
      <div style="margin-top: 1rem;">
        <a href="/tools/site-audit" class="btn btn-primary" style="display: inline-block; background: #06b6d4; color: #090d16; font-weight: 700; padding: 0.75rem 1.4rem; border-radius: 8px; text-decoration: none; font-size: 0.95rem;">Run Free Website Audit &amp; Access Fix-Pack &rarr;</a>
      </div>
      ${snapshot.disclaimer ? `<p style="color: #94a3b8; font-size: 0.88rem; margin-top: 1rem;">${escapeHtmlText(snapshot.disclaimer)}</p>` : ''}
    </div>
  </div>
</body>
</html>`;
    }

    const upiCfg = getDirectUpiConfig();
    const upiVpa = config.upiVpa || process.env.OWNER_UPI_VPA || upiCfg.vpa || null;
    const orderRef = this.generateOrderReference('SFX');
    const primaryPriceINR = snapshot.priceINR;
    const monthlyPriceINR = snapshot.monthlyPriceINR;

    const upiUri = upiVpa
      ? `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${encodeURIComponent(upiCfg.payeeName || siteName)}&am=${primaryPriceINR}&tr=${encodeURIComponent(orderRef)}&cu=${encodeURIComponent(snapshot.currency)}&tn=${encodeURIComponent(`${snapshot.sku} Ref ${orderRef}`)}`
      : null;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlText(snapshot.productName)} | Verified Commercial Offer</title>
  <meta name="description" content="${escapeMetaAttr(snapshot.productName)} (${escapeMetaAttr(snapshot.sku)}) — Owner-attested commercial specification.">
  <link rel="canonical" href="${escapeMetaAttr(siteUrl)}/offer">
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
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2rem; }
    .badge {
      display: inline-block;
      background: rgba(6, 182, 212, 0.15);
      color: #67e8f9;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 0.35rem 0.9rem;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 { font-size: 2.2rem; font-weight: 800; color: #fff; margin-bottom: 0.75rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 2rem;
      margin-bottom: 1.5rem;
    }
    .price-amount { font-size: 2.5rem; font-weight: 800; color: #fff; }
    .btn {
      display: inline-block;
      text-align: center;
      background: var(--accent);
      color: #090d16;
      font-weight: 700;
      padding: 0.85rem 1.4rem;
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.96rem;
      border: none;
      cursor: pointer;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
    footer { text-align: center; margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--card-border); color: var(--text-muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge">Owner-Attested Commercial Offer • ${escapeHtmlText(snapshot.sku)}</div>
      <h1>${escapeHtmlText(snapshot.productName)}</h1>
      <p style="color: var(--text-muted);">Verified SHA-256 Snapshot: <code>${snapshot.sha256.slice(0, 16)}</code></p>
    </header>

    <div class="card" style="border-color: var(--accent);">
      <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 1rem; border-bottom: 1px solid var(--card-border); padding-bottom: 1.25rem; margin-bottom: 1.25rem;">
        <div>
          <div style="font-size: 0.82rem; color: #38bdf8; font-weight: 700; text-transform: uppercase;">Authorized Price (${escapeHtmlText(snapshot.currency)})</div>
          <div class="price-amount">₹${primaryPriceINR.toLocaleString('en-IN')}</div>
          ${monthlyPriceINR !== null ? `<div style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.25rem;">Optional Monthly Retainer: ₹${monthlyPriceINR.toLocaleString('en-IN')}/mo</div>` : ''}
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          <div>SKU: <code>${escapeHtmlText(snapshot.sku)}</code></div>
          <div>Reference: <code>${orderRef}</code></div>
        </div>
      </div>

      ${snapshot.fulfillmentModel ? `<p style="color: #e2e8f0; margin-bottom: 0.85rem;"><strong>Fulfillment:</strong> ${escapeHtmlText(snapshot.fulfillmentModel)}</p>` : ''}
      ${snapshot.refundPolicy ? `<p style="color: #cbd5e1; margin-bottom: 0.85rem;"><strong>Refund Policy:</strong> ${escapeHtmlText(snapshot.refundPolicy)}</p>` : ''}
      ${snapshot.disclaimer ? `<p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 1.25rem;"><strong>Disclaimer:</strong> ${escapeHtmlText(snapshot.disclaimer)}</p>` : ''}

      <div style="display: flex; gap: 0.9rem; flex-wrap: wrap;">
        <a href="/tools/site-audit" class="btn">Run Free Audit &amp; Unlock Fix-Pack (₹${primaryPriceINR.toLocaleString('en-IN')}) &rarr;</a>
        ${upiUri ? `<a href="${upiUri}" class="btn btn-secondary">Pay ₹${primaryPriceINR.toLocaleString('en-IN')} via UPI</a>` : ''}
      </div>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)} &bull; Hyderabad, India</p>
      <p style="margin-top: 0.45rem;">
        <a href="/terms" style="color: var(--accent);">Terms</a> &bull;
        <a href="/privacy" style="color: var(--accent);">Privacy Policy</a> &bull;
        <a href="/refund" style="color: var(--accent);">Refund Policy</a> &bull;
        <a href="/contact" style="color: var(--accent);">Contact</a>${contactEmail ? ` &bull; <a href="mailto:${escapeMetaAttr(contactEmail)}" style="color: var(--accent);">${escapeHtmlText(contactEmail)}</a>` : ''}
      </p>
    </footer>
  </div>
</body>
</html>`;
  }
}
