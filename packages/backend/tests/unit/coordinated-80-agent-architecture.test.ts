/**
 * Coordinated 80-Agent Architecture & Runtime State Machine Test Suite
 *
 * Verifies:
 * 1. Defect 5.A: Failed tools cannot produce successful task results or idle agent state.
 * 2. Defect 5.B: Removal of hardcoded agent performance metrics (24 executions, 98% completion).
 * 3. Defect 5.C: Research findings provenance integrity (no fake fixtures treated as OBSERVED).
 * 4. Section 4: Coordinated task execution across all 4 groups of 20 agents with approval gates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AGENT_REGISTRY, getAgentById, getAgentsByCategory } from '@ai-marketing/shared';
import { AgentRuntime } from '../../src/agents/agent-runtime.js';
import { ToolExecutor, ToolCallRequest } from '../../src/agents/tool-executor.js';
import { CoordinatedAgentOrchestrator } from '../../src/agents/coordinated-orchestrator.js';
import { app } from '../../src/index.js';
describe('Coordinated 80-Agent Architecture & Runtime Verification', () => {
  beforeEach(() => {
    seedDatabase({ withDemoData: false });
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
      VALUES ('wf_1', 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
    `).run();
  });

  describe('1. Defect 5.B: Zero Hardcoded Agent Performance in Catalog & Scorecards', () => {
    it('all 80 agents have zero totalExecutions in static AGENT_REGISTRY', () => {
      expect(AGENT_REGISTRY).toHaveLength(80);
      for (const agent of AGENT_REGISTRY) {
        expect(agent.performanceMetrics.totalExecutions).toBe(0);
        expect(agent.performanceMetrics.successfulExecutions).toBe(0);
        expect(agent.performanceMetrics.failedExecutions).toBe(0);
        expect(agent.performanceMetrics.costIncurredINR).toBe(0);
        expect(agent.performanceMetrics.statusText).toBe('No execution data');
      }
    });

    it('GET /api/v1/agents returns honest "No execution data" for unexecuted agents', async () => {
      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.total).toBe(80);

      // Verify unexecuted agent has honest status
      const agentRes01 = json.data.find((a: any) => a.id === 'res-01');
      expect(agentRes01).toBeDefined();
      expect(agentRes01.performanceMetrics.totalExecutions).toBe(0);
      expect(agentRes01.performanceMetrics.statusText).toBe('No execution data');
      expect(agentRes01.performanceMetrics.completionRate).toBe(0);
    });

    it('GET /api/v1/agents dynamically calculates real metrics when tasks exist in DB', async () => {
      const db = getDb();
      const agentId = 'res-01';

      // Insert real task records for res-01
      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key, created_at)
        VALUES 
          ('task_t1', 'org_owner_primary', 'wf_1', 'res-01', 'Task 1', 'COMPLETED', 'idemp_1', datetime('now')),
          ('task_t2', 'org_owner_primary', 'wf_1', 'res-01', 'Task 2', 'COMPLETED', 'idemp_2', datetime('now')),
          ('task_t3', 'org_owner_primary', 'wf_1', 'res-01', 'Task 3', 'FAILED', 'idemp_3', datetime('now'))
      `).run();

      db.prepare(`
        INSERT INTO ai_cost_logs (
          id, organization_id, business_id, agent_id, division, model,
          thinking_level, input_tokens, output_tokens, total_tokens, latency_ms, estimated_cost_inr, purpose, created_at
        ) VALUES ('cost_1', 'org_owner_primary', 'biz_platform_aro', 'res-01', 'RESEARCH_INTELLIGENCE', 'gemini', 'low', 100, 100, 200, 450, 0.05, 'Test', datetime('now'))
      `).run();

      const res = await app.request('/api/v1/agents');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      const res01 = json.data.find((a: any) => a.id === 'res-01');
      expect(res01.performanceMetrics.totalExecutions).toBe(3);
      expect(res01.performanceMetrics.successfulExecutions).toBe(2);
      expect(res01.performanceMetrics.failedExecutions).toBe(1);
      expect(res01.performanceMetrics.completionRate).toBe(0.67);
      expect(res01.performanceMetrics.statusText).toBe('MEASURED');
      expect(res01.performanceMetrics.avgLatencyMs).toBe(450);
    });
  });

  describe('2. Defect 5.A: Failed Tools Cannot Produce Successful Task Results', () => {
    it('marks task FAILED and agent ERROR when tool execution fails', async () => {
      const db = getDb();
      const runtime = AgentRuntime.getInstance();
      const taskId = `task_tool_fail_${Date.now()}`;
      const workflowId = `wf_test_${Date.now()}`;

      // Insert initial workflow & task
      db.prepare(`
        INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
      `).run(workflowId);

      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, 'org_owner_primary', ?, 'res-01', 'Test Tool Failure', 'PENDING', ?)
      `).run(taskId, workflowId, taskId);

      // Mock tool executor to fail
      const toolExecutor = ToolExecutor.getInstance();
      vi.spyOn(toolExecutor, 'executeTool').mockResolvedValueOnce({
        tool: 'database_write',
        success: false,
        error: 'Permission denied: unauthorized table write access',
        executedAt: new Date().toISOString()
      });

      // Execute agent with tool call
      const result = await runtime.execute({
        agentId: 'res-01',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        taskId,
        workflowId,
        prompt: 'Analyze market and write findings to protected table',
        toolCall: {
          tool: 'database_write',
          parameters: { table: 'restricted_system_config' }
        }
      });

      // 1. Result must report success: false
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution failed');
      expect(result.error).toContain('unauthorized table write access');

      // 2. Task in DB must be FAILED (never COMPLETED)
      const taskRow = db.prepare('SELECT status, outputs_json FROM tasks WHERE id = ?').get(taskId) as any;
      expect(taskRow.status).toBe('FAILED');
      const outputs = JSON.parse(taskRow.outputs_json);
      expect(outputs.error).toContain('unauthorized table write access');
      expect(outputs.toolExecution.success).toBe(false);

      // 3. Agent in DB must be ERROR (never IDLE)
      const agentRow = db.prepare('SELECT status FROM agents WHERE id = ?').get('res-01') as any;
      expect(agentRow.status).toBe('ERROR');
    });

    it('marks task COMPLETED and agent IDLE when tool execution succeeds', async () => {
      const db = getDb();
      const runtime = AgentRuntime.getInstance();
      const taskId = `task_tool_succ_${Date.now()}`;
      const workflowId = `wf_test_${Date.now()}`;

      db.prepare(`
        INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
      `).run(workflowId);

      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, 'org_owner_primary', ?, 'res-01', 'Test Tool Success', 'PENDING', ?)
      `).run(taskId, workflowId, taskId);

      // Mock tool executor to succeed
      const toolExecutor = ToolExecutor.getInstance();
      vi.spyOn(toolExecutor, 'executeTool').mockResolvedValueOnce({
        tool: 'database_read',
        success: true,
        data: [{ id: 'biz_platform_aro', name: 'Platform ARO' }],
        executedAt: new Date().toISOString()
      });

      const result = await runtime.execute({
        agentId: 'res-01',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        taskId,
        workflowId,
        prompt: 'Read business profile',
        toolCall: {
          tool: 'database_read',
          parameters: { table: 'businesses' }
        }
      });

      expect(result.success).toBe(true);
      expect(result.toolExecution?.success).toBe(true);

      const taskRow = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as any;
      expect(taskRow.status).toBe('COMPLETED');

      const agentRow = db.prepare('SELECT status FROM agents WHERE id = ?').get('res-01') as any;
      expect(agentRow.status).toBe('IDLE');
    });

    it('marks task FAILED and updates agent status when an unhandled exception is thrown', async () => {
      const db = getDb();
      const runtime = AgentRuntime.getInstance();
      const taskId = `task_throw_${Date.now()}`;
      const workflowId = `wf_test_${Date.now()}`;

      db.prepare(`
        INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
      `).run(workflowId);

      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, 'org_owner_primary', ?, 'res-01', 'Test Exception', 'PENDING', ?)
      `).run(taskId, workflowId, taskId);

      // Force gemini provider to throw
      vi.spyOn((runtime as any).gemini, 'generateStructured').mockRejectedValueOnce(
        new Error('Provider rate limit exceeded or network timeout')
      );

      await expect(runtime.execute({
        agentId: 'res-01',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        taskId,
        workflowId,
        prompt: 'Prompt that will throw'
      })).rejects.toThrow('Provider rate limit exceeded');

      const taskRow = db.prepare('SELECT status, outputs_json FROM tasks WHERE id = ?').get(taskId) as any;
      expect(taskRow.status).toBe('FAILED');
      const outputs = JSON.parse(taskRow.outputs_json);
      expect(outputs.error).toContain('Provider rate limit exceeded');

      const agentRow = db.prepare('SELECT status FROM agents WHERE id = ?').get('res-01') as any;
      expect(agentRow.status).toBe('ERROR');
    });
  });

  describe('3. Defect 5.C: Research Findings Provenance Integrity', () => {
    it('quarantines research findings lacking valid external HTTP sources', async () => {
      const db = getDb();
      const runtime = AgentRuntime.getInstance();
      const taskId = `task_fnd_quar_${Date.now()}`;
      const workflowId = `wf_test_${Date.now()}`;

      db.prepare(`
        INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
      `).run(workflowId);

      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, 'org_owner_primary', ?, 'res-20', 'Test Provenance', 'PENDING', ?)
      `).run(taskId, workflowId, taskId);

      // Mock model returning findings without valid source
      vi.spyOn((runtime as any).gemini, 'generateStructured').mockResolvedValueOnce({
        data: {
          findings: [
            {
              topic: 'Thermal Printers',
              finding: 'High local demand for label printers',
              source: '', // Missing source!
              evidence: 'Observed discussion'
            },
            {
              topic: 'Barcode Scanners',
              finding: 'Retail demand in Hyderabad',
              source: 'test_fixture_synthetic_url', // Synthetic source!
              evidence: 'Mock evidence'
            }
          ]
        },
        cached: false,
        model: 'gemini-3.8-flash',
        executionType: 'SYNTHESIS'
      });

      await runtime.execute({
        agentId: 'res-20',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        taskId,
        workflowId,
        prompt: 'Generate research findings'
      });

      const findings = db.prepare(`SELECT * FROM research_findings WHERE agent_id = 'res-20' ORDER BY created_at DESC LIMIT 2`).all() as any[];
      expect(findings).toHaveLength(2);

      for (const f of findings) {
        expect(f.evidence_status).toBe('QUARANTINED');
        expect(f.data_classification).toBe('UNSOURCED');
        expect(f.certainty).toBe('HYPOTHESIZED');
        expect(f.certainty).not.toBe('OBSERVED');
        expect(f.confidence_score).toBeLessThanOrEqual(0.3);
      }
    });

    it('labels findings with verified HTTP sources as VERIFIED and OBSERVED', async () => {
      const db = getDb();
      const runtime = AgentRuntime.getInstance();
      const taskId = `task_fnd_valid_${Date.now()}`;
      const workflowId = `wf_test_${Date.now()}`;

      db.prepare(`
        INSERT INTO workflows (id, organization_id, business_id, workflow_type, status, current_step, inputs_json, outputs_json)
        VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'TEST', 'RUNNING', 'INIT', '{}', '{}')
      `).run(workflowId);

      db.prepare(`
        INSERT INTO tasks (id, organization_id, workflow_id, agent_id, title, status, idempotency_key)
        VALUES (?, 'org_owner_primary', ?, 'res-05', 'Test Valid Provenance', 'PENDING', ?)
      `).run(taskId, workflowId, taskId);

      vi.spyOn((runtime as any).gemini, 'generateStructured').mockResolvedValueOnce({
        data: {
          findings: [
            {
              topic: 'Official Specifications',
              finding: 'Phomemo M110 print resolution is 203 DPI',
              source: 'https://phomemo.com/products/phomemo-m110-label-maker',
              evidence: 'Product spec sheet confirms 203 DPI direct thermal head',
              certainty: 'OBSERVED',
              confidence: 0.95
            }
          ]
        },
        cached: false,
        model: 'gemini-3.8-flash',
        executionType: 'SYNTHESIS'
      });

      await runtime.execute({
        agentId: 'res-05',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        taskId,
        workflowId,
        prompt: 'Extract verified specs'
      });

      const finding = db.prepare(`SELECT * FROM research_findings WHERE agent_id = 'res-05' ORDER BY created_at DESC LIMIT 1`).get() as any;
      expect(finding).toBeDefined();
      expect(finding.evidence_status).toBe('VERIFIED');
      expect(finding.certainty).toBe('OBSERVED');
      expect(finding.source).toBe('https://phomemo.com/products/phomemo-m110-label-maker');
    });
  });

  describe('4. Section 4: Coordinated 80-Agent Orchestration & Division Alignment', () => {
    it('getDivisionMetrics() returns exact 20 agents in each of the 4 divisions', () => {
      const orchestrator = CoordinatedAgentOrchestrator.getInstance();
      const metrics = orchestrator.getDivisionMetrics();

      expect(metrics.totalAgents).toBe(80);
      expect(metrics.groups.RESEARCH_INTELLIGENCE.totalRegistered).toBe(20);
      expect(metrics.groups.CONTENT.totalRegistered).toBe(20);
      expect(metrics.groups.MARKETING_GROWTH.totalRegistered).toBe(20);
      expect(metrics.groups.ANALYTICS_LEARNING.totalRegistered).toBe(20);
    });

    it('executes a coordinated campaign across Groups A, B, C, D with approval gate', async () => {
      const orchestrator = CoordinatedAgentOrchestrator.getInstance();
      const briefId = `brief_${Date.now()}`;

      const result = await orchestrator.executeCoordinatedCampaign({
        briefId,
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        title: 'Thermal Label Printer Buying Guide',
        category: 'thermal printer',
        targetAudience: 'Indian small retail and logistics businesses',
        city: 'Hyderabad',
        verifiedSpecs: [
          {
            specName: 'Print Resolution',
            specValue: '203 DPI',
            sourceUrl: 'https://phomemo.com/products/phomemo-m110',
            retrievedAt: '2026-10-15'
          }
        ],
        buyerQuestions: [
          {
            questionText: 'Which thermal printer works best for shipping labels on Android?',
            sourceUrl: 'https://community.retail.in/questions/102',
            retrievedAt: '2026-10-15'
          }
        ]
      });

      // Verify tasks were executed across divisions
      expect(result.tasksCreated).toBeGreaterThanOrEqual(12);
      expect(result.tasksCompleted).toBeGreaterThanOrEqual(10);
      expect(result.tasksBlocked).toBe(1); // CMO approval gate
      expect(result.status).toBe('BLOCKED_APPROVAL');

      // Verify produced artifacts
      expect(result.producedArtifacts.marketResearch).toBeDefined();
      expect(result.producedArtifacts.productSpecs).toBeDefined();
      expect(result.producedArtifacts.contentStrategy).toBeDefined();
      expect(result.producedArtifacts.factCheck.passedFactCheck).toBe(true);
      expect(result.producedArtifacts.distributionGuard.ethicalPass).toBe(true);
      expect(result.producedArtifacts.telemetry.initialCounts.visits).toBe(0);

      // Verify human approval gate task in DB
      const db = getDb();
      const approvalTask = db.prepare(`SELECT status FROM tasks WHERE agent_id = 'mkt-20' AND workflow_id = ?`).get(`wf_coord_${briefId}`) as any;
      expect(approvalTask.status).toBe('WAITING_APPROVAL');
    });

    it('enforces idempotency: repeated campaign coordination does not duplicate task side effects', async () => {
      const orchestrator = CoordinatedAgentOrchestrator.getInstance();
      const briefId = `brief_idemp_${Date.now()}`;

      const run1 = await orchestrator.executeCoordinatedCampaign({
        briefId,
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        title: 'Barcode Scanner Campaign',
        category: 'barcode scanner',
        targetAudience: 'Warehouse managers'
      });

      const run2 = await orchestrator.executeCoordinatedCampaign({
        briefId,
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        title: 'Barcode Scanner Campaign',
        category: 'barcode scanner',
        targetAudience: 'Warehouse managers'
      });

      expect(run1.tasksCreated).toBe(run2.tasksCreated);
      expect(run2.status).toBe('BLOCKED_APPROVAL');

      // Verify no duplicate task IDs were inserted in SQLite
      const db = getDb();
      const taskCount = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE workflow_id = ?`).get(`wf_coord_${briefId}`) as any).c;
      expect(taskCount).toBe(run1.tasksCreated);
    });

    it('GET /api/v1/agents/divisions returns truth-backed metrics via HTTP API', async () => {
      const res = await app.request('/api/v1/agents/divisions');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.totalAgents).toBe(80);
      expect(json.data.groups.RESEARCH_INTELLIGENCE.totalRegistered).toBe(20);
      expect(json.data.groups.CONTENT.totalRegistered).toBe(20);
      expect(json.data.groups.MARKETING_GROWTH.totalRegistered).toBe(20);
      expect(json.data.groups.ANALYTICS_LEARNING.totalRegistered).toBe(20);
    });
  });
});
