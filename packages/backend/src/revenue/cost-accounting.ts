import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { AICostRecord, AgentCategory } from '@ai-marketing/shared';

// Approximate nominal market rate for Gemini Flash (in INR)
// ₹0.06 per 1,000 input tokens, ₹0.24 per 1,000 output tokens
const COST_PER_1K_INPUT_TOKENS_INR = 0.06;
const COST_PER_1K_OUTPUT_TOKENS_INR = 0.24;

export class CostAccountingEngine {
  private get db() {
    return getDb();
  }

  calculateEstimatedCostINR(inputTokens: number, outputTokens: number): number {
    if (inputTokens <= 0 && outputTokens <= 0) return 0;
    const inputCost = (inputTokens / 1000) * COST_PER_1K_INPUT_TOKENS_INR;
    const outputCost = (outputTokens / 1000) * COST_PER_1K_OUTPUT_TOKENS_INR;
    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }

  logCost(params: {
    organizationId?: string;
    businessId: string;
    agentId: string;
    division: AgentCategory;
    model: string;
    thinkingLevel?: 'none' | 'low' | 'medium' | 'high';
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    purpose: string;
  }): AICostRecord {
    const id = `cost-${randomUUID()}`;
    const now = new Date().toISOString();
    const orgId = params.organizationId || 'org-india-1';
    const totalTokens = params.inputTokens + params.outputTokens;
    const thinkingLevel = params.thinkingLevel || 'none';
    const estimatedCostINR = this.calculateEstimatedCostINR(params.inputTokens, params.outputTokens);

    this.db
      .prepare(
        `INSERT INTO ai_cost_logs (
          id, organization_id, business_id, agent_id, division,
          model, thinking_level, input_tokens, output_tokens,
          total_tokens, latency_ms, estimated_cost_inr, purpose, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        orgId,
        params.businessId,
        params.agentId,
        params.division,
        params.model,
        thinkingLevel,
        params.inputTokens,
        params.outputTokens,
        totalTokens,
        params.latencyMs,
        estimatedCostINR,
        params.purpose,
        now
      );

    return {
      id,
      organizationId: orgId,
      businessId: params.businessId,
      agentId: params.agentId,
      division: params.division,
      model: params.model,
      thinkingLevel,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens,
      latencyMs: params.latencyMs,
      estimatedCostINR,
      purpose: params.purpose,
      createdAt: now,
    };
  }

  getCostSummary(businessId: string): {
    totalTokens: number;
    totalCostINR: number;
    divisionBreakdown: Record<string, { tokens: number; costINR: number }>;
    averageLatencyMs: number;
    totalCalls: number;
  } {
    const totalStats = this.db
      .prepare(
        `SELECT 
           COUNT(*) as total_calls,
           SUM(total_tokens) as total_tokens,
           SUM(estimated_cost_inr) as total_cost,
           AVG(latency_ms) as avg_latency
         FROM ai_cost_logs
         WHERE business_id = ?`
      )
      .get(businessId) as any;

    const divisionRows = this.db
      .prepare(
        `SELECT division, SUM(total_tokens) as tokens, SUM(estimated_cost_inr) as cost
         FROM ai_cost_logs
         WHERE business_id = ?
         GROUP BY division`
      )
      .all(businessId) as Array<{ division: string; tokens: number; cost: number }>;

    const divisionBreakdown: Record<string, { tokens: number; costINR: number }> = {};
    for (const r of divisionRows) {
      divisionBreakdown[r.division] = {
        tokens: r.tokens || 0,
        costINR: Math.round((r.cost || 0) * 100) / 100,
      };
    }

    return {
      totalTokens: totalStats?.total_tokens || 0,
      totalCostINR: Math.round((totalStats?.total_cost || 0) * 100) / 100,
      divisionBreakdown,
      averageLatencyMs: Math.round(totalStats?.avg_latency || 0),
      totalCalls: totalStats?.total_calls || 0,
    };
  }

  listCostLogs(businessId: string, limit = 50): AICostRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_cost_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(businessId, limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      businessId: r.business_id,
      agentId: r.agent_id,
      division: r.division,
      model: r.model,
      thinkingLevel: r.thinking_level,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      totalTokens: r.total_tokens,
      latencyMs: r.latency_ms,
      estimatedCostINR: r.estimated_cost_inr,
      purpose: r.purpose,
      createdAt: r.created_at,
    }));
  }
}
