import { describe, it, expect, beforeEach } from 'vitest';
import { ClosedLoopMarketingCycle } from '../../src/workflows/closed-loop-cycle.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Closed-Loop Autonomous Marketing Cycle (E2E Integration)', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('runs complete closed loop cycle from Goal → Research → Strategy → Campaign → Content → Experiment (DRAFT) → Learning Checkpoint', async () => {
    const cycle = new ClosedLoopMarketingCycle();
    const result = await cycle.executeCompleteCycle({
      organizationId: 'org_smilekraft_01',
      businessId: 'biz_smilekraft_hyd',
      goalId: 'goal_100_leads_hyd'
    });

    // Core workflow identifiers must be present
    expect(result.workflowId).toBeTruthy();
    expect(result.strategyId).toBeTruthy();
    expect(result.campaignId).toBeTruthy();
    expect(result.contentAssetIds.length).toBeGreaterThan(0);
    expect(result.experimentId).toBeTruthy();
    expect(result.learningId).toBeTruthy();

    // evolvedStrategyId is intentionally undefined — evolution requires real evidence
    // (previously this was set by synthetic hardcoded data, which violated the spec)
    expect(result.evolvedStrategyId).toBeUndefined();

    const db = getDb();

    // 1. Verify Workflow Checkpoints — now 7 stages (TELEMETRY removed, LEARNING_CHECKPOINT added)
    const checkpoints = db.prepare('SELECT * FROM workflow_checkpoints WHERE workflow_id = ?').all(result.workflowId);
    expect(checkpoints.length).toBe(7); // RESEARCH, STRATEGY, CAMPAIGN, CONTENT, PUBLICATION, EXPERIMENT, LEARNING_CHECKPOINT

    // 2. Verify Strategy v1 in DB (v2 requires real experiment data — no longer synthetic)
    const strategies = db.prepare('SELECT * FROM strategies WHERE business_id = ? ORDER BY version ASC').all('biz_smilekraft_hyd') as any[];
    expect(strategies.length).toBeGreaterThanOrEqual(1);
    expect(strategies[0].version).toBe(1);

    // 3. Verify Research Findings (may be empty if no Tavily key — that is correct behavior)
    const findings = db.prepare('SELECT * FROM research_findings WHERE business_id = ?').all('biz_smilekraft_hyd');
    // We do NOT assert findings.length > 0 — empty findings is honest when no API key is present
    expect(Array.isArray(findings)).toBe(true);

    // 4. Verify Content Asset was created
    const content = db.prepare('SELECT * FROM content_assets WHERE id = ?').get(result.contentAssetIds[0]) as any;
    expect(content.status).toBe('APPROVED');
    expect(content.brand_voice_score).toBeGreaterThan(0.9);

    // 5. Verify Experiment is in DRAFT state (not CONCLUDED — requires real traffic data)
    const experiment = db.prepare('SELECT * FROM experiments WHERE id = ?').get(result.experimentId) as any;
    // Experiment may be in RUNNING or DRAFT state — it should NOT be CONCLUDED yet
    expect(experiment.status).not.toBe('CONCLUDED'); // No real data yet

    // 6. Verify no synthetic telemetry events were injected
    // (previously fake impressions/clicks/qualified_leads were injected — now prohibited)
    const syntheticEvents = db.prepare(`
      SELECT COUNT(*) as cnt FROM analytics_events
      WHERE campaign_id = ? AND event_type IN ('impression', 'click', 'qualified_lead')
    `).get(result.campaignId) as any;
    // Should be 0 — no fake telemetry should have been injected
    expect(syntheticEvents?.cnt || 0).toBe(0);
  });
});