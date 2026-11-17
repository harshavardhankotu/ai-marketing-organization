import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSecretValue } from '../../src/config/env.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { YouTubeReviewEnricher } from '../../src/integrations/youtube-review-enricher.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { getDb } from '../../src/db/client.js';

describe('Stage Q: Live UI, YouTube Review Enricher & Razorpay Diagnostics', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    RazorpayStandardAdapter.resetInstance();
    YouTubeReviewEnricher.resetInstance();
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('normalizeSecretValue', () => {
    it('strips surrounding single and double quotes, whitespace, and \\r\\n', () => {
      expect(normalizeSecretValue('  "my_secret_token"  ')).toBe('my_secret_token');
      expect(normalizeSecretValue("  'my_secret_token'  ")).toBe('my_secret_token');
      expect(normalizeSecretValue('my_secret_token\r\n')).toBe('my_secret_token');
      expect(normalizeSecretValue('"my_secret_token\\n"')).toBe('my_secret_token');
      expect(normalizeSecretValue(undefined)).toBe('');
      expect(normalizeSecretValue('')).toBe('');
    });
  });

  describe('Razorpay credential mode & prefix integrity', () => {
    it('detects MODE_PREFIX_MISMATCH when live mode has rzp_test_ key', () => {
      process.env.RAZORPAY_MODE = 'live';
      process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcdef';
      process.env.RAZORPAY_KEY_SECRET = 'testsecret1234567890abcdef';

      const adapter = RazorpayStandardAdapter.getInstance();
      expect(() => {
        adapter.resolveCredentials();
      }).toThrowError(/MODE_PREFIX_MISMATCH/);
    });

    it('resolves valid test credentials when RAZORPAY_MODE=test and key starts with rzp_test_', () => {
      process.env.RAZORPAY_MODE = 'test';
      process.env.RAZORPAY_KEY_ID = 'rzp_test_ABC1234567890';
      process.env.RAZORPAY_KEY_SECRET = 'testSecretKeyXYZ';

      const adapter = RazorpayStandardAdapter.getInstance();
      const creds = adapter.resolveCredentials();
      expect(creds.keyId).toBe('rzp_test_ABC1234567890');
      expect(creds.keySecret).toBe('testSecretKeyXYZ');
      expect(creds.mode).toBe('TEST_SANDBOX');
      expect(creds.isLive).toBe(false);
    });
  });

  describe('YouTubeReviewEnricher', () => {
    it('caches enriched YouTube review in durable_events', async () => {
      const enricher = YouTubeReviewEnricher.getInstance();

      // Spy on searchYouTubeApi
      vi.spyOn(enricher as any, 'searchYouTubeApi').mockResolvedValue({
        videoId: 'dQw4w9WgXcQ',
        title: 'Ola S1 Pro Electric Scooter In-Depth Review',
        channelTitle: 'Auto Tech India',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
      });

      const enriched = await enricher.resolveReviewForDeal({
        id: 'deal_ev_scooter_01',
        title: 'Ola S1 Pro Gen 2 Electric Scooter',
        merchant: 'Ola Electric',
        category: 'EV Scooters'
      });

      expect(enriched).not.toBeNull();
      expect(enriched?.videoId).toBe('dQw4w9WgXcQ');
      expect(enriched?.embedUrl).toContain('dQw4w9WgXcQ');

      // Verify cached in database
      const cacheEventId = enricher.getCacheEventId('deal_ev_scooter_01');
      const row = getDb().prepare(
        `SELECT payload_json FROM durable_events WHERE id = ? AND event_type = 'YOUTUBE_REVIEW_CACHED'`
      ).get(cacheEventId) as any;
      expect(row).toBeDefined();
      expect(row.payload_json).toContain('dQw4w9WgXcQ');
    });

    it('falls back gracefully when video search returns null', async () => {
      const enricher = YouTubeReviewEnricher.getInstance();
      vi.spyOn(enricher as any, 'searchYouTubeApi').mockResolvedValue(null);
      vi.spyOn(enricher as any, 'searchTavilyFallback').mockResolvedValue(null);

      const enriched = await enricher.resolveReviewForDeal({
        id: 'deal_unknown_device_stageq',
        title: 'Random Mystery Gadget',
        merchant: 'Unknown',
        category: 'Gadgets'
      });

      expect(enriched).toBeNull();
    });
  });

  describe('Static Site Generator with YouTube review card', () => {
    it('renders YouTube video iframe in renderDealDetailHtml when youtubeReview is provided', () => {
      const deal = {
        id: 'deal_test_1',
        title: 'Ather 450X Gen 3',
        merchant: 'Ather Energy',
        currentPriceINR: 139999,
        referencePriceINR: 155000,
        affiliateUrl: 'https://example.com/ather',
        category: 'EV',
        youtubeReview: {
          videoId: 'vid12345678',
          title: 'Ather 450X Long-Term Review',
          channelTitle: 'ZigWheels',
          videoUrl: 'https://www.youtube.com/watch?v=vid12345678',
          embedUrl: 'https://www.youtube-nocookie.com/embed/vid12345678',
          thumbnailUrl: 'https://i.ytimg.com/vi/vid12345678/hqdefault.jpg'
        }
      };
      const html = StaticSiteGenerator.getInstance().renderDealDetailHtml(
        deal,
        [],
        { siteUrl: 'https://ai-marketing-organization.onrender.com', siteName: 'AI Marketing' }
      );

      expect(html).toContain('youtube-nocookie.com/embed/vid12345678');
      expect(html).toContain('Ather 450X Long-Term Review');
      expect(html).toContain('ZigWheels');
    });
  });
});
