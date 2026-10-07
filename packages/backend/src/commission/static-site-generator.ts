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
   * Validates required public configuration without inventing defaults.
   */
  public validateConfig(): StaticSiteConfig {
    const missing: string[] = [];
    if (!process.env.PUBLIC_SITE_NAME || !process.env.PUBLIC_SITE_NAME.trim()) {
      missing.push('PUBLIC_SITE_NAME');
    }
    if (!process.env.PUBLIC_AUTHOR_NAME || !process.env.PUBLIC_AUTHOR_NAME.trim()) {
      missing.push('PUBLIC_AUTHOR_NAME');
    }
    if (!process.env.PUBLIC_CONTACT_EMAIL || !process.env.PUBLIC_CONTACT_EMAIL.trim()) {
      missing.push('PUBLIC_CONTACT_EMAIL');
    }

    if (missing.length > 0) {
      throw new Error(`CONFIG_ERROR: Missing required public site configuration: ${missing.join(', ')}`);
    }

    const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://ai-marketing-platform-core.web.app').replace(/\/$/, '');

    return {
      siteName: process.env.PUBLIC_SITE_NAME!.trim(),
      authorName: process.env.PUBLIC_AUTHOR_NAME!.trim(),
      contactEmail: process.env.PUBLIC_CONTACT_EMAIL!.trim(),
      siteUrl
    };
  }

  /**
   * Renders all published guides and legal pages to static HTML.
   */
  public async build(options: { outputDir?: string; orgId?: string } = {}): Promise<StaticSiteBuildResult> {
    const config = this.validateConfig();

    // Default output directory: frontend dist folder for Firebase Hosting
    const targetDir = options.outputDir || path.resolve(__dirname, '../../../frontend/dist');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filesGenerated: string[] = [];

    // 1. Fetch published guides
    let publishedGuides: any[] = [];
    if (isProduction()) {
      const d1 = D1RevenueRepository.getInstance();
      publishedGuides = await d1.query<any>(
        'commission_content_assets',
        "SELECT * FROM commission_content_assets WHERE status = 'PUBLISHED'"
      );
    } else {
      try {
        const d1 = D1RevenueRepository.getInstance();
        publishedGuides = await d1.query<any>(
          'commission_content_assets',
          "SELECT * FROM commission_content_assets WHERE status = 'PUBLISHED'"
        );
      } catch {
        publishedGuides = [];
      }
      if (publishedGuides.length === 0) {
        const db = getDb();
        try {
          publishedGuides = db.prepare("SELECT * FROM commission_content_assets WHERE status = 'PUBLISHED'").all() as any[];
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

    // 3. Render legal and static informational pages
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

    // 4. Generate sitemap.xml
    const sitemapPath = path.join(targetDir, 'sitemap.xml');
    const sitemapContent = this.generateSitemapXml(publishedGuides, config);
    fs.writeFileSync(sitemapPath, sitemapContent, 'utf-8');
    filesGenerated.push(sitemapPath);

    // 5. Generate robots.txt
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
   * Generates standalone static HTML for a guide, satisfying all 10 crawler and legal constraints.
   */
  public renderGuideHtml(guide: any, config: StaticSiteConfig): string {
    const title = guide.title || 'Product Evaluation & Buying Guide';
    const description = guide.intent_target || guide.meta_description || guide.description || 'Commercial product overview and specification details.';
    const canonicalUrl = `${config.siteUrl}/guides/${guide.slug}`;
    const fullBody = guide.content_markdown || guide.body_markdown || guide.body || '';

    // Convert basic markdown to clean HTML
    const formattedBody = this.markdownToHtml(fullBody);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
  <meta name="description" content="${this.escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${this.escapeHtml(title)}">
  <meta property="og:description" content="${this.escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${this.escapeHtml(config.siteName)}">
  <meta name="author" content="${this.escapeHtml(config.authorName)}">
  <meta name="robots" content="index, follow">
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
      <strong>Disclosure:</strong> As an Amazon Associate I earn from qualifying purchases. We do not test products or show prices; check current details on Amazon.in.
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
      <p>We believe in minimal data collection. We do not maintain user registration accounts for general readers. When you browse our guides, we record anonymous, aggregated server request metrics. Outbound click beacons store a cryptographically salted one-way hash of client IP addresses to guard against abuse without recording raw identifiable personal data.</p>
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
    const canonicalUrl = `${config.siteUrl}/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)} | ${this.escapeHtml(config.siteName)}</title>
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
    // For Amazon links, ensure target="_blank" rel="sponsored nofollow noopener"
    let html = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, url) => {
      const isAmazon = url.includes('amazon.in');
      const rel = isAmazon ? 'sponsored nofollow noopener' : 'noopener noreferrer';
      const className = isAmazon ? ' class="affiliate-link"' : '';
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
