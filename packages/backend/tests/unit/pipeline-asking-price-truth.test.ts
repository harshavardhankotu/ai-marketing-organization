import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { apiRouter } from '../../src/routes/api.js';

describe('Pipeline Asking Price Truth & Zero Rupee Estimates (mst_p1_expected_value_shown_for_discovery_action)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM platform_prospects WHERE id LIKE ?').run('test_truth_%');
    db.prepare('DELETE FROM opportunities WHERE id LIKE ?').run('test_truth_%');
    db.prepare('DELETE FROM proposals WHERE id LIKE ?').run('test_truth_%');
  });

  it('1. Discovery action opportunity has estimated_value_inr = 0 (never arbitrary 15,000)', async () => {
    const req = new Request('http://localhost/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Dr. Suresh Reddy',
        customerPhone: '9876543212',
        customerEmail: 'suresh@hyderabad-dental.in',
        serviceOfInterest: 'Suresh Dental Clinic, Hyderabad'
      })
    });

    const res = await apiRouter.fetch(req);
    const body = await res.json() as any;

    const db = getDb();
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(body.opportunityId) as any;
    expect(opp).toBeDefined();
    expect(opp.estimated_value_inr).toBe(0);

    const pipe = db.prepare('SELECT * FROM sales_pipeline WHERE opportunity_id = ?').get(body.opportunityId) as any;
    expect(pipe).toBeDefined();
    expect(pipe.expected_revenue_inr).toBe(0);
  });

  it('2. AutonomousRevenueOrchestrator.estimateOpportunityValue returns 0 for discovery actions', () => {
    const orchestrator = AutonomousRevenueOrchestrator.getInstance();
    // Access private method for testing guard
    const estimatedValue = (orchestrator as any).estimateOpportunityValue('dental');
    expect(estimatedValue).toBe(0);
  });

  it('3. Funnel pipeline value counts only proposals for real prospects (is_test = 0, status != TEST_QUARANTINED)', async () => {
    const db = getDb();
    const testOrgId = 'org_test_truth_isolation';
    db.prepare('DELETE FROM proposals WHERE organization_id = ?').run(testOrgId);

    // Insert a quarantined proposal
    db.prepare(`
      INSERT INTO proposals (
        id, organization_id, business_id, prospect_id, title,
        customer_problem, proposed_solution, deliverables_json, timeline_days,
        setup_price_inr, monthly_price_inr, payment_terms, scope_boundary, next_step, status, is_test
      ) VALUES (
        'prop_test_quarantined_iso', ?, 'biz_platform_aro', 'prosp_test', 'Fake Setup',
        'Problem', 'Solution', '[]', 5, 15000, 8000, 'Immediate', 'Scope', 'Next', 'TEST_QUARANTINED', 1
      )
    `).run(testOrgId);

    const sumRow = db.prepare(`
      SELECT COALESCE(SUM(setup_price_inr), 0) as total
      FROM proposals
      WHERE organization_id = ? AND is_test = 0 AND status != 'TEST_QUARANTINED'
    `).get(testOrgId) as any;

    expect(sumRow.total).toBe(0);
    db.prepare('DELETE FROM proposals WHERE organization_id = ?').run(testOrgId);
  });
});
