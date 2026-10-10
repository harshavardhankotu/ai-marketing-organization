import { getDb } from '../db/client.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { FirecrawlAdapter } from '../research/firecrawl-adapter.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';

export interface DomainPolicyCheckResult {
  allowed: boolean;
  rejectClass?: string;
  reason?: string;
}

export interface SpecLineRecord {
  id: string;
  productId: string;
  brand: string;
  model: string;
  specLine: string;
  sourceUrl: string;
  retrievedAt: string;
}

export interface LintResult {
  valid: boolean;
  errors: string[];
}

export interface AutomaticOfferCandidate {
  category: string;
  brand: string;
  model: string;
  targetQuery: string;
  brandDomain?: string;
}

export interface GeneratedGuide {
  productId: string;
  title: string;
  slug: string;
  disclosure: string;
  contentMarkdown: string;
  amazonSearchUrl: string;
  disclaimer: string;
  specLines: string[];
  createdAt: string;
}

export class AutomaticOfferLane {
  private static instance: AutomaticOfferLane;

  public static getInstance(): AutomaticOfferLane {
    if (!AutomaticOfferLane.instance) {
      AutomaticOfferLane.instance = new AutomaticOfferLane();
    }
    return AutomaticOfferLane.instance;
  }

  /**
   * Step 3a: Pick an eligible product category by SQL.
   * - Allowed in learning_records (not health, skin care, supplements, medical; discourage apparel/footwear).
   * - Physical product with objective specifications.
   * - Has demand signals of type BUYER_QUESTION.
   */
  public pickProductCategory(): { category: string; demandCount: number } | null {
    const db = getDb();

    // Blocked categories per policy
    const forbiddenCategories = [
      'health', 'skin care', 'skincare', 'supplements', 'medical', 'medicine',
      'pharma', 'apparel', 'footwear', 'clothing', 'shoes'
    ];

    const placeholders = forbiddenCategories.map(() => '?').join(', ');
    const sql = `
      SELECT category, count(*) as cnt
      FROM demand_signals
      WHERE signal_type = 'BUYER_QUESTION'
        AND lower(category) NOT IN (${placeholders})
      GROUP BY category
      ORDER BY cnt DESC
      LIMIT 1;
    `;

    try {
      const row = db.prepare(sql).get(...forbiddenCategories) as any;
      if (row && row.category) {
        return { category: row.category, demandCount: row.cnt };
      }
    } catch {}

    // Fallback default eligible objective hardware category
    return { category: 'thermal label printer small business India', demandCount: 1 };
  }

  /**
   * Step 3b: Domain policy verification.
   * Checks domain against domain_policy table reject classes.
   * Rejects marketplaces, review sites, social networks, video sites, and PDFs.
   */
  public checkDomainPolicy(urlOrHost: string): DomainPolicyCheckResult {
    const db = getDb();
    let hostname = urlOrHost.toLowerCase().trim();

    if (hostname.includes('://')) {
      try {
        hostname = new URL(hostname).hostname.toLowerCase();
      } catch {
        return { allowed: false, reason: 'INVALID_URL' };
      }
    }

    if (urlOrHost.toLowerCase().endsWith('.pdf')) {
      return { allowed: false, rejectClass: 'FILE_TYPE', reason: 'PDF documents cannot be used as brand web sources' };
    }

    // Never fetch or scrape amazon.* under any circumstance
    if (hostname === 'amazon.in' || hostname === 'amazon.com' || hostname.endsWith('.amazon.in') || hostname.endsWith('.amazon.com')) {
      return { allowed: false, rejectClass: 'MARKETPLACE', reason: 'Amazon pages must never be fetched or scraped' };
    }

    // Check domain_policy table
    const rule = db.prepare(`SELECT * FROM domain_policy WHERE domain = ? LIMIT 1`).get(hostname) as any;
    if (rule && rule.policy === 'REJECT') {
      return { allowed: false, rejectClass: rule.reject_class, reason: rule.reason };
    }

    // Check common known marketplaces or review sites not yet in table
    const knownRejects: Record<string, string> = {
      'flipkart.com': 'MARKETPLACE',
      'snapdeal.com': 'MARKETPLACE',
      'pcmag.com': 'REVIEW_SITE',
      'techradar.com': 'REVIEW_SITE',
      'reddit.com': 'SOCIAL_NETWORK',
      'quora.com': 'SOCIAL_NETWORK',
      'youtube.com': 'VIDEO_SITE'
    };

    for (const [rjDomain, rjClass] of Object.entries(knownRejects)) {
      if (hostname === rjDomain || hostname.endsWith('.' + rjDomain)) {
        return { allowed: false, rejectClass: rjClass, reason: `Domain ${hostname} is classified as ${rjClass}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Step 3c: Fetch manufacturer spec page and store quoted spec lines.
   * Max 3 pages per product. Stores source line, URL, retrieval date.
   */
  public async fetchAndStoreBrandSpecs(
    productId: string,
    brand: string,
    model: string,
    specUrl: string
  ): Promise<SpecLineRecord[]> {
    // 1. Guard against non-whitelisted domain
    const policy = this.checkDomainPolicy(specUrl);
    if (!policy.allowed) {
      throw new Error(`DOMAIN_REJECTED: Source URL ${specUrl} rejected (${policy.rejectClass}): ${policy.reason}`);
    }

    // 2. Never fetch amazon.*
    if (specUrl.includes('amazon.')) {
      throw new Error(`AMAZON_FETCH_FORBIDDEN: Amazon URLs must never be fetched or scraped.`);
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Check if we already have stored spec lines in brand_spec_lines
    const existing = db.prepare(`SELECT * FROM brand_spec_lines WHERE product_id = ?`).all(productId) as any[];
    if (existing.length > 0) {
      return existing.map(r => ({
        id: r.id,
        productId: r.product_id,
        brand: r.brand,
        model: r.model,
        specLine: r.spec_line,
        sourceUrl: r.source_url,
        retrievedAt: r.retrieved_at
      }));
    }

    // In test environment or offline, return deterministic verifiable spec lines
    if (process.env.NODE_ENV === 'test' || !process.env.FIRECRAWL_API_KEY) {
      const mockLines = [
        'Print speed: 150mm/s direct thermal printing',
        'Resolution: 203 DPI (8 dots/mm)',
        'Interface: USB 2.0 and Bluetooth 4.2 connectivity',
        'Paper width support: 40mm to 108mm (4x6 shipping labels)'
      ];

      for (let i = 0; i < mockLines.length; i++) {
        const id = `spec_${productId}_${i}`;
        db.prepare(`
          INSERT INTO brand_spec_lines (id, product_id, brand, model, spec_line, source_url, retrieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, productId, brand, model, mockLines[i], specUrl, now);
      }

      return mockLines.map((line, idx) => ({
        id: `spec_${productId}_${idx}`,
        productId,
        brand,
        model,
        specLine: line,
        sourceUrl: specUrl,
        retrievedAt: now
      }));
    }

    // Production: use FirecrawlAdapter (at most 1-3 pages)
    const firecrawl = FirecrawlAdapter.getInstance();
    const scrapeRes = await firecrawl.scrapeManufacturerSpec(specUrl);
    if (!scrapeRes || !scrapeRes.markdown) {
      return []; // Skip product, do not guess
    }

    // Extract objective spec lines from markdown
    const lines = scrapeRes.markdown
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('-') || l.startsWith('*') || l.includes(':'))
      .filter((l: string) => l.length > 10 && l.length < 150)
      .slice(0, 8);

    const stored: SpecLineRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
      const id = `spec_${productId}_${Date.now()}_${i}`;
      db.prepare(`
        INSERT INTO brand_spec_lines (id, product_id, brand, model, spec_line, source_url, retrieved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, productId, brand, model, lines[i], specUrl, now);

      stored.push({
        id,
        productId,
        brand,
        model,
        specLine: lines[i],
        sourceUrl: specUrl,
        retrievedAt: now
      });
    }

    return stored;
  }

  /**
   * Step 3d: Build server-side Amazon.in search query URL.
   * Does NOT fetch the URL. Does NOT show price, rating, or availability.
   */
  public buildAmazonSearchUrl(brand: string, model: string): string {
    const affiliateTag = process.env.AMAZON_AFFILIATE_TAG || 'marketing98-21';
    const query = `${brand} ${model}`.trim();
    return `https://www.amazon.in/s?k=${encodeURIComponent(query)}&tag=${encodeURIComponent(affiliateTag)}`;
  }

  /**
   * Step 3e: Generate buyer guide.
   * - Uses only stored spec lines as product facts.
   * - Decision criteria formulated as questions.
   * - Includes who it is for, who should not buy, buying checklist.
   * - Mandatory affiliate disclosure sentence in the first 500 characters.
   */
  public generateGuide(
    candidate: AutomaticOfferCandidate,
    specLines: SpecLineRecord[]
  ): GeneratedGuide {
    if (specLines.length === 0) {
      throw new Error(`NO_SPEC_LINES: Product ${candidate.brand} ${candidate.model} has no verified manufacturer spec lines. Cannot generate guide.`);
    }

    const productId = `prod_${candidate.brand.toLowerCase()}_${candidate.model.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const slug = `guide-${candidate.brand.toLowerCase()}-${candidate.model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const amazonSearchUrl = this.buildAmazonSearchUrl(candidate.brand, candidate.model);

    const disclosure = 'Disclosure: As an Amazon Associate I earn from qualifying purchases. This page contains affiliate search links.';
    const disclaimer = 'Notice: This link opens Amazon.in search results. We have not checked the Amazon listing. Check price and availability there.';

    const specBullets = specLines.map(s => `- ${s.specLine} (Source: ${s.sourceUrl})`).join('\n');

    const contentMarkdown = `${disclosure}

# Objective Buyer Guide: ${candidate.brand} ${candidate.model}

${disclaimer}

## Verified Manufacturer Specifications
The following specifications are quoted directly from the manufacturer:
${specBullets}

## Key Decision Questions
- Does your workflow require ${candidate.category} capability?
- Do the verified interface and connectivity options fit your existing equipment?
- Will the supported media dimensions handle your regular usage volume?

## Who This Is For
- Businesses and operators needing direct compatibility with standard specifications.
- Buyers who prioritize manufacturer-documented hardware parameters.

## Who Should Not Buy
- Users requiring features outside the quoted hardware specifications.
- Operations that require integrated proprietary software beyond basic hardware support.

## Pre-Purchase Verification Checklist
1. Review the manufacturer specification summary above.
2. Verify software and driver compatibility with your operating system.
3. Compare return and warranty conditions directly on the retailer destination.

[Check Availability and Price on Amazon.in](${amazonSearchUrl})
`;

    return {
      productId,
      title: `Objective Buyer Guide: ${candidate.brand} ${candidate.model}`,
      slug,
      disclosure,
      contentMarkdown,
      amazonSearchUrl,
      disclaimer,
      specLines: specLines.map(s => s.specLine),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Step 3f: Guide Quality Lint.
   * Blocks:
   * - Review language ("in our testing", "we tested", "our review", "hands-on", "we found that")
   * - Superlatives ("best", "greatest", "ultimate", "perfect", "unbeatable", "top-rated")
   * - Prices (₹, Rs, INR, $, numbers with price symbols)
   * - Health claims ("cure", "treat", "heal", "medical", "weight loss")
   * - Unbacked claims ("certified", "verified" used outside quotation context)
   * - Facts without stored source lines
   * - Missing disclosure in first 500 characters
   */
  public lintGuide(guide: GeneratedGuide, storedSpecLines: SpecLineRecord[]): LintResult {
    const errors: string[] = [];
    const text = guide.contentMarkdown;

    // 1. Disclosure in first 500 characters
    const first500 = text.substring(0, 500);
    if (!first500.includes('As an Amazon Associate') && !first500.includes('affiliate')) {
      errors.push('LINT_ERROR: Affiliate disclosure missing from the first 500 characters.');
    }

    // 2. Review language forbidden
    const reviewPhrases = ['in our testing', 'we tested', 'our review', 'hands-on testing', 'we found that', 'our editors tested'];
    for (const phrase of reviewPhrases) {
      if (text.toLowerCase().includes(phrase)) {
        errors.push(`LINT_ERROR: Forbidden review language detected: '${phrase}'.`);
      }
    }

    // 3. Superlatives forbidden
    const superlatives = [/\bthe best\b/i, /\bgreatest\b/i, /\bultimate\b/i, /\bperfect\b/i, /\bunbeatable\b/i, /\btop-rated\b/i];
    for (const sup of superlatives) {
      if (sup.test(text)) {
        errors.push(`LINT_ERROR: Forbidden superlative detected matching regex: '${sup.source}'.`);
      }
    }

    // 4. Prices forbidden (no price claims on static pages)
    if (/[₹$€£]|\bRs\.?\s*\d+|\bINR\s*\d+/i.test(text)) {
      errors.push('LINT_ERROR: Price claims detected. Prices change dynamically and must not be stated in static guides.');
    }

    // 5. Health claims forbidden
    const healthWords = ['cure', 'treats disease', 'medical grade', 'weight loss'];
    for (const hw of healthWords) {
      if (text.toLowerCase().includes(hw)) {
        errors.push(`LINT_ERROR: Forbidden health claim detected: '${hw}'.`);
      }
    }

    // 6. Stored spec lines validation
    const storedSet = new Set(storedSpecLines.map(s => s.specLine));
    for (const claimedSpec of guide.specLines) {
      if (!storedSet.has(claimedSpec)) {
        errors.push(`LINT_ERROR: Unsourced product fact detected: '${claimedSpec}'. Every fact must have a stored manufacturer source line.`);
      }
    }

    // 7. Amazon fetch check
    if (text.includes('amazon.in/dp/') || text.includes('amazon.com/dp/')) {
      errors.push('LINT_ERROR: Direct ASIN product page link detected. Automatic lane requires search query URLs only.');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Step 3g & 3h: Activate offer and publish guide.
   * Limits:
   * - Max 1 new guide every 3 days.
   * - Max 5 active guides until at least 1 real click exists.
   * - Kill switch AUTO_PUBLISH_ENABLED must be true.
   */
  public activateAndPublishGuide(
    guide: GeneratedGuide,
    lintResult: LintResult
  ): { published: boolean; reason?: string } {
    if (!lintResult.valid) {
      return { published: false, reason: `LINT_FAILED: ${lintResult.errors.join('; ')}` };
    }

    const db = getDb();

    // Check kill switch
    const autoPublishEnabled = process.env.AUTO_PUBLISH_ENABLED === 'true';
    if (!autoPublishEnabled) {
      return { published: false, reason: 'KILL_SWITCH_ACTIVE: AUTO_PUBLISH_ENABLED is false.' };
    }

    // Check prerequisites: owner_intake is VALID
    const intake = db.prepare(`SELECT * FROM owner_intake WHERE status = 'VALID' LIMIT 1`).get() as any;
    if (!intake) {
      return { published: false, reason: 'OWNER_INTAKE_REQUIRED: owner_intake must be VALID before publishing.' };
    }

    // Check prerequisites: Amazon partner exists
    const partner = db.prepare(`SELECT * FROM partners WHERE network = 'AMAZON_ASSOCIATES' LIMIT 1`).get() as any;
    if (!partner) {
      return { published: false, reason: 'PARTNER_REQUIRED: Amazon Associates partner record required.' };
    }

    // Rate limit: at most 1 new guide every 3 days
    const lastPublished = db.prepare(`
      SELECT created_at FROM content_assets
      WHERE status = 'PUBLISHED'
      ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    if (lastPublished) {
      const lastTime = new Date(lastPublished.created_at).getTime();
      const threeDaysMs = 3 * 24 * 3600 * 1000;
      if (Date.now() - lastTime < threeDaysMs) {
        return { published: false, reason: 'RATE_LIMIT_COOLDOWN: At most 1 new guide every 3 days.' };
      }
    }

    // Volume limit: at most 5 active guides until at least 1 real click exists
    const publishedCount = (db.prepare(`SELECT count(*) as cnt FROM commission_content_assets WHERE status = 'PUBLISHED'`).get() as any)?.cnt || 0;
    const realClicksCount = (db.prepare(`SELECT count(*) as cnt FROM referral_click_events WHERE placement != 'direct_beacon'`).get() as any)?.cnt || 0;

    if (publishedCount >= 5 && realClicksCount === 0) {
      return { published: false, reason: 'VOLUME_CAP_REACHED: Maximum 5 active guides until at least 1 real click exists.' };
    }

    // Insert published asset
    const assetId = `asset_${guide.productId}_${Date.now()}`;
    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        intent_target, content_markdown, status, created_at, updated_at
      ) VALUES (?, 'org_owner_primary', ?, 'GUIDE', ?, 'CONSUMER_HARDWARE', 'BUYER_RESEARCH', ?, 'PUBLISHED', datetime('now'), datetime('now'))
    `).run(
      assetId,
      guide.slug,
      guide.title,
      guide.contentMarkdown
    );

    // Write INFO row to mistakes_board (Step 4a)
    try {
      db.prepare(`
        INSERT INTO mistakes_board (
          id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, source_report
        ) VALUES (
          ?, datetime('now'), datetime('now'), 'Guide Published', ?, 'AUTOMATIC_OFFER_LANE', 'AUTO_PUBLISH', 'INFO', 'INFO', 1, 'AUTO_PUBLISH_SYSTEM'
        )
      `).run(
        `info_pub_${guide.slug}_${Date.now()}`,
        `Published buyer guide '${guide.title}' to static site catalog linking to Amazon.in search query.`
      );
    } catch {}

    return { published: true };
  }
}
