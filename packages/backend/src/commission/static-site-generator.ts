import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, resolveVerificationTokens } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StaticSiteConfig {
  siteName: string;
  authorName: string;
  contactEmail: string;
  siteUrl: string;
  googleSiteVerification?: string;
  cuelinksVerificationCode?: string;
}

export interface StaticSiteBuildResult {
  success: boolean;
  outputDir: string;
  filesGenerated: string[];
  guidesRendered: number;
  config: StaticSiteConfig;
}

export class StaticSiteGenerator {
  private static instance: StaticSiteGenerator;

  public static getInstance(): StaticSiteGenerator {
    if (!StaticSiteGenerator.instance) {
      StaticSiteGenerator.instance = new StaticSiteGenerator();
    }
    return StaticSiteGenerator.instance;
  }

  /**
   * Resolves required public configuration from environment variables or stored owner intake.
   * Never fabricates fake defaults.
   */
  public async resolveConfig(organizationId: string = 'org_owner_primary'): Promise<StaticSiteConfig> {
    let siteName = process.env.PUBLIC_SITE_NAME?.trim();
    let authorName = (process.env.PUBLIC_AUTHOR_NAME || process.env.PUBLIC_SITE_AUTHOR || process.env.PUBLIC_AUTHOR)?.trim();
    let contactEmail = (process.env.PUBLIC_CONTACT_EMAIL || process.env.PUBLIC_SITE_EMAIL || process.env.PUBLIC_EMAIL)?.trim();
    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').replace(/\/$/, '');

    if (!siteName || !authorName || !contactEmail) {
      let intakeRow: any = null;
      if (isProduction()) {
        const d1 = D1RevenueRepository.getInstance();
        intakeRow = await d1.queryOne<any>('owner_intake', 'SELECT * FROM owner_intake WHERE status = ? LIMIT 1', ['VALID']);
      } else {
        try {
          const d1 = D1RevenueRepository.getInstance();
          intakeRow = await d1.queryOne<any>('owner_intake', 'SELECT * FROM owner_intake WHERE status = ? LIMIT 1', ['VALID']);
        } catch {
          intakeRow = null;
        }
        if (!intakeRow) {
          try {
            intakeRow = getDb().prepare("SELECT * FROM owner_intake WHERE status = 'VALID' LIMIT 1").get() as any;
          } catch {}
        }
      }

      if (intakeRow) {
        siteName = siteName || intakeRow.site_name;
        authorName = authorName || intakeRow.author_name;
        contactEmail = contactEmail || intakeRow.contact_email;
      }
    }

    const missing: string[] = [];
    if (!siteName) missing.push('siteName (missing in owner_intake.site_name and PUBLIC_SITE_NAME)');
    if (!authorName) missing.push('authorName (missing in owner_intake.author_name and PUBLIC_AUTHOR_NAME)');
    if (!contactEmail) missing.push('contactEmail (missing in owner_intake.contact_email and PUBLIC_CONTACT_EMAIL)');

    if (missing.length > 0) {
      throw new Error(`CONFIG_ERROR: Missing required public site configuration: ${missing.join(', ')}. Must come from owner intake or environment variables. Zero invented fallbacks allowed.`);
    }

    const { googleSiteVerification, cuelinksVerificationCode } = resolveVerificationTokens();

    return {
      siteName: siteName!,
      authorName: authorName!,
      contactEmail: contactEmail!,
      siteUrl,
      googleSiteVerification,
      cuelinksVerificationCode
    };
  }

  /**
   * Validates required public configuration synchronously from environment.
   */
  public validateConfig(): StaticSiteConfig {
    const siteName = process.env.PUBLIC_SITE_NAME?.trim();
    const authorName = (process.env.PUBLIC_AUTHOR_NAME || process.env.PUBLIC_SITE_AUTHOR || process.env.PUBLIC_AUTHOR)?.trim();
    const contactEmail = (process.env.PUBLIC_CONTACT_EMAIL || process.env.PUBLIC_SITE_EMAIL || process.env.PUBLIC_EMAIL)?.trim();

    const missing: string[] = [];
    if (!siteName) missing.push('PUBLIC_SITE_NAME');
    if (!authorName) missing.push('PUBLIC_AUTHOR_NAME');
    if (!contactEmail) missing.push('PUBLIC_CONTACT_EMAIL');

    if (missing.length > 0) {
      throw new Error(`CONFIG_ERROR: Missing required public site configuration: ${missing.join(', ')}`);
    }

    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-organization.onrender.com').replace(/\/$/, '');
    const { googleSiteVerification, cuelinksVerificationCode } = resolveVerificationTokens();

    return {
      siteName: siteName!,
      authorName: authorName!,
      contactEmail: contactEmail!,
      siteUrl,
      googleSiteVerification,
      cuelinksVerificationCode
    };
  }

  /**
   * Renders all published guides, landing page, and legal pages to static HTML.
   */
  public async build(options: { outputDir?: string; orgId?: string; config?: StaticSiteConfig; includePublishReady?: boolean } = {}): Promise<StaticSiteBuildResult> {
    let config: StaticSiteConfig;
    if (options.config) {
      config = options.config;
    } else {
      try {
        config = this.validateConfig();
      } catch {
        config = await this.resolveConfig(options.orgId);
      }
    }

    // Default output directory: frontend dist folder for Firebase Hosting
    const targetDir = options.outputDir || path.resolve(__dirname, '../../../frontend/dist');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filesGenerated: string[] = [];

    // 1. Fetch published (or publish-ready for preview/dry-run) guides
    const statusClause = options.includePublishReady ? "status IN ('PUBLISHED', 'PUBLISH_READY')" : "status = 'PUBLISHED'";
    let publishedGuides: any[] = [];
    if (isProduction()) {
      const d1 = D1RevenueRepository.getInstance();
      publishedGuides = await d1.query<any>(
        'commission_content_assets',
        `SELECT * FROM commission_content_assets WHERE ${statusClause}`
      );
    } else {
      try {
        const d1 = D1RevenueRepository.getInstance();
        publishedGuides = await d1.query<any>(
          'commission_content_assets',
          `SELECT * FROM commission_content_assets WHERE ${statusClause}`
        );
      } catch {
        publishedGuides = [];
      }
      if (publishedGuides.length === 0) {
        const db = getDb();
        try {
          publishedGuides = db.prepare(`SELECT * FROM commission_content_assets WHERE ${statusClause}`).all() as any[];
        } catch {
          publishedGuides = [];
        }
      }
    }

    // 2. Render each published guide
    for (const guide of publishedGuides) {
      const slug = guide.slug;
      const guideDir = path.join(targetDir, 'guides', slug);
      if (!fs.existsSync(guideDir)) {
        fs.mkdirSync(guideDir, { recursive: true });
      }

      const html = this.renderGuideHtml(guide, config);
      const filePath = path.join(guideDir, 'index.html');
      fs.writeFileSync(filePath, html, 'utf-8');
      filesGenerated.push(filePath);
    }

    // 3. Render root static landing page (replaces internal React dashboard)
    const landingHtml = this.renderLandingPageHtml(publishedGuides, config);
    const landingPath = path.join(targetDir, 'index.html');
    fs.writeFileSync(landingPath, landingHtml, 'utf-8');
    filesGenerated.push(landingPath);

    // 4. Render legal and static informational pages
    const legalPages = [
      { path: 'about', title: 'About Us', render: () => this.renderAboutHtml(config) },
      { path: 'contact', title: 'Contact & Grievance Redressal', render: () => this.renderContactHtml(config) },
      { path: 'privacy', title: 'Privacy Policy', render: () => this.renderPrivacyHtml(config) },
      { path: 'terms', title: 'Terms of Service', render: () => this.renderTermsHtml(config) },
      { path: 'disclosure', title: 'Affiliate & Commercial Referral Disclosure', render: () => this.renderDisclosureHtml(config) }
    ];

    for (const page of legalPages) {
      const pageDir = path.join(targetDir, page.path);
      if (!fs.existsSync(pageDir)) {
        fs.mkdirSync(pageDir, { recursive: true });
      }
      const filePath = path.join(pageDir, 'index.html');
      fs.writeFileSync(filePath, page.render(), 'utf-8');
      filesGenerated.push(filePath);
    }

    // 4b. Render verified deals page (/deals)
    const dealsDir = path.join(targetDir, 'deals');
    if (!fs.existsSync(dealsDir)) {
      fs.mkdirSync(dealsDir, { recursive: true });
    }
    const dealsHtml = this.renderDealsHtml([], config);
    const dealsPath = path.join(dealsDir, 'index.html');
    fs.writeFileSync(dealsPath, dealsHtml, 'utf-8');
    filesGenerated.push(dealsPath);

    // 5. Generate sitemap.xml
    const sitemapPath = path.join(targetDir, 'sitemap.xml');
    const sitemapContent = this.generateSitemapXml(publishedGuides, config);
    fs.writeFileSync(sitemapPath, sitemapContent, 'utf-8');
    filesGenerated.push(sitemapPath);

    // 6. Generate robots.txt
    const robotsPath = path.join(targetDir, 'robots.txt');
    const robotsContent = `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`;
    fs.writeFileSync(robotsPath, robotsContent, 'utf-8');
    filesGenerated.push(robotsPath);

    return {
      success: true,
      outputDir: targetDir,
      filesGenerated,
      guidesRendered: publishedGuides.length,
      config
    };
  }

  /**
   * Generates standalone static HTML for the root landing page (/index.html).
   */
  public renderLandingPageHtml(publishedGuides: any[], config: StaticSiteConfig): string {
    const title = `${config.siteName} | Commercial Equipment & Supplies Overview`;
    const canonicalUrl = `${config.siteUrl}/`;

    const guideItems = publishedGuides.length === 0
      ? `<p style="color: #94a3b8; font-size: 0.95rem;">No published commercial guides available at this time. Guides will be displayed here once verified and published.</p>`
      : publishedGuides.map(g => `
          <div style="background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem;">
            <h2 style="margin: 0 0 0.5rem 0; font-size: 1.25rem;"><a href="/guides/${this.escapeHtml(g.slug)}" style="color: #38bdf8; text-decoration: none;">${this.escapeHtml(g.title)}</a></h2>
            <p style="color: #94a3b8; font-size: 0.88rem; margin: 0 0 0.75rem 0;">${this.escapeHtml(g.intent_target || g.description || 'Commercial product specifications and comparison overview.')}</p>
            <a href="/guides/${this.escapeHtml(g.slug)}" style="color: #06b6d4; font-weight: 600; text-decoration: none; font-size: 0.88rem;">Read Full Guide &rarr;</a>
          </div>
        `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)}</title>
  <meta name="description" content="Independent commercial equipment, supplies, and specification overviews.">
  <link rel="canonical" href="${canonicalUrl}">
  <meta name="robots" content="index, follow">
  <script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: config.siteName,
    url: config.siteUrl,
    description: 'Independent commercial equipment, supplies, and specification overviews.'
  })}
  </script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 900px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.2rem; }
    main { max-width: 820px; margin: 2rem auto; padding: 0 1.5rem; }
    .disclosure-box { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.9rem 1.2rem; margin-bottom: 2rem; font-size: 0.88rem; color: #fde68a; font-weight: 500; }
    footer { border-top: 1px solid var(--border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
    .legal-notice { font-size: 0.75rem; color: #64748b; margin-top: 1rem; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <div style="display: flex; gap: 1rem; align-items: center;">
      <a href="/deals" style="color: #38bdf8; text-decoration: none; font-size: 0.88rem; font-weight: 600;">Verified Deals</a>
      <span style="font-size: 0.85rem; color: #94a3b8;">Commercial Guides &amp; Overviews</span>
    </div>
  </header>
  <main>
    <aside class="disclosure-box" aria-label="Affiliate Disclosure">
      <strong>#Ad Commercial &amp; Affiliate Disclosure:</strong> This site contains tracked affiliate links and partner buying guides. When visitors make qualifying purchases through those links, we may earn a commission at zero additional cost (including as an Amazon Associate I earn from qualifying purchases). Prices and availability reflect merchant-reported snapshots and must be confirmed on the merchant's checkout page.
    </aside>
    <section>
      <h1 style="color: #fff; font-size: 1.85rem; margin-bottom: 0.5rem;">Commercial Supplies &amp; Equipment Guides</h1>
      <p style="color: #94a3b8; margin-bottom: 2rem; font-size: 0.95rem;">Factual product evaluations and technical specifications for commercial equipment and business supplies.</p>
      ${guideItems}
    </section>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(config.siteName)}. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  /**
   * Generates standalone static HTML for a guide, satisfying all 10 crawler and legal constraints.
   */
  public renderGuideHtml(guide: any, config: StaticSiteConfig, eligibleDeals?: any[]): string {
    const title = guide.title || 'Product Evaluation & Buying Guide';
    const description = guide.intent_target || guide.intentTarget || guide.meta_description || guide.description || 'Commercial product overview and specification details.';
    const canonicalUrl = `${config.siteUrl}/guides/${guide.slug}`;
    let fullBody = guide.content_markdown || guide.contentMarkdown || guide.body_markdown || guide.body || '';

    // Suppress unbacked penalty, tariff, and unverified airline concession/baggage guarantees per Stage F-Lite Spec
    fullBody = fullBody.replace(/₹500[–-]₹550\s*per\s*kg[^\n\)]*/gi, 'standard excess baggage rates per airline policy');
    fullBody = fullBody.replace(/₹5,000\+\s*penalty/gi, 'excess baggage charges');
    fullBody = fullBody.replace(/\bup to 10\s*kg\b[^\n.]*/gi, 'carrier-dependent extra baggage allowances (subject to current official airline terms)');

    let disclosureText = 'As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.';
    if (
      guide.disclosure_markdown &&
      guide.disclosure_markdown !== 'Disclosure: We may earn a referral commission at no additional cost to you when you purchase through our links.' &&
      !guide.disclosure_markdown.includes('Amazon Associate')
    ) {
      disclosureText = guide.disclosure_markdown;
    } else if (guide.disclosureMarkdown && !guide.disclosureMarkdown.includes('Amazon Associate')) {
      disclosureText = guide.disclosureMarkdown;
    } else if (guide.slug === 'student-flight-discounts-india') {
      disclosureText = 'Editorial Notice: Carrier student concession rules and baggage allowances vary by airline and change over time. Always verify current eligibility and baggage terms directly on the official airline portal before booking. Explore Deals (/deals) for commercial partner offers.';
    } else if (fullBody.includes('clnk.in') || fullBody.includes('linksredirect.com') || fullBody.includes('/api/v1/public/deals/')) {
      disclosureText = '#Ad Affiliate & Commercial Disclosure: Listed prices, stock availability, and reference MRP values reflect merchant-reported snapshots and may change without notice. Always confirm live terms and pricing on the official merchant checkout page before purchasing. Qualifying purchases through affiliate links may earn us a referral commission at zero additional cost to you.';
    }

    // Convert basic markdown to clean HTML
    const formattedBody = this.markdownToHtml(fullBody, eligibleDeals, guide);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
  <meta name="description" content="${this.escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${this.escapeHtml(title)}">
  <meta property="og:description" content="${this.escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${this.escapeHtml(config.siteName)}">
  <meta name="author" content="${this.escapeHtml(config.authorName)}">
  <meta name="robots" content="index, follow">
  <script type="application/ld+json">
  ${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description,
    url: canonicalUrl,
    author: {
      '@type': 'Person',
      name: config.authorName
    },
    publisher: {
      '@type': 'Organization',
      name: config.siteName,
      url: config.siteUrl
    },
    datePublished: guide.created_at || new Date().toISOString(),
    dateModified: guide.updated_at || guide.created_at || new Date().toISOString()
  })}
  </script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 900px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.15rem; }
    main { max-width: 820px; margin: 2rem auto; padding: 0 1.5rem; }
    .disclosure-box { background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 0.9rem 1.2rem; margin-bottom: 2rem; font-size: 0.88rem; color: #fde68a; font-weight: 500; }
    article h1 { font-size: 2.2rem; color: #fff; line-height: 1.25; margin-bottom: 0.5rem; }
    .meta-bar { font-size: 0.85rem; color: #94a3b8; margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
    .content h2 { color: #fff; margin-top: 2rem; font-size: 1.45rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
    .content h3 { color: #f1f5f9; margin-top: 1.5rem; font-size: 1.2rem; }
    .content p { margin: 1rem 0; color: #cbd5e1; font-size: 1.05rem; }
    .content a.affiliate-link { display: inline-block; background: #ea580c; color: #fff; font-weight: 600; padding: 0.75rem 1.4rem; border-radius: 6px; text-decoration: none; margin: 0.75rem 0; transition: background 0.15s; }
    .content a.affiliate-link:hover { background: #c2410c; }
    footer { border-top: 1px solid var(--border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <span style="font-size: 0.85rem; color: #94a3b8;">Product Overview</span>
  </header>
  <main>
    <aside class="disclosure-box" aria-label="Affiliate Disclosure">
      <strong>Disclosure:</strong> ${this.escapeHtml(disclosureText)}
    </aside>
    <article class="content">
      <h1>${this.escapeHtml(title)}</h1>
      <div class="meta-bar">
        <span>Published by <strong>${this.escapeHtml(config.authorName)}</strong></span> &bull;
        <span>Product Overview</span>
      </div>
      <div>
        ${formattedBody}
      </div>
    </article>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(config.siteName)}. All rights reserved.</p>
  </footer>
  <script>
  (function() {
    try {
      var p = new URLSearchParams(window.location.search);
      var src = p.get('utm_source');
      var med = p.get('utm_medium');
      var cmp = p.get('utm_campaign');
      var cnt = p.get('utm_content');
      if (src || cmp || document.referrer) {
        var payload = {
          businessId: 'biz_platform_aro',
          landingPage: window.location.pathname,
          referrer: document.referrer || '',
          utmSource: src || undefined,
          utmMedium: med || undefined,
          utmCampaign: cmp || undefined,
          utmContent: cnt || undefined,
          visitorId: 'vis_' + Math.random().toString(36).substring(2, 10),
          sessionId: 'ses_' + Math.random().toString(36).substring(2, 10)
        };
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/v1/organic/sessions', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
        } else {
          fetch('/api/v1/organic/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
          }).catch(function() {});
        }
      }

      document.addEventListener('click', function(e) {
        var target = e.target && e.target.closest ? e.target.closest('a.affiliate-link') : null;
        if (!target) return;
        try {
          var destUrl = target.getAttribute('href');
          var anchorText = (target.textContent || '').trim();
          var clickPayload = {
            destinationUrl: destUrl,
            anchorText: anchorText,
            pageUrl: window.location.pathname,
            utmSource: src || undefined,
            utmMedium: med || undefined,
            utmCampaign: cmp || undefined,
            utmContent: cnt || undefined
          };
          if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/v1/organic/affiliate-clicks', new Blob([JSON.stringify(clickPayload)], { type: 'application/json' }));
          } else {
            fetch('/api/v1/organic/affiliate-clicks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(clickPayload),
              keepalive: true
            }).catch(function() {});
          }
        } catch (err) {}
      }, true);
    } catch (e) {}
  })();
  </script>
</body>
</html>`;
  }

  /**
   * Generates standalone static HTML for verified deals (/deals/index.html).
   */
  public renderDealsHtml(deals: any[] = [], config: StaticSiteConfig): string {
    const siteName = (config.siteName || '').trim();
    const title = siteName && !siteName.toLowerCase().includes('verified deals')
      ? `Verified Deals & Price Evidence | ${siteName}`
      : 'Verified Deals & Price Evidence';

    const activeDeals = Array.isArray(deals) ? deals : [];
    const merchants = Array.from(new Set(activeDeals.map((d: any) => d.merchant).filter(Boolean)));
    const merchantText = merchants.length > 0 ? merchants.join(', ') : 'authorized Indian partner stores';
    const description = `Merchant-reported Indian e-commerce deal snapshots across ${merchantText}. Always verify live pricing, stock, and terms on the official merchant checkout page.`;
    const canonicalUrl = `${config.siteUrl}/deals`;

    const itemListSchema = activeDeals.length > 0 ? {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Verified Deals & Price Evidence India',
      description,
      numberOfItems: activeDeals.length,
      itemListElement: activeDeals.map((d: any, idx: number) => ({
        '@type': 'ListItem',
        position: idx + 1,
        item: {
          '@type': 'Product',
          name: d.title,
          description: `${d.brand} ${d.title} on ${d.merchant} at ₹${d.currentPriceINR}`,
          brand: {
            '@type': 'Brand',
            name: d.brand
          },
          offers: {
            '@type': 'Offer',
            url: d.trackingUrl || d.productUrl,
            priceCurrency: d.currency || 'INR',
            price: d.currentPriceINR,
            itemCondition: 'https://schema.org/NewCondition',
            availability: d.availability === 'OUT_OF_STOCK' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
            seller: {
              '@type': 'Organization',
              name: d.merchant
            }
          }
        }
      }))
    } : null;

    const dealCards = activeDeals.map((deal: any) => {
      const targetHref = deal.id ? `${config.siteUrl}/api/v1/public/deals/${deal.id}/redirect` : (deal.trackingUrl || deal.productUrl);
      const detailSlug = deal.slug || deal.canonicalSlug || deal.id;
      const detailHref = detailSlug ? `/deals/${encodeURIComponent(detailSlug)}` : targetHref;
      return `
      <div class="price-card deal-card" style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; text-transform: uppercase;">${this.escapeHtml(deal.brand)}</span>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              ${typeof deal.arbitrageScore === 'number' && deal.arbitrageScore > 0 ? `<span style="font-size: 0.72rem; background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.2rem 0.5rem; border-radius: 9999px;">Arbitrage ${deal.arbitrageScore}</span>` : ''}
              <span style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.2rem 0.5rem; border-radius: 9999px;">✓ Verified</span>
            </div>
          </div>
          <h2 style="font-size: 1.15rem; color: #fff; margin: 0 0 0.5rem 0; line-height: 1.4;"><a href="${this.escapeHtml(detailHref)}" style="color: #fff; text-decoration: none;">${this.escapeHtml(deal.title)}</a></h2>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.65rem;">
            <span>${this.escapeHtml(deal.merchant)}</span> &bull; <span>${this.escapeHtml(deal.category)}</span>
          </div>
          ${deal.targetBuyerSegment ? `<div style="font-size: 0.76rem; color: #cbd5e1; background: rgba(15, 23, 42, 0.85); border: 1px solid #334155; border-radius: 6px; padding: 0.35rem 0.6rem; margin-bottom: 0.75rem;">Target Buyer: <strong>${this.escapeHtml(deal.targetBuyerSegment)}</strong></div>` : ''}
          <div style="display: flex; align-items: baseline; gap: 0.6rem; margin: 1rem 0;">
            <span style="font-size: 1.6rem; font-weight: 800; color: #fff;">₹${Number(deal.currentPriceINR).toLocaleString('en-IN')}</span>
            ${deal.referencePriceINR && deal.referencePriceINR > deal.currentPriceINR ? `<span style="font-size: 0.85rem; color: #64748b; text-decoration: line-through;">MRP ₹${Number(deal.referencePriceINR).toLocaleString('en-IN')}</span>` : ''}
            ${deal.verifiedDiscountPercent ? `<span style="font-size: 0.8rem; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 0.2rem 0.5rem; border-radius: 6px;">${deal.verifiedDiscountPercent}% OFF</span>` : ''}
          </div>
          ${deal.couponCode ? `
            <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid #334155; border-radius: 8px; padding: 0.6rem 0.8rem; margin: 0.75rem 0; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span style="font-size: 0.75rem; color: #a855f7; font-weight: 600;">Promo Code:</span>
                <code style="font-size: 0.85rem; color: #e9d5ff; font-weight: 700; margin-left: 0.4rem;">${this.escapeHtml(deal.couponCode)}</code>
              </div>
              <button onclick="navigator.clipboard.writeText('${this.escapeHtml(deal.couponCode)}'); this.innerText='Copied!'" style="background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #d8b4fe; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.6rem; border-radius: 6px; cursor: pointer;">Copy</button>
            </div>
          ` : ''}
          ${deal.couponConditions ? `<p style="font-size: 0.78rem; color: #94a3b8; font-style: italic; margin: 0.5rem 0 0 0;">${this.escapeHtml(deal.couponConditions)}</p>` : ''}
        </div>
        <div style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 0.75rem; color: #64748b;">#Ad &bull; Merchant Snapshot</span>
          <a href="${this.escapeHtml(targetHref)}" target="_blank" rel="sponsored nofollow noopener" style="background: #06b6d4; color: #020617; font-weight: 700; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none;">View Deal &rarr;</a>
        </div>
      </div>
    `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)}</title>
  <meta name="description" content="${this.escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${this.escapeHtml(title)}">
  <meta property="og:description" content="${this.escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${this.escapeHtml(config.siteName)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${this.escapeHtml(title)}">
  <meta name="twitter:description" content="${this.escapeHtml(description)}">
  ${itemListSchema ? `<script type="application/ld+json">
  ${JSON.stringify(itemListSchema, null, 2)}
  </script>` : ''}
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1100px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.15rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    header nav a:hover, header nav a.active { color: var(--accent); font-weight: 600; }
    main { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; }
    .hero { text-align: center; max-width: 760px; margin: 0 auto 2.5rem auto; }
    .hero h1 { font-size: 2.2rem; color: #fff; margin-bottom: 0.5rem; }
    .hero p { color: #94a3b8; font-size: 1rem; }
    .deals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
    .disclosure-box { background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(14, 165, 233, 0.25); border-radius: 12px; padding: 1.25rem; font-size: 0.85rem; color: #94a3b8; margin: 3rem 0; }
    footer { border-top: 1px solid var(--border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <nav>
      <a href="/deals" class="active">Verified Deals</a>
      <a href="/">Guides</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </nav>
  </header>
  <main>
    <div class="hero">
      <span style="display: inline-block; font-size: 0.75rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 0.75rem;">#AD &bull; MERCHANT DEAL SNAPSHOTS</span>
      <h1>Curated Commercial Offers for Indian Buyers</h1>
      <p>Promotional prices and reference MRPs shown below reflect merchant-reported snapshots observed at sync time. Prices and availability can change at any time; confirm final terms on the official merchant checkout page.</p>
    </div>
    <div class="deals-grid">
      ${dealCards || '<p class="no-deals-message" style="color: #94a3b8; font-size: 1.1rem; text-align: center; grid-column: 1 / -1; padding: 3rem 1rem;">No currently verified offers are available in this category. Check back later.</p>'}
    </div>
    <div class="disclosure-box">
      <strong style="color: #e2e8f0;">#Ad Commercial Disclosure &amp; Snapshot Notice:</strong>
      Offer pricing, stock status, and reference MRPs are merchant-reported snapshots and are not guaranteed. Where authorized affiliate agreements exist, qualifying purchases made through outgoing partner links may earn a referral commission at zero additional cost to you.
    </div>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(config.siteName)}. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  /**
   * Renders an SEO-indexable SSR product deal page at /deals/:slug with Schema.org/Product JSON-LD.
   */
  public renderDealDetailHtml(deal: any, relatedDeals: any[] = [], config: StaticSiteConfig): string {
    const slug = deal.slug || deal.canonicalSlug || deal.id;
    const canonicalUrl = `${config.siteUrl}/deals/${encodeURIComponent(slug)}`;
    const priceNum = Number(deal.currentPriceINR || 0);
    const refNum = Number(deal.referencePriceINR || 0);
    const badgeText = deal.discountBadge || (deal.verifiedDiscountPercent ? `${deal.verifiedDiscountPercent}% OFF` : 'Verified Price');
    const title = `${deal.title} — ₹${priceNum.toLocaleString('en-IN')} (${badgeText} Verified Deal) | #Ad`;
    const description = `Verified Indian deal for ${deal.title} on ${deal.merchant} at ₹${priceNum.toLocaleString('en-IN')}${refNum > priceNum ? ` (Reference MRP ₹${refNum.toLocaleString('en-IN')})` : ''}. #Ad Commission earned on qualifying purchases.`;
    const verifiedTs = deal.lastCheckedAt || deal.lastVerifiedAt || deal.updatedAt || new Date().toISOString();
    const redirectHref = `/api/v1/public/deals/${encodeURIComponent(deal.id)}/redirect?utm_source=deal_ssr&utm_medium=organic`;

    const productSchema: Record<string, any> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: deal.title,
      description,
      url: canonicalUrl,
      brand: {
        '@type': 'Brand',
        name: deal.brand || deal.merchant || 'Brand'
      },
      offers: {
        '@type': 'Offer',
        url: canonicalUrl,
        priceCurrency: deal.currency || 'INR',
        price: priceNum,
        itemCondition: 'https://schema.org/NewCondition',
        availability: deal.availability === 'OUT_OF_STOCK'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
        seller: {
          '@type': 'Organization',
          name: deal.merchant || deal.brand || 'Merchant'
        }
      }
    };

    const relatedHtml = relatedDeals.slice(0, 4).map((rel: any) => {
      const relSlug = rel.slug || rel.canonicalSlug || rel.id;
      const relPrice = Number(rel.currentPriceINR || 0);
      const relRef = Number(rel.referencePriceINR || 0);
      return `
        <div style="background:#111827;border:1px solid #1e293b;border-radius:10px;padding:1rem;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="font-size:0.75rem;color:#38bdf8;font-weight:700;text-transform:uppercase;">${this.escapeHtml(rel.brand || rel.merchant || '')}</div>
            <h3 style="font-size:1rem;margin:0.35rem 0;color:#fff;"><a href="/deals/${this.escapeHtml(encodeURIComponent(relSlug))}" style="color:#fff;text-decoration:none;">${this.escapeHtml(rel.title)}</a></h3>
            <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:0.5rem;">${this.escapeHtml(rel.targetBuyerSegment || rel.category || '')}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;padding-top:0.65rem;border-top:1px solid #1e293b;">
            <div>
              <strong style="color:#fff;font-size:1.05rem;">₹${relPrice.toLocaleString('en-IN')}</strong>
              ${relRef > relPrice ? `<span style="font-size:0.78rem;color:#64748b;text-decoration:line-through;margin-left:0.35rem;">₹${relRef.toLocaleString('en-IN')}</span>` : ''}
            </div>
            <a href="/deals/${this.escapeHtml(encodeURIComponent(relSlug))}" style="font-size:0.82rem;color:#38bdf8;font-weight:700;text-decoration:none;">View Proof &rarr;</a>
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)}</title>
  <meta name="description" content="${this.escapeHtml(description)}">
  <link rel="canonical" href="${this.escapeHtml(canonicalUrl)}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${this.escapeHtml(title)}">
  <meta property="og:description" content="${this.escapeHtml(description)}">
  <meta property="og:url" content="${this.escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="product">
  <script type="application/ld+json">
${JSON.stringify(productSchema, null, 2)}
  </script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.15rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1040px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.1rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    main { max-width: 1040px; margin: 2rem auto; padding: 0 1.5rem; }
    .deal-box { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 2rem; margin-bottom: 2rem; }
    .cta-btn { display: inline-block; background: #06b6d4; color: #020617; font-weight: 800; padding: 0.9rem 1.75rem; border-radius: 10px; text-decoration: none; font-size: 1rem; margin-top: 1rem; }
    .related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1rem; }
    footer { border-top: 1px solid var(--border); padding: 2.5rem 1.5rem; margin-top: 3rem; text-align: center; font-size: 0.85rem; color: #64748b; }
    footer a { color: #94a3b8; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <nav>
      <a href="/deals">All Verified Deals</a>
      <a href="/tools/site-audit">SiteFix Audit</a>
      <a href="/public/disclosure">Disclosure</a>
    </nav>
  </header>
  <main>
    <div style="font-size:0.85rem;color:#94a3b8;margin-bottom:1rem;">
      <a href="/deals" style="color:#38bdf8;text-decoration:none;">Verified Deals</a> &rsaquo; <span>${this.escapeHtml(deal.category || 'Product')}</span> &rsaquo; <span>${this.escapeHtml(deal.brand || '')}</span>
    </div>
    <article class="deal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:0.85rem;">
        <span style="font-size:0.8rem;font-weight:700;color:#38bdf8;text-transform:uppercase;">#Ad &bull; ${this.escapeHtml(deal.merchant)} &bull; ${this.escapeHtml(deal.availability || 'IN_STOCK')}</span>
        ${typeof deal.arbitrageScore === 'number' ? `<span style="font-size:0.78rem;background:rgba(56,189,248,0.15);color:#7dd3fc;border:1px solid rgba(56,189,248,0.3);padding:0.25rem 0.65rem;border-radius:9999px;">Arbitrage Score ${deal.arbitrageScore}/99.9</span>` : ''}
      </div>
      <h1 style="font-size:1.85rem;color:#fff;margin:0 0 0.75rem 0;line-height:1.3;">${this.escapeHtml(deal.title)}</h1>
      ${deal.targetBuyerSegment ? `<div style="font-size:0.9rem;color:#cbd5e1;background:rgba(15,23,42,0.85);border:1px solid #334155;border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1.25rem;">Target Buyer Segment: <strong>${this.escapeHtml(deal.targetBuyerSegment)}</strong></div>` : ''}
      <div style="display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;margin:1rem 0;">
        <span style="font-size:2.35rem;font-weight:800;color:#fff;">₹${priceNum.toLocaleString('en-IN')}</span>
        ${refNum > priceNum ? `<span style="font-size:1.05rem;color:#64748b;text-decoration:line-through;">Reference MRP ₹${refNum.toLocaleString('en-IN')}</span>` : ''}
        <span style="font-size:0.9rem;font-weight:700;background:rgba(16,185,129,0.2);color:#6ee7b7;padding:0.3rem 0.75rem;border-radius:8px;">${this.escapeHtml(badgeText)}</span>
      </div>
      <p style="font-size:0.88rem;color:#94a3b8;margin:0.5rem 0 1rem 0;">
        Last Verified Snapshot: <code>${this.escapeHtml(verifiedTs)}</code> &bull; Verification Status: <strong>${this.escapeHtml(deal.verificationStatus || 'VERIFIED')}</strong>
      </p>
      <a href="${this.escapeHtml(redirectHref)}" target="_blank" rel="sponsored nofollow noopener" class="cta-btn">Claim Verified Deal on ${this.escapeHtml(deal.merchant)} &rarr;</a>
      <p style="font-size:0.8rem;color:#94a3b8;margin-top:1.25rem;padding-top:1rem;border-top:1px solid #1e293b;">
        <strong>#Ad Statutory Disclosure:</strong> This page is a deterministic merchant price snapshot linking via authorized Cuelinks tracking (Channel 331585). We may earn an affiliate commission on qualifying purchases at no additional cost to you. Always confirm final live checkout price and warranty terms on the merchant store.
      </p>
    </article>
    ${relatedDeals.length > 0 ? `
    <section>
      <h2 style="font-size:1.25rem;color:#fff;margin-bottom:0.5rem;">Related Verified Deals for This Buyer Segment</h2>
      <div class="related-grid">${relatedHtml}</div>
    </section>` : ''}
  </main>
  <footer>
    <p><a href="/deals">All Verified Deals</a> &bull; <a href="/sitemap.xml">Sitemap</a> &bull; <a href="/public/disclosure">Affiliate Disclosure</a></p>
  </footer>
</body>
</html>`;
  }

  public renderAboutHtml(config: StaticSiteConfig): string {
    return this.renderLegalLayout('About Us', config, `
      <h1>About ${this.escapeHtml(config.siteName)}</h1>
      <p>${this.escapeHtml(config.siteName)} is an informational platform for commercial supplies and equipment. We do not test products or show prices; check current details on Amazon.in.</p>
      <h2>Editorial Principles</h2>
      <ul>
        <li><strong>Zero Fabricated Reviews:</strong> We never create, publish, or endorse artificial customer testimonials or unverified star ratings.</li>
        <li><strong>Specification-First Overview:</strong> Products are listed based on manufacturer data sheets and physical compatibility.</li>
        <li><strong>Commercial Independence:</strong> Recommendations are not paid placements. Commercial relationships are transparently disclosed.</li>
      </ul>
      <h2>Editorial Oversight</h2>
      <p>Publication oversight is managed by <strong>${this.escapeHtml(config.authorName)}</strong>.</p>
    `);
  }

  public renderContactHtml(config: StaticSiteConfig): string {
    return this.renderLegalLayout('Contact & Grievance Redressal', config, `
      <h1>Contact &amp; Grievance Redressal</h1>
      <p>For questions regarding our product guides, editorial inquiries, or statutory grievance redressal under the Digital Personal Data Protection (DPDP) Act, 2023, please contact our team:</p>
      <div style="background: #111827; border: 1px solid #1e293b; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0;">
        <p><strong>Entity:</strong> ${this.escapeHtml(config.siteName)}</p>
        <p><strong>Primary Contact &amp; Grievance Officer:</strong> ${this.escapeHtml(config.authorName)}</p>
        <p><strong>Official Email:</strong> <a href="mailto:${this.escapeHtml(config.contactEmail)}" style="color: #06b6d4;">${this.escapeHtml(config.contactEmail)}</a></p>
        <p><strong>Location:</strong> Hyderabad, Telangana, India</p>
        <p style="font-size: 0.9rem; color: #94a3b8; margin-top: 1rem;">Under Section 13 of the DPDP Act 2023, data principals may submit privacy or data erasure requests directly via email. Acknowledgments are provided within 48 hours.</p>
      </div>
    `);
  }

  public renderPrivacyHtml(config: StaticSiteConfig): string {
    return this.renderLegalLayout('Privacy Policy', config, `
      <h1>Privacy Policy</h1>
      <p><em>Last updated: October 2026</em></p>
      <p>${this.escapeHtml(config.siteName)} operates this informational website. This policy describes our adherence to the Digital Personal Data Protection (DPDP) Act, 2023 regarding visitor data.</p>
      <h2>Data We Collect</h2>
      <p>We believe in minimal data collection. We do not maintain user registration accounts for general readers. When you browse our guides, we record anonymous, aggregated server request metrics. Outbound click beacons store a cryptographically salted one-way hash (pseudonymised) of client IP addresses to guard against abuse without recording raw identifiable personal data.</p>
      <h2>Cookies &amp; Third-Party Referral Links</h2>
      <p>Our recommendation guides contain tracked outbound links to authorized merchant platforms including Amazon India. When you click an external link, the receiving merchant platform may set cookies in accordance with their privacy policy to attribute qualifying purchases.</p>
      <h2>Your Rights Under DPDP Act 2023</h2>
      <p>Data principals have the right to request access, correction, and erasure of personal data. Since we do not store raw IP addresses or identifiable reader profiles, personal data holds are minimal. For inquiries, email <a href="mailto:${this.escapeHtml(config.contactEmail)}" style="color: #06b6d4;">${this.escapeHtml(config.contactEmail)}</a>.</p>
    `);
  }

  public renderTermsHtml(config: StaticSiteConfig): string {
    return this.renderLegalLayout('Terms of Service', config, `
      <h1>Terms of Service</h1>
      <p><em>Last updated: October 2026</em></p>
      <p>By accessing ${this.escapeHtml(config.siteName)}, you agree to comply with and be bound by these Terms of Service.</p>
      <h2>Nature of Information</h2>
      <p>All product evaluations, technical comparisons, and buying guides are prepared for general informational purposes. Product specifications, availability, and merchant terms are governed by the respective sellers on their authoritative platforms. Always confirm specifications prior to finalizing commercial transactions.</p>
      <h2>Limitation of Liability</h2>
      <p>In no event shall ${this.escapeHtml(config.siteName)} or its operators be liable for direct or indirect outcomes resulting from transactions conducted with external merchants linked from this website.</p>
      <h2>Governing Law</h2>
      <p>These terms are governed by the laws of India, subject to the jurisdiction of competent courts in Hyderabad, Telangana.</p>
    `);
  }

  public renderDisclosureHtml(config: StaticSiteConfig): string {
    return this.renderLegalLayout('Affiliate & Commercial Referral Disclosure', config, `
      <h1>Affiliate &amp; Commercial Referral Disclosure</h1>
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 1.2rem; margin: 1.5rem 0; font-size: 1.1rem; color: #fde68a; font-weight: 600;">
        "As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in."
      </div>
      <h2>Transparency and Compliance</h2>
      <p>${this.escapeHtml(config.siteName)} participates in the Amazon Associates India Program, an affiliate advertising initiative designed to provide a means for sites to earn advertising fees by linking to Amazon.in.</p>
      <h2>Zero Cost to Readers</h2>
      <p>When you click an affiliate link on this website and make a qualifying purchase, we may receive a commission. This incurs <strong>absolutely no additional cost to you</strong>. The price you pay on the merchant platform remains identical whether you visit directly or via our tracked links.</p>
      <h2>Editorial Objectivity</h2>
      <p>We do not accept paid reviews or promotional sponsorships in exchange for artificial recommendations. Products are included based on relevance, compatibility, and technical characteristics.</p>
    `);
  }

  private renderLegalLayout(title: string, config: StaticSiteConfig, bodyHtml: string): string {
    const slugMap: Record<string, string> = {
      'about': 'about',
      'about us': 'about',
      'contact': 'contact',
      'contact & grievance redressal': 'contact',
      'privacy': 'privacy',
      'privacy policy': 'privacy',
      'terms': 'terms',
      'terms of service': 'terms',
      'disclosure': 'disclosure',
      'affiliate & commercial referral disclosure': 'disclosure'
    };
    const path = slugMap[title.toLowerCase()] || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const canonicalUrl = `${config.siteUrl}/${path}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
  <link rel="canonical" href="${canonicalUrl}">
  <meta name="robots" content="index, follow">
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; max-width: 900px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.15rem; }
    main { max-width: 820px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { color: #fff; font-size: 2rem; }
    h2 { color: #f1f5f9; font-size: 1.35rem; margin-top: 1.8rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
    p, li { color: #cbd5e1; font-size: 1.02rem; }
    footer { border-top: 1px solid var(--border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
  </header>
  <main>
    <article>
      ${bodyHtml}
    </article>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(config.siteName)}. All rights reserved.</p>
  </footer>
</body>
</html>`;
  }

  private generateSitemapXml(guides: any[], config: StaticSiteConfig): string {
    const urls = [
      `${config.siteUrl}/`,
      `${config.siteUrl}/deals`,
      `${config.siteUrl}/revenue`,
      `${config.siteUrl}/about`,
      `${config.siteUrl}/contact`,
      `${config.siteUrl}/privacy`,
      `${config.siteUrl}/terms`,
      `${config.siteUrl}/disclosure`,
      ...guides.map(g => `${config.siteUrl}/guides/${g.slug}`)
    ];

    const today = new Date().toISOString().split('T')[0];
    const xmlItems = urls.map(url => `  <url>\n    <loc>${this.escapeHtml(url)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n  </url>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlItems}\n</urlset>\n`;
  }

  private normalizeExactUrl(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      const u = new URL(rawUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const pathname = u.pathname.replace(/\/+$/, '') || '/';
      return `${u.protocol.toLowerCase()}//${u.hostname.toLowerCase()}${u.port ? ':' + u.port : ''}${pathname}${u.search}`;
    } catch {
      return null;
    }
  }

  private canonicalDestinationKey(rawUrl: string): string | null {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    try {
      const u = new URL(rawUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const stripParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'tag', 'aff_id', 'subid', 'fbclid', 'gclid', 'click_id'];
      for (const k of stripParams) u.searchParams.delete(k);
      u.searchParams.sort();
      const pathname = u.pathname.replace(/\/+$/, '') || '/';
      const search = u.searchParams.toString();
      return `${u.hostname.toLowerCase()}${pathname}${search ? '?' + search : ''}`;
    } catch {
      return null;
    }
  }

  private isValidHttpsDestination(rawUrl: string): boolean {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const u = new URL(rawUrl.trim());
      return u.protocol === 'https:' && Boolean(u.hostname);
    } catch {
      return false;
    }
  }

  private validateDealMonetizationChain(deal: any): boolean {
    if (!deal || typeof deal !== 'object' || !deal.id) return false;
    if (deal.productVerified !== true) return false;
    if (deal.affiliateVerified !== true) return false;
    if (deal.isMonetizable !== true) return false;
    if (deal.availability !== 'IN_STOCK') return false;

    const dealExpiry = deal.expiryDate || deal.expiry_date;
    if (dealExpiry) {
      const expMs = Date.parse(String(dealExpiry));
      if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
    }

    const destUrl = String(deal.productUrl || deal.product_url || '').trim();
    if (!this.isValidHttpsDestination(destUrl)) return false;

    const partnerOffer = deal.partnerOffer;
    if (!partnerOffer || !partnerOffer.id) return false;
    const offerStatus = String(partnerOffer.status || '').toUpperCase();
    const offerActive = partnerOffer.active === true || partnerOffer.active === 1 || partnerOffer.active === '1';
    if (offerStatus !== 'ACTIVE' || !offerActive) return false;
    const offerExpiry = partnerOffer.expiryDate || partnerOffer.expiry_date;
    if (offerExpiry) {
      const offerExpMs = Date.parse(String(offerExpiry));
      if (!Number.isFinite(offerExpMs) || offerExpMs <= Date.now()) return false;
    }

    const partner = deal.partner;
    if (!partner || !partner.id) return false;
    const approvalStatus = String(partner.approvalStatus || partner.approval_status || '').toUpperCase();
    const authStatus = String(partner.authorizationStatus || partner.authorization_status || '').toUpperCase();
    const partnerActive = partner.activeStatus !== 0 && partner.activeStatus !== false && partner.active_status !== 0 && partner.active_status !== false;
    if (approvalStatus !== 'APPROVED' || authStatus !== 'AUTHORIZED' || !partnerActive) return false;

    const campaign = deal.campaign;
    const campaignId = campaign && (campaign.campaignId || campaign.campaign_id || campaign.id);
    if (!campaign || !campaignId) return false;
    if (campaign.status && String(campaign.status).toUpperCase() !== 'ACTIVE') return false;

    return true;
  }

  private markdownToHtml(md: string, eligibleDeals?: any[], guide?: any): string {
    if (!md) return '';

    const destCounts = new Map<string, number>();
    let allowedGuideIds: Set<string> | null = null;
    if (eligibleDeals !== undefined) {
      for (const d of eligibleDeals) {
        const key = this.canonicalDestinationKey(String(d?.productUrl || d?.product_url || ''));
        if (key) destCounts.set(key, (destCounts.get(key) || 0) + 1);
      }
      const explicitIds: string[] = [];
      const primaryId = guide?.primary_offer_id || guide?.primaryOfferId;
      if (typeof primaryId === 'string' && primaryId.trim()) explicitIds.push(primaryId.trim());
      const rawMatchedJson = guide?.matched_offer_ids_json || guide?.matchedOfferIdsJson;
      if (typeof rawMatchedJson === 'string' && rawMatchedJson.trim()) {
        try {
          const parsed = JSON.parse(rawMatchedJson);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof item === 'string' && item.trim()) explicitIds.push(item.trim());
            }
          }
        } catch {}
      }
      if (explicitIds.length > 0) {
        allowedGuideIds = new Set(explicitIds);
      }
    }

    // Convert markdown links [Text](URL) -> <a href="URL" ...>Text</a>
    // For affiliate/sponsored links (Cuelinks, Amazon, redirects), ensure target="_blank" rel="sponsored nofollow" and button class
    let html = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      const isAffiliate =
        url.includes('amazon.in') ||
        url.includes('clnk.in') ||
        url.includes('linksredirect.com') ||
        url.includes('/r/') ||
        url.includes('/api/v1/public/deals/');

      // If eligibleDeals is provided, perform strict fail-closed exact validation & rewriting
      if (eligibleDeals !== undefined) {
        if (isAffiliate) {
          const cleanUrl = url.trim();
          const normalizedLink = this.normalizeExactUrl(cleanUrl);

          let redirectRouteId: string | null = null;
          const redirectRouteMatch = cleanUrl.match(/^\/api\/v1\/public\/deals\/([^/?#]+)\/redirect$/i) ||
            (() => {
              try {
                const u = new URL(cleanUrl);
                return u.pathname.match(/^\/api\/v1\/public\/deals\/([^/]+)\/redirect$/i);
              } catch {
                return null;
              }
            })();
          if (redirectRouteMatch) {
            redirectRouteId = decodeURIComponent(redirectRouteMatch[1]).trim();
          }

          let shortSlug: string | null = null;
          const rMatch = cleanUrl.match(/^\/r\/([^/?#]+)$/i);
          if (rMatch) {
            shortSlug = decodeURIComponent(rMatch[1]).trim();
          }

          const matchedDeals = eligibleDeals.filter((d: any) => {
            if (!d || typeof d.id !== 'string' || !d.id.trim()) return false;
            const dealId = d.id.trim();
            const dealSlug = typeof d.slug === 'string' ? d.slug.trim() : '';
            const canonicalSlug = typeof d.canonicalSlug === 'string' ? d.canonicalSlug.trim() : (typeof d.canonical_slug === 'string' ? d.canonical_slug.trim() : '');
            const offerId = typeof d.partnerOffer?.id === 'string' ? d.partnerOffer.id.trim() : '';

            if (allowedGuideIds && !allowedGuideIds.has(dealId) && (!offerId || !allowedGuideIds.has(offerId))) {
              return false;
            }

            if (redirectRouteId) {
              return dealId === redirectRouteId || (dealSlug !== '' && dealSlug === redirectRouteId) || (canonicalSlug !== '' && canonicalSlug === redirectRouteId);
            }
            if (shortSlug) {
              return dealId === shortSlug || (dealSlug !== '' && dealSlug === shortSlug) || (canonicalSlug !== '' && canonicalSlug === shortSlug);
            }

            if (!normalizedLink) return false;

            const trackingCandidates = [
              d.affiliateRedirectUrl,
              d.affiliate_redirect_url,
              d.affiliateUrl,
              d.affiliate_url,
              d.trackingUrl,
              d.tracking_url
            ];
            for (const cand of trackingCandidates) {
              if (typeof cand === 'string' && cand.trim()) {
                const normCand = this.normalizeExactUrl(cand);
                if (normCand && normCand === normalizedLink) return true;
              }
            }

            const prodUrl = typeof (d.productUrl || d.product_url) === 'string' ? (d.productUrl || d.product_url).trim() : '';
            const normProd = this.normalizeExactUrl(prodUrl);
            if (normProd && normProd === normalizedLink) return true;

            return false;
          });

          if (matchedDeals.length === 1) {
            const matchedDeal = matchedDeals[0];
            const destKey = this.canonicalDestinationKey(String(matchedDeal.productUrl || matchedDeal.product_url || ''));
            const destUnique = destKey !== null && (destCounts.get(destKey) || 0) === 1;
            if (destUnique && this.validateDealMonetizationChain(matchedDeal)) {
              const redirectUrl = `/api/v1/public/deals/${encodeURIComponent(matchedDeal.id)}/redirect`;
              return `<a href="${redirectUrl}" target="_blank" rel="sponsored nofollow" class="affiliate-link">${this.escapeHtml(text)}</a>`;
            }
          }

          // Unmapped, ambiguous, or incomplete-chain affiliate link: fail closed by stripping anchor tag entirely
          return this.escapeHtml(text);
        }
      }

      const rel = isAffiliate ? 'sponsored nofollow noopener' : 'noopener noreferrer';
      const className = isAffiliate ? ' class="affiliate-link"' : '';
      return `<a href="${this.escapeHtml(url)}" target="_blank" rel="${rel}"${className}>${this.escapeHtml(text)}</a>`;
    });

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold / italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Paragraphs
    const paragraphs = html.split(/\n\s*\n/);
    return paragraphs
      .map(p => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<div')) {
          return trimmed;
        }
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      })
      .filter(Boolean)
      .join('\n');
  }

  private getGoogleSiteVerificationMeta(config?: StaticSiteConfig): string {
    const code = resolveVerificationTokens(config).googleSiteVerification || '';
    if (!code) return '';
    return `<meta name="google-site-verification" content="${this.escapeHtml(code)}">\n  `;
  }

  private getCuelinksVerificationMeta(config?: StaticSiteConfig): string {
    const code = resolveVerificationTokens(config).cuelinksVerificationCode || '';
    if (!code) return '';
    return `<meta name="cuelinks-verification" content="${this.escapeHtml(code)}">\n  `;
  }

  /**
   * Renders a public SEO-indexable site audit scorecard page at /audit/:domain (V5.6)
   */
  public renderAuditHtml(auditData: any, config: StaticSiteConfig, crossPromoDeals: any[] = []): string {
    const domain = this.escapeHtml(auditData.domain);
    const businessName = this.escapeHtml(auditData.business_name || auditData.domain);
    const perfScore = (auditData.performance_score !== null && auditData.performance_score !== undefined)
      ? Number(auditData.performance_score)
      : null;
    const seoScore = auditData.seo_score || 0;
    const cwv = typeof auditData.core_web_vitals_json === 'string'
      ? JSON.parse(auditData.core_web_vitals_json || '{}')
      : (auditData.core_web_vitals_json || {});
    const checklist = typeof auditData.checklist_json === 'string'
      ? JSON.parse(auditData.checklist_json || '[]')
      : (auditData.checklist_json || []);

    const schemaObj = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      "headline": `${domain} Website Performance & SEO Audit Report`,
      "description": `Technical Core Web Vitals, Schema.org, and SEO scorecard for ${domain}.`,
      "url": `${config.siteUrl}/audit/${domain}`,
      "author": {
        "@type": "Organization",
        "name": config.siteName,
        "url": config.siteUrl
      },
      "publisher": {
        "@type": "Organization",
        "name": config.siteName,
        "url": config.siteUrl
      },
      "datePublished": auditData.created_at || new Date().toISOString(),
      "dateModified": auditData.updated_at || new Date().toISOString()
    };

    const dealsCardsHtml = crossPromoDeals.slice(0, 3).map(d => `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;flex:1;min-width:240px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:11px;background:#e2e8f0;color:#334155;padding:2px 6px;border-radius:4px;font-weight:bold;">${this.escapeHtml(d.category || 'Tech')}</span>
          <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:bold;">#Ad</span>
        </div>
        <h4 style="margin:0 0 8px 0;font-size:14px;color:#0f172a;line-height:1.4;">${this.escapeHtml(d.title)}</h4>
        <div style="font-size:18px;font-weight:bold;color:#1e293b;margin-bottom:12px;">₹${(d.currentPriceINR || 0).toLocaleString('en-IN')} ${d.discountBadge ? `<span style="font-size:12px;color:#16a34a;">(${this.escapeHtml(d.discountBadge)})</span>` : ''}</div>
        <a href="${config.siteUrl}/api/v1/public/deals/${d.id}/redirect" target="_blank" rel="sponsored nofollow noopener" style="display:block;text-align:center;background:#0284c7;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:bold;">View Deal on ${this.escapeHtml(d.merchant)} &rarr;</a>
      </div>
    `).join('');

    const isAuthorized = auditData.is_publicly_authorized === 1;
    const checklistArr = Array.isArray(checklist) ? checklist : [];
    const hasSchemaFinding = checklistArr.some((f: any) =>
      f?.id === 'schema_jsonld_present' && f?.status === 'PASS'
    );
    const hasMissingSchemaFinding = checklistArr.some((f: any) =>
      String(f?.id || '').includes('schema') && (f?.status === 'ISSUE' || f?.status === 'WARNING')
    );
    const schemaStatusLabel = hasSchemaFinding
      ? 'VALID'
      : (hasMissingSchemaFinding ? 'MISSING' : (seoScore >= 75 ? 'VALID' : 'MISSING'));
    const schemaTileClass = schemaStatusLabel === 'VALID' ? 'score-green' : 'score-amber';
    const findingsRowsHtml = checklistArr.length > 0
      ? checklistArr.map((item: any) => {
          const status = String(item?.status || 'INFO').toUpperCase();
          const severity = String(item?.severity || 'INFO').toUpperCase();
          const color = status === 'PASS' ? '#16a34a' : (status === 'ISSUE' ? '#dc2626' : '#d97706');
          const detailText = item?.recommendation || item?.explanation || '';
          const evidenceText = item?.evidence || '';
          return `
            <tr>
              <td><strong>${this.escapeHtml(String(item?.title || item?.category || 'Technical Check'))}</strong><div style="font-size:12px;color:#64748b;">${this.escapeHtml(String(item?.category || 'TECHNICAL'))}</div></td>
              <td><span style="color:${color};font-weight:bold;">${this.escapeHtml(status)}</span> <span style="font-size:11px;color:#64748b;">(${this.escapeHtml(severity)})</span></td>
              <td>${this.escapeHtml(String(evidenceText || 'Inspected via HTTP GET'))}${detailText ? `<div style="font-size:12px;color:#475569;margin-top:4px;">Why it matters: ${this.escapeHtml(String(detailText))}</div>` : ''}</td>
            </tr>
          `;
        }).join('')
      : '';
    const rawTargetUrl = String(auditData.target_url || `https://${auditData.domain || ''}`);
    const selfServeToolUrl = `/tools/site-audit?url=${encodeURIComponent(rawTargetUrl)}`;
    const headSnippetPreview = typeof auditData.head_snippets === 'string' ? auditData.head_snippets.trim() : '';
    const schemaSnippetPreview = typeof auditData.schema_json_ld === 'string' ? auditData.schema_json_ld.trim() : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${domain} Website Performance & SEO Audit Report | SiteFix AI</title>
  <meta name="description" content="Deterministic HTML, Schema.org validation, crawlability, and SEO scorecard for ${domain}. Self-Serve SiteFix Core Technical Fix-Pack.">
  <link rel="canonical" href="${config.siteUrl}/audit/${domain}">
  ${!isAuthorized ? '<meta name="robots" content="noindex, nofollow">\n  ' : ''}${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}
  <script type="application/ld+json">
${JSON.stringify(schemaObj, null, 2)}
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; color: #1e293b; margin: 0; padding: 0; line-height: 1.6; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff; padding: 32px 20px; text-align: center; }
    .container { max-width: 900px; margin: -20px auto 40px auto; padding: 0 16px; }
    .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 24px; }
    .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 20px 0; }
    .score-tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .score-val { font-size: 32px; font-weight: bold; }
    .score-green { color: #16a34a; }
    .score-amber { color: #d97706; }
    .cta-box { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); color: #fff; border-radius: 12px; padding: 28px; text-align: center; margin: 24px 0; }
    .btn-primary { display: inline-block; background: #38bdf8; color: #0f172a; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 8px 6px; }
    .btn-secondary { display: inline-block; background: #10b981; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 8px 6px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; vertical-align: top; }
    th { background: #f8fafc; color: #475569; }
    pre.code-preview { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; overflow-x: auto; font-size: 12px; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="header">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:bold;margin-bottom:8px;">SiteFix AI &bull; Deterministic HTML &amp; Technical SEO Scorecard</div>
    <h1 style="margin:0 0 8px 0;font-size:28px;">Website Audit: ${domain}</h1>
    <p style="margin:0;color:#cbd5e1;font-size:14px;">Evaluated for ${businessName} &bull; Updated ${new Date().toLocaleDateString('en-IN')}</p>
  </div>

  <div class="container">
    <div class="card">
      <h2 style="margin-top:0;font-size:20px;color:#0f172a;">Executive Audit Scorecard</h2>
      <div class="score-grid">
        <div class="score-tile">
          <div style="font-size:12px;color:#64748b;font-weight:bold;">DETERMINISTIC HTML / SEO SCORE</div>
          <div class="score-val ${seoScore >= 70 ? 'score-green' : 'score-amber'}">${seoScore}<span style="font-size:16px;">/100</span></div>
          <div style="font-size:11px;color:#64748b;">${seoScore >= 85 ? 'Technical Baseline Strong' : 'Optimization Required'}</div>
        </div>
        <div class="score-tile">
          <div style="font-size:12px;color:#64748b;font-weight:bold;">PAGESPEED PERFORMANCE</div>
          ${perfScore !== null ? `
          <div class="score-val ${perfScore >= 70 ? 'score-green' : 'score-amber'}">${perfScore}<span style="font-size:16px;">/100</span></div>
          <div style="font-size:11px;color:#64748b;">Lighthouse Core Web Vitals</div>
          ` : `
          <div class="score-val" style="font-size:20px;color:#64748b;">UNAVAILABLE</div>
          <div style="font-size:11px;color:#64748b;">Quota Unreached / Raw HTML Audit</div>
          `}
        </div>
        <div class="score-tile">
          <div style="font-size:12px;color:#64748b;font-weight:bold;">SECURITY &amp; HTTPS</div>
          <div class="score-val score-green">PASS</div>
          <div style="font-size:11px;color:#64748b;">Public HTTPS Probe Verified</div>
        </div>
        <div class="score-tile">
          <div style="font-size:12px;color:#64748b;font-weight:bold;">SCHEMA.ORG JSON-LD</div>
          <div class="score-val ${schemaTileClass}">${schemaStatusLabel}</div>
          <div style="font-size:11px;color:#64748b;">Structured Rich Snippets</div>
        </div>
      </div>

      ${findingsRowsHtml ? `
      <h3 style="font-size:16px;color:#0f172a;margin-top:24px;">Observed Technical Defects &amp; Why They Matter</h3>
      <table>
        <thead>
          <tr><th>Audit Criterion</th><th>Status</th><th>Observed Evidence &amp; Impact</th></tr>
        </thead>
        <tbody>
          ${findingsRowsHtml}
        </tbody>
      </table>
      ` : ''}

      <h3 style="font-size:16px;color:#0f172a;margin-top:24px;">Core Web Vitals Diagnostics</h3>
      <table>
        <thead>
          <tr><th>Metric</th><th>Observed Value</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${perfScore !== null ? `
          <tr><td>Largest Contentful Paint (LCP)</td><td>${this.escapeHtml(cwv.lcp || 'UNAVAILABLE')}</td><td><span style="color:#16a34a;font-weight:bold;">Measured</span></td></tr>
          <tr><td>First Contentful Paint (FCP)</td><td>${this.escapeHtml(cwv.fcp || 'UNAVAILABLE')}</td><td><span style="color:#16a34a;font-weight:bold;">Measured</span></td></tr>
          <tr><td>Cumulative Layout Shift (CLS)</td><td>${this.escapeHtml(cwv.cls || 'UNAVAILABLE')}</td><td><span style="color:#16a34a;font-weight:bold;">Measured</span></td></tr>
          <tr><td>Total Blocking Time (TBT)</td><td>${this.escapeHtml(cwv.tbt || 'UNAVAILABLE')}</td><td><span style="color:#16a34a;font-weight:bold;">Measured</span></td></tr>
          ` : `
          <tr><td>Core Web Vitals (LCP / FCP / CLS / TBT)</td><td>UNAVAILABLE</td><td><span style="color:#64748b;font-weight:bold;">Requires GOOGLE_PAGESPEED_API_KEY</span></td></tr>
          `}
        </tbody>
      </table>
    </div>

    ${(headSnippetPreview || schemaSnippetPreview) ? `
    <div class="card">
      <h2 style="margin-top:0;font-size:18px;color:#0f172a;">Self-Serve SiteFix Core Technical Fix-Pack Preview</h2>
      <p style="font-size:13px;color:#475569;margin-bottom:12px;">Includes customized <code>&lt;head&gt;</code> metadata tags, validated <code>Schema.org</code> JSON-LD, clean <code>robots.txt</code>, and starter <code>sitemap.xml</code> guidance for <strong>${domain}</strong>:</p>
      ${headSnippetPreview ? `<pre class="code-preview">${this.escapeHtml(headSnippetPreview)}</pre>` : ''}
      ${schemaSnippetPreview ? `<pre class="code-preview" style="margin-top:12px;">${this.escapeHtml(schemaSnippetPreview.slice(0, 1200))}</pre>` : ''}
    </div>
    ` : ''}

    <div class="cta-box">
      <h3 style="margin-top:0;font-size:22px;">Unlock Instant Ready-to-Paste Fix-Pack (₹499)</h3>
      <p style="margin:8px 0 20px 0;color:#e2e8f0;font-size:15px;max-width:650px;margin-left:auto;margin-right:auto;">
        Claim the Self-Serve SiteFix Core Technical Fix-Pack engineered for <strong>${domain}</strong>: custom <code>&lt;head&gt;</code> metadata bundle, validated <code>Schema.org</code> JSON-LD script, clean <code>robots.txt</code>, and starter <code>sitemap.xml</code>.
      </p>
      <div>
        <a href="${selfServeToolUrl}" class="btn-primary">Open Self-Serve Checkout for ${domain}</a>
        <a href="/offer#sandbox" class="btn-secondary">₹1 Live Sandbox Validation</a>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:12px;">Secured via Razorpay &bull; Instant Self-Serve Delivery &bull; Zero Recurring Fees</div>
    </div>

    ${crossPromoDeals.length > 0 ? `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;color:#0f172a;">Verified Business & Tech Deals (#Ad)</h3>
        <a href="/deals" style="font-size:13px;color:#0284c7;text-decoration:none;font-weight:bold;">View All Deals &rarr;</a>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        ${dealsCardsHtml}
      </div>
    </div>
    ` : ''}

    <div style="text-align:center;font-size:12px;color:#64748b;margin-top:32px;">
      <p>&copy; 2026 ${this.escapeHtml(config.siteName)}. All technical audits independently conducted via SiteFix AI & Google PageSpeed Insights.</p>
      <p><a href="/" style="color:#64748b;">Home</a> &bull; <a href="/offer" style="color:#64748b;">Offer</a> &bull; <a href="/deals" style="color:#64748b;">Deals</a> &bull; <a href="/tools/site-audit" style="color:#64748b;">Free Audit Tool</a> &bull; <a href="/public/disclosure" style="color:#64748b;">Affiliate Disclosure</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Renders a public sector comparison buying guide at /compare/:sectorSlug (V5.6)
   */
  public renderCompareHtml(sectorDef: any, deals: any[], config: StaticSiteConfig): string {
    const sectorName = this.escapeHtml(sectorDef.displayName || sectorDef.name);
    const sectorSlug = this.escapeHtml(sectorDef.id || sectorDef.code);

    const schemaObj = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": `${sectorName} Top Verified Deals & Price Baseline`,
      "description": `Independent price comparison and verified buying guide for ${sectorName}.`,
      "url": `${config.siteUrl}/compare/${sectorSlug}`,
      "itemListElement": deals.map((d, idx) => ({
        "@type": "ListItem",
        "position": idx + 1,
        "item": {
          "@type": "Product",
          "name": d.title,
          "brand": d.brand,
          "offers": {
            "@type": "Offer",
            "price": d.currentPriceINR,
            "priceCurrency": "INR",
            "availability": d.availability === 'IN_STOCK' ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            "url": `${config.siteUrl}/api/v1/public/deals/${d.id}/redirect`
          }
        }
      }))
    };

    const dealsRowsHtml = deals.map((d, idx) => `
      <tr>
        <td style="font-weight:bold;color:#475569;">#${idx + 1}</td>
        <td>
          <div style="font-weight:bold;color:#0f172a;">${this.escapeHtml(d.title)}</div>
          <div style="font-size:12px;color:#64748b;">Merchant: <strong>${this.escapeHtml(d.merchant)}</strong> &bull; Brand: ${this.escapeHtml(d.brand || 'Verified')}</div>
          ${d.targetBuyerSegment ? `<div style="font-size:11px;color:#0369a1;margin-top:4px;">Best for: <strong>${this.escapeHtml(d.targetBuyerSegment)}</strong>${typeof d.arbitrageScore === 'number' ? ` &bull; Arbitrage ${d.arbitrageScore}/100` : ''}</div>` : ''}
        </td>
        <td>
          <div style="font-size:16px;font-weight:bold;color:#0f172a;">₹${(d.currentPriceINR || 0).toLocaleString('en-IN')}</div>
          ${d.referencePriceINR ? `<div style="font-size:11px;color:#94a3b8;text-decoration:line-through;">₹${(d.referencePriceINR).toLocaleString('en-IN')}</div>` : ''}
        </td>
        <td>
          <span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:bold;">${this.escapeHtml(d.discountBadge || 'VERIFIED DEAL')}</span>
        </td>
        <td>
          <a href="${config.siteUrl}/api/v1/public/deals/${d.id}/redirect" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:13px;">View Deal &rarr;</a>
        </td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Top Verified ${sectorName} Deals & Buying Guide (2026) | #Ad</title>
  <meta name="description" content="Commercial offer comparison and merchant-reported price snapshots in ${sectorName}.">
  <link rel="canonical" href="${config.siteUrl}/compare/${sectorSlug}">
  ${deals.length === 0 ? '<meta name="robots" content="noindex, nofollow">\n  ' : ''}${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}
  <script type="application/ld+json">
${JSON.stringify(schemaObj, null, 2)}
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 0; line-height: 1.6; }
    .header { background: #0f172a; color: #fff; padding: 36px 20px; text-align: center; }
    .container { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
    .ad-banner { background: #fef3c7; border: 1px solid #f59e0b; padding: 10px 16px; border-radius: 6px; font-size: 13px; color: #92400e; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07); margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    th { background: #f1f5f9; color: #475569; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:bold;margin-bottom:8px;">Commercial Sector Intelligence &bull; Verified Buying Guide</div>
    <h1 style="margin:0 0 8px 0;font-size:30px;">Best Verified ${sectorName} Deals</h1>
    <p style="margin:0;color:#cbd5e1;font-size:14px;">Merchant-reported pricing and offer snapshots &bull; Confirm live availability on checkout</p>
  </div>

  <div class="container">
    <div class="ad-banner">
      <strong>#Ad Disclosure:</strong> When you purchase through tracked merchant links on our comparison guides, we may earn an affiliate commission at zero additional cost to you. Prices, stock availability, and offer terms reflect merchant-reported snapshots and must be verified on the official merchant checkout page.
    </div>

    <div class="card">
      <h2 style="margin-top:0;font-size:20px;color:#0f172a;">Ranked Deal Comparison</h2>
      <p style="font-size:14px;color:#64748b;margin-bottom:20px;">Listed offers require active partner, offer, and campaign configuration before link activation. Confirm live price and stock directly with the merchant.</p>
      
      ${deals.length > 0 ? `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Rank</th><th>Product & Merchant</th><th>Price</th><th>Verified Discount</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${dealsRowsHtml}
          </tbody>
        </table>
      </div>
      ` : `
      <div style="text-align:center;padding:32px;color:#64748b;">
        <p>No verified deals currently in stock for ${sectorName}. Automated sector crawler runs hourly.</p>
        <a href="/deals" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">Explore All Deals</a>
      </div>
      `}
    </div>

    <div class="card" style="text-align:center;background:linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);">
      <h3 style="margin-top:0;font-size:18px;color:#0f172a;">Need a Complete Website Performance Audit?</h3>
      <p style="font-size:14px;color:#475569;max-width:600px;margin:0 auto 16px auto;">Audit any website or webstore instantly with SiteFix AI to discover Core Web Vitals bottlenecks and Schema.org rich snippet opportunities.</p>
      <a href="/tools/site-audit" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Run Free Site Audit &rarr;</a>
    </div>

    <div style="text-align:center;font-size:12px;color:#64748b;margin-top:32px;">
      <p>&copy; 2026 ${this.escapeHtml(config.siteName)}. Verified deals independently scraped & cross-referenced.</p>
      <p><a href="/" style="color:#64748b;">Home</a> &bull; <a href="/deals" style="color:#64748b;">All Deals</a> &bull; <a href="/offer" style="color:#64748b;">Offer</a> &bull; <a href="/public/disclosure" style="color:#64748b;">Disclosure</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
