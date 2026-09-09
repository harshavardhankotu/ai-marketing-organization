import { describe, it, expect, beforeEach } from 'vitest';
import { ClosedLoopMarketingCycle } from '../../src/workflows/closed-loop-cycle.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Closed-Loop Autonomous Marketing Cycle (E2E Integration)', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('runs complete closed loop cycle from Goal -> Research -> Strategy -> Campaign -> Content -> Telemetry -> Experiment -> Learning -> Evolved Strategy v2', async () => {
    const cycle = new ClosedLoopMarketingCycle();
    const result = await cycle.executeCompleteCycle({
      organizationId: 'org_smilekraft_01',
      businessId: 'biz_smilekraft_hyd',
      goalId: 'goal_100_leads_hyd'
    });

    expect(result.workflowId).toBeTruthy();
    expect(result.strategyId).toBeTruthy();
    expect(result.evolvedStrategyId).toBeTruthy();
    expect(result.campaignId).toBeTruthy();
    expect(result.contentAssetIds.length).toBeGreaterThan(0);
    expect(result.experimentId).toBeTruthy();

    const db = getDb();

    // 1. Verify Workflow Checkpoints
    const checkpoints = db.prepare('SELECT * FROM workflow_checkpoints WHERE workflow_id = ?').all(result.workflowId);
    expect(checkpoints.length).toBe(8); // All 8 stages checkpointed

    // 2. Verify Strategy v1 & v2 in DB
    const strategies = db.prepare('SELECT * FROM strategies WHERE business_id = ? ORDER BY version ASC').all('biz_smilekraft_hyd') as any[];
    expect(strategies.length).toBeGreaterThanOrEqual(2);
    expect(strategies[0].version).toBe(1);
    expect(strategies[1].version).toBe(2);
    expect(strategies[1].status).toBe('ACTIVE');
    expect(strategies[0].status).toBe('SUPERSEDED');

    // 3. Verify Research Findings were persisted
    const findings = db.prepare('SELECT * FROM research_findings WHERE business_id = ?').all('biz_smilekraft_hyd');
    expect(findings.length).toBeGreaterThan(0);

    // 4. Verify Content Asset was created
    const content = db.prepare('SELECT * FROM content_assets WHERE id = ?').get(result.contentAssetIds[0]) as any;
    expect(content.status).toBe('APPROVED');
    expect(content.brand_voice_score).toBeGreaterThan(0.9);

    // 5. Verify Experiment Concluded with Scaled Outcome
    const experiment = db.prepare('SELECT * FROM experiments WHERE id = ?').get(result.experimentId) as any;
    expect(experiment.status).toBe('CONCLUDED');
    expect(experiment.outcome).toBe('SCALE');

    // 6. Verify Learning was formally recorded
    const learnings = db.prepare('SELECT * FROM learnings WHERE business_id = ?').all('biz_smilekraft_hyd');
    expect(learnings.length).toBeGreaterThan(0);

    // 7. Verify Decisions recorded in Decision Journal
    const decisions = db.prepare('SELECT * FROM decisions WHERE business_id = ?').all('biz_smilekraft_hyd');
    expect(decisions.length).toBeGreaterThan(0);
  });
});