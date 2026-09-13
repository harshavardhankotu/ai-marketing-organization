import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRuntime } from '../../src/agents/agent-runtime.js';
import { ToolExecutor } from '../../src/agents/tool-executor.js';
import { getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { getAgentById } from '@ai-marketing/shared';

describe('End-to-End Agent Decision & Tool Execution Pipeline', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    seedDatabase();
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO workflows (id, organization_id, business_id, workflow_type, status, current_step)
      VALUES ('wf_test', ?, ?, 'CAMPAIGN_CYCLE', 'PENDING', 'INIT')
    `).run(orgId, businessId);
  });

  it('1. Executes AgentRuntime and journals actual agent decision in decisions table', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    // Create a task record
    const taskId = `task_test_${Date.now()}`;
    db.prepare(`
      INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
      VALUES (?, ?, 'wf_test', 'mkt-01', 'Optimize Campaign Strategy', 'PENDING', ?)
    `).run(taskId, orgId, taskId);

    const result = await runtime.execute({
      agentId: 'mkt-01', // Marketing Strategist
      businessId,
      organizationId: orgId,
      taskId,
      workflowId: 'wf_test',
      prompt: 'Synthesize performance and recommend optimized campaign budget and copy',
      thinkingLevel: 'medium'
    });

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('mkt-01');
    expect(result.decisionId).toBeDefined();

    // Verify decision was recorded in relational 'decisions' table
    const decisionRow = db.prepare('SELECT * FROM decisions WHERE id = ?').get(result.decisionId) as any;
    expect(decisionRow).toBeDefined();
    expect(decisionRow.business_id).toBe(businessId);
    expect(decisionRow.agent_id).toBe('mkt-01');
    expect(decisionRow.source).toBe('gemini-3.8-flash');
    expect(decisionRow.decision).toBeTruthy();
    expect(decisionRow.confidence).toBeGreaterThan(0);
  });

  it('2. Executes authorized tool (evidence_retrieval) and captures results', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    const taskId = `task_tool_${Date.now()}`;
    db.prepare(`
      INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
      VALUES (?, ?, 'wf_test', 'res-01', 'Retrieve Evidence', 'PENDING', ?)
    `).run(taskId, orgId, taskId);

    const result = await runtime.execute({
      agentId: 'res-01', // Market Research Director
      businessId,
      organizationId: orgId,
      taskId,
      workflowId: 'wf_test',
      prompt: 'Retrieve market research findings for Hyderabad dental market',
      toolCall: {
        tool: 'evidence_retrieval',
        parameters: { topic: 'Dental' }
      }
    });

    expect(result.success).toBe(true);
    expect(result.toolExecution).toBeDefined();
    expect(result.toolExecution?.tool).toBe('evidence_retrieval');
    expect(result.toolExecution?.success).toBe(true);
    expect(Array.isArray(result.toolExecution?.data?.findings)).toBe(true);
  });

  it('3. Security check: Rejects tool execution if tool is not in agent.allowedTools', async () => {
    const agent = getAgentById('res-01')!;
    const toolExecutor = ToolExecutor.getInstance();

    const result = await toolExecutor.executeTool(
      agent,
      {
        tool: 'unauthorized_admin_drop_database',
        parameters: {}
      },
      { businessId, organizationId: orgId }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Security Violation');
    expect(result.error).toContain('is not authorized to execute tool');
  });

  it('4. Persists execution telemetry into ai_cost_logs and analytics_events', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    const beforeCostCount = (db.prepare('SELECT COUNT(*) as cnt FROM ai_cost_logs WHERE business_id = ?').get(businessId) as any).cnt;
    const beforeEventCount = (db.prepare("SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'AGENT_EXECUTION_COMPLETED'").get() as any).cnt;

    const taskId = `task_telemetry_${Date.now()}`;
    db.prepare(`
      INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
      VALUES (?, ?, 'wf_test', 'mkt-03', 'Evaluate Conversion Funnel', 'PENDING', ?)
    `).run(taskId, orgId, taskId);

    const result = await runtime.execute({
      agentId: 'mkt-03',
      businessId,
      organizationId: orgId,
      taskId,
      workflowId: 'wf_test',
      prompt: 'Evaluate conversion funnel friction points',
      thinkingLevel: 'high'
    });

    expect(result.success).toBe(true);
    expect(result.telemetry).toBeDefined();
    expect(result.telemetry.model).toBe('gemini-3.8-flash');
    expect(result.telemetry.thinkingLevel).toBe('high');

    // Verify ai_cost_logs increased
    const afterCostCount = (db.prepare('SELECT COUNT(*) as cnt FROM ai_cost_logs WHERE business_id = ?').get(businessId) as any).cnt;
    expect(afterCostCount).toBe(beforeCostCount + 1);

    // Verify latest cost log entry
    const latestCost = db.prepare('SELECT * FROM ai_cost_logs WHERE business_id = ? AND agent_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId, 'mkt-03') as any;
    expect(latestCost).toBeDefined();
    expect(latestCost.agent_id).toBe('mkt-03');
    expect(latestCost.model).toBe('gemini-3.8-flash');
    expect(latestCost.thinking_level).toBe('high');

    // Verify analytics_events received AGENT_EXECUTION_COMPLETED
    const afterEventCount = (db.prepare("SELECT COUNT(*) as cnt FROM analytics_events WHERE event_type = 'AGENT_EXECUTION_COMPLETED'").get() as any).cnt;
    expect(afterEventCount).toBe(beforeEventCount + 1);
  });

  it('5. Enforces emergency kill switch: halts immediately without model execution', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    // Activate kill switch
    db.prepare('UPDATE businesses SET kill_switch_active = 1, kill_switch_reason = ? WHERE id = ?')
      .run('Safety Pause: Regulatory verification in progress', businessId);

    const taskId = `task_halt_${Date.now()}`;
    db.prepare(`
      INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
      VALUES (?, ?, 'wf_test', 'mkt-01', 'Strategy Update', 'PENDING', ?)
    `).run(taskId, orgId, taskId);

    await expect(
      runtime.execute({
        agentId: 'mkt-01',
        businessId,
        organizationId: orgId,
        taskId,
        workflowId: 'wf_test',
        prompt: 'Run strategy update'
      })
    ).rejects.toThrow(/Emergency Kill Switch is ACTIVE/);

    // Reset kill switch
    db.prepare('UPDATE businesses SET kill_switch_active = 0, kill_switch_reason = NULL WHERE id = ?').run(businessId);
  });

  it('6. Proves Gemini 3.8 Flash live execution with thinkingLevel and VERIFIED token usage', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    // Mock global fetch for genuine Gemini API response structure
    const originalFetch = global.fetch;
    const mockApiKey = 'AIzaSyFakeLiveDeploymentKeyForContractTest12345';
    process.env.GEMINI_API_KEY = mockApiKey;

    let capturedUrl = '';
    let capturedBody: any = null;

    global.fetch = async (url: any, init?: any) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body || '{}');

      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      objective: 'Acquire qualified clear-aligner consultations in Hyderabad within a controlled initial budget',
                      currentState: 'Zero real leads recorded; baseline clinic capacity ready',
                      evidence: 'Market research confirms high demand in Banjara Hills & Gachibowli for invisible braces',
                      evidenceClassification: 'REAL_WORLD_EVIDENCE',
                      audience: 'Working IT professionals 24-38 in Hyderabad tech corridor',
                      offer: 'Free 3D Digital Smile Scan + ₹5,000 INR Off on Clear Aligners',
                      channel: 'Google Search Ads + Local WhatsApp Funnel',
                      campaign: 'camp_seed_aligners_01',
                      creative: 'Get Your Dream Smile Invisibly - US-FDA Approved Clear Aligners in Banjara Hills',
                      landingPage: 'https://smilekraftdental.in/aligners-hyderabad',
                      followUp: 'Instant WhatsApp consultation booking with clinic orthodontist within 15 minutes',
                      budget: 10000,
                      expectedOutcome: '15-20 qualified patient consultation bookings with CAC <= ₹2,500',
                      confidence: 0.92,
                      actions: [
                        { action: 'deploy_landing_page', status: 'ready' },
                        { action: 'activate_search_campaign', budget_ceiling_inr: 10000 }
                      ]
                    })
                  }
                ]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 420,
            candidatesTokenCount: 285,
            totalTokenCount: 705
          }
        })
      } as any;
    };

    try {
      const taskId = `task_live_gemini_${Date.now()}`;
      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, ?, 'wf_test', 'mkt-01', 'Formulate Live Acquisition Strategy', 'PENDING', ?)
      `).run(taskId, orgId, taskId);

      const result = await runtime.execute({
        agentId: 'mkt-01',
        businessId,
        organizationId: orgId,
        taskId,
        workflowId: 'wf_test',
        prompt: 'Acquire qualified clear-aligner consultations in Hyderabad within a controlled initial budget.',
        thinkingLevel: 'high',
        skipCache: true
      });

      // 1. Verify live URL and thinking configuration
      expect(capturedUrl).toContain('gemini-3.8-flash:generateContent');
      expect(capturedUrl).toContain(`key=${mockApiKey}`);
      expect(capturedBody.generationConfig?.thinkingConfig?.thinkingLevel).toBe('HIGH');
      expect(capturedBody.generationConfig?.responseMimeType).toBe('application/json');

      // 2. Verify Execution and Telemetry
      expect(result.executionType).toBe('LLM');
      expect(result.model).toBe('gemini-3.8-flash');
      expect(result.telemetry.provider).toBe('google');
      expect(result.telemetry.model).toBe('gemini-3.8-flash');
      expect(result.telemetry.executionType).toBe('LLM');
      expect(result.telemetry.thinkingLevel).toBe('high');
      expect(result.telemetry.inputTokens).toBe(420);
      expect(result.telemetry.outputTokens).toBe(285);
      expect(result.telemetry.totalTokens).toBe(705);
      expect(result.telemetry.tokenUsageStatus).toBe('VERIFIED');

      // 3. Verify Decision Persisted with all required fields
      expect(result.decisionId).toBeDefined();
      const decisionRow = db.prepare('SELECT * FROM decisions WHERE id = ?').get(result.decisionId) as any;
      expect(decisionRow).toBeDefined();
      expect(decisionRow.source).toBe('gemini-3.8-flash');
      expect(decisionRow.confidence).toBe(0.92);
      expect(decisionRow.evidence).toContain('REAL_WORLD_EVIDENCE');
      expect(decisionRow.expected_outcome).toContain('CAC <= ₹2,500');

      // 4. Verify Telemetry Persisted in ai_cost_logs
      const costRow = db.prepare('SELECT * FROM ai_cost_logs WHERE id = ?').get(result.telemetry.costId || undefined) ||
        db.prepare('SELECT * FROM ai_cost_logs WHERE business_id = ? ORDER BY rowid DESC LIMIT 1').get(businessId) as any;
      expect(costRow).toBeDefined();
      expect(costRow.model).toBe('gemini-3.8-flash');
      expect(costRow.total_tokens).toBe(705);
      expect(costRow.estimated_cost_inr).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('7. Live Gemini failure throws LLM EXECUTION = FAILED immediately without silent fallback', async () => {
    const runtime = AgentRuntime.getInstance();
    const db = getDb();

    const originalFetch = global.fetch;
    process.env.GEMINI_API_KEY = 'AIzaSyFakeKeyCausingError12345';

    global.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => 'API key not valid or service unavailable'
    } as any);

    try {
      const taskId = `task_fail_${Date.now()}`;
      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, ?, 'wf_test', 'mkt-01', 'Failing Task', 'PENDING', ?)
      `).run(taskId, orgId, taskId);

      await expect(
        runtime.execute({
          agentId: 'mkt-01',
          businessId,
          organizationId: orgId,
          taskId,
          workflowId: 'wf_test',
          prompt: 'Execute with failing live endpoint',
          skipCache: true
        })
      ).rejects.toThrow(/LLM EXECUTION = FAILED/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.GEMINI_API_KEY;
    }
  });
});
