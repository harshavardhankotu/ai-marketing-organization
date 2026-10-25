import { describe, it, expect, beforeEach } from 'vitest';
import { GrowthExperimentTracker } from '../../src/commission/growth-experiment-tracker.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Structured Growth Experiment Tracking Model (Spec §§ 1–15)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    GrowthExperimentTracker.getInstance().resetForTesting();
  });

  describe('1. Experiment Registration and Configuration', () => {
    it('seeds default growth experiments with hypotheses, change types, and target categories', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const experiments = tracker.listAllExperiments();

      expect(experiments.length).toBeGreaterThanOrEqual(2);

      const boatExp = tracker.getExperiment('gexp_boat_coupon_badge_v1');
      expect(boatExp).toBeDefined();
      expect(boatExp?.hypothesis).toContain('promo codes');
      expect(boatExp?.changeTested.changeType).toBe('PROMO_CODE_EXPOSURE');
      expect(boatExp?.targetCategories).toContain('Audio & Wearables');
      expect(boatExp?.status).toBe('ACTIVE');
      expect(boatExp?.automatedDecision.decision).toBe('INCONCLUSIVE');
    });

    it('creates a new structured growth experiment with full change specification', () => {
      const tracker = GrowthExperimentTracker.getInstance();

      const newExp = tracker.createExperiment({
        organizationId: orgId,
        businessId: bizId,
        title: 'Lenovo Student ID Discount Verification Badge',
        hypothesis: 'Highlighting verified student discount badge will increase laptop deal card CTR by >= 15%.',
        changeTested: {
          changeType: 'BADGE',
          description: 'Verified student discount badge on laptop card vs standard deal tag',
          baselineConfig: { badgeText: 'Deal', badgeColor: 'slate' },
          treatmentConfig: { badgeText: 'Student Verified', badgeColor: 'emerald' }
        },
        targetCategories: ['Computers & Laptops'],
        targetCampaignIds: ['src_lenovo_in'],
        targetMerchants: ['Lenovo India'],
        minimumEvidenceRequirement: 50
      });

      expect(newExp.id).toBeDefined();
      expect(newExp.status).toBe('ACTIVE');
      expect(newExp.currentCycleCount).toBe(0);
      expect(newExp.minimumEvidenceRequirement).toBe(50);
      expect(newExp.automatedDecision.decision).toBe('INCONCLUSIVE');

      const retrieved = tracker.getExperiment(newExp.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Lenovo Student ID Discount Verification Badge');
    });

    it('creates a coupon-only promo code copy experiment targeting discount voucher cards', () => {
      const tracker = GrowthExperimentTracker.getInstance();

      const couponExp = tracker.createExperiment({
        organizationId: orgId,
        businessId: bizId,
        title: 'Instant One-Click Copy Button vs Inline Code Text',
        hypothesis: 'Providing an instant copy feedback button on coupon cards will increase promo redemption CTR by >= 25%.',
        changeTested: {
          changeType: 'PROMO_CODE_EXPOSURE',
          description: 'Instant copy button on coupon voucher card vs standard static text display',
          baselineConfig: { copyButton: false, cardType: 'COUPON' },
          treatmentConfig: { copyButton: true, cardType: 'COUPON' }
        },
        targetCategories: ['Food & Dining', 'Fashion & Apparel'],
        targetCampaignIds: ['swiggy_gourmet', 'myntra_fashion'],
        targetMerchants: ['Swiggy India', 'Myntra'],
        minimumEvidenceRequirement: 60
      });

      expect(couponExp.id).toBeDefined();
      expect(couponExp.changeTested.changeType).toBe('PROMO_CODE_EXPOSURE');
      expect(couponExp.changeTested.baselineConfig.cardType).toBe('COUPON');
      expect(couponExp.status).toBe('ACTIVE');
    });
  });

  describe('2. Multi-Cycle 6-Hour Commercial Observations', () => {
    it('records 6-hour commercial cycle outcomes with strictly observed metrics', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'BoAt Urgency Badge Test',
        hypothesis: 'Urgency tag increases CTR',
        changeTested: {
          changeType: 'BADGE',
          description: 'Limited stock urgency badge',
          baselineConfig: { urgency: false },
          treatmentConfig: { urgency: true }
        },
        targetCategories: ['Audio & Wearables'],
        targetCampaignIds: ['boat_lifestyle'],
        minimumEvidenceRequirement: 40
      });

      const updated = tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_6h_001',
        cycleNumber: 1,
        durationHours: 6,
        baseline: {
          discoveryImpressions: 100,
          pageVisits: 30,
          dealClicks: 3,        // 10% CTR
          providerClicks: 3,
          conversions: 0,
          validatedCommissionINR: 0
        },
        treatment: {
          discoveryImpressions: 100,
          pageVisits: 30,
          dealClicks: 6,        // 20% CTR (+100% CTR uplift)
          providerClicks: 6,
          conversions: 1,
          validatedCommissionINR: 50
        },
        notes: 'First 6-hour commercial cycle'
      });

      expect(updated.currentCycleCount).toBe(1);
      expect(updated.cycleOutcomes.length).toBe(1);

      const cycle = updated.cycleOutcomes[0];
      expect(cycle.durationHours).toBe(6);
      expect(cycle.observedMetrics.baselineCtrPercent).toBe(10);
      expect(cycle.observedMetrics.treatmentCtrPercent).toBe(20);
      expect(cycle.observedMetrics.ctrUpliftPercent).toBe(100);
      expect(cycle.observedMetrics.treatmentEpcINR).toBeGreaterThan(0);

      // Cumulative metrics properly summed
      expect(updated.cumulativeMetrics.baselineTotalVisits).toBe(30);
      expect(updated.cumulativeMetrics.treatmentTotalVisits).toBe(30);
      expect(updated.cumulativeMetrics.baselineTotalClicks).toBe(3);
      expect(updated.cumulativeMetrics.treatmentTotalClicks).toBe(6);
    });
  });

  describe('3. Automated Decision Engine (SCALE / HALT / REFINE / INCONCLUSIVE)', () => {
    it('retains INCONCLUSIVE decision when sample size is below minimum requirement', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Low Volume Early Cycle Test',
        hypothesis: 'Testing sample threshold',
        changeTested: {
          changeType: 'COPY',
          description: 'Hero copy test',
          baselineConfig: {},
          treatmentConfig: {}
        },
        targetCategories: ['Electronics'],
        targetCampaignIds: ['src_croma_in'],
        minimumEvidenceRequirement: 100 // Requires 100 visits
      });

      // Ingest early cycle with only 20 total visits
      const updated = tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_6h_001',
        baseline: {
          discoveryImpressions: 50,
          pageVisits: 10,
          dealClicks: 1,
          providerClicks: 1,
          conversions: 0,
          validatedCommissionINR: 0
        },
        treatment: {
          discoveryImpressions: 50,
          pageVisits: 10,
          dealClicks: 2,
          providerClicks: 2,
          conversions: 0,
          validatedCommissionINR: 0
        }
      });

      expect(updated.automatedDecision.decision).toBe('INCONCLUSIVE');
      expect(updated.automatedDecision.rationale).toContain('below minimum evidence requirement');
      expect(updated.status).toBe('ACTIVE');
    });

    it('triggers SCALE decision when treatment demonstrates statistically significant positive uplift', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Statistically Significant Winner Test',
        hypothesis: 'Verified promo code pill will outperform inline text',
        changeTested: {
          changeType: 'PROMO_CODE_EXPOSURE',
          description: 'Verified promo code pill',
          baselineConfig: { pill: false },
          treatmentConfig: { pill: true }
        },
        targetCategories: ['Audio & Wearables'],
        targetCampaignIds: ['boat_lifestyle'],
        minimumEvidenceRequirement: 60
      });

      // Cycle 1: 40 visits
      tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_6h_001',
        durationHours: 6,
        baseline: {
          discoveryImpressions: 100,
          pageVisits: 20,
          dealClicks: 2,
          providerClicks: 2,
          conversions: 0,
          validatedCommissionINR: 0
        },
        treatment: {
          discoveryImpressions: 100,
          pageVisits: 20,
          dealClicks: 5,
          providerClicks: 5,
          conversions: 1,
          validatedCommissionINR: 45
        }
      });

      // Cycle 2: 40 visits (Total 80 visits >= 60 requirement, strong +150% CTR uplift, verified commission gain)
      const concluded = tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_6h_002',
        durationHours: 6,
        baseline: {
          discoveryImpressions: 100,
          pageVisits: 20,
          dealClicks: 2,
          providerClicks: 2,
          conversions: 0,
          validatedCommissionINR: 0
        },
        treatment: {
          discoveryImpressions: 100,
          pageVisits: 20,
          dealClicks: 6,
          providerClicks: 6,
          conversions: 1,
          validatedCommissionINR: 60
        }
      });

      expect(concluded.automatedDecision.decision).toBe('SCALE');
      expect(concluded.status).toBe('CONCLUDED');
      expect(concluded.concludedAt).toBeDefined();
      expect(concluded.automatedDecision.rationale).toContain('Statistically validated uplift');
      expect(concluded.automatedDecision.actionTaken).toContain('Scale treatment');
    });

    it('triggers HALT decision when treatment underperforms significantly or exhibits zero engagement', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Broken Creative Underperformance Test',
        hypothesis: 'Bad layout variant',
        changeTested: {
          changeType: 'COPY',
          description: 'Obscure copy variant',
          baselineConfig: {},
          treatmentConfig: {}
        },
        targetCategories: ['Electronics'],
        targetCampaignIds: ['src_croma_in'],
        minimumEvidenceRequirement: 50
      });

      // Treatment receives 45 visits but 0 clicks while baseline gets clicks
      const halted = tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_6h_001',
        durationHours: 6,
        baseline: {
          discoveryImpressions: 100,
          pageVisits: 45,
          dealClicks: 6,
          providerClicks: 6,
          conversions: 1,
          validatedCommissionINR: 120
        },
        treatment: {
          discoveryImpressions: 100,
          pageVisits: 45,
          dealClicks: 0, // 0 clicks over 45 visits!
          providerClicks: 0,
          conversions: 0,
          validatedCommissionINR: 0
        }
      });

      expect(halted.automatedDecision.decision).toBe('HALT');
      expect(halted.status).toBe('CONCLUDED');
      expect(halted.concludedAt).toBeDefined();
      expect(halted.automatedDecision.rationale).toContain('Zero engagement observed');
      expect(halted.automatedDecision.actionTaken).toContain('Roll back treatment');
    });

    it('triggers REFINE decision when extended cycles show no statistical differentiation', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Indifferent Neutral Test',
        hypothesis: 'Minor font tweak',
        changeTested: {
          changeType: 'COPY',
          description: 'Minor font shade tweak',
          baselineConfig: { fontShade: 'slate-300' },
          treatmentConfig: { fontShade: 'slate-200' }
        },
        targetCategories: ['Electronics'],
        targetCampaignIds: ['src_croma_in'],
        minimumEvidenceRequirement: 30
      });

      // Ingest 4 cycles with identical ~5% CTR (total samples 80 >= 30*2)
      for (let i = 1; i <= 4; i++) {
        tracker.recordCycleOutcome(exp.id, {
          cycleId: `cycle_6h_00${i}`,
          cycleNumber: i,
          durationHours: 6,
          baseline: {
            discoveryImpressions: 50,
            pageVisits: 10,
            dealClicks: 1,
            providerClicks: 1,
            conversions: 0,
            validatedCommissionINR: 0
          },
          treatment: {
            discoveryImpressions: 50,
            pageVisits: 10,
            dealClicks: 1,
            providerClicks: 1,
            conversions: 0,
            validatedCommissionINR: 0
          }
        });
      }

      const refined = tracker.getExperiment(exp.id)!;
      expect(refined.automatedDecision.decision).toBe('REFINE');
      expect(refined.status).toBe('PAUSED');
      expect(refined.automatedDecision.rationale).toContain('No distinct statistical differentiation');
      expect(refined.automatedDecision.actionTaken).toContain('Refine creative copy');
    });

    it('never triggers SCALE, REFINE, or HALT when sample traffic is zero or below minimum statistical threshold (< 30 observations)', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Tiny Sample Guardrail Test',
        hypothesis: 'Low traffic test should never make premature decisions',
        changeTested: {
          changeType: 'BADGE',
          description: 'Testing 30-observation threshold',
          baselineConfig: {},
          treatmentConfig: {}
        },
        targetCategories: ['Electronics'],
        targetCampaignIds: ['src_croma_in'],
        minimumEvidenceRequirement: 10 // Attempted tiny requirement
      });

      // 4 commercial cycles with tiny traffic (2 visits each cycle = 8 visits total < 30)
      for (let i = 1; i <= 4; i++) {
        tracker.recordCycleOutcome(exp.id, {
          cycleId: `cycle_tiny_00${i}`,
          cycleNumber: i,
          durationHours: 6,
          baseline: {
            discoveryImpressions: 10,
            pageVisits: 1,
            dealClicks: 0,
            providerClicks: 0,
            conversions: 0,
            validatedCommissionINR: 0
          },
          treatment: {
            discoveryImpressions: 10,
            pageVisits: 1,
            dealClicks: 1, // Treatment has 100% CTR uplift, but only 4 visits!
            providerClicks: 1,
            conversions: 0,
            validatedCommissionINR: 0
          }
        });
      }

      const evaluated = tracker.getExperiment(exp.id)!;
      // Must strictly remain INCONCLUSIVE and ACTIVE, never prematurely SCALE or REFINE
      expect(evaluated.automatedDecision.decision).toBe('INCONCLUSIVE');
      expect(evaluated.status).toBe('ACTIVE');
      expect(evaluated.automatedDecision.rationale).toContain('below minimum evidence requirement');
    });
  });

  describe('4. Autonomous Commercial Cycle Integration & API Endpoints', () => {
    it('advances growth experiment state during deal discovery cycle execution', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const tracker = GrowthExperimentTracker.getInstance();

      const initialActiveCount = tracker.listActiveExperiments().length;
      expect(initialActiveCount).toBeGreaterThanOrEqual(1);

      // Run 6-hour deal discovery cycle
      const cycleRes = await engine.runDiscoveryCycle(orgId, bizId);
      expect(cycleRes.cycleId).toBeDefined();

      // Metrics in deal engine observability report active growth experiments
      const metrics = engine.getDealEngineMetrics();
      expect(metrics.growthExperiments).toBeDefined();
      expect(metrics.growthExperiments?.length).toBeGreaterThanOrEqual(1);
    });

    it('serves growth experiments list via GET /api/v1/owner/growth-experiments with owner auth', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/growth-experiments', {
        headers: { Authorization: `Bearer ${session.token}`, 'x-organization-id': orgId }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(2);
    });

    it('creates growth experiment via POST /api/v1/owner/growth-experiments with owner auth', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/growth-experiments', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-organization-id': orgId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'API Created Experiment',
          hypothesis: 'API hypothesis testing',
          changeTested: {
            changeType: 'BADGE',
            description: 'API test badge',
            baselineConfig: {},
            treatmentConfig: {}
          },
          targetCategories: ['Smartphones'],
          targetCampaignIds: ['cuelinks_mobile']
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.id).toBeDefined();
      expect(json.data.title).toBe('API Created Experiment');
    });

    it('ingests 6-hour cycle outcome via POST /api/v1/owner/growth-experiments/:id/cycle', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.listActiveExperiments()[0];

      const res = await app.request(`/api/v1/owner/growth-experiments/${exp.id}/cycle`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-organization-id': orgId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cycleId: 'cycle_api_001',
          durationHours: 6,
          baseline: {
            discoveryImpressions: 50,
            pageVisits: 20,
            dealClicks: 2,
            providerClicks: 2,
            conversions: 0,
            validatedCommissionINR: 0
          },
          treatment: {
            discoveryImpressions: 50,
            pageVisits: 20,
            dealClicks: 3,
            providerClicks: 3,
            conversions: 0,
            validatedCommissionINR: 0
          }
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.currentCycleCount).toBeGreaterThanOrEqual(1);
    });

    it('rejects unauthenticated requests to growth experiment endpoints with 401', async () => {
      const resGet = await app.request('/api/v1/owner/growth-experiments');
      expect(resGet.status).toBe(401);

      const resPost = await app.request('/api/v1/owner/growth-experiments', { method: 'POST' });
      expect(resPost.status).toBe(401);
    });
  });

  describe('5. Funnel & Experiment Persistence Gate (Phase 5)', () => {
    it('hydrates persisted growth experiments from workflows table across process restarts', async () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const exp = tracker.createExperiment({
        title: 'Restart Persistence Validation Experiment',
        hypothesis: 'Experiment state survives restart via D1 hydration',
        changeTested: {
          changeType: 'PROMO_CODE_EXPOSURE',
          description: 'Cyan pill testing',
          baselineConfig: { pill: false },
          treatmentConfig: { pill: true }
        },
        targetCategories: ['Audio & Wearables'],
        targetCampaignIds: ['boat_lifestyle'],
        minimumEvidenceRequirement: 50
      });

      // Record a cycle outcome and explicitly persist
      tracker.recordCycleOutcome(exp.id, {
        cycleId: 'cycle_persist_101',
        durationHours: 6,
        baseline: {
          discoveryImpressions: 50,
          pageVisits: 20,
          dealClicks: 2,
          providerClicks: 2,
          conversions: 0,
          validatedCommissionINR: 0
        },
        treatment: {
          discoveryImpressions: 50,
          pageVisits: 20,
          dealClicks: 5,
          providerClicks: 5,
          conversions: 1,
          validatedCommissionINR: 40
        }
      });

      const beforeExp = tracker.getExperiment(exp.id)!;
      await tracker.persistExperiment(beforeExp);
      expect(beforeExp.currentCycleCount).toBe(1);
      expect(beforeExp.cycleOutcomes.length).toBe(1);

      // Simulate process restart
      GrowthExperimentTracker.resetInstance();
      const restartedTracker = GrowthExperimentTracker.getInstance();

      // Prior to hydration, the restarted tracker only has default baseline seeds
      expect(restartedTracker.getExperiment(exp.id)).toBeNull();

      // Hydrate from workflows table
      const hydratedCount = await restartedTracker.hydrateFromDb();
      expect(hydratedCount).toBeGreaterThanOrEqual(1);

      // Verify the experiment and its cycle outcomes were restored perfectly
      const restored = restartedTracker.getExperiment(exp.id);
      expect(restored).not.toBeNull();
      expect(restored?.title).toBe('Restart Persistence Validation Experiment');
      expect(restored?.currentCycleCount).toBe(1);
      expect(restored?.cycleOutcomes.length).toBe(1);
      expect(restored?.cumulativeMetrics.treatmentTotalClicks).toBe(5);
      expect(restored?.cumulativeMetrics.treatmentTotalCommissionINR).toBe(40);
    });
  });
});
