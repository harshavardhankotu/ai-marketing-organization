/**
 * google-indexing-client.ts
 *
 * Google Indexing API Integration Guard with Strict Policy Gates:
 * - Free-Plan Quota: 180 requests/day hard cap (20-request safety buffer on 200 free quota)
 * - Strict Schema Gate: ONLY JobPosting and BroadcastEvent (in VideoObject) pages are eligible
 * - Ineligible Pages: Automatically routed to Sitemap + IndexNow + Search Console syndication
 */

import { createSign } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';

export type IndexingNotificationType = 'URL_UPDATED' | 'URL_DELETED';

export interface IndexingResult {
  success: boolean;
  status: 'PUBLISHED' | 'PUBLISHED_SANDBOX' | 'SKIPPED_INELIGIBLE_SCHEMA_TYPE' | 'QUOTA_EXHAUSTED' | 'ERROR' | 'BLOCKED_INVALID_CREDENTIALS';
  url: string;
  reason?: string;
  fallback?: string;
  remainingToday?: number;
  quotaConsumed?: boolean;
  allowedByPolicy?: boolean;
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
  private quotaService = UnifiedQuotaService.getInstance();
  private cachedToken?: string;
  private cachedTokenExpiryMs: number = 0;

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
      // Defect 1: Fail closed when ledger is unavailable
      return GoogleIndexingClient.MAX_DAILY_REQUESTS;
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

  private getServiceAccountKey(): string | undefined {
    return process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_KEY || this.serviceAccountKey || process.env.GOOGLE_INDEXING_API;
  }

  /**
   * Exchanges Service Account JSON credentials for an OAuth2 Bearer token via signed RS256 JWT.
   * Caches token in memory until 60 seconds before expiration.
   */
  public async getOAuth2AccessToken(): Promise<{ token?: string; error?: string }> {
    const rawKey = this.getServiceAccountKey();
    if (!rawKey || isPlaceholderCredential(rawKey)) {
      return { error: 'BLOCKED_INVALID_CREDENTIALS' };
    }

    let creds: { client_email?: string; private_key?: string } | null = null;
    try {
      const str = rawKey.trim();
      creds = str.startsWith('{') ? JSON.parse(str) : JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
    } catch {
      return { error: 'BLOCKED_INVALID_CREDENTIALS' };
    }

    if (!creds?.client_email || !creds?.private_key) {
      return { error: 'BLOCKED_INVALID_CREDENTIALS' };
    }

    if (this.cachedToken && Date.now() < this.cachedTokenExpiryMs - 60000) {
      return { token: this.cachedToken };
    }

    try {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const claimSet = Buffer.from(JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/indexing',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      })).toString('base64url');

      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claimSet}`);
      const signature = signer.sign(creds.private_key, 'base64url');
      const assertion = `${header}.${claimSet}.${signature}`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        return { error: `OAUTH2_EXCHANGE_FAILED: HTTP ${tokenRes.status}: ${errBody}` };
      }

      const tokenData = (await tokenRes.json()) as any;
      const accessToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in || 3600;

      this.cachedToken = accessToken;
      this.cachedTokenExpiryMs = Date.now() + (expiresIn * 1000);
      return { token: accessToken };
    } catch (jwtErr: any) {
      return { error: `BLOCKED_INVALID_CREDENTIALS: ${jwtErr.message}` };
    }
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
        fallback: 'ROUTED_TO_SITEMAP_INDEXNOW',
        quotaConsumed: false
      };
    }

    // 2. Centralized Atomic D1/SQLite Quota Reservation (180 requests/day)
    // Check both legacy daily table (for backwards test compatibility) and unified quota ledger
    const legacyCount = await this.getDailyRequestCount();
    if (legacyCount >= GoogleIndexingClient.MAX_DAILY_REQUESTS) {
      return {
        success: false,
        status: 'QUOTA_EXHAUSTED',
        url,
        reason: `Daily Google Indexing API limit (${GoogleIndexingClient.MAX_DAILY_REQUESTS}/day) reached.`,
        fallback: 'ROUTED_TO_SITEMAP_INDEXNOW',
        remainingToday: 0
      };
    }

    const quotaRes = await this.quotaService.reserveProviderQuota('google_indexing', 1);
    if (!quotaRes.allowed) {
      if (quotaRes.reason === 'QUOTA_LEDGER_UNAVAILABLE') {
        return {
          success: false,
          status: 'ERROR',
          url,
          reason: 'QUOTA_LEDGER_UNAVAILABLE',
          fallback: 'ROUTED_TO_SITEMAP_INDEXNOW'
        };
      }
      return {
        success: false,
        status: 'QUOTA_EXHAUSTED',
        url,
        reason: quotaRes.reason || `Daily Google Indexing API limit reached.`,
        fallback: 'ROUTED_TO_SITEMAP_INDEXNOW',
        remainingToday: 0
      };
    }

    // 3. Execution (Live or Sandbox simulated)
    const serviceKey = this.getServiceAccountKey();
    const isLive = Boolean(serviceKey && !isPlaceholderCredential(serviceKey));
    if (isLive) {
      const auth = await this.getOAuth2AccessToken();
      if (auth.error) {
        if (quotaRes.reservationId) {
          await this.quotaService.reconcileProviderQuota('google_indexing', quotaRes.reservationId, 'RELEASE');
        }
        return {
          success: false,
          status: 'BLOCKED_INVALID_CREDENTIALS',
          url,
          reason: `GOOGLE_INDEXING_API credentials error: ${auth.error}`
        };
      }

      try {
        const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${auth.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url,
            type
          })
        });

        if (!res.ok) {
          const errText = await res.text();
          if (quotaRes.reservationId) {
            await this.quotaService.reconcileProviderQuota('google_indexing', quotaRes.reservationId, 'CONSUME');
          }
          return {
            success: false,
            status: 'ERROR',
            url,
            reason: `Google Indexing API HTTP ${res.status}: ${errText}`
          };
        }
      } catch (err: any) {
        if (quotaRes.reservationId) {
          await this.quotaService.reconcileProviderQuota('google_indexing', quotaRes.reservationId, 'RELEASE');
        }
        return {
          success: false,
          status: 'ERROR',
          url,
          reason: `Google Indexing API error: ${err.message}`
        };
      }
    }

    if (quotaRes.reservationId) {
      await this.quotaService.reconcileProviderQuota('google_indexing', quotaRes.reservationId, 'CONSUME');
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
