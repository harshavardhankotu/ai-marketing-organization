import { getDb } from '../db/client.js';
import { GeminiProvider, ThinkingLevel } from '../ai/gemini-provider.js';
import { MemoryStore } from '../memory/memory-store.js';
import { getAgentById, AgentDescriptor, TaskPriority } from '@ai-marketing/shared';

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
}

export interface AgentExecutionResult<T = any> {
  success: boolean;
  data: T;
  agentId: string;
  agentName: string;
  cached: boolean;
  confidence: number;
  error?: string;
}

export class AgentRuntime {
  private static instance: AgentRuntime;
  private gemini = new GeminiProvider();
  private memory = MemoryStore.getInstance();

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
        priority: options.priority || 'NORMAL'
      });

      const latencyMs = Date.now() - startMs;

      // 6. Update Agent Metrics in DB
      db.prepare(`
        UPDATE agents
        SET status = 'IDLE',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(agent.id);

      // 7. Mark Task Completed
      db.prepare(`
        UPDATE tasks 
        SET status = 'COMPLETED',
            outputs_json = ?,
            completed_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(response.data), options.taskId);

      // 8. Persist Findings to Memory if Research Agent
      if (agent.category === 'RESEARCH_INTELLIGENCE' && (response.data as any).findings) {
        const findings = (response.data as any).findings as any[];
        const insertFinding = db.prepare(`
          INSERT INTO research_findings (
            id, organization_id, business_id, agent_id, topic, market,
            finding, extracted_evidence, source, certainty, confidence_score, relevance_score
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            f.evidence || '',
            f.source || 'Secondary Analysis',
            f.certainty || 'OBSERVED',
            f.confidence || 0.85,
            0.9
          );
        }
      }

      return {
        success: true,
        data: response.data,
        agentId: agent.id,
        agentName: agent.name,
        cached: response.cached,
        confidence: (response.data as any)?.confidence ?? 0.88
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