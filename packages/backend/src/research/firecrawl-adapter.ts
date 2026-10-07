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

export class FirecrawlAdapter {
  private static instance: FirecrawlAdapter;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readonly APPLICATION_LIMIT = 300; // 30% of 1,000 monthly free credits
  public static readonly MONTHLY_FREE_ALLOWANCE = 1000;

  public static readonly APPROVED_MANUFACTURER_HOSTS = new Set([
    'phomemo.com',
    'www.phomemo.com',
    'everycom.in',
    'www.everycom.in',
    'tvs-e.in',
    'www.tvs-e.in',
    'tvs-electronics.com',
    'www.tvs-electronics.com',
    'zebra.com',
    'www.zebra.com',
    'epson.co.in',
    'www.epson.co.in',
    'epson.com',
    'brother.in',
    'www.brother.in'
  ]);

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
   * Validates if a host is on the approved manufacturer source allowlist.
   */
  public isApprovedHost(hostname: string): boolean {
    const host = (hostname || '').toLowerCase().trim();
    return FirecrawlAdapter.APPROVED_MANUFACTURER_HOSTS.has(host);
  }

  /**
   * Scrapes a manufacturer specification page.
   * Rules:
   * 1. Blocks every amazon.* host.
   * 2. Scrapes only approved manufacturer hosts.
   * 3. Uses 30-day cache (second fetch consumes 0 credits).
   * 4. Logs to provider_call_logs with query=null, url=targetUrl.
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

    // RULE 2: Only fetch hosts on the approved manufacturer source list
    if (!this.isApprovedHost(host)) {
      throw new Error(`SECURITY_ERROR: Host '${host}' is not in the approved manufacturer source allowlist. Only official manufacturer domains are allowed.`);
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

    // RULE 4: Perform Scrape
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey || isPlaceholderCredential(apiKey)) {
      // In non-production testing with missing API key, return mock specimen
      if (!isProduction()) {
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
      throw new Error('CONFIG_ERROR: FIRECRAWL_API_KEY is not configured in production.');
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

    // Record 1 call in provider_call_logs with query and url
    await this.logCall(rawUrl, 1, options.caller || 'firecrawl-adapter');

    return {
      markdown,
      title,
      sourceUrl: rawUrl,
      fromCache: false,
      creditsConsumed: 1
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

  private async logCall(url: string, credits: number, caller: string): Promise<void> {
    const callId = `call_${Date.now()}_${randomUUID().substring(0, 5)}`;
    const sql = `
      INSERT INTO provider_call_logs (
        id, provider, action_type, priority, units, success, is_rate_limit,
        query, url, duplicate_of, created_at
      ) VALUES (?, 'FIRECRAWL', 'SPEC_SCRAPE', 'P3', ?, 1, 0, NULL, ?, NULL, datetime('now'));
    `;
    if (isProduction()) {
      await this.d1Repo.executeWrite('provider_call_logs', sql, [callId, credits, url]).catch(() => {});
      return;
    }
    try {
      getDb().prepare(sql).run(callId, credits, url);
    } catch {}
  }
}
