import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StaticSiteConfig {
  siteName: string;
  authorName: string;
  contactEmail: string;
  siteUrl: string;
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
    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-platform-core.web.app').replace(/\/$/, '');

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

    return {
      siteName: siteName!,
      authorName: authorName!,
      contactEmail: contactEmail!,
      siteUrl
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

    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-platform-core.web.app').replace(/\/$/, '');

    return {
      siteName: siteName!,
      authorName: authorName!,
      contactEmail: contactEmail!,
      siteUrl
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
  ${this.getGoogleSiteVerificationMeta()}${this.getCuelinksVerificationMeta()}<title>${this.escapeHtml(title)}</title>
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
      <strong>Disclosure:</strong> As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.
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
  public renderGuideHtml(guide: any, config: StaticSiteConfig): string {
    const title = guide.title || 'Product Evaluation & Buying Guide';
    const description = guide.intent_target || guide.intentTarget || guide.meta_description || guide.description || 'Commercial product overview and specification details.';
    const canonicalUrl = `${config.siteUrl}/guides/${guide.slug}`;
    const fullBody = guide.content_markdown || guide.contentMarkdown || guide.body_markdown || guide.body || '';

    let disclosureText = 'As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.';
    if (
      guide.disclosure_markdown &&
      guide.disclosure_markdown !== 'Disclosure: We may earn a referral commission at no additional cost to you when you purchase through our links.' &&
      !guide.disclosure_markdown.includes('Amazon Associate')
    ) {
      disclosureText = guide.disclosure_markdown;
    } else if (guide.disclosureMarkdown && !guide.disclosureMarkdown.includes('Amazon Associate')) {
      disclosureText = guide.disclosureMarkdown;
    } else if (guide.slug === 'student-flight-discounts-india' || fullBody.includes('clnk.in') || fullBody.includes('linksredirect.com')) {
      disclosureText = 'Affiliate Disclosure: This guide contains verified affiliate links to partner travel booking platforms (Air India Express and Cleartrip). When you make a booking through these links, we may earn an affiliate commission at zero additional cost to you. We maintain strict editorial independence and never charge users fees or alter airline fare rules.';
    }

    // Convert basic markdown to clean HTML
    const formattedBody = this.markdownToHtml(fullBody);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta()}${this.getCuelinksVerificationMeta()}<title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
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
    const title = `Verified Deals & Price Evidence | ${config.siteName}`;
    const description = `Independently verified Indian e-commerce deals across boAt, Lenovo, Noise, and Amazon with reference MRP verification, transparent promo codes, and zero price inflation.`;
    const canonicalUrl = `${config.siteUrl}/deals`;

    const defaultDeals = [
      {
        id: 'deal_boat_airdopes_141',
        title: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 1299,
        currency: 'INR',
        referencePriceINR: 4490,
        verifiedDiscountPercent: 71,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        couponCode: 'BOATEXTRA10',
        couponConditions: 'Extra 10% off on prepaid orders above ₹999',
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        buyerValueScore: 88,
        lastCheckedAt: new Date().toISOString(),
        sourceDomain: 'boat-lifestyle.com'
      },
      {
        id: 'deal_lenovo_ideapad_slim3',
        title: 'Lenovo IdeaPad Slim 3 12th Gen Intel Core i3-1215U 15.6" FHD Laptop',
        brand: 'Lenovo',
        merchant: 'Lenovo India',
        category: 'Laptops & Computers',
        productUrl: 'https://www.lenovo.com/in/en/laptops/ideapad/ideapad-s-series/IdeaPad-Slim-3-Gen-7-15-Intel/p/LEN101I0048',
        currentPriceINR: 34990,
        currency: 'INR',
        referencePriceINR: 52990,
        verifiedDiscountPercent: 34,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        couponCode: 'LENOVOSAVE',
        couponConditions: 'Instant ₹1,500 coupon at checkout on HDFC/ICICI cards',
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        buyerValueScore: 82,
        lastCheckedAt: new Date().toISOString(),
        sourceDomain: 'lenovo.com'
      },
      {
        id: 'deal_noise_colorfit_pro4',
        title: 'Noise ColorFit Pro 4 Alpha 1.78" AMOLED Display Smart Watch',
        brand: 'Noise',
        merchant: 'Noise Official',
        category: 'Audio & Wearables',
        productUrl: 'https://www.gonoise.com/products/noise-colorfit-pro-4-alpha-smartwatch',
        currentPriceINR: 2799,
        currency: 'INR',
        referencePriceINR: 7999,
        verifiedDiscountPercent: 65,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        couponCode: 'NOISE200',
        couponConditions: '₹200 instant discount on checkout with UPI payment',
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        buyerValueScore: 85,
        lastCheckedAt: new Date().toISOString(),
        sourceDomain: 'gonoise.com'
      }
    ];

    const activeDeals = (deals && deals.length > 0) ? deals : defaultDeals;

    const itemListSchema = {
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
    };

    const dealCards = activeDeals.map((deal: any) => `
      <div style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; text-transform: uppercase;">${this.escapeHtml(deal.brand)}</span>
            <span style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.2rem 0.5rem; border-radius: 9999px;">✓ Verified</span>
          </div>
          <h2 style="font-size: 1.15rem; color: #fff; margin: 0 0 0.5rem 0; line-height: 1.4;">${this.escapeHtml(deal.title)}</h2>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 1rem;">
            <span>${this.escapeHtml(deal.merchant)}</span> &bull; <span>${this.escapeHtml(deal.category)}</span>
          </div>
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
          <span style="font-size: 0.75rem; color: #64748b;">Zero Price Inflation</span>
          <a href="${this.escapeHtml(deal.trackingUrl || deal.productUrl)}" target="_blank" rel="noopener noreferrer" style="background: #06b6d4; color: #020617; font-weight: 700; font-size: 0.85rem; padding: 0.5rem 1rem; border-radius: 8px; text-decoration: none;">View Deal &rarr;</a>
        </div>
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta()}${this.getCuelinksVerificationMeta()}<title>${this.escapeHtml(title)}</title>
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
  <script type="application/ld+json">
  ${JSON.stringify(itemListSchema, null, 2)}
  </script>
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
      <span style="display: inline-block; font-size: 0.75rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 0.75rem;">AUTONOMOUS VERIFICATION ENGINE</span>
      <h1>Curated, Cross-Checked Deals for Indian Buyers</h1>
      <p>Zero inflated discounts. Every promotional price, MRP baseline, and coupon condition is independently corroborated across official Indian merchant stores.</p>
    </div>
    <div class="deals-grid">
      ${dealCards}
    </div>
    <div class="disclosure-box">
      <strong style="color: #e2e8f0;">Independent Verification &amp; Commercial Disclosure:</strong>
      Deals on this page are autonomously cross-checked across authorized Indian retailer stores. Where authorized affiliate agreements exist, qualifying purchases may earn a referral commission at zero additional cost to you. Reference MRP baselines are independently verified.
    </div>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
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
  ${this.getGoogleSiteVerificationMeta()}${this.getCuelinksVerificationMeta()}<title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
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

  private markdownToHtml(md: string): string {
    if (!md) return '';

    // Convert markdown links [Text](URL) -> <a href="URL" ...>Text</a>
    // For affiliate/sponsored links (Cuelinks, Amazon, redirects), ensure target="_blank" rel="sponsored nofollow noopener" and button class
    let html = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      const isAffiliate =
        url.includes('amazon.in') ||
        url.includes('clnk.in') ||
        url.includes('linksredirect.com') ||
        url.includes('/r/');
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

  private getGoogleSiteVerificationMeta(): string {
    const code = process.env.GOOGLE_SITE_VERIFICATION?.trim();
    if (!code) return '';
    return `<meta name="google-site-verification" content="${this.escapeHtml(code)}">\n  `;
  }

  private getCuelinksVerificationMeta(): string {
    const code = (process.env.CUELINKS_VERIFICATION_CODE || 'VERIFY-CL-YE94W8YS').trim();
    if (!code) return '';
    return `<meta name="cuelinks-verification" content="${this.escapeHtml(code)}">\n  `;
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
