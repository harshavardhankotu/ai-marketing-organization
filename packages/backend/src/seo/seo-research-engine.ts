/**
 * SeoResearchEngine & IndexNowSubmitter
 *
 * Implements V4.1 Phase 6:
 * - Real keyword provenance tracking with strictly null/UNKNOWN for unmeasured search volume/difficulty.
 * - Search intent classification (Informational, Comparison, Commercial Investigation, Transactional, Local Service).
 * - Keyword clustering and canonical URL mapping with cannibalization detection.
 * - Real IndexNow HTTP payload submission with response validation.
 * - Automated sitemap.xml and robots.txt generation.
 */

import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

export type SearchIntent =
  | 'INFORMATIONAL'
  | 'COMPARISON'
  | 'COMMERCIAL_INVESTIGATION'
  | 'TRANSACTIONAL'
  | 'LOCAL_SERVICE';

export interface SeoKeywordRecord {
  id: string;
  keyword: string;
  searchIntent: SearchIntent;
  targetVertical: string;
  canonicalSlug: string | null;
  clusterName: string | null;
  provenance: string; // 'CUSTOMER_INQUIRY', 'SEARCH_CONSOLE', 'SERP_PUBLIC', 'SEED_VERIFIED'
  searchVolume: number | null; // NULL if unmeasured (no fabrication)
  difficulty: number | null; // NULL if unmeasured
  lastRetrievedAt: string;
}

export interface OnPageAuditResult {
  hasTitle: boolean;
  titleLength: number;
  hasMetaDescription: boolean;
  metaDescriptionLength: number;
  hasCanonicalTag: boolean;
  canonicalUrl: string | null;
  hasH1: boolean;
  h1Count: number;
  hasSchemaJsonLd: boolean;
  hasAffiliateDisclosure: boolean;
  issues: string[];
}

export const SEEDED_VERIFIED_KEYWORDS: Array<Omit<SeoKeywordRecord, 'id' | 'lastRetrievedAt'>> = [
  // Healthcare / Dental Practice Triage
  {
    keyword: 'dental clinic dark hours appointment booking hyderabad',
    searchIntent: 'LOCAL_SERVICE',
    targetVertical: 'HEALTHCARE_DENTAL',
    canonicalSlug: 'healthcare-triage-guide',
    clusterName: 'dental-lead-triage',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  {
    keyword: 'whatsapp lead triage for indian dental clinics',
    searchIntent: 'COMMERCIAL_INVESTIGATION',
    targetVertical: 'HEALTHCARE_DENTAL',
    canonicalSlug: 'healthcare-triage-guide',
    clusterName: 'dental-lead-triage',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  {
    keyword: 'how to stop patient drop off after clinic hours',
    searchIntent: 'INFORMATIONAL',
    targetVertical: 'HEALTHCARE_DENTAL',
    canonicalSlug: 'healthcare-triage-guide',
    clusterName: 'dental-lead-triage',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  // Education & Coaching Institutes
  {
    keyword: 'whatsapp instant brochure delivery for coaching institutes',
    searchIntent: 'COMMERCIAL_INVESTIGATION',
    targetVertical: 'EDUCATION_COACHING',
    canonicalSlug: 'education-lead-capture-guide',
    clusterName: 'coaching-brochure-capture',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  {
    keyword: 'student lead capture hyderabad coaching institutes',
    searchIntent: 'LOCAL_SERVICE',
    targetVertical: 'EDUCATION_COACHING',
    canonicalSlug: 'education-lead-capture-guide',
    clusterName: 'coaching-brochure-capture',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  // Affiliate Commerce: Domestic Travel & SaaS
  {
    keyword: 'akasa air baggage allowance and student discount india',
    searchIntent: 'COMPARISON',
    targetVertical: 'AFFILIATE_TRAVEL',
    canonicalSlug: 'akasa-air-baggage-guide',
    clusterName: 'domestic-flights-guide',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  },
  {
    keyword: 'air india express vs akasa air cancellation charges comparison',
    searchIntent: 'COMPARISON',
    targetVertical: 'AFFILIATE_TRAVEL',
    canonicalSlug: 'akasa-air-baggage-guide',
    clusterName: 'domestic-flights-guide',
    provenance: 'SEED_VERIFIED',
    searchVolume: null,
    difficulty: null
  }
];

export class IndexNowSubmitter {
  /**
   * Submits a list of URLs to the IndexNow protocol endpoint.
   * Real HTTP submission with status code verification.
   */
  public static async submitUrls(
    host: string,
    key: string,
    keyLocation: string,
    urlList: string[],
    fetchFn: typeof fetch = globalThis.fetch
  ): Promise<{
    success: boolean;
    statusCode: number;
    submittedCount: number;
    message: string;
  }> {
    if (!urlList || urlList.length === 0) {
      return { success: true, statusCode: 200, submittedCount: 0, message: 'Zero URLs to submit.' };
    }

    const cleanKey = (key || '').trim();
    if (!cleanKey || !/^[a-zA-Z0-9-]{8,128}$/.test(cleanKey)) {
      return { success: true, statusCode: 200, submittedCount: 0, message: 'SKIPPED_NO_INDEXNOW_KEY' };
    }

    const payload = {
      host,
      key,
      keyLocation,
      urlList
    };

    try {
      const res = await fetchFn('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': 'ai-marketing-organization-seo/1.0'
        },
        body: JSON.stringify(payload)
      });

      // IndexNow returns 200 OK or 202 Accepted on success
      const ok = res.status === 200 || res.status === 202;
      return {
        success: ok,
        statusCode: res.status,
        submittedCount: ok ? urlList.length : 0,
        message: ok
          ? `Successfully submitted ${urlList.length} URLs to IndexNow (HTTP ${res.status}).`
          : `IndexNow submission returned HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        success: false,
        statusCode: 0,
        submittedCount: 0,
        message: `IndexNow HTTP network error: ${err.message}`
      };
    }
  }
}

export class SeoResearchEngine {
  private static instance: SeoResearchEngine;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): SeoResearchEngine {
    if (!SeoResearchEngine.instance) {
      SeoResearchEngine.instance = new SeoResearchEngine();
    }
    return SeoResearchEngine.instance;
  }

  public static resetInstance(): void {
    SeoResearchEngine.instance = undefined as any;
  }

  /**
   * Seeds core verified keywords into the database.
   */
  public async ensureSeeded(): Promise<number> {
    let seeded = 0;
    for (const kw of SEEDED_VERIFIED_KEYWORDS) {
      const id = `kw_${kw.targetVertical.toLowerCase()}_${kw.clusterName}_${seeded + 1}`;
      const sql = `
        INSERT OR IGNORE INTO seo_keywords (
          id, keyword, search_intent, target_vertical, canonical_slug,
          cluster_name, provenance, search_volume, difficulty, last_retrieved_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `;
      const params = [
        id,
        kw.keyword,
        kw.searchIntent,
        kw.targetVertical,
        kw.canonicalSlug,
        kw.clusterName,
        kw.provenance,
        kw.searchVolume,
        kw.difficulty
      ];

      try {
        if (isProduction()) {
          await this.d1Repo.executeWrite('seo_keywords', sql, params);
        } else {
          getDb().prepare(sql).run(...params);
        }
        seeded++;
      } catch (err: any) {
        console.warn(`[SeoEngine] Notice seeding keyword: ${err.message}`);
      }
    }
    return seeded;
  }

  /**
   * Deterministically classifies search intent from keyword phrasing.
   */
  public classifySearchIntent(keyword: string): SearchIntent {
    const lower = keyword.toLowerCase();

    if (
      lower.includes('near me') ||
      lower.includes('hyderabad') ||
      lower.includes('bangalore') ||
      lower.includes('bengaluru') ||
      lower.includes('clinic') ||
      lower.includes('center') ||
      lower.includes('centre') ||
      lower.includes('hospital')
    ) {
      return 'LOCAL_SERVICE';
    }

    if (
      lower.includes('vs') ||
      lower.includes('versus') ||
      lower.includes('compare') ||
      lower.includes('comparison') ||
      lower.includes('difference between')
    ) {
      return 'COMPARISON';
    }

    if (
      lower.includes('buy') ||
      lower.includes('book') ||
      lower.includes('order') ||
      lower.includes('coupon') ||
      lower.includes('discount code') ||
      lower.includes('checkout')
    ) {
      return 'TRANSACTIONAL';
    }

    if (
      lower.includes('best') ||
      lower.includes('top') ||
      lower.includes('review') ||
      lower.includes('pricing') ||
      lower.includes('cost') ||
      lower.includes('charges')
    ) {
      return 'COMMERCIAL_INVESTIGATION';
    }

    return 'INFORMATIONAL';
  }

  /**
   * Groups keywords into topic clusters and identifies cannibalization risks.
   */
  public clusterKeywords(keywords: SeoKeywordRecord[]): {
    clusters: Record<string, SeoKeywordRecord[]>;
    cannibalizationRisks: Array<{ canonicalSlug: string; clusters: string[] }>;
  } {
    const clusters: Record<string, SeoKeywordRecord[]> = {};
    const slugToClusters: Record<string, Set<string>> = {};

    for (const kw of keywords) {
      const cluster = kw.clusterName || 'unclustered';
      if (!clusters[cluster]) {
        clusters[cluster] = [];
      }
      clusters[cluster].push(kw);

      if (kw.canonicalSlug) {
        if (!slugToClusters[kw.canonicalSlug]) {
          slugToClusters[kw.canonicalSlug] = new Set();
        }
        slugToClusters[kw.canonicalSlug].add(cluster);
      }
    }

    const cannibalizationRisks: Array<{ canonicalSlug: string; clusters: string[] }> = [];
    for (const [slug, clusterSet] of Object.entries(slugToClusters)) {
      if (clusterSet.size > 1) {
        cannibalizationRisks.push({
          canonicalSlug: slug,
          clusters: Array.from(clusterSet)
        });
      }
    }

    return { clusters, cannibalizationRisks };
  }

  /**
   * Audits on-page HTML for critical technical and affiliate SEO factors.
   */
  public auditOnPageHtml(html: string): OnPageAuditResult {
    const issues: string[] = [];

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const hasTitle = Boolean(titleMatch);
    const titleLength = titleMatch ? titleMatch[1].trim().length : 0;
    if (!hasTitle) issues.push('MISSING_TITLE_TAG');
    else if (titleLength < 30) issues.push('TITLE_TAG_TOO_SHORT');
    else if (titleLength > 70) issues.push('TITLE_TAG_TOO_LONG');

    // Meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const hasMetaDescription = Boolean(descMatch);
    const metaDescriptionLength = descMatch ? descMatch[1].trim().length : 0;
    if (!hasMetaDescription) issues.push('MISSING_META_DESCRIPTION');
    else if (metaDescriptionLength < 60) issues.push('META_DESCRIPTION_TOO_SHORT');
    else if (metaDescriptionLength > 160) issues.push('META_DESCRIPTION_TOO_LONG');

    // Canonical
    const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
    const hasCanonicalTag = Boolean(canonicalMatch);
    const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;
    if (!hasCanonicalTag) issues.push('MISSING_CANONICAL_LINK');

    // H1
    const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [];
    const h1Count = h1Matches.length;
    const hasH1 = h1Count > 0;
    if (!hasH1) issues.push('MISSING_H1_TAG');
    else if (h1Count > 1) issues.push('MULTIPLE_H1_TAGS');

    // Schema.org JSON-LD
    const hasSchemaJsonLd = /<script[^>]*type=["']application\/ld\+json["']/i.test(html);
    if (!hasSchemaJsonLd) issues.push('MISSING_STRUCTURED_DATA_SCHEMA');

    // Affiliate Disclosure
    const hasAffiliateDisclosure = /affiliate disclosure|commission may be earned|partner disclosure|advertising disclosure/i.test(html);

    return {
      hasTitle,
      titleLength,
      hasMetaDescription,
      metaDescriptionLength,
      hasCanonicalTag,
      canonicalUrl,
      hasH1,
      h1Count,
      hasSchemaJsonLd,
      hasAffiliateDisclosure,
      issues
    };
  }

  /**
   * Generates a compliant XML sitemap for a list of URLs.
   */
  public generateSitemapXml(urls: string[]): string {
    const urlElements = urls.map(u => `  <url>\n    <loc>${u}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlElements}\n</urlset>`;
  }

  /**
   * Generates a compliant robots.txt pointing to the canonical sitemap.
   */
  public generateRobotsTxt(baseUrl: string): string {
    const cleanUrl = baseUrl.replace(/\/$/, '');
    return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /owner/\n\nSitemap: ${cleanUrl}/sitemap.xml\n`;
  }

  /**
   * Retrieves all registered SEO keywords.
   */
  public async listKeywords(): Promise<SeoKeywordRecord[]> {
    await this.ensureSeeded();
    const sql = `SELECT * FROM seo_keywords ORDER BY target_vertical ASC, cluster_name ASC`;
    let rows: any[] = [];
    try {
      if (isProduction()) {
        rows = await this.d1Repo.query('seo_keywords', sql, []);
      } else {
        rows = getDb().prepare(sql).all();
      }
    } catch {
      rows = SEEDED_VERIFIED_KEYWORDS.map((k, idx) => ({
        ...k,
        id: `kw_${idx}`,
        lastRetrievedAt: new Date().toISOString()
      }));
    }

    return rows.map(r => ({
      id: r.id,
      keyword: r.keyword,
      searchIntent: r.search_intent || r.searchIntent,
      targetVertical: r.target_vertical || r.targetVertical,
      canonicalSlug: r.canonical_slug || r.canonicalSlug,
      clusterName: r.cluster_name || r.clusterName,
      provenance: r.provenance,
      searchVolume: r.search_volume !== undefined ? r.search_volume : (r.searchVolume ?? null),
      difficulty: r.difficulty !== undefined ? r.difficulty : (r.difficulty ?? null),
      lastRetrievedAt: r.last_retrieved_at || r.lastRetrievedAt
    }));
  }
}
