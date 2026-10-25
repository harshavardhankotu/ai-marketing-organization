/**
 * Cuelinks V3 Monetization API & MCP Client
 * Official Documentation: https://developers.cuelinks.com/docs
 * Authentication: Authorization: Token <API_KEY>
 * Strict error handling, SSRF defense, retry backoff, and idempotent sub-ID mapping.
 */

import { DealSsrfGuard } from './deal-ssrf-guard.js';
import {
  CuelinksCampaign,
  CuelinksOffer,
  CuelinksLinkConvertRequest,
  CuelinksLinkConvertResponse,
  CuelinksChannel,
  CuelinksTransaction,
  CuelinksReport,
  CuelinksCategory,
  CuelinksCountry,
  CuelinksPingResponse,
  CuelinksPingResult,
  CuelinksPingPublisher,
  CuelinksPingApiKey,
  CUELINKS_STANDARD_SCOPES
} from './cuelinks-v3-types.js';

export class CuelinksApiError extends Error {
  public readonly code:
    | 'CUELINKS_UNAUTHORIZED'
    | 'CUELINKS_FORBIDDEN'
    | 'CUELINKS_UNPROCESSABLE_ENTITY'
    | 'CUELINKS_RATE_LIMITED'
    | 'CUELINKS_SERVER_ERROR'
    | 'CUELINKS_API_ERROR'
    | 'CUELINKS_UNCONFIGURED'
    | 'CUELINKS_TIMEOUT'
    | 'CUELINKS_INVALID_URL';
  public readonly statusCode: number;

  constructor(
    code:
      | 'CUELINKS_UNAUTHORIZED'
      | 'CUELINKS_FORBIDDEN'
      | 'CUELINKS_UNPROCESSABLE_ENTITY'
      | 'CUELINKS_RATE_LIMITED'
      | 'CUELINKS_SERVER_ERROR'
      | 'CUELINKS_API_ERROR'
      | 'CUELINKS_UNCONFIGURED'
      | 'CUELINKS_TIMEOUT'
      | 'CUELINKS_INVALID_URL',
    message: string,
    statusCode: number = 0
  ) {
    super(`${code}: ${message}`);
    this.name = 'CuelinksApiError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, CuelinksApiError.prototype);
  }
}

export interface CuelinksClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class CuelinksV3Client {
  private static instance: CuelinksV3Client | null = null;
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;

  constructor(options?: CuelinksClientOptions) {
    this.apiKey = options?.apiKey ?? (process.env.CUELINKS_API_KEY || process.env.CUELINKS_TOKEN || '').trim();
    this.baseUrl = (options?.baseUrl ?? 'https://developers.cuelinks.com/pub_api/v3').replace(/\/$/, '');
    this.fetchFn = options?.fetchFn ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  public static getInstance(options?: CuelinksClientOptions): CuelinksV3Client {
    if (!CuelinksV3Client.instance || options) {
      CuelinksV3Client.instance = new CuelinksV3Client(options);
    }
    return CuelinksV3Client.instance;
  }

  public static resetInstance(): void {
    CuelinksV3Client.instance = null;
  }

  public isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Token ${this.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ai-marketing-organization-cuelinks/1.0'
    };
  }

  /**
   * Redacts sensitive tokens, API keys, and authorization headers from strings.
   * Enforces zero secret leakage across all logs and error messages.
   */
  private redactSecrets(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let sanitized = text;
    if (this.apiKey && this.apiKey.length > 0) {
      sanitized = sanitized.split(this.apiKey).join('[REDACTED]');
    }
    sanitized = sanitized
      .replace(/Token\s+[A-Za-z0-9_\-\.]+/gi, 'Token [REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
      .replace(/(api[-_]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[REDACTED]');
    return sanitized;
  }

  private async request<T>(endpoint: string, options: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new CuelinksApiError('CUELINKS_UNCONFIGURED', 'CUELINKS_API_KEY is not set.', 0);
    }

    let urlStr = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    if (options.query) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== '') {
          sp.set(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) {
        urlStr += (urlStr.includes('?') ? '&' : '?') + qs;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(urlStr, {
        method: options.method || 'GET',
        headers: this.getHeaders(),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      if (!res.ok) {
        let errBody = '';
        try { errBody = await res.text(); } catch {}
        const safeBody = this.redactSecrets(errBody);

        if (res.status === 401) {
          throw new CuelinksApiError(
            'CUELINKS_UNAUTHORIZED',
            `Invalid API key or unauthorized token. Status 401: ${safeBody}`,
            401
          );
        }
        if (res.status === 403) {
          throw new CuelinksApiError(
            'CUELINKS_FORBIDDEN',
            `Missing required API scope or forbidden access. Status 403: ${safeBody}`,
            403
          );
        }
        if (res.status === 422) {
          throw new CuelinksApiError(
            'CUELINKS_UNPROCESSABLE_ENTITY',
            `Unprocessable entity or invalid parameters. Status 422: ${safeBody}`,
            422
          );
        }
        if (res.status === 429) {
          throw new CuelinksApiError(
            'CUELINKS_RATE_LIMITED',
            `Rate limit exceeded. Status 429: ${safeBody}`,
            429
          );
        }
        if (res.status >= 500 && res.status <= 599) {
          throw new CuelinksApiError(
            'CUELINKS_SERVER_ERROR',
            `Transient server error. Status ${res.status}: ${safeBody}`,
            res.status
          );
        }
        throw new CuelinksApiError(
          'CUELINKS_API_ERROR',
          `HTTP ${res.status}: ${safeBody}`,
          res.status
        );
      }

      return (await res.json()) as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new CuelinksApiError('CUELINKS_TIMEOUT', `Request to ${endpoint} timed out after ${this.timeoutMs}ms`, 408);
      }
      if (err instanceof CuelinksApiError) {
        throw err;
      }
      const safeMessage = this.redactSecrets(err.message || 'Unknown network error');
      throw new Error(`CUELINKS_NETWORK_ERROR: ${safeMessage}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Domain safety guard: strictly validates allowed Cuelinks tracking domains.
   * Permitted tracking domains must strictly match:
   *  - clnk.in
   *  - *.clnk.in (strictly valid subdomains of clnk.in)
   *  - linksredirect.com
   *  - *.linksredirect.com (e.g. www.linksredirect.com)
   *
   * Rejects domain spoofing, tricky suffix matches (e.g. fakeclnk.in, clnk.in.attacker.com),
   * non-allowlisted domains, and invalid characters.
   */
  public static isAllowedTrackingDomain(hostname: string): boolean {
    if (!hostname || typeof hostname !== 'string') return false;
    const host = hostname.toLowerCase().trim().replace(/:\d+$/, '');

    // 1. Exact match: clnk.in
    if (host === 'clnk.in') return true;

    // 2. Subdomain of clnk.in (*.clnk.in)
    if (host.endsWith('.clnk.in')) {
      const subdomain = host.slice(0, -'.clnk.in'.length);
      if (
        subdomain.length > 0 &&
        !subdomain.startsWith('.') &&
        !subdomain.endsWith('.') &&
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(subdomain)
      ) {
        return true;
      }
      return false;
    }

    // 3. Exact match: linksredirect.com
    if (host === 'linksredirect.com') return true;

    // 4. Subdomain of linksredirect.com (e.g. www.linksredirect.com)
    if (host.endsWith('.linksredirect.com')) {
      const subdomain = host.slice(0, -'.linksredirect.com'.length);
      if (
        subdomain.length > 0 &&
        !subdomain.startsWith('.') &&
        !subdomain.endsWith('.') &&
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(subdomain)
      ) {
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Validates whether a candidate tracking URL is a valid, safe, and allowlisted tracking URL.
   */
  public static isAllowedTrackingUrl(urlStr: string): boolean {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
      const parsed = new URL(urlStr.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const ssrf = DealSsrfGuard.isSafePublicUrl(urlStr);
      if (!ssrf.safe) {
        return false;
      }
      return CuelinksV3Client.isAllowedTrackingDomain(parsed.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Ping/Validation check using official GET /pub_api/v3/ping endpoint.
   * Parses official publisher identity metadata:
   *   publisher.id, publisher.publisher_id, publisher.currency, publisher.name, publisher.email
   *   api_key.scopes, api_key.last_used_at
   * Crucial rule: Do NOT return the default scope list when the server did not supply scopes.
   * An unknown permission set must remain unknown (or empty / undefined) until validated.
   */
  public async ping(): Promise<CuelinksPingResult> {
    if (!this.isConfigured()) {
      return { connected: false, message: 'CUELINKS_API_KEY is unset in environment.' };
    }
    try {
      const res = await this.request<any>('/ping');
      const payload = res?.data || res || {};

      const publisher: CuelinksPingPublisher = payload.publisher || {};
      const apiKey: CuelinksPingApiKey = payload.api_key || {};

      const publisherId = publisher.publisher_id ?? publisher.id ?? payload.publisher_id ?? payload.id;
      const publisherName = publisher.name ?? payload.name;
      const currency = publisher.currency ?? payload.currency;
      const email = publisher.email ?? payload.email;
      const lastUsedAt = apiKey.last_used_at ?? payload.last_used_at;

      // Extract scopes: api_key.scopes prioritized over payload.scopes
      const rawScopes = apiKey.scopes !== undefined ? apiKey.scopes : payload.scopes;
      let scopes: string[] | undefined = undefined;

      if (Array.isArray(rawScopes)) {
        scopes = rawScopes.map((s: any) => String(s).trim()).filter(Boolean);
      } else if (typeof rawScopes === 'string' && rawScopes.trim().length > 0) {
        scopes = rawScopes.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      // CRUCIAL RULE: Do NOT return CUELINKS_STANDARD_SCOPES when scopes are missing/undefined!
      // Unknown scopes must remain undefined or empty until validated by the server.

      const isConnected =
        payload.status === 'success' ||
        payload.status === 'ok' ||
        Boolean(publisherId !== undefined && publisherId !== null && publisherId !== '') ||
        Boolean(email) ||
        Boolean(publisher.email || publisher.id || publisher.name) ||
        Boolean(scopes && scopes.length > 0);

      const resolvedPublisher: CuelinksPingPublisher | undefined =
        Object.keys(publisher).length > 0
          ? publisher
          : (publisherId !== undefined || email || publisherName || currency
              ? { id: publisherId, publisher_id: publisherId, name: publisherName, email, currency }
              : undefined);

      const resolvedApiKey: CuelinksPingApiKey | undefined =
        Object.keys(apiKey).length > 0
          ? apiKey
          : (scopes !== undefined || lastUsedAt
              ? { scopes, last_used_at: lastUsedAt }
              : undefined);

      return {
        connected: isConnected,
        message: isConnected
          ? 'Successfully authenticated with Cuelinks V3 API.'
          : (payload.message || 'Ping returned unsuccessful status or invalid payload'),
        publisherId,
        publisherName,
        currency,
        email,
        scopes,
        lastUsedAt,
        publisher: resolvedPublisher,
        apiKey: resolvedApiKey
      };
    } catch (err: any) {
      return { connected: false, message: err.message };
    }
  }

  /**
   * Fetch available reference categories
   */
  public async getCategories(): Promise<CuelinksCategory[]> {
    const res = await this.request<{ data: CuelinksCategory[] }>('/categories');
    return res.data || [];
  }

  /**
   * Fetch available countries
   */
  public async getCountries(): Promise<CuelinksCountry[]> {
    const res = await this.request<{ data: CuelinksCountry[] }>('/countries');
    return res.data || [];
  }

  /**
   * Search campaigns available to the publisher
   * Scope: read:campaigns
   */
  public async searchCampaigns(options?: {
    q?: string;
    access_status?: string;
    category_id?: number | string;
    country_id?: number | string;
    sort?: string;
    order?: 'asc' | 'desc';
    page?: number;
    per_page?: number;
  }): Promise<{ campaigns: CuelinksCampaign[]; total: number; total_pages?: number; page?: number; next_page?: number | null }> {
    const res = await this.request<any>('/campaigns', {
      query: {
        q: options?.q,
        access_status: options?.access_status,
        category_id: options?.category_id,
        country_id: options?.country_id,
        sort: options?.sort || 'epc_7d',
        order: options?.order || 'desc',
        page: options?.page || 1,
        per_page: options?.per_page || 30
      }
    });

    const rawList = Array.isArray(res?.data)
      ? res.data
      : (Array.isArray(res?.campaigns) ? res.campaigns : (Array.isArray(res) ? res : []));
    const meta = res?.meta || res?.pagination || {};
    const total = meta.total ?? rawList.length;
    const total_pages = meta.total_pages ?? Math.ceil(total / (options?.per_page || 30));

    return {
      campaigns: rawList,
      total,
      total_pages,
      page: meta.page ?? (options?.page || 1),
      next_page: meta.next_page ?? null
    };
  }

  /**
   * Get single campaign details
   */
  public async getCampaignDetails(campaignId: number | string): Promise<CuelinksCampaign> {
    const res = await this.request<{ data: CuelinksCampaign }>(`/campaigns/${campaignId}`);
    return res.data;
  }

  /**
   * Request access to restricted campaign
   */
  public async requestCampaignAccess(campaignId: number | string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await this.request<{ message?: string }>(`/campaigns/${campaignId}/request_access`, {
        method: 'POST'
      });
      return { success: true, message: res.message || 'Access requested successfully.' };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Retrieve current offers and coupons
   * Scope: read:offers
   */
  public async getOffers(options?: {
    campaign_id?: number | string;
    category_id?: number | string;
    q?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ offers: CuelinksOffer[]; total: number; total_pages?: number; page?: number; next_page?: number | null }> {
    const res = await this.request<any>('/offers', {
      query: {
        campaign_id: options?.campaign_id,
        category_id: options?.category_id,
        q: options?.q,
        page: options?.page || 1,
        per_page: options?.per_page || 30
      }
    });

    const rawOffers = Array.isArray(res?.data)
      ? res.data
      : (Array.isArray(res?.offers) ? res.offers : (Array.isArray(res) ? res : []));
    const meta = res?.meta || res?.pagination || {};
    const total = meta.total ?? rawOffers.length;
    const total_pages = meta.total_pages ?? Math.ceil(total / (options?.per_page || 30));

    return {
      offers: rawOffers,
      total,
      total_pages,
      page: meta.page ?? (options?.page || 1),
      next_page: meta.next_page ?? null
    };
  }

  /**
   * Convert merchant URL to authorized trackable affiliate link
   * Scope: write:links
   * Official Contract: https://developers.cuelinks.com/docs/reference/links/convert
   * - Uses `shorten: true`
   * - Requires explicit `affiliated: true` before labeling a link commission-eligible.
   *   A `tracking_url` alone is NOT proof of commission eligibility.
   * - Domain safety guard: strictly validates actual tracking domain (clnk.in, *.clnk.in, linksredirect.com)
   *   and permitted destination before enabling redirect.
   */
  public async convertLink(request: CuelinksLinkConvertRequest): Promise<CuelinksLinkConvertResponse> {
    if (!request || !request.url || typeof request.url !== 'string') {
      throw new CuelinksApiError('CUELINKS_INVALID_URL', 'Missing target URL for conversion.', 400);
    }

    const trimmedUrl = request.url.trim();

    // 0. Extract clean merchant destination if provider tracking URL was inadvertently passed
    let destinationUrl = trimmedUrl;
    try {
      const parsed = new URL(trimmedUrl);
      if (
        (parsed.hostname === 'linksredirect.com' || parsed.hostname.endsWith('.linksredirect.com') ||
         parsed.hostname === 'cuelinks.com' || parsed.hostname.endsWith('.cuelinks.com')) &&
        parsed.searchParams.has('url')
      ) {
        const extracted = parsed.searchParams.get('url');
        if (extracted && /^https?:\/\//i.test(extracted)) {
          destinationUrl = decodeURIComponent(extracted).trim();
        }
      }
    } catch {}

    // 1. SSRF and destination protocol/domain verification
    const ssrf = DealSsrfGuard.isSafePublicUrl(destinationUrl);
    if (!ssrf.safe) {
      throw new CuelinksApiError(
        'CUELINKS_INVALID_URL',
        `SSRF_REJECTED: URL '${destinationUrl}' violates safe public domain policy: ${ssrf.reason}`,
        400
      );
    }

    // 2. Official Cuelinks V3 contract: default to `shorten: true`
    const shouldShorten = request.shorten !== undefined
      ? Boolean(request.shorten)
      : (request.short_url !== undefined ? Boolean(request.short_url) : true);

    const payload: Record<string, any> = {
      url: destinationUrl,
      shorten: shouldShorten
    };

    if (request.channel_id) payload.channel_id = request.channel_id;
    if (request.subid) payload.subid = String(request.subid).substring(0, 50);
    if (request.subid2) payload.subid2 = String(request.subid2).substring(0, 50);
    if (request.subid3) payload.subid3 = String(request.subid3).substring(0, 50);
    if (request.subid4) payload.subid4 = String(request.subid4).substring(0, 50);
    if (request.subid5) payload.subid5 = String(request.subid5).substring(0, 50);

    const res = await this.request<{
      data?: CuelinksLinkConvertResponse;
      short_url?: string;
      url?: string;
      tracking_url?: string;
      affiliated?: boolean;
      campaign?: any;
    }>('/links/convert', {
      method: 'POST',
      body: payload
    });

    // 3. Handle envelope { data: { ... } }, flat { short_url: ... }, or malformed null/undefined
    const result = (res && typeof res === 'object') ? (res.data || res) : {};
    const candidateTrackingUrl = result.short_url || result.url || result.tracking_url;

    // 4. Domain safety guard: validate provider tracking URL domain strictly
    const isCandidateSafe = candidateTrackingUrl && typeof candidateTrackingUrl === 'string'
      ? CuelinksV3Client.isAllowedTrackingUrl(candidateTrackingUrl)
      : false;

    // 5. Strict monetization gate: require explicit affiliated: true AND allowlisted HTTPS tracking URL
    const isAffiliated = result.affiliated === true && Boolean(isCandidateSafe);

    return {
      url: destinationUrl,
      tracking_url: isAffiliated ? candidateTrackingUrl : destinationUrl,
      short_url: isAffiliated ? (result.short_url || candidateTrackingUrl) : undefined,
      affiliated: isAffiliated,
      campaign: result.campaign
    };
  }

  /**
   * Convert multiple URLs in bounded batches (max 25 per request)
   */
  public async convertBulkLinks(requests: CuelinksLinkConvertRequest[]): Promise<CuelinksLinkConvertResponse[]> {
    const results: CuelinksLinkConvertResponse[] = [];
    const batchSize = 25;

    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      for (const req of batch) {
        try {
          const converted = await this.convertLink(req);
          results.push(converted);
        } catch (err: any) {
          results.push({
            url: req.url,
            affiliated: false,
            tracking_url: req.url // fallback to clean direct URL
          });
        }
      }
    }

    return results;
  }

  /**
   * Inspect existing publisher channels
   * Scope: read:channels
   */
  public async getChannels(): Promise<CuelinksChannel[]> {
    const res = await this.request<{ data: CuelinksChannel[] }>('/channels');
    return res.data || [];
  }

  /**
   * Create or register publisher channel
   * Scope: write:channels
   */
  public async createChannel(name: string, url: string, type: string = 'website'): Promise<CuelinksChannel> {
    const existing = await this.getChannels();
    const cleanUrl = url.toLowerCase().replace(/\/$/, '');
    const found = existing.find(c => c.url?.toLowerCase().replace(/\/$/, '') === cleanUrl);
    if (found) {
      return found;
    }

    const res = await this.request<{ data: CuelinksChannel }>('/channels', {
      method: 'POST',
      body: { name, url, type }
    });

    return res.data;
  }

  /**
   * Retrieve real provider transactions for reconciliation
   * Scope: read:transactions
   */
  public async getTransactions(options?: {
    start_date?: string;
    end_date?: string;
    status?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ transactions: CuelinksTransaction[]; total: number }> {
    const res = await this.request<{ data: CuelinksTransaction[]; meta?: { total?: number } }>('/transactions', {
      query: {
        start_date: options?.start_date,
        end_date: options?.end_date,
        status: options?.status,
        page: options?.page || 1,
        per_page: options?.per_page || 50
      }
    });

    return {
      transactions: res.data || [],
      total: res.meta?.total ?? (res.data ? res.data.length : 0)
    };
  }

  /**
   * Retrieve aggregated performance reports
   * Scope: read:reports
   */
  public async getReports(options?: {
    start_date?: string;
    end_date?: string;
    slice_by?: string;
    page?: number;
    per_page?: number;
  }): Promise<{ reports: CuelinksReport[]; total: number }> {
    const res = await this.request<{ data: CuelinksReport[]; meta?: { total?: number } }>('/reports', {
      query: {
        start_date: options?.start_date,
        end_date: options?.end_date,
        slice_by: options?.slice_by || 'campaign',
        page: options?.page || 1,
        per_page: options?.per_page || 50
      }
    });

    return {
      reports: res.data || [],
      total: res.meta?.total ?? (res.data ? res.data.length : 0)
    };
  }
}
