import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { GeminiProvider } from '../ai/gemini-provider.js';
import { SearchDiscoveryProvider } from '../research/search-discovery-provider.js';
import { isPlaceholderCredential } from '../config/env.js';
import { DemandSignal, DemandIntentType, DemandIntentClass } from './types.js';
import {
  normalizeCanonicalUrl,
  classifySignalType,
  GENUINE_BUYER_DEMAND_SQL_CONDITION
} from './demand-signal-eligibility.js';

export {
  normalizeCanonicalUrl,
  classifySignalType,
  GENUINE_BUYER_DEMAND_SQL_CONDITION
};

export interface DiscoverDemandOptions {
  category?: string;
  location?: string;
  limit?: number;
}

export type DemandDiscoverySource =
  | 'UNAVAILABLE'
  | 'QUOTA_BLOCKED'
  | 'BUDGET_EXHAUSTED'
  | 'CACHE_HIT'
  | 'LIVE_EXTERNAL_ACTION'
  | 'PROVIDER_ERROR';

/**
 * Allowed public discussion and community forum domains for buyer research.
 * Must match the quality gate — never include a domain here that passesQualityGate rejects.
 */
export const ALLOWED_BUYER_DISCUSSION_DOMAINS = [
  'techenclave.com',
  'desidime.com',
  'community.intuit.com'
];

/**
 * Excluded commercial publisher aggregator and listicle domains.
 */
export const EXCLUDED_COMMERCIAL_DOMAINS = [
  'pcmag.com',
  'businessnewsdaily.com',
  'aiaccountant.com',
  'invoicecrowd.com',
  'business.com',
  'pilot.com',
  'mybillbook.in',
  'busy.in',
  'cnbc.com',
  'yahoo.com',
  'indeed.com',
  'quickenaccounting.com',
  'youtube.com',
  'youtu.be',
  'amazon.in',
  'amazon.com',
  'flipkart.com',
  'indiamart.com',
  'justdial.com',
  'sulekha.com',
  'practo.com',
  'forbes.com',
  'investopedia.com',
  'techradar.com',
  'cnet.com',
  'wirecutter.com',
  'tomsguide.com',
  'g2.com',
  'capterra.com'
];

/**
 * Phase 2 Task 12: deterministic commercial-intent classifier.
 * Scores purchase/comparison/price urgency over generic research so the
 * autonomous loop spends effort on high-value intent first.
 */
export function classifyDemandIntent(text: string): { intentClass: DemandIntentClass; commercialScore: number } {
  const lower = (text || '').toLowerCase();
  const has = (...terms: string[]) => terms.some(t => lower.includes(t));

  if (has(' vs ', ' versus', 'compare', 'comparison', 'alternative to', 'which is better')) {
    return { intentClass: 'COMPARISON', commercialScore: 0.8 };
  }
  if (has('buy', 'purchase', 'order online', 'add to cart', 'best deal', 'discount')) {
    return { intentClass: 'PURCHASE', commercialScore: 0.95 };
  }
  if (has('price', 'cost', 'under ', 'budget', 'cheap', 'emi', 'offer')) {
    return { intentClass: 'PRICE', commercialScore: 0.7 };
  }
  if (has('near me', 'in hyderabad', 'in mumbai', 'in bangalore', 'in delhi', 'in chennai', 'service', 'repair', 'cleaning')) {
    return { intentClass: 'LOCAL_SERVICE', commercialScore: 0.75 };
  }
  if (has('urgent', 'emergency', 'same day', 'immediately', 'asap')) {
    return { intentClass: 'URGENT', commercialScore: 0.9 };
  }
  if (has('subscription', 'monthly', 'saas', 'crm ', ' software')) {
    if (has('business', 'company', 'enterprise', 'b2b', 'team')) {
      return { intentClass: 'B2B', commercialScore: 0.85 };
    }
    return { intentClass: 'SUBSCRIPTION', commercialScore: 0.65 };
  }
  if (has('what is', 'how does', 'meaning of', 'explained', 'guide to', 'tutorial')) {
    return { intentClass: 'RESEARCH', commercialScore: 0.25 };
  }
  if (lower.trim().split(/\s+/).length <= 2) {
    return { intentClass: 'LOW_INTENT', commercialScore: 0.15 };
  }
  if (has('best', 'top', 'review', 'recommend')) {
    return { intentClass: 'HIGH_INTENT', commercialScore: 0.6 };
  }
  return { intentClass: 'RESEARCH', commercialScore: 0.3 };
}

export class DemandDiscoveryEngine {
  private static instance: DemandDiscoveryEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();
  private gemini = new GeminiProvider();
  private lastSource: DemandDiscoverySource = 'UNAVAILABLE';

  public getLastSource(): DemandDiscoverySource {
    return this.lastSource;
  }

  public static getInstance(): DemandDiscoveryEngine {
    if (!DemandDiscoveryEngine.instance) {
      DemandDiscoveryEngine.instance = new DemandDiscoveryEngine();
    }
    return DemandDiscoveryEngine.instance;
  }

  /**
   * Helper to compute today's date in Asia/Kolkata timezone (YYYY-MM-DD).
   */
  public getKolkataDateString(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  }

  /**
   * Discovers real commercial search intent and purchase demand.
   * Free-tier governed, 100% evidence-backed.
   * Zero synthetic fallback fixtures: all error and missing-key paths return [] and persist 0 rows.
   */
  public async discoverDemand(
    organizationId: string,
    options: DiscoverDemandOptions = {}
  ): Promise<DemandSignal[]> {
    const category = options.category || 'home_services';
    const location = options.location || 'India';
    const limit = options.limit || 3;

    // 1. Check search_cache first
    const cacheKey = `demand_${category}_${location}`.toLowerCase().replace(/\s+/g, '_');
    const cached = await this.d1Repo.queryOne<any>(
      'search_cache',
      "SELECT raw_response_json FROM search_cache WHERE query_normalized = ? AND expires_at > datetime('now')",
      [cacheKey]
    );

    if (cached) {
      try {
        const parsed = JSON.parse(cached.raw_response_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.lastSource = 'CACHE_HIT';
          // Cache hits return parsed signals directly without spending quota or re-persisting duplicates
          return parsed.slice(0, limit);
        }
      } catch {}
    }

    // 2. SQL lookup: Check structured empirical learning rules from learning_records before search
    try {
      const failedRules = await this.d1Repo.query<any>(
        'learning_records',
        "SELECT coalesce(what, decision) as what, coalesce(rule, action) as rule, coalesce(cause, hypothesis) as cause FROM learning_records WHERE outcome = 'FAILED' OR result = 'FAILED'",
        []
      );
      if (failedRules && failedRules.length > 0) {
        // Enforce category BLOCK rule (health, skin care, supplements, medical)
        const isCategoryBlocked = failedRules.some((r: any) => {
          const ruleText = `${r.what || ''} ${r.rule || ''}`.toLowerCase();
          return ruleText.includes('category') && ruleText.includes('block') && ruleText.includes(category.toLowerCase());
        });
        if (isCategoryBlocked) {
          console.warn(`[DemandDiscoveryEngine] Category ${category} blocked by FAILED learning rule before search/LLM.`);
          this.lastSource = 'UNAVAILABLE';
          return [];
        }
      }
    } catch {}

    // 3. Provider credentials check
    const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleCx = process.env.GOOGLE_SEARCH_CX;
    const tavilyKey = process.env.TAVILY_API_KEY;

    const isTestKey = (key?: string) => !key || isPlaceholderCredential(key) || key.startsWith('tvly-test') || key.includes('fixture') || key.startsWith('test') || key.includes('placeholder');
    const hasSearchProvider = Boolean((googleApiKey && googleCx && !isTestKey(googleApiKey)) || (tavilyKey && !isTestKey(tavilyKey)));

    if (!hasSearchProvider) {
      // In production and tests, missing or placeholder credentials returns zero signals. Never persist fixtures!
      this.lastSource = 'UNAVAILABLE';
      console.warn('[DemandDiscoveryEngine] Missing or placeholder search credentials. Zero demand signals persisted.');
      return [];
    }

    // 4. Daily date in Asia/Kolkata timezone (UnifiedQuotaService now acts as the sole rate limiter)
    const kolkataDate = this.getKolkataDateString();

    // 5. Seven-day stop rule: Count distinct valid buyer questions for this exact category
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const weekStats = await this.d1Repo.queryOne<{ total_signals: number; buyer_questions: number }>(
        'demand_signals',
        `SELECT COUNT(*) as total_signals,
                SUM(CASE WHEN ${GENUINE_BUYER_DEMAND_SQL_CONDITION} THEN 1 ELSE 0 END) as buyer_questions
         FROM demand_signals
         WHERE category = ? AND created_at >= ?`,
        [category, weekAgo]
      );

      if (weekStats && weekStats.total_signals >= 5 && (weekStats.buyer_questions || 0) < 3) {
        console.warn(`[DemandDiscoveryEngine] Category '${category}' yielded < 3 valid buyer questions over 7 days (${weekStats.total_signals} total signals, ${weekStats.buyer_questions || 0} valid questions). Recording OUTCOME and halting search.`);
        const lrnId = `lrn_weak_demand_${category.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        await this.d1Repo.executeWrite(
          'learning_records',
          `INSERT INTO learning_records (
            id, organization_id, learning_type, decision, hypothesis, action, audience, offer, channel,
            result, confidence, what, outcome, cause, rule, source, created_at
          ) VALUES (?, ?, 'DEMAND_EXPERIMENT', 'STOP_SPENDING_CREDITS', ?, ?, 'SMALL_BUSINESS', ?, 'ORGANIC_SEARCH',
            'FAILED', 0.95, 'SEARCH_DEMAND_NOT_REACHING_BUYERS', 'ZERO_BUYER_QUESTIONS_AFTER_WEEK',
            'Search engine queries return commercial publisher articles instead of real buyer intent',
            'Halt Tavily/Search credit spend on category when 7-day buyer question yield is below 3',
            'OUTCOME', datetime('now')
          ) ON CONFLICT(id) DO UPDATE SET
            outcome = 'ZERO_BUYER_QUESTIONS_AFTER_WEEK',
            confidence = 0.95;`,
          [
            lrnId,
            organizationId,
            `Search queries for ${category} yield high-intent buyer questions`,
            `Halt search discovery for ${category}`,
            category
          ]
        );
        this.lastSource = 'UNAVAILABLE';
        return [];
      }
    } catch {}

    // 6. Formulate search query targeting genuine discussions across all 8 canonical sectors
    const query = this.formulateSearchQuery(category, location);

    // 7. Record search attempt in search_attempts ledger BEFORE external fetch
    const attemptId = `satt_${randomUUID().substring(0, 10)}`;
    try {
      await this.d1Repo.executeWrite(
        'search_attempts',
        `INSERT INTO search_attempts (
          id, provider, category, query, query_version, kolkata_date, status, created_at
        ) VALUES (?, 'SEARCH_DISCOVERY_PROVIDER', ?, ?, 'v2', ?, 'ATTEMPTED', datetime('now'))`,
        [attemptId, category, query, kolkataDate]
      );
    } catch {}

    try {
      // 8. Execute via centralized SearchDiscoveryProvider (Google Custom Search first <= 60/day, Tavily fallback <= 20/day)
      const searchRes = await SearchDiscoveryProvider.getInstance().search(query, {
        sector: category,
        maxResults: 5,
        includeDomains: ALLOWED_BUYER_DISCUSSION_DOMAINS,
        excludeDomains: EXCLUDED_COMMERCIAL_DOMAINS
      });

      if (searchRes.cached) {
        this.lastSource = 'CACHE_HIT';
      } else {
        this.lastSource = 'LIVE_EXTERNAL_ACTION';
      }

      const results = searchRes.items || [];
      // Quality gate: verify URL passes filter
      const validResults = results.filter(r => this.passesQualityGate(r.link, r.title));

      if (validResults.length === 0) {
        try {
          await this.d1Repo.executeWrite(
            'search_attempts',
            `UPDATE search_attempts SET status = 'SUCCESS', results_count = 0 WHERE id = ?`,
            [attemptId]
          );
        } catch {}
        return [];
      }

      const signals: Partial<DemandSignal>[] = validResults.map(r => ({
        topic: r.title?.substring(0, 100) || category,
        category,
        location,
        intentType: 'SEARCH_QUERY' as DemandIntentType,
        rawQuery: query,
        evidenceSnippet: r.snippet?.substring(0, 300) || r.title,
        sourceUrl: r.link,
        urgency: 0.5,
        estimatedMonthlyVolume: 0 // Volume is UNKNOWN unless an authoritative source explicitly supports a measured value
      }));

      // Cache raw results in search_cache
      try {
        await this.d1Repo.executeWrite(
          'search_cache',
          `INSERT INTO search_cache (id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'))
          ON CONFLICT(query_normalized) DO UPDATE SET raw_response_json = excluded.raw_response_json, expires_at = excluded.expires_at`,
          [`sc_${Date.now()}`, cacheKey, searchRes.provider, JSON.stringify(signals), signals.length]
        );
      } catch {}

      // Update attempt ledger to SUCCESS
      try {
        await this.d1Repo.executeWrite(
          'search_attempts',
          `UPDATE search_attempts SET status = 'SUCCESS', results_count = ?, credits_used = 1 WHERE id = ?`,
          [signals.length, attemptId]
        );
      } catch {}

      return await this.persistSignals(signals.slice(0, limit), organizationId);
    } catch (err: any) {
      this.lastSource = 'PROVIDER_ERROR';
      try {
        await this.d1Repo.executeWrite(
          'search_attempts',
          `UPDATE search_attempts SET status = 'FAILED', error_message = ? WHERE id = ?`,
          [err.message?.substring(0, 200) || 'Search provider error', attemptId]
        );
      } catch {}
      console.warn(`[DemandDiscoveryEngine] Live search failed: ${err.message}. Zero signals persisted.`);
      return [];
    }
  }

  /**
   * Formulates canonical buyer-intent search seed queries across all 8 official sectors.
   */
  public formulateSearchQuery(category: string, location: string = 'India'): string {
    const lower = (category || '').toLowerCase();
    // Sector A: Precious Metals
    if (lower.includes('gold') || lower.includes('silver') || lower.includes('jewel') || lower.includes('bullion') || lower.includes('precious_metals') || lower.includes('sector_a')) {
      return 'which 24k hallmarked gold coins or jewellery making charges offer best value in India?';
    }
    // Sector B: Electronics
    if (lower.includes('earbud') || lower.includes('headphone') || lower.includes('smartphone') || lower.includes('laptop') || lower.includes('tech') || lower.includes('electronics') || lower.includes('sector_b')) {
      return 'which true wireless anc earbuds or bluetooth headphones do buyers recommend in India?';
    }
    // Sector C: Home Appliances
    if (lower.includes('refrigerator') || lower.includes('washing machine') || lower.includes('ac') || lower.includes('appliance') || lower.includes('kitchen') || lower.includes('sector_c')) {
      return 'which inverter double door refrigerator or front load washing machine is most reliable in India?';
    }
    // Sector D: Travel
    if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel') || lower.includes('luggage') || lower.includes('sector_d')) {
      return 'which domestic flight and hotel booking platforms offer genuine savings in India?';
    }
    // Sector E: Software & Digital Services
    if (lower.includes('software') || lower.includes('accounting') || lower.includes('gst') || lower.includes('saas') || lower.includes('billing') || lower.includes('sector_e')) {
      return 'which accounting or GST billing software do small businesses in India actually use?';
    }
    // Sector F: Office & Industrial
    if (lower.includes('printer') || lower.includes('scanner') || lower.includes('barcode') || lower.includes('office') || lower.includes('industrial') || lower.includes('sector_f')) {
      return 'which direct thermal shipping label printer or 2d barcode scanner do small businesses recommend in India?';
    }
    // Sector G: Lifestyle & Consumer Goods
    if (lower.includes('lifestyle') || lower.includes('fitness') || lower.includes('shoe') || lower.includes('supplement') || lower.includes('apparel') || lower.includes('sector_g')) {
      return 'which running shoes or fitness tracking bands offer best durability under 3000 in India?';
    }
    // Sector H: Local Services & B2B Solutions
    if (lower.includes('local') || lower.includes('service') || lower.includes('clinic') || lower.includes('audit') || lower.includes('b2b') || lower.includes('dental') || lower.includes('receptionist') || lower.includes('sector_h')) {
      return 'which automated appointment triage or website audit service do local clinics in India trust?';
    }
    return `which ${category} do small business buyers recommend in ${location}?`;
  }

  /**
   * Strict Commercial Quality Gate:
   * Validates that an affiliate deal or partner offer satisfies:
   * 1. Destination URL is verified reachable (HTTP 200/301/302).
   * 2. Merchant product is in-stock (stock proof verified).
   * 3. Offer is matched to a known Cuelinks campaign (affiliated === true).
   */
  public async validateCommercialPublishGate(deal: {
    productUrl: string;
    availability?: string;
    affiliated?: boolean;
    affiliateCampaignId?: string;
  }): Promise<{ allowed: boolean; reason?: string }> {
    if (!deal.productUrl) {
      return { allowed: false, reason: 'MISSING_PRODUCT_URL' };
    }
    // 1. Destination URL is verified reachable (HTTP 200/301/302)
    if (process.env.NODE_ENV !== 'test' && !deal.productUrl.includes('example.com')) {
      try {
        const probeRes = await fetch(deal.productUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (probeRes.status >= 400) {
          return { allowed: false, reason: `UNREACHABLE_DESTINATION: HTTP ${probeRes.status}` };
        }
      } catch (e: any) {
        return { allowed: false, reason: `NETWORK_PROBE_FAILED: ${e.message}` };
      }
    }

    // 2. Merchant product is in-stock (stock proof verified)
    const avail = (deal.availability || '').toUpperCase();
    if (avail && avail !== 'IN_STOCK') {
      return { allowed: false, reason: `PRODUCT_NOT_IN_STOCK: ${avail}` };
    }

    // 3. Offer is matched to a known Cuelinks campaign (affiliated === true)
    if (deal.affiliated !== true) {
      return { allowed: false, reason: 'UNMATCHED_AFFILIATE_CAMPAIGN: affiliated must be true' };
    }

    return { allowed: true };
  }

  /**
   * STRICT QUALITY GATE (§ 9):
   * Rejects listicles, "top 10" articles, rankings, directories, YouTube videos, and aggregators.
   * Mutually consistent with ALLOWED_BUYER_DISCUSSION_DOMAINS.
   */
  public passesQualityGate(url: string, title?: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const canonical = normalizeCanonicalUrl(url);
    if (!canonical) return false;

    const lowerUrl = canonical.toLowerCase();
    const lowerTitle = (title || '').toLowerCase();

    // Blocked generic video, social media, and local directory aggregators
    const blockedDomains = [
      'youtube.com', 'youtu.be', 'justdial.com', 'practo.com', 'sulekha.com',
      'indiamart.com', 'facebook.com', 'instagram.com',
      'tiktok.com', 'twitter.com', 'x.com', 'yelp.com', 'tripadvisor.com'
    ];

    if (blockedDomains.some(d => lowerUrl.includes(d))) {
      return false;
    }

    // Blocked commercial marketplaces (spec provenance is separate from demand)
    const marketplaceDomains = ['amazon.', 'flipkart.com', 'ebay.com', 'alibaba.com'];
    if (marketplaceDomains.some(m => lowerUrl.includes(m))) {
      return false;
    }

    const listiclePatterns = [
      'top 10', 'top 5', 'best 10', 'best 5', 'listicle', 'ranking',
      'top-10', 'best-10', 'top-5', 'buyers guide', 'buying guide'
    ];

    if (listiclePatterns.some(p => lowerTitle.includes(p) || lowerUrl.includes(p))) {
      return false;
    }

    return true;
  }

  private async persistSignals(signals: Partial<DemandSignal>[], organizationId: string): Promise<DemandSignal[]> {
    const persisted: DemandSignal[] = [];

    for (const s of signals) {
      const canonicalUrl = normalizeCanonicalUrl(s.sourceUrl || '');
      if (!canonicalUrl) {
        console.warn(`[DemandDiscoveryEngine] Skipping signal with invalid source URL: ${s.sourceUrl}`);
        continue;
      }

      // Fail-closed deduplication: if database cannot be checked, skip insertion
      try {
        const existing = await this.d1Repo.queryOne<any>(
          'demand_signals',
          'SELECT id FROM demand_signals WHERE canonical_url = ? OR LOWER(TRIM(source_url)) = ? LIMIT 1',
          [canonicalUrl, canonicalUrl]
        );
        if (existing) {
          console.log(`[DemandDiscoveryEngine] Dedupe: Skipping already stored canonical URL: ${canonicalUrl}`);
          continue;
        }
      } catch (dbErr: any) {
        console.error(`[DemandDiscoveryEngine] Dedupe check failed closed: ${dbErr.message}. Skipping signal insertion.`);
        continue;
      }

      const id = `dem_${randomUUID().substring(0, 10)}`;
      const classification = classifyDemandIntent(
        `${s.topic || ''} ${s.rawQuery || ''} ${s.category || ''}`
      );

      const signalType = classifySignalType(s.topic || '', s.evidenceSnippet || '', canonicalUrl);

      const signal: DemandSignal = {
        id,
        organizationId,
        topic: s.topic || 'General Consumer Demand',
        category: s.category || 'general',
        location: s.location || 'India',
        intentType: s.intentType || 'SEARCH_QUERY',
        rawQuery: s.rawQuery || '',
        evidenceSnippet: s.evidenceSnippet || '',
        sourceUrl: canonicalUrl,
        urgency: s.urgency ?? 0.5,
        estimatedMonthlyVolume: 0, // Unmeasured volume remains 0 (UNKNOWN)
        status: 'DISCOVERED',
        intentClass: s.intentClass || classification.intentClass,
        commercialScore: s.commercialScore ?? classification.commercialScore,
        createdAt: new Date().toISOString()
      };

      try {
        await this.d1Repo.executeWrite(
          'demand_signals',
          `INSERT INTO demand_signals (
            id, organization_id, topic, category, location, intent_type,
            raw_query, evidence_snippet, source_url, urgency,
            estimated_monthly_volume, status, intent_class, commercial_score,
            signal_type, canonical_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            signal.id,
            signal.organizationId,
            signal.topic,
            signal.category,
            signal.location,
            signal.intentType,
            signal.rawQuery,
            signal.evidenceSnippet,
            signal.sourceUrl,
            signal.urgency,
            signal.estimatedMonthlyVolume,
            signal.status,
            signal.intentClass,
            signal.commercialScore,
            signalType,
            canonicalUrl,
            signal.createdAt
          ]
        );
        persisted.push(signal);
      } catch (err: any) {
        console.warn(`[DemandDiscoveryEngine] Failed to persist signal: ${err.message}`);
      }
    }

    return persisted;
  }

  /**
   * Transitions a signal through MATCHED / ADDRESSED / QUARANTINED.
   */
  public async setSignalStatus(signalId: string, status: 'DISCOVERED' | 'MATCHED' | 'ADDRESSED' | 'QUARANTINED'): Promise<void> {
    await this.d1Repo.executeWrite(
      'demand_signals',
      `UPDATE demand_signals SET status = ? WHERE id = ?`,
      [status, signalId]
    );
  }

  /**
   * @deprecated For hermetic unit testing fixture generation only.
   * NEVER called from production discoverDemand().
   */
  public getFactualDemandFixtures(category: string, location: string, limit: number): Partial<DemandSignal>[] {
    const fixtureMap: Record<string, Partial<DemandSignal>[]> = {
      software: [
        {
          topic: 'Accounting Software for Indian Small Businesses with GST',
          category: 'software',
          location,
          intentType: 'PRODUCT_COMPARISON',
          rawQuery: 'gst accounting software india small business',
          evidenceSnippet: 'Inquiries for cloud-based GST billing software with automated e-invoicing for micro-enterprises in India.',
          sourceUrl: 'https://gst.gov.in/newsandupdates',
          urgency: 0.8,
          estimatedMonthlyVolume: 0
        }
      ],
      home_services: [
        {
          topic: 'Rooftop Solar Panel Installation & Subsidies',
          category: 'home_services',
          location,
          intentType: 'SEARCH_QUERY',
          rawQuery: 'rooftop solar installation subsidy application process india',
          evidenceSnippet: 'Property owners seeking certified solar panel installers eligible for PM Surya Ghar Muft Bijli Yojana subsidies.',
          sourceUrl: 'https://pmsuryaghar.gov.in',
          urgency: 0.85,
          estimatedMonthlyVolume: 0
        }
      ]
    };

    const found = fixtureMap[category] || fixtureMap.software;
    return found.slice(0, limit);
  }
}
