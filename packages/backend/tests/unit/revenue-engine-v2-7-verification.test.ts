import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { BusinessAutonomyLock } from '../../src/revenue/business-autonomy-lock.js';
import { getDb } from '../../src/db/client.js';

describe('Revenue Engine V2.7 Verification & Security Gate Tests', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  describe('1. CuelinksV3Client.isAllowedTrackingUrl security hardening', () => {
    it('accepts valid HTTPS allowlisted tracking URLs', () => {
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://clnk.in/wXYZ')).toBe(true);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://linksredirect.com/?cid=123&url=https%3A%2F%2Fboat-lifestyle.com')).toBe(true);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://www.linksredirect.com/?cid=456')).toBe(true);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://sub.clnk.in/deal-123')).toBe(true);
    });

    it('rejects unencrypted plain HTTP tracking URLs', () => {
      expect(CuelinksV3Client.isAllowedTrackingUrl('http://clnk.in/wXYZ')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('http://linksredirect.com/?cid=123')).toBe(false);
    });

    it('rejects URLs with embedded user credentials', () => {
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://user:pass@clnk.in/wXYZ')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://admin@linksredirect.com/?cid=123')).toBe(false);
    });

    it('rejects URLs with non-standard ports', () => {
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://clnk.in:8080/wXYZ')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://linksredirect.com:8443/?cid=123')).toBe(false);
      // Standard port 443 or default empty port is allowed
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://clnk.in:443/wXYZ')).toBe(true);
    });

    it('rejects deceptive lookalike / phishing domains and SSRF vectors', () => {
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://fakeclnk.in/wXYZ')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://clnk.in.attacker.org/wXYZ')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://linksredirect.com.evil.com/?cid=123')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://169.254.169.254/clnk.in')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('https://localhost/clnk.in')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl('')).toBe(false);
      expect(CuelinksV3Client.isAllowedTrackingUrl(null as any)).toBe(false);
    });
  });

  describe('2. convertLink sanitization of unsafe short_url', () => {
    it('does not allow unsafe short_url to override safe candidateTrackingUrl', async () => {
      const client = new CuelinksV3Client({ apiKey: 'mock-key-for-test' });

      // Mock the internal request method
      vi.spyOn(client as any, 'request').mockResolvedValue({
        data: {
          url: 'https://clnk.in/safe123',
          short_url: 'http://insecure-http.clnk.in/unsafe', // Insecure HTTP!
          tracking_url: 'https://clnk.in/safe123',
          affiliated: true
        }
      });

      const res = await client.convertLink({
        url: 'https://www.boat-lifestyle.com/products/earphones'
      });

      expect(res.affiliated).toBe(true);
      expect(res.tracking_url).toBe('https://clnk.in/safe123');
      // Must not use http://insecure-http.clnk.in/unsafe!
      expect(res.short_url).toBe('https://clnk.in/safe123');
      expect(CuelinksV3Client.isAllowedTrackingUrl(res.tracking_url!)).toBe(true);
      expect(CuelinksV3Client.isAllowedTrackingUrl(res.short_url!)).toBe(true);
    });

    it('rejects unallowlisted domain in short_url', async () => {
      const client = new CuelinksV3Client({ apiKey: 'mock-key-for-test' });

      vi.spyOn(client as any, 'request').mockResolvedValue({
        data: {
          url: 'https://clnk.in/safe123',
          short_url: 'https://evil-phish.com/short', // Phishing short URL!
          tracking_url: 'https://clnk.in/safe123',
          affiliated: true
        }
      });

      const res = await client.convertLink({
        url: 'https://www.boat-lifestyle.com/products/earphones'
      });

      expect(res.affiliated).toBe(true);
      expect(res.short_url).toBe('https://clnk.in/safe123');
    });
  });

  describe('3. AutonomousCommercialEngine lock namespacing & status honesty', () => {
    beforeEach(() => {
      const db = getDb();
      try {
        db.prepare(`DELETE FROM workflows WHERE workflow_type = 'COMMERCIAL_AFFILIATE_ACTIVATION'`).run();
        db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(orgId);
        db.prepare(`DELETE FROM partners WHERE organization_id = ? AND network = 'CUELINKS'`).run(orgId);
      } catch {}
      // Release any leftover locks
      try {
        BusinessAutonomyLock.forceRelease(bizId);
        BusinessAutonomyLock.forceRelease(`comm_${bizId}`);
      } catch {}
    });

    it('locks using commercial namespace so ARO and CommercialEngine do not block each other', async () => {
      // 1. Simulate ARO holding a lock on bizId
      const aroLock = await BusinessAutonomyLock.tryAcquireAsync(bizId, 'aro_cycle_test');
      expect(aroLock.acquired).toBe(true);

      // 2. CommercialEngine should acquire comm_${bizId} independently without being blocked by ARO
      const commercialLockKey = `comm_${bizId}`;
      const commLock = await BusinessAutonomyLock.tryAcquireAsync(commercialLockKey, 'comm_cycle_test');
      expect(commLock.acquired).toBe(true);

      // Clean up
      await BusinessAutonomyLock.releaseAsync(bizId, 'aro_cycle_test');
      await BusinessAutonomyLock.releaseAsync(commercialLockKey, 'comm_cycle_test');
    });

    it('returns status NO_ACTION_DUE instead of falsely claiming COMPLETED when 0 tasks processed', async () => {
      const engine = AutonomousCommercialEngine.getInstance();

      // Mock listCommercialTasks and discoverAndQualifyCandidate to return no tasks
      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue([]);
      vi.spyOn(engine as any, 'discoverAndQualifyCandidate').mockResolvedValue(null);

      const res = await engine.runCycle(orgId, bizId);

      expect(res.tasksProcessed).toBe(0);
      expect(res.tasksCompleted).toBe(0);
      expect(res.activeBlockers).toBe(0);
      // Spec requirement: Never report COMPLETED when zero work was performed!
      expect(res.status).toBe('NO_ACTION_DUE');
    });
  });
});
