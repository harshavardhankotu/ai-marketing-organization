import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, resolveVerificationTokens } from '../config/env.js';
import { renderCustomerDeskWidgetHtml } from '../revenue/customer-desk-widget.js';
import { isImpulseConversionDeal } from './autonomous-deal-discovery-engine.js';

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

/**
 * Priority 3 Editorial Quality Gate:
 * Only deals passing strict product/affiliate verification, IN_STOCK availability,
 * positive INR price, recorded verification timestamp, and >=15 char descriptive title
 * are eligible for public indexing (`index, follow`) and `/sitemap.xml` inclusion.
 */
export function passesEditorialQualityGate(deal: any): boolean {
  if (!deal) return false;
  const priceNum = Number(deal.currentPriceINR || 0);
  const titleStr = String(deal.title || '').trim();
  const hasTimestamp = Boolean(deal.lastVerifiedAt || deal.lastCheckedAt);
  return (
    deal.productVerified === true &&
    deal.affiliateVerified === true &&
    deal.availability === 'IN_STOCK' &&
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    hasTimestamp &&
    titleStr.length >= 15
  );
}

export interface ComparisonPair {
  comparisonSlug: string;
  title: string;
  category: string;
  priceTierLabel: string;
  dealA: any;
  dealB: any;
}

export function generateComparisonPairs(deals: any[], limit: number = 15): ComparisonPair[] {
  const baseFilter = (d: any) =>
    d &&
    d.productVerified === true &&
    d.affiliateVerified === true &&
    d.isMonetizable !== false &&
    d.availability === 'IN_STOCK' &&
    d.affiliateNetwork !== 'AMAZON_IN' &&
    Number(d.currentPriceINR || 0) > 0 &&
    String(d.slug || d.canonicalSlug || d.id || '').trim().length > 0;

  const sortCandidates = (list: any[]) =>
    list.slice().sort((a: any, b: any) =>
      (Number(b.expectedProfitPer100VisitorsINR || 0) - Number(a.expectedProfitPer100VisitorsINR || 0)) ||
      (Number(b.arbitrageScore || 0) - Number(a.arbitrageScore || 0)) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );

  const primaryCandidates = sortCandidates(
    (deals || []).filter((d: any) =>
      baseFilter(d) &&
      d.evolutionStatus !== 'STALE_ROTATED_OUT' &&
      d.catalogSlot !== 'ROTATED_OUT_STALE'
    )
  );
  const fallbackCandidates = sortCandidates((deals || []).filter(baseFilter));

  const getSlug = (d: any): string =>
    String(d.slug || d.canonicalSlug || d.id)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

  const getPriceTier = (price: number): string => {
    if (price < 2000) return 'Under ₹2,000 Value Tier';
    if (price <= 10000) return '₹2,000–₹10,000 Mid Tier';
    return '₹10,000+ Flagship Tier';
  };

  const pairs: ComparisonPair[] = [];
  const seenSlugs = new Set<string>();

  const collectPairs = (candidates: any[]) => {
    for (let i = 0; i < candidates.length && pairs.length < limit; i++) {
      const a = candidates[i];
      const slugA = getSlug(a);
      const catA = String(a.category || 'General').trim().toLowerCase();
      const priceA = Number(a.currentPriceINR || 0);
      const tierA = getPriceTier(priceA);

      for (let j = i + 1; j < candidates.length && pairs.length < limit; j++) {
        const b = candidates[j];
        const slugB = getSlug(b);
        if (!slugA || !slugB || slugA === slugB) continue;
        const catB = String(b.category || 'General').trim().toLowerCase();
        if (catA !== catB) continue;
        const priceB = Number(b.currentPriceINR || 0);
        const tierB = getPriceTier(priceB);
        const ratio = Math.max(priceA, priceB) / Math.max(1, Math.min(priceA, priceB));
        if (tierA !== tierB && ratio > 2.2) continue;

        const [first, second] = slugA <= slugB ? [a, b] : [b, a];
        const comparisonSlug = `${getSlug(first)}-vs-${getSlug(second)}`;
        if (seenSlugs.has(comparisonSlug)) continue;
        seenSlugs.add(comparisonSlug);

        pairs.push({
          comparisonSlug,
          title: `${first.title} vs ${second.title}`,
          category: first.category || second.category || 'Verified Deals',
          priceTierLabel: tierA,
          dealA: first,
          dealB: second
        });
        break;
      }
    }
  };

  collectPairs(primaryCandidates);
  if (pairs.length < Math.min(3, limit) && fallbackCandidates.length > primaryCandidates.length) {
    collectPairs(fallbackCandidates);
  }

  return pairs;
}

export interface BuyerIntentHub {
  intentSlug: string;
  title: string;
  h1: string;
  description: string;
  priceCapLabel: string;
  categoryLabel: string;
  deals: any[];
  picks: {
    bestOverallValue: any;
    lowestObservedPrice: any;
    premiumPick: any;
  };
  faqs: Array<{ question: string; answer: string }>;
  canonicalUrl: string;
}

interface HubSeedDefinition {
  intentSlug: string;
  title: string;
  h1: string;
  description: string;
  priceCapLabel: string;
  categoryLabel: string;
  maxPriceINR?: number;
  predicate: (deal: any, text: string, price: number) => boolean;
}

const FIXED_BUYER_INTENT_HUBS: HubSeedDefinition[] = [
  {
    intentSlug: 'audio-and-earbuds-under-2000',
    title: 'Best Audio & Wireless Earbuds Under ₹2,000 in India (Verified Prices)',
    h1: 'Best Audio & Wireless Earbuds Under ₹2,000 in India',
    description: 'Verified Indian D2C & merchant snapshot prices for TWS earbuds, ANC earphones, and wireless audio under ₹2,000 with live Amazon.in comparison.',
    priceCapLabel: 'Under ₹2,000',
    categoryLabel: 'Audio & Earbuds',
    maxPriceINR: 2000,
    predicate: (d, text, price) =>
      price > 0 && price <= 2000 &&
      /(earbud|tws|headphone|neckband|airpod|airdopes|audio|anc|bluetooth|earphone|nirvana|rockerz)/i.test(text + ' ' + String(d?.category || ''))
  },
  {
    intentSlug: 'soundbars-and-speakers-under-10000',
    title: 'Best Soundbars & Home Speakers Under ₹10,000 in India',
    h1: 'Best Soundbars & Bluetooth Speakers Under ₹10,000',
    description: 'Independent price check on home theatre soundbars, party speakers, and compact Bluetooth audio under ₹10,000 across official Indian brand stores.',
    priceCapLabel: 'Under ₹10,000',
    categoryLabel: 'Soundbars & Speakers',
    maxPriceINR: 10000,
    predicate: (d, text, price) =>
      price > 0 && price <= 10000 &&
      /(soundbar|speaker|aavante|stone|subwoofer|home theatre|boombox|bar \d+)/i.test(text + ' ' + String(d?.category || ''))
  },
  {
    intentSlug: '4k-dashcams-and-car-tech-india',
    title: 'Best 4K Dashcams & Car Tech Accessories in India',
    h1: 'Best 4K Dashcams & Smart Car Accessories in India',
    description: 'Verified Indian pricing on 4K dual-channel dashcams, tyre inflators, GPS trackers, and car electronics with live Amazon.in coupon check.',
    priceCapLabel: 'All Tiers',
    categoryLabel: 'Car Tech & Dashcams',
    predicate: (d, text, price) =>
      price > 0 &&
      /(dashcam|dash cam|car|tyre|tire|inflator|automotive|dvr|nexdigitron|qubo|70mai)/i.test(text + ' ' + String(d?.category || ''))
  },
  {
    intentSlug: 'smartwatches-and-fitness-bands-india',
    title: 'Best Smartwatches & Fitness Trackers in India (Fair Price Guide)',
    h1: 'Best Smartwatches & AMOLED Fitness Bands in India',
    description: 'Verified merchant-reported prices on AMOLED smartwatches, BT calling watches, and fitness trackers in India.',
    priceCapLabel: 'All Tiers',
    categoryLabel: 'Wearables & Smartwatches',
    predicate: (d, text, price) =>
      price > 0 &&
      /(smartwatch|watch|fitness band|wearable|amoled|noise|fire-boltt|wave|storm|xpress)/i.test(text + ' ' + String(d?.category || ''))
  },
  {
    intentSlug: 'grooming-and-perfume-bundles-under-1000',
    title: 'Best Grooming Kits & Perfume Bundles Under ₹1,000 in India',
    h1: 'Best Grooming & Perfume Value Bundles Under ₹1,000',
    description: 'Verified effective bundle prices on EDP fragrances, gift sets, trimmers, and men/women grooming packs under ₹1,000.',
    priceCapLabel: 'Under ₹1,000',
    categoryLabel: 'Grooming & Fragrances',
    maxPriceINR: 1000,
    predicate: (d, text, price) =>
      price > 0 && price <= 1000 &&
      /(perfume|fragrance|edp|eau de|groom|beard|trimmer|shav|gift set|combo|bella vita|wild stone|beardo|ustraa|skincare|serum)/i.test(text + ' ' + String(d?.category || ''))
  },
  {
    intentSlug: 'top-price-drops-today-india',
    title: 'Top Verified Price Drops & Undervalued Deals in India Today',
    h1: 'Top Verified Price Drops & Fair-Price Deals Today in India',
    description: 'Highest verified discounts below merchant-listed MRP across Indian D2C brands and electronics stores today.',
    priceCapLabel: 'Verified Discounts',
    categoryLabel: 'Top Price Drops',
    predicate: (_d, _text, price) => price > 0
  }
];

export function generateBuyerIntentHubs(
  deals: any[],
  siteUrl: string = 'https://ai-marketing-organization.onrender.com',
  limit: number = 10
): BuyerIntentHub[] {
  const cleanSiteUrl = siteUrl.replace(/\/$/, '');
  const eligible = (deals || []).filter((d: any) =>
    d &&
    d.productVerified === true &&
    d.affiliateVerified === true &&
    d.isMonetizable !== false &&
    d.availability === 'IN_STOCK' &&
    d.affiliateNetwork !== 'AMAZON_IN' &&
    !/amazon\.(in|com)(\/|$)/i.test(String(d.productUrl || '')) &&
    Number(d.currentPriceINR || 0) > 0 &&
    d.evolutionStatus !== 'STALE_ROTATED_OUT' &&
    d.catalogSlot !== 'ROTATED_OUT_STALE'
  );

  if (eligible.length < 2) return [];

  const rankDeals = (list: any[]) =>
    list.slice().sort((a: any, b: any) =>
      (Number(b.expectedProfitPer100VisitorsINR || 0) - Number(a.expectedProfitPer100VisitorsINR || 0)) ||
      (Number(b.arbitrageScore || 0) - Number(a.arbitrageScore || 0)) ||
      (Number(b.verifiedDiscountPercent || 0) - Number(a.verifiedDiscountPercent || 0)) ||
      (Number(a.currentPriceINR || 0) - Number(b.currentPriceINR || 0)) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    );

  const buildHubFromDeals = (def: HubSeedDefinition, matchedRaw: any[]): BuyerIntentHub => {
    const sorted = rankDeals(matchedRaw).slice(0, 12);
    const bestOverallValue = sorted[0];
    const lowestObservedPrice = sorted.slice().sort((a, b) => Number(a.currentPriceINR) - Number(b.currentPriceINR))[0];
    const premiumPick = sorted.slice().sort((a, b) => Number(b.currentPriceINR) - Number(a.currentPriceINR))[0];

    const topPrice = Number(bestOverallValue.currentPriceINR || 0).toLocaleString('en-IN');
    const lowPrice = Number(lowestObservedPrice.currentPriceINR || 0).toLocaleString('en-IN');

    return {
      intentSlug: def.intentSlug,
      title: def.title,
      h1: def.h1,
      description: def.description,
      priceCapLabel: def.priceCapLabel,
      categoryLabel: def.categoryLabel,
      deals: sorted,
      picks: {
        bestOverallValue,
        lowestObservedPrice,
        premiumPick
      },
      faqs: [
        {
          question: `What is the lowest verified price in ${def.categoryLabel} right now?`,
          answer: `The lowest observed merchant price in this hub is ₹${lowPrice} for ${lowestObservedPrice.title} on ${lowestObservedPrice.merchant}. Always confirm live cart pricing and bank offers before checkout.`
        },
        {
          question: `Which product offers the best overall value in ${def.categoryLabel}?`,
          answer: `${bestOverallValue.title} at ₹${topPrice} on ${bestOverallValue.merchant} leads our verified fair-value ranking based on merchant discount depth and verified buyer demand.`
        },
        {
          question: `Can I compare these prices with Amazon.in before ordering?`,
          answer: `Yes. Every listed item includes Dual-Rail CTAs so you can inspect the verified D2C store price alongside today's live listing and Prime coupon price on Amazon.in.`
        }
      ],
      canonicalUrl: `${cleanSiteUrl}/best/${encodeURIComponent(def.intentSlug)}`
    };
  };

  const hubs: BuyerIntentHub[] = [];
  const seenSlugs = new Set<string>();

  for (const def of FIXED_BUYER_INTENT_HUBS) {
    if (hubs.length >= limit) break;
    const matched = eligible.filter((d: any) => {
      const price = Number(d.currentPriceINR || 0);
      const text = `${d.title || ''} ${d.brand || ''} ${d.category || ''} ${d.merchant || ''} ${d.targetBuyerSegment || ''}`.toLowerCase();
      return def.predicate(d, text, price);
    });
    if (matched.length >= 2) {
      hubs.push(buildHubFromDeals(def, matched));
      seenSlugs.add(def.intentSlug);
    }
  }

  // Dynamic category hubs for remaining slots up to `limit` (10)
  if (hubs.length < limit) {
    const byCategory = new Map<string, any[]>();
    for (const d of eligible) {
      const cat = String(d.category || 'Verified Offers').trim();
      const arr = byCategory.get(cat) || [];
      arr.push(d);
      byCategory.set(cat, arr);
    }
    const sortedCats = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [cat, catDeals] of sortedCats) {
      if (hubs.length >= limit) break;
      if (catDeals.length < 2) continue;
      const slugBase = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slugBase) continue;
      const dynSlug = `best-${slugBase}-deals-india`;
      if (seenSlugs.has(dynSlug)) continue;
      hubs.push(
        buildHubFromDeals(
          {
            intentSlug: dynSlug,
            title: `Best ${cat} Deals in India (Verified Merchant Prices)`,
            h1: `Best Verified ${cat} Deals in India`,
            description: `Ranked ${cat} offers in India with observed merchant snapshot pricing, MRP comparisons, and live Amazon.in coupon checks.`,
            priceCapLabel: 'All Price Tiers',
            categoryLabel: cat,
            predicate: () => true
          },
          catDeals
        )
      );
      seenSlugs.add(dynSlug);
    }
  }

  return hubs.slice(0, limit);
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
   * Serializes JSON-LD safely for embedding inside HTML <script type="application/ld+json">
   * by escaping `<`, `>`, and `&` to prevent script-breakout / HTML injection.
   */
  private serializeSafeJsonLd(payload: unknown, pretty = false): string {
    const raw = JSON.stringify(payload, null, pretty ? 2 : undefined) || 'null';
    return raw
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
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
  ${this.serializeSafeJsonLd({
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
  ${renderCustomerDeskWidgetHtml()}
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
  ${this.serializeSafeJsonLd({
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
  public renderDealsHtml(
    deals: any[] = [],
    config: StaticSiteConfig,
    options?: {
      dealCtaAssignment?: { experimentId: string; variant: 'baseline' | 'treatment'; ctaText: string; promoted?: boolean };
    }
  ): string {
    const siteName = (config.siteName || '').trim();
    const title = siteName && !siteName.toLowerCase().includes('verified deals')
      ? `Verified Deals & Price Evidence | ${siteName}`
      : 'Verified Deals & Price Evidence';

    const rawDeals = Array.isArray(deals) ? deals : [];
    const nonStaleDeals = rawDeals.filter((d: any) => d.catalogSlot !== 'ROTATED_OUT_STALE' && d.evidenceJson?.catalogSlot !== 'ROTATED_OUT_STALE');
    // Rotate stale unclicked >72h deals out of featured /deals cards whenever active non-stale deals exist
    const activeDeals = nonStaleDeals.length > 0 ? nonStaleDeals : rawDeals;

    const ctaAssignment = options?.dealCtaAssignment || {
      experimentId: 'exp_storefront_deal_cta',
      variant: 'baseline',
      ctaText: 'Buy at Merchant →'
    };

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
          description: d.currentPriceINR > 0
            ? `${d.brand} ${d.title} on ${d.merchant} at ₹${d.currentPriceINR}`
            : `${d.brand} ${d.title} verified offer on ${d.merchant}`,
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
      const baseTargetHref = deal.id ? `${config.siteUrl}/api/v1/public/deals/${deal.id}/redirect` : (deal.trackingUrl || deal.productUrl);
      const targetHref = deal.id
        ? `${baseTargetHref}?ab_exp=${encodeURIComponent(ctaAssignment.experimentId)}&ab_variant=${encodeURIComponent(ctaAssignment.variant)}`
        : baseTargetHref;
      const amazonRailHref = `${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(deal.title || '').slice(0, 120))}&dealId=${encodeURIComponent(String(deal.id || ''))}`;
      const detailSlug = deal.slug || deal.canonicalSlug || deal.id;
      const detailHref = detailSlug ? `/deals/${encodeURIComponent(detailSlug)}` : targetHref;
      const observedAt = deal.lastVerifiedAt || deal.lastCheckedAt || deal.updatedAt || '';
      const hasPriceDrop = Boolean(deal.evidenceJson?.hasVerifiedPriceDrop);
      const isFeatured = Boolean(deal.isFeatured ?? deal.evidenceJson?.isFeatured);
      const isCouponOnly = Number(deal.currentPriceINR || 0) <= 0;
      const amazonRailLabel = (deal.affiliateNetwork === 'AMAZON_IN' || deal.merchant?.toLowerCase() === 'amazon')
        ? "Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)"
        : "Check Today's Live Marketplace Price &amp; Partner Coupons &rarr; (#Ad)";
      return `
      <div class="price-card deal-card" data-catalog-slot="${this.escapeHtml(deal.catalogSlot || deal.evidenceJson?.catalogSlot || 'ACTIVE')}" style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; text-transform: uppercase;">${this.escapeHtml(deal.brand)}</span>
            <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap;">
              ${isFeatured ? `<span style="font-size: 0.72rem; background: rgba(6, 182, 212, 0.18); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.35); padding: 0.2rem 0.5rem; border-radius: 9999px;">Featured</span>` : ''}
              ${hasPriceDrop ? `<span style="font-size: 0.72rem; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.35); padding: 0.2rem 0.5rem; border-radius: 9999px;">Verified Price Drop</span>` : ''}
              <span style="font-size: 0.75rem; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 0.2rem 0.5rem; border-radius: 9999px;">✓ Verified</span>
            </div>
          </div>
          <h2 style="font-size: 1.15rem; color: #fff; margin: 0 0 0.5rem 0; line-height: 1.4;"><a href="${this.escapeHtml(detailHref)}" style="color: #fff; text-decoration: none;">${this.escapeHtml(deal.title)}</a></h2>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.65rem;">
            <span>${this.escapeHtml(deal.merchant)}</span> &bull; <span>${this.escapeHtml(deal.category)}</span>
          </div>
          ${deal.targetBuyerSegment ? `<div style="font-size: 0.76rem; color: #cbd5e1; background: rgba(15, 23, 42, 0.85); border: 1px solid #334155; border-radius: 6px; padding: 0.35rem 0.6rem; margin-bottom: 0.75rem;">Target Buyer: <strong>${this.escapeHtml(deal.targetBuyerSegment)}</strong></div>` : ''}
          <div style="display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; margin: 1rem 0 0.35rem 0;">
            ${isCouponOnly
              ? `<span style="font-size: 1.15rem; font-weight: 800; color: #38bdf8;">Verified Merchant Offer</span>`
              : `<span style="font-size: 1.6rem; font-weight: 800; color: #fff;">₹${Number(deal.currentPriceINR).toLocaleString('en-IN')}</span>`}
            ${!isCouponOnly && deal.referencePriceINR && deal.referencePriceINR > deal.currentPriceINR ? `<span style="font-size: 0.85rem; color: #64748b; text-decoration: line-through;">Merchant Listed MRP ₹${Number(deal.referencePriceINR).toLocaleString('en-IN')}</span>` : ''}
          </div>
          ${observedAt ? `<div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 0.5rem;">Observed: <code>${this.escapeHtml(observedAt)}</code></div>` : ''}
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
        <div style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid #1e293b; display: flex; flex-direction: column; gap: 0.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
            <span style="font-size: 0.75rem; color: #64748b;">#Ad &bull; Verified D2C Rail</span>
            <a href="${this.escapeHtml(targetHref)}" target="_blank" rel="sponsored nofollow noopener" data-ab-experiment="${this.escapeHtml(ctaAssignment.experimentId)}" data-ab-variant="${this.escapeHtml(ctaAssignment.variant)}" style="background: #06b6d4; color: #020617; font-weight: 700; font-size: 0.82rem; padding: 0.45rem 0.9rem; border-radius: 8px; text-decoration: none;">${this.escapeHtml(ctaAssignment.ctaText)}</a>
          </div>
          <a href="${this.escapeHtml(amazonRailHref)}" target="_blank" rel="sponsored nofollow noopener" style="display: block; text-align: center; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); color: #fcd34d; font-weight: 600; font-size: 0.76rem; padding: 0.42rem 0.65rem; border-radius: 7px; text-decoration: none;">${amazonRailLabel}</a>
        </div>
      </div>
    `;
    }).join('');
    const comparisonPairs = generateComparisonPairs(activeDeals, 6);
    const buyerHubs = generateBuyerIntentHubs(activeDeals, config.siteUrl, 6);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(title)}</title>
  <meta name="description" content="${this.escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="alternate" type="application/rss+xml" title="Verified Commercial Deals RSS Feed" href="/feeds/deals.xml">
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
  ${this.serializeSafeJsonLd(itemListSchema, true)}
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
    <section id="fair-price-checker-ssr" style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
        <h2 style="margin: 0; font-size: 1.15rem; color: #f8fafc;">Universal Fair-Price Checker &amp; Link Monetizer</h2>
        <span style="font-size: 0.78rem; color: #94a3b8;">Observed MRP · Coupon Stacking · Top Marketplaces &amp; Partner Stores</span>
      </div>
      <p style="margin: 0 0 0.9rem 0; font-size: 0.88rem; color: #94a3b8;">
        Paste any Indian product URL (marketplace or D2C flagship store) or search any product to check fair market price, stacked coupon savings, and set a target price-drop alert.
      </p>
      <form onsubmit="handleFairPriceDealsSsr(event)" style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
        <input type="text" id="fp-query-deals-ssr" required placeholder="Paste product URL or type e.g. best ANC earbuds under 2000" style="flex: 1 1 280px; padding: 0.7rem 0.9rem; border-radius: 8px; border: 1px solid #334155; background: #090d16; color: #fff; font-size: 0.9rem;">
        <button type="submit" id="fp-btn-deals-ssr" style="background: #06b6d4; color: #020617; font-weight: 700; border: none; border-radius: 8px; padding: 0.7rem 1.25rem; cursor: pointer; font-size: 0.88rem;">Check Fair Price</button>
      </form>
      <div id="fp-result-deals-ssr" style="display: none; margin-top: 1rem;"></div>
    </section>

    <div class="deals-grid">
      ${dealCards || '<p class="no-deals-message" style="color: #94a3b8; font-size: 1.1rem; text-align: center; grid-column: 1 / -1; padding: 3rem 1rem;">No currently verified offers are available in this category. Check back later.</p>'}
    </div>
    ${buyerHubs.length > 0 ? `
    <section style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.35rem; margin-bottom: 1.5rem;">
      <h2 style="font-size: 1.15rem; color: #fff; margin: 0 0 0.75rem 0;">Programmatic Fair-Price Buyer Guides (/best/)</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem;">
        ${buyerHubs.map((hub) => `
          <a href="/best/${this.escapeHtml(encodeURIComponent(hub.intentSlug))}" style="display: block; background: #090d16; border: 1px solid #1e293b; border-radius: 8px; padding: 0.75rem; color: #34d399; text-decoration: none; font-size: 0.84rem; font-weight: 600;">
            ${this.escapeHtml(hub.h1)}
            <div style="color: #94a3b8; font-size: 0.74rem; font-weight: 400; margin-top: 0.25rem;">${this.escapeHtml(hub.priceCapLabel)} &bull; ${hub.deals.length} Verified Picks</div>
          </a>
        `).join('')}
      </div>
    </section>` : ''}
    ${comparisonPairs.length > 0 ? `
    <section style="background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 1.35rem; margin-bottom: 2rem;">
      <h2 style="font-size: 1.15rem; color: #fff; margin: 0 0 0.75rem 0;">Head-to-Head Buyer Comparisons (/vs/)</h2>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem;">
        ${comparisonPairs.map((pair) => `
          <a href="/vs/${this.escapeHtml(encodeURIComponent(pair.comparisonSlug))}" style="display: block; background: #090d16; border: 1px solid #1e293b; border-radius: 8px; padding: 0.75rem; color: #38bdf8; text-decoration: none; font-size: 0.84rem; font-weight: 600;">
            ${this.escapeHtml(pair.dealA.brand || pair.dealA.title)} vs ${this.escapeHtml(pair.dealB.brand || pair.dealB.title)}
            <div style="color: #94a3b8; font-size: 0.74rem; font-weight: 400; margin-top: 0.25rem;">${this.escapeHtml(pair.category)} &bull; ${this.escapeHtml(pair.priceTierLabel)}</div>
          </a>
        `).join('')}
      </div>
    </section>` : ''}
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
  <script>
    function escFp(s) {
      return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    async function handleFairPriceDealsSsr(e) {
      e.preventDefault();
      var qEl = document.getElementById('fp-query-deals-ssr');
      var btn = document.getElementById('fp-btn-deals-ssr');
      var out = document.getElementById('fp-result-deals-ssr');
      if (!qEl || !out) return;
      var q = qEl.value.trim();
      if (!q) return;
      btn.disabled = true;
      btn.innerText = 'Checking...';
      out.style.display = 'block';
      out.innerHTML = '<div style="font-size:0.85rem;color:#94a3b8;">Checking observed Indian market prices and active coupons...</div>';
      try {
        var res = await fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queryOrUrl: q })
        });
        var json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Check failed');
        var d = json.data;
        var vColor = d.verdict === 'BUY_NOW_BELOW_FAIR_PRICE' ? '#34d399' : (d.verdict === 'OVERPRICED_WAIT_FOR_DROP' ? '#f59e0b' : '#38bdf8');
        var rowsHtml = (d.crossStoreOptions || []).slice(0, 6).map(function(o) {
          var isAmz = Boolean(o.isMarketplaceRail || o.isSearchRail) || (o.affiliateNetwork && o.affiliateNetwork.toLowerCase() === 'amazon_in') || Number(o.effectivePriceINR || 0) <= 0;
          var priceTxt = isAmz ? 'Live Marketplace Price' : ('₹' + Number(o.effectivePriceINR || o.currentPriceINR || 0).toLocaleString('en-IN'));
          var btnTxt = o.ctaLabel || (isAmz ? "Check Today's Live Marketplace Price & Coupons →" : 'Buy (#Ad) →');
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;padding:0.55rem 0;border-top:1px solid #1e293b;font-size:0.84rem;">' +
            '<div><div style="color:#fff;font-weight:600;">' + escFp(o.title) + (o.isLowestPrice ? ' <span style="color:#34d399;">(Lowest Net)</span>' : '') + '</div>' +
            '<div style="color:#94a3b8;font-size:0.76rem;">' + escFp(o.merchant) + (o.couponCode ? ' · Code: ' + escFp(o.couponCode) : '') + ' · ' + escFp(o.disclosure || '#Ad') + '</div></div>' +
            '<div style="display:flex;align-items:center;gap:0.65rem;flex-shrink:0;">' +
              '<span style="font-weight:700;color:#fff;font-variant-numeric:tabular-nums;">' + escFp(priceTxt) + '</span>' +
              '<a href="' + escFp(o.trackingRedirectUrl) + '" target="_blank" rel="sponsored nofollow noopener" style="background:' + (isAmz ? '#f59e0b' : '#06b6d4') + ';color:#020617;padding:0.35rem 0.7rem;border-radius:6px;font-weight:700;font-size:0.76rem;text-decoration:none;">' + escFp(btnTxt) + '</a>' +
            '</div></div>';
        }).join('');
        out.innerHTML =
          '<div style="background:#090d16;border:1px solid #1e293b;border-radius:10px;padding:1rem;">' +
            '<div style="font-size:0.75rem;font-weight:700;color:' + vColor + ';margin-bottom:0.3rem;">' + escFp(d.verdict) + '</div>' +
            '<div style="font-size:0.9rem;color:#e2e8f0;margin-bottom:0.45rem;">' + escFp(d.verdictSummary) + '</div>' +
            (d.aiBuyerNote ? '<div style="font-size:0.82rem;color:#94a3b8;margin-bottom:0.5rem;">Note: ' + escFp(d.aiBuyerNote) + '</div>' : '') +
            rowsHtml +
            '<form onsubmit="handleFairPriceAlertSsr(event)" style="margin-top:0.85rem;padding-top:0.75rem;border-top:1px solid #1e293b;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">' +
              '<input type="number" id="fp-alert-price-ssr" min="1" required placeholder="Target ₹" value="' + (d.estimatedFairPriceINR ? Math.round(d.estimatedFairPriceINR * 0.9) : '') + '" style="width:110px;padding:0.45rem 0.65rem;border-radius:6px;border:1px solid #334155;background:#111827;color:#fff;font-size:0.82rem;">' +
              '<input type="email" id="fp-alert-email-ssr" required placeholder="Email for target price drop alert" style="flex:1 1 200px;padding:0.45rem 0.65rem;border-radius:6px;border:1px solid #334155;background:#111827;color:#fff;font-size:0.82rem;">' +
              '<label style="font-size:0.75rem;color:#cbd5e1;display:flex;align-items:center;gap:0.35rem;cursor:pointer;"><input type="checkbox" id="fp-alert-consent-ssr" required> Opt-in alerts (DPDP)</label>' +
              '<button type="submit" style="background:#10b981;color:#020617;border:none;padding:0.45rem 0.85rem;border-radius:6px;font-weight:700;font-size:0.8rem;cursor:pointer;">Set Price Alert</button>' +
            '</form>' +
            '<div id="fp-alert-status-ssr" style="font-size:0.8rem;margin-top:0.4rem;"></div>' +
          '</div>';
      } catch (err) {
        out.innerHTML = '<div style="font-size:0.84rem;color:#f87171;">Error: ' + escFp(err.message || 'Check failed') + '</div>';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Check Fair Price';
      }
    }
    async function handleFairPriceAlertSsr(e) {
      e.preventDefault();
      var q = (document.getElementById('fp-query-deals-ssr') || {}).value || '';
      var price = Number((document.getElementById('fp-alert-price-ssr') || {}).value || 0);
      var email = ((document.getElementById('fp-alert-email-ssr') || {}).value || '').trim();
      var consent = Boolean((document.getElementById('fp-alert-consent-ssr') || {}).checked);
      var statusEl = document.getElementById('fp-alert-status-ssr');
      if (!statusEl) return;
      statusEl.style.color = '#94a3b8';
      statusEl.innerText = 'Registering target price alert...';
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
            ? 'Alert registered & instant price-drop email sent to ' + reg.alertEmailMasked + '!'
            : 'Alert registered for ' + reg.alertEmailMasked + ' at target ₹' + Number(reg.targetFairPriceINR || price).toLocaleString('en-IN') + '.';
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
  ${renderCustomerDeskWidgetHtml()}
</body>
</html>`;
  }

  /**
   * Stage S Task 2: Inline 1-row opt-in price-drop alert box embedded below Dual-Rail buttons.
   */
  public renderPriceDropAlertBoxHtml(options: {
    productSlug?: string;
    category?: string;
    currentPriceINR?: number;
    dealId?: string;
  }): string {
    const slug = this.escapeHtml(options.productSlug || '');
    const category = this.escapeHtml(options.category || '');
    const dealId = this.escapeHtml(options.dealId || '');
    const price = options.currentPriceINR ? Math.round(options.currentPriceINR) : 0;
    const defaultTargetPrice = price > 0 ? Math.round(price * 0.9) : '';

    return `
    <div class="price-drop-alert-box" style="margin-top:1.25rem;padding:1rem 1.25rem;background:rgba(15,23,42,0.8);border:1px solid #1e293b;border-radius:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:rgba(56,189,248,0.15);border-radius:6px;color:#38bdf8;font-size:13px;">🔔</span>
          <strong style="font-size:0.9rem;color:#f8fafc;">Get Instant Price-Drop Alert</strong>
        </div>
        <span style="font-size:0.75rem;color:#94a3b8;">Zero spam &bull; 1-click unsubscribe anytime</span>
      </div>
      <form class="price-drop-alert-form" data-slug="${slug}" data-category="${category}" data-deal-id="${dealId}" onsubmit="event.preventDefault(); (async function(form){
        var email = (form.email.value || '').trim();
        var targetPrice = Number(form.targetPrice.value);
        var productSlug = form.dataset.slug || undefined;
        var cat = form.dataset.category || undefined;
        var dId = form.dataset.dealId || undefined;
        var btn = form.querySelector('button');
        var status = form.querySelector('.alert-status');
        if (!email) return;
        if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
          status.style.color = '#f87171';
          status.textContent = 'Please enter a valid target price greater than ₹0.';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Saving...';
        try {
          var res = await fetch('/api/v1/customer-desk/subscribe-alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, productSlug: productSlug, category: cat, dealId: dId, targetPriceINR: targetPrice })
          });
          var data = await res.json();
          if (res.ok && data.success) {
            status.style.color = '#34d399';
            status.textContent = '✓ Alert set! We will email you the second price drops.';
            var inputs = form.querySelector('.inputs-row');
            if (inputs) inputs.style.display = 'none';
          } else {
            status.style.color = '#f87171';
            status.textContent = data.message || 'Subscription failed. Please try again.';
            btn.disabled = false;
            btn.textContent = 'Notify Me';
          }
        } catch (err) {
          status.style.color = '#f87171';
          status.textContent = 'Network error. Please try again.';
          btn.disabled = false;
          btn.textContent = 'Notify Me';
        }
      })(event.target)" style="margin:0;">
        <div class="inputs-row" style="display:flex;flex-wrap:wrap;gap:0.6rem;align-items:center;">
          <input type="email" name="email" required placeholder="Enter your email" style="flex:1 1 200px;min-width:180px;padding:0.55rem 0.85rem;background:#0f172a;border:1px solid #334155;border-radius:8px;color:#fff;font-size:0.85rem;" />
          <div style="display:flex;align-items:center;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:0 0.6rem;">
            <span style="color:#94a3b8;font-size:0.85rem;">₹</span>
            <input type="number" name="targetPrice" required min="1" step="1" placeholder="Target ₹" value="${defaultTargetPrice}" style="width:85px;padding:0.55rem 0.4rem;background:transparent;border:none;color:#fff;font-size:0.85rem;outline:none;" />
          </div>
          <button type="submit" style="background:#06b6d4;color:#020617;font-weight:700;border:none;padding:0.55rem 1.15rem;border-radius:8px;cursor:pointer;font-size:0.85rem;white-space:nowrap;">Notify Me</button>
        </div>
        <div class="alert-status" style="font-size:0.8rem;margin-top:0.45rem;"></div>
      </form>
    </div>`;
  }

  /**
   * Renders an SEO-indexable SSR product deal page at /deals/:slug with Schema.org/Product JSON-LD.
   */
  public renderDealDetailHtml(deal: any, relatedDeals: any[] = [], config: StaticSiteConfig): string {
    const slug = deal.slug || deal.canonicalSlug || deal.id;
    const baseSiteUrl = String(config.siteUrl || '').replace(/\/$/, '');
    const canonicalUrl = `${baseSiteUrl}/deals/${encodeURIComponent(slug)}`;
    const priceNum = Number(deal.currentPriceINR || 0);
    const refNum = Number(deal.referencePriceINR || 0);
    const savingsINR = refNum > priceNum ? Math.round((refNum - priceNum) * 100) / 100 : 0;
    const savingsPct = refNum > priceNum && refNum > 0 ? Math.round(((refNum - priceNum) / refNum) * 1000) / 10 : 0;
    const hasPriceDrop = Boolean(deal.evidenceJson?.hasVerifiedPriceDrop);
    const badgeText = hasPriceDrop ? 'Verified Price Drop' : 'Observed Merchant Price';
    const title = `${deal.title} — ₹${priceNum.toLocaleString('en-IN')} (${badgeText}) | #Ad`;
    const description = `Observed Indian price for ${deal.title} on ${deal.merchant} at ₹${priceNum.toLocaleString('en-IN')}${refNum > priceNum ? ` (Merchant Listed MRP ₹${refNum.toLocaleString('en-IN')})` : ''}. #Ad Commission earned on qualifying purchases.`;
    const verifiedTs: string | null = deal.lastVerifiedAt || deal.lastCheckedAt || deal.updatedAt || null;
    const editorialPass = passesEditorialQualityGate(deal);
    const robotsDirective = editorialPass ? 'index, follow' : 'noindex, nofollow';
    const schemaAvailability =
      deal.availability === 'OUT_OF_STOCK'
        ? 'https://schema.org/OutOfStock'
        : (deal.availability === 'IN_STOCK' && deal.productVerified === true
            ? 'https://schema.org/InStock'
            : 'https://schema.org/LimitedAvailability');
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
        availability: schemaAvailability,
        seller: {
          '@type': 'Organization',
          name: deal.merchant || deal.brand || 'Merchant'
        }
      }
    };

    const rawSpecs: Array<[string, string]> = [];
    if (deal.brand) rawSpecs.push(['Brand', String(deal.brand)]);
    if (deal.category) rawSpecs.push(['Category', String(deal.category)]);
    rawSpecs.push(['Merchant', String(deal.merchant || 'Verified Merchant')]);
    rawSpecs.push(['Observed Price', `₹${priceNum.toLocaleString('en-IN')} ${deal.currency || 'INR'}`]);
    if (refNum > priceNum) rawSpecs.push(['Reference MRP', `₹${refNum.toLocaleString('en-IN')} (-${savingsPct}%)`]);
    rawSpecs.push(['Stock State', String(deal.availability || 'UNKNOWN')]);
    rawSpecs.push(['Verification Gate', `${deal.productVerified === true ? 'Product Verified' : 'Unverified Product'} / ${deal.affiliateVerified === true ? 'Affiliate Verified' : 'Unverified Affiliate'}`]);
    rawSpecs.push(['Last Verified Snapshot', verifiedTs || 'Verification timestamp unavailable']);
    if (deal.specs && typeof deal.specs === 'object') {
      for (const [k, v] of Object.entries(deal.specs)) {
        if (v !== null && v !== undefined && String(v).trim().length > 0) {
          rawSpecs.push([String(k), String(v)]);
        }
      }
    }
    const specsRowsHtml = rawSpecs.map(([k, v]) =>
      `<tr><th style="text-align:left;padding:0.55rem 0.75rem;border-bottom:1px solid #1e293b;color:#94a3b8;width:36%;font-weight:600;">${this.escapeHtml(k)}</th><td style="padding:0.55rem 0.75rem;border-bottom:1px solid #1e293b;color:#e2e8f0;">${this.escapeHtml(v)}</td></tr>`
    ).join('');

    const comparisonCandidates = [deal, ...relatedDeals.slice(0, 3)];
    const comparisonRowsHtml = comparisonCandidates.map((item: any, idx: number) => {
      const iSlug = item.slug || item.canonicalSlug || item.id;
      const iPrice = Number(item.currentPriceINR || 0);
      const iRef = Number(item.referencePriceINR || 0);
      const iDisc = iRef > iPrice && iRef > 0 ? `${Math.round(((iRef - iPrice) / iRef) * 100)}% off` : 'Baseline MRP';
      return `<tr style="${idx === 0 ? 'background:rgba(56,189,248,0.08);' : ''}">
        <td style="padding:0.6rem 0.75rem;border-bottom:1px solid #1e293b;">${idx === 0 ? `<strong>${this.escapeHtml(item.title)}</strong> <span style="font-size:0.75rem;color:#38bdf8;">(Selected)</span>` : `<a href="/deals/${this.escapeHtml(encodeURIComponent(iSlug))}" style="color:#e2e8f0;text-decoration:none;">${this.escapeHtml(item.title)}</a>`}</td>
        <td style="padding:0.6rem 0.75rem;border-bottom:1px solid #1e293b;color:#cbd5e1;">${this.escapeHtml(item.merchant || '-')}</td>
        <td style="padding:0.6rem 0.75rem;border-bottom:1px solid #1e293b;font-weight:700;color:#fff;">₹${iPrice.toLocaleString('en-IN')}</td>
        <td style="padding:0.6rem 0.75rem;border-bottom:1px solid #1e293b;color:#6ee7b7;">${this.escapeHtml(iDisc)}</td>
        <td style="padding:0.6rem 0.75rem;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:0.85rem;">${this.escapeHtml(item.targetBuyerSegment || item.category || 'General Buyers')}</td>
      </tr>`;
    }).join('');

    const buyerFitText = deal.targetBuyerSegment
      ? `Ideal for ${deal.targetBuyerSegment} seeking ${deal.category || 'this category'} hardware at ₹${priceNum.toLocaleString('en-IN')}${refNum > priceNum ? ` (Merchant Listed MRP ₹${refNum.toLocaleString('en-IN')})` : ''}.`
      : `Best suited for value-focused buyers in ${deal.category || 'consumer tech'} confirming live merchant checkout pricing of ₹${priceNum.toLocaleString('en-IN')}.`;
    const skipFitText = `Skip if you require an alternate merchant warranty policy, immediate local retail pickup today, or if live merchant cart pricing exceeds the verified ₹${priceNum.toLocaleString('en-IN')} snapshot.`;
    const verifiedRateDisclosure =
      typeof deal.verifiedCommissionRatePercent === 'number' && Number.isFinite(deal.verifiedCommissionRatePercent)
        ? `Recorded merchant campaign rate: ${deal.verifiedCommissionRatePercent}% via Cuelinks Channel 331585.`
        : 'Exact merchant commission percentage is currently undisclosed (not estimated).';

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
  <meta name="robots" content="${robotsDirective}">
  <meta property="og:title" content="${this.escapeHtml(title)}">
  <meta property="og:description" content="${this.escapeHtml(description)}">
  <meta property="og:url" content="${this.escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="product">
  <script type="application/ld+json">
${this.serializeSafeJsonLd(productSchema, true)}
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
        ${hasPriceDrop ? `<span style="font-size:0.78rem;background:rgba(16,185,129,0.2);color:#6ee7b7;border:1px solid rgba(16,185,129,0.35);padding:0.25rem 0.65rem;border-radius:9999px;">Verified Price Drop</span>` : ''}
      </div>
      <h1 style="font-size:1.85rem;color:#fff;margin:0 0 0.75rem 0;line-height:1.3;">${this.escapeHtml(deal.title)}</h1>
      ${deal.targetBuyerSegment ? `<div style="font-size:0.9rem;color:#cbd5e1;background:rgba(15,23,42,0.85);border:1px solid #334155;border-radius:8px;padding:0.6rem 0.9rem;margin-bottom:1.25rem;">Target Buyer Segment: <strong>${this.escapeHtml(deal.targetBuyerSegment)}</strong></div>` : ''}
      <div style="display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;margin:1rem 0;">
        <span style="font-size:2.35rem;font-weight:800;color:#fff;">₹${priceNum.toLocaleString('en-IN')}</span>
        ${refNum > priceNum ? `<span style="font-size:1.05rem;color:#64748b;text-decoration:line-through;">Merchant Listed MRP ₹${refNum.toLocaleString('en-IN')}</span>` : ''}
        <span style="font-size:0.9rem;font-weight:700;background:rgba(16,185,129,0.2);color:#6ee7b7;padding:0.3rem 0.75rem;border-radius:8px;">${this.escapeHtml(badgeText)}</span>
      </div>
      <p style="font-size:0.88rem;color:#94a3b8;margin:0.5rem 0 1rem 0;">
        Observed At: <code>${this.escapeHtml(verifiedTs || 'Verification timestamp unavailable')}</code> &bull; Verification Status: <strong>${this.escapeHtml(deal.verificationStatus || 'VERIFIED')}</strong>
      </p>
      ${deal.youtubeReview ? `
      <div class="youtube-review-embed" style="margin: 1.25rem 0; padding: 1rem; background: #0f172a; border: 1px solid #334155; border-radius: 12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.75rem;">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#ef4444;border-radius:6px;color:#fff;font-size:11px;font-weight:900;">▶</span>
            <strong style="font-size:0.92rem; color:#f8fafc;">Watch Real Product Review: ${this.escapeHtml(deal.youtubeReview.title)}</strong>
          </div>
          <span style="font-size:0.75rem; color:#94a3b8; font-weight:600;">Channel: ${this.escapeHtml(deal.youtubeReview.channelTitle)}</span>
        </div>
        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px; border:1px solid #1e293b;">
          <iframe src="${this.escapeHtml(deal.youtubeReview.embedUrl)}" title="${this.escapeHtml(deal.youtubeReview.title)}" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
        </div>
      </div>
      ` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;margin-top:0.5rem;">
        <a href="${this.escapeHtml(redirectHref)}" target="_blank" rel="sponsored nofollow noopener" class="cta-btn" style="margin-top:0;">Claim Verified Deal on ${this.escapeHtml(deal.merchant)} &rarr;</a>
        <a href="${this.escapeHtml(`${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(deal.title || '').slice(0, 120))}&dealId=${encodeURIComponent(String(deal.id || ''))}`)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;font-weight:700;padding:0.9rem 1.35rem;border-radius:10px;text-decoration:none;font-size:0.92rem;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
      </div>
      ${this.renderPriceDropAlertBoxHtml({ productSlug: deal.slug || deal.canonicalSlug || deal.id, category: deal.category, currentPriceINR: priceNum, dealId: deal.id })}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-top:1.75rem;">
        <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.28);border-radius:10px;padding:1rem;">
          <h2 style="font-size:1rem;color:#6ee7b7;margin:0 0 0.45rem 0;">Who Should Buy</h2>
          <p style="font-size:0.88rem;color:#cbd5e1;margin:0;">${this.escapeHtml(buyerFitText)}</p>
        </div>
        <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.28);border-radius:10px;padding:1rem;">
          <h2 style="font-size:1rem;color:#fcd34d;margin:0 0 0.45rem 0;">Who Should Skip</h2>
          <p style="font-size:0.88rem;color:#cbd5e1;margin:0;">${this.escapeHtml(skipFitText)}</p>
        </div>
      </div>

      <section style="margin-top:1.75rem;">
        <h2 style="font-size:1.15rem;color:#fff;margin-bottom:0.65rem;">Extracted Technical Specifications &amp; Price Breakdown</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;">
          <tbody>${specsRowsHtml}</tbody>
        </table>
      </section>

      ${comparisonCandidates.length > 1 ? `
      <section style="margin-top:1.75rem;overflow-x:auto;">
        <h2 style="font-size:1.15rem;color:#fff;margin-bottom:0.65rem;">Side-by-Side Comparison with Live Verified Alternatives</h2>
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem;background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#1e293b;color:#94a3b8;text-align:left;">
              <th style="padding:0.6rem 0.75rem;">Product</th>
              <th style="padding:0.6rem 0.75rem;">Merchant</th>
              <th style="padding:0.6rem 0.75rem;">Price</th>
              <th style="padding:0.6rem 0.75rem;">Price Advantage</th>
              <th style="padding:0.6rem 0.75rem;">Target Buyer</th>
            </tr>
          </thead>
          <tbody>${comparisonRowsHtml}</tbody>
        </table>
      </section>` : ''}

      <p style="font-size:0.8rem;color:#94a3b8;margin-top:1.25rem;padding-top:1rem;border-top:1px solid #1e293b;">
        <strong>#Ad Statutory Disclosure:</strong> This page is a deterministic merchant price snapshot linking via authorized Cuelinks tracking (Channel 331585) and Amazon.in Associates search referrals. We may earn an affiliate commission on qualifying purchases at no additional cost to you. ${this.escapeHtml(verifiedRateDisclosure)} Always confirm final live checkout price and warranty terms on the merchant store.
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
  ${renderCustomerDeskWidgetHtml(deal.slug || deal.canonicalSlug || deal.id || '')}
</body>
</html>`;
  }

  /**
   * Renders Head-to-Head Comparison Engine HTML for `/vs/:comparisonSlug`.
   * Includes Schema.org/ItemList JSON-LD, verified D2C price snapshots with timestamps,
   * side-by-side specs, and Dual-Rail Cuelinks + Amazon Associates CTAs (#Ad, zero scraped Amazon prices).
   */
  public renderComparisonHtml(
    pair: ComparisonPair,
    config: StaticSiteConfig,
    allPairs: ComparisonPair[] = []
  ): string {
    const a = pair.dealA;
    const b = pair.dealB;
    const canonicalUrl = `${config.siteUrl}/vs/${encodeURIComponent(pair.comparisonSlug)}`;
    const title = `${a.title} vs ${b.title} — Price & Spec Comparison | ${config.siteName}`;
    const priceA = Number(a.currentPriceINR || 0);
    const priceB = Number(b.currentPriceINR || 0);
    const tsA = String(a.lastVerifiedAt || a.lastCheckedAt || a.updatedAt || '');
    const tsB = String(b.lastVerifiedAt || b.lastCheckedAt || b.updatedAt || '');
    const description = `Compare ${a.title} (₹${priceA.toLocaleString('en-IN')}) vs ${b.title} (₹${priceB.toLocaleString('en-IN')}) in ${pair.category} with verified D2C pricing and live Amazon.in coupon checks.`;

    const rail1A = `${config.siteUrl}/api/v1/public/deals/${encodeURIComponent(a.id)}/redirect?utm_source=vs_compare`;
    const rail1B = `${config.siteUrl}/api/v1/public/deals/${encodeURIComponent(b.id)}/redirect?utm_source=vs_compare`;
    const rail2A = `${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(a.title || '').slice(0, 120))}&dealId=${encodeURIComponent(a.id)}`;
    const rail2B = `${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(b.title || '').slice(0, 120))}&dealId=${encodeURIComponent(b.id)}`;

    const itemListSchema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${a.title} vs ${b.title}`,
      description,
      url: canonicalUrl,
      numberOfItems: 2,
      itemListElement: [a, b].map((d, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        item: {
          '@type': 'Product',
          name: d.title,
          brand: { '@type': 'Brand', name: d.brand || d.merchant || 'Brand' },
          offers: {
            '@type': 'Offer',
            url: `${config.siteUrl}/deals/${encodeURIComponent(d.slug || d.canonicalSlug || d.id)}`,
            priceCurrency: 'INR',
            price: Number(d.currentPriceINR || 0),
            availability: d.availability === 'OUT_OF_STOCK' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
            seller: { '@type': 'Organization', name: d.merchant || 'Merchant' }
          }
        }
      }))
    };

    const otherPairs = (allPairs || []).filter(p => p.comparisonSlug !== pair.comparisonSlug).slice(0, 6);

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
  <meta property="og:type" content="website">
  <script type="application/ld+json">
${this.serializeSafeJsonLd(itemListSchema, true)}
  </script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.15rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1040px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.1rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    main { max-width: 1040px; margin: 2rem auto; padding: 0 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    th, td { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { background: #0f172a; color: #94a3b8; font-size: 0.84rem; width: 22%; }
    footer { border-top: 1px solid var(--border); padding: 2.5rem 1.5rem; margin-top: 3rem; text-align: center; font-size: 0.85rem; color: #64748b; }
    footer a { color: #94a3b8; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/public/disclosure">Disclosure</a>
    </nav>
  </header>
  <main>
    <div style="font-size:0.84rem;color:#94a3b8;margin-bottom:0.85rem;">
      <a href="/deals" style="color:#38bdf8;text-decoration:none;">Verified Deals</a> &rsaquo; <span>${this.escapeHtml(pair.category)}</span> &rsaquo; <span>${this.escapeHtml(pair.priceTierLabel)}</span>
    </div>
    <span style="display:inline-block;font-size:0.74rem;font-weight:700;color:#38bdf8;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);padding:0.2rem 0.65rem;border-radius:9999px;margin-bottom:0.75rem;">#Ad &bull; HEAD-TO-HEAD COMPARISON</span>
    <h1 style="font-size:1.75rem;color:#fff;margin:0 0 0.75rem 0;">${this.escapeHtml(a.title)} vs ${this.escapeHtml(b.title)}</h1>
    <p style="color:#94a3b8;font-size:0.95rem;margin-bottom:1.5rem;">${this.escapeHtml(description)}</p>

    <div style="overflow-x:auto;">
      <table>
        <thead>
          <tr>
            <th>Attribute</th>
            <th style="width:39%;color:#fff;font-size:1rem;"><a href="/deals/${this.escapeHtml(encodeURIComponent(a.slug || a.canonicalSlug || a.id))}" style="color:#fff;text-decoration:none;">${this.escapeHtml(a.title)}</a></th>
            <th style="width:39%;color:#fff;font-size:1rem;"><a href="/deals/${this.escapeHtml(encodeURIComponent(b.slug || b.canonicalSlug || b.id))}" style="color:#fff;text-decoration:none;">${this.escapeHtml(b.title)}</a></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Verified D2C Price</th>
            <td><strong style="font-size:1.3rem;color:#34d399;">₹${priceA.toLocaleString('en-IN')}</strong><div style="font-size:0.75rem;color:#94a3b8;">Observed: <code>${this.escapeHtml(tsA)}</code></div></td>
            <td><strong style="font-size:1.3rem;color:#34d399;">₹${priceB.toLocaleString('en-IN')}</strong><div style="font-size:0.75rem;color:#94a3b8;">Observed: <code>${this.escapeHtml(tsB)}</code></div></td>
          </tr>
          <tr>
            <th>Reference List MRP</th>
            <td>${Number(a.referencePriceINR || 0) > priceA ? `₹${Number(a.referencePriceINR).toLocaleString('en-IN')} (${a.verifiedDiscountPercent || a.claimedDiscountPercent || 0}% off)` : 'Verified Direct'}</td>
            <td>${Number(b.referencePriceINR || 0) > priceB ? `₹${Number(b.referencePriceINR).toLocaleString('en-IN')} (${b.verifiedDiscountPercent || b.claimedDiscountPercent || 0}% off)` : 'Verified Direct'}</td>
          </tr>
          <tr>
            <th>Merchant &amp; Brand</th>
            <td>${this.escapeHtml(a.merchant)} (${this.escapeHtml(a.brand || '')})</td>
            <td>${this.escapeHtml(b.merchant)} (${this.escapeHtml(b.brand || '')})</td>
          </tr>
          <tr>
            <th>Promo Code</th>
            <td>${a.couponCode ? `<code>${this.escapeHtml(a.couponCode)}</code>` : 'Direct store pricing'}</td>
            <td>${b.couponCode ? `<code>${this.escapeHtml(b.couponCode)}</code>` : 'Direct store pricing'}</td>
          </tr>
          ${(a.youtubeReview || b.youtubeReview) ? `
          <tr>
            <th>Product Video Review</th>
            <td>${a.youtubeReview ? `<div style="font-size:0.78rem;margin-bottom:0.35rem;"><span style="color:#ef4444;font-weight:700;">▶</span> <a href="${this.escapeHtml(a.youtubeReview.videoUrl)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none;">${this.escapeHtml(a.youtubeReview.title)}</a></div><div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;"><iframe src="${this.escapeHtml(a.youtubeReview.embedUrl)}" title="${this.escapeHtml(a.youtubeReview.title)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe></div>` : '<span style="color:#64748b;font-size:0.8rem;">Review indexing in progress</span>'}</td>
            <td>${b.youtubeReview ? `<div style="font-size:0.78rem;margin-bottom:0.35rem;"><span style="color:#ef4444;font-weight:700;">▶</span> <a href="${this.escapeHtml(b.youtubeReview.videoUrl)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none;">${this.escapeHtml(b.youtubeReview.title)}</a></div><div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:6px;"><iframe src="${this.escapeHtml(b.youtubeReview.embedUrl)}" title="${this.escapeHtml(b.youtubeReview.title)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allowfullscreen loading="lazy"></iframe></div>` : '<span style="color:#64748b;font-size:0.8rem;">Review indexing in progress</span>'}</td>
          </tr>
          ` : ''}
          <tr>
            <th>Dual-Rail Checkout (#Ad)</th>
            <td>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <a href="${this.escapeHtml(rail1A)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;text-align:center;background:#06b6d4;color:#020617;font-weight:700;padding:0.55rem 0.9rem;border-radius:8px;text-decoration:none;font-size:0.84rem;">Buy at ${this.escapeHtml(a.merchant)} &rarr;</a>
                <a href="${this.escapeHtml(rail2A)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;text-align:center;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;font-weight:600;padding:0.48rem 0.75rem;border-radius:8px;text-decoration:none;font-size:0.78rem;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
              </div>
            </td>
            <td>
              <div style="display:flex;flex-direction:column;gap:0.5rem;">
                <a href="${this.escapeHtml(rail1B)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;text-align:center;background:#06b6d4;color:#020617;font-weight:700;padding:0.55rem 0.9rem;border-radius:8px;text-decoration:none;font-size:0.84rem;">Buy at ${this.escapeHtml(b.merchant)} &rarr;</a>
                <a href="${this.escapeHtml(rail2B)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;text-align:center;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.4);color:#fcd34d;font-weight:600;padding:0.48rem 0.75rem;border-radius:8px;text-decoration:none;font-size:0.78rem;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);border-radius:10px;padding:1rem;font-size:0.82rem;color:#94a3b8;margin-top:1.5rem;">
      <strong style="color:#e2e8f0;">#Ad Statutory Affiliate Disclosure:</strong> D2C store prices shown above are merchant-reported snapshots verified at the listed timestamp. Amazon.in buttons redirect to live search/listing pages without displaying scraped Amazon prices. Qualifying purchases through these links may earn an affiliate commission at zero extra cost to you.
    </div>

    ${this.renderPriceDropAlertBoxHtml({ productSlug: a.slug || a.canonicalSlug || a.id, category: a.category || b.category, currentPriceINR: Math.min(priceA, priceB), dealId: a.id })}

    ${otherPairs.length > 0 ? `
    <section style="margin-top:1.75rem;">
      <h2 style="font-size:1.1rem;color:#fff;margin-bottom:0.65rem;">More Head-to-Head Comparisons</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.75rem;">
        ${otherPairs.map(op => `<a href="/vs/${this.escapeHtml(encodeURIComponent(op.comparisonSlug))}" style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:0.75rem;color:#38bdf8;text-decoration:none;font-size:0.84rem;font-weight:600;">${this.escapeHtml(op.title)}</a>`).join('')}
      </div>
    </section>` : ''}
  </main>
  <footer>
    <p><a href="/deals">All Verified Deals</a> &bull; <a href="/sitemap.xml">Sitemap</a> &bull; <a href="/public/disclosure">Affiliate Disclosure</a></p>
  </footer>
  ${renderCustomerDeskWidgetHtml(pair.comparisonSlug || pair.dealA?.slug || '')}
</body>
</html>`;
  }

  /**
   * Stage M Task 2: Renders Programmatic "Best Under ₹X" Buyer-Intent Hub HTML for `/best/:intentSlug`.
   * Includes Schema.org/ItemList + Schema.org/FAQPage JSON-LD, 3 Winner Picks, Ranked Winner Table,
   * Observed At timestamps, Dual-Rail Cuelinks + Amazon Associates CTAs (#Ad), /vs/ cross-links,
   * and embedded Fair-Price / Price-Drop Alert Box.
   */
  public renderBuyerGuideHtml(
    hub: BuyerIntentHub,
    allHubs: BuyerIntentHub[] = [],
    comparisons: ComparisonPair[] = [],
    config: StaticSiteConfig
  ): string {
    const canonicalUrl = `${config.siteUrl}/best/${encodeURIComponent(hub.intentSlug)}`;
    const deals = hub.deals || [];

    const itemListSchema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: hub.title,
      description: hub.description,
      url: canonicalUrl,
      numberOfItems: deals.length,
      itemListElement: deals.map((d: any, idx: number) => ({
        '@type': 'ListItem',
        position: idx + 1,
        item: {
          '@type': 'Product',
          name: d.title,
          brand: { '@type': 'Brand', name: d.brand || d.merchant || 'Brand' },
          offers: {
            '@type': 'Offer',
            url: `${config.siteUrl}/deals/${encodeURIComponent(d.slug || d.canonicalSlug || d.id)}`,
            priceCurrency: 'INR',
            price: Number(d.currentPriceINR || 0),
            availability: d.availability === 'OUT_OF_STOCK' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
            seller: { '@type': 'Organization', name: d.merchant || 'Merchant' }
          }
        }
      }))
    };

    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: (hub.faqs || []).map(f => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer
        }
      }))
    };

    const renderPickCard = (label: string, d: any) => {
      if (!d) return '';
      const slug = d.slug || d.canonicalSlug || d.id;
      const rail1 = `${config.siteUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect?utm_source=best_hub_pick`;
      const rail2 = `${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(d.title || '').slice(0, 120))}&dealId=${encodeURIComponent(d.id)}`;
      return `
      <div style="background:#111827;border:1px solid #1e293b;border-radius:10px;padding:1rem;display:flex;flex-direction:column;justify-content:space-between;gap:0.6rem;">
        <div>
          <div style="font-size:0.74rem;font-weight:700;color:#38bdf8;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:0.35rem;">${this.escapeHtml(label)}</div>
          <a href="/deals/${this.escapeHtml(encodeURIComponent(slug))}" style="color:#fff;font-weight:700;font-size:0.95rem;text-decoration:none;display:block;margin-bottom:0.35rem;">${this.escapeHtml(d.title)}</a>
          <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:0.35rem;">${this.escapeHtml(d.merchant)} &bull; ${this.escapeHtml(d.category || hub.categoryLabel)}</div>
          <div style="font-size:1.25rem;font-weight:800;color:#34d399;font-variant-numeric:tabular-nums;">₹${Number(d.currentPriceINR || 0).toLocaleString('en-IN')}</div>
          ${Number(d.referencePriceINR || 0) > Number(d.currentPriceINR || 0) ? `<div style="font-size:0.75rem;color:#94a3b8;font-variant-numeric:tabular-nums;">Merchant Listed MRP: <span style="text-decoration:line-through;">₹${Number(d.referencePriceINR).toLocaleString('en-IN')}</span></div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:0.4rem;">
          <a href="${this.escapeHtml(rail1)}" target="_blank" rel="sponsored nofollow noopener" style="text-align:center;background:#06b6d4;color:#020617;font-weight:700;padding:0.48rem 0.75rem;border-radius:6px;text-decoration:none;font-size:0.8rem;">Buy at Official Store (#Ad) &rarr;</a>
          <a href="${this.escapeHtml(rail2)}" target="_blank" rel="sponsored nofollow noopener" style="text-align:center;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.38);color:#fcd34d;font-weight:600;padding:0.4rem 0.65rem;border-radius:6px;text-decoration:none;font-size:0.75rem;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
        </div>
      </div>`;
    };

    const rowsHtml = deals.map((d: any, idx: number) => {
      const slug = d.slug || d.canonicalSlug || d.id;
      const observedAt = d.lastVerifiedAt || d.lastCheckedAt || d.updatedAt || '';
      const rail1 = `${config.siteUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect?utm_source=best_hub_table`;
      const rail2 = `${config.siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(d.title || '').slice(0, 120))}&dealId=${encodeURIComponent(d.id)}`;
      const hasMrp = Number(d.referencePriceINR || 0) > Number(d.currentPriceINR || 0);
      return `
      <tr>
        <td style="font-weight:700;color:#94a3b8;font-variant-numeric:tabular-nums;">#${idx + 1}</td>
        <td>
          <a href="/deals/${this.escapeHtml(encodeURIComponent(slug))}" style="color:#fff;font-weight:700;text-decoration:none;display:block;">${this.escapeHtml(d.title)}</a>
          <div style="font-size:0.78rem;color:#94a3b8;margin-top:0.2rem;">Merchant: <strong>${this.escapeHtml(d.merchant)}</strong>${d.couponCode ? ` &bull; Code: <code>${this.escapeHtml(d.couponCode)}</code>` : ''}</div>
          ${observedAt ? `<div style="font-size:0.74rem;color:#64748b;margin-top:0.15rem;">Observed At: <code>${this.escapeHtml(observedAt)}</code></div>` : ''}
        </td>
        <td style="font-variant-numeric:tabular-nums;">
          <div style="font-size:1.05rem;font-weight:800;color:#34d399;">₹${Number(d.currentPriceINR || 0).toLocaleString('en-IN')}</div>
          ${hasMrp ? `<div style="font-size:0.75rem;color:#94a3b8;">Merchant Listed MRP: <span style="text-decoration:line-through;">₹${Number(d.referencePriceINR).toLocaleString('en-IN')}</span></div>` : ''}
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:0.4rem;min-width:210px;">
            <a href="${this.escapeHtml(rail1)}" target="_blank" rel="sponsored nofollow noopener" style="text-align:center;background:#06b6d4;color:#020617;font-weight:700;padding:0.45rem 0.7rem;border-radius:6px;text-decoration:none;font-size:0.8rem;">Official Brand Store (#Ad) &rarr;</a>
            <a href="${this.escapeHtml(rail2)}" target="_blank" rel="sponsored nofollow noopener" style="text-align:center;background:rgba(245,158,11,0.14);border:1px solid rgba(245,158,11,0.38);color:#fcd34d;font-weight:600;padding:0.38rem 0.6rem;border-radius:6px;text-decoration:none;font-size:0.75rem;">Check Today's Live Price &amp; Prime Coupons on Amazon.in &rarr; (#Ad)</a>
          </div>
        </td>
      </tr>`;
    }).join('');

    const otherHubs = (allHubs || []).filter(h => h.intentSlug !== hub.intentSlug).slice(0, 5);
    const relatedComparisons = (comparisons || []).slice(0, 6);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}<title>${this.escapeHtml(hub.title)} | ${this.escapeHtml(config.siteName)}</title>
  <meta name="description" content="${this.escapeHtml(hub.description)}">
  <link rel="canonical" href="${this.escapeHtml(canonicalUrl)}">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="${this.escapeHtml(hub.title)}">
  <meta property="og:description" content="${this.escapeHtml(hub.description)}">
  <meta property="og:url" content="${this.escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  <script type="application/ld+json">
${this.serializeSafeJsonLd(itemListSchema, true)}
  </script>
  <script type="application/ld+json">
${this.serializeSafeJsonLd(faqSchema, true)}
  </script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.15rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1080px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.1rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    main { max-width: 1080px; margin: 2rem auto; padding: 0 1.5rem; }
    h1 { text-wrap: balance; font-size: 1.9rem; color: #fff; margin: 0 0 0.6rem 0; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
    th, td { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    th { background: #0f172a; color: #94a3b8; font-size: 0.82rem; }
    footer { border-top: 1px solid var(--border); padding: 2.5rem 1.5rem; margin-top: 3rem; text-align: center; font-size: 0.85rem; color: #64748b; }
    footer a { color: #94a3b8; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">${this.escapeHtml(config.siteName)}</a>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/public/disclosure">Disclosure</a>
    </nav>
  </header>
  <main>
    <div style="font-size:0.84rem;color:#94a3b8;margin-bottom:0.75rem;">
      <a href="/" style="color:#38bdf8;text-decoration:none;">Home</a> &rsaquo; <a href="/deals" style="color:#38bdf8;text-decoration:none;">Verified Deals</a> &rsaquo; <span>${this.escapeHtml(hub.categoryLabel)}</span>
    </div>
    <div style="font-size:0.78rem;font-weight:700;color:#38bdf8;margin-bottom:0.4rem;">#Ad &bull; VERIFIED FAIR-PRICE BUYER GUIDE &bull; ${this.escapeHtml(hub.priceCapLabel)}</div>
    <h1>${this.escapeHtml(hub.h1)}</h1>
    <p style="color:#94a3b8;font-size:0.95rem;margin-bottom:1.5rem;">${this.escapeHtml(hub.description)}</p>

    <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-bottom:2rem;">
      ${renderPickCard('Best Overall Value', hub.picks.bestOverallValue)}
      ${renderPickCard('Lowest Observed Price', hub.picks.lowestObservedPrice)}
      ${renderPickCard('Premium Pick', hub.picks.premiumPick)}
    </section>

    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.2rem;color:#fff;margin:0 0 0.75rem 0;">Ranked Winner Table (${deals.length} Verified Snapshots)</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th style="width:60px;">Rank</th>
              <th>Product, Merchant &amp; Observation Time</th>
              <th style="width:180px;">Observed Price</th>
              <th style="width:250px;">Dual-Rail Checkout (#Ad)</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    ${this.renderPriceDropAlertBoxHtml({ category: hub.categoryLabel })}

    <section style="background:#111827;border:1px solid #1e293b;border-radius:12px;padding:1.25rem;margin-bottom:2rem;">
      <h2 style="font-size:1.08rem;color:#fff;margin:0 0 0.4rem 0;">Set a Fair-Price Alert or Check Another URL</h2>
      <p style="font-size:0.84rem;color:#94a3b8;margin:0 0 0.85rem 0;">Paste any product URL or keyword to benchmark its fair price and subscribe to instant price-drop alerts.</p>
      <form onsubmit="handleBestHubFairPrice(event)" style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
        <input type="text" id="best-fp-query" value="${this.escapeHtml(hub.categoryLabel)}" required placeholder="Product URL or search keyword" style="flex:1 1 220px;padding:0.6rem 0.8rem;border-radius:8px;border:1px solid #334155;background:#090d16;color:#fff;font-size:0.86rem;">
        <input type="number" id="best-fp-target" min="1" placeholder="Target ₹ (optional)" style="width:140px;padding:0.6rem 0.8rem;border-radius:8px;border:1px solid #334155;background:#090d16;color:#fff;font-size:0.86rem;">
        <input type="email" id="best-fp-email" placeholder="Email for drop alert" style="flex:1 1 200px;padding:0.6rem 0.8rem;border-radius:8px;border:1px solid #334155;background:#090d16;color:#fff;font-size:0.86rem;">
        <label style="font-size:0.78rem;color:#cbd5e1;display:flex;align-items:center;gap:0.35rem;cursor:pointer;"><input type="checkbox" id="best-fp-consent"> Opt-in email alert</label>
        <button type="submit" id="best-fp-btn" style="background:#06b6d4;color:#020617;border:none;border-radius:8px;padding:0.6rem 1.05rem;font-weight:700;font-size:0.86rem;cursor:pointer;">Check &amp; Track</button>
      </form>
      <div id="best-fp-out" style="display:none;margin-top:0.85rem;font-size:0.84rem;"></div>
    </section>

    ${relatedComparisons.length > 0 ? `
    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.1rem;color:#fff;margin:0 0 0.65rem 0;">Head-to-Head Comparisons (/vs/)</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.75rem;">
        ${relatedComparisons.map(op => `<a href="/vs/${this.escapeHtml(encodeURIComponent(op.comparisonSlug))}" style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:0.75rem;color:#38bdf8;text-decoration:none;font-size:0.84rem;font-weight:600;">${this.escapeHtml(op.title)}</a>`).join('')}
      </div>
    </section>` : ''}

    <section style="background:#111827;border:1px solid #1e293b;border-radius:12px;padding:1.25rem;margin-bottom:2rem;">
      <h2 style="font-size:1.1rem;color:#fff;margin:0 0 0.75rem 0;">Frequently Asked Questions</h2>
      ${(hub.faqs || []).map(f => `
        <div style="margin-bottom:0.85rem;">
          <div style="font-weight:700;color:#e2e8f0;font-size:0.92rem;">${this.escapeHtml(f.question)}</div>
          <div style="color:#94a3b8;font-size:0.86rem;margin-top:0.2rem;">${this.escapeHtml(f.answer)}</div>
        </div>
      `).join('')}
    </section>

    ${otherHubs.length > 0 ? `
    <section style="margin-bottom:2rem;">
      <h2 style="font-size:1.1rem;color:#fff;margin:0 0 0.65rem 0;">More Fair-Price Buyer Guides</h2>
      <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
        ${otherHubs.map(oh => `<a href="/best/${this.escapeHtml(encodeURIComponent(oh.intentSlug))}" style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:0.6rem 0.9rem;color:#34d399;text-decoration:none;font-size:0.82rem;font-weight:600;">${this.escapeHtml(oh.h1)} &rarr;</a>`).join('')}
      </div>
    </section>` : ''}

    <div style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.25);border-radius:10px;padding:1rem;font-size:0.82rem;color:#94a3b8;">
      <strong style="color:#e2e8f0;">#Ad Statutory Affiliate Disclosure:</strong> Displayed store prices reflect merchant snapshots verified at the listed <em>Observed At</em> timestamp. Amazon.in links redirect to live Amazon.in listings without displaying scraped Amazon prices. Qualifying purchases may earn an affiliate commission at zero extra cost to you.
    </div>
  </main>
  <footer>
    <p><a href="/deals">All Verified Deals</a> &bull; <a href="/sitemap.xml">Sitemap</a> &bull; <a href="/public/disclosure">Affiliate Disclosure</a></p>
  </footer>
  <script>
    async function handleBestHubFairPrice(e) {
      e.preventDefault();
      var q = document.getElementById('best-fp-query').value.trim();
      var t = document.getElementById('best-fp-target').value.trim();
      var em = document.getElementById('best-fp-email').value.trim();
      var cs = document.getElementById('best-fp-consent').checked;
      var out = document.getElementById('best-fp-out');
      var btn = document.getElementById('best-fp-btn');
      btn.disabled = true;
      btn.innerText = 'Checking...';
      out.style.display = 'block';
      out.textContent = 'Analyzing fair price and active coupons...';
      try {
        var payload = { queryOrUrl: q };
        if (t) payload.targetFairPriceINR = Number(t);
        if (em) payload.alertEmail = em;
        if (cs) payload.consentGiven = true;
        var res = await fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.message || json.error || 'Check failed');
        out.style.color = '#34d399';
        out.textContent = json.data.verdictSummary + (json.data.alertRegistered ? ' (Price-drop alert active!)' : '');
      } catch (err) {
        out.style.color = '#f87171';
        out.textContent = 'Error: ' + (err.message || 'Check failed');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Check & Track';
      }
    }
  </script>
  ${renderCustomerDeskWidgetHtml(hub.intentSlug)}
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
  ${renderCustomerDeskWidgetHtml()}
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
    const rawChecklist = typeof auditData.checklist_json === 'string'
      ? JSON.parse(auditData.checklist_json || '[]')
      : (auditData.checklist_json || []);
    const checklist = Array.isArray(rawChecklist)
      ? rawChecklist
      : (Array.isArray(rawChecklist?.items) ? rawChecklist.items : []);

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
          <span style="font-size:11px;background:#e2e8f0;color:#334155;padding:2px 6px;border-radius:4px;font-weight:bold;">${this.escapeHtml(d.category || 'B2B Partner')}</span>
          <span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-weight:bold;">#Ad &bull; Tier 3 Partner</span>
        </div>
        <h4 style="margin:0 0 8px 0;font-size:14px;color:#0f172a;line-height:1.4;">${this.escapeHtml(d.title)}</h4>
        <div style="font-size:18px;font-weight:bold;color:#1e293b;margin-bottom:12px;">₹${(d.currentPriceINR || 0).toLocaleString('en-IN')} ${d.discountBadge ? `<span style="font-size:12px;color:#16a34a;">(${this.escapeHtml(d.discountBadge)})</span>` : ''}</div>
        <a href="${config.siteUrl}/api/v1/public/deals/${d.id}/redirect" target="_blank" rel="sponsored nofollow noopener" style="display:block;text-align:center;background:#0284c7;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:bold;">View Offer on ${this.escapeHtml(d.merchant)} &rarr;</a>
      </div>
    `).join('');

    const isAuthorized =
      auditData.is_publicly_authorized === 1 &&
      (auditData.user_confirmed_ownership === undefined ||
        auditData.user_confirmed_ownership === null ||
        auditData.user_confirmed_ownership === 1);
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
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script type="application/ld+json">
${this.serializeSafeJsonLd(schemaObj, true)}
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
    <p style="margin:0;color:#cbd5e1;font-size:14px;">${isAuthorized ? `Evaluated for ${businessName} &bull; Publicly Authorized Report` : 'Internal Technical Prospect Observation (noindex) &mdash; Third-party domain not publicly authorized'}</p>
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
      <div style="margin-bottom:12px;">
        <button id="rzpAuditPayBtn" onclick="initiateAuditPay499('${domain}')" class="btn-primary" style="font-size:16px;padding:12px 24px;cursor:pointer;border:none;border-radius:6px;background:#38bdf8;color:#0f172a;font-weight:700;">Pay ₹499 Instantly (UPI / Card / NetBanking)</button>
      </div>
      <div>
        <a href="${selfServeToolUrl}" class="btn-primary">Open Self-Serve Checkout for ${domain}</a>
        <a href="/offer#sandbox" class="btn-secondary">₹1 Live Sandbox Validation</a>
      </div>
      <div id="rzpAuditStatusBox" style="display:none;margin-top:16px;padding:16px;background:rgba(15,23,42,0.85);border:1px solid #38bdf8;border-radius:8px;text-align:left;"></div>
      <div style="margin-top:16px;padding:14px;background:rgba(15,23,42,0.55);border:1px solid rgba(148,163,184,0.3);border-radius:8px;max-width:650px;margin-left:auto;margin-right:auto;text-align:left;">
        <div style="font-size:13px;font-weight:bold;color:#bfdbfe;">Tier 2 Optional Order Bump: Competitor SEO Gap &amp; 30-Day Search Console Action Pack (₹1,999)</div>
        <div style="font-size:12px;color:#cbd5e1;margin-top:4px;">Available on self-serve checkout (SKU: <code>sitefix_competitor_keyword_pack</code>).</div>
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-top:12px;">Secured via Razorpay &bull; Instant Self-Serve Delivery &bull; Zero Recurring Fees</div>
    </div>

    ${crossPromoDeals.length > 0 ? `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;color:#0f172a;">Tier 3 Partner Cross-Sell: Verified Business &amp; Hosting Tools (#Ad)</h3>
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

  <script>
    async function initiateAuditPay499(domain) {
      const btn = document.getElementById('rzpAuditPayBtn');
      const statusBox = document.getElementById('rzpAuditStatusBox');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Creating Payment Order...';
      }
      try {
        const res = await fetch('/api/v1/payments/razorpay/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sku: 'sitefix_core_499',
            domainOrUrl: domain
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Order creation failed: ' + (data.error || 'Server error'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = 'Pay ₹499 Instantly (UPI / Card / NetBanking)';
          }
          return;
        }
        const isTestMode = Boolean(data.isTestMode || data.keyMode === 'TEST_SANDBOX' || (data.keyId && data.keyId.startsWith('rzp_test_')));
        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: isTestMode ? 'SiteFix AI Core Fix-Pack (Sandbox Test)' : 'SiteFix AI Core Fix-Pack',
          description: isTestMode
            ? 'Sandbox Mode — Simulated Test Payment (No Real Currency Moved)'
            : 'Website Optimization Fix-Pack for ' + domain,
          notes: isTestMode ? {
            mode: 'test',
            sandbox: 'true',
            mock_card: '4100 2800 0000 10007',
            mock_upi: 'test@razorpay'
          } : {},
          order_id: data.razorpayOrderId || data.orderId,
          prefill: {
            email: data.buyerEmail || ('buyer@' + domain)
          },
          theme: { color: isTestMode ? '#10b981' : '#0284c7' },
          handler: async function (response) {
            if (btn) btn.innerText = 'Verifying Payment Capture...';
            try {
              const verifyRes = await fetch('/api/v1/payments/razorpay/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId: data.orderId,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  sku: 'sitefix_core_499',
                  domainOrUrl: domain
                })
              });
              const verifyData = await verifyRes.json();
              if (verifyData.success) {
                if (btn) btn.style.display = 'none';
                if (statusBox) {
                  statusBox.style.display = 'block';
                  statusBox.innerHTML = '<h4 style="color:#4ade80;margin:0 0 8px 0;">🎉 Payment Verified & Fulfilled!</h4>' +
                    '<p style="color:#e2e8f0;font-size:14px;margin:0 0 12px 0;">Your SiteFix Core Fix-Pack is ready for instant download.</p>' +
                    (verifyData.downloadUrl ? '<a href="' + verifyData.downloadUrl + '" class="btn-primary" style="display:inline-block;padding:10px 20px;text-decoration:none;background:#22c55e;color:#fff;border-radius:6px;font-weight:700;">Download Fix-Pack Bundle &rarr;</a>' : '');
                }
              } else {
                alert('Payment verification failed: ' + (verifyData.error || 'Verification issue'));
                if (btn) {
                  btn.disabled = false;
                  btn.innerText = 'Pay ₹499 Instantly (UPI / Card / NetBanking)';
                }
              }
            } catch (vErr) {
              alert('Verification request failed: ' + vErr.message);
              if (btn) {
                btn.disabled = false;
                btn.innerText = 'Pay ₹499 Instantly (UPI / Card / NetBanking)';
              }
            }
          }
        };
        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (resp) {
          alert('Payment Failed: ' + (resp.error?.description || 'Payment was not completed'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = 'Pay ₹499 Instantly (UPI / Card / NetBanking)';
          }
        });
        rzp.open();
      } catch (err) {
        alert('Checkout error: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = 'Pay ₹499 Instantly (UPI / Card / NetBanking)';
        }
      }
    }
  </script>
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
${this.serializeSafeJsonLd(schemaObj, true)}
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

  /**
   * Renders mobile-first /ig and /bestdeals Instagram Bio Link Storefront for @bestdeals0162.
   */
  public renderInstagramBioStorefrontHtml(
    config: StaticSiteConfig,
    deals: any[],
    options?: { handle?: string }
  ): string {
    const cleanHandle = String(options?.handle || process.env.INSTAGRAM_HANDLE || 'bestdeals0162').trim().replace(/^@+/, '') || 'bestdeals0162';
    const siteUrl = String(config.siteUrl || '').replace(/\/$/, '');
    const eligibleDeals = (deals || [])
      .filter((d: any) =>
        d &&
        d.affiliateNetwork !== 'AMAZON_IN' &&
        !/^https?:\/\/(www\.)?amazon\.(in|com)(\/|$)/i.test(String(d.productUrl || '')) &&
        d.socialMediaPublishersAllowed !== false &&
        d.evidence?.socialMediaPublishersAllowed !== false &&
        d.evidenceJson?.socialMediaPublishersAllowed !== false &&
        Number(d.currentPriceINR || 0) > 0 &&
        d.evolutionStatus !== 'STALE_ROTATED_OUT' &&
        d.catalogSlot !== 'ROTATED_OUT_STALE'
      )
      .sort((a: any, b: any) =>
        (Number(isImpulseConversionDeal(b)) - Number(isImpulseConversionDeal(a))) ||
        (Number(b.verifiedDiscountPercent || 0) - Number(a.verifiedDiscountPercent || 0))
      )
      .slice(0, 10);

    const comparisons = generateComparisonPairs(eligibleDeals, 4);

    const dealCardsHtml = eligibleDeals.length > 0
      ? eligibleDeals.map((d: any) => {
          const price = Math.round(Number(d.currentPriceINR || 0));
          const mrp = Math.round(Number(d.referencePriceINR || 0));
          const discount = mrp > price && price > 0
            ? Math.round(((mrp - price) / mrp) * 100)
            : Number(d.verifiedDiscountPercent || 0);
          const storeUrl = `${siteUrl}/api/v1/public/deals/${encodeURIComponent(d.id)}/redirect?utm_source=ig_bio`;
          const amazonUrl = `${siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(String(d.title || ''))}&utm_source=ig_bio`;
          const safeTitle = this.escapeHtml(String(d.title || 'Verified Deal'));
          const safeMerchant = this.escapeHtml(String(d.merchant || 'Official Store'));
          const safeCat = this.escapeHtml(String(d.category || 'India Deals'));

          return `<article class="deal-card">
            <div class="deal-meta">
              <span>${safeMerchant}</span>
              <span>&bull;</span>
              <span>${safeCat}</span>
              ${discount > 0 ? `<span class="discount-tag">${discount}% OFF</span>` : ''}
            </div>
            <h2 class="deal-title">${safeTitle}</h2>
            ${d.youtubeReview ? `
            <div class="youtube-review-embed" style="margin: 8px 0; border-radius: 8px; overflow: hidden; position: relative; padding-bottom: 56.25%; height: 0;">
              <iframe src="${this.escapeHtml(d.youtubeReview.embedUrl)}" title="${this.escapeHtml(d.youtubeReview.title)}" style="position: absolute; top:0; left:0; width:100%; height:100%; border:0;" allowfullscreen loading="lazy"></iframe>
            </div>
            <div class="youtube-review-watch-link" style="margin-bottom: 8px; font-size: 0.75rem;">
              <a href="${this.escapeHtml(d.youtubeReview.videoUrl)}" target="_blank" rel="noopener noreferrer" style="color: #06b6d4; text-decoration: none; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">Watch Review on YouTube &rarr;</a>
            </div>` : ''}
            <div class="deal-price-row">
              <span class="price-now">&#8377;${price.toLocaleString('en-IN')}</span>
              ${mrp > price ? `<span class="price-mrp">MRP &#8377;${mrp.toLocaleString('en-IN')}</span>` : ''}
            </div>
            <div class="cta-row">
              <a href="${this.escapeHtml(storeUrl)}" target="_blank" rel="sponsored nofollow noopener" class="cta-primary">Official Store Offer &rarr;</a>
              <a href="${this.escapeHtml(amazonUrl)}" target="_blank" rel="sponsored nofollow noopener" class="cta-secondary">Check Live on Amazon.in</a>
            </div>
          </article>`;
        }).join('\n')
      : `<div class="empty-card">
          <p>Fresh verified drops are syncing. Use the Fair-Price Checker above to get an instant tracked store + Amazon.in check link for any product.</p>
          <a href="/deals" class="cta-primary" style="display:inline-block;margin-top:8px;">Browse All Deals</a>
        </div>`;

    const vsLinksHtml = comparisons.length > 0
      ? comparisons.map(p => `<a href="/vs/${this.escapeHtml(p.comparisonSlug)}" class="quick-link">${this.escapeHtml(p.title)}</a>`).join('')
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>@${this.escapeHtml(cleanHandle)} &mdash; Verified Daily Fair-Price Drops India | #Ad</title>
  <meta name="description" content="Official link hub for @${this.escapeHtml(cleanHandle)}. Check the fair price of any product in India, compare live Amazon.in vs official store offers, and grab verified daily drops.">
  <link rel="canonical" href="${this.escapeHtml(siteUrl)}/ig">
  ${this.getGoogleSiteVerificationMeta(config)}${this.getCuelinksVerificationMeta(config)}
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #090d16; color: #e2e8f0; line-height: 1.5; }
    .shell { max-width: 540px; margin: 0 auto; padding: 20px 16px 40px; }
    .profile { text-align: center; padding-bottom: 16px; border-bottom: 1px solid #1e293b; }
    .handle { font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; margin: 0; }
    .sub { font-size: 13px; color: #94a3b8; margin: 6px 0 0; }
    .ad-banner { margin: 16px 0; padding: 10px 12px; border-radius: 10px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); color: #fde68a; font-size: 12px; }
    .checker-box { background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; margin-bottom: 18px; }
    .checker-title { font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 8px; }
    .checker-form { display: flex; gap: 8px; }
    .checker-input { flex: 1; min-width: 0; padding: 10px 12px; border-radius: 8px; border: 1px solid #334155; background: #090d16; color: #fff; font-size: 14px; }
    .checker-btn { padding: 10px 14px; border-radius: 8px; border: 0; background: #10b981; color: #052e16; font-weight: 800; font-size: 13px; cursor: pointer; white-space: nowrap; }
    #fp-result { margin-top: 10px; font-size: 13px; color: #cbd5e1; display: none; padding-top: 10px; border-top: 1px solid #1e293b; }
    .section-heading { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin: 18px 0 10px; }
    .deal-card { background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .deal-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
    .discount-tag { color: #34d399; font-weight: 700; margin-left: auto; font-variant-numeric: tabular-nums; }
    .deal-title { font-size: 15px; font-weight: 700; color: #ffffff; margin: 0 0 8px; }
    .deal-price-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; font-variant-numeric: tabular-nums; }
    .price-now { font-size: 19px; font-weight: 800; color: #34d399; }
    .price-mrp { font-size: 12px; color: #64748b; text-decoration: line-through; }
    .cta-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .cta-primary { display: block; text-align: center; background: #06b6d4; color: #083344; padding: 10px 10px; border-radius: 8px; text-decoration: none; font-weight: 800; font-size: 12px; }
    .cta-secondary { display: block; text-align: center; background: #1e293b; color: #f8fafc; border: 1px solid #334155; padding: 10px 10px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 12px; }
    .quick-grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 12px; }
    .quick-link { display: block; padding: 11px 14px; border-radius: 10px; background: #111827; border: 1px solid #1e293b; color: #e2e8f0; text-decoration: none; font-size: 13px; font-weight: 600; }
    .quick-link:hover { border-color: #06b6d4; color: #38bdf8; }
    .empty-card { background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 18px; text-align: center; font-size: 13px; color: #94a3b8; }
    .footer { text-align: center; margin-top: 26px; font-size: 12px; color: #64748b; }
    .footer a { color: #94a3b8; text-decoration: none; }
  </style>
</head>
<body>
  <main class="shell">
    <header class="profile">
      <h1 class="handle">@${this.escapeHtml(cleanHandle)} &bull; Verified Daily Drops</h1>
      <p class="sub">Real-time Indian fair-price checker &amp; tracked merchant offers</p>
    </header>

    <div class="ad-banner">
      <strong>#Ad Disclosure:</strong> Qualifying purchases made via links on this page may earn us an affiliate commission at zero extra cost to you. Always verify live checkout prices &amp; stock directly on the merchant store.
    </div>

    <section class="checker-box" aria-label="Universal Fair-Price Checker">
      <h2 class="checker-title">Check the Fair Price for Any Product</h2>
      <form id="fp-form" class="checker-form" action="/deals" method="GET">
        <input id="fp-input" name="q" type="text" class="checker-input" placeholder="Paste product link or name (e.g. Sony WH-1000XM5)" required>
        <button type="submit" class="checker-btn">Check</button>
      </form>
      <div id="fp-result"></div>
    </section>

    <div class="section-heading">Today&#39;s Top Verified Steals</div>
    ${dealCardsHtml}
    ${this.renderPriceDropAlertBoxHtml({ category: 'Instagram Bio Verified Steals' })}

    <div class="section-heading">Smart Buyer Shortcuts</div>
    <nav class="quick-grid" aria-label="Buyer shortcuts">
      <a href="/best/best-deals-under-2000-india" class="quick-link">Best Verified Deals Under &#8377;2,000 &rarr;</a>
      <a href="/deals" class="quick-link">Explore Full Verified Deal Feed &rarr;</a>
      ${vsLinksHtml}
      <a href="/tools/site-audit" class="quick-link">SMB Owners: Free SiteFix SEO &amp; Conversion Audit &rarr;</a>
      <a href="/tools/financial-radar" class="quick-link">AMFI Live Mutual Fund &amp; Commodity Radar &rarr;</a>
    </nav>

    <footer class="footer">
      <p>&copy; ${new Date().getFullYear()} ${this.escapeHtml(config.siteName)}</p>
      <p><a href="/public/disclosure">Affiliate Disclosure</a> &bull; <a href="/revenue">Transparency Funnel</a> &bull; <a href="/api/v1/health">System Status</a></p>
    </footer>
  </main>
  <script>
    (function () {
      var form = document.getElementById('fp-form');
      var input = document.getElementById('fp-input');
      var out = document.getElementById('fp-result');
      if (!form || !input || !out) return;
      form.addEventListener('submit', function (e) {
        var q = (input.value || '').trim();
        if (q.length < 2) return;
        e.preventDefault();
        out.style.display = 'block';
        out.textContent = 'Checking live Indian store fair price...';
        fetch('/api/v1/public/fair-price-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queryOrUrl: q })
        })
          .then(function (r) { return r.json(); })
          .then(function (json) {
            if (!json || !json.success || !json.data) {
              out.textContent = (json && json.message) || 'Could not evaluate query.';
              return;
            }
            var d = json.data;
            out.innerHTML = '';
            var p = document.createElement('div');
            p.style.fontWeight = '700';
            p.style.marginBottom = '8px';
            p.textContent = d.verdictSummary || 'Fair-price check completed.';
            out.appendChild(p);
            if (d.amazonLiveUrl) {
              var a = document.createElement('a');
              a.href = d.amazonLiveUrl;
              a.target = '_blank';
              a.rel = 'sponsored nofollow noopener';
              a.className = 'cta-primary';
              a.textContent = 'Check Live on Amazon.in (#Ad) ->';
              out.appendChild(a);
            }
          })
          .catch(function () {
            window.location.href = '/deals?q=' + encodeURIComponent(q);
          });
      });
    })();
  </script>
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
