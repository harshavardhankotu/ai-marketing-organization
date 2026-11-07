import { UnifiedQuotaService } from '../quota/unified-quota-service.js';

export interface GoogleSuggestResult {
  query: string;
  suggestions: string[];
  status: 'SUCCESS' | 'UNAVAILABLE';
  error?: string;
  timestamp: string;
}

export class GoogleSuggestClient {
  private static instance: GoogleSuggestClient | null = null;
  private quotaService = UnifiedQuotaService.getInstance();
  private fetchFn: typeof fetch = globalThis.fetch;

  private constructor() {}

  public static getInstance(): GoogleSuggestClient {
    if (!GoogleSuggestClient.instance) {
      GoogleSuggestClient.instance = new GoogleSuggestClient();
    }
    return GoogleSuggestClient.instance;
  }

  public static resetInstance(): void {
    GoogleSuggestClient.instance = null;
  }

  public setFetchFn(fn: typeof fetch | null): void {
    this.fetchFn = fn || globalThis.fetch;
  }

  /**
   * Fetches search suggestions for a query from Google Suggest API.
   * Manages quota via UnifiedQuotaService ('google_suggest' with 80 requests/day cap).
   */
  public async fetchSuggestions(query: string, gl: string = 'in'): Promise<GoogleSuggestResult> {
    const timestamp = new Date().toISOString();
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) {
      return {
        query: '',
        suggestions: [],
        status: 'UNAVAILABLE',
        error: 'EMPTY_QUERY',
        timestamp
      };
    }

    const reservation = await this.quotaService.reserveProviderQuota('google_suggest', 1);
    if (!reservation.allowed) {
      return {
        query: cleanQuery,
        suggestions: [],
        status: 'UNAVAILABLE',
        error: `QUOTA_EXHAUSTED: ${reservation.reason}`,
        timestamp
      };
    }

    try {
      const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(cleanQuery)}&gl=${gl}`;
      const res = await this.fetchFn(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!res.ok) {
        await this.quotaService.reconcileProviderQuota('google_suggest', reservation.reservationId, 'RELEASE');
        return {
          query: cleanQuery,
          suggestions: [],
          status: 'UNAVAILABLE',
          error: `HTTP_${res.status}`,
          timestamp
        };
      }

      const data = await res.json() as any;
      await this.quotaService.reconcileProviderQuota('google_suggest', reservation.reservationId, 'CONSUME');

      const suggestions: string[] = Array.isArray(data?.[1])
        ? data[1].map((s: any) => String(s)).filter(Boolean)
        : [];

      return {
        query: cleanQuery,
        suggestions,
        status: 'SUCCESS',
        timestamp
      };
    } catch (err: any) {
      await this.quotaService.reconcileProviderQuota('google_suggest', reservation.reservationId, 'RELEASE');
      return {
        query: cleanQuery,
        suggestions: [],
        status: 'UNAVAILABLE',
        error: err.message || 'NETWORK_ERROR',
        timestamp
      };
    }
  }
}
