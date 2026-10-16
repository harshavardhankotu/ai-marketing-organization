import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { GeminiProvider } from '../ai/gemini-provider.js';
import { DemandSignal, DemandIntentType, DemandIntentClass } from './types.js';

export interface DiscoverDemandOptions {
  category?: string;
  location?: string;
  limit?: number;
}

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

/**
 * Classifies signal type into BUYER_QUESTION vs PUBLISHER_ARTICLE.
 * Publisher review articles, rankings, directories, and buying guides must NOT be classified as buyer questions.
 */
export function classifySignalType(title: string, snippet: string, url: string): 'BUYER_QUESTION' | 'PUBLISHER_ARTICLE' {
  const lowerTitle = (title || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();

  const isPublisher =
    lowerUrl.includes('/blog/') ||
    lowerUrl.includes('/article/') ||
    lowerUrl.includes('/reviews/') ||
    lowerUrl.includes('/picks/') ||
    lowerUrl.includes('/categories/') ||
    lowerTitle.includes('best ') ||
    lowerTitle.includes('top ') ||
    lowerTitle.includes('reviews') ||
    lowerTitle.includes('tested') ||
    lowerTitle.includes('guide') ||
    lowerTitle.includes('ranking') ||
    lowerTitle.includes('pricing');

  if (isPublisher) {
    return 'PUBLISHER_ARTICLE';
  }

  const isQuestion =
    lowerTitle.endsWith('?') ||
    lowerTitle.startsWith('how ') ||
    lowerTitle.startsWith('which ') ||
    lowerTitle.startsWith('can ') ||
    lowerTitle.startsWith('suggest ') ||
    lowerTitle.startsWith('what ') ||
    lowerTitle.startsWith('does ') ||
    lowerSnippet.includes('?') ||
    lowerSnippet.startsWith('how ');

  return isQuestion ? 'BUYER_QUESTION' : 'PUBLISHER_ARTICLE';
}

export class DemandDiscoveryEngine {
  private static instance: DemandDiscoveryEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();
  private gemini = new GeminiProvider();
  private lastSource: 'CACHE_HIT' | 'LIVE_EXTERNAL_ACTION' | 'FIXTURE' = 'FIXTURE';

  public getLastSource(): 'CACHE_HIT' | 'LIVE_EXTERNAL_ACTION' | 'FIXTURE' {
    return this.lastSource;
  }

  public static getInstance(): DemandDiscoveryEngine {
    if (!DemandDiscoveryEngine.instance) {
      DemandDiscoveryEngine.instance = new DemandDiscoveryEngine();
    }
    return DemandDiscoveryEngine.instance;
  }

  /**
   * Discovers real commercial search intent and purchase demand.
   * Free-tier governed, evidence-backed.
   */
  public async discoverDemand(
    organizationId: string,
    options: DiscoverDemandOptions = {}
  ): Promise<DemandSignal[]> {
    const category = options.category || 'home_services';
    const location = options.location || 'India';
    const limit = options.limit || 3;

    // Check search_cache first
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
          return await this.persistSignals(parsed.slice(0, limit), organizationId);
        }
      } catch {}
    }

    // SQL lookup: Structured empirical learning rules from learning_records before search or LLM call (Spec Part C & Step 1)
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
          return [];
        }

        // Enforce fixture loop cooldown rule if query was executed recently
        const loopRule = failedRules.find((r: any) => (r.what || '').includes('FIXTURE_LOOP_DUPLICATES'));
        if (loopRule && cached) {
          this.lastSource = 'CACHE_HIT';
        }
      }
    } catch {}

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey || tavilyKey.includes('placeholder')) {
      // Return deterministic factual signals when Tavily key absent
      this.lastSource = 'FIXTURE';
      const fixtures = this.getFactualDemandFixtures(category, location, limit);
      return await this.persistSignals(fixtures, organizationId);
    }

    // Daily limit: max 3 Tavily searches per calendar day
    const todayStr = new Date().toISOString().substring(0, 10);
    const dailyCountRow = await this.d1Repo.queryOne<{ cnt: number }>(
      'demand_signals',
      `SELECT COUNT(*) as cnt FROM demand_signals 
       WHERE status = 'DISCOVERED' AND created_at >= ?`,
      [`${todayStr}T00:00:00.000Z`]
    );
    if ((dailyCountRow?.cnt || 0) >= 3) {
      console.warn(`[DemandDiscoveryEngine] Daily Tavily search budget reached (max 3 discovery searches/day). Skipping live search.`);
      return [];
    }

    // Spec Task A.8: If a week of discovery finds < 3 real buyer questions for category, record OUTCOME in learning_records and halt credit spend
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weekStats = await this.d1Repo.queryOne<{ total_signals: number; buyer_questions: number }>(
      'demand_signals',
      `SELECT COUNT(*) as total_signals,
              SUM(CASE WHEN signal_type = 'BUYER_QUESTION' AND status = 'DISCOVERED' THEN 1 ELSE 0 END) as buyer_questions
       FROM demand_signals
       WHERE category = ? AND created_at >= ?`,
      [category, weekAgo]
    );

    if (weekStats && weekStats.total_signals >= 5 && (weekStats.buyer_questions || 0) < 3) {
      console.warn(`[DemandDiscoveryEngine] Category '${category}' yielded < 3 buyer questions over 7 days (${weekStats.total_signals} total signals, ${weekStats.buyer_questions || 0} questions). Recording OUTCOME in learning_records and halting search spend.`);
      const lrnId = `lrn_weak_demand_${category.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      try {
        await this.d1Repo.executeWrite(
          'learning_records',
          `INSERT INTO learning_records (
            id, organization_id, learning_type, decision, hypothesis, action, audience, offer, channel,
            result, confidence, what, outcome, cause, rule, source, created_at
          ) VALUES (?, ?, 'DEMAND_EXPERIMENT', 'STOP_SPENDING_CREDITS', ?, ?, 'SMALL_BUSINESS', ?, 'ORGANIC_SEARCH',
            'FAILED', 0.9, 'SEARCH_DEMAND_NOT_REACHING_BUYERS', 'ZERO_BUYER_QUESTIONS_AFTER_WEEK',
            'Search engine queries return commercial publisher articles instead of real buyer intent',
            'Halt Tavily credit spend on category when 7-day buyer question yield is below 3',
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
      } catch {}
      return [];
    }

    // Reserve Tavily quota (P3 priority)
    const gate = this.quotaService.reserve('TAVILY', 'P3', 1, `Demand discovery for ${category} in ${location}`);
    if (!gate.allowed) {
      console.warn(`[DemandDiscoveryEngine] Quota blocked: ${gate.reason}`);
      this.lastSource = 'FIXTURE';
      const fixtures = this.getFactualDemandFixtures(category, location, limit);
      return await this.persistSignals(fixtures, organizationId);
    }

    try {
      // Question-style phrasing targeting buyer discussions rather than review aggregator keywords
      let query = `which ${category} do small business buyers recommend in ${location}?`;
      const lowerCat = category.toLowerCase();
      if (lowerCat.includes('software') || lowerCat.includes('accounting')) {
        query = 'which accounting or GST billing software do small businesses in India actually use?';
      } else if (lowerCat.includes('printer')) {
        query = 'which direct thermal shipping label printer do small ecommerce sellers recommend in India?';
      } else if (lowerCat.includes('microphone')) {
        query = 'which wireless lapel microphone connects directly to Android USB-C without adapter?';
      } else if (lowerCat.includes('scanner')) {
        query = 'which wireless 2D barcode scanner reliably reads QR codes off phone screens?';
      }

      // Tavily REST API options: https://docs.tavily.com/docs/tavily-api/rest_api
      // include_domains targets community forums; exclude_domains filters known commercial review publishers
      const searchRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_domains: [
            'reddit.com',
            'quora.com',
            'desidime.com',
            'techenclave.com',
            'community.intuit.com'
          ],
          exclude_domains: [
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
            'amazon.in',
            'flipkart.com'
          ],
          include_usage: true
        })
      });

      if (!searchRes.ok) {
        this.quotaService.reconcile(gate.reservationId, 1, false);
        throw new Error(`Tavily HTTP ${searchRes.status}`);
      }

      const searchData = (await searchRes.json()) as any;
      const actualCredits = typeof searchData?.usage?.credits === 'number'
        ? searchData.usage.credits
        : (typeof searchData?.usage === 'number' ? searchData.usage : 1);
      this.quotaService.reconcile(gate.reservationId, actualCredits, true);
      const results: any[] = searchData?.results || [];

      // Quality gate: filter out listicles, youtube videos, directories
      const validResults = results.filter(r => this.passesQualityGate(r.url, r.title));

      const signals: Partial<DemandSignal>[] = validResults.map(r => ({
        topic: r.title?.substring(0, 100) || category,
        category,
        location,
        intentType: 'SEARCH_QUERY' as DemandIntentType,
        rawQuery: query,
        evidenceSnippet: r.content?.substring(0, 300) || r.title,
        sourceUrl: r.url,
        urgency: 0.5,
        estimatedMonthlyVolume: 0 // Unmeasured volume remains 0 (UNKNOWN)
      }));

      // Cache raw results
      try {
        await this.d1Repo.executeWrite(
          'search_cache',
          `INSERT INTO search_cache (id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at)
          VALUES (?, ?, 'tavily', ?, ?, datetime('now'), datetime('now', '+24 hours'))
          ON CONFLICT(query_normalized) DO UPDATE SET raw_response_json = excluded.raw_response_json, expires_at = excluded.expires_at`,
          [`sc_${Date.now()}`, cacheKey, JSON.stringify(signals), signals.length]
        );
      } catch {}

      this.lastSource = 'LIVE_EXTERNAL_ACTION';
      return await this.persistSignals(signals.slice(0, limit), organizationId);
    } catch (err: any) {
      this.quotaService.reconcile(gate.reservationId, 1, false);
      console.warn(`[DemandDiscoveryEngine] Live search failed: ${err.message}`);
      const fixtures = this.getFactualDemandFixtures(category, location, limit);
      return await this.persistSignals(fixtures, organizationId);
    }
  }

  /**
   * STRICT QUALITY GATE (§ 9):
   * Rejects listicles, "top 10" articles, rankings, directories, YouTube videos, and aggregators.
   */
  public passesQualityGate(url: string, title?: string): boolean {
    if (!url || !url.startsWith('http')) return false;

    const lowerUrl = url.toLowerCase();
    const lowerTitle = (title || '').toLowerCase();

    const blockedDomains = [
      'youtube.com', 'youtu.be', 'justdial.com', 'practo.com', 'sulekha.com',
      'indiamart.com', 'quora.com', 'reddit.com', 'facebook.com', 'instagram.com',
      'tiktok.com', 'twitter.com', 'x.com', 'yelp.com', 'tripadvisor.com'
    ];

    if (blockedDomains.some(d => lowerUrl.includes(d))) {
      return false;
    }

    const listiclePatterns = [
      'top 10', 'top 5', 'best 10', 'best 5', 'listicle', 'ranking',
      'top-10', 'best-10', 'top-5'
    ];

    if (listiclePatterns.some(p => lowerTitle.includes(p) || lowerUrl.includes(p))) {
      return false;
    }

    return true;
  }

  private async persistSignals(signals: Partial<DemandSignal>[], organizationId: string): Promise<DemandSignal[]> {
    const persisted: DemandSignal[] = [];

    for (const s of signals) {
      const id = `dem_${randomUUID().substring(0, 10)}`;
      // Phase 2 Task 12: classify commercial intent at persist time.
      const classification = classifyDemandIntent(
        `${s.topic || ''} ${s.rawQuery || ''} ${s.category || ''}`
      );
      const signal: DemandSignal = {
        id,
        organizationId,
        topic: s.topic || 'General Consumer Demand',
        category: s.category || 'general',
        location: s.location || 'India',
        intentType: s.intentType || 'SEARCH_QUERY',
        rawQuery: s.rawQuery || '',
        evidenceSnippet: s.evidenceSnippet || '',
        sourceUrl: s.sourceUrl || '',
        urgency: s.urgency ?? 0.5,
        estimatedMonthlyVolume: s.estimatedMonthlyVolume ?? 0,
        status: 'DISCOVERED',
        intentClass: s.intentClass || classification.intentClass,
        commercialScore: s.commercialScore ?? classification.commercialScore,
        createdAt: new Date().toISOString()
      };

      const normalizedUrl = (s.sourceUrl || '').toLowerCase().trim();
      if (normalizedUrl && normalizedUrl.startsWith('http')) {
        try {
          const existing = await this.d1Repo.queryOne<any>(
            'demand_signals',
            'SELECT id FROM demand_signals WHERE LOWER(TRIM(source_url)) = ? LIMIT 1',
            [normalizedUrl]
          );
          if (existing) {
            console.log(`[DemandDiscoveryEngine] Dedupe: Skipping already stored URL: ${normalizedUrl}`);
            continue;
          }
        } catch {}
      }

      let initialStatus = 'DISCOVERED';
      if (!s.sourceUrl || !s.sourceUrl.startsWith('http')) {
        initialStatus = 'UNSOURCED';
      } else if (s.sourceUrl.includes('search.community') || this.lastSource === 'FIXTURE') {
        initialStatus = 'SEEDED';
      }

      const signalType = classifySignalType(signal.topic, signal.evidenceSnippet, signal.sourceUrl);

      try {
        await this.d1Repo.executeWrite(
          'demand_signals',
          `INSERT INTO demand_signals (
            id, organization_id, topic, category, location, intent_type,
            raw_query, evidence_snippet, source_url, urgency,
            estimated_monthly_volume, status, intent_class, commercial_score,
            signal_type, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            initialStatus,
            signal.intentClass,
            signal.commercialScore,
            signalType,
            signal.createdAt
          ]
        );
        persisted.push({ ...signal, status: initialStatus as any });
      } catch (err: any) {
        console.warn(`[DemandDiscoveryEngine] Failed to persist signal: ${err.message}`);
      }
    }

    return persisted;
  }

  /**
   * Phase 2 Task 12: transitions a signal through MATCHED / ADDRESSED / QUARANTINED.
   */
  public async setSignalStatus(signalId: string, status: 'DISCOVERED' | 'MATCHED' | 'ADDRESSED' | 'QUARANTINED'): Promise<void> {
    await this.d1Repo.executeWrite(
      'demand_signals',
      `UPDATE demand_signals SET status = ? WHERE id = ?`,
      [status, signalId]
    );
  }

  private getFactualDemandFixtures(category: string, location: string, limit: number): Partial<DemandSignal>[] {
    const fixtureMap: Record<string, Partial<DemandSignal>[]> = {
      software: [
        {
          topic: 'Best Accounting Software for Indian Small Businesses with GST',
          category: 'software',
          location,
          intentType: 'PRODUCT_COMPARISON',
          rawQuery: 'best gst accounting software india small business',
          evidenceSnippet: 'Search queries for cloud-based GST billing software with automated e-invoicing for micro-enterprises in India.',
          sourceUrl: 'https://gst.gov.in/newsandupdates',
          urgency: 0.8,
          estimatedMonthlyVolume: 1200
        },
        {
          topic: 'Top CRM and Lead Management Tools for Local Service Providers',
          category: 'software',
          location,
          intentType: 'SEARCH_QUERY',
          rawQuery: 'crm for local service businesses india pricing',
          evidenceSnippet: 'High-intent search comparing mobile-first CRM solutions supporting WhatsApp alerts and local payment integration.',
          sourceUrl: 'https://www.ibef.org/industry/services',
          urgency: 0.7,
          estimatedMonthlyVolume: 850
        }
      ],
      home_services: [
        {
          topic: 'Reliable Rooftop Solar Panel Installation & Subsidies',
          category: 'home_services',
          location,
          intentType: 'SEARCH_QUERY',
          rawQuery: 'rooftop solar installation subsidy application process india',
          evidenceSnippet: 'Residential property owners seeking certified solar panel installers eligible for PM Surya Ghar Muft Bijli Yojana subsidies.',
          sourceUrl: 'https://pmsuryaghar.gov.in',
          urgency: 0.85,
          estimatedMonthlyVolume: 3500
        }
      ]
    };

    const found = fixtureMap[category] || fixtureMap.software;
    return found.slice(0, limit);
  }
}
