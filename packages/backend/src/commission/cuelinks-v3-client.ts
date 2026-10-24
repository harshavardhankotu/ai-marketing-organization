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
  CuelinksCountry
} from './cuelinks-v3-types.js';

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

  private async request<T>(endpoint: string, options: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('CUELINKS_UNCONFIGURED: CUELINKS_API_KEY is not set.');
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
        if (res.status === 401) {
          throw new Error(`CUELINKS_UNAUTHORIZED: Invalid API key or unauthorized token. Status 401: ${errBody}`);
        }
        if (res.status === 429) {
          throw new Error(`CUELINKS_RATE_LIMITED: Rate limit exceeded. Status 429: ${errBody}`);
        }
        throw new Error(`CUELINKS_API_ERROR: HTTP ${res.status}: ${errBody}`);
      }

      return (await res.json()) as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`CUELINKS_TIMEOUT: Request to ${endpoint} timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Ping/Validation check
   */
  public async ping(): Promise<{ connected: boolean; message: string }> {
    if (!this.isConfigured()) {
      return { connected: false, message: 'CUELINKS_API_KEY is unset in environment.' };
    }
    try {
      // Channels endpoint is the lightest check for publisher identity
      await this.getChannels();
      return { connected: true, message: 'Successfully authenticated with Cuelinks V3 API.' };
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
  }): Promise<{ campaigns: CuelinksCampaign[]; total: number }> {
    const res = await this.request<{ data: CuelinksCampaign[]; meta?: { total?: number } }>('/campaigns', {
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

    return {
      campaigns: res.data || [],
      total: res.meta?.total ?? (res.data ? res.data.length : 0)
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
  }): Promise<{ offers: CuelinksOffer[]; total: number }> {
    const res = await this.request<{ data: CuelinksOffer[]; meta?: { total?: number } }>('/offers', {
      query: {
        campaign_id: options?.campaign_id,
        category_id: options?.category_id,
        q: options?.q,
        page: options?.page || 1,
        per_page: options?.per_page || 30
      }
    });

    return {
      offers: res.data || [],
      total: res.meta?.total ?? (res.data ? res.data.length : 0)
    };
  }

  /**
   * Convert merchant URL to authorized trackable affiliate link
   * Scope: write:links
   */
  public async convertLink(request: CuelinksLinkConvertRequest): Promise<CuelinksLinkConvertResponse> {
    if (!request.url) {
      throw new Error('CUELINKS_INVALID_URL: Missing target URL for conversion.');
    }

    // SSRF verification on destination URL
    const ssrf = DealSsrfGuard.isSafePublicUrl(request.url);
    if (!ssrf.safe) {
      throw new Error(`SSRF_REJECTED: URL '${request.url}' violates safe public domain policy: ${ssrf.reason}`);
    }

    const payload: Record<string, any> = {
      url: request.url,
      short_url: request.short_url !== false // default true
    };

    if (request.channel_id) payload.channel_id = request.channel_id;
    if (request.subid) payload.subid = String(request.subid).substring(0, 50);
    if (request.subid2) payload.subid2 = String(request.subid2).substring(0, 50);
    if (request.subid3) payload.subid3 = String(request.subid3).substring(0, 50);
    if (request.subid4) payload.subid4 = String(request.subid4).substring(0, 50);
    if (request.subid5) payload.subid5 = String(request.subid5).substring(0, 50);

    const res = await this.request<{ data?: CuelinksLinkConvertResponse; short_url?: string; url?: string; affiliated?: boolean; campaign?: any }>('/links/convert', {
      method: 'POST',
      body: payload
    });

    // Handle envelope { data: { ... } } or flat { short_url: ... }
    const result = res.data || (res as any);
    const trackingUrl = result.short_url || result.url || result.tracking_url;

    return {
      short_url: result.short_url,
      url: result.url,
      tracking_url: trackingUrl,
      affiliated: result.affiliated !== false && !!trackingUrl,
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
