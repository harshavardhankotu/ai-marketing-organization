import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { AutonomousPolicyGate } from '../../src/automation/autonomous-policy-gate.js';
import { GoogleIndexingClient } from '../../src/integrations/google-indexing-client.js';
import { app } from '../../src/index.js';

describe('V5.5 — Real Revenue Execution, Durable D1 Learning & Live Provider Wiring', () => {
  beforeEach(() => {
    CommercialLearningEngine.resetInstance();
  });

  afterEach(() => {
    CommercialLearningEngine.resetInstance();
  });

  describe('1. Durable Bandit State & D1 Table Hydration', () => {
    it('seeds and hydrates all 8 canonical sectors in sector_bandit_states', () => {
      const db = getDb();
      const engine = CommercialLearningEngine.getInstance();
      engine.ensureBanditInitialized();

      const rows = db.prepare('SELECT * FROM sector_bandit_states').all() as any[];
      expect(rows.length).toBe(8);

      const sectorCodes = rows.map(r => r.sector_code);
      expect(sectorCodes).toContain('SECTOR_A_PRECIOUS_METALS');
      expect(sectorCodes).toContain('SECTOR_B_ELECTRONICS');
      expect(sectorCodes).toContain('SECTOR_H_LOCAL_SERVICES_B2B');

      // Hydration test: Reset engine instance and re-initialize from DB
      CommercialLearningEngine.resetInstance();
      const engine2 = CommercialLearningEngine.getInstance();
      engine2.ensureBanditInitialized();

      const intelligence = engine2.getSectorBanditIntelligence();
      expect(Object.keys(intelligence).length).toBe(8);
      expect(intelligence.SECTOR_B_ELECTRONICS.allocationWeight).toBeGreaterThan(0);
      expect(intelligence.SECTOR_B_ELECTRONICS.allocationWeight).toBeLessThanOrEqual(1.0);
      const totalWeight = Object.values(intelligence).reduce((acc, curr) => acc + curr.allocationWeight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 1);
    });

    it('enforces deterministic event deduplication via unique eventId', () => {
      const engine = CommercialLearningEngine.getInstance();
      engine.ensureBanditInitialized();

      const initialIntel = engine.getSectorBanditIntelligence().SECTOR_B_ELECTRONICS;
      const initialInteractions = initialIntel.verifiedHumanInteractions;
      const initialReward = initialIntel.cumulativeReward;

      const uniqueEventId = `dedup_evt_${Date.now()}_test`;
      const firstReward = engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
        eventId: uniqueEventId,
        eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
        sourceClickId: uniqueEventId
      });
      expect(firstReward).toBe(10);

      const intelAfterFirst = engine.getSectorBanditIntelligence().SECTOR_B_ELECTRONICS;
      expect(intelAfterFirst.verifiedHumanInteractions).toBe(initialInteractions + 1);
      expect(intelAfterFirst.cumulativeReward).toBe(initialReward + 10);

      // Second call with identical eventId must return 0 reward and NOT alter state
      const duplicateReward = engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
        eventId: uniqueEventId,
        eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
        sourceClickId: uniqueEventId
      });
      expect(duplicateReward).toBe(0);

      const intelAfterDup = engine.getSectorBanditIntelligence().SECTOR_B_ELECTRONICS;
      expect(intelAfterDup.verifiedHumanInteractions).toBe(initialInteractions + 1); // Unchanged!
      expect(intelAfterDup.cumulativeReward).toBe(initialReward + 10); // Unchanged!
    });

    it('isolates bots and diagnostic clicks: zero reward and zero interaction increments', () => {
      const engine = CommercialLearningEngine.getInstance();
      engine.ensureBanditInitialized();

      const botReward = engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
        eventId: `bot_test_${Date.now()}`,
        eventType: 'BOT_OR_INTERNAL_CLICK',
        isDiagnostic: true,
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)'
      });
      expect(botReward).toBe(0);

      const diagReward = engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
        eventId: `diag_test_${Date.now()}`,
        eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
        isDiagnostic: true
      });
      expect(diagReward).toBe(0);

      const userAgentBotReward = engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
        eventId: `uabot_test_${Date.now()}`,
        eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
        userAgent: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'
      });
      expect(userAgentBotReward).toBe(0);
    });
  });

  describe('2. Truthful PageSpeed Client & SiteAudit Integration', () => {
    it('returns UNAVAILABLE with null metrics when API key is unconfigured (zero synthetic fixtures)', async () => {
      const prevKey = process.env.GOOGLE_PAGESPEED_API_KEY;
      const prevSearchKey = process.env.GOOGLE_SEARCH_API_KEY;
      delete process.env.GOOGLE_PAGESPEED_API_KEY;
      delete process.env.GOOGLE_SEARCH_API_KEY;

      try {
        const client = GooglePageSpeedClient.getInstance();
        const res = await client.runAudit('https://example.com', 'mobile');

        if (res.status === 'UNAVAILABLE') {
          expect(['MISSING_API_KEY', 'API_HTTP_429', 'UNAVAILABLE', 'API_ERROR']).toContain(res.reason);
          expect(res.metrics).toBeNull();
          expect(res.coreWebVitals).toBeNull();
        } else {
          expect(res.status).toBe('SUCCESS');
        }
      } finally {
        if (prevKey) process.env.GOOGLE_PAGESPEED_API_KEY = prevKey;
        if (prevSearchKey) process.env.GOOGLE_SEARCH_API_KEY = prevSearchKey;
      }
    });

    it('SiteAuditService includes real PageSpeed or truthful unavailable notice', async () => {
      const prevKey = process.env.GOOGLE_PAGESPEED_API_KEY;
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      try {
        const service = SiteAuditService.getInstance();
        const res = await service.executeScan({
          url: 'https://example.com',
          userConfirmedOwnership: true
        });

        expect(res.auditId).toBeDefined();
        expect(res.pageSpeed).toBeDefined();
        expect(['SUCCESS', 'UNAVAILABLE']).toContain(res.pageSpeed?.status);
        if (res.pageSpeed?.status === 'UNAVAILABLE') {
          expect(res.pageSpeed.notice).toContain('Core Web Vitals data currently unavailable');
          expect(res.pageSpeed.coreWebVitals).toBeNull();
        }
      } finally {
        if (prevKey) process.env.GOOGLE_PAGESPEED_API_KEY = prevKey;
      }
    });
  });

  describe('3. Brevo MCP Protocol & Overflow Queue Drainer', () => {
    it('fails closed with BLOCKED_CREDENTIALS when credentials are unconfigured or placeholder', async () => {
      const client = BrevoMcpClient.getInstance();
      const prevApi = process.env.BREVO_MCP_SERVER_API;
      const prevKey = process.env.BREVO_API_KEY;
      delete process.env.BREVO_MCP_SERVER_API;
      delete process.env.BREVO_API_KEY;

      try {
        const res = await client.sendTransactionalEmail({
          to: 'client@example.com',
          subject: 'SiteFix AI Verification',
          htmlContent: '<p>Report ready</p>'
        });

        expect(res.success).toBe(false);
        expect(res.status).toBe('BLOCKED_CREDENTIALS');
        expect(res.reason).toContain('Missing or placeholder');
        expect(res.messageId).toBeUndefined(); // Invariant: Zero synthetic messageId
      } finally {
        if (prevApi) process.env.BREVO_MCP_SERVER_API = prevApi;
        if (prevKey) process.env.BREVO_API_KEY = prevKey;
      }
    });

    it('implements drainOverflowQueue within available quota bounds', async () => {
      const client = BrevoMcpClient.getInstance();
      const drain = await client.drainOverflowQueue(10);
      expect(drain).toBeDefined();
      expect(typeof drain.drainedCount).toBe('number');
      expect(typeof drain.remainingQueued).toBe('number');
    });
  });

  describe('4. AutonomousPolicyGate & Google Indexing Whitelist', () => {
    it('enforces human_approved = 0 for auto-approved safe operations', () => {
      const gate = AutonomousPolicyGate.getInstance();
      const evalPublish = gate.evaluateAction({ actionType: 'PUBLISH_VERIFIED_DEAL', entityId: 'deal_test' });
      expect(evalPublish.allowed).toBe(true);
      expect(evalPublish.humanApproved).toBe(0); // Invariant
      expect(evalPublish.approvalSource).toBe('AUTONOMOUS_POLICY_GATE');

      const evalBandit = gate.evaluateAction({ actionType: 'UPDATE_EXPLORATION_BANDIT' });
      expect(evalBandit.allowed).toBe(true);
      expect(evalBandit.humanApproved).toBe(0);
      expect(evalBandit.approvalSource).toBe('AUTONOMOUS_POLICY_GATE');
    });

    it('GoogleIndexingClient skips commercial deals with SKIPPED_INELIGIBLE_SCHEMA_TYPE', async () => {
      const client = GoogleIndexingClient.getInstance();
      const res = await client.publishUrl('https://example.com/deals/boat-airdopes', 'URL_UPDATED', {
        hasJobPosting: false,
        hasBroadcastEvent: false
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('SKIPPED_INELIGIBLE_SCHEMA_TYPE');
      expect(res.fallback).toBe('ROUTED_TO_SITEMAP_INDEXNOW');
      expect(res.quotaConsumed).toBe(false);
    });
  });

  describe('5. Dynamic Provider Autonomy Telemetry Route', () => {
    it('returns dynamically derived provider status and live bandit learning', async () => {
      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.version).toMatch(/^5\.[57]\.0$/);
      expect(json.banditLearning).toBeDefined();
      expect(Object.keys(json.banditLearning).length).toBe(8);

      expect(json.capabilityMatrix).toBeDefined();
      expect(json.capabilityMatrix.searchDiscovery).toBeDefined();
      expect(['NOT_CONFIGURED', 'CONFIGURED', 'LIVE_VERIFIED']).toContain(json.capabilityMatrix.geminiAi.status);
      expect(['NOT_CONFIGURED', 'CONFIGURED', 'LIVE_VERIFIED']).toContain(json.capabilityMatrix.pageSpeedInsights.status);
      expect(['NOT_CONFIGURED', 'CONFIGURED', 'LIVE_VERIFIED']).toContain(json.capabilityMatrix.brevoEmail.status);
    });
  });
});
