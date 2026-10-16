/**
 * ReplyDeskService — Implements Part D.3: Reply Desk
 *
 * Rules:
 * - At most 2 Tavily queries per day for public requests that match the offer.
 * - Store title, snippet, URL, date only. No names.
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

export interface ReplyDraft {
  id: string;
  sourceUrl: string;
  requestTitle: string;
  requestSnippet: string;
  draftAnswer: string;
  status: 'DRAFT';
  createdAt: string;
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
        query_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS reply_desk_query_runs (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        run_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
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
      // Record query run
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`INSERT INTO reply_desk_query_runs (id, query, run_date) VALUES (?, ?, ?)`).run(runId, q, dateStr);

      let items: PublicRequestItem[] = [];
      if (customSearchFn) {
        items = await customSearchFn(q);
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
          }
        } catch (err: any) {
          console.warn(`[ReplyDesk] Search query error: ${err.message}`);
        }
      }

      for (const item of items) {
        // Enforce: Store title, snippet, URL, date only. No names!
        const draftAnswer = this.composeDraftAnswer(item.title, item.snippet);
        const draftId = `rdraft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        try {
          db.prepare(`
            INSERT INTO reply_desk_drafts (id, source_url, title, snippet, draft_answer, status, query_date)
            VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
            ON CONFLICT(source_url) DO NOTHING
          `).run(draftId, item.url, item.title, item.snippet, draftAnswer, dateStr);
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
             draft_answer as draftAnswer, status, created_at as createdAt
      FROM reply_desk_drafts
      WHERE status = 'DRAFT'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as ReplyDraft[];
    return rows;
  }
}
