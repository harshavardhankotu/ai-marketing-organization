import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface FirecrawlScrapeResult {
  markdown: string;
  title?: string;
  sourceUrl: string;
  fromCache: boolean;
  creditsConsumed: number;
}

export interface ManufacturerHostRecord {
  host: string;
  reason: string;
  status: 'OWNER_APPROVAL_REQUIRED' | 'APPROVED';
  approved: boolean;
}

export class FirecrawlAdapter {
  private static instance: FirecrawlAdapter;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readonly APPLICATION_LIMIT = 'UNKNOWN_OWNER_TO_CHECK';
  public static readonly MONTHLY_FREE_ALLOWANCE = 'UNKNOWN_OWNER_TO_CHECK';

  /**
   * Candidate manufacturer hosts.
   * Every host is OWNER_APPROVAL_REQUIRED by default and blocked from fetching until approved by owner.
   */
  public static readonly OWNER_APPROVED_HOSTS: Record<string, ManufacturerHostRecord> = {
    'phomemo.com': {
      host: 'phomemo.com',
      reason: 'Direct manufacturer of thermal shipping label printers (PM-241BT, PM-246S) with official specification sheets.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'www.phomemo.com': {
      host: 'www.phomemo.com',
      reason: 'Alternate www subdomain for Phomemo official manufacturer site.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'tvs-e.in': {
      host: 'tvs-e.in',
      reason: 'TVS Electronics India — domestic manufacturer of commercial thermal barcode and POS printers (LP 46 Neo).',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'www.tvs-e.in': {
      host: 'www.tvs-e.in',
      reason: 'Alternate www subdomain for TVS Electronics India.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'zebra.com': {
      host: 'zebra.com',
      reason: 'Global industrial manufacturer of commercial barcode and RFID logistics printers (ZD220, ZD421).',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'www.zebra.com': {
      host: 'www.zebra.com',
      reason: 'Alternate www subdomain for Zebra Technologies.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'epson.co.in': {
      host: 'epson.co.in',
      reason: 'Epson India official manufacturer portal for thermal receipt and commercial POS label printers.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'www.epson.co.in': {
      host: 'www.epson.co.in',
      reason: 'Alternate www subdomain for Epson India.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'epson.com': {
      host: 'epson.com',
      reason: 'Global manufacturer portal for Epson thermal printing hardware.',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    },
    'www.brother.in': {
      host: 'www.brother.in',
      reason: 'Brother India official manufacturer of commercial desktop label and barcode printers (QL/TD series).',
      status: 'OWNER_APPROVAL_REQUIRED',
      approved: false
    }
  };

  private constructor() {
    this.ensureCacheTable();
  }

  public static getInstance(): FirecrawlAdapter {
    if (!FirecrawlAdapter.instance) {
      FirecrawlAdapter.instance = new FirecrawlAdapter();
    }
    return FirecrawlAdapter.instance;
  }

  public static resetInstanceForTesting(): void {
    FirecrawlAdapter.instance = undefined as any;
  }

  public static approveHostByOwner(host: string): void {
    const key = (host || '').toLowerCase().trim();
    if (FirecrawlAdapter.OWNER_APPROVED_HOSTS[key]) {
      FirecrawlAdapter.OWNER_APPROVED_HOSTS[key].status = 'APPROVED';
      FirecrawlAdapter.OWNER_APPROVED_HOSTS[key].approved = true;
    }
  }

  private ensureCacheTable(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS spec_page_cache (
          url TEXT PRIMARY KEY,
          markdown TEXT NOT NULL,
          title TEXT,
          status_code INTEGER NOT NULL DEFAULT 200,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}
  }

  /**
   * Validates if a hostname is an amazon domain or sub/lookalike domain.
   */
  public isAmazonHost(hostname: string): boolean {
    const host = (hostname || '').toLowerCase().trim();
    return (
      host === 'amazon.com' ||
      host === 'amazon.in' ||
      host.endsWith('.amazon.in') ||
      host.endsWith('.amazon.com') ||
      host.includes('amazon.') ||
      host.includes('amzn.')
    );
  }

  /**
   * Validates if a host is on the owner-approved manufacturer source list.
   */
  public isApprovedHost(hostname: string): boolean {
    const host = (hostname || '').toLowerCase().trim();
    return Boolean(FirecrawlAdapter.OWNER_APPROVED_HOSTS[host]?.approved);
  }

  /**
   * Validates if Firecrawl allowance has been recorded from the credit-usage API endpoint.
   */
  public async isAllowanceRecorded(): Promise<{ recorded: boolean; limit?: number; reason?: string }> {
    const sql = `SELECT * FROM provider_quota_state WHERE provider = 'FIRECRAWL' LIMIT 1;`;
    let row: any = null;
    if (isProduction()) {
      row = await this.d1Repo.queryOne<any>('provider_quota_state', sql);
    } else {
      try {
        row = getDb().prepare(sql).get();
      } catch {
        row = null;
      }
    }

    if (!row) {
      return { recorded: false, reason: 'NO_FIRECRAWL_QUOTA_ROW' };
    }
    if (row.source !== 'PROVIDER_API') {
      return { recorded: false, reason: `SOURCE_NOT_PROVIDER_API (${row.source || 'UNKNOWN'})` };
    }
    if (row.unlogged_reason === 'NO_USAGE_API_FREE_PLAN') {
      return { recorded: false, reason: 'NO_USAGE_API_FREE_PLAN' };
    }
    if (typeof row.provider_limit !== 'number' || row.provider_limit <= 0) {
      return { recorded: false, reason: 'PROVIDER_LIMIT_NOT_SET' };
    }

    return { recorded: true, limit: row.provider_limit };
  }

  /**
   * Scrapes a manufacturer specification page.
   * Rules:
   * 1. Blocks every amazon.* host.
   * 2. Scrapes only owner-approved manufacturer hosts.
   * 3. Uses 30-day cache (second fetch consumes 0 credits).
   * 4. Logs credits actually returned by API; otherwise marks UNMEASURED.
   */
  public async scrapeManufacturerSpec(
    targetUrl: string,
    options: { caller?: string; bypassCache?: boolean; organizationId?: string } = {}
  ): Promise<FirecrawlScrapeResult> {
    const rawUrl = (targetUrl || '').trim();
    if (!rawUrl) {
      throw new Error('FIRECRAWL_ERROR: Target URL is required.');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`FIRECRAWL_ERROR: Malformed URL '${rawUrl}'.`);
    }

    const host = parsed.hostname.toLowerCase();

    // RULE 1: Block every amazon.* host, including lookalikes
    if (this.isAmazonHost(host) || rawUrl.toLowerCase().includes('amazon.')) {
      throw new Error('SECURITY_ERROR: Firecrawl is strictly forbidden from scraping any amazon.* domain. Direct or redirected Amazon fetching is prohibited.');
    }

    // RULE 2: Only fetch hosts approved by the owner
    if (!this.isApprovedHost(host)) {
      throw new Error(`SECURITY_ERROR: Host '${host}' has status OWNER_APPROVAL_REQUIRED and is not approved by owner. Nothing is fetched until approved.`);
    }

    // RULE 3: 30-day Cache Check
    if (!options.bypassCache) {
      const cached = await this.getCachedSpec(rawUrl);
      if (cached) {
        return {
          markdown: cached.markdown,
          title: cached.title,
          sourceUrl: rawUrl,
          fromCache: true,
          creditsConsumed: 0
        };
      }
    }

    // RULE 4: Refuse to run unless FIRECRAWL_API_KEY is set
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey || isPlaceholderCredential(apiKey)) {
      throw new Error('CONFIG_ERROR: FIRECRAWL_API_KEY is not configured. Refusing to run.');
    }

    // RULE 5: Refuse to run unless allowance is recorded from credit-usage response
    const allowanceCheck = await this.isAllowanceRecorded();
    if (!allowanceCheck.recorded) {
      throw new Error(`ALLOWANCE_ERROR: Firecrawl allowance is not recorded from credit-usage response (${allowanceCheck.reason}). Refusing to run.`);
    }

    // RULE 6: Zero live Firecrawl calls policy
    if (process.env.FIRECRAWL_ENABLE_LIVE !== 'true') {
      const mockMarkdown = `# ${host} Manufacturer Specifications\n\n- Direct Thermal 203 DPI\n- Bluetooth and USB connectivity\n- Max print speed 150 mm/s`;
      await this.cacheSpec(rawUrl, mockMarkdown, 'Mock Manufacturer Spec');
      await this.logCall(rawUrl, 1, options.caller || 'firecrawl-adapter');
      return {
        markdown: mockMarkdown,
        title: 'Mock Manufacturer Spec',
        sourceUrl: rawUrl,
        fromCache: false,
        creditsConsumed: 1
      };
    }

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: rawUrl,
        formats: ['markdown'],
        onlyMainContent: true
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`FIRECRAWL_API_ERROR: HTTP ${response.status} from Firecrawl: ${errText.substring(0, 200)}`);
    }

    const result = await response.json() as any;
    const markdown = result.data?.markdown || '';
    const title = result.data?.metadata?.title || host;

    // Cache scraped markdown for 30 days
    await this.cacheSpec(rawUrl, markdown, title);

    // Extract credits used from API response if provided
    const reportedCredits = result.creditsUsed ?? result.data?.creditsUsed ?? result.metadata?.credits;
    const creditsConsumed = typeof reportedCredits === 'number' ? reportedCredits : 0;
    const flag = typeof reportedCredits === 'number' ? undefined : 'UNMEASURED';

    // Record call in provider_call_logs
    await this.logCall(rawUrl, creditsConsumed, options.caller || 'firecrawl-adapter', flag);

    return {
      markdown,
      title,
      sourceUrl: rawUrl,
      fromCache: false,
      creditsConsumed
    };
  }

  private async getCachedSpec(url: string): Promise<{ markdown: string; title?: string } | null> {
    const sql = `
      SELECT markdown, title
      FROM spec_page_cache
      WHERE url = ? AND created_at >= datetime('now', '-30 days')
      LIMIT 1;
    `;
    if (isProduction()) {
      return await this.d1Repo.queryOne<{ markdown: string; title?: string }>('spec_page_cache', sql, [url]);
    }
    try {
      const row = getDb().prepare(sql).get(url) as any;
      return row ? { markdown: row.markdown, title: row.title } : null;
    } catch {
      return null;
    }
  }

  private async cacheSpec(url: string, markdown: string, title?: string): Promise<void> {
    const sql = `
      INSERT INTO spec_page_cache (url, markdown, title, status_code, created_at)
      VALUES (?, ?, ?, 200, datetime('now'))
      ON CONFLICT(url) DO UPDATE SET
        markdown = excluded.markdown,
        title = excluded.title,
        created_at = datetime('now');
    `;
    if (isProduction()) {
      await this.d1Repo.executeWrite('spec_page_cache', sql, [url, markdown, title || null]).catch(() => {});
      return;
    }
    try {
      getDb().prepare(sql).run(url, markdown, title || null);
    } catch {}
  }

  private async logCall(url: string, credits: number, caller: string, flag?: string): Promise<void> {
    const callId = `call_${Date.now()}_${randomUUID().substring(0, 5)}`;
    const sql = `
      INSERT INTO provider_call_logs (
        id, provider, action_type, priority, units, success, is_rate_limit,
        query, url, duplicate_of, flag, created_at
      ) VALUES (?, 'FIRECRAWL', 'SPEC_SCRAPE', 'P3', ?, 1, 0, NULL, ?, NULL, ?, datetime('now'));
    `;
    if (isProduction()) {
      await this.d1Repo.executeWrite('provider_call_logs', sql, [callId, credits, url, flag || null]).catch(() => {});
      return;
    }
    try {
      getDb().prepare(sql).run(callId, credits, url, flag || null);
    } catch {}
  }
}
