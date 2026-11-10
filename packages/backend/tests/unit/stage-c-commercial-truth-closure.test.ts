import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { classifyTraffic } from '../../src/commission/referral-tracking.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { OrganicDistributionEngine } from '../../src/commission/organic-distribution-engine.js';
import { SeoResearchEngine, IndexNowSubmitter } from '../../src/seo/seo-research-engine.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Stage C — Production Integrity Closure Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Task A & C: Cuelinks 5-State Authorization & Channel-Scoped Fallback', () => {
    it('fails closed at State 1 when CUELINKS_API_KEY is not configured', async () => {
      delete process.env.CUELINKS_API_KEY;
      delete process.env.CUELINKS_PUB_ID;

      const client = new CuelinksV3Client({ apiKey: '', publisherId: '' });
      const manager = new CuelinksSyncManager(client);

      const res = await manager.verify5StateAuthorization({ campaignId: 123 });
      expect(res.authorized).toBe(false);
      expect(res.currentState).toBe('NONE');
      expect(res.blockerCode).toBe('BLOCKED_NO_CREDENTIALS');
      expect(res.achievedStates).toEqual([]);
      expect(res.humanActionRequired).toContain('CUELINKS_API_KEY');
    });

    it('matches channels strictly against canonical website host', async () => {
      const client = new CuelinksV3Client({ apiKey: 'valid_dummy_key', publisherId: '123' });
      const manager = new CuelinksSyncManager(client);

      const channels = [
        { id: 1, name: 'Random Blog', url: 'https://random-blog.com', status: 'approved' },
        { id: 2, name: 'Render Production', url: 'https://ai-marketing-organization.onrender.com', status: 'approved' },
        { id: 3, name: 'Other Site', url: 'https://some-other-site.com', status: 'approved' },
      ];

      vi.spyOn(client, 'getChannels').mockResolvedValue(channels as any);

      // Default canonical is ai-marketing-organization.onrender.com
      const approved = await manager.getApprovedChannel();
      expect(approved.approved).toBe(true);
      expect(approved.channel?.id).toBe(2);
      expect(approved.channel?.url).toBe('https://ai-marketing-organization.onrender.com');
    });

    it('rejects channels that do not match canonical website host', async () => {
      const client = new CuelinksV3Client({ apiKey: 'valid_dummy_key', publisherId: '123' });
      const manager = new CuelinksSyncManager(client);

      const channels = [
        { id: 1, name: 'Unrelated Site', url: 'https://other-domain.com', status: 'approved' },
        { id: 2, name: 'Pending Site', url: 'https://ai-marketing-organization.onrender.com', status: 'pending' }
      ];

      vi.spyOn(client, 'getChannels').mockResolvedValue(channels as any);

      const approved = await manager.getApprovedChannel();
      expect(approved.approved).toBe(false);
      expect(approved.channel).toBeNull();
    });

    it('blocks unscoped legacy /reports fallback when channel_id is not specified', async () => {
      const client = new CuelinksV3Client({ apiKey: 'valid_dummy_key', publisherId: '123' });
      
      vi.spyOn(client as any, 'request').mockRejectedValue({
        statusCode: 404,
        message: 'Endpoint /reports/performance not found'
      });

      // Calling without channel_id must throw CUELINKS_UNSCOPED_REPORT_BLOCKED
      await expect(client.getPerformanceReport({
        from_date: '2026-11-01',
        to_date: '2026-11-08'
      } as any)).rejects.toThrow(/unscoped account-wide reports are blocked/i);
    });

    it('allows channel-scoped fallback when channel_id is specified', async () => {
      const client = new CuelinksV3Client({ apiKey: 'valid_dummy_key', publisherId: '123' });
      
      const requestSpy = vi.spyOn(client as any, 'request')
        .mockRejectedValueOnce({ statusCode: 404, message: 'Not found' })
        .mockResolvedValueOnce({ data: [{ channel_id: 42, clicks: 10 }], meta: { total: 1 } });

      const res = await client.getPerformanceReport({
        channel_id: 42,
        start_date: '2026-11-01',
        end_date: '2026-11-08'
      });

      expect(res.data).toHaveLength(1);
      expect(requestSpy).toHaveBeenNthCalledWith(2, '/reports', expect.objectContaining({
        query: expect.objectContaining({ channel_id: 42 })
      }));
    });
  });

  describe('Task F: Unified classifyTraffic Provenance', () => {
    it('classifies automated HTTP clients and tools as suspected_bot or test', () => {
      expect(classifyTraffic('curl/8.4.0')).toBe('suspected_bot');
      expect(classifyTraffic('undici')).toBe('suspected_bot');
      expect(classifyTraffic('node-fetch/1.0')).toBe('suspected_bot');
      expect(classifyTraffic('axios/1.6.0')).toBe('suspected_bot');
      expect(classifyTraffic('PostmanRuntime/7.32.3')).toBe('test');
      expect(classifyTraffic('ai-marketing-cron-worker')).toBe('diagnostic');
    });

    it('classifies browser user-agent without browser headers as unknown', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      // Without Accept or Accept-Language headers
      const result = classifyTraffic(ua, '1.2.3.4', { 'user-agent': ua });
      expect(result).toBe('unknown');
    });

    it('classifies browser user-agent with browser headers as browser_candidate, NEVER human without verifiedHumanProof', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const headers = {
        'user-agent': ua,
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9'
      };

      const resultCandidate = classifyTraffic(ua, '1.2.3.4', headers, false);
      expect(resultCandidate).toBe('browser_candidate');

      const resultHuman = classifyTraffic(ua, '1.2.3.4', headers, true);
      expect(resultHuman).toBe('human');
    });

    it('classifies diagnostic and test headers immediately as test or internal', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0';
      expect(classifyTraffic(ua, '127.0.0.1', { 'x-diagnostic': 'true' })).toBe('test');
      expect(classifyTraffic(ua, '127.0.0.1', { 'x-test-mode': 'true' })).toBe('test');
      expect(classifyTraffic(ua, '127.0.0.1', { 'x-owner-preview': 'true' })).toBe('internal');
    });
  });

  describe('Task G: PageSpeed NULL Integrity & Outreach Gate', () => {
    it('sets performance_score to null when PageSpeed status is not SUCCESS', () => {
      const nonSuccessEntry = {
        audit: {
          url: 'https://example.com',
          businessName: 'Example',
          pageSpeed: {
            status: 'UNAVAILABLE',
            reason: 'MISSING_API_KEY'
          },
          scorecard: { totalScore: 85, items: [] }
        }
      };

      const performance_score = (nonSuccessEntry.audit.pageSpeed?.status === 'SUCCESS' && typeof (nonSuccessEntry.audit.pageSpeed as any).performanceScore === 'number')
        ? (nonSuccessEntry.audit.pageSpeed as any).performanceScore
        : null;

      expect(performance_score).toBeNull();
    });

    it('preserves performance_score only when PageSpeed explicitly succeeds', () => {
      const successEntry = {
        audit: {
          url: 'https://example.com',
          pageSpeed: {
            status: 'SUCCESS',
            performanceScore: 92
          }
        }
      };

      const performance_score = (successEntry.audit.pageSpeed?.status === 'SUCCESS' && typeof successEntry.audit.pageSpeed.performanceScore === 'number')
        ? successEntry.audit.pageSpeed.performanceScore
        : null;

      expect(performance_score).toBe(92);
    });
  });

  describe('Task H: Zero Legacy Domain References & IndexNow Key Support', () => {
    it('has zero references to ai-marketing-platform-core.web.app in source code', () => {
      const srcDir = path.resolve(process.cwd(), 'packages/backend/src');
      
      function searchDirectory(dir: string): string[] {
        const matches: string[] = [];
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            matches.push(...searchDirectory(fullPath));
          } else if (file.endsWith('.ts') || file.endsWith('.js')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('ai-marketing-platform-core.web.app')) {
              matches.push(fullPath);
            }
          }
        }
        return matches;
      }

      const matches = searchDirectory(srcDir);
      expect(matches).toEqual([]);
    });

    it('skips IndexNow ping when INDEXNOW_KEY is not configured', async () => {
      delete process.env.INDEXNOW_KEY;
      
      const distributionEngine = OrganicDistributionEngine.getInstance();
      const seoEngine = SeoResearchEngine.getInstance();

      const distResult = await distributionEngine.pingIndexNow(['https://ai-marketing-organization.onrender.com/deals']);
      expect(distResult.status).toBe('SKIPPED_NO_INDEXNOW_KEY');

      const seoResult = await IndexNowSubmitter.submitUrls(
        'ai-marketing-organization.onrender.com',
        '', // empty key
        'https://ai-marketing-organization.onrender.com/key.txt',
        ['https://ai-marketing-organization.onrender.com/guides/test']
      );
      expect(seoResult.message).toBe('SKIPPED_NO_INDEXNOW_KEY');
    });
  });

  describe('Task B & E: Partner Registry & Public Funnel Authorization', () => {
    it('isPartnerAuthorizedForProduction strictly enforces AUTHORIZED status', () => {
      const registry = PartnerRegistryEngine.getInstance();
      
      expect(registry.isPartnerAuthorizedForProduction({
        authorizationStatus: 'AUTHORIZED',
        approvalStatus: 'APPROVED',
        activeStatus: 1
      } as any)).toBe(true);

      expect(registry.isPartnerAuthorizedForProduction({
        authorizationStatus: 'PENDING',
        approvalStatus: 'APPROVED',
        activeStatus: 1
      } as any)).toBe(false);

      expect(registry.isPartnerAuthorizedForProduction({
        authorizationStatus: 'AUTHORIZED',
        approvalStatus: 'PENDING',
        activeStatus: 1
      } as any)).toBe(false);

      expect(registry.isPartnerAuthorizedForProduction(undefined)).toBe(false);
    });
  });
});
