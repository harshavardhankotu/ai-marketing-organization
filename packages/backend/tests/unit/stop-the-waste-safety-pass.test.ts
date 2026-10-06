import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AutonomyPolicyController } from '../../src/revenue/autonomy-policy.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { OutboundEngine } from '../../src/revenue/outbound-engine.js';
import {
  PlatformProspectDiscoveryEngine,
  normalizeDomain,
  normalizeUrl,
  JUNK_AND_DIRECTORY_DOMAINS
} from '../../src/revenue/platform-prospect-discovery-engine.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { isDemoBusiness, isPublicLiveBusiness } from '../../src/security/public-tenant-guard.js';
import app from '../../src/index.js';

describe('Stop-The-Waste & Safety Pass Test Suite', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  describe('1. Junk Quarantine & Outbound Dispatch Guard', () => {
    it('blocks dispatch for contacts marked REJECTED in outbound_contacts', async () => {
      const db = getDb();
      const contactId = 'ocont_test_rejected_01';
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name, prospect_business_name,
          prospect_email, prospect_phone, channel, email_authorized, whatsapp_opt_in,
          authorization_source, source, status, is_suppressed, suppression_reason, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'Test Clinic', 'Test Clinic',
          'contact@testjunk.com', '+919876000001', 'EMAIL', 1, 0,
          'PUBLIC_BUSINESS_CONTACT', 'TEST', 'REJECTED', 1, 'REJECTED', datetime('now'), datetime('now'))
      `).run(contactId);

      const safety = AutonomyPolicyController.getInstance().getContactSafety('contact@testjunk.com');
      expect(safety).toBe('BLOCKED');

      const outboundEngine = OutboundEngine.getInstance();
      const dispatchRes = await outboundEngine.dispatch({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        channel: 'EMAIL',
        recipientContact: 'contact@testjunk.com',
        content: 'Hello this should be blocked',
        isColdOutreach: true
      });

      expect(dispatchRes.success).toBe(false);
      expect(dispatchRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    });

    it('blocks ARO PURSUE_OPPORTUNITY if opportunity or prospect is marked REJECTED', async () => {
      const db = getDb();
      const oppId = 'opp_test_rejected_01';
      const prospectId = 'ppros_test_rejected_01';

      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, vertical, prospect_vertical, city, prospect_city, website_url,
          email, prospect_email, status, stage, created_at, updated_at
        ) VALUES (?, 'Junk Directory Lead', 'Junk Directory Lead', 'dental', 'dental', 'Hyderabad', 'Hyderabad',
          'https://etacky.com/listing', 'junk@etacky.com', 'junk@etacky.com', 'REJECTED', 'DISCOVERED', datetime('now'), datetime('now'))
      `).run(prospectId);

      db.prepare(`
        INSERT INTO opportunities (
          id, business_id, organization_id, prospect_id, title, status,
          estimated_value_inr, confidence_score, source, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', ?, 'PLATFORM_SETUP for Junk', 'REJECTED',
          15000, 0.2, 'OUTBOUND_PROSPECT', datetime('now'), datetime('now'))
      `).run(oppId, prospectId);

      const aro = AutonomousRevenueOrchestrator.getInstance();
      const result = await (aro as any).executeAction(
        {
          actionType: 'PURSUE_OPPORTUNITY',
          targetId: oppId,
          urgency: 'HIGH',
          rationale: 'Testing rejection safety'
        },
        'org_owner_primary',
        'biz_platform_aro',
        'cycle_test_01',
        { id: 'biz_platform_aro', name: 'Platform ARO' }
      );

      expect(result.status).toBe('BLOCKED_AUTHORIZATION');
      expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
      expect(result.isRevenueAction).toBe(false);
      expect(result.error).toContain('REJECTED');
    });
  });

  describe('2. Deduplication & 7-Day Query Cooldown', () => {
    it('normalizes domains and URLs correctly', () => {
      expect(normalizeDomain('https://www.fmsdental.com/contact/')).toBe('fmsdental.com');
      expect(normalizeDomain('http://FMSDENTAL.COM')).toBe('fmsdental.com');
      expect(normalizeDomain('etacky.com/view_listing.php?id=1188')).toBe('etacky.com');
      expect(normalizeUrl('https://www.youtube.com/watch?v=123&utm_source=test&ref=xyz')).toBe('https://youtube.com/watch?v=123');
    });

    it('rejects junk and aggregator domains in candidate validation', () => {
      const discEngine = PlatformProspectDiscoveryEngine.getInstance();
      expect(JUNK_AND_DIRECTORY_DOMAINS.has('youtube.com')).toBe(true);
      expect(JUNK_AND_DIRECTORY_DOMAINS.has('etacky.com')).toBe(true);
      expect(JUNK_AND_DIRECTORY_DOMAINS.has('justdial.com')).toBe(true);

      const isJunkValid = discEngine.validateCandidate({
        businessName: 'YouTube Best Dental Video',
        vertical: 'dental',
        city: 'Hyderabad',
        websiteUrl: 'https://www.youtube.com/watch?v=f-PMZHEnivM',
        evidenceSourceUrl: 'https://www.youtube.com/watch?v=f-PMZHEnivM',
        evidenceTimestamp: new Date().toISOString(),
        contactPhone: '+919849123456',
        observedGap: 'Manual inquiries'
      });
      expect(isJunkValid).toBe(false);

      const isEtackyValid = discEngine.validateCandidate({
        businessName: 'Etacky Classifieds Listing',
        vertical: 'dental',
        city: 'Hyderabad',
        websiteUrl: 'https://etacky.com/view_listing.php?id=1188',
        evidenceSourceUrl: 'https://etacky.com/view_listing.php?id=1188',
        evidenceTimestamp: new Date().toISOString(),
        contactPhone: '+919849123456',
        observedGap: 'Manual inquiries'
      });
      expect(isEtackyValid).toBe(false);
    });

    it('skips discovery if query was run within last 7 days unless isManual=true', async () => {
      const db = getDb();
      const discEngine = PlatformProspectDiscoveryEngine.getInstance();
      const queryKey = 'prospects_dental_hyderabad';

      // Insert search_cache row created just now
      db.prepare(`
        INSERT INTO search_cache (
          id, query_normalized, provider, raw_response_json, results_count,
          data_classification, source_verified, created_at, expires_at
        ) VALUES ('sc_recent_test', ?, 'tavily', '[]', 0, 'REAL_DATA', 1, datetime('now'), datetime('now', '+7 days'))
      `).run(queryKey);

      // Automated run should be skipped
      const autoRes = await discEngine.discoverProspects('biz_platform_aro', 'org_owner_primary', {
        vertical: 'dental',
        city: 'Hyderabad',
        isManual: false
      });
      expect(autoRes.status).toBe('NO_NEW_PROSPECTS');
      expect(autoRes.reason).toContain('DISCOVERY_COOLDOWN_ACTIVE');

      // Manual run should bypass cooldown (proceeds to execution or fixtures in test)
      const manualRes = await discEngine.discoverProspects('biz_platform_aro', 'org_owner_primary', {
        vertical: 'dental',
        city: 'Hyderabad',
        isManual: true
      });
      expect(manualRes.status).toBe('PROSPECTS_DISCOVERED');
    }, 15000);

    it('fails closed with DISCOVERY_COOLDOWN_CHECK_FAILED when D1 cooldown check errors, making zero search calls', async () => {
      const discEngine = PlatformProspectDiscoveryEngine.getInstance();
      const d1Repo = (discEngine as any).d1Repo;
      const originalQueryOne = d1Repo.queryOne;
      let searchCalled = false;
      const originalDiscoverViaTavily = (discEngine as any).discoverViaTavily;
      (discEngine as any).discoverViaTavily = async () => {
        searchCalled = true;
        return [];
      };

      try {
        // Simulate D1 database query error
        d1Repo.queryOne = async () => {
          throw new Error('D1_NETWORK_FAILURE: Connection to Cloudflare edge timed out');
        };

        const result = await discEngine.discoverProspects('biz_platform_aro', 'org_owner_primary', {
          vertical: 'dental',
          city: 'Hyderabad',
          isManual: false
        });

        expect(result.status).toBe('DISCOVERY_COOLDOWN_CHECK_FAILED');
        expect(result.count).toBe(0);
        expect(result.reason).toContain('DISCOVERY_COOLDOWN_CHECK_FAILED');
        expect(searchCalled).toBe(false);
      } finally {
        d1Repo.queryOne = originalQueryOne;
        (discEngine as any).discoverViaTavily = originalDiscoverViaTavily;
      }
    });

    it('skips candidates whose domain or source URL already exists in platform_prospects', async () => {
      const db = getDb();
      const discEngine = PlatformProspectDiscoveryEngine.getInstance();

      // Pre-seed an existing prospect with website apexdentalcare.in
      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, vertical, prospect_vertical, city, prospect_city,
          website_url, prospect_website, status, created_at, updated_at
        ) VALUES ('ppros_existing_apex', 'Apex Dental Care', 'Apex Dental Care', 'dental', 'dental', 'Hyderabad', 'Hyderabad',
          'https://apexdentalcare.in', 'https://apexdentalcare.in', 'DISCOVERED', datetime('now'), datetime('now'))
      `).run();

      // In test mode, discoverProspects uses getDeterministicTestFixtures where first candidate is Apex Dental Care
      const res = await discEngine.discoverProspects('biz_platform_aro', 'org_owner_primary', {
        vertical: 'dental',
        city: 'Hyderabad',
        limit: 1,
        isManual: true
      });

      // Apex Dental Care was deduplicated; candidate was skipped
      if (res.status === 'PROSPECTS_DISCOVERED') {
        const apexIncluded = res.prospects.some(p => p.websiteUrl.includes('apexdentalcare.in'));
        expect(apexIncluded).toBe(false);
      } else {
        expect(res.status).toBe('NO_NEW_PROSPECTS');
      }
    });
  });

  describe('3. Durable Quota Counters & Provider Logging', () => {
    it('persists Gemini daily requests and Tavily monthly credits in SQLite/D1 and survives reload', async () => {
      const quota = UnifiedQuotaService.getInstance();
      quota.ensureInitialized();

      // Record a Gemini call and a Tavily call
      quota.recordRequest('GEMINI', true, 1);
      quota.recordRequest('TAVILY', true, 5);

      const status1 = quota.getStatus();
      expect(status1.GEMINI.used).toBeGreaterThanOrEqual(1);
      expect(status1.TAVILY.used).toBeGreaterThanOrEqual(5);

      // Verify DB table contains the values
      const db = getDb();
      const geminiRow = db.prepare(`SELECT requests_today FROM provider_quota_state WHERE provider = 'GEMINI'`).get() as any;
      const tavilyRow = db.prepare(`SELECT credits_consumed_month FROM provider_quota_state WHERE provider = 'TAVILY'`).get() as any;

      expect(geminiRow.requests_today).toBeGreaterThanOrEqual(1);
      expect(tavilyRow.credits_consumed_month).toBeGreaterThanOrEqual(5);

      // Verify provider_call_logs has entries
      const logs = db.prepare(`SELECT COUNT(*) as cnt FROM provider_call_logs`).get() as any;
      expect(logs.cnt).toBeGreaterThanOrEqual(2);

      // Reinitialize / simulate service reload
      quota.ensureInitialized();
      const status2 = quota.getStatus();
      expect(status2.GEMINI.used).toBe(geminiRow.requests_today);
      expect(status2.TAVILY.used).toBe(tavilyRow.credits_consumed_month);
    });

    it('creates a FRESH UnifiedQuotaService instance and reads quota counts back from database', async () => {
      const quota1 = UnifiedQuotaService.getInstance();
      quota1.ensureInitialized();
      for (let i = 0; i < 7; i++) {
        quota1.recordRequest('GEMINI', true);
      }
      quota1.recordRequest('TAVILY', true, 12);

      // Force creation of a fresh instance
      UnifiedQuotaService.resetInstanceForTesting();
      const quotaFresh = UnifiedQuotaService.getInstance();

      const status = quotaFresh.getStatus();
      expect(status.GEMINI.used).toBeGreaterThanOrEqual(7);
      expect(status.TAVILY.used).toBeGreaterThanOrEqual(12);
    });
  });

  describe('4. Durable Rate Limiter', () => {
    it('tracks rate limits durably per IP hash and enforces threshold', async () => {
      const limiter = DurableRateLimiter.getInstance();
      const ip = '203.0.113.42';

      // First request allowed
      const r1 = await limiter.checkRateLimit('/public/lead', ip, 3, 60);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      // Second and third allowed
      await limiter.checkRateLimit('/public/lead', ip, 3, 60);
      const r3 = await limiter.checkRateLimit('/public/lead', ip, 3, 60);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // Fourth request blocked
      const r4 = await limiter.checkRateLimit('/public/lead', ip, 3, 60);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);

      // Verify state in durable_rate_limits table
      const db = getDb();
      const row = db.prepare(`SELECT request_count FROM durable_rate_limits WHERE ip_hash = ?`).get(limiter.hashIp(ip)) as any;
      expect(row.request_count).toBe(4);
    });

    it('creates a FRESH DurableRateLimiter instance and reads rate-limit buckets back from database', async () => {
      const limiter1 = DurableRateLimiter.getInstance();
      const testIp = '198.51.100.99';
      const r1 = await limiter1.checkRateLimit('/public/lead', testIp, 5, 300);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(4);

      // Reset instance and create a fresh instance
      DurableRateLimiter.resetInstanceForTesting();
      const limiterFresh = DurableRateLimiter.getInstance();
      const r2 = await limiterFresh.checkRateLimit('/public/lead', testIp, 5, 300);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(3); // count is now 2 across instances
    });

    it('derives client IP from X-Forwarded-For, assigns separate buckets to different IPs, and blocks 11th request with 429 without creating real leads', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_rate_limit_test', 'org_owner_primary', 'Rate Limit Test Clinic', 'rate-limit-test',
          'clinic', 'Clinic', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 1, datetime('now'))
      `).run();

      const ipA = '198.51.100.1';
      const ipB = '198.51.100.2';

      // 10 requests from ipA with empty lead details (only businessSlug)
      for (let i = 1; i <= 10; i++) {
        const res = await app.request('/api/v1/public/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `10.0.0.1, ${ipA}`
          },
          body: JSON.stringify({ businessSlug: 'rate-limit-test' }) // no name/phone — does not create real lead
        });
        // Returns 400 (validation error), but increments rate limit bucket
        expect(res.status).toBe(400);
      }

      // 11th request from ipA should be blocked with 429
      const resA11 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.0.1, ${ipA}`
        },
        body: JSON.stringify({ businessSlug: 'rate-limit-test' })
      });
      expect(resA11.status).toBe(429);
      const jsonA11 = await resA11.json() as any;
      expect(jsonA11.error).toContain('Rate limit exceeded');

      // Request from ipB should have its own separate bucket and return 400 (not 429)
      const resB1 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.0.1, ${ipB}`
        },
        body: JSON.stringify({ businessSlug: 'rate-limit-test' })
      });
      expect(resB1.status).toBe(400); // allowed by rate limiter, rejected by body validation
    });

    it('proves spoofed cf-connecting-ip cannot create unlimited buckets and is ignored in favor of trusted rightmost proxy IP', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_spoof_test', 'org_owner_primary', 'Spoof Test Clinic', 'spoof-test',
          'clinic', 'Clinic', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 1, datetime('now'))
      `).run();

      const realIp = '198.51.100.77';

      // Send 10 requests from the same rightmost IP, each with a different spoofed CF-Connecting-IP
      for (let i = 1; i <= 10; i++) {
        const spoofedIp = `10.99.${i}.${i}`;
        const res = await app.request('/api/v1/public/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `172.70.1.1, ${realIp}`,
            'CF-Connecting-IP': spoofedIp
          },
          body: JSON.stringify({ businessSlug: 'spoof-test' })
        });
        expect(res.status).toBe(400); // reaches validation handler
      }

      // 11th request with yet another spoofed CF-Connecting-IP must be BLOCKED with 429
      const res11 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `172.70.1.1, ${realIp}`,
          'CF-Connecting-IP': '10.99.11.11'
        },
        body: JSON.stringify({ businessSlug: 'spoof-test' })
      });
      expect(res11.status).toBe(429);
      const json11 = await res11.json() as any;
      expect(json11.error).toContain('Rate limit exceeded');
    });

    it('proves 11 requests with different left-hand XFF values but same rightmost proxy IP share one bucket and the 11th returns 429, while different rightmost values get separate buckets', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_proxy_ip_test', 'org_owner_primary', 'Proxy IP Clinic', 'proxy-ip-test',
          'clinic', 'Clinic', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 1, datetime('now'))
      `).run();

      const sharedRightmostIp = '203.0.113.195';
      const limiter = DurableRateLimiter.getInstance();
      db.prepare(`DELETE FROM durable_rate_limits WHERE ip_hash = ?`).run(limiter.hashIp(sharedRightmostIp));

      // 10 requests with different left-hand XFF values but the same rightmost value share one bucket
      for (let i = 1; i <= 10; i++) {
        const leftSpoofedIp = `192.168.1.${i}`;
        const res = await app.request('/api/v1/public/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': `${leftSpoofedIp}, 10.0.0.1, ${sharedRightmostIp}`
          },
          body: JSON.stringify({ businessSlug: 'proxy-ip-test' })
        });
        expect(res.status).toBe(400); // within limit, rejected by body validation
      }

      // 11th request with different left-hand XFF but same rightmost IP must return 429
      const res11 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `172.16.0.99, 10.0.0.1, ${sharedRightmostIp}`
        },
        body: JSON.stringify({ businessSlug: 'proxy-ip-test' })
      });
      expect(res11.status).toBe(429);
      const json11 = await res11.json() as any;
      expect(json11.error).toContain('Rate limit exceeded');

      // Request with a DIFFERENT rightmost IP gets a separate bucket and returns 400 (not 429)
      const diffRightmostIp = '203.0.113.196';
      db.prepare(`DELETE FROM durable_rate_limits WHERE ip_hash = ?`).run(limiter.hashIp(diffRightmostIp));

      const resDiff = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.0.1, ${diffRightmostIp}`
        },
        body: JSON.stringify({ businessSlug: 'proxy-ip-test' })
      });
      expect(resDiff.status).toBe(400); // separate bucket, within limit
    });

    it('enforces stricter limit of 5 requests for the unknown IP bucket when x-forwarded-for is missing', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_unknown_ip_test', 'org_owner_primary', 'Unknown IP Clinic', 'unknown-ip-test',
          'clinic', 'Clinic', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 1, datetime('now'))
      `).run();

      // Clear any prior rate limit entries for 'unknown' IP
      const limiter = DurableRateLimiter.getInstance();
      const unknownHash = limiter.hashIp('unknown');
      db.prepare(`DELETE FROM durable_rate_limits WHERE ip_hash = ?`).run(unknownHash);

      // 5 requests without X-Forwarded-For header
      for (let i = 1; i <= 5; i++) {
        const res = await app.request('/api/v1/public/lead', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
            // No X-Forwarded-For header -> maps to 'unknown' bucket with maxRequests = 5
          },
          body: JSON.stringify({ businessSlug: 'unknown-ip-test' })
        });
        expect(res.status).toBe(400); // validation error, within rate limit
      }

      // 6th request should be blocked with 429 due to stricter limit (5)
      const res6 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ businessSlug: 'unknown-ip-test' })
      });
      expect(res6.status).toBe(429);
      const json6 = await res6.json() as any;
      expect(json6.error).toContain('Rate limit exceeded');
    });
  });

  describe('5. Hide Demo Businesses & Enforce public_live=true', () => {
    it('returns 404 for demo businesses on all public endpoints', async () => {
      // 1. GET /public/business/:slug
      const res1 = await app.request('/api/v1/public/business/smilekraft-dental-clinic');
      expect(res1.status).toBe(404);

      const res2 = await app.request('/api/v1/public/business/smilekraft-dental-clinic-2');
      expect(res2.status).toBe(404);

      const res3 = await app.request('/api/v1/public/business/platform-aro');
      expect(res3.status).toBe(404);

      // 2. GET /public/funnel/:businessSlug
      const res4 = await app.request('/api/v1/public/funnel/smilekraft-dental-clinic');
      expect(res4.status).toBe(404);

      // 3. POST /public/lead
      const res5 = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'smilekraft-dental-clinic',
          customerName: 'Test Patient',
          customerPhone: '+919876543210'
        })
      });
      expect(res5.status).toBe(404);

      // 4. POST /public/checkout
      const res6 = await app.request('/api/v1/public/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'smilekraft-dental-clinic',
          offerId: 'off_test_01',
          customerName: 'Test Patient',
          customerPhone: '+919876543210'
        })
      });
      expect(res6.status).toBe(404);

      // 5. POST /public/booking
      const res7 = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'smilekraft-dental-clinic',
          customerName: 'Test Patient',
          customerPhone: '+919876543210'
        })
      });
      expect(res7.status).toBe(404);

      // 6. GET /public/availability
      const res8 = await app.request('/api/v1/public/availability?businessSlug=smilekraft-dental-clinic');
      expect(res8.status).toBe(404);
    });

    it('returns 404 for businesses where public_live = 0', async () => {
      const db = getDb();
      // Insert a real-named business that is NOT public live
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_private_clinic', 'org_owner_primary', 'Private Clinic', 'private-clinic',
          'clinic', 'Clinic', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 0, datetime('now'))
      `).run();

      const res = await app.request('/api/v1/public/business/private-clinic');
      expect(res.status).toBe(404);

      const leadRes = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'private-clinic',
          customerName: 'Test Patient',
          customerPhone: '+919876543210'
        })
      });
      expect(leadRes.status).toBe(404);
    });

    it('allows public access only when public_live = 1 and not a demo business', async () => {
      const db = getDb();
      // Insert an active public live business
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, public_live, created_at
        ) VALUES ('biz_live_partner_01', 'org_owner_primary', 'Apex Health Centre', 'apex-health-centre',
          'clinic', 'Clinic', 'Hyderabad', 'Jubilee Hills', 'Empathetic', 'IN', 1, datetime('now'))
      `).run();

      const res = await app.request('/api/v1/public/business/apex-health-centre');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Apex Health Centre');
    });

    it('positive control: with public_live=1, each public GET/POST route reaches handler (invalid body returns 400 not 404)', async () => {
      const db = getDb();
      // Seed a legitimate public live business
      db.prepare(`
        INSERT OR REPLACE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, country, currency, timezone, public_live, created_at
        ) VALUES ('biz_pos_ctrl_01', 'org_owner_primary', 'Positive Control Clinic', 'pos-control-clinic',
          'dental', 'Dental Care', 'Hyderabad', 'Banjara Hills', 'Professional', 'IN', 'INR', 'Asia/Kolkata', 1, datetime('now'))
      `).run();

      // Seed an active funnel
      db.prepare(`
        INSERT OR REPLACE INTO funnels (
          id, business_id, organization_id, public_slug, funnel_type, objective,
          headline, cta_strategy, payment_strategy, status, created_at, updated_at
        ) VALUES ('fnl_pos_ctrl_01', 'biz_pos_ctrl_01', 'org_owner_primary', 'main',
          'LEAD_CAPTURE', 'Acquire new patients', 'Welcome to Positive Control Clinic', 'BOOK_OR_BUY', 'OPTIONAL', 'ACTIVE', datetime('now'), datetime('now'))
      `).run();

      // Seed an active customer offer for this business
      db.prepare(`
        INSERT OR REPLACE INTO customer_offers (
          id, business_id, organization_id, title, price_minor, currency, active, created_at, updated_at
        ) VALUES ('off_pos_01', 'biz_pos_ctrl_01', 'org_owner_primary', 'Consultation', 50000, 'INR', 1, datetime('now'), datetime('now'))
      `).run();

      // 1. GET /public/business/:slug -> 200
      const resBiz = await app.request('/api/v1/public/business/pos-control-clinic');
      expect(resBiz.status).toBe(200);

      // 2. GET /public/funnel/:businessSlug -> 200
      const resFnl = await app.request('/api/v1/public/funnel/pos-control-clinic');
      expect(resFnl.status).toBe(200);

      // 3. GET /public/funnel/:businessSlug/:funnelSlug -> 200
      const resFnlMain = await app.request('/api/v1/public/funnel/pos-control-clinic/main');
      expect(resFnlMain.status).toBe(200);

      // 4. GET /public/availability?businessSlug=:slug -> 200
      const resAvail = await app.request('/api/v1/public/availability?businessSlug=pos-control-clinic');
      expect(resAvail.status).toBe(200);

      // 5. POST /public/lead with invalid body -> 400 (reaches handler, NOT 404)
      const resLead = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessSlug: 'pos-control-clinic' }) // missing name & phone
      });
      expect(resLead.status).toBe(400);

      // 6. POST /public/checkout with invalid body -> 400 (NOT 404)
      const resCheckout = await app.request('/api/v1/public/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessSlug: 'pos-control-clinic', offerId: 'off_pos_01' }) // missing customer details
      });
      expect(resCheckout.status).toBe(400);

      // 7. POST /public/order with invalid body -> 400 (NOT 404)
      const resOrder = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessSlug: 'pos-control-clinic', offerId: 'off_pos_01' }) // missing customer details
      });
      expect(resOrder.status).toBe(400);

      // 8. POST /public/booking with invalid body -> 400 (NOT 404)
      const resBooking = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessSlug: 'pos-control-clinic' }) // missing booking details
      });
      expect(resBooking.status).toBe(400);
    });

    it('positive control: published guide returns 200, appears in /sitemap.xml, and /r/ referral returns 302 while platform-aro stays 404', async () => {
      const db = getDb();

      // Seed a published guide
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, title, content_markdown, status, category, asset_type,
          intent_target, view_count, created_at, updated_at
        ) VALUES ('asset_guide_pos_01', 'org_owner_primary', 'hyderabad-dental-implants-guide', 'Hyderabad Dental Implants Guide',
          'Comprehensive Dental Guide', 'PUBLISHED', 'DENTAL', 'GUIDE',
          'implants', 0, datetime('now'), datetime('now'))
      `).run();

      // Seed active partner and offer
      db.prepare(`
        INSERT OR REPLACE INTO partners (
          id, organization_id, name, industry, website, partner_type, created_at, updated_at
        ) VALUES ('part_pos_01', 'org_owner_primary', 'DentCare Partner Network', 'Dental', 'https://dentcare.example.com', 'AFFILIATE', datetime('now'), datetime('now'))
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, destination_url, authorized_tracking_url,
          commission_model, commission_amount_inr, status, active, created_at, updated_at
        ) VALUES ('poff_pos_01', 'part_pos_01', 'org_owner_primary', 'DentCare Savings Plan', 'dentcare-savings-plan',
          'DENTAL', 'Dental Patients', 'https://partner.example.com/checkout', 'https://partner.example.com/track',
          'FIXED', 1000, 'ACTIVE', 1, datetime('now'), datetime('now'))
      `).run();

      // Seed referral record
      db.prepare(`
        INSERT OR REPLACE INTO referrals (
          id, partner_id, offer_id, organization_id, click_id, destination_url, created_at
        ) VALUES ('ref_pos_01', 'part_pos_01', 'poff_pos_01', 'org_owner_primary', 'ref_dent_01',
          'https://partner.example.com/checkout?ref=ref_dent_01', datetime('now'))
      `).run();

      // 1. GET /api/v1/guides/:slug returns 200
      const resGuide = await app.request('/api/v1/guides/hyderabad-dental-implants-guide');
      expect(resGuide.status).toBe(200);
      const guideJson = await resGuide.json() as any;
      expect(guideJson.success).toBe(true);
      expect(guideJson.data.title).toBe('Hyderabad Dental Implants Guide');

      // 2. GET /sitemap.xml returns 200 and includes /guides/hyderabad-dental-implants-guide
      const resSitemap = await app.request('/sitemap.xml');
      expect(resSitemap.status).toBe(200);
      const sitemapText = await resSitemap.text();
      expect(sitemapText).toContain('/guides/hyderabad-dental-implants-guide');

      // 3. GET /r/:offerSlug/:referralId returns 302 redirect
      const resReferral = await app.request('/r/dentcare-savings-plan/ref_dent_01');
      expect(resReferral.status).toBe(302);
      expect(resReferral.headers.get('location')).toBe('https://partner.example.com/checkout?ref=ref_dent_01');

      // 4. Confirm platform-aro remains completely hidden (404) across all /api/v1/public/* routes
      const aroBiz = await app.request('/api/v1/public/business/platform-aro');
      expect(aroBiz.status).toBe(404);

      const aroFnl = await app.request('/api/v1/public/funnel/platform-aro');
      expect(aroFnl.status).toBe(404);

      const aroContent = await app.request('/api/v1/public/content/platform-aro');
      expect(aroContent.status).toBe(404);

      const aroDisclosure = await app.request('/api/v1/public/disclosure/platform-aro');
      expect(aroDisclosure.status).toBe(404);

      const aroLead = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessSlug: 'platform-aro' })
      });
      expect(aroLead.status).toBe(404);
    });

    it('returns 200 for published content and disclosure routes, and 404 for nonexistent slugs', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, title, content_markdown, status, category, asset_type,
          intent_target, disclosure_markdown, view_count, created_at, updated_at
        ) VALUES ('asset_content_fix_02', 'org_owner_primary', 'published-implant-guide', 'Published Implant Guide',
          '# Implant Guide Content', 'PUBLISHED', 'DENTAL', 'GUIDE',
          'implants', 'Factual Disclosure Text: We may earn an affiliate commission.', 0, datetime('now'), datetime('now'))
      `).run();

      // 1. GET /public/content/:slug with real published slug -> 200
      const resContent200 = await app.request('/api/v1/public/content/published-implant-guide');
      expect(resContent200.status).toBe(200);
      const contentJson = await resContent200.json() as any;
      expect(contentJson.success).toBe(true);
      expect(contentJson.data.title).toBe('Published Implant Guide');

      // 2. GET /public/disclosure/:slug with real published slug -> 200
      const resDisc200 = await app.request('/api/v1/public/disclosure/published-implant-guide');
      expect(resDisc200.status).toBe(200);
      const discJson = await resDisc200.json() as any;
      expect(discJson.success).toBe(true);
      expect(discJson.data.disclosure_text).toContain('Factual Disclosure Text');

      // 3. GET /public/content/:slug with nonexistent slug -> 404
      const resContent404 = await app.request('/api/v1/public/content/nonexistent-implant-guide-xyz');
      expect(resContent404.status).toBe(404);
      const content404Json = await resContent404.json() as any;
      expect(content404Json.error).toBe('CONTENT_NOT_FOUND');

      // 4. GET /public/disclosure/:slug with nonexistent slug -> 404
      const resDisc404 = await app.request('/api/v1/public/disclosure/nonexistent-implant-guide-xyz');
      expect(resDisc404.status).toBe(404);
      const disc404Json = await resDisc404.json() as any;
      expect(disc404Json.error).toBe('CONTENT_NOT_FOUND');
    });
  });

  describe('7. Micro-Verify Pass: Client-IP Topology & Durable Outbound Hold', () => {
    it('protects GET /api/v1/diag/headers with X-Cron-Secret and returns full topology', async () => {
      // 1. Without X-Cron-Secret -> 401
      const res401 = await app.request('/api/v1/diag/headers');
      expect(res401.status).toBe(401);
      const json401 = await res401.json() as any;
      expect(json401.error).toContain('Unauthorized: Invalid X-Cron-Secret');

      // 2. With valid X-Cron-Secret -> 200 with raw headers and selected IP
      const secret = process.env.CRON_PING_SECRET || 'cron_ping_fixture_dev';
      const res200 = await app.request('/api/v1/diag/headers', {
        headers: {
          'X-Cron-Secret': secret,
          'X-Forwarded-For': '203.0.113.195, 10.0.0.1, 198.51.100.24',
          'CF-Connecting-IP': '192.0.2.1',
          'True-Client-IP': '192.0.2.2',
          'X-Real-IP': '192.0.2.3'
        }
      });

      expect(res200.status).toBe(200);
      const data = await res200.json() as any;
      expect(data['raw x-forwarded-for']).toBe('203.0.113.195, 10.0.0.1, 198.51.100.24');
      expect(data['entry count']).toBe(3);
      expect(data['cf-connecting-ip']).toBe('192.0.2.1');
      expect(data['true-client-ip']).toBe('192.0.2.2');
      expect(data['x-real-ip']).toBe('192.0.2.3');
      // With default TRUSTED_PROXY_HOPS=1 and TRUST_CF_HEADER=false, rightmost XFF entry is selected
      expect(data['selectedIp']).toBe('198.51.100.24');
    });

    it('proves that with OUTBOUND_ENABLED=false and fake provider configured, dispatch returns BLOCKED', async () => {
      const prevVal = process.env.OUTBOUND_ENABLED;
      try {
        process.env.OUTBOUND_ENABLED = 'false';

        // Configure a fake provider scenario (Email with credentials simulated)
        const outboundEngine = OutboundEngine.getInstance();
        const fakeRequest = {
          businessId: 'biz_platform_aro',
          organizationId: 'org_owner_primary',
          channel: 'EMAIL' as const,
          recipientId: 'rec_fake_01',
          recipientContact: 'dr.test@fakedental.com',
          recipientName: 'Dr. Test',
          subject: 'System Check',
          body: 'Testing outbound hold',
          isColdOutreach: true,
          isApproved: true,
          approverId: 'usr_owner_01'
        };

        const result = await outboundEngine.dispatch(fakeRequest);
        expect(result.success).toBe(false);
        expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
        expect(result.status).toBe('BLOCKED_AUTHORIZATION');
        expect(result.error).toContain('Outbound dispatch is globally disabled');
      } finally {
        if (prevVal !== undefined) {
          process.env.OUTBOUND_ENABLED = prevVal;
        } else {
          delete process.env.OUTBOUND_ENABLED;
        }
      }
    });

    it('proves that outbound contacts with status HOLD_REQUIRES_APPROVAL return BLOCKED from getContactSafety', async () => {
      const db = getDb();
      const contactId = 'ocont_hold_test_01';
      db.prepare(`
        INSERT INTO outbound_contacts (
          id, business_id, organization_id, prospect_name,
          prospect_email, channel, status, is_suppressed, suppression_reason, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'Dr. Hold Test',
          'dr.hold@example.com', 'EMAIL', 'HOLD_REQUIRES_APPROVAL', 0, 'PREV_STATUS:ACTIVE', datetime('now'), datetime('now'))
      `).run(contactId);

      const safety = AutonomyPolicyController.getInstance().getContactSafety('dr.hold@example.com');
      expect(safety).toBe('BLOCKED');

      const outboundEngine = OutboundEngine.getInstance();
      const dispatchRes = await outboundEngine.dispatch({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        channel: 'EMAIL',
        recipientId: contactId,
        recipientContact: 'dr.hold@example.com',
        body: 'Should be suppressed',
        isColdOutreach: false
      });

      expect(dispatchRes.success).toBe(false);
      expect(dispatchRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
      expect(dispatchRes.status).toBe('SUPPRESSED');
      expect(dispatchRes.error).toContain('Contact has status BLOCKED');
    });
  });
});
