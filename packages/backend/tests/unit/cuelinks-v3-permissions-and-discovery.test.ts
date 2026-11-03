import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';

describe('Stage 2 — Cuelinks V3 Permissions, Scopes & Discovery Truth Tests', () => {
  let client: CuelinksV3Client;
  let syncMgr: CuelinksSyncManager;

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_cuelinks_api_key_stage2';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    client = CuelinksV3Client.getInstance();
    syncMgr = CuelinksSyncManager.getInstance(client);
  });

  describe('1. No Hardcoded 331585 Channel Default', () => {
    it('returns approved: false and channel: null when no approved channel matches (never defaults to 331585)', async () => {
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 999999, name: 'Pending Channel', status: 'pending', url: 'https://other-site.com' }
      ]);

      const res = await syncMgr.getApprovedChannel();
      expect(res.approved).toBe(false);
      expect(res.channel).toBeNull();
    });

    it('returns approved channel when an approved channel is present on the publisher account', async () => {
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 444555, name: 'Active Channel', status: 'approved', is_default: true, url: 'https://ai-marketing-organization.onrender.com' }
      ]);

      const res = await syncMgr.getApprovedChannel();
      expect(res.approved).toBe(true);
      expect(res.channel?.id).toBe(444555);
    });
  });

  describe('2. Strict Link Conversion Scope Truth', () => {
    it('does NOT mark write:links as available solely because campaign discovery succeeded', async () => {
      vi.spyOn(client, 'ping').mockResolvedValue({
        status: 'success',
        publisher_id: 12345,
        scopes: ['read:campaigns', 'read:channels']
      });
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 123, status: 'approved', is_default: true, url: 'https://onrender.com' }
      ]);
      vi.spyOn(client, 'searchCampaigns').mockResolvedValue({
        campaigns: [
          { id: 4232, name: 'Boat', status: 'active', access_status: 'open', url: 'https://boat-lifestyle.com' }
        ],
        total: 1
      });
      vi.spyOn(client, 'getOffers').mockResolvedValue({ offers: [], total: 0 });

      // Run sync without converting a link
      await syncMgr.syncCuelinks('org_owner_primary', 'biz_platform_aro');

      const status = syncMgr.getStatus();
      // write:links must NOT be in scopes unless an actual link conversion succeeded
      expect(status.scopes?.includes('write:links')).toBe(false);
    });

    it('marks write:links as available only after an actual link conversion returns affiliated === true', async () => {
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 123, status: 'approved', is_default: true, url: 'https://onrender.com' }
      ]);
      vi.spyOn(client, 'convertLink').mockResolvedValue({
        url: 'https://boat-lifestyle.com/products/airdopes-141',
        affiliated: true,
        channel_id: 123,
        tracking_url: 'https://linksredirect.com/?cid=123&subid=cap_test'
      });

      const isAvailable = await syncMgr.verifyLinkConversionCapability('https://boat-lifestyle.com/products/airdopes-141');
      expect(isAvailable).toBe(true);

      const status = syncMgr.getStatus();
      expect(status.scopes?.includes('write:links')).toBe(true);
    });
  });

  describe('3. Independent Capability Tracking', () => {
    it('does not block link conversion capability when offer discovery encounters an error', async () => {
      // Mock getOffers failing with 500
      vi.spyOn(client, 'getOffers').mockRejectedValue(new Error('Cuelinks Upstream 500'));
      vi.spyOn(client, 'getChannels').mockResolvedValue([
        { id: 123, status: 'approved', is_default: true, url: 'https://onrender.com' }
      ]);
      vi.spyOn(client, 'convertLink').mockResolvedValue({
        url: 'https://boat-lifestyle.com/products/airdopes-141',
        affiliated: true,
        channel_id: 123,
        tracking_url: 'https://linksredirect.com/?cid=123&subid=cap_test'
      });

      const caps = syncMgr.getCapabilities();
      expect(caps.linkConversion).toBeDefined();

      const canConvert = await syncMgr.verifyLinkConversionCapability();
      expect(canConvert).toBe(true);
      expect(syncMgr.getCapabilities().linkConversion).toBe('AVAILABLE');
    });
  });
});
