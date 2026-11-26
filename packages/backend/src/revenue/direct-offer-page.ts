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

    const pageTitle = `AI Buying Assistant — Verified Skincare & Fair-Price Picks | ${escapeHtmlText(siteName)}`;
    const pageDesc = 'Preference-based AI Buying Assistant that matches verified Indian products to your budget, ingredients, and ₹/ml unit cost with honest trade-offs and #Affiliate disclosure.';
    const featuredDeals = Array.isArray(config.featuredDeals) ? config.featuredDeals.slice(0, 4) : [];
    const ctaText = config.dealCtaAssignment?.ctaText || 'Buy at Official Store (#Affiliate) →';
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: `${siteUrl}/`,
      description: pageDesc
    }).replace(/</g, '\\u003c');

    const featuredCardsHtml = featuredDeals.map((d: any) => {
      const price = Number(d.currentPriceINR || 0);
      const ml = Number(d.unitVolumeMl ?? d.evidenceJson?.unitVolumeMl ?? 0);
      const perMl = Number(d.pricePerMlINR ?? d.evidenceJson?.pricePerMlINR ?? (ml > 0 && price > 0 ? Number((price / ml).toFixed(2)) : 0));
      const slug = d.slug || d.canonicalSlug || d.id;
      const detailUrl = `/deals/${encodeURIComponent(slug)}`;
      const redirectUrl = `${siteUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect?utm_source=homepage_featured`;
      const frag = d.evidenceJson?.rawSpecs?.['Fragrance Profile'] || '';
      const actives = d.evidenceJson?.rawSpecs?.['Key Ingredients'] || '';
      return `
        <article class="feature-item" style="display:flex;flex-direction:column;justify-content:space-between;gap:0.65rem;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
              <span style="font-size:0.74rem;font-weight:700;color:#38bdf8;text-transform:uppercase;">${escapeHtmlText(d.brand || d.merchant || 'Verified Brand')}</span>
              <span style="font-size:0.72rem;color:#94a3b8;">#Affiliate &bull; #Ad</span>
            </div>
            <h3 style="font-size:0.98rem;line-height:1.35;margin-bottom:0.35rem;"><a href="${escapeMetaAttr(detailUrl)}" style="color:#f8fafc;text-decoration:none;">${escapeHtmlText(d.title || '')}</a></h3>
            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;align-items:baseline;margin-bottom:0.4rem;">
              <span style="font-size:1.25rem;font-weight:800;color:#fff;">₹${price.toLocaleString('en-IN')}</span>
              ${ml > 0 ? `<span style="font-size:0.75rem;color:#cbd5e1;background:#111827;border:1px solid #334155;padding:0.12rem 0.45rem;border-radius:6px;">${ml} ml</span>` : ''}
              ${perMl > 0 ? `<span style="font-size:0.75rem;color:#67e8f9;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.35);padding:0.12rem 0.45rem;border-radius:6px;">₹${perMl.toFixed(2)}/ml</span>` : ''}
            </div>
            ${actives ? `<p style="font-size:0.78rem;color:#cbd5e1;margin-bottom:0.25rem;"><strong>Actives:</strong> ${escapeHtmlText(actives)}</p>` : ''}
            ${frag ? `<p style="font-size:0.76rem;color:#94a3b8;"><strong>Fragrance:</strong> ${escapeHtmlText(frag)}</p>` : ''}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;padding-top:0.5rem;border-top:1px solid #1e293b;">
            <a href="${escapeMetaAttr(redirectUrl)}" target="_blank" rel="sponsored noopener noreferrer" class="btn btn-primary" style="flex:1 1 160px;padding:0.5rem 0.75rem;font-size:0.8rem;">${escapeHtmlText(ctaText)}</a>
            <a href="${escapeMetaAttr(detailUrl)}" class="btn btn-secondary" style="padding:0.5rem 0.75rem;font-size:0.78rem;">Specs &amp; Reviews</a>
          </div>
        </article>`;
    }).join('');

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
      padding: 0.7rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem 0.85rem;
      position: sticky;
      top: 0;
      z-index: 40;
      backdrop-filter: blur(8px);
    }
    .brand { font-weight: 800; font-size: 0.95rem; color: #fff; text-decoration: none; white-space: nowrap; }
    .nav-links { display: flex; gap: 0.55rem 0.9rem; align-items: center; flex-wrap: wrap; max-width: 100%; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.83rem; font-weight: 600; white-space: nowrap; }
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
      <a href="/" class="active">AI Assistant</a>
      <a href="/deals">Verified Deals</a>
      <a href="/disclosure">Disclosure</a>
      <a href="/contact">Contact</a>
    </div>
  </nav>

  <main class="container">
    <header class="hero">
      <div class="status-badge">#Affiliate &bull; #Ad &bull; Preference-Based AI Buying Assistant</div>
      <h1>Match Verified Skincare Deals to Your Budget &amp; Needs</h1>
      <p class="subtitle">
        Tell us your budget, skin type, active ingredients, and what to avoid. We compare verified Indian D2C listings by fit and ₹/ml unit cost with honest trade-offs — never ranked by commission.
      </p>
    </header>

    <section class="card" id="ai-shopping-assistant" aria-labelledby="assistant-heading">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.65rem;">
        <h2 id="assistant-heading" style="margin:0;">AI Shopping Assistant</h2>
        <span class="price-pill">#Affiliate Disclosure: Qualifying links may earn a commission</span>
      </div>
      <p style="color:#94a3b8;font-size:0.88rem;margin-bottom:1rem;">
        Enter a plain-English request or set your filters below to get up to 3 grounded picks: Best Match, Best Value (₹/ml), and Alternative Choice.
      </p>
      <form onsubmit="handleAssistantQuery(event)" style="display:grid;gap:0.85rem;">
        <div>
          <label for="assistant-query">What are you looking for? *</label>
          <input id="assistant-query" type="text" required maxlength="300" placeholder="e.g. niacinamide serum under 800, oily skin, avoid fragrance" value="niacinamide serum under 800, oily skin, avoid fragrance">
        </div>
        <div class="form-grid">
          <div>
            <label for="assistant-budget">Max Budget (₹)</label>
            <input id="assistant-budget" type="number" min="100" max="50000" placeholder="e.g. 800">
          </div>
          <div>
            <label for="assistant-skin">Skin Type / Need</label>
            <select id="assistant-skin" style="width:100%;background:#090d16;border:1px solid #334155;border-radius:8px;padding:0.62rem 0.75rem;color:#fff;font-size:0.88rem;">
              <option value="">Any skin type</option>
              <option value="oily">Oily / Combination</option>
              <option value="dry">Dry / Dull</option>
              <option value="sensitive">Sensitive</option>
              <option value="beginner">Beginner</option>
            </select>
          </div>
          <div>
            <label for="assistant-active">Key Active Ingredient</label>
            <select id="assistant-active" style="width:100%;background:#090d16;border:1px solid #334155;border-radius:8px;padding:0.62rem 0.75rem;color:#fff;font-size:0.88rem;">
              <option value="">Any active</option>
              <option value="niacinamide">Niacinamide</option>
              <option value="vitamin c">Vitamin C</option>
              <option value="alpha arbutin">Alpha Arbutin</option>
              <option value="kumkumadi">Kumkumadi / Saffron</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:1.1rem;flex-wrap:wrap;align-items:center;">
          <label style="display:flex;align-items:center;gap:0.4rem;font-weight:500;font-size:0.84rem;color:#cbd5e1;cursor:pointer;margin:0;">
            <input id="assistant-fragrance-free" type="checkbox"> Avoid added fragrance
          </label>
          <label style="display:flex;align-items:center;gap:0.4rem;font-weight:500;font-size:0.84rem;color:#cbd5e1;cursor:pointer;margin:0;">
            <input id="assistant-lowest-ml" type="checkbox"> Prioritize lowest ₹/ml
          </label>
        </div>
        <div class="cta-group">
          <button type="submit" id="assistant-submit" class="btn btn-primary">Find Best Matches &rarr;</button>
          <a href="/deals" class="btn btn-secondary">Browse All Verified Deals</a>
        </div>
      </form>
      <div id="assistant-results" style="display:none;margin-top:1.25rem;"></div>
    </section>

    ${featuredDeals.length > 0 ? `
    <section class="card" aria-labelledby="featured-heading">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.9rem;">
        <h2 id="featured-heading" style="margin:0;">Live Verified Skincare Serums (₹/ml Compared)</h2>
        <a href="/deals" style="color:#38bdf8;font-size:0.85rem;font-weight:600;text-decoration:none;">View all verified deals &rarr;</a>
      </div>
      <div class="grid-2">
        ${featuredCardsHtml}
      </div>
    </section>` : ''}
  </main>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)} &bull; #Affiliate Disclosure: Outgoing store links may earn a commission at zero extra cost to you.</p>
    <p style="margin-top: 0.6rem;">
      <a href="/">AI Assistant</a> &bull;
      <a href="/deals">Verified Deals</a> &bull;
      <a href="/disclosure">Affiliate Disclosure</a> &bull;
      <a href="/terms">Terms</a> &bull;
      <a href="/privacy">Privacy Policy</a> &bull;
      <a href="/refund">Refund Policy</a> &bull;
      <a href="/contact">Contact</a>${contactEmail ? ` &bull; <a href="mailto:${escapeMetaAttr(contactEmail)}">${escapeHtmlText(contactEmail)}</a>` : ''}
    </p>
  </footer>

  <script>
    function escHtml(s) {
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function trackRecClick(dealId, slot) {
      try {
        var payload = JSON.stringify({ event: 'recommendation_click', path: '/', dealId: dealId, slot: slot });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/v1/public/shopping-event', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/v1/public/shopping-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function(){});
        }
      } catch (e) {}
    }
    async function handleAssistantQuery(e) {
      e.preventDefault();
      var q = (document.getElementById('assistant-query') || {}).value || '';
      var budgetVal = Number((document.getElementById('assistant-budget') || {}).value || 0);
      var skinVal = (document.getElementById('assistant-skin') || {}).value || '';
      var activeVal = (document.getElementById('assistant-active') || {}).value || '';
      var fragFree = Boolean((document.getElementById('assistant-fragrance-free') || {}).checked);
      var lowestMl = Boolean((document.getElementById('assistant-lowest-ml') || {}).checked);
      var btn = document.getElementById('assistant-submit');
      var out = document.getElementById('assistant-results');
      if (!q.trim() || !out) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Analyzing fit & trade-offs...'; }
      out.style.display = 'block';
      out.innerHTML = '<div style="font-size:0.88rem;color:#94a3b8;">Matching verified products to your preferences...</div>';
      try {
        var res = await fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queryOrUrl: q.trim(),
            preferences: {
              maxBudgetINR: budgetVal > 0 ? budgetVal : undefined,
              skinType: skinVal || undefined,
              activeIngredient: activeVal || undefined,
              fragranceFree: fragFree,
              prioritizeLowestPricePerMl: lowestMl
            }
          })
        });
        var json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Request failed');
        var d = json.data;
        var recs = Array.isArray(d.recommendations) ? d.recommendations : [];
        var cardsHtml = recs.map(function(r) {
          var badgeBg = r.slot === 'BEST_MATCH' ? 'rgba(16,185,129,0.16);color:#34d399;border-color:rgba(16,185,129,0.4)' : (r.slot === 'BEST_VALUE' ? 'rgba(6,182,212,0.16);color:#38bdf8;border-color:rgba(6,182,212,0.4)' : 'rgba(148,163,184,0.16);color:#cbd5e1;border-color:rgba(148,163,184,0.35)');
          var unverifiedHtml = (r.unverifiedRequirements && r.unverifiedRequirements.length > 0)
            ? '<div style="margin-top:0.45rem;font-size:0.78rem;color:#fbbf24;"><strong>Note:</strong> ' + escHtml(r.unverifiedRequirements.join(' ')) + '</div>'
            : '';
          var ytHtml = (r.youtubeReviews && r.youtubeReviews.length > 0)
            ? '<div style="margin-top:0.5rem;font-size:0.78rem;color:#38bdf8;">Creator review: ' + r.youtubeReviews.map(function(v) {
                return '<a href="' + escHtml(v.videoUrl) + '" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;">' + escHtml(v.title) + '</a>';
              }).join(' · ') + '</div>'
            : '';
          return '<article class="feature-item" style="display:flex;flex-direction:column;justify-content:space-between;gap:0.65rem;">' +
            '<div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.45rem;">' +
                '<span style="font-size:0.74rem;font-weight:700;padding:0.2rem 0.55rem;border-radius:999px;border:1px solid;background:' + badgeBg + ';">' + escHtml(r.slotLabel) + '</span>' +
                '<span style="font-size:0.72rem;color:#94a3b8;">#Affiliate</span>' +
              '</div>' +
              '<h3 style="font-size:0.98rem;color:#fff;margin-bottom:0.35rem;">' + escHtml(r.title) + '</h3>' +
              '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:baseline;margin-bottom:0.5rem;">' +
                '<span style="font-size:1.25rem;font-weight:800;color:#fff;">₹' + Number(r.effectivePriceINR || r.currentPriceINR || 0).toLocaleString('en-IN') + '</span>' +
                (r.unitVolumeMl ? '<span style="font-size:0.75rem;color:#cbd5e1;">' + escHtml(r.unitVolumeMl) + ' ml</span>' : '') +
                (r.pricePerMlINR ? '<span style="font-size:0.75rem;color:#67e8f9;font-weight:700;">₹' + Number(r.pricePerMlINR).toFixed(2) + '/ml</span>' : '') +
              '</div>' +
              '<p style="font-size:0.82rem;color:#e2e8f0;margin-bottom:0.4rem;"><strong>Why it fits:</strong> ' + escHtml(r.matchReasoning) + '</p>' +
              '<p style="font-size:0.8rem;color:#94a3b8;"><strong>Trade-off:</strong> ' + escHtml(r.tradeOffs) + '</p>' +
              unverifiedHtml +
              ytHtml +
            '</div>' +
            '<div style="padding-top:0.55rem;border-top:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">' +
              '<span style="font-size:0.72rem;color:#94a3b8;">' + escHtml(r.disclosure) + '</span>' +
              '<a href="' + escHtml(r.trackingRedirectUrl) + '" target="_blank" rel="sponsored noopener noreferrer" data-deal-id="' + escHtml(r.dealId) + '" data-slot="' + escHtml(r.slot) + '" onclick="trackRecClick(this.dataset.dealId,this.dataset.slot)" class="btn btn-primary" style="padding:0.48rem 0.85rem;font-size:0.8rem;">' + escHtml(r.ctaLabel) + '</a>' +
            '</div>' +
          '</article>';
        }).join('');
        var modeLabel = d.analysisLabel ? String(d.analysisLabel) : (d.analysisMode === 'GEMINI_AI' ? 'Gemini AI Analysis' : 'Rule-Based Match (Deterministic Fallback)');
        var modeColor = d.analysisMode === 'GEMINI_AI' ? '#38bdf8' : '#94a3b8';
        out.innerHTML =
          '<div style="background:#090d16;border:1px solid #1e293b;border-radius:12px;padding:1rem;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.4rem;">' +
              '<div style="font-size:0.84rem;color:#cbd5e1;">' + escHtml(d.verdictSummary) + '</div>' +
              '<span style="font-size:0.7rem;font-weight:600;color:' + modeColor + ';border:1px solid #1e293b;border-radius:999px;padding:0.15rem 0.6rem;">' + escHtml(modeLabel) + '</span>' +
            '</div>' +
            (d.aiBuyerNote ? '<div style="font-size:0.86rem;color:#38bdf8;margin-bottom:0.85rem;"><strong>Assistant Note:</strong> ' + escHtml(d.aiBuyerNote) + '</div>' : '') +
            (recs.length > 0 ? '<div class="grid-2">' + cardsHtml + '</div>' : '<div style="font-size:0.86rem;color:#94a3b8;">No matching verified products found for those exact filters. Try broadening your budget or ingredient query.</div>') +
          '</div>';
      } catch (err) {
        out.innerHTML = '<div style="font-size:0.85rem;color:#f87171;">Error: ' + escHtml(err.message || 'Check failed') + '</div>';
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Find Best Matches →'; }
      }
    }
  </script>
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
  <meta name="robots" content="noindex, nofollow">
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
      padding: 0.7rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.45rem 0.85rem;
    }
    .brand { font-weight: 800; font-size: 0.95rem; color: #fff; text-decoration: none; white-space: nowrap; }
    .nav-links { display: flex; gap: 0.55rem 0.9rem; align-items: center; flex-wrap: wrap; max-width: 100%; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.83rem; font-weight: 600; white-space: nowrap; }
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
