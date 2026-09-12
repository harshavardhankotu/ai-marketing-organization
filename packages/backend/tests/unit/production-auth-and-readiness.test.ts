import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { GeminiProvider } from '../../src/ai/gemini-provider.js';
import { LearningManager } from '../../src/control-plane/learning-manager.js';
import { SystemReadinessEngine } from '../../src/control-plane/system-readiness.js';

describe('Production Authentication, Learning Isolation & Truth Integrity', () => {
  const originalEnv = { ...process.env };
  const orgId = 'org_smilekraft_01';
  const businessId = 'biz_smilekraft_hyd';
  const goalId = 'goal_100_leads_hyd';

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbForTesting();
    seedDatabase();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Production Authentication Boundary (Requirement 8)', () => {
    it('rejects unauthenticated requests in production even with spoofed x-user-id header', async () => {
      process.env.NODE_ENV = 'production';

      // Attacker attempts to spoof being usr_owner_01 via header
      const res = await app.request('/api/v1/business', {
        headers: {
          'x-user-id': 'usr_owner_01',
          'x-organization-id': orgId,
        }
      });

      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/In production, an authenticated principal is required/i);
    });

    it('rejects invalid Bearer tokens in production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': 'Bearer invalid_or_forged_token_12345',
          'x-organization-id': orgId,
        }
      });

      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.error).toMatch(/Invalid authentication credentials/i);
    });

    it('authenticates valid owner token in production', async () => {
      process.env.NODE_ENV = 'production';

      // Seeded owner user has api_token: secret_token_owner_smilekraft_2026
      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': 'Bearer secret_token_owner_smilekraft_2026',
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.id).toBe(businessId);
    });

    it('allows public endpoints like /health and /public/lead without authentication in production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/health');
      expect(res.status).toBe(200);

      const leadRes = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Public Patient',
          customerPhone: '+91 98480 22338',
          customerEmail: 'public.patient@smilekraft.org',
          channel: 'WHATSAPP'
        })
      });
      expect(leadRes.status).toBe(201);
    });

    it('allows explicit test identity headers in development and test environments', async () => {
      process.env.NODE_ENV = 'test';

      const res = await app.request('/api/v1/business', {
        headers: {
          'x-user-id': 'usr_owner_01',
          'x-organization-id': orgId,
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
    });
  });

  describe('2. Learning Isolation: TEST vs REAL Strategy Evolution (Requirement 12)', () => {
    it('TEST_LEARNING creates isolated candidate without superseding active production strategy', () => {
      const db = getDb();

      // Check current active baseline strategy
      const baseline = db.prepare("SELECT * FROM strategies WHERE business_id = ? AND status = 'ACTIVE'").get(businessId) as any;
      expect(baseline).toBeDefined();
      expect(baseline.version).toBe(1);

      // Evolve via TEST_LEARNING
      const evolved = LearningManager.evolveStrategy(
        orgId,
        businessId,
        goalId,
        'Sandbox test hypothesis evaluation',
        [{ channel: 'WHATSAPP', allocation: 60 }],
        ['Test Theme'],
        'TEST_LEARNING'
      );

      expect(evolved.dataClassification).toBe('TEST_LEARNING');
      expect(evolved.status).toBe('TEST');
      expect(evolved.newVersion).toBe(2);

      // Baseline MUST STILL REMAIN ACTIVE
      const activeStrategy = db.prepare("SELECT * FROM strategies WHERE business_id = ? AND status = 'ACTIVE'").get(businessId) as any;
      expect(activeStrategy.id).toBe(baseline.id);
      expect(activeStrategy.version).toBe(1);

      // The new version exists only as TEST
      const testStrategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(evolved.strategyId) as any;
      expect(testStrategy.status).toBe('TEST');
      expect(testStrategy.title).toMatch(/\[SANDBOX TEST\]/);
    });

    it('REAL_WORLD_LEARNING mutates active production strategy and supersedes previous version', () => {
      const db = getDb();

      const evolved = LearningManager.evolveStrategy(
        orgId,
        businessId,
        goalId,
        'Proven business uplift from verified in-clinic collections',
        [{ channel: 'WHATSAPP', allocation: 50 }],
        ['Painless 3D Aligners'],
        'REAL_WORLD_LEARNING'
      );

      expect(evolved.dataClassification).toBe('REAL_WORLD_LEARNING');
      expect(evolved.status).toBe('ACTIVE');

      // Previous version is now SUPERSEDED
      const prevStrategy = db.prepare('SELECT * FROM strategies WHERE version = 1 AND business_id = ?').get(businessId) as any;
      expect(prevStrategy.status).toBe('SUPERSEDED');

      // New version is ACTIVE
      const newActive = db.prepare("SELECT * FROM strategies WHERE business_id = ? AND status = 'ACTIVE'").get(businessId) as any;
      expect(newActive.id).toBe(evolved.strategyId);
      expect(newActive.version).toBe(2);
    });
  });

  describe('3. Model Provider Telemetry & Zero-Deception Evidence (Requirements 2, 3, 6)', () => {
    it('deterministic fallback outputs zero token counts, unknown usage status, and no fabricated claims', async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.NODE_ENV = 'test';

      const provider = new GeminiProvider();
      const res = await provider.generateStructured<any>({
        agentId: 'res-01',
        systemInstruction: 'Analyze patient trends',
        prompt: 'Synthesize dental inquiry trends in Hyderabad tech corridors',
        skipCache: true
      });

      expect(res.executionType).toBe('DETERMINISTIC');
      expect(res.tokenCount).toBe(0);
      expect(res.tokenUsageStatus).toBe('UNKNOWN');
      expect(res.telemetry.totalTokens).toBe(0);
      expect(res.telemetry.executionType).toBe('DETERMINISTIC');

      // Evidence MUST NOT contain fabricated claims (e.g. 3,800 queries, +44% YoY, p=0.021)
      const findings = res.data.findings;
      expect(findings).toBeDefined();
      expect(findings[0].evidence).toBe('NO_REAL_WORLD_EVIDENCE');
      expect(findings[0].source).toBe('DETERMINISTIC_TEST_FIXTURE');
      expect(findings[0].sourceType).toBe('TEST_DATA');
      expect(findings[0].dataClassification).toBe('TEST_DATA');
    });

    it('experiment deterministic fallback contains no fake p-values or fake percentages', async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.NODE_ENV = 'test';

      const provider = new GeminiProvider();
      const res = await provider.generateStructured<any>({
        agentId: 'anl-13',
        systemInstruction: 'Evaluate A/B test',
        prompt: 'Evaluate WhatsApp headline experiment',
        skipCache: true
      });

      expect(res.executionType).toBe('DETERMINISTIC');
      expect(res.data.pValue).toBeNull(); // ZERO fake p-value
      expect(res.data.statisticallySignificant).toBe(false);
      expect(res.data.decisionSummary).toMatch(/NO_REAL_WORLD_EVIDENCE/);
    });
  });

  describe('4. Operational Readiness: READY_FOR_REAL_EXPERIMENT (Requirement 16)', () => {
    it('evaluates and passes all 12 operational criteria for real revenue experiment', () => {
      const report = SystemReadinessEngine.evaluateReadiness(businessId);
      expect(report.status).toBe('READY_FOR_REAL_EXPERIMENT');
      expect(report.passedChecks).toBe(report.totalChecks);
      expect(report.checks.length).toBe(12);

      const checkIds = report.checks.map(c => c.id);
      expect(checkIds).toContain('landing_page_active');
      expect(checkIds).toContain('tracking_active');
      expect(checkIds).toContain('campaign_ids_persistent');
      expect(checkIds).toContain('lead_capture_functional');
      expect(checkIds).toContain('customer_journey_isolated');
      expect(checkIds).toContain('payment_verification_configured');
      expect(checkIds).toContain('attribution_engine_verified');
      expect(checkIds).toContain('real_test_isolation_enforced');
      expect(checkIds).toContain('production_authentication_enforced');
      expect(checkIds).toContain('deployment_configured');
      expect(checkIds).toContain('no_fake_research_enforced');
      expect(checkIds).toContain('no_fake_revenue_enforced');
    });

    it('GET /api/v1/system/readiness endpoint exposes readiness report', async () => {
      const res = await app.request('/api/v1/system/readiness');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('READY_FOR_REAL_EXPERIMENT');
      expect(json.data.passedChecks).toBe(12);
    });
  });
});