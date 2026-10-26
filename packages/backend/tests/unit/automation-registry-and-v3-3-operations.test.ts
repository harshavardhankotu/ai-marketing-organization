import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationRegistryEngine, formatInIST, PERMITTED_CADENCES } from '../../src/automation/automation-registry-engine.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import app from '../../src/index.js';

describe('V3.3 Automation Registry & Autonomous Operations Engine', () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  it('1. Seeds exactly 15 core workflows with valid defaults, cadences and categories', async () => {
    const engine = AutomationRegistryEngine.getInstance();
    await engine.ensureInitialized();

    const workflows = await engine.listWorkflows();
    expect(workflows.length).toBe(15);

    const categories = new Set(workflows.map(w => w.category));
    expect(categories.has('RESEARCH')).toBe(true);
    expect(categories.has('SALES_PIPELINE')).toBe(true);
    expect(categories.has('COMMERCIAL')).toBe(true);
    expect(categories.has('ACCOUNTING')).toBe(true);
    expect(categories.has('SYSTEM')).toBe(true);

    // Verify all have valid permitted cadences
    for (const wf of workflows) {
      expect(PERMITTED_CADENCES).toContain(wf.cadenceMinutes);
      expect(wf.enabled).toBe(true);
      expect(wf.executionBudgetMs).toBeGreaterThan(0);
      expect(wf.maxRetries).toBe(3);
    }
  });

  it('2. Correctly formats timestamps in Asia/Kolkata (IST)', () => {
    const isoUtc = '2026-10-26T12:00:00.000Z';
    const formatted = formatInIST(isoUtc);
    expect(formatted).toContain('IST');
    // UTC 12:00 + 5:30 = 17:30 (5:30 PM)
    expect(formatted).toMatch(/5:30:00\s*(pm|PM)/i);

    expect(formatInIST(null)).toBe('Never');
    expect(formatInIST(undefined)).toBe('Never');
  });

  it('3. Supports owner toggling individual workflows and enforces permitted cadences', async () => {
    const engine = AutomationRegistryEngine.getInstance();
    await engine.ensureInitialized();

    // Toggle off
    const toggledOff = await engine.toggleWorkflow('daily_market_demand_research', false);
    expect(toggledOff.enabled).toBe(false);

    let wf = await engine.getWorkflow('daily_market_demand_research');
    expect(wf?.enabled).toBe(false);

    // Toggle on
    const toggledOn = await engine.toggleWorkflow('daily_market_demand_research', true);
    expect(toggledOn.enabled).toBe(true);

    // Update cadence to valid 60m
    const updatedCadence = await engine.setCadence('daily_market_demand_research', 60);
    expect(updatedCadence.cadenceMinutes).toBe(60);

    // Attempt invalid cadence (e.g. 45m not in PERMITTED_CADENCES)
    await expect(engine.setCadence('daily_market_demand_research', 45)).rejects.toThrow(/Invalid cadence/);
  });

  it('4. Supports global pause and resume across all 15 workflows', async () => {
    const engine = AutomationRegistryEngine.getInstance();
    await engine.ensureInitialized();

    // Global pause
    await engine.setGlobalPause(true);
    let isPaused = await engine.isGloballyPaused();
    expect(isPaused).toBe(true);

    let list = await engine.listWorkflows();
    expect(list.every(w => !w.enabled)).toBe(true);

    // Global resume
    await engine.setGlobalPause(false);
    isPaused = await engine.isGloballyPaused();
    expect(isPaused).toBe(false);

    list = await engine.listWorkflows();
    expect(list.every(w => w.enabled)).toBe(true);
  });

  it('5. Strictly preserves human gate on authorized outreach dispatch', async () => {
    const engine = AutomationRegistryEngine.getInstance();
    await engine.ensureInitialized();

    const db = getDb();
    let bizRow = db.prepare('SELECT id FROM businesses LIMIT 1').get() as any;
    if (!bizRow) {
      db.prepare(`INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at) VALUES ('org_test_01', 'Test Org', datetime('now'), datetime('now'))`).run();
      db.prepare(`INSERT OR IGNORE INTO businesses (id, organization_id, name, type, created_at, updated_at) VALUES ('biz_test_01', 'org_test_01', 'Test Dental', 'dental_clinic', datetime('now'), datetime('now'))`).run();
      bizRow = { id: 'biz_test_01' };
    }

    // Seed an unapproved draft (human_approved = 0)
    db.prepare(`
      INSERT INTO direct_outreach_log (
        id, business_id, segment, prospect_name, channel, message_draft,
        human_approved, dispatched, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, datetime('now'))
    `).run('outreach_test_unapproved', bizRow.id, 'DENTAL', 'Dr. Test Clinic', 'WHATSAPP', 'Draft message');

    // Execute authorized_outreach_dispatch
    const result = await engine.executeWorkflow('authorized_outreach_dispatch', 'MANUAL');
    expect(result.status).toBe('NO_ACTION_DUE');
    expect(result.itemsProcessed).toBe(0);

    // Verify row remains unapproved and undispatched
    const row = db.prepare('SELECT * FROM direct_outreach_log WHERE id = ?').get('outreach_test_unapproved') as any;
    expect(row.human_approved).toBe(0);
    expect(row.dispatched).toBe(0);
  });

  it('6. Executes due workflows and logs execution telemetry into automation_execution_log', async () => {
    const engine = AutomationRegistryEngine.getInstance();
    await engine.ensureInitialized();

    const dueResult = await engine.runDueWorkflows('MANUAL', 30000);
    expect(dueResult.workflowsChecked).toBeGreaterThanOrEqual(15);
    expect(dueResult.workflowsExecuted).toBeGreaterThan(0);

    const logs = await engine.getRecentLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].workflowId).toBeDefined();
    expect(logs[0].triggerSource).toBe('MANUAL');
  });

  it('7. Exposes /owner/automation dashboard and controls via HTTP endpoints', async () => {
    // GET /owner/automation HTML
    const resHtml = await app.request('/owner/automation', {
      method: 'GET',
      headers: { 'Accept': 'text/html' }
    });
    expect(resHtml.status).toBe(200);
    const htmlText = await resHtml.text();
    expect(htmlText).toContain('Autonomous Operations Control Center');
    expect(htmlText).toContain('Asia/Kolkata');
    expect(htmlText).toContain('Run Now');

    // GET /api/v1/owner/automation JSON
    const resJson = await app.request('/api/v1/owner/automation', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    expect(resJson.status).toBe(200);
    const body = await resJson.json();
    expect(body.success).toBe(true);
    expect(body.data.workflows.length).toBe(15);

    // POST /api/v1/owner/automation/toggle
    const resToggle = await app.request('/api/v1/owner/automation/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: 'quota_health_checks', enabled: false })
    });
    expect(resToggle.status).toBe(200);
    const toggleData = await resToggle.json();
    expect(toggleData.data.enabled).toBe(false);

    // POST /api/v1/owner/automation/run
    const resRun = await app.request('/api/v1/owner/automation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: 'daily_commercial_summary' })
    });
    expect(resRun.status).toBe(200);
    const runData = await resRun.json();
    expect(runData.success).toBe(true);
    expect(runData.data.status).toBe('COMPLETED');
  });

  it('8. Serves disaggregated B2B outreach counts and transparent ₹0 operating costs on /api/v1/public/revenue-funnel', async () => {
    const res = await app.request('/api/v1/public/revenue-funnel', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const b2b = json.data.b2bFunnel;
    expect(b2b).toBeDefined();
    expect(typeof b2b.prospectsResearched).toBe('number');
    expect(typeof b2b.outreachDraftsPrepared).toBe('number');
    expect(typeof b2b.ownerApprovedDrafts).toBe('number');
    expect(typeof b2b.messagesDispatched).toBe('number');
    expect(typeof b2b.providerConfirmedDeliveries).toBe('number');

    const costs = json.data.operatingCosts;
    expect(costs.totalOperatingCostINR).toBe(0.00);
    expect(costs.costClassification).toBe('STRICT_ZERO_CASH_OUTFLOW');
    expect(costs.costBreakdown.length).toBeGreaterThanOrEqual(4);
    for (const item of costs.costBreakdown) {
      expect(item.costINR).toBe(0.00);
      expect(item.classification).toBeDefined();
    }
  });
});
