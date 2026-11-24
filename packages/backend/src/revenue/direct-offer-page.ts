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
   * Public server-rendered homepage (GET /) positioning SiteFix Launch Gate (Pre-Deployment Website QA:
   * Web Scanner, npx CLI, GitHub Action, Isolated Public MCP) alongside Verified Consumer Deals
   * & Universal Fair-Price Checker. Zero legacy healthcare/dental clinic demo copy.
   */
  public renderHomepageHtml(config: Partial<OfferPageConfig> = {}): string {
    const siteName = config.siteName || (process.env.PUBLIC_SITE_NAME || 'SiteFix AI').trim();
    const siteUrl = config.siteUrl || (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').trim();
    const contactEmail = config.contactEmail || (process.env.PUBLIC_CONTACT_EMAIL ? process.env.PUBLIC_CONTACT_EMAIL.trim() : null);
    const {
      cuelinksVerificationCode: cuelinksCode = '',
      googleSiteVerification: googleCode = ''
    } = resolveVerificationTokens(config);
    const verificationMetaHtml = [
      cuelinksCode ? `  <meta name="cuelinks-verification" content="${escapeMetaAttr(cuelinksCode)}" />` : '',
      googleCode ? `  <meta name="google-site-verification" content="${escapeMetaAttr(googleCode)}" />` : ''
    ].filter(Boolean).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteFix Launch Gate — Pre-Deployment Website QA &amp; Verified Deals | ${escapeHtmlText(siteName)}</title>
  <meta name="description" content="Deterministic pre-deployment website QA for developers and founders. Inspect HTML metadata, Open Graph, Schema.org JSON-LD, robots.txt, and sitemap.xml via Web UI, npx CLI, GitHub Action, or Public MCP.">
  <link rel="canonical" href="${escapeMetaAttr(siteUrl)}/">
  <link rel="alternate" type="application/rss+xml" title="Verified Commercial Deals RSS Feed" href="/feeds/deals.xml">
  <meta name="robots" content="index, follow">
${verificationMetaHtml ? verificationMetaHtml + '\n' : ''}  <style>
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
    .hero { text-align: center; margin-bottom: 3rem; }
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
      font-size: 2.45rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.1rem;
      color: var(--text-muted);
      max-width: 760px;
      margin: 0 auto 1.75rem auto;
    }
    .cta-group { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.4rem;
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
    .card h2 { font-size: 1.35rem; color: #fff; margin-bottom: 1rem; }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.25rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    .feature-item {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .feature-item h3 { font-size: 1.05rem; color: #fff; margin-bottom: 0.5rem; }
    .feature-item p { font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; }
    .code-box {
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 0.75rem 0.9rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.82rem;
      color: #38bdf8;
      overflow-x: auto;
      margin-top: 0.75rem;
    }
    .sample-badge {
      background: rgba(6, 182, 212, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(6, 182, 212, 0.3);
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
    <a href="/" class="brand">${escapeHtmlText(siteName)}</a>
    <div class="nav-links">
      <a href="/" class="active">SiteFix Launch Gate</a>
      <a href="/tools/site-audit">Free Website Audit</a>
      <a href="/offer">Commercial Spec</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/deals">Verified Deals</a>
      <a href="/guides/student-flight-discounts-india">Travel Guides</a>
    </div>
  </nav>

  <div class="container">
    <header class="hero">
      <div class="status-badge">SiteFix Launch Gate • Deterministic Pre-Deployment Website QA</div>
      <h1>Catch Broken Metadata, Schema &amp; Crawl Defects Before You Ship</h1>
      <p class="subtitle">
        Run a deterministic technical launch check on any public URL via Web UI, zero-install <code>npx</code> CLI, GitHub Action, or Public MCP. Upgrade to the copy-paste Fix-Pack + included verification recheck only when defects are found.
      </p>
      <div class="cta-group">
        <a href="/tools/site-audit" class="btn btn-primary">Run Free Website Audit &rarr;</a>
        <a href="#launch-interfaces" class="btn btn-secondary">CLI, GitHub Action &amp; MCP</a>
      </div>
    </header>

    <!-- Section 1: Three Free Pull Interfaces -->
    <div class="card" id="launch-interfaces" style="border-color: #06b6d4; background: linear-gradient(180deg, #111827 0%, #0b1120 100%);">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
        <h2 style="margin: 0;">SiteFix Launch Gate — 3 Developer Pull Interfaces</h2>
        <span class="sample-badge">Canonical SKU: SITEFIX_AI_PACK_V1</span>
      </div>
      <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Every interface runs the same SSRF-protected deterministic engine checking HTML <code>&lt;head&gt;</code> metadata, Open Graph social cards, <code>Schema.org</code> JSON-LD syntax and fields, <code>robots.txt</code>, <code>sitemap.xml</code>, and security headers — with zero ranking guarantees and zero guesswork.
      </p>
      <div class="grid-3">
        <div class="feature-item">
          <h3 style="color: #38bdf8;">1. Zero-Install CLI</h3>
          <p>Audit any staging or production URL from your terminal or CI pipeline and optionally fail builds on critical launch defects.</p>
          <div class="code-box">npx sitefix-check https://your-site.com --confirm-authorized --fail-on-critical</div>
        </div>
        <div class="feature-item">
          <h3 style="color: #34d399;">2. Free GitHub Action</h3>
          <p>Drop SiteFix Launch Gate into pull requests or deploy workflows to publish Markdown pass/fail evidence tables in <code>$GITHUB_STEP_SUMMARY</code>.</p>
          <div class="code-box">uses: harshavardhankotu/ai-marketing-organization@main</div>
        </div>
        <div class="feature-item">
          <h3 style="color: #a78bfa;">3. Isolated Public MCP</h3>
          <p>Connect coding agents (Claude Code, Cursor, Codex) to the strictly isolated public Streamable HTTP MCP server exposing 3 safe SiteFix tools.</p>
          <div class="code-box">POST ${escapeHtmlText(siteUrl)}/api/v1/public/mcp</div>
        </div>
      </div>
      <div style="display: flex; gap: 0.85rem; flex-wrap: wrap; margin-top: 1.35rem;">
        <a href="/tools/site-audit" class="btn btn-primary" style="font-size: 0.9rem;">Open Web Scanner &rarr;</a>
        <a href="/.well-known/mcp.json" class="btn btn-secondary" style="font-size: 0.85rem;">View /.well-known/mcp.json</a>
        <a href="/audit/attagalatta.com" class="btn btn-secondary" style="font-size: 0.85rem;">Sample Audit: attagalatta.com</a>
        <a href="/audit/roasterycoffee.co.in" class="btn btn-secondary" style="font-size: 0.85rem;">Sample Audit: roasterycoffee.co.in</a>
      </div>
    </div>

    <!-- Section 2: Commercial Deals & Buyer Guides (Consumer Shopper Journey) -->
    <div class="card" id="consumer-deals" style="border-color: #334155; background: #0b1120;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
        <h2 style="font-size: 1.3rem; color: #fff; margin: 0;">Commercial Consumer Deals &amp; Buying Guides — Observed Merchant Price Snapshots (#Ad)</h2>
        <span class="sample-badge">#Ad — Affiliate Links</span>
      </div>
      <p style="color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.25rem;">
        Listed prices and reference MRPs are merchant-reported snapshots observed at a specific timestamp, may change at any time, and must be confirmed directly on the official merchant checkout page:
      </p>
      <div style="display: flex; gap: 0.85rem; flex-wrap: wrap; margin-bottom: 1.25rem;">
        <a href="/deals" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Indian Commercial Deals Directory &rarr;
        </a>
        <a href="/best/audio-and-earbuds-under-2000" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Best Audio &amp; Earbuds Under ₹2,000 &rarr;
        </a>
        <a href="/best/soundbars-and-speakers-under-10000" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Best Soundbars Under ₹10,000 &rarr;
        </a>
        <a href="/best/grooming-and-perfume-bundles-under-1000" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Grooming &amp; Perfume Bundles Under ₹1,000 &rarr;
        </a>
        <a href="/best/top-price-drops-today-india" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Top Price Drops Today (India) &rarr;
        </a>
        <a href="/compare/electronics-technology" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Electronics &amp; Tech Buying Guide &rarr;
        </a>
        <a href="/guides/best-wireless-audio-smartwatches-india" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Audio &amp; Smartwatch Guide &rarr;
        </a>
        <a href="/guides/student-flight-discounts-india" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Student Flight Discounts &rarr;
        </a>
        <a href="/revenue" style="background: #111827; border: 1px solid #1e293b; padding: 0.7rem 1.05rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.86rem; font-weight: 600;">
          Public Revenue Funnel &rarr;
        </a>
      </div>

      <!-- Universal Fair-Price Checker & On-Demand Link Monetizer -->
      <div id="fair-price-widget-home" style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.25rem; margin-bottom: 1.25rem;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
          <h3 style="margin: 0; font-size: 1.05rem; color: #f8fafc;">Universal Fair-Price Checker &amp; Link Monetizer</h3>
          <span style="font-size: 0.75rem; color: #94a3b8;">Observed MRP · Coupon Stacking · Amazon.in &amp; Cuelinks</span>
        </div>
        <p style="font-size: 0.84rem; color: #94a3b8; margin-bottom: 0.9rem;">
          Paste any Indian product URL (Amazon.in, D2C store) or type what you want to buy (e.g. <em>best ANC earbuds under 2000</em>) to check true fair value before paying full MRP.
        </p>
        <form onsubmit="handleFairPriceHome(event)" style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
          <input type="text" id="fp-query-home" required placeholder="Paste https://amazon.in/dp/... or search e.g. wireless earbuds under 2000" style="flex: 1 1 260px; padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid #334155; background: #090d16; color: #fff; font-size: 0.88rem;">
          <button type="submit" id="fp-submit-home" class="btn btn-primary" style="padding: 0.65rem 1.15rem; font-size: 0.86rem;">Check Fair Price</button>
        </form>
        <div id="fp-result-home" style="display: none; margin-top: 1rem;"></div>
      </div>
      ${Array.isArray(config.featuredDeals) && config.featuredDeals.length > 0 ? (() => {
        const dealCta = config.dealCtaAssignment || {
          experimentId: 'exp_storefront_deal_cta',
          variant: 'baseline' as const,
          ctaText: 'Buy at Merchant →'
        };
        const activeFeatured = config.featuredDeals.filter((d: any) => d && d.catalogSlot !== 'ROTATED_OUT_STALE' && d.evidenceJson?.catalogSlot !== 'ROTATED_OUT_STALE').slice(0, 4);
        if (activeFeatured.length === 0) return '';
        return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.9rem; margin-bottom: 1.25rem;" id="featured-deals-grid">
        ${activeFeatured.map((deal: any) => {
          const slug = deal.slug || deal.canonicalSlug || deal.id;
          const detailUrl = `/deals/${encodeURIComponent(String(slug))}`;
          const outUrl = `${siteUrl}/api/v1/public/deals/${encodeURIComponent(String(deal.id))}/redirect?ab_exp=${encodeURIComponent(dealCta.experimentId)}&ab_variant=${encodeURIComponent(dealCta.variant)}`;
          const amazonRailUrl = `${siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(deal.title || '').slice(0, 120))}&dealId=${encodeURIComponent(String(deal.id || ''))}`;
          const priceLabel = Number(deal.currentPriceINR || 0) > 0
            ? `₹${Number(deal.currentPriceINR).toLocaleString('en-IN')}`
            : 'Verified Offer';
          return `
          <div style="background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem;">
            <div>
              <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 700; text-transform: uppercase; margin-bottom: 0.35rem;">${escapeMetaAttr(String(deal.brand || deal.merchant || 'Verified'))} &bull; ${escapeMetaAttr(String(deal.category || 'Deals'))}</div>
              <a href="${escapeMetaAttr(detailUrl)}" style="color: #fff; font-weight: 700; font-size: 0.92rem; text-decoration: none; display: block; margin-bottom: 0.45rem;">${escapeMetaAttr(String(deal.title || ''))}</a>
              <div style="font-size: 1.1rem; font-weight: 800; color: #34d399;">${priceLabel}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.4rem;">
              <a href="${escapeMetaAttr(outUrl)}" target="_blank" rel="sponsored nofollow noopener" data-ab-experiment="${escapeMetaAttr(dealCta.experimentId)}" data-ab-variant="${escapeMetaAttr(dealCta.variant)}" style="display: inline-block; text-align: center; background: #06b6d4; color: #020617; font-weight: 700; font-size: 0.8rem; padding: 0.45rem 0.75rem; border-radius: 6px; text-decoration: none;">${escapeMetaAttr(dealCta.ctaText)}</a>
              <a href="${escapeMetaAttr(amazonRailUrl)}" target="_blank" rel="sponsored nofollow noopener" style="display: inline-block; text-align: center; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); color: #fcd34d; font-weight: 600; font-size: 0.73rem; padding: 0.38rem 0.6rem; border-radius: 6px; text-decoration: none;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
            </div>
          </div>`;
        }).join('')}
      </div>`;
      })() : ''}
      <p style="font-size: 0.78rem; color: #64748b; line-height: 1.4;">
        #Ad — Qualifying purchases made through outgoing affiliate links may earn a referral commission at zero additional cost to you. Offer prices, stock availability, and terms reflect merchant-reported snapshots and are subject to change without notice.
      </p>
    </div>
  </div>

  <footer>
    <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)}. All rights reserved.</p>
    <p style="margin-top: 0.5rem; max-width: 780px; margin-left: auto; margin-right: auto; line-height: 1.5; color: #64748b; font-size: 0.8rem;">
      <strong>#Ad Statutory Affiliate Disclosure &amp; Commercial Terms:</strong> Consumer buying guides and commercial deal directories on this platform may contain tracked affiliate links to authorized partner programs. When visitors make qualifying purchases through those links, we may receive an affiliate commission at zero additional cost to the purchaser. Always verify live pricing and terms on the merchant's checkout page. SiteFix Launch Gate technical diagnostics are deterministic checks with zero ranking guarantees.
    </p>
    <p style="margin-top: 0.75rem;">
      <a href="/privacy">Privacy Policy</a> • <a href="/revenue">Revenue Funnel</a> • <a href="/offer">Commercial Spec</a> • <a href="/tools/site-audit">SiteFix Audit</a> • <a href="/deals">Deals</a> • <a href="/public/disclosure">Affiliate Disclosure</a>${contactEmail ? ` • Contact: <a href="mailto:${escapeMetaAttr(contactEmail)}">${escapeHtmlText(contactEmail)}</a>` : ''}
    </p>
  </footer>

  <script>
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function handleFairPriceHome(e) {
      e.preventDefault();
      var qInput = document.getElementById('fp-query-home');
      var btn = document.getElementById('fp-submit-home');
      var box = document.getElementById('fp-result-home');
      if (!qInput || !box) return;
      var q = qInput.value.trim();
      if (!q) return;
      btn.disabled = true;
      btn.innerText = 'Checking...';
      box.style.display = 'block';
      box.innerHTML = '<div style="font-size:0.84rem;color:#94a3b8;">Checking observed Indian market prices and active coupon codes...</div>';
      try {
        var res = await fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queryOrUrl: q })
        });
        var json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || json.error || 'Check failed');
        }
        var d = json.data;
        var verdictColor = d.verdict === 'BUY_NOW_BELOW_FAIR_PRICE' ? '#34d399' : (d.verdict === 'OVERPRICED_WAIT_FOR_DROP' ? '#f59e0b' : '#38bdf8');
        var verdictLabel = d.verdict === 'BUY_NOW_BELOW_FAIR_PRICE'
          ? 'BUY NOW — BELOW FAIR PRICE'
          : (d.verdict === 'OVERPRICED_WAIT_FOR_DROP'
            ? 'OVERPRICED — WAIT OR COMPARE'
            : (d.verdict === 'INSUFFICIENT_HISTORY' ? 'INSUFFICIENT HISTORY — SET DROP ALERT' : 'FAIR MARKET PRICE — APPLY COUPON'));
        var optionsHtml = (d.crossStoreOptions || []).slice(0, 5).map(function(opt) {
          var isAmz = opt.affiliateNetwork === 'AMAZON_IN' || opt.isAmazonSearchRail || Number(opt.effectivePriceINR || 0) <= 0;
          var badge = opt.isLowestPrice ? ' <strong style="color:#34d399;">(Lowest Net)</strong>' : '';
          var coupon = opt.couponCode ? ' · Code: <code>' + escapeHtml(opt.couponCode) + '</code>' : '';
          var priceTxt = isAmz ? 'Live on Amazon.in' : ('₹' + Number(opt.effectivePriceINR || opt.currentPriceINR || 0).toLocaleString('en-IN'));
          var btnTxt = opt.ctaLabel || (isAmz ? "Check Today's Live Price & Prime Coupons on Amazon.in →" : 'Buy (#Ad) →');
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;padding:0.55rem 0;border-top:1px solid #1e293b;font-size:0.83rem;">' +
            '<div style="min-width:0;"><div style="color:#f8fafc;font-weight:600;">' + escapeHtml(opt.title) + badge + '</div>' +
            '<div style="color:#94a3b8;font-size:0.76rem;">' + escapeHtml(opt.merchant) + coupon + ' · ' + escapeHtml(opt.disclosure || '#Ad') + '</div></div>' +
            '<div style="display:flex;align-items:center;gap:0.65rem;flex-shrink:0;">' +
              '<span style="font-weight:700;color:#fff;">' + escapeHtml(priceTxt) + '</span>' +
              '<a href="' + escapeHtml(opt.trackingRedirectUrl) + '" target="_blank" rel="sponsored nofollow noopener" style="background:' + (isAmz ? '#f59e0b' : '#06b6d4') + ';color:#020617;padding:0.35rem 0.7rem;border-radius:6px;font-weight:700;font-size:0.76rem;text-decoration:none;">' + escapeHtml(btnTxt) + '</a>' +
            '</div></div>';
        }).join('');
        box.innerHTML =
          '<div style="background:#090d16;border:1px solid #1e293b;border-radius:10px;padding:1rem;">' +
            '<div style="font-size:0.75rem;font-weight:700;letter-spacing:0.04em;color:' + verdictColor + ';margin-bottom:0.3rem;">' + verdictLabel + '</div>' +
            '<div style="font-size:0.88rem;color:#e2e8f0;margin-bottom:0.5rem;">' + escapeHtml(d.verdictSummary || '') + '</div>' +
            (d.estimatedFairPriceINR ? '<div style="font-size:0.8rem;color:#94a3b8;margin-bottom:0.6rem;">Estimated Fair Price: <strong style="color:#fff;">₹' + Number(d.estimatedFairPriceINR).toLocaleString('en-IN') + '</strong> · Range: ₹' + Number(d.lowestObservedPriceINR || d.estimatedFairPriceINR).toLocaleString('en-IN') + ' – ₹' + Number(d.highestObservedPriceINR || d.estimatedFairPriceINR).toLocaleString('en-IN') + (d.activeCouponCode ? ' · Best Coupon: <code style="color:#38bdf8;">' + escapeHtml(d.activeCouponCode) + '</code>' : '') + '</div>' : '') +
            optionsHtml +
            '<form onsubmit="handleFairPriceAlertHome(event)" style="margin-top:0.85rem;padding-top:0.75rem;border-top:1px solid #1e293b;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">' +
              '<input type="number" id="fp-alert-price-home" min="1" required placeholder="Target ₹ price" value="' + (d.estimatedFairPriceINR ? Math.round(d.estimatedFairPriceINR * 0.9) : '') + '" style="width:120px;padding:0.45rem 0.65rem;border-radius:6px;border:1px solid #334155;background:#111827;color:#fff;font-size:0.8rem;">' +
              '<input type="email" id="fp-alert-email-home" required placeholder="Email for price-drop alert" style="flex:1 1 190px;padding:0.45rem 0.65rem;border-radius:6px;border:1px solid #334155;background:#111827;color:#fff;font-size:0.8rem;">' +
              '<label style="font-size:0.74rem;color:#cbd5e1;display:flex;align-items:center;gap:0.35rem;cursor:pointer;"><input type="checkbox" id="fp-alert-consent-home" required> Opt-in alerts (DPDP)</label>' +
              '<button type="submit" style="background:#10b981;color:#020617;border:none;padding:0.45rem 0.85rem;border-radius:6px;font-weight:700;font-size:0.78rem;cursor:pointer;">Set Price Alert</button>' +
            '</form>' +
            '<div id="fp-alert-status-home" style="font-size:0.78rem;margin-top:0.4rem;"></div>' +
          '</div>';
      } catch (err) {
        box.innerHTML = '<div style="font-size:0.82rem;color:#f87171;">Error: ' + escapeHtml(err.message || 'Could not evaluate fair price') + '</div>';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Check Fair Price';
      }
    }

    async function handleFairPriceAlertHome(e) {
      e.preventDefault();
      var q = (document.getElementById('fp-query-home') || {}).value || '';
      var price = Number((document.getElementById('fp-alert-price-home') || {}).value || 0);
      var email = ((document.getElementById('fp-alert-email-home') || {}).value || '').trim();
      var consent = Boolean((document.getElementById('fp-alert-consent-home') || {}).checked);
      var statusEl = document.getElementById('fp-alert-status-home');
      if (!statusEl) return;
      statusEl.style.color = '#94a3b8';
      statusEl.innerText = 'Registering price-drop alert...';
      try {
        var res = await fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queryOrUrl: q, targetFairPriceINR: price, alertEmail: email, consentGiven: consent, skipAiSynthesis: true })
        });
        var json = await res.json();
        var reg = json && json.data && json.data.priceDropAlertRegistered;
        if (reg && reg.registered) {
          statusEl.style.color = '#34d399';
          statusEl.innerText = reg.immediateAlertDispatched
            ? 'Alert set & instant price-drop email sent to ' + reg.alertEmailMasked + '!'
            : 'Price-drop alert registered for ' + reg.alertEmailMasked + ' at target ₹' + Number(reg.targetFairPriceINR || price).toLocaleString('en-IN') + '.';
        } else {
          statusEl.style.color = '#fbbf24';
          statusEl.innerText = (reg && reg.reason) || json.message || 'Could not register alert.';
        }
      } catch (err) {
        statusEl.style.color = '#f87171';
        statusEl.innerText = 'Error: ' + (err.message || 'Failed');
      }
    }
  </script>
  ${renderCustomerDeskWidgetHtml('SITEFIX_AI_PACK_V1')}
</body>
</html>`;
  }

  /**
   * Safe, non-payment informational overview page shown when commercial terms are pending owner attestation.
   * Zero unconfirmed prices, zero guarantees, zero UPI VPAs, zero payment links.
   */
  private renderUnattestedOverviewHtml(siteName: string, siteUrl: string, contactEmail: string | null): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteFix AI Commercial Specification | Service Overview</title>
  <meta name="description" content="Technical overview of SiteFix Launch Gate website QA and optimization packs. Commercial configuration pending owner attestation.">
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
      --warning: #f59e0b;
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
    h1 { font-size: 2.1rem; font-weight: 800; color: #ffffff; margin-bottom: 0.85rem; }
    p.subtitle { font-size: 1.05rem; color: var(--text-muted); max-width: 680px; margin: 0 auto; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.75rem;
      margin-bottom: 1.5rem;
    }
    .card h2 { font-size: 1.3rem; color: #fff; margin-bottom: 0.9rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; }
    footer {
      text-align: center;
      margin-top: 2.5rem;
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
      <p style="color: #94a3b8; font-size: 0.88rem; margin-bottom: 0.75rem;">Direct online checkout is disabled until commercial terms are attested by the owner.</p>
      <h1>SiteFix Launch Gate — Technical Website QA</h1>
      <p class="subtitle">Deterministic pre-deployment HTML metadata, Open Graph, Schema.org JSON-LD, robots.txt, and sitemap.xml auditing for web teams.</p>
      <div style="margin-top: 1.25rem;">
        <a href="/tools/site-audit" class="btn btn-primary" style="display: inline-block; background: #06b6d4; color: #090d16; font-weight: 700; padding: 0.75rem 1.4rem; border-radius: 8px; text-decoration: none; font-size: 0.95rem;">Run Free Website Audit &amp; Technical Fix-Pack &rarr;</a>
      </div>
    </header>

    <div class="card">
      <h2>Technical Scope (Non-Payable Overview)</h2>
      <div class="grid-2">
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #38bdf8; font-size: 1.02rem; margin-bottom: 0.4rem;">1. Free Deterministic Launch Audit</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1;">Run instant SSRF-protected technical checks on any public URL via <a href="/tools/site-audit" style="color: #38bdf8;">/tools/site-audit</a>, <code>npx sitefix-check</code>, GitHub Action, or Public MCP.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #34d399; font-size: 1.02rem; margin-bottom: 0.4rem;">2. Owner-Attested Pricing Policy</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1;">Direct offer terms are cryptographically bound to <code>owner/DIRECT_OFFER.md</code> / <code>owner/OWN_OFFER.md</code> via SHA-256 attestation. Unattested or TBD specifications remain non-payable.</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Contact &amp; Verification</h2>
      <p style="color: #cbd5e1; font-size: 0.92rem;">
        ${contactEmail ? `For commercial verification inquiries, contact: <a href="mailto:${escapeMetaAttr(contactEmail)}" style="color: var(--accent);">${escapeHtmlText(contactEmail)}</a>` : 'Owner contact email is currently pending configuration.'}
      </p>
    </div>

    <footer>
      <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)}. All rights reserved.</p>
      <p style="margin-top: 0.35rem;">Technical overview page • Not an offer to contract until terms are owner-attested. • <a href="/privacy" style="color: var(--text-muted); text-decoration: underline;">Privacy Policy</a> • <a href="/tools/site-audit" style="color: var(--text-muted); text-decoration: underline;">SiteFix Audit</a> • <a href="/deals" style="color: var(--text-muted); text-decoration: underline;">Deals</a> • <a href="/revenue" style="color: var(--text-muted); text-decoration: underline;">Revenue Funnel</a></p>
    </footer>
  </div>
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
      <p>&copy; ${new Date().getFullYear()} ${escapeHtmlText(siteName)}. All rights reserved.</p>
      ${contactEmail ? `<p style="margin-top: 0.35rem;">Contact: <a href="mailto:${escapeMetaAttr(contactEmail)}" style="color: var(--accent);">${escapeHtmlText(contactEmail)}</a></p>` : ''}
    </footer>
  </div>
</body>
</html>`;
  }
}
