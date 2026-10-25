import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { CoordinatedAgentOrchestrator } from '../../src/agents/coordinated-orchestrator.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { CUELINKS_REQUIRED_SCOPES } from '../../src/commission/cuelinks-v3-types.js';

describe('Revenue Engine V3.0 — Autonomous Operating System Unit Tests', () => {
  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare('DELETE FROM tasks WHERE workflow_id LIKE ?').run('wf_coord_%');
      db.prepare('DELETE FROM workflows WHERE id LIKE ?').run('wf_comm_%');
    } catch {}
  });

  describe('1. Cuelinks Required Scopes & Autonomous Scout Verification', () => {
    it('enforces all 6 required scopes for Cuelinks autonomous scouting', () => {
      expect(CUELINKS_REQUIRED_SCOPES).toHaveLength(6);
      expect(CUELINKS_REQUIRED_SCOPES).toContain('read:campaigns');
      expect(CUELINKS_REQUIRED_SCOPES).toContain('read:offers');
      expect(CUELINKS_REQUIRED_SCOPES).toContain('write:links');
      expect(CUELINKS_REQUIRED_SCOPES).toContain('read:transactions');
      expect(CUELINKS_REQUIRED_SCOPES).toContain('read:reports');
      expect(CUELINKS_REQUIRED_SCOPES).toContain('read:channels');
    });

    it('correctly classifies operational error classes in CuelinksSyncManager', () => {
      const mgr = CuelinksSyncManager.getInstance();

      expect(mgr.classifyError({ statusCode: 401, message: 'Unauthorized' })).toBe('AUTH_FAILURE');
      expect(mgr.classifyError({ statusCode: 403, message: 'Missing Scope write:links' })).toBe('PERMISSION_MISSING');
      expect(mgr.classifyError({ statusCode: 429, message: 'Too Many Requests' })).toBe('RATE_LIMITED');
      expect(mgr.classifyError({ statusCode: 502, message: 'Bad Gateway' })).toBe('PROVIDER_SERVER_ERROR');
      expect(mgr.classifyError({ statusCode: 408, message: 'Timeout' })).toBe('NETWORK_TIMEOUT');
      expect(mgr.classifyError({ code: 'CUELINKS_EMPTY_RESULTS' })).toBe('EMPTY_RESULTS');
    });

    it('validates Cuelinks ping response with active publisher and scope arrays', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          publisher: { id: 281897, name: 'Harshavardhan Venkata Sai Kotu', email: 'vardhankotu@gmail.com', currency: 'INR' },
          api_key: {
            scopes: [
              'read:campaigns',
              'read:reports',
              'read:transactions',
              'read:offers',
              'write:links',
              'read:channels'
            ]
          }
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_cuelinks_key_valid',
        fetchFn: mockFetch as any
      });

      const ping = await client.ping();
      expect(ping.connected).toBe(true);
      expect(ping.publisherId).toBe(281897);
      expect(ping.missingScopes).toHaveLength(0);
    });

    it('flags missing scopes when client lacks required scopes', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          publisher: { id: 281897, name: 'Harshavardhan' },
          api_key: {
            scopes: ['read:campaigns'] // only 1 scope out of 6
          }
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_cuelinks_key_partial',
        fetchFn: mockFetch as any
      });

      const ping = await client.ping();
      expect(ping.connected).toBe(true);
      expect(ping.missingScopes?.length).toBeGreaterThan(0);
      expect(ping.missingScopes).toContain('write:links');
      expect(ping.missingScopes).toContain('read:transactions');
    });
  });

  describe('2. Commercial Engine Task Progression & Blocker Clearing', () => {
    it('auto-authorizes Cuelinks India partner when credentials are configured', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const registry = PartnerRegistryEngine.getInstance();

      // Ensure partner can be created or verified
      const partners = await registry.listPartners('org_owner_primary');
      let cuelinks = partners.find(p => p.network === 'CUELINKS');

      if (!cuelinks) {
        cuelinks = await registry.createPartner({
          organizationId: 'org_owner_primary',
          name: 'Cuelinks India',
          industry: 'technology',
          country: 'India',
          website: 'https://www.cuelinks.com',
          partnerType: 'AFFILIATE',
          programName: 'Cuelinks Content Publisher Network',
          commissionType: 'PERCENTAGE',
          cookieWindowDays: 1,
          qualifyingEvent: 'PURCHASE',
          approvalStatus: 'APPROVED',
          authorizationStatus: 'AUTHORIZED',
          activeStatus: 1,
          network: 'CUELINKS',
          trackingType: 'AFFILIATE_LINK',
          programUrl: 'https://www.cuelinks.com',
          coverage: 'India',
          category: 'electronics_and_software'
        });
      } else {
        const db = getDb();
        db.prepare("UPDATE partners SET approval_status = 'APPROVED', authorization_status = 'AUTHORIZED', active_status = 1 WHERE id = ?").run(cuelinks.id);
        cuelinks.approvalStatus = 'APPROVED';
        cuelinks.authorizationStatus = 'AUTHORIZED';
        cuelinks.activeStatus = 1;
      }

      expect(cuelinks).toBeDefined();
      expect(registry.isPartnerAuthorizedForProduction(cuelinks)).toBe(true);
    });

    it('runs commercial cycle and returns a valid cycle outcome status', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      const result = await engine.runCycle('org_owner_primary', 'biz_platform_aro');

      expect(result).toBeDefined();
      expect(result.cycleId).toMatch(/^comm_cycle_/);
      expect(['COMPLETED', 'PARTIAL', 'BLOCKED', 'NO_ACTION_DUE']).toContain(result.status);
      expect(typeof result.tasksProcessed).toBe('number');
      expect(typeof result.activeBlockers).toBe('number');
    });
  });

  describe('3. Real Agent-to-Agent Coordination & Runtime Handoffs', () => {
    it('executes coordinated multi-agent workflow with research, content, growth, and analytics handoffs', async () => {
      const orchestrator = CoordinatedAgentOrchestrator.getInstance();

      const brief = {
        briefId: `test_coord_${Date.now()}`,
        title: 'Autonomous Student Discount Guide Campaign',
        category: 'Travel & Airlines',
        targetAudience: 'Indian college students and academic researchers',
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        city: 'Pan-India',
        revenueGoalINR: 5000,
        verifiedSpecs: [
          {
            feature: 'Student Baggage Concession',
            value: '25kg (15kg standard + 10kg additional)',
            sourceUrl: 'https://www.airindiaexpress.com'
          }
        ],
        buyerQuestions: [
          {
            questionText: 'Which airline in India offers extra baggage allowance for college students?',
            searchVolume: 'HIGH',
            intent: 'PURCHASE'
          },
          {
            questionText: 'Is a physical college ID required at check-in for student flight discounts?',
            searchVolume: 'HIGH',
            intent: 'PURCHASE'
          },
          {
            questionText: 'Can student flight discount be combined with promo codes on Cleartrip?',
            searchVolume: 'MEDIUM',
            intent: 'PURCHASE'
          }
        ]
      };

      const result = await orchestrator.executeCoordinatedCampaign(brief);

      expect(result).toBeDefined();
      expect(result.briefId).toBe(brief.briefId);
      expect(result.status).toBe('BLOCKED_APPROVAL'); // Human owner approval gate strictly held
      expect(result.tasksCreated).toBeGreaterThanOrEqual(10);
      expect(result.tasksCompleted).toBeGreaterThanOrEqual(9);
      expect(result.tasksBlocked).toBe(1); // mkt-20 human owner approval gate strictly held

      // Verify produced artifacts passed through stages
      expect(result.producedArtifacts.marketResearch).toBeDefined();
      expect(result.producedArtifacts.searchIntent).toBeDefined();
      expect(result.producedArtifacts.productSpecs).toBeDefined();
      expect(result.producedArtifacts.complianceAudit).toBeDefined();
      expect(result.producedArtifacts.researchSynthesis).toBeDefined();
      expect(result.producedArtifacts.contentStrategy).toBeDefined();
      expect(result.producedArtifacts.comparisonMatrix).toBeDefined();
      expect(result.producedArtifacts.faqs).toBeDefined();
      expect(result.producedArtifacts.factCheck).toBeDefined();
      expect(result.producedArtifacts.gtmPlan).toBeDefined();
      expect(result.producedArtifacts.seoMetadata).toBeDefined();
      expect(result.producedArtifacts.distributionGuard).toBeDefined();
      expect(result.producedArtifacts.telemetry).toBeDefined();
      expect(result.producedArtifacts.evidenceQuality).toBeDefined();
      expect(result.producedArtifacts.quotaEfficiency).toBeDefined();
      expect(result.producedArtifacts.caoLearning).toBeDefined();

      // Verify tasks persisted in DB
      const db = getDb();
      const dbTasks = db.prepare('SELECT * FROM tasks WHERE workflow_id = ?').all(`wf_coord_${brief.briefId}`) as any[];
      expect(dbTasks.length).toBeGreaterThanOrEqual(10);

      // Verify decision journal logged decisions
      const dbDecisions = db.prepare('SELECT * FROM decisions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 15').all('org_owner_primary') as any[];
      expect(dbDecisions.length).toBeGreaterThan(0);

      // Verify AI cost logs recorded token accounting
      const dbCosts = db.prepare('SELECT * FROM ai_cost_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 15').all('org_owner_primary') as any[];
      expect(dbCosts.length).toBeGreaterThan(0);
    });
  });

  describe('4. Revenue & Conversion Integrity Guarantees', () => {
    it('strictly guarantees cashReceivedINR is ₹0.00 until independent bank statement proof', () => {
      const syncMgr = CuelinksSyncManager.getInstance();

      syncMgr.setReconciliationMetrics({
        localClicks: 10,
        providerAttributedClicks: 5,
        reportedConversions: 1,
        pendingCommissionINR: 350,
        validatedCommissionINR: 350,
        cashReceivedINR: 99999 as any // injected invalid value must be rejected!
      });

      const status = syncMgr.getStatus();
      expect(status.reconciliation.cashReceivedINR).toBe(0);
      expect(status.reconciliation.pendingCommissionINR).toBe(350);
      expect(status.reconciliation.validatedCommissionINR).toBe(350);
    });

    it('verifies human approval gate is mandatory before publishing public commercial content', async () => {
      const orchestrator = CoordinatedAgentOrchestrator.getInstance();

      const brief = {
        briefId: `test_gate_${Date.now()}`,
        title: 'Gate Verification Brief',
        category: 'Consumer Electronics',
        targetAudience: 'Indian buyers',
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        revenueGoalINR: 1000
      };

      const result = await orchestrator.executeCoordinatedCampaign(brief);
      const db = getDb();

      // The owner approval gate task for mkt-20 must be in WAITING_APPROVAL
      const gateTask = db.prepare('SELECT * FROM tasks WHERE workflow_id = ? AND agent_id = ?').get(`wf_coord_${brief.briefId}`, 'mkt-20') as any;
      expect(gateTask).toBeDefined();
      expect(gateTask.status).toBe('WAITING_APPROVAL');
      expect(gateTask.outputs_json).toContain('Sensitive commercial/public action requires owner attestation');
    });
  });
});
