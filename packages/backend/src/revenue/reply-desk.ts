/**
 * ReplyDeskService — Implements Part D.3: Reply Desk & Intent Sourcing
 *
 * Rules:
 * - At most 2 Tavily queries per day for public requests that match the offer.
 * - Store title, snippet, URL, date only. No names.
 * - Filter out directories, listicles, aggregator sites, and SEO articles.
 * - Classify buyer intent (HIGH_INTENT, INQUIRY, RESEARCH, JUNK).
 * - Draft a short answer based strictly on owner/OWN_OFFER.md.
 * - Never post. Drafts only.
 */

import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { DirectCommercialOfferPage } from './direct-offer-page.js';

export interface PublicRequestItem {
  title: string;
  snippet: string;
  url: string;
  date: string;
}

export interface AssessedSignal {
  intentClass: 'HIGH_INTENT' | 'INQUIRY' | 'RESEARCH' | 'JUNK';
  qualified: boolean;
  reason: string;
}

export interface ReplyDraft {
  id: string;
  sourceUrl: string;
  requestTitle: string;
  requestSnippet: string;
  draftAnswer: string;
  status: 'DRAFT';
  intentClass?: 'HIGH_INTENT' | 'INQUIRY' | 'RESEARCH' | 'JUNK';
  qualificationStatus?: 'QUALIFIED' | 'REJECTED';
  qualificationReason?: string;
  nextPermittedAction?: string;
  createdAt: string;
}

export const BLOCKED_DIRECTORY_DOMAINS = new Set([
  'practo.com',
  'justdial.com',
  'sulekha.com',
  'indiamart.com',
  'yellowpages.in',
  'quikr.com',
  'olx.in',
  'wikipedia.org',
  'medium.com',
  'linkedin.com',
  'scribd.com',
  'slideshare.net',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  // Step 5d: Blocked publisher, news, and article aggregator domains
  'yahoo.com',
  'cnbc.com',
  'pcmag.com',
  'business.com',
  'businessnewsdaily.com',
  'invoicecrowd.com',
  'indeed.com',
  'pilot.com',
  'busy.in',
  'quickenaccounting.com',
  'mybillbook.in'
]);

export const DEFAULT_REPLY_DESK_QUERIES = [
  'how to handle missed patient calls dental clinic whatsapp India',
  'whatsapp appointment booking auto reply for salon clinic India',
  'receptionist missing patient inquiries after hours clinic automation',
  'dental clinic patient inquiry follow up system whatsapp'
];

export function assessPublicSignal(title: string, snippet: string, url: string): AssessedSignal {
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();
  const combinedText = `${lowerTitle} ${lowerSnippet}`;

  // 1. Check blocked directory, aggregator, publisher, or social domains
  for (const domain of BLOCKED_DIRECTORY_DOMAINS) {
    if (lowerUrl.includes(domain)) {
      return {
        intentClass: 'JUNK',
        qualified: false,
        reason: `Filtered: Aggregator or directory domain (${domain})`
      };
    }
  }

  // 2. Filter listicles, reviews, and promotional roundups (Step 5d)
  if (/^(top\s+\d+|\d+\s+top|best\s+\d+|\d+\s+best|\d+\s+ways|\d+\s+tips|reviews?|guide|vs|features?)\b/i.test(lowerTitle)) {
    return {
      intentClass: 'JUNK',
      qualified: false,
      reason: 'Filtered: Directory listicle, guide, or promotional roundup'
    };
  }

  // 3. Step 5d: A signal qualifies only if a person asks for help or a recommendation
  const isHelpOrRecommendation = /\b(how\s+to|how\s+can|how\s+do|suggest|recommend|recommendation|looking\s+for|anyone\s+know|what\s+do\s+you\s+use|need\s+help|struggling\s+with|problem\s+with|any\s+advice|tips\s+for|inquiry\s+delay|missed\s+call)\b/i.test(combinedText);
  if (!isHelpOrRecommendation) {
    return {
      intentClass: 'RESEARCH',
      qualified: false,
      reason: 'Filtered: Not a request for help or recommendation (publisher article, announcement, or informational text)'
    };
  }

  // 4. Check for clinic / SMB lead handling intent signals
  const highIntentKeywords = [
    'missed call', 'missed lead', 'after hours', 'receptionist',
    'whatsapp booking', 'patient response', 'inquiry delay', 'appointment booking',
    'lead qualification', 'instant reply', 'lead conversion',
    'handle inquiries', 'patient inquiries', 'clinic automation'
  ];

  const matched = highIntentKeywords.filter(k => lowerTitle.includes(k) || lowerSnippet.includes(k));

  if (matched.length >= 2) {
    return {
      intentClass: 'HIGH_INTENT',
      qualified: true,
      reason: `High intent: Matched signals [${matched.slice(0, 3).join(', ')}]`
    };
  } else if (matched.length === 1 || lowerTitle.includes('whatsapp') || lowerSnippet.includes('whatsapp') || lowerTitle.includes('clinic') || lowerSnippet.includes('clinic')) {
    return {
      intentClass: 'INQUIRY',
      qualified: true,
      reason: `Qualified inquiry: Matched [${matched[0] || 'relevant operational discussion'}]`
    };
  }

  return {
    intentClass: 'RESEARCH',
    qualified: false,
    reason: 'Insufficient buyer intent: No specific inquiry or lead handling signals observed'
  };
}

export class ReplyDeskService {
  private static instance: ReplyDeskService;

  public static getInstance(): ReplyDeskService {
    if (!ReplyDeskService.instance) {
      ReplyDeskService.instance = new ReplyDeskService();
    }
    return ReplyDeskService.instance;
  }

  public ensureTable(): void {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS reply_desk_drafts (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        snippet TEXT NOT NULL,
        draft_answer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        intent_class TEXT DEFAULT 'DIRECT_NEED',
        qualification_status TEXT DEFAULT 'QUALIFIED',
        qualification_reason TEXT,
        next_permitted_action TEXT DEFAULT 'OWNER_REVIEW_AND_MANUAL_POST',
        query_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    try { db.prepare(`ALTER TABLE reply_desk_drafts ADD COLUMN intent_class TEXT DEFAULT 'DIRECT_NEED'`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_drafts ADD COLUMN qualification_status TEXT DEFAULT 'QUALIFIED'`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_drafts ADD COLUMN qualification_reason TEXT`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_drafts ADD COLUMN next_permitted_action TEXT DEFAULT 'OWNER_REVIEW_AND_MANUAL_POST'`).run(); } catch {}

    db.prepare(`
      CREATE TABLE IF NOT EXISTS reply_desk_query_runs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        run_date TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'TAVILY',
        execution_time_ms INTEGER DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 1,
        result_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    try { db.prepare(`ALTER TABLE reply_desk_query_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'TAVILY'`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_query_runs ADD COLUMN execution_time_ms INTEGER DEFAULT 0`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_query_runs ADD COLUMN success INTEGER NOT NULL DEFAULT 1`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_query_runs ADD COLUMN result_count INTEGER NOT NULL DEFAULT 0`).run(); } catch {}
    try { db.prepare(`ALTER TABLE reply_desk_query_runs ADD COLUMN error_message TEXT`).run(); } catch {}

    // Step 5b: Table for rotated niche discovery queries with reasoning
    db.prepare(`
      CREATE TABLE IF NOT EXISTS reply_desk_queries (
        query TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        last_run_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    const existingQ = db.prepare(`SELECT COUNT(*) as count FROM reply_desk_queries`).get() as any;
    if (!existingQ || existingQ.count === 0) {
      const initialQueries = [
        {
          q: 'how to handle missed patient calls dental clinic whatsapp India',
          r: 'Dentists asking how to capture evening missed patient calls without night receptionist'
        },
        {
          q: 'whatsapp appointment booking auto reply for salon clinic India',
          r: 'Salons and clinics seeking automated appointment booking auto-responders on WhatsApp'
        },
        {
          q: 'receptionist missing patient inquiries after hours clinic automation',
          r: 'Practice managers seeking to eliminate lead loss when physical front desk is closed'
        },
        {
          q: 'dental clinic patient inquiry follow up system whatsapp',
          r: 'Clinics asking how to follow up with unconfirmed patient inquiries with zero advertising spend'
        }
      ];
      for (const item of initialQueries) {
        db.prepare(`
          INSERT INTO reply_desk_queries (query, reason, last_run_at, created_at)
          VALUES (?, ?, NULL, datetime('now'))
          ON CONFLICT(query) DO NOTHING
        `).run(item.q, item.r);
      }
    }
  }

  private d1Repo = D1RevenueRepository.getInstance();

  /**
   * Syncs today's reply desk query runs from durable D1 into local SQLite on startup / cron wake.
   */
  public async syncFromD1Async(): Promise<void> {
    if (!isProduction()) return;
    try {
      this.ensureTable();
      const todayStr = new Date().toISOString().slice(0, 10);
      const rows = await this.d1Repo.query<any>(
        'reply_desk_query_runs',
        'SELECT * FROM reply_desk_query_runs WHERE run_date = ?',
        [todayStr]
      );
      if (rows && rows.length > 0) {
        const db = getDb();
        const stmt = db.prepare(`
          INSERT INTO reply_desk_query_runs (
            id, query, run_date, provider, execution_time_ms, success, result_count, error_message, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `);
        for (const r of rows) {
          try {
            stmt.run(
              r.id, r.query, r.run_date, r.provider || 'TAVILY',
              r.execution_time_ms || 0, r.success ?? 1, r.result_count || 0,
              r.error_message || null, r.created_at || new Date().toISOString()
            );
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn(`[ReplyDesk] Failed to sync query runs from D1: ${err.message}`);
    }
  }

  /**
   * Checks the number of Tavily queries executed today (max 2 per day).
   */
  public getQueriesRunToday(dateStr: string = new Date().toISOString().slice(0, 10)): number {
    this.ensureTable();
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as count FROM reply_desk_query_runs WHERE run_date = ?`).get(dateStr) as any;
    return Number(row?.count || 0);
  }

  /**
   * Async check of queries run today, querying D1 strictly in production.
   * If D1 read fails or returns invalid result in production, throws D1_QUOTA_READ_FAILED
   * to fail closed rather than falling back to local SQLite.
   */
  public async getQueriesRunTodayAsync(dateStr: string = new Date().toISOString().slice(0, 10)): Promise<number> {
    if (isProduction()) {
      try {
        const row = await this.d1Repo.queryOne<{ count: number }>(
          'reply_desk_query_runs',
          'SELECT COUNT(*) as count FROM reply_desk_query_runs WHERE run_date = ?',
          [dateStr]
        );
        if (row && typeof row.count === 'number') {
          return row.count;
        }
        throw new Error('D1 returned invalid count payload');
      } catch (err: any) {
        throw new Error(`D1_QUOTA_READ_FAILED: Could not read reply desk query count from D1 in production: ${err.message}`);
      }
    }
    return this.getQueriesRunToday(dateStr);
  }

  /**
   * Runs the reply desk discovery process with strict 2 queries/day cap.
   * Accepts customSearchFn for hermetic testing.
   */
  public async discoverAndDraftReplies(
    dateStr: string = new Date().toISOString().slice(0, 10),
    customSearchFn?: (query: string) => Promise<PublicRequestItem[]>
  ): Promise<{ queriesRun: number; newDraftsCount: number; message: string }> {
    this.ensureTable();
    if (isProduction()) {
      await this.syncFromD1Async();
    }
    const currentRuns = await this.getQueriesRunTodayAsync(dateStr);
    if (currentRuns >= 2) {
      return {
        queriesRun: 0,
        newDraftsCount: 0,
        message: 'RATE_LIMIT: Maximum 2 Tavily queries per day reached for Reply Desk.'
      };
    }

    const availableQueries = 2 - currentRuns;
    const db = getDb();

    // Step 5b: Rotate queries based on durable run history, avoiding re-running the same query within 7 days
    let queries: string[] = [];
    try {
      let recentQueries: string[] = [];
      if (isProduction()) {
        const rows = await this.d1Repo.query<{ query: string }>(
          'reply_desk_query_runs',
          "SELECT DISTINCT query FROM reply_desk_query_runs WHERE created_at >= datetime('now', '-7 days')"
        );
        recentQueries = (rows || []).map(r => r.query);
      } else {
        const rows = db.prepare(`SELECT DISTINCT query FROM reply_desk_query_runs WHERE created_at >= datetime('now', '-7 days')`).all() as any[];
        recentQueries = rows.map(r => r.query);
      }
      queries = DEFAULT_REPLY_DESK_QUERIES.filter(q => !recentQueries.includes(q)).slice(0, availableQueries);
    } catch {}

    if (queries.length === 0) {
      queries = DEFAULT_REPLY_DESK_QUERIES.slice(0, availableQueries);
    }

    let totalNewDrafts = 0;

    for (const q of queries) {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const startMs = Date.now();
      let items: PublicRequestItem[] = [];
      let success = 1;
      let errorMessage: string | null = null;

      if (customSearchFn) {
        try {
          items = await customSearchFn(q);
        } catch (err: any) {
          success = 0;
          errorMessage = err.message;
        }
      } else if (process.env.TAVILY_API_KEY && !process.env.TAVILY_API_KEY.includes('mock')) {
        try {
          const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: process.env.TAVILY_API_KEY,
              query: q,
              search_depth: 'basic',
              max_results: 3
            })
          });
          if (res.ok) {
            const data = await res.json() as any;
            items = (data.results || []).map((r: any) => ({
              title: (r.title || '').slice(0, 200),
              snippet: (r.content || r.snippet || '').slice(0, 300),
              url: r.url,
              date: dateStr
            }));
          } else {
            success = 0;
            errorMessage = `HTTP ${res.status}: ${res.statusText}`;
          }
        } catch (err: any) {
          success = 0;
          errorMessage = err.message;
          console.warn(`[ReplyDesk] Search query error: ${err.message}`);
        }
      }

      const elapsedMs = Date.now() - startMs;

      // Record query run with telemetry locally and to Cloudflare D1
      const sqlRun = `
        INSERT INTO reply_desk_query_runs (id, query, run_date, provider, execution_time_ms, success, result_count, error_message)
        VALUES (?, ?, ?, 'TAVILY', ?, ?, ?, ?)
      `;
      const runParams = [runId, q, dateStr, elapsedMs, success, items.length, errorMessage];

      if (isProduction()) {
        try {
          const writeRes = await this.d1Repo.executeWrite('reply_desk_query_runs', sqlRun, runParams);
          if (writeRes.rowsAffected === 0) {
            throw new Error('D1 query run write affected 0 rows');
          }
          db.prepare(sqlRun).run(...runParams);
        } catch (d1Err: any) {
          console.error(`[ReplyDesk] Failed to write query run to D1: ${d1Err.message}`);
          throw new Error(`D1_PERSISTENCE_FAILED: Failed to record query run in D1: ${d1Err.message}`);
        }
      } else {
        db.prepare(sqlRun).run(...runParams);
      }

      for (const item of items) {
        // Enforce intent assessment and reject directory / listicle / unbacked content
        const assessment = assessPublicSignal(item.title, item.snippet, item.url);
        if (!assessment.qualified) {
          continue;
        }

        // Enforce: Store title, snippet, URL, date only. No names!
        const draftAnswer = this.composeDraftAnswer(item.title, item.snippet);
        const draftId = `rdraft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const sqlDraft = `
          INSERT INTO reply_desk_drafts (
            id, source_url, title, snippet, draft_answer, status,
            intent_class, qualification_status, qualification_reason, next_permitted_action, query_date, is_test
          )
          VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, 'QUALIFIED', ?, 'OWNER_REVIEW_AND_MANUAL_POST', ?, 0)
          ON CONFLICT(source_url) DO UPDATE SET
            title = excluded.title,
            snippet = excluded.snippet,
            draft_answer = excluded.draft_answer,
            intent_class = excluded.intent_class,
            qualification_status = excluded.qualification_status,
            qualification_reason = excluded.qualification_reason,
            query_date = excluded.query_date,
            is_test = excluded.is_test
        `;
        const draftParams = [
          draftId, item.url, item.title, item.snippet, draftAnswer,
          assessment.intentClass, assessment.reason, dateStr
        ];

        try {
          if (isProduction()) {
            const draftRes = await this.d1Repo.executeWrite('reply_desk_drafts', sqlDraft, draftParams);
            if (draftRes.rowsAffected === 0) {
              throw new Error('D1 draft write affected 0 rows');
            }
            db.prepare(sqlDraft).run(...draftParams);
          } else {
            db.prepare(sqlDraft).run(...draftParams);
          }
          totalNewDrafts++;
        } catch (draftErr: any) {
          if (isProduction()) {
            console.error(`[ReplyDesk] Failed to persist draft: ${draftErr.message}`);
            throw new Error(`D1_PERSISTENCE_FAILED: Failed to record draft in D1: ${draftErr.message}`);
          }
        }
      }
    }

    // Step 5f: If a week gives fewer than 3 qualified signals, write an OUTCOME row idempotently
    try {
      const pastWeekQualified = db.prepare(`
        SELECT COUNT(*) as count FROM reply_desk_drafts
        WHERE qualification_status = 'QUALIFIED'
          AND is_test = 0
          AND created_at >= datetime('now', '-7 days')
      `).get() as any;
      if (pastWeekQualified && pastWeekQualified.count < 3) {
        const sqlLearning = `
          INSERT OR REPLACE INTO learning_records (
            id, organization_id, cycle_id, action_type, hypothesis, rationale, outcome,
            metric_before, metric_after, delta, impact_classification, created_at
          ) VALUES (
            'lrn_reply_desk_zero_buyer_signals',
            'org_owner_primary', 'cron_reply_desk', 'REPLY_DESK_QUERY_ROTATION',
            'Weekly qualified intent signals yield >= 3 drafts',
            'Evaluated past 7-day reply desk yield',
            'LESS_THAN_3_QUALIFIED_SIGNALS: Recorded ' || ? || ' qualified drafts; rotating query pool',
            3, ?, ? - 3, 'NEUTRAL', datetime('now')
          )
        `;
        const lrParams = [pastWeekQualified.count, pastWeekQualified.count, pastWeekQualified.count];
        db.prepare(sqlLearning).run(...lrParams);

        if (isProduction()) {
          await this.d1Repo.executeWrite('learning_records', sqlLearning, lrParams).catch((err: any) => {
            console.error(`[ReplyDesk] Failed to record learning outcome to D1: ${err.message}`);
          });
        }
      }
    } catch {}

    return {
      queriesRun: queries.length,
      newDraftsCount: totalNewDrafts,
      message: `Completed ${queries.length} queries; stored ${totalNewDrafts} reply drafts.`
    };
  }

  /**
   * Deterministically crafts a short answer strictly using owner/OWN_OFFER.md specifications.
   * Never posts externally.
   */
  public composeDraftAnswer(title: string, snippet: string): string {
    const isAttested = DirectCommercialOfferPage.isDirectOfferAttested();
    if (isAttested) {
      return (
        `[INTERNAL OWNER DRAFT] Inquiry regarding operational lead response: ` +
        `Direct commercial solution for after-hours business inquiries (automated WhatsApp qualification bot). ` +
        `Deliverables and SLAs defined in approved commercial terms. For owner review and manual posting only.`
      );
    }
    return (
      `[INTERNAL EVIDENCE SUMMARY] Observed buyer intent inquiry: "${title}". ` +
      `Context: ${snippet.slice(0, 200)}. ` +
      `Solution category: automated WhatsApp qualification bot. ` +
      `Commercial offer unattested. Internal intelligence record for owner review only. No external claims or pricing promised.`
    );
  }

  /**
   * Returns up to 3 recent reply drafts for the Owner Digest.
   */
  public getRecentDrafts(limit: number = 3): ReplyDraft[] {
    this.ensureTable();
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, source_url as sourceUrl, title as requestTitle, snippet as requestSnippet,
             draft_answer as draftAnswer, status, intent_class as intentClass,
             qualification_status as qualificationStatus, qualification_reason as qualificationReason,
             next_permitted_action as nextPermittedAction, created_at as createdAt
      FROM reply_desk_drafts
      WHERE status = 'DRAFT' AND is_test = 0
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as ReplyDraft[];
    return rows;
  }

  /**
   * Returns up to recent reply drafts from D1 in production.
   * Returns 'UNKNOWN' on D1 query error without falling back to local SQLite.
   */
  public async getRecentDraftsAsync(limit: number = 3): Promise<ReplyDraft[] | 'UNKNOWN'> {
    if (isProduction()) {
      try {
        const rows = await this.d1Repo.query<any>(
          'reply_desk_drafts',
          `SELECT id, source_url as sourceUrl, title as requestTitle, snippet as requestSnippet,
                  draft_answer as draftAnswer, status, intent_class as intentClass,
                  qualification_status as qualificationStatus, qualification_reason as qualificationReason,
                  next_permitted_action as nextPermittedAction, created_at as createdAt
           FROM reply_desk_drafts
           WHERE status = 'DRAFT' AND is_test = 0
           ORDER BY created_at DESC
           LIMIT ?`,
          [limit]
        );
        return (rows || []) as ReplyDraft[];
      } catch {
        return 'UNKNOWN';
      }
    }
    return this.getRecentDrafts(limit);
  }
}
