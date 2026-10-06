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
  });
});
