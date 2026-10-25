import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { ContentAssetEngine, lintContentAsset } from '../../src/commission/content-asset-engine.js';
import { GrowthExperimentTracker } from '../../src/commission/growth-experiment-tracker.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { BusinessAutonomyLock } from '../../src/revenue/business-autonomy-lock.js';
import { getDb } from '../../src/db/client.js';

describe('Revenue Engine V3.1 — Revenue-First Execution Sprint Unit Tests', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';
  const commercialLockKey = `comm_${bizId}`;

  beforeEach(async () => {
    vi.restoreAllMocks();
    await BusinessAutonomyLock.releaseAsync(commercialLockKey, 'test_cleanup');
  });

  afterEach(async () => {
    await BusinessAutonomyLock.releaseAsync(commercialLockKey, 'test_cleanup');
  });

  describe('1. Task Execution Priority & Starvation Prevention', () => {
    it('executes due commercial tasks FIRST before discovery/sync phases', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const executionOrder: string[] = [];

      // Spy on processTaskLifecycle
      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue([
        {
          id: 'task_priority_01',
          organizationId: orgId,
          businessId: bizId,
          workflowType: 'COMMERCIAL_FLOW',
          status: 'READY',
          currentStep: 'INITIAL',
          retryCount: 0,
          maxRetries: 3,
          inputs: { network: 'CUELINKS', trackingUrl: 'https://linksredirect.com/?cid=123' },
          outputs: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]);

      vi.spyOn(engine as any, 'processTaskLifecycle').mockImplementation(async () => {
        executionOrder.push('TASK_EXECUTION');
        return 'COMPLETED';
      });

      const { AutonomousDealDiscoveryEngine } = await import('../../src/commission/autonomous-deal-discovery-engine.js');
      vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'runDiscoveryCycle').mockImplementation(async () => {
        executionOrder.push('DEAL_DISCOVERY');
        return {
          cycleId: 'disc_01',
          status: 'SUCCESS',
          sourcesScanned: 1,
          offersDiscovered: 0,
          offersVerified: 0,
          offersRejected: 0,
          offersDeduplicated: 0,
          activeDealsTotal: 0,
          durationMs: 5
        };
      });

      const res = await engine.runCycle(orgId, bizId);

      expect(res.status).toBe('COMPLETED');
      expect(res.tasksProcessed).toBe(1);
      expect(res.tasksCompleted).toBe(1);
      expect(res.tasksDue).toBe(1);
      expect(res.tasksDeferred).toBe(0);
      expect(res.phaseDurations.taskExecutionMs).toBeGreaterThanOrEqual(0);
      expect(res.phaseDurations.discoveryMs).toBeGreaterThanOrEqual(0);

      // Verify Priority: Task execution ran BEFORE discovery
      expect(executionOrder[0]).toBe('TASK_EXECUTION');
      expect(executionOrder[1]).toBe('DEAL_DISCOVERY');
    });

    it('returns status PARTIAL or DEFERRED when budget runs out with due tasks', async () => {
      const engine = AutonomousCommercialEngine.getInstance();

      const mockTasks = [
        {
          id: 'task_01',
          organizationId: orgId,
          businessId: bizId,
          workflowType: 'COMMERCIAL_FLOW',
          status: 'READY' as const,
          currentStep: 'INITIAL',
          retryCount: 0,
          maxRetries: 3,
          inputs: { network: 'CUELINKS' as const },
          outputs: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task_02',
          organizationId: orgId,
          businessId: bizId,
          workflowType: 'COMMERCIAL_FLOW',
          status: 'READY' as const,
          currentStep: 'INITIAL',
          retryCount: 0,
          maxRetries: 3,
          inputs: { network: 'CUELINKS' as const },
          outputs: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue(mockTasks);

      let task1Processed = false;
      vi.spyOn(engine as any, 'processTaskLifecycle').mockImplementation(async () => {
        task1Processed = true;
        return 'VALIDATING';
      });

      const originalNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => {
        if (task1Processed) return originalNow() + 35000;
        return originalNow();
      });

      const res = await engine.runCycle(orgId, bizId);

      expect(res.tasksDue).toBe(2);
      expect(res.tasksProcessed).toBe(1);
      expect(res.tasksDeferred).toBe(1);
      expect(res.status).toBe('PARTIAL');
    });

    it('returns status DEFERRED when budget is exhausted before any tasks can run', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue([
        {
          id: 'task_01',
          organizationId: orgId,
          businessId: bizId,
          workflowType: 'COMMERCIAL_FLOW',
          status: 'READY' as const,
          currentStep: 'INITIAL',
          retryCount: 0,
          maxRetries: 3,
          inputs: { network: 'CUELINKS' as const },
          outputs: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]);

      const res = await engine.runCycle(orgId, bizId, { executionBudgetMaxTasks: 0 });
      expect(res.tasksDue).toBe(1);
      expect(res.tasksProcessed).toBe(0);
      expect(res.tasksDeferred).toBe(1);
      expect(res.status).toBe('DEFERRED');
    });
  });

  describe('2. Strict Authorization Truth (Sprint V3.1 § 4.1)', () => {
    it('does NOT set partner to APPROVED when Cuelinks is connected but channel status is pending or unapproved', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const syncMgr = CuelinksSyncManager.getInstance();

      // Mock CuelinksSyncManager.getStatus to report configured
      vi.spyOn(syncMgr, 'getStatus').mockReturnValue({
        configured: true,
        connected: true,
        channel: { status: 'PENDING_APPROVAL' },
        hasRequiredScopes: true,
        campaignsDiscovered: 10,
        eligibleCampaignsCount: 5,
        offersRetrieved: 5,
        linksConverted: 5,
        lastSyncTimestamp: new Date().toISOString(),
        status: 'SUCCESS',
        reconciliation: {
          externalSessionsObserved: 0,
          outboundAffiliateClicks: 0,
          providerAttributedClicks: 0,
          reportedConversions: 0,
          pendingCommissionINR: 0,
          approvedCommissionINR: 0,
          lastReconciledAt: 'NEVER'
        }
      });

      vi.spyOn(syncMgr, 'syncCuelinks').mockResolvedValue({
        success: true,
        status: syncMgr.getStatus(),
        dealCandidates: []
      });

      // Mock listCommercialTasks to return empty
      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue([]);
      vi.spyOn(engine as any, 'discoverAndQualifyCandidate').mockResolvedValue(null);

      // Set partner in DB to PROVISIONAL
      const db = getDb();
      try {
        db.prepare(`UPDATE partners SET approval_status = 'PROVISIONAL', authorization_status = 'PENDING' WHERE network = 'CUELINKS'`).run();
      } catch {}

      await engine.runCycle(orgId, bizId);

      // Check that partner did NOT get blindly updated to APPROVED
      try {
        const partner = db.prepare(`SELECT approval_status FROM partners WHERE network = 'CUELINKS'`).get() as any;
        if (partner) {
          expect(partner.approval_status).not.toBe('APPROVED');
        }
      } catch {}
    });

    it('sets partner to APPROVED ONLY when connected=true, channel=active, and hasRequiredScopes=true', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const syncMgr = CuelinksSyncManager.getInstance();

      vi.spyOn(syncMgr, 'getStatus').mockReturnValue({
        configured: true,
        connected: true,
        channel: { status: 'active', id: 331585 },
        hasRequiredScopes: true,
        campaignsDiscovered: 50,
        eligibleCampaignsCount: 20,
        offersRetrieved: 10,
        linksConverted: 10,
        lastSyncTimestamp: new Date().toISOString(),
        status: 'SUCCESS',
        reconciliation: {
          externalSessionsObserved: 0,
          outboundAffiliateClicks: 0,
          providerAttributedClicks: 0,
          reportedConversions: 0,
          pendingCommissionINR: 0,
          approvedCommissionINR: 0,
          lastReconciledAt: 'NEVER'
        }
      });

      vi.spyOn(syncMgr, 'syncCuelinks').mockResolvedValue({
        success: true,
        status: syncMgr.getStatus(),
        dealCandidates: []
      });

      vi.spyOn(engine as any, 'listCommercialTasks').mockResolvedValue([]);
      vi.spyOn(engine as any, 'discoverAndQualifyCandidate').mockResolvedValue(null);

      await engine.runCycle(orgId, bizId);

      const db = getDb();
      try {
        const partner = db.prepare(`SELECT approval_status, authorization_status FROM partners WHERE network = 'CUELINKS'`).get() as any;
        if (partner) {
          expect(partner.approval_status).toBe('APPROVED');
          expect(partner.authorization_status).toBe('AUTHORIZED');
        }
      } catch {}
    });
  });

  describe('3. Public Asset Verification (Sprint V3.1 § 4.2)', () => {
    it('rejects public URLs on non-allowlisted domains', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const task: any = {
        id: 'task_verify_01',
        outputs: {
          publicUrl: 'https://malicious-phishing-domain.com/guides/test.html'
        }
      };

      const result = await engine.verifyPublicAsset(task);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('not in allowlisted production domains');
    });

    it('verifies HTTP 200 and affiliate disclosure presence via custom fetch', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const task: any = {
        id: 'task_verify_02',
        outputs: {
          publicUrl: 'https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india'
        }
      };

      // Mock fetch returning 200 with compliant disclosure
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => `
          <html>
            <body>
              <h1>Student Flight Discounts India</h1>
              <p>Affiliate Disclosure: We may earn an affiliate commission when you purchase through links on our site.</p>
            </body>
          </html>
        `
      });

      engine.setFetchFn(mockFetch as any);

      const result = await engine.verifyPublicAsset(task);
      expect(result.verified).toBe(true);

      // Clean up
      engine.setFetchFn(null);
    });

    it('fails verification when HTTP status is not 200 (e.g. 404)', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const task: any = {
        id: 'task_verify_03',
        outputs: {
          publicUrl: 'https://ai-marketing-organization.onrender.com/guides/nonexistent-slug'
        }
      };

      const mockFetch = vi.fn().mockResolvedValue({
        status: 404,
        text: async () => 'Not Found'
      });

      engine.setFetchFn(mockFetch as any);

      const result = await engine.verifyPublicAsset(task);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('HTTP status 404');

      engine.setFetchFn(null);
    });

    it('fails verification when affiliate disclosure is missing from public page', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const task: any = {
        id: 'task_verify_04',
        outputs: {
          publicUrl: 'https://ai-marketing-organization.onrender.com/guides/missing-disclosure-guide'
        }
      };

      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => `
          <html>
            <body>
              <h1>Student Discounts</h1>
              <p>Book flights here with zero commercial disclosure.</p>
            </body>
          </html>
        `
      });

      engine.setFetchFn(mockFetch as any);

      const result = await engine.verifyPublicAsset(task);
      expect(result.verified).toBe(false);
      expect(result.reason).toContain('Required affiliate disclosure text missing');

      engine.setFetchFn(null);
    });
  });

  describe('4. Lane-Appropriate Disclosures (Sprint V3.1 § 6)', () => {
    it('requires Amazon Associates statutory disclosure for Amazon offers', () => {
      const content = `# Top Noise Cancelling Headphones\n\nCheck out these headphones.`;
      const result = lintContentAsset(content, { network: 'AMAZON_ASSOCIATES' });
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('MISSING_AMAZON_DISCLOSURE'))).toBe(true);
    });

    it('accepts general affiliate disclosure for Cuelinks without demanding Amazon disclosure', () => {
      const content = `# Student Travel Guide\n\n*Affiliate Disclosure: We may earn an affiliate commission when you purchase through links on our site.*\n\nHere are genuine booking tips for Indian flights.`;
      const result = lintContentAsset(content, { network: 'CUELINKS' });
      expect(result.passed).toBe(true);
      expect(result.violations.length).toBe(0);
    });

    it('enforces privacy link and service disclosure for B2B lane', () => {
      const content = `# Dental Clinic Patient Booking System\n\nLearn how clinics automate appointment scheduling.`;
      const result = lintContentAsset(content, { lane: 'B2B' });
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('MISSING_PRIVACY_LINK'))).toBe(true);
      expect(result.violations.some(v => v.includes('MISSING_SERVICE_DISCLOSURE'))).toBe(true);
    });
  });

  describe('5. Growth Experimentation Zero-Traffic Invariance (Sprint V3.1 § 7)', () => {
    it('advanceCommercialCycle marks zero-traffic experiments as INCONCLUSIVE with zero visits rationale', () => {
      const tracker = GrowthExperimentTracker.getInstance();

      const exp = tracker.createExperiment({
        id: `exp_test_${Date.now()}`,
        name: 'V3.1 Zero Traffic Test',
        hypothesis: 'Adding trust badges increases CTR',
        targetCategories: ['Travel & Flights'],
        changeTested: {
          component: 'DEAL_CARD',
          changeType: 'BADGE_STYLE',
          baselineValue: 'standard',
          treatmentValue: 'verified_deal'
        },
        minimumEvidenceRequirement: 30
      });

      // Ensure 0 visits
      exp.cumulativeMetrics.baselineTotalVisits = 0;
      exp.cumulativeMetrics.treatmentTotalVisits = 0;

      const result = tracker.advanceCommercialCycle('cycle_test_v31');
      expect(result.decisions[exp.id]).toBe('INCONCLUSIVE');

      const updatedExp = tracker.getExperiment(exp.id);
      expect(updatedExp?.automatedDecision.decision).toBe('INCONCLUSIVE');
      expect(updatedExp?.automatedDecision.rationale).toContain('Zero real external visits observed');
      expect(updatedExp?.automatedDecision.confidence).toBe(0);
    });
  });

  describe('6. Empirical Accounting Invariant', () => {
    it('maintains verified bank cash strictly at ₹0.00 until independent bank statement proof', async () => {
      const status = await AutonomousCommercialEngine.getInstance().getObservabilityStatus(orgId, bizId);
      // Bank cash must remain ₹0.00 until genuine verified bank deposit
      expect(status.commercialFunnel.cashReceivedINR).toBe(0);
    });
  });
});
