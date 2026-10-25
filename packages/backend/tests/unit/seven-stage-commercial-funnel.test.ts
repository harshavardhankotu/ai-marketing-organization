import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('7-Stage Evidence-Based Commercial Funnel (Spec §§ 1–15)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    vi.restoreAllMocks();
    AutonomousDealDiscoveryEngine.getInstance().resetFunnelMetricsForTesting();
  });

  describe('1. Seven Formal Funnel Stages & Strict Metric Separation', () => {
    it('initializes with strictly separated zeroed counters and ₹0.00 cash received', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const funnel = engine.getSevenStageFunnel();

      expect(funnel).toBeDefined();
      expect(funnel.publicPageVisits).toBe(0);
      expect(funnel.dealCardClicks).toBe(0);
      expect(funnel.providerAttributedClicks).toBe(0);
      expect(funnel.reportedConversions).toBe(0);
      expect(funnel.validatedCommissionsINR).toBe(0);
      expect(funnel.paidCommissionsINR).toBe(0);
      expect(funnel.pendingCommissionsINR).toBe(0);
      expect(funnel.reversedCommissionsINR).toBe(0);
      expect(funnel.cashReceivedINR).toBe(0); // Strictly ₹0.00 until bank statement proof

      // Verify all 7 stages exist in breakdown
      const stages = Object.keys(funnel.stageBreakdown);
      expect(stages).toEqual([
        'DISCOVERY',
        'PAGE_VISIT',
        'DEAL_CLICK',
        'PROVIDER_CLICK',
        'REPORTED_CONVERSION',
        'VALIDATED_COMMISSION',
        'PAID_COMMISSION'
      ]);
    });

    it('records Stage 1 (DISCOVERY) from gathered offers without incrementing any downstream stage', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      await engine.runDiscoveryCycle(orgId, bizId);

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.discoveryImpressions).toBeGreaterThanOrEqual(1);

      // Downstream stages must NOT be inferred or incremented
      expect(funnel.publicPageVisits).toBe(0);
      expect(funnel.dealCardClicks).toBe(0);
      expect(funnel.providerAttributedClicks).toBe(0);
      expect(funnel.reportedConversions).toBe(0);
      expect(funnel.validatedCommissionsINR).toBe(0);
      expect(funnel.paidCommissionsINR).toBe(0);
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('records Stage 2 (PAGE VISIT) via beacon without assuming deal clicks or conversions', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      engine.recordPageVisit({ path: '/deals', ip: '203.0.113.1' });
      engine.recordPageVisit({ path: '/deals', ip: '203.0.113.2' });
      engine.recordPageVisit({ path: '/deals/electronics', ip: '203.0.113.3' });

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.publicPageVisits).toBe(3);

      // Downstream stages remain strictly zero
      expect(funnel.dealCardClicks).toBe(0);
      expect(funnel.providerAttributedClicks).toBe(0);
      expect(funnel.reportedConversions).toBe(0);
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('records Stage 3 (DEAL CLICK) via local deal click beacon without assuming provider acknowledgment', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const res = await engine.ingestAndVerifyDeal({
        title: 'Noise ColorFit Pulse Smartwatch',
        brand: 'Noise',
        merchant: 'Noise India',
        category: 'Smartwatches & Fitness',
        productUrl: 'https://www.gonoise.com/products/colorfit-pulse',
        currentPriceINR: 1999,
        referencePriceINR: 4999,
        claimedDiscountPercent: 60,
        sourceUrl: 'https://www.gonoise.com',
        sourceDomain: 'gonoise.com',
        sourceType: 'RETAILER_BRAND'
      }, orgId, bizId);

      expect(res.deal).toBeDefined();
      const dealId = res.deal!.id;

      // Click deal card
      const clickRes = engine.recordDealClick(dealId, { ip: '203.0.113.10' });
      expect(clickRes.success).toBe(true);

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.dealCardClicks).toBe(1);

      // Provider-attributed clicks (Stage 4) must NOT be inferred from local clicks
      expect(funnel.providerAttributedClicks).toBe(0);
      expect(funnel.reportedConversions).toBe(0);
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('records Stage 4 (PROVIDER CLICK) strictly from provider reports without altering local click counts', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinks = CuelinksSyncManager.getInstance();

      // Set local click
      engine.recordDealClick('dummy_id');

      // Inject provider reports reconciliation (e.g. 5 clicks acknowledged by Cuelinks)
      cuelinks.setReconciliationMetrics({
        providerAttributedClicks: 5
      });

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.dealCardClicks).toBe(0); // dummy_id failed so 0 local clicks
      expect(funnel.providerAttributedClicks).toBe(5);

      // Stage 5 conversions must NOT be assumed from provider clicks
      expect(funnel.reportedConversions).toBe(0);
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('records Stage 5 (REPORTED CONVERSION) and Stage 6 (VALIDATED COMMISSION) strictly from transactions', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinks = CuelinksSyncManager.getInstance();

      cuelinks.setReconciliationMetrics({
        providerAttributedClicks: 12,
        reportedConversions: 2,
        pendingCommissionINR: 150.50,
        validatedCommissionINR: 320.00,
        reversedCommissionINR: 50.00,
        paidCommissionINR: 0
      });

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.providerAttributedClicks).toBe(12);
      expect(funnel.reportedConversions).toBe(2);
      expect(funnel.pendingCommissionsINR).toBe(150.50);
      expect(funnel.validatedCommissionsINR).toBe(320.00);
      expect(funnel.reversedCommissionsINR).toBe(50.00);
      expect(funnel.paidCommissionsINR).toBe(0);

      // Stage 7 and Cash Received remain strictly separated
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('records Stage 7 (PAID COMMISSION) strictly without assuming cash received', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinks = CuelinksSyncManager.getInstance();

      cuelinks.setReconciliationMetrics({
        paidCommissionINR: 1250.00
      });

      const funnel = engine.getSevenStageFunnel();
      expect(funnel.paidCommissionsINR).toBe(1250.00);

      // CRITICAL INVARIANT: cashReceivedINR must remain strictly ₹0.00 even if paidCommissionsINR > 0
      expect(funnel.cashReceivedINR).toBe(0.00);
    });
  });

  describe('2. Strict Financial Truth & Bank Confirmation Gate', () => {
    it('enforces strictly ₹0.00 cash received by default regardless of other metrics', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const funnel = engine.getSevenStageFunnel();
      expect(funnel.cashReceivedINR).toBe(0);
    });

    it('rejects bank confirmation attempt without explicit owner confirmation', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = engine.confirmBankProof({
        amountINR: 500,
        bankTransactionReference: 'HDFC_UTR_1234567890',
        statementDate: '2026-10-25',
        confirmedByOwner: false // Owner has not confirmed!
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('OWNER_CONFIRMATION_REQUIRED');
      expect(engine.getSevenStageFunnel().cashReceivedINR).toBe(0);
    });

    it('rejects bank confirmation with missing or invalid bank transaction reference / UTR', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = engine.confirmBankProof({
        amountINR: 500,
        bankTransactionReference: '', // Empty reference!
        statementDate: '2026-10-25',
        confirmedByOwner: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('INVALID_BANK_REFERENCE');
      expect(engine.getSevenStageFunnel().cashReceivedINR).toBe(0);
    });

    it('rejects bank confirmation with non-positive amount', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = engine.confirmBankProof({
        amountINR: 0, // Zero amount!
        bankTransactionReference: 'ICICI_UTR_987654321',
        statementDate: '2026-10-25',
        confirmedByOwner: true
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('INVALID_AMOUNT');
      expect(engine.getSevenStageFunnel().cashReceivedINR).toBe(0);
    });

    it('records verified cash received only when backed by human owner confirmation and bank UTR proof', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const result = engine.confirmBankProof({
        amountINR: 1250.00,
        bankTransactionReference: 'HDFC_CMS_REF_9812739182',
        statementDate: '2026-10-25',
        confirmedByOwner: true
      });

      expect(result.success).toBe(true);
      expect(engine.getSevenStageFunnel().cashReceivedINR).toBe(1250.00);
    });
  });

  describe('3. HTTP Endpoints for Funnel Telemetry & Observability', () => {
    it('records public pageview via POST /api/v1/public/deals/page-view', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const initialVisits = engine.getSevenStageFunnel().publicPageVisits;

      const res = await app.request('/api/v1/public/deals/page-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/deals', referer: 'https://google.com' })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);

      expect(engine.getSevenStageFunnel().publicPageVisits).toBe(initialVisits + 1);
    });

    it('records deal card click via POST /api/v1/public/deals/:id/click', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const allDeals = engine.queryPublicDeals();
      expect(allDeals.deals.length).toBeGreaterThan(0);
      const targetDeal = allDeals.deals[0];

      const initialClicks = engine.getSevenStageFunnel().dealCardClicks;

      const res = await app.request(`/api/v1/public/deals/${targetDeal.id}/click`, {
        method: 'POST'
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.dealId).toBe(targetDeal.id);
      expect(json.data.destinationUrl).toBeDefined();

      expect(engine.getSevenStageFunnel().dealCardClicks).toBe(initialClicks + 1);
    });

    it('serves full 7-stage commercial funnel breakdown via GET /api/v1/owner/deal-engine/funnel with owner auth', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/deal-engine/funnel', {
        headers: { Authorization: `Bearer ${session.token}`, 'x-organization-id': orgId }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.discoveryImpressions).toBeDefined();
      expect(json.data.publicPageVisits).toBeDefined();
      expect(json.data.dealCardClicks).toBeDefined();
      expect(json.data.providerAttributedClicks).toBeDefined();
      expect(json.data.reportedConversions).toBeDefined();
      expect(json.data.validatedCommissionsINR).toBeDefined();
      expect(json.data.paidCommissionsINR).toBeDefined();
      expect(json.data.cashReceivedINR).toBeDefined();
      expect(json.data.stageBreakdown.DISCOVERY.unit).toBe('COUNT');
      expect(json.data.stageBreakdown.VALIDATED_COMMISSION.unit).toBe('INR');
    });

    it('rejects unauthenticated requests to GET /api/v1/owner/deal-engine/funnel with 401', async () => {
      const res = await app.request('/api/v1/owner/deal-engine/funnel');
      expect(res.status).toBe(401);
    });
  });
});
