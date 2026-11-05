/**
 * google-indexing-client.ts
 *
 * Google Indexing API Integration Guard with Strict Policy Gates:
 * - Free-Plan Quota: 180 requests/day hard cap (20-request safety buffer on 200 free quota)
 * - Strict Schema Gate: ONLY JobPosting and BroadcastEvent (in VideoObject) pages are eligible
 * - Ineligible Pages: Automatically routed to Sitemap + IndexNow + Search Console syndication
 */

import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';

export type IndexingNotificationType = 'URL_UPDATED' | 'URL_DELETED';

export interface IndexingResult {
  success: boolean;
  status: 'PUBLISHED' | 'PUBLISHED_SANDBOX' | 'SKIPPED_INELIGIBLE_SCHEMA_TYPE' | 'QUOTA_EXHAUSTED' | 'ERROR';
  url: string;
  reason?: string;
  fallback?: string;
  remainingToday?: number;
}

export interface PageSchemaMetadata {
  html?: string;
  hasJobPosting?: boolean;
  hasBroadcastEvent?: boolean;
}

export class GoogleIndexingClient {
  private static instance: GoogleIndexingClient;
  public static readonly MAX_DAILY_REQUESTS = 180;

  private serviceAccountKey?: string;
  private d1Repo = D1RevenueRepository.getInstance();

  private constructor() {
    this.serviceAccountKey = process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_INDEXING_API;
    this.ensureTables();
  }

  public static getInstance(): GoogleIndexingClient {
    if (!GoogleIndexingClient.instance) {
      GoogleIndexingClient.instance = new GoogleIndexingClient();
    }
    return GoogleIndexingClient.instance;
  }

  public static resetInstanceForTesting(): void {
    GoogleIndexingClient.instance = undefined as any;
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS google_indexing_daily_quota (
          date_utc TEXT PRIMARY KEY,
          requests_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}
  }

  private getTodayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  public async getDailyRequestCount(): Promise<number> {
    const today = this.getTodayUtc();
    try {
      if (isProduction() || this.d1Repo.isRemoteD1Configured()) {
        const row = await this.d1Repo.queryOne<{ requests_count: number }>(
          'google_indexing_daily_quota',
          'SELECT requests_count FROM google_indexing_daily_quota WHERE date_utc = ?',
          [today]
        );
        return row?.requests_count || 0;
      }
      const db = getDb();
      const row = db.prepare('SELECT requests_count FROM google_indexing_daily_quota WHERE date_utc = ?').get(today) as any;
      return row?.requests_count || 0;
    } catch {
      return 0;
    }
  }

  private async incrementDailyRequestCount(): Promise<number> {
    const today = this.getTodayUtc();
    const sql = `
      INSERT INTO google_indexing_daily_quota (date_utc, requests_count, updated_at)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(date_utc) DO UPDATE SET
        requests_count = requests_count + 1,
        updated_at = datetime('now');
    `;
    try {
      if (isProduction() || this.d1Repo.isRemoteD1Configured()) {
        await this.d1Repo.executeWrite('google_indexing_daily_quota', sql, [today]);
      }
      const db = getDb();
      db.prepare(sql).run(today);
    } catch {}
    return this.getDailyRequestCount();
  }

  /**
   * Validates if a page is compliant with Google Indexing API policies.
   * Google Indexing API is strictly limited to JobPosting and BroadcastEvent (VideoObject) types.
   */
  public isEligibleForIndexingApi(metadata?: PageSchemaMetadata): boolean {
    if (!metadata) return false;
    if (metadata.hasJobPosting || metadata.hasBroadcastEvent) return true;
    if (metadata.html) {
      const hasJob = /"@type"\s*:\s*"JobPosting"/i.test(metadata.html);
      const hasBroadcast = /"@type"\s*:\s*"(BroadcastEvent|VideoObject)"/i.test(metadata.html);
      return hasJob || hasBroadcast;
    }
    return false;
  }

  /**
   * Submits a URL to the Google Indexing API if eligible and within 180 requests/day cap.
   * Ineligible pages are routed to Sitemap + IndexNow syndication.
   */
  public async publishUrl(
    url: string,
    type: IndexingNotificationType = 'URL_UPDATED',
    metadata?: PageSchemaMetadata
  ): Promise<IndexingResult> {
    if (!url || !url.startsWith('http')) {
      return {
        success: false,
        status: 'ERROR',
        url,
        reason: 'Invalid URL supplied for indexing.'
      };
    }

    // 1. Strict Policy Gate: Check schema eligibility
    const isEligible = this.isEligibleForIndexingApi(metadata);
    if (!isEligible) {
      return {
        success: false,
        status: 'SKIPPED_INELIGIBLE_SCHEMA_TYPE',
        url,
        reason: 'Page does not contain JobPosting or BroadcastEvent schema. Direct Google Indexing API submission is prohibited.',
        fallback: 'ROUTED_TO_SITEMAP_INDEXNOW'
      };
    }

    // 2. Hard daily quota check (180 requests/day)
    const currentRequests = await this.getDailyRequestCount();
    if (currentRequests >= GoogleIndexingClient.MAX_DAILY_REQUESTS) {
      return {
        success: false,
        status: 'QUOTA_EXHAUSTED',
        url,
        reason: `Daily Google Indexing API limit (${GoogleIndexingClient.MAX_DAILY_REQUESTS}/day) reached.`,
        fallback: 'ROUTED_TO_SITEMAP_INDEXNOW',
        remainingToday: 0
      };
    }

    // 3. Execution (Live or Sandbox simulated)
    const isLive = Boolean(this.serviceAccountKey && !isPlaceholderCredential(this.serviceAccountKey));
    if (isLive) {
      try {
        // Live Google Indexing API HTTP POST
        // Requires OAuth2 bearer token derived from service account JWT
        const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.serviceAccountKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url,
            type
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          return {
            success: false,
            status: 'ERROR',
            url,
            reason: `Google Indexing API HTTP ${res.status}: ${errText}`
          };
        }
      } catch (err: any) {
        return {
          success: false,
          status: 'ERROR',
          url,
          reason: `Google Indexing API error: ${err.message}`
        };
      }
    }

    const newCount = await this.incrementDailyRequestCount();
    return {
      success: true,
      status: isLive ? 'PUBLISHED' : 'PUBLISHED_SANDBOX',
      url,
      remainingToday: Math.max(0, GoogleIndexingClient.MAX_DAILY_REQUESTS - newCount)
    };
  }
}
