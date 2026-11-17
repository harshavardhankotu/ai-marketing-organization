import { createHash } from 'crypto';
import { isProduction, isPlaceholderCredential, normalizeSecretValue } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';

export interface YouTubeReview {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  videoUrl: string;
  embedUrl: string;
}

export class YouTubeReviewEnricher {
  private static instance: YouTubeReviewEnricher;
  private d1Repo = D1RevenueRepository.getInstance();
  private inFlight = new Map<string, Promise<YouTubeReview | null>>();

  public static getInstance(): YouTubeReviewEnricher {
    if (!YouTubeReviewEnricher.instance) {
      YouTubeReviewEnricher.instance = new YouTubeReviewEnricher();
    }
    return YouTubeReviewEnricher.instance;
  }

  public static resetInstance(): void {
    (YouTubeReviewEnricher as any).instance = undefined;
  }

  public cleanTitleForSearch(rawTitle: string): string {
    return String(rawTitle || '')
      .replace(/\[.*?\]|\(.*?\)/g, ' ')
      .replace(/[\u{1F600}-\u{1F6FF}|[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  public getCacheEventId(dealId: string): string {
    const sha = createHash('sha256').update(String(dealId || 'deal_unknown')).digest('hex');
    return `yt_review_${sha.slice(0, 36)}`;
  }

  /**
   * Retrieves cached YouTube review from D1 durable_events table.
   * Negative cache entries expire after 24 hours to allow recovery.
   */
  public async getCachedReview(dealId: string): Promise<YouTubeReview | null | 'NOT_FOUND'> {
    const eventId = this.getCacheEventId(dealId);
    try {
      if (isProduction() && !process.env.VITEST) {
        const row = await this.d1Repo.queryOne<{ payload_json: string }>(
          'durable_events',
          `SELECT payload_json FROM durable_events WHERE id = ? AND event_type = 'YOUTUBE_REVIEW_CACHED' LIMIT 1`,
          [eventId]
        );
        if (row?.payload_json) {
          const parsed = JSON.parse(row.payload_json);
          if (parsed?.notFound) {
            const cachedAt = parsed.cachedAt ? new Date(parsed.cachedAt).getTime() : 0;
            if (Date.now() - cachedAt > 24 * 60 * 60 * 1000) {
              return null; // Expired negative cache entry, allow fresh lookup
            }
            return 'NOT_FOUND';
          }
          return parsed as YouTubeReview;
        }
      } else {
        const row = getDb().prepare(
          `SELECT payload_json FROM durable_events WHERE id = ? AND event_type = 'YOUTUBE_REVIEW_CACHED' LIMIT 1`
        ).get(eventId) as any;
        if (row?.payload_json) {
          const parsed = JSON.parse(row.payload_json);
          if (parsed?.notFound) {
            const cachedAt = parsed.cachedAt ? new Date(parsed.cachedAt).getTime() : 0;
            if (Date.now() - cachedAt > 24 * 60 * 60 * 1000) {
              return null; // Expired negative cache entry, allow fresh lookup
            }
            return 'NOT_FOUND';
          }
          return parsed as YouTubeReview;
        }
      }
    } catch {
      // Return null on cache read miss or transient error
    }
    return null;
  }

  /**
   * Persists resolved review into D1 durable_events.
   */
  public async cacheReview(dealId: string, review: YouTubeReview): Promise<void> {
    const eventId = this.getCacheEventId(dealId);
    const payloadJson = JSON.stringify(review);
    try {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'durable_events',
          `INSERT INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, created_at)
           VALUES (?, 'YOUTUBE_REVIEW_CACHED', 'biz_platform_aro', 'org_owner_primary', ?, 1, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, processed = 1`,
          [eventId, payloadJson]
        );
      } else {
        getDb().prepare(
          `INSERT INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, created_at)
           VALUES (?, 'YOUTUBE_REVIEW_CACHED', 'biz_platform_aro', 'org_owner_primary', ?, 1, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, processed = 1`
        ).run(eventId, payloadJson);
      }
    } catch {
      // Non-fatal if write fails
    }
  }

  /**
   * Persists negative lookup result so subsequent requests don't exhaust search quota.
   */
  public async cacheNegativeResult(dealId: string): Promise<void> {
    const eventId = this.getCacheEventId(dealId);
    const payloadJson = JSON.stringify({ notFound: true, cachedAt: new Date().toISOString() });
    try {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'durable_events',
          `INSERT INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, created_at)
           VALUES (?, 'YOUTUBE_REVIEW_CACHED', 'biz_platform_aro', 'org_owner_primary', ?, 1, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, processed = 1`,
          [eventId, payloadJson]
        );
      } else {
        getDb().prepare(
          `INSERT INTO durable_events (id, event_type, business_id, organization_id, payload_json, processed, created_at)
           VALUES (?, 'YOUTUBE_REVIEW_CACHED', 'biz_platform_aro', 'org_owner_primary', ?, 1, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, processed = 1`
        ).run(eventId, payloadJson);
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Primary: YouTube Data API v3 Search (regionCode=IN, videoEmbeddable=true).
   */
  private async searchYouTubeApi(cleanTitle: string): Promise<YouTubeReview | null> {
    const apiKey = normalizeSecretValue(process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY);
    if (!apiKey || isPlaceholderCredential(apiKey)) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const query = encodeURIComponent(`${cleanTitle} review`);
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=2&regionCode=IN&q=${query}&key=${apiKey}`;

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json() as any;
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        return null;
      }

      const item = items[0];
      const videoId = item?.id?.videoId;
      if (!videoId) {
        return null;
      }

      const snippet = item?.snippet || {};
      const title = snippet.title || `${cleanTitle} Review`;
      const channelTitle = snippet.channelTitle || 'YouTube';
      const thumbnailUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      return {
        videoId,
        title,
        channelTitle,
        thumbnailUrl,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`
      };
    } catch {
      // Fall through to Tavily fallback
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }

  /**
   * Fallback: Tavily search (site:youtube.com/watch ${cleanTitle} review India).
   * Extracts canonical 11-char video ID.
   */
  private async searchTavilyFallback(cleanTitle: string): Promise<YouTubeReview | null> {
    const tavilyKey = normalizeSecretValue(process.env.TAVILY_API_KEY);
    if (!tavilyKey || isPlaceholderCredential(tavilyKey)) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: `site:youtube.com/watch ${cleanTitle} review India`,
          search_depth: 'basic',
          max_results: 5
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        return null;
      }

      const data = await res.json() as any;
      const results = Array.isArray(data.results) ? data.results : [];
      const ytRegex = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

      for (const r of results) {
        const match = String(r.url || '').match(ytRegex);
        if (match && match[1]) {
          const videoId = match[1];
          return {
            videoId,
            title: r.title || `${cleanTitle} Review`,
            channelTitle: 'YouTube',
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            embedUrl: `https://www.youtube.com/embed/${videoId}`
          };
        }
      }
    } catch {
      // Return null on failure
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }

  /**
   * Resolves a YouTube review for a given deal:
   * 1. Check D1 durable_events cache (including negative lookups)
   * 2. Deduplicate in-flight promises
   * 3. Primary: YouTube Data API v3 (when YOUTUBE_API_KEY is configured)
   * 4. Fallback: Tavily Search (extract canonical 11-char video ID)
   * 5. Cache durably in D1 durable_events
   */
  public async resolveReviewForDeal(deal: { id: string; title: string; merchant?: string; category?: string; [key: string]: any }): Promise<YouTubeReview | null> {
    if (!deal || !deal.id) return null;

    // Deduplicate in-flight requests for the same deal
    const existing = this.inFlight.get(deal.id);
    if (existing) {
      return existing;
    }

    const lookupPromise = this.executeResolveReview(deal);
    this.inFlight.set(deal.id, lookupPromise);
    try {
      return await lookupPromise;
    } finally {
      this.inFlight.delete(deal.id);
    }
  }

  private async executeResolveReview(deal: { id: string; title: string; merchant?: string; category?: string; [key: string]: any }): Promise<YouTubeReview | null> {
    // 1. D1 durable cache hit
    const cached = await this.getCachedReview(deal.id);
    if (cached === 'NOT_FOUND') {
      return null;
    }
    if (cached) {
      return cached;
    }

    const cleanTitle = this.cleanTitleForSearch(deal.title || 'Product');
    if (!cleanTitle) return null;

    const ytApiKey = normalizeSecretValue(process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY);
    const tavilyKey = normalizeSecretValue(process.env.TAVILY_API_KEY);
    const hasKeys = Boolean(
      (ytApiKey && !isPlaceholderCredential(ytApiKey)) ||
      (tavilyKey && !isPlaceholderCredential(tavilyKey))
    );
    if (!process.env.VITEST && !hasKeys) {
      return null;
    }

    // 2. Primary: YouTube API
    let review = await this.searchYouTubeApi(cleanTitle);

    // 3. Fallback: Tavily Search
    if (!review) {
      review = await this.searchTavilyFallback(cleanTitle);
    }

    // 4. Cache durably if found, else cache negative result
    if (review) {
      await this.cacheReview(deal.id, review);
    } else {
      await this.cacheNegativeResult(deal.id);
    }

    return review;
  }

  /**
   * Enriches a deal object with a youtubeReview property.
   */
  public async enrichDeal<T extends { id: string; title: string; youtubeReview?: any }>(deal: T): Promise<T> {
    if (!deal) return deal;
    try {
      const review = await this.resolveReviewForDeal(deal);
      return {
        ...deal,
        youtubeReview: review || null
      };
    } catch {
      return {
        ...deal,
        youtubeReview: null
      };
    }
  }

  /**
   * Enriches an array of deals with youtubeReview properties in parallel (bounded batch).
   */
  public async enrichDeals<T extends { id: string; title: string; youtubeReview?: any }>(deals: T[], maxEnrich: number = 8): Promise<T[]> {
    if (!Array.isArray(deals) || deals.length === 0) return [];
    const topSlice = deals.slice(0, maxEnrich);
    const remaining = deals.slice(maxEnrich);

    const enrichedTop = await Promise.all(
      topSlice.map(deal => this.enrichDeal(deal))
    );

    return [
      ...enrichedTop,
      ...remaining.map(d => ({ ...d, youtubeReview: d.youtubeReview || null }))
    ];
  }

  /**
   * Counts total cached YouTube reviews in D1 durable_events.
   */
  public async getCachedCount(): Promise<number> {
    try {
      if (isProduction() && !process.env.VITEST) {
        const row = await this.d1Repo.queryOne<{ cnt: number }>(
          'durable_events',
          `SELECT COUNT(*) as cnt FROM durable_events WHERE event_type = 'YOUTUBE_REVIEW_CACHED' AND payload_json NOT LIKE '%"notFound":true%'`
        );
        return Number(row?.cnt || 0);
      } else {
        const row = getDb().prepare(
          `SELECT COUNT(*) as cnt FROM durable_events WHERE event_type = 'YOUTUBE_REVIEW_CACHED' AND payload_json NOT LIKE '%"notFound":true%'`
        ).get() as any;
        return Number(row?.cnt || 0);
      }
    } catch {
      return 0;
    }
  }
}
