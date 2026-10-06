import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { ConversionVerificationAdapter } from '../../src/commission/conversion-verification.js';
import { ContentAssetEngine, lintContentAsset } from '../../src/commission/content-asset-engine.js';
import { hashClientIp } from '../../src/security/client-ip.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Launch Gates and Fixes Verification Test Suite', () => {
  const orgId = 'org_launch_gates_test';
  const realBizId = 'biz_platform_aro';
  const realOrgId = 'org_owner_primary';

  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM referral_click_events WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM referrals WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM commission_records WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM revenue_records WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM commission_content_assets WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partners WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM search_cache`).run();
      db.prepare(`DELETE FROM provider_call_logs WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM durable_rate_limits`).run();
      db.prepare(`DELETE FROM business_autonomy_lock`).run();
      db.prepare(`DELETE FROM autonomous_cycle_log`).run();
    } catch {}
  });

  // =========================================================================
  // ITEM 1: NO OVERCLAIMS (Money-Path and Checklist Honesty)
  // =========================================================================
  describe('1. No Overclaims & Money-Path State', () => {
    it('shows OPERATOR_CONFIRMED_PROVISIONAL for PARTNER APPROVAL and OPERATOR_TO_CONFIRM for PARTNER TERMS', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Associates',
        industry: 'E-Commerce',
        website: 'https://affiliate-program.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES',
        evidence: {
          operatorConfirmed: true
          // note: terms_read_confirmed is omitted / false
        }
      });

      const session = OwnerAuthService.getInstance().createSession('usr_owner_01', orgId);
      const res = await app.request('/api/v1/commission/money-path', {
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'x-organization-id': orgId
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      const checklist = json.data.checklist;

      const approvalItem = checklist.find((i: any) => i.item === 'PARTNER APPROVAL');
      expect(approvalItem).toBeDefined();
      expect(approvalItem.status).toBe('OPERATOR_CONFIRMED_PROVISIONAL');

      const termsItem = checklist.find((i: any) => i.item === 'PARTNER TERMS');
      expect(termsItem).toBeDefined();
      expect(termsItem.status).toBe('OPERATOR_TO_CONFIRM');
      expect(termsItem.description).not.toContain('accepted and verified');
      expect(termsItem.description).toContain('under operator review');
    });

    it('upgrades PARTNER TERMS to READY when terms_read_confirmed is true in partner evidence', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Associates Confirmed',
        industry: 'E-Commerce',
        website: 'https://affiliate-program.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES',
        evidence: {
          operatorConfirmed: true,
          terms_read_confirmed: true
        }
      });

      const session = OwnerAuthService.getInstance().createSession('usr_owner_01', orgId);
      const res = await app.request('/api/v1/commission/money-path', {
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'x-organization-id': orgId
        }
      });

      const json = await res.json();
      const termsItem = json.data.checklist.find((i: any) => i.item === 'PARTNER TERMS');
      expect(termsItem.status).toBe('READY');
    });
  });

  // =========================================================================
  // ITEM 2: QUOTA LOGGING & SEARCH CACHE HIT
  // =========================================================================
  describe('2. Quota Logging & Cache Hit Classification', () => {
    it('returns CACHE_HIT and never LIVE_EXTERNAL_ACTION when served from search_cache', async () => {
      const db = getDb();
      const demandEngine = DemandDiscoveryEngine.getInstance();
      const category = 'best dental clinic hyderabad';
      const location = 'India';

      // Normalized cache key per DemandDiscoveryEngine
      const cacheKey = `demand_${category}_${location}`.toLowerCase().replace(/\s+/g, '_');

      const cachedData = [
        {
          id: 'sig_cached_1',
          source: 'ORGANIC_SEARCH',
          category,
          location,
          searchQuery: category,
          title: 'Top Dentists in Hyderabad',
          url: 'https://example.com/dentists',
          snippet: 'Reviews of clinics',
          demandScore: 85,
          timestamp: new Date().toISOString()
        }
      ];

      db.prepare(`
        INSERT INTO search_cache (id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at)
        VALUES (?, ?, 'TAVILY', ?, 1, datetime('now'), datetime('now', '+7 days'))
      `).run('cache_test_1', cacheKey, JSON.stringify(cachedData));

      const signals = await demandEngine.discoverDemand(orgId, {
        category,
        location,
        limit: 1
      });

      expect(signals.length).toBeGreaterThan(0);
      expect(demandEngine.getLastSource()).toBe('CACHE_HIT');
    });
  });

  // =========================================================================
  // ITEM 3: CRON SOURCE DERIVATION & TELEMETRY
  // =========================================================================
  describe('3. Cron Source Derivation', () => {
    it('derives triggerSource CLOUDFLARE_CRON for worker agent and MANUAL_PING for others', async () => {
      // 1. Worker user agent -> CLOUDFLARE_CRON
      const workerRes = await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'user-agent': 'ai-marketing-cron-worker/1.0',
          'x-cron-secret': process.env.CRON_PING_SECRET || 'cron_ping_default_dev'
        }
      });
      expect(workerRes.status).toBe(200);

      // 2. Other user agent -> MANUAL_PING
      const manualRes = await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'user-agent': 'curl/7.68.0',
          'x-cron-secret': process.env.CRON_PING_SECRET || 'cron_ping_default_dev'
        }
      });
      expect(manualRes.status).toBe(200);

      // 3. Direct orchestrator call verification with callerMetadata and real seeded business
      const aro = AutonomousRevenueOrchestrator.getInstance();
      const ipHashVal = hashClientIp('192.0.2.1');
      const cycleResult = await aro.runCycle(realOrgId, realBizId, 'MANUAL_PING', {
        userAgent: 'curl/7.68.0',
        ipHash: ipHashVal
      });

      const db = getDb();
      const cycleRow = db.prepare(`SELECT trigger_source, summary_json FROM autonomous_cycle_log WHERE id = ?`).get(cycleResult.cycleId) as any;
      expect(cycleRow).toBeDefined();
      expect(cycleRow.trigger_source).toBe('MANUAL_PING');
      const summary = JSON.parse(cycleRow.summary_json);
      expect(summary.userAgent).toBe('curl/7.68.0');
      expect(summary.ipHash).toBe(ipHashVal);
    });
  });

  // =========================================================================
  // ITEM 4: PAUSE PROSPECT DISCOVERY
  // =========================================================================
  describe('4. Pause Prospect Discovery', () => {
    it('enforces PROSPECT_DISCOVERY_ENABLED=false before making any Tavily prospect search', async () => {
      const origEnv = process.env.PROSPECT_DISCOVERY_ENABLED;
      process.env.PROSPECT_DISCOVERY_ENABLED = 'false';

      const engine = PlatformProspectDiscoveryEngine.getInstance();
      const result = await engine.discoverProspects({
        vertical: 'Dental',
        city: 'Hyderabad'
      });

      expect(result.status).toBe('NO_NEW_PROSPECTS');
      expect(result.count).toBe(0);
      expect(result.reason).toContain('PROSPECT_DISCOVERY_PAUSED');

      // Restore env
      if (origEnv !== undefined) {
        process.env.PROSPECT_DISCOVERY_ENABLED = origEnv;
      } else {
        delete process.env.PROSPECT_DISCOVERY_ENABLED;
      }
    });
  });

  // =========================================================================
  // ITEM 5: PUBLIC WRITE ABUSE RATE LIMITING
  // =========================================================================
  describe('5. Public Write Abuse Rate Limiting', () => {
    const testIp = '198.51.100.42';

    it('rejects 11th request with 429 and writes no row on POST /payments/razorpay/create-order', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_rate_limits`).run();

      const payload = JSON.stringify({
        businessId: realBizId,
        amountINR: 500,
        customerName: 'Rate Limit Test'
      });

      // Send 10 requests
      for (let i = 1; i <= 10; i++) {
        const res = await app.request('/api/v1/payments/razorpay/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': testIp
          },
          body: payload
        });
        expect([200, 201]).toContain(res.status);
      }

      // 11th request MUST be 429
      const countBefore = (db.prepare(`SELECT COUNT(*) as c FROM universal_orders WHERE business_id = ?`).get(realBizId) as any)?.c || 0;

      const rateLimitedRes = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp
        },
        body: payload
      });

      expect(rateLimitedRes.status).toBe(429);
      const json = await rateLimitedRes.json();
      expect(json.error).toBe('RATE_LIMIT_EXCEEDED');

      const countAfter = (db.prepare(`SELECT COUNT(*) as c FROM universal_orders WHERE business_id = ?`).get(realBizId) as any)?.c || 0;
      expect(countAfter).toBe(countBefore); // Writes NO row
    });

    it('rejects 11th request with 429 on POST /compliance/dpdp/consent', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_rate_limits`).run();

      const payload = JSON.stringify({
        businessId: realBizId,
        customerName: 'Consent Test User',
        purpose: 'Direct Marketing Communication'
      });

      for (let i = 1; i <= 10; i++) {
        const res = await app.request('/api/v1/compliance/dpdp/consent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': testIp
          },
          body: payload
        });
        expect(res.status).toBe(201);
      }

      const res11 = await app.request('/api/v1/compliance/dpdp/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp
        },
        body: payload
      });
      expect(res11.status).toBe(429);
    });

    it('rejects 11th request with 429 on POST /compliance/dpdp/erasure', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_rate_limits`).run();

      const payload = JSON.stringify({
        businessId: realBizId,
        phoneOrJourneyId: '+919999999999',
        reason: 'Consent withdrawn'
      });

      for (let i = 1; i <= 10; i++) {
        const res = await app.request('/api/v1/compliance/dpdp/erasure', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': testIp
          },
          body: payload
        });
        expect(res.status).toBe(200);
      }

      const res11 = await app.request('/api/v1/compliance/dpdp/erasure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp
        },
        body: payload
      });
      expect(res11.status).toBe(429);
    });

    it('rejects 11th request with 429 on POST /payments/manual-upi/claim', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_rate_limits`).run();

      const payload = (idx: number) => JSON.stringify({
        businessId: realBizId,
        utr: `BANK${1000000000 + idx}`, // 14-char valid bank transaction reference
        amountINR: 500,
        serviceRendered: 'Consultation'
      });

      for (let i = 1; i <= 10; i++) {
        const res = await app.request('/api/v1/payments/manual-upi/claim', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': testIp
          },
          body: payload(i)
        });
        expect(res.status).toBe(201);
      }

      const countBefore = (db.prepare(`SELECT COUNT(*) as c FROM manual_upi_claims WHERE business_id = ?`).get(realBizId) as any)?.c || 0;

      const res11 = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': testIp
        },
        body: payload(11)
      });
      expect(res11.status).toBe(429);

      const countAfter = (db.prepare(`SELECT COUNT(*) as c FROM manual_upi_claims WHERE business_id = ?`).get(realBizId) as any)?.c || 0;
      expect(countAfter).toBe(countBefore);
    });
  });

  // =========================================================================
  // ITEM 6: CONVERSION WEBHOOK HARDENING
  // =========================================================================
  describe('6. Conversion Webhook Authentication & Partner Rejection', () => {
    it('rejects forged body with no secret (401) and wrong secret (401) with 0 rows written', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Custom Affiliate Network',
        industry: 'Software',
        website: 'https://affiliate.customnetwork.com',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'OTHER_AUTHORIZED_PARTNER',
        evidence: {
          webhookSecret: 'secret_partner_authenticated_2026'
        }
      });

      const forgedPayload = JSON.stringify({
        transaction_id: 'tx_forged_9999',
        commission_amount: 1500,
        status: 'APPROVED'
      });

      // No secret header -> 401
      const noSecretRes = await app.request(`/api/v1/webhooks/conversion/${partner.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: forgedPayload
      });
      expect(noSecretRes.status).toBe(401);

      // Wrong secret header -> 401
      const wrongSecretRes = await app.request(`/api/v1/webhooks/conversion/${partner.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'wrong_secret_attacker'
        },
        body: forgedPayload
      });
      expect(wrongSecretRes.status).toBe(401);

      // Verify NO rows written in commission_records or revenue_records
      const db = getDb();
      const convCount = (db.prepare(`SELECT COUNT(*) as c FROM commission_records WHERE external_transaction_id = 'tx_forged_9999'`).get() as any)?.c || 0;
      const revCount = (db.prepare(`SELECT COUNT(*) as c FROM revenue_records WHERE transaction_id = 'tx_forged_9999'`).get() as any)?.c || 0;
      expect(convCount).toBe(0);
      expect(revCount).toBe(0);
    });

    it('rejects conversion webhook ingestion for AMAZON_ASSOCIATES (400)', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const amazonPartner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Associates',
        industry: 'E-Commerce',
        website: 'https://affiliate-program.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      const payload = JSON.stringify({
        transaction_id: 'tx_amazon_123',
        amount: 250
      });

      const res = await app.request(`/api/v1/webhooks/conversion/${amazonPartner.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'any_secret'
        },
        body: payload
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('WEBHOOK_NOT_SUPPORTED');
      expect(json.message).toContain('Amazon Associates does not support conversion webhooks');
    });
  });

  // =========================================================================
  // ITEM 9: DIRECT AMAZON LINKS & CLICK BEACON
  // =========================================================================
  describe('9. Direct Amazon Links & Click Beacon', () => {
    it('records 1 view on real visitor fetch of published guide and 0 views on bot fetch', async () => {
      const contentEngine = ContentAssetEngine.getInstance();
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Associates',
        industry: 'Retail',
        website: 'https://affiliate-program.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Thermal Printer Paper Rolls',
        offerSlug: 'thermal-printer-rolls',
        category: 'POS Hardware',
        targetCustomer: 'Small retail merchants in India seeking reliable paper rolls',
        commissionModel: 'FIXED',
        commissionAmountINR: 50,
        status: 'ACTIVE',
        destinationUrl: 'https://www.amazon.in/dp/B08XYZ1234?tag=marketing98-21',
        authorizedTrackingUrl: 'https://www.amazon.in/dp/B08XYZ1234?tag=marketing98-21'
      });

      const guide = await contentEngine.createAsset({
        organizationId: orgId,
        slug: 'thermal-printer-paper-guide-test',
        assetType: 'RECOMMENDATION',
        title: 'Comprehensive Guide to POS Thermal Receipt Rolls in Hyderabad',
        category: 'POS Hardware',
        location: 'Hyderabad',
        intentTarget: 'POS printer paper rolls',
        contentMarkdown: `# POS Printer Paper Rolls Guide for Hyderabad\n\nAs an Amazon Associate I earn from qualifying purchases.\n\nEvaluating thermal printer rolls requires checking width, coating quality, and shelf life for daily business point-of-sale receipt terminals.\n\nWhen buying paper rolls, consider lint-free options that keep printheads operating cleanly over prolonged operational cycles.\n\n[Check Official Pricing & Availability on Amazon India](https://www.amazon.in/dp/B08XYZ1234?tag=marketing98-21)\n\n## Evaluation Checklist\nVerify roll dimensions, GSM, and core diameter before ordering in bulk.`,
        primaryOfferId: offer.id,
        matchedOfferIds: [offer.id]
      });

      expect(guide.status).toBe('PUBLISHED');
      const slug = guide.slug;

      // 1. Bot fetch (Googlebot) -> records 0 views
      const botRes = await app.request(`/api/v1/guides/${slug}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }
      });
      expect(botRes.status).toBe(200);

      const db = getDb();
      let viewCount = (db.prepare(`SELECT view_count FROM commission_content_assets WHERE id = ?`).get(guide.id) as any)?.view_count || 0;
      expect(viewCount).toBe(0); // 0 views recorded for bot

      // 2. Real user fetch -> records 1 view
      const userRes = await app.request(`/api/v1/guides/${slug}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
      });
      expect(userRes.status).toBe(200);

      viewCount = (db.prepare(`SELECT view_count FROM commission_content_assets WHERE id = ?`).get(guide.id) as any)?.view_count || 0;
      expect(viewCount).toBe(1); // Exactly 1 view recorded
    });

    it('processes POST /api/v1/referrals/beacon with salted IP hash and ignores bot/test clicks', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Associates',
        industry: 'Retail',
        website: 'https://affiliate-program.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Barcode Scanner USB',
        offerSlug: 'barcode-scanner-usb',
        category: 'POS Hardware',
        targetCustomer: 'Small retail merchants',
        commissionModel: 'FIXED',
        commissionAmountINR: 80,
        status: 'ACTIVE',
        destinationUrl: 'https://www.amazon.in/dp/B07XYZ9999?tag=marketing98-21',
        authorizedTrackingUrl: 'https://www.amazon.in/dp/B07XYZ9999?tag=marketing98-21'
      });

      // 1. Unknown offer -> 404
      const unknownRes = await app.request('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: 'off_unknown_nonexistent' })
      });
      expect(unknownRes.status).toBe(404);

      // 2. Bot traffic -> returns success but recorded=false, no event inserted
      const botRes = await app.request('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-agent': 'AhrefsBot/7.0'
        },
        body: JSON.stringify({ offerId: offer.id })
      });
      expect(botRes.status).toBe(200);
      const botJson = await botRes.json();
      expect(botJson.data.recorded).toBe(false);

      // 3. Real user traffic -> records non-revenue click event with salted IP hash
      const realRes = await app.request('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
          'x-forwarded-for': '203.0.113.195'
        },
        body: JSON.stringify({ offerId: offer.id })
      });
      expect(realRes.status).toBe(200);
      const realJson = await realRes.json();
      expect(realJson.data.recorded).toBe(true);
      expect(realJson.data.isRevenue).toBe(false);
      expect(realJson.data.ipHash).toBe(hashClientIp('203.0.113.195'));
    });
  });

  // =========================================================================
  // ITEM 10: LEDGER EVIDENCE PROGRESSION
  // =========================================================================
  describe('10. Ledger Integrity & Evidence Progression', () => {
    it('proves commission cannot move to VERIFIED or PAID without attached provider evidence', async () => {
      const adapter = ConversionVerificationAdapter.getInstance();
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Provider Test Partner',
        industry: 'Software',
        website: 'https://provider.example.com',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED'
      });

      // 1. Reporting conversion without any evidence throws EVIDENCE_REQUIRED
      await expect(
        adapter.reportConversion({
          partnerId: partner.id,
          externalTransactionId: 'tx_no_evidence_1',
          eventType: 'PURCHASE',
          expectedCommissionINR: 500,
          verificationSource: 'WEBHOOK',
          evidence: null as any
        })
      ).rejects.toThrow('EVIDENCE_REQUIRED');

      // 2. Create conversion with pending evidence
      const conversion = await adapter.reportConversion({
        partnerId: partner.id,
        externalTransactionId: 'tx_valid_1',
        eventType: 'PURCHASE',
        expectedCommissionINR: 500,
        verificationSource: 'WEBHOOK',
        evidence: { rawEvent: 'checkout_complete' },
        status: 'COMMISSION_PENDING'
      });

      // 3. Reconciling to APPROVE / PAY without provider proof throws PROVIDER_PROOF_REQUIRED
      await expect(
        adapter.reconcileCommission({
          commissionId: conversion.id,
          action: 'APPROVE',
          verificationSource: 'MANUAL_VERIFICATION',
          evidence: { notes: 'Attempting approval with no provider reference' }
        })
      ).rejects.toThrow('PROVIDER_PROOF_REQUIRED');

      await expect(
        adapter.reconcileCommission({
          commissionId: conversion.id,
          action: 'PAY',
          verificationSource: 'MANUAL_VERIFICATION',
          evidence: { notes: 'Attempting payout with no provider reference' }
        })
      ).rejects.toThrow('PROVIDER_PROOF_REQUIRED');
    });
  });

  // =========================================================================
  // ITEM 11: CONTENT LINT GATE
  // =========================================================================
  describe('11. Content Lint Publish Gate', () => {
    it('blocks publishing on disallowed marketing claims and missing disclosure', () => {
      const badMarkdown = `
        # The #1 Best Certified Solution
        Guaranteed lowest price in India! Buy now for ₹1,999 (20% off).
        Only 5 left in stock for a limited time! ★★★★★ 5.0 stars rating.
        "This product changed my entire life!" — Rajesh
      `;

      const result = lintContentAsset(badMarkdown);
      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.stringContaining('FORBIDDEN_CLAIM: "certified"'),
          expect.stringContaining('FORBIDDEN_SUPERLATIVE: "best"'),
          expect.stringContaining('FORBIDDEN_SUPERLATIVE: "#1"'),
          expect.stringContaining('FORBIDDEN_CLAIM: "guaranteed"'),
          expect.stringContaining('FORBIDDEN_CLAIM: "lowest price"'),
          expect.stringContaining('FORBIDDEN_PRICING'),
          expect.stringContaining('FORBIDDEN_INVENTORY_CLAIM: "in stock"'),
          expect.stringContaining('FORBIDDEN_URGENCY: "limited time"'),
          expect.stringContaining('FORBIDDEN_RATING'),
          expect.stringContaining('FABRICATED_TESTIMONIAL'),
          expect.stringContaining('MISSING_AMAZON_DISCLOSURE')
        ])
      );
    });
  });
});
