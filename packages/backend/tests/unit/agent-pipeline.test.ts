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
});
