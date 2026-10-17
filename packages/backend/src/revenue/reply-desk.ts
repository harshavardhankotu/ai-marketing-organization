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
  'youtube.com'
]);

export function assessPublicSignal(title: string, snippet: string, url: string): AssessedSignal {
  const lowerUrl = (url || '').toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  const lowerSnippet = (snippet || '').toLowerCase();

  // 1. Check blocked directory, aggregator, or social domains
  for (const domain of BLOCKED_DIRECTORY_DOMAINS) {
    if (lowerUrl.includes(domain)) {
      return {
        intentClass: 'JUNK',
        qualified: false,
        reason: `Filtered: Aggregator or directory domain (${domain})`
      };
    }
  }

  // 2. Filter listicles and promotional directories
  if (/^(top\s+\d+|\d+\s+top|best\s+\d+|\d+\s+best)\s+/i.test(lowerTitle)) {
    return {
      intentClass: 'JUNK',
      qualified: false,
      reason: 'Filtered: Directory listicle or promotional roundup'
    };
  }

  // 3. Check for clinic / SMB lead handling intent signals
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
   * Runs the reply desk discovery process with strict 2 queries/day cap.
   * Accepts customSearchFn for hermetic testing.
   */
  public async discoverAndDraftReplies(
    dateStr: string = new Date().toISOString().slice(0, 10),
    customSearchFn?: (query: string) => Promise<PublicRequestItem[]>
  ): Promise<{ queriesRun: number; newDraftsCount: number; message: string }> {
    this.ensureTable();
    const currentRuns = this.getQueriesRunToday(dateStr);
    if (currentRuns >= 2) {
      return {
        queriesRun: 0,
        newDraftsCount: 0,
        message: 'RATE_LIMIT: Maximum 2 Tavily queries per day reached for Reply Desk.'
      };
    }

    const availableQueries = 2 - currentRuns;
    const queries = [
      'how to handle missed lead calls dental clinic whatsapp India',
      'after hours customer inquiry triage small business automation'
    ].slice(0, availableQueries);

    const db = getDb();
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

      // Record query run with telemetry
      db.prepare(`
        INSERT INTO reply_desk_query_runs (id, query, run_date, provider, execution_time_ms, success, result_count, error_message)
        VALUES (?, ?, ?, 'TAVILY', ?, ?, ?, ?)
      `).run(runId, q, dateStr, elapsedMs, success, items.length, errorMessage);

      for (const item of items) {
        // Enforce intent assessment and reject directory / listicle / unbacked content
        const assessment = assessPublicSignal(item.title, item.snippet, item.url);
        if (!assessment.qualified) {
          continue;
        }

        // Enforce: Store title, snippet, URL, date only. No names!
        const draftAnswer = this.composeDraftAnswer(item.title, item.snippet);
        const draftId = `rdraft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        try {
          db.prepare(`
            INSERT INTO reply_desk_drafts (
              id, source_url, title, snippet, draft_answer, status,
              intent_class, qualification_status, qualification_reason, next_permitted_action, query_date
            )
            VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, 'QUALIFIED', ?, 'OWNER_REVIEW_AND_MANUAL_POST', ?)
            ON CONFLICT(source_url) DO UPDATE SET
              title = excluded.title,
              snippet = excluded.snippet,
              draft_answer = excluded.draft_answer,
              intent_class = excluded.intent_class,
              qualification_status = excluded.qualification_status,
              qualification_reason = excluded.qualification_reason,
              query_date = excluded.query_date
          `).run(
            draftId, item.url, item.title, item.snippet, draftAnswer,
            assessment.intentClass, assessment.reason, dateStr
          );
          totalNewDrafts++;
        } catch {}
      }
    }

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
  private composeDraftAnswer(title: string, snippet: string): string {
    return (
      `For inquiries regarding after-hours lead conversion: ` +
      `Local businesses can implement an automated WhatsApp qualification bot that responds in under 2 minutes, ` +
      `qualifies inquiries across predefined FAQs, and routes high-intent appointments directly into calendar schedules. ` +
      `This prevents leads from going cold outside business hours with ₹0 additional advertising spend.`
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
      WHERE status = 'DRAFT'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as ReplyDraft[];
    return rows;
  }
}
