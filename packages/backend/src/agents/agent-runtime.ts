import { getDb } from '../db/client.js';
import { GeminiProvider, ThinkingLevel } from '../ai/gemini-provider.js';
import { MemoryStore } from '../memory/memory-store.js';
import { ToolExecutor, ToolCallRequest, ToolExecutionResult } from './tool-executor.js';
import { getAgentById, AgentDescriptor, TaskPriority, ExecutionType } from '@ai-marketing/shared';

export interface ExecuteAgentOptions {
  agentId: string;
  businessId: string;
  organizationId: string;
  taskId: string;
  workflowId: string;
  prompt: string;
  contextOverride?: Record<string, any>;
  thinkingLevel?: ThinkingLevel;
  priority?: TaskPriority;
  toolCall?: ToolCallRequest;
  skipCache?: boolean;
}

export interface AgentExecutionResult<T = any> {
  success: boolean;
  data: T;
  agentId: string;
  agentName: string;
  cached: boolean;
  confidence: number;
  executionType?: ExecutionType;
  model?: string;
  telemetry?: any;
  tokenUsageStatus?: string;
  decisionId?: string;
  toolExecution?: ToolExecutionResult;
  error?: string;
}

export class AgentRuntime {
  private static instance: AgentRuntime;
  private gemini = new GeminiProvider();
  private memory = MemoryStore.getInstance();
  private toolExecutor = ToolExecutor.getInstance();

  public static getInstance(): AgentRuntime {
    if (!AgentRuntime.instance) {
      AgentRuntime.instance = new AgentRuntime();
    }
    return AgentRuntime.instance;
  }

  public async execute<T = any>(options: ExecuteAgentOptions): Promise<AgentExecutionResult<T>> {
    const db = getDb();

    // 1. Verify business emergency stop / kill switch
    const business = db.prepare('SELECT kill_switch_active, kill_switch_reason FROM businesses WHERE id = ?')
      .get(options.businessId) as { kill_switch_active: number; kill_switch_reason: string } | undefined;

    if (business && business.kill_switch_active === 1) {
      throw new Error(`Execution halted: Emergency Kill Switch is ACTIVE for business ${options.businessId}. Reason: ${business.kill_switch_reason}`);
    }

    // 2. Fetch Agent Contract
    const agent = getAgentById(options.agentId);
    if (!agent) {
      throw new Error(`Agent not found in registry: ${options.agentId}`);
    }

    // 3. Assemble Bounded Context Package
    const baseContext = this.memory.constructBoundedContext(options.businessId);
    const combinedContext = {
      ...baseContext,
      ...(options.contextOverride || {})
    };

    // 4. Record Task Attempt in DB
    const startMs = Date.now();
    db.prepare(`
      UPDATE tasks 
      SET status = 'IN_PROGRESS'
      WHERE id = ?
    `).run(options.taskId);

    try {
      // 5. Model Execution via QuotaManager
      const response = await this.gemini.generateStructured<T>({
        agentId: agent.id,
        systemInstruction: agent.systemInstruction,
        prompt: options.prompt,
        context: combinedContext,
        thinkingLevel: options.thinkingLevel || (agent.category === 'MARKETING_GROWTH' ? 'high' : 'medium'),
        priority: options.priority || 'NORMAL',
        skipCache: options.skipCache
      });

      const latencyMs = Date.now() - startMs;
      const respData = response.data as any;

      // 6. Record Actual Agent Decision in Decision Journal
      let decisionId: string | undefined;
      const hasDecision = respData && (
        respData.decision ||
        respData.recommendation ||
        respData.action ||
        respData.actions ||
        respData.strategy ||
        respData.strategyTitle ||
        respData.recommendedAction ||
        respData.summary ||
        respData.objective
      );

      if (hasDecision) {
        decisionId = `dec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const rawDecision = respData.decision || respData.recommendation || respData.strategyTitle || respData.action || respData.actions || respData.recommendedAction || respData.summary || respData.objective;
        db.prepare(`
          INSERT INTO decisions (
            id, organization_id, business_id, agent_id, decision,
            reason, evidence, source, confidence, alternatives_json,
            expected_outcome, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          decisionId,
          options.organizationId,
          options.businessId,
          agent.id,
          typeof rawDecision === 'object' ? JSON.stringify(rawDecision) : String(rawDecision),
          respData.reason || respData.rationale || 'Reasoned evaluation by agent',
          respData.evidenceClassification
            ? `[${respData.evidenceClassification}] ${respData.evidence || respData.extractedEvidence || 'Context evaluation'}`
            : (respData.evidence || respData.extractedEvidence || 'Agent context evaluation'),
          response.model || 'gemini-3.8-flash',
          respData.confidence ?? 0.85,
          JSON.stringify(respData.alternatives || []),
          respData.expectedOutcome || respData.forecast || 'Optimization of business target'
        );
      }

      // 7. Execute Authorized Tool Call (if requested by agent decision or options)
      let toolExecution: ToolExecutionResult | undefined;
      const toolCall = respData?.toolCall || (respData?.tool ? { tool: respData.tool, parameters: respData.parameters || {} } : undefined) || options.toolCall;
      if (toolCall) {
        toolExecution = await this.toolExecutor.executeTool(
          agent,
          toolCall,
          { businessId: options.businessId, organizationId: options.organizationId }
        );
      }

      // 8. Record Telemetry in ai_cost_logs and analytics_events
      if (response.telemetry) {
        const costId = `cost_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const estimatedCostINR = response.telemetry.tokenUsageStatus === 'VERIFIED'
          ? ((response.telemetry.totalTokens / 1000) * 0.05)
          : 0;

        db.prepare(`
          INSERT INTO ai_cost_logs (
            id, organization_id, business_id, agent_id, division,
            model, thinking_level, input_tokens, output_tokens, total_tokens,
            latency_ms, estimated_cost_inr, purpose, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          costId,
          options.organizationId,
          options.businessId,
          agent.id,
          agent.category,
          response.telemetry.model,
          response.telemetry.thinkingLevel,
          response.telemetry.inputTokens,
          response.telemetry.outputTokens,
          response.telemetry.totalTokens,
          response.telemetry.latencyMs,
          estimatedCostINR,
          options.prompt.substring(0, 100)
        );

        const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        db.prepare(`
          INSERT INTO analytics_events (
            id, organization_id, business_id, channel, event_type,
            revenue_inr, metadata_json, created_at
          ) VALUES (?, ?, ?, 'AI_AGENT', 'AGENT_EXECUTION_COMPLETED', 0, ?, datetime('now'))
        `).run(
          eventId,
          options.organizationId,
          options.businessId,
          JSON.stringify({
            agentId: agent.id,
            model: response.model,
            executionType: response.executionType,
            tokens: response.tokenCount,
            decisionId: decisionId || null,
            toolExecuted: toolExecution?.tool || null,
            toolSuccess: toolExecution?.success ?? null
          })
        );
      }

      // 9. Update Agent Metrics in DB
      db.prepare(`
        UPDATE agents
        SET status = 'IDLE',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(agent.id);

      // 10. Mark Task Completed
      const taskOutput = {
        ...(typeof response.data === 'object' && response.data !== null ? response.data : { result: response.data }),
        decisionId,
        toolExecution
      };

      db.prepare(`
        UPDATE tasks 
        SET status = 'COMPLETED',
            outputs_json = ?,
            completed_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(taskOutput), options.taskId);

      // 11. Persist Findings to Memory if Research Agent
      if (agent.category === 'RESEARCH_INTELLIGENCE' && (response.data as any).findings) {
        const findings = (response.data as any).findings as any[];
        const insertFinding = db.prepare(`
          INSERT INTO research_findings (
            id, organization_id, business_id, agent_id, topic, market,
            finding, extracted_evidence, source, certainty, confidence_score, relevance_score,
            source_type, source_reference, retrieved_at, evidence_status, data_classification
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const f of findings) {
          insertFinding.run(
            `fnd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            options.organizationId,
            options.businessId,
            agent.id,
            f.topic || 'Market Insight',
            f.market || combinedContext.business?.city || 'India',
            f.finding || '',
            f.evidence || f.extractedEvidence || 'NO_REAL_WORLD_EVIDENCE',
            f.source || 'DETERMINISTIC_TEST_FIXTURE',
            f.certainty || 'OBSERVED',
            f.confidence || 0.5,
            0.9,
            f.sourceType || 'TEST_DATA',
            f.sourceReference || 'DETERMINISTIC_TEST_FIXTURE',
            f.retrievedAt || new Date().toISOString(),
            f.evidenceStatus || 'NO_REAL_WORLD_EVIDENCE',
            f.dataClassification || 'TEST_DATA'
          );
        }
      }

      return {
        success: true,
        data: response.data,
        agentId: agent.id,
        agentName: agent.name,
        cached: response.cached,
        confidence: (response.data as any)?.confidence ?? 0.88,
        executionType: response.executionType,
        model: response.model,
        telemetry: response.telemetry,
        tokenUsageStatus: response.tokenUsageStatus,
        decisionId,
        toolExecution
      };
    } catch (error: any) {
      db.prepare(`
        UPDATE tasks 
        SET status = 'FAILED',
            outputs_json = ?
        WHERE id = ?
      `).run(JSON.stringify({ error: error.message }), options.taskId);

      throw error;
    }
  }
}