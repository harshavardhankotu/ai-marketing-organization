import crypto from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export type DemandSignalStatus =
  | 'SIGNAL'
  | 'QUALIFIED'
  | 'MATCHED'
  | 'DRAFTED'
  | 'POSTED_BY_OWNER'
  | 'CLICKED'
  | 'CONVERTED_REPORTED'
  | 'VERIFIED'
  | 'DROPPED'
  | 'NO_OFFER';

export type OutreachDraftStatus = 'DRAFTED' | 'APPROVED' | 'POSTED_BY_OWNER' | 'EXPIRED';

export interface RawCandidateSignal {
  sourceHost: string;
  url: string;
  rawText: string;
  rawAuthor?: string;
  foundAt: string; // ISO date string
  city?: string;
  language?: string;
  category?: string;
  budgetHint?: string;
}

export interface QualificationResult {
  qualified: boolean;
  reason?: string;
  intentScore: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  city?: string;
  category: string;
  budgetHint?: string;
}

export interface DemandMatchResult {
  matched: boolean;
  signalId: string;
  offerId?: string;
  expectedValue: number;
  evBasis: 'ESTIMATED' | 'MEASURED';
  taskCreated?: string;
}

export interface OutreachDraftResult {
  draftId: string;
  signalId: string;
  channel: string;
  draftText: string;
  landingUrl: string;
  disclosureText: string;
  status: OutreachDraftStatus;
  expiresAt: string;
}

export const MANDATORY_STATUTORY_DISCLOSURE =
  'Disclosure: Independent recommendation. If you purchase through our buyer guide link, we may earn an affiliate commission at no extra cost to you.';

export const INDIAN_CITIES = [
  'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai',
  'pune', 'kolkata', 'gurgaon', 'gurugram', 'noida', 'ahmedabad',
  'jaipur', 'chandigarh', 'kochi', 'lucknow', 'indore', 'bhopal',
  'coimbatore', 'visakhapatnam', 'nagpur', 'surat', 'vadodara'
];

export const INTENT_PHRASES = [
  'looking for',
  'suggest',
  'recommend',
  'which one to buy',
  'best x under',
  'need urgently',
  'where to buy',
  'good option for',
  'should i buy',
  'help me choose'
];

export class DemandEngine {
  private static instance: DemandEngine;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): DemandEngine {
    if (!DemandEngine.instance) {
      DemandEngine.instance = new DemandEngine();
    }
    return DemandEngine.instance;
  }

  /**
   * 2a: Check if a source host is owner-approved.
   * Free tools and discovery can ONLY read approved hosts.
   */
  public isHostApproved(host: string): boolean {
    const cleanHost = host.toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0];
    const db = getDb();
    try {
      const row = db.prepare('SELECT owner_approved FROM source_rules WHERE host = ?').get(cleanHost) as any;
      return Boolean(row && row.owner_approved === 1);
    } catch {
      return false;
    }
  }

  /**
   * 2a: Ingest a raw signal from an approved host.
   * Enforces:
   * - Host must be owner_approved
   * - Zero PII: SHA-256 hash author id
   * - Excerpt clamped to max 300 characters
   * - Content deduplication hash
   */
  public async ingestSignal(candidate: RawCandidateSignal): Promise<{ signalId: string; status: DemandSignalStatus; dedupeHash: string }> {
    const cleanHost = candidate.sourceHost.toLowerCase().trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!this.isHostApproved(cleanHost)) {
      throw new Error(`HOST_NOT_APPROVED: Host '${cleanHost}' is not approved by owner in source_rules. Reading forbidden.`);
    }

    const excerpt = candidate.rawText.substring(0, 300).trim();
    const authorHash = candidate.rawAuthor
      ? crypto.createHash('sha256').update(candidate.rawAuthor.trim().toLowerCase()).digest('hex')
      : 'anonymous_' + crypto.randomUUID().substring(0, 8);

    const dedupeHash = crypto.createHash('sha256').update(`${cleanHost}|${candidate.url}|${excerpt}`).digest('hex');
    const signalId = `dsig_${dedupeHash.substring(0, 16)}`;
    const db = getDb();

    // Check existing deduplication
    const existing = db.prepare('SELECT id, status FROM demand_signals WHERE dedupe_hash = ?').get(dedupeHash) as any;
    if (existing) {
      return { signalId: existing.id, status: existing.status, dedupeHash };
    }

    // Ensure default organization exists
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
        VALUES ('org_owner_primary', 'Primary Owner Organization', 'owner-primary', datetime('now'))
      `).run();
    } catch {}

    const defaultCategory = candidate.category || 'electronics';
    db.prepare(`
      INSERT INTO demand_signals (
        id, organization_id, topic, category, location, intent_type, raw_query,
        evidence_snippet, source_url, urgency, estimated_monthly_volume, status,
        source_host, url, excerpt, author_hash, language, city, intent_score,
        budget_hint, found_at, dedupe_hash, created_at
      ) VALUES (
        ?, 'org_owner_primary', ?, ?, ?, 'SEARCH_QUERY', ?,
        ?, ?, 0.5, 100, 'SIGNAL',
        ?, ?, ?, ?, ?, ?, 0,
        ?, ?, ?, datetime('now')
      )
    `).run(
      signalId,
      defaultCategory,
      defaultCategory,
      candidate.city || 'India',
      candidate.rawText.substring(0, 100),
      excerpt,
      candidate.url,
      cleanHost,
      candidate.url,
      excerpt,
      authorHash,
      candidate.language || 'en',
      candidate.city || null,
      candidate.budgetHint || null,
      candidate.foundAt,
      dedupeHash
    );

    return { signalId, status: 'SIGNAL', dedupeHash };
  }

  /**
   * 2b: Qualify with deterministic rules first.
   */
  public qualifySignal(signal: {
    sourceHost: string;
    rawText: string;
    foundAt: string;
    category?: string;
    city?: string;
    budgetHint?: string;
  }): QualificationResult {
    const text = signal.rawText.toLowerCase();

    // 1. Age check: must be < 14 days old
    const foundTime = new Date(signal.foundAt).getTime();
    const ageDays = (Date.now() - foundTime) / (1000 * 60 * 60 * 24);
    if (ageDays > 14) {
      return { qualified: false, reason: 'OLDER_THAN_14_DAYS', intentScore: 0, urgency: 'LOW', category: signal.category || 'unknown' };
    }

    // 2. Drop solved threads
    const solvedMarkers = ['[solved]', 'issue resolved', 'fixed it', 'already bought', 'closed thread', 'bought it', 'purchased', 'resolved:'];
    if (solvedMarkers.some(m => text.includes(m))) {
      return { qualified: false, reason: 'SOLVED', intentScore: 0, urgency: 'LOW', category: signal.category || 'unknown' };
    }

    // 3. Drop ads and seller posts
    const sellerMarkers = ['dm for price', 'we are selling', 'buy from our store', 'sponsored', 'affiliate disclaimer', 'contact for bulk order', 'our agency', 'contact us for services'];
    if (sellerMarkers.some(m => text.includes(m))) {
      return { qualified: false, reason: 'SELLER_POST', intentScore: 0, urgency: 'LOW', category: signal.category || 'unknown' };
    }

    // 4. Drop categories in learning_records with outcome BLOCK or FAILED
    const category = (signal.category || this.inferCategory(text)).toLowerCase();
    const db = getDb();
    let blockedCategories: string[] = ['health', 'skin care', 'skincare', 'supplements', 'medical'];
    try {
      const rows = db.prepare(`
        SELECT coalesce(what, decision) as what, coalesce(rule, action) as rule
        FROM learning_records
        WHERE outcome = 'FAILED' OR result = 'FAILED'
      `).all() as any[];
      for (const r of rows) {
        const combined = `${r.what || ''} ${r.rule || ''}`.toLowerCase();
        if (combined.includes('category') && combined.includes('block')) {
          ['health', 'skin care', 'skincare', 'supplements', 'medical'].forEach(c => {
            if (combined.includes(c) && !blockedCategories.includes(c)) blockedCategories.push(c);
          });
        }
      }
    } catch {}

    if (blockedCategories.some(bc => category.includes(bc))) {
      return { qualified: false, reason: 'BLOCKED_CATEGORY', intentScore: 0, urgency: 'LOW', category };
    }

    // 5. Drop sources whose rules forbid commercial replies
    try {
      const rule = db.prepare('SELECT allows_links, allows_affiliate FROM source_rules WHERE host = ?').get(signal.sourceHost) as any;
      if (rule && rule.allows_links === 0 && rule.allows_affiliate === 0) {
        return { qualified: false, reason: 'SOURCE_FORBIDS_REPLIES', intentScore: 0, urgency: 'LOW', category };
      }
    } catch {}

    // 6. India relevance check: rupee amounts, Indian cities, local terms
    const hasRupee = text.includes('₹') || text.includes('rs.') || text.includes('rs ') || text.includes('inr');
    const hasIndianCity = INDIAN_CITIES.some(c => text.includes(c) || (signal.city && signal.city.toLowerCase().includes(c)));
    const hasLocalTerms = text.includes('flipkart') || text.includes('amazon.in') || text.includes('lakh') || text.includes('crore') || text.includes('upi');
    const isIndiaRelevant = hasRupee || hasIndianCity || hasLocalTerms;

    if (!isIndiaRelevant) {
      return { qualified: false, reason: 'NOT_INDIA_RELEVANT', intentScore: 0, urgency: 'LOW', category };
    }

    // 7. Intent Scoring (0-100)
    let score = 20; // Base score for India-relevant inquiry
    let matchedPhrases = 0;
    for (const phrase of INTENT_PHRASES) {
      if (text.includes(phrase)) {
        score += 20;
        matchedPhrases++;
      }
    }

    if (hasRupee || signal.budgetHint || text.includes('under ') || text.includes('budget')) {
      score += 15;
    }
    if (ageDays <= 3) {
      score += 15;
    } else if (ageDays <= 7) {
      score += 10;
    }

    let urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    if (text.includes('urgent') || text.includes('urgently') || text.includes('asap') || text.includes('immediately')) {
      score += 15;
      urgency = 'HIGH';
    }

    const finalScore = Math.min(100, Math.max(0, score));

    if (matchedPhrases === 0 && finalScore < 40) {
      return { qualified: false, reason: 'LOW_INTENT_SCORE', intentScore: finalScore, urgency, category };
    }

    return {
      qualified: true,
      intentScore: finalScore,
      urgency,
      category,
      city: signal.city || (INDIAN_CITIES.find(c => text.includes(c)) || undefined),
      budgetHint: signal.budgetHint || (text.match(/(?:under|budget|₹|rs\.?)\s*([0-9,]+)/i)?.[0] || undefined)
    };
  }

  /**
   * Helper to infer product category from query text.
   */
  private inferCategory(text: string): string {
    if (text.includes('printer') || text.includes('label')) return 'office_electronics';
    if (text.includes('projector')) return 'home_theater';
    if (text.includes('laptop') || text.includes('pc') || text.includes('computer')) return 'computing';
    if (text.includes('phone') || text.includes('smartphone') || text.includes('mobile')) return 'smartphones';
    if (text.includes('headphone') || text.includes('earbuds') || text.includes('audio')) return 'audio';
    return 'general_consumer';
  }

  /**
   * Process qualification on an ingested signal in DB.
   */
  public async processQualification(signalId: string): Promise<QualificationResult> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM demand_signals WHERE id = ?').get(signalId) as any;
    if (!row) throw new Error(`SIGNAL_NOT_FOUND: Signal ${signalId} does not exist.`);

    const qResult = this.qualifySignal({
      sourceHost: row.source_host || 'unknown',
      rawText: row.excerpt || row.raw_query,
      foundAt: row.found_at || row.created_at,
      category: row.category,
      city: row.city,
      budgetHint: row.budget_hint
    });

    if (qResult.qualified) {
      db.prepare(`
        UPDATE demand_signals
        SET status = 'QUALIFIED', intent_score = ?, urgency = ?, category = ?,
            city = coalesce(?, city), budget_hint = coalesce(?, budget_hint)
        WHERE id = ?
      `).run(qResult.intentScore, qResult.urgency, qResult.category, qResult.city || null, qResult.budgetHint || null, signalId);
    } else {
      db.prepare(`UPDATE demand_signals SET status = 'DROPPED' WHERE id = ?`).run(signalId);
    }

    return qResult;
  }

  /**
   * 2c: Match qualified signal to active offers from approved partners.
   * Expected value = P(click) * P(buy) * commission.
   * If no offer fits, transition to NO_OFFER and create DISCOVER_OFFER task.
   */
  public async matchSignal(signalId: string): Promise<DemandMatchResult> {
    const db = getDb();
    const signal = db.prepare('SELECT * FROM demand_signals WHERE id = ?').get(signalId) as any;
    if (!signal) throw new Error(`SIGNAL_NOT_FOUND: ${signalId}`);

    // Query ACTIVE offers from approved partners
    const activeOffers = db.prepare(`
      SELECT po.*, p.name as partner_name
      FROM partner_offers po
      JOIN partners p ON p.id = po.partner_id
      WHERE po.active = 1
    `).all() as any[];

    // Match by category
    const matchingOffer = activeOffers.find(o =>
      o.category.toLowerCase().includes(signal.category.toLowerCase()) ||
      signal.category.toLowerCase().includes(o.category.toLowerCase()) ||
      signal.excerpt.toLowerCase().includes(o.title.toLowerCase().split(' ')[0])
    );

    if (!matchingOffer) {
      // Set status to NO_OFFER
      db.prepare(`UPDATE demand_signals SET status = 'NO_OFFER' WHERE id = ?`).run(signalId);

      // Create a DISCOVER_OFFER task in autonomous_cycle_log or tasks
      const taskId = `task_disc_offer_${crypto.randomUUID().substring(0, 8)}`;
      try {
        db.prepare(`
          INSERT INTO autonomous_action_traces (
            id, organization_id, cycle_id, action_type, action_target, rationale,
            risk_level, status, started_at, completed_at
          ) VALUES (
            ?, 'org_owner_primary', 'cycle_demand_engine', 'DISCOVER_OFFER', ?,
            ?, 'LOW', 'COMPLETED', datetime('now'), datetime('now')
          )
        `).run(
          taskId,
          signal.category,
          `No active offer found for demand signal ${signalId} in category '${signal.category}'. Task created to discover partner offer.`
        );
      } catch {}

      return {
        matched: false,
        signalId,
        expectedValue: 0,
        evBasis: 'ESTIMATED',
        taskCreated: taskId
      };
    }

    // Calculate Expected Value: EV = P(click) * P(buy) * commission
    // Default estimated probabilities
    const pClick = 0.05; // 5%
    const pBuy = 0.03;   // 3%
    const commissionINR = matchingOffer.commission_amount_inr > 0
      ? matchingOffer.commission_amount_inr
      : (matchingOffer.price_inr ? matchingOffer.price_inr * 0.05 : 100);

    const expectedValue = Math.round(pClick * pBuy * commissionINR * 100) / 100;
    const matchId = `dmat_${crypto.randomUUID().substring(0, 12)}`;

    db.prepare(`
      INSERT INTO demand_matches (id, signal_id, offer_id, expected_value, ev_basis, created_at)
      VALUES (?, ?, ?, ?, 'ESTIMATED', datetime('now'))
    `).run(matchId, signalId, matchingOffer.id, expectedValue);

    db.prepare(`UPDATE demand_signals SET status = 'MATCHED' WHERE id = ?`).run(signalId);

    return {
      matched: true,
      signalId,
      offerId: matchingOffer.id,
      expectedValue,
      evBasis: 'ESTIMATED'
    };
  }

  /**
   * 2d: Draft outreach response.
   * Enforces:
   * - Max 10 drafts per day
   * - Mandatory statutory disclosure
   * - Clean buyer guide landing URL (never tagged affiliate link in draft)
   * - 3-day expiry
   */
  public async createOutreachDraft(signalId: string): Promise<OutreachDraftResult> {
    const db = getDb();
    const signal = db.prepare('SELECT * FROM demand_signals WHERE id = ?').get(signalId) as any;
    if (!signal) throw new Error(`SIGNAL_NOT_FOUND: ${signalId}`);

    const match = db.prepare('SELECT * FROM demand_matches WHERE signal_id = ?').get(signalId) as any;
    if (!match) throw new Error(`MATCH_NOT_FOUND: Signal ${signalId} has no match.`);

    const activeOffersCount = (db.prepare(`SELECT count(*) as c FROM partner_offers WHERE active = 1`).get() as any)?.c || 0;
    if (activeOffersCount === 0) {
      throw new Error(`NO_ACTIVE_OFFERS: Cannot draft outreach responses when active partner offers count is 0.`);
    }

    const offer = db.prepare('SELECT * FROM partner_offers WHERE id = ?').get(match.offer_id) as any;
    if (!offer) throw new Error(`OFFER_NOT_FOUND: Offer ${match.offer_id} not found.`);

    // Rate limit: max 10 drafts per day
    const todayCount = (db.prepare(`
      SELECT COUNT(*) as count FROM outreach_drafts
      WHERE date(created_at) = date('now')
    `).get() as any)?.count || 0;

    if (todayCount >= 10) {
      throw new Error(`DAILY_DRAFT_LIMIT_REACHED: Daily limit of 10 outreach drafts per day reached. Current: ${todayCount}.`);
    }

    // Cluster check: 3 or more signals share one intent -> create a guide task
    const clusterCount = (db.prepare(`
      SELECT COUNT(*) as count FROM demand_signals
      WHERE category = ? AND status IN ('MATCHED', 'DRAFTED')
    `).get(signal.category) as any)?.count || 0;

    if (clusterCount >= 3) {
      try {
        db.prepare(`
          INSERT INTO autonomous_action_traces (
            id, organization_id, cycle_id, action_type, action_target, rationale,
            risk_level, status, started_at, completed_at
          ) VALUES (
            ?, 'org_owner_primary', 'cycle_demand_engine', 'CREATE_GUIDE_TASK', ?,
            ?, 'LOW', 'COMPLETED', datetime('now'), datetime('now')
          )
        `).run(
          `task_guide_${crypto.randomUUID().substring(0, 8)}`,
          offer.offer_slug,
          `High demand density detected: ${clusterCount} signals in category '${signal.category}'. Guide task created for owner review.`
        );
      } catch {}
    }

    const draftId = `drft_${crypto.randomUUID().substring(0, 12)}`;
    const landingUrl = `https://ai-marketing-platform-core.web.app/guides/${offer.offer_slug}?ref=${draftId}`;

    const draftText = [
      `For ${signal.category.replace('_', ' ')}, the ${offer.title} is a solid, reliable choice in India.`,
      `Key highlights include official warranty support, verified stock availability, and strong user ratings.`,
      `You can read the complete side-by-side comparison and specs breakdown in our verified buyer guide: ${landingUrl}`
    ].join('\n\n');

    // Statutory disclosure is MANDATORY
    const disclosureText = MANDATORY_STATUTORY_DISCLOSURE;
    if (!disclosureText || disclosureText.trim().length === 0) {
      throw new Error('MANDATORY_DISCLOSURE_REQUIRED: Outreach draft must carry statutory disclosure.');
    }

    // 3 days expiry
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO outreach_drafts (
        id, signal_id, channel, draft_text, landing_url, disclosure_text,
        status, expires_at, created_at
      ) VALUES (
        ?, ?, 'COMMUNITY_FORUM', ?, ?, ?,
        'DRAFTED', ?, datetime('now')
      )
    `).run(draftId, signalId, draftText, landingUrl, disclosureText, expiresAt);

    db.prepare(`UPDATE demand_signals SET status = 'DRAFTED' WHERE id = ?`).run(signalId);

    return {
      draftId,
      signalId,
      channel: 'COMMUNITY_FORUM',
      draftText,
      landingUrl,
      disclosureText,
      status: 'DRAFTED',
      expiresAt
    };
  }

  /**
   * 2e: Retrieve top 5 drafts by expected value for TODAY page.
   * Hand-posting ONLY: system never posts automatically.
   */
  public getTopDraftsForToday(limit = 5): Array<{
    draftId: string;
    signalId: string;
    channel: string;
    draftText: string;
    landingUrl: string;
    disclosureText: string;
    expectedValue: number;
    sourceUrl: string;
    excerpt: string;
    category: string;
    expiresAt: string;
  }> {
    const db = getDb();
    // Auto-expire stale drafts first
    db.prepare(`UPDATE outreach_drafts SET status = 'EXPIRED' WHERE status = 'DRAFTED' AND expires_at <= datetime('now')`).run();

    const rows = db.prepare(`
      SELECT od.id as draftId, od.signal_id as signalId, od.channel, od.draft_text as draftText,
             od.landing_url as landingUrl, od.disclosure_text as disclosureText, od.expires_at as expiresAt,
             dm.expected_value as expectedValue, ds.url as sourceUrl, ds.excerpt, ds.category
      FROM outreach_drafts od
      JOIN demand_signals ds ON ds.id = od.signal_id
      JOIN demand_matches dm ON dm.signal_id = od.signal_id
      WHERE od.status = 'DRAFTED' AND od.expires_at > datetime('now')
      ORDER BY dm.expected_value DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows;
  }

  /**
   * 2c: When active offers count is 0, cluster signals by intent and surface demand hints.
   * Format: need, count, sample excerpt, "find a product for this need".
   */
  public getTopClustersForToday(limit = 5): Array<{
    need: string;
    category: string;
    count: number;
    sampleExcerpt: string;
    sourceHost: string;
    action: string;
  }> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        coalesce(category, 'general_consumer') as category,
        COUNT(id) as count,
        min(excerpt) as sampleExcerpt,
        min(source_host) as sourceHost
      FROM demand_signals
      WHERE status IN ('SIGNAL', 'QUALIFIED', 'NO_OFFER', 'DISCOVERED')
      GROUP BY category
      ORDER BY count DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(r => ({
      need: `High-intent buyer recommendations for ${r.category.replace(/_/g, ' ')}`,
      category: r.category,
      count: Number(r.count),
      sampleExcerpt: r.sampleExcerpt || 'Buyer seeking specific product recommendation in India',
      sourceHost: r.sourceHost || 'community',
      action: 'find a product for this need'
    }));
  }

  /**
   * 2e: Owner marks a draft as posted by hand.
   */
  public markPostedByOwner(draftId: string): { success: boolean; postedAt: string } {
    const db = getDb();
    const postedAt = new Date().toISOString();

    const draft = db.prepare('SELECT signal_id FROM outreach_drafts WHERE id = ?').get(draftId) as any;
    if (!draft) throw new Error(`DRAFT_NOT_FOUND: ${draftId}`);

    db.prepare(`
      UPDATE outreach_drafts
      SET status = 'POSTED_BY_OWNER', posted_at = ?
      WHERE id = ?
    `).run(postedAt, draftId);

    db.prepare(`
      UPDATE demand_signals
      SET status = 'POSTED_BY_OWNER'
      WHERE id = ?
    `).run(draft.signal_id);

    return { success: true, postedAt };
  }

  /**
   * 2f: Record funnel event for a draft.
   */
  public recordFunnelEvent(draftId: string, event: 'CLICK' | 'CONVERSION_REPORTED' | 'VERIFIED', amountINR = 0): void {
    const db = getDb();
    const draft = db.prepare('SELECT signal_id FROM outreach_drafts WHERE id = ?').get(draftId) as any;
    if (!draft) return;

    if (event === 'CLICK') {
      db.prepare(`UPDATE demand_signals SET status = 'CLICKED' WHERE id = ?`).run(draft.signal_id);
    } else if (event === 'CONVERSION_REPORTED') {
      db.prepare(`UPDATE demand_signals SET status = 'CONVERTED_REPORTED' WHERE id = ?`).run(draft.signal_id);
    } else if (event === 'VERIFIED') {
      db.prepare(`UPDATE demand_signals SET status = 'VERIFIED' WHERE id = ?`).run(draft.signal_id);
    }
  }

  /**
   * 2f: Check source auto-disable rule:
   * Disable source after 30 drafts and 0 clicks.
   */
  public evaluateSourceHealth(host: string): { active: boolean; draftsCount: number; clicksCount: number } {
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(od.id) as draftsCount,
        SUM(CASE WHEN ds.status IN ('CLICKED', 'CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as clicksCount
      FROM outreach_drafts od
      JOIN demand_signals ds ON ds.id = od.signal_id
      WHERE ds.source_host = ?
    `).get(host) as any;

    const draftsCount = stats?.draftsCount || 0;
    const clicksCount = stats?.clicksCount || 0;

    if (draftsCount >= 30 && clicksCount === 0) {
      // Auto-disable source host
      db.prepare(`
        UPDATE source_rules
        SET owner_approved = 0, notes = 'Auto-disabled: 30 drafts with 0 clicks recorded'
        WHERE host = ?
      `).run(host);

      // Write learning record with outcome = 'FAILED'
      try {
        const hash = crypto.createHash('sha256').update(`disable_host_${host}|FAILED`).digest('hex');
        db.prepare(`
          INSERT INTO learning_records (
            id, organization_id, learning_type, decision, hypothesis, action,
            audience, offer, channel, result, what, outcome, cause, rule,
            evidence_ref, source_file, date, content_hash, created_at
          ) VALUES (
            ?, 'org_owner_primary', 'SOURCE_HEALTH', 'DISABLE_SOURCE', 'Host has zero CTR across 30 attempts', 'AUTO_DISABLE_HOST',
            'ALL', 'ALL', 'ALL', 'FAILED', ?, 'FAILED', '30 outreach drafts resulted in 0 clicks', 'Disable a source after 30 drafts and 0 clicks',
            'demand_funnel_stats', 'demand-engine.ts', date('now'), ?, datetime('now')
          )
          ON CONFLICT(content_hash) DO NOTHING
        `).run(
          `lrn_disable_${hash.substring(0, 12)}`,
          `Source host ${host} generated 0 clicks after 30 drafts`,
          hash
        );
      } catch {}

      return { active: false, draftsCount, clicksCount };
    }

    return { active: true, draftsCount, clicksCount };
  }

  /**
   * 2f: Funnel metrics reporting per source, per category, per offer.
   */
  public getFunnelMetrics(): {
    bySource: Array<{ sourceHost: string; signals: number; drafts: number; clicks: number; conversions: number }>;
    byCategory: Array<{ category: string; signals: number; drafts: number; clicks: number }>;
  } {
    const db = getDb();
    const bySource = db.prepare(`
      SELECT
        ds.source_host as sourceHost,
        COUNT(ds.id) as signals,
        SUM(CASE WHEN ds.status IN ('DRAFTED', 'POSTED_BY_OWNER', 'CLICKED', 'CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN ds.status IN ('CLICKED', 'CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as clicks,
        SUM(CASE WHEN ds.status IN ('CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as conversions
      FROM demand_signals ds
      GROUP BY ds.source_host
    `).all() as any[];

    const byCategory = db.prepare(`
      SELECT
        ds.category,
        COUNT(ds.id) as signals,
        SUM(CASE WHEN ds.status IN ('DRAFTED', 'POSTED_BY_OWNER', 'CLICKED', 'CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN ds.status IN ('CLICKED', 'CONVERTED_REPORTED', 'VERIFIED') THEN 1 ELSE 0 END) as clicks
      FROM demand_signals ds
      GROUP BY ds.category
    `).all() as any[];

    return { bySource, byCategory };
  }
}
