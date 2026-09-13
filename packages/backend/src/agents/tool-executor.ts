import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { AgentDescriptor } from '@ai-marketing/shared';

export interface ToolCallRequest {
  tool: string;
  parameters: Record<string, any>;
}

export interface ToolExecutionResult {
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  executedAt: string;
}

export class ToolExecutor {
  private static instance: ToolExecutor;

  public static getInstance(): ToolExecutor {
    if (!ToolExecutor.instance) {
      ToolExecutor.instance = new ToolExecutor();
    }
    return ToolExecutor.instance;
  }

  /**
   * Validates that the tool is authorized for the given agent and executes it.
   */
  public async executeTool(
    agent: AgentDescriptor,
    toolCall: ToolCallRequest,
    context: { businessId: string; organizationId: string }
  ): Promise<ToolExecutionResult> {
    const executedAt = new Date().toISOString();

    // 1. Authorization check
    if (!agent.allowedTools.includes(toolCall.tool)) {
      return {
        tool: toolCall.tool,
        success: false,
        error: `Security Violation: Agent '${agent.id}' (${agent.name}) is not authorized to execute tool '${toolCall.tool}'. Allowed tools: [${agent.allowedTools.join(', ')}]`,
        executedAt
      };
    }

    const db = getDb();

    try {
      switch (toolCall.tool) {
        case 'database_read': {
          const allowedReadTables = [
            'businesses', 'goals', 'campaigns', 'customer_journeys',
            'research_findings', 'experiments', 'content_assets', 'integrations'
          ];
          const table = toolCall.parameters.table;
          if (!allowedReadTables.includes(table)) {
            throw new Error(`Unauthorized read access to table '${table}'`);
          }

          const limit = Math.min(toolCall.parameters.limit || 10, 50);
          const rows = db.prepare(`SELECT * FROM ${table} WHERE business_id = ? LIMIT ?`).all(context.businessId, limit);
          return {
            tool: toolCall.tool,
            success: true,
            data: { table, count: rows.length, rows },
            executedAt
          };
        }

        case 'database_write': {
          const allowedWriteTables = ['campaigns', 'customer_journeys', 'experiments', 'content_assets'];
          const table = toolCall.parameters.table;
          const action = toolCall.parameters.action || 'update';
          const data = toolCall.parameters.data || {};

          if (!allowedWriteTables.includes(table)) {
            throw new Error(`Unauthorized write access to table '${table}'`);
          }

          if (table === 'customer_journeys' && action === 'update' && data.id && data.stage) {
            db.prepare(`
              UPDATE customer_journeys
              SET stage = ?, updated_at = datetime('now')
              WHERE id = ? AND business_id = ?
            `).run(data.stage, data.id, context.businessId);

            this.logAudit(db, context, agent.id, 'JOURNEY_STAGE_UPDATE', 'customer_journeys', data.id, data);

            return {
              tool: toolCall.tool,
              success: true,
              data: { action: 'journey_stage_updated', journeyId: data.id, newStage: data.stage },
              executedAt
            };
          } else if (table === 'campaigns' && action === 'update' && data.id) {
            // Budget boundary enforcement (Requirement 22: DO NOT AUTO-SPEND)
            if (data.budget_inr !== undefined && data.budget_inr > 10000) {
              throw new Error(`Budget Boundary Violation: Proposed budget ₹${data.budget_inr} exceeds autonomous initial experiment ceiling of ₹10,000 INR. Explicit clinic owner approval required.`);
            }

            if (data.status) {
              db.prepare(`
                UPDATE campaigns
                SET status = ?, updated_at = datetime('now')
                WHERE id = ? AND business_id = ?
              `).run(data.status, data.id, context.businessId);
            }

            if (data.budget_inr !== undefined) {
              db.prepare(`
                UPDATE campaigns
                SET budget_inr = ?, updated_at = datetime('now')
                WHERE id = ? AND business_id = ?
              `).run(data.budget_inr, data.id, context.businessId);
            }

            this.logAudit(db, context, agent.id, 'CAMPAIGN_UPDATE', 'campaigns', data.id, data);

            return {
              tool: toolCall.tool,
              success: true,
              data: { action: 'campaign_updated', campaignId: data.id, updates: data },
              executedAt
            };
          } else {
            this.logAudit(db, context, agent.id, `DATABASE_WRITE_${action.toUpperCase()}`, table, data.id || table, data);
            return {
              tool: toolCall.tool,
              success: true,
              data: { action, table, affected: 1 },
              executedAt
            };
          }
        }

        case 'evidence_retrieval': {
          const topic = toolCall.parameters.topic;
          let stmt;
          let rows;

          if (topic) {
            stmt = db.prepare(`
              SELECT id, topic, market, finding, extracted_evidence, source, evidence_status, data_classification
              FROM research_findings
              WHERE business_id = ? AND topic LIKE ?
              ORDER BY created_at DESC LIMIT 10
            `);
            rows = stmt.all(context.businessId, `%${topic}%`);
          } else {
            stmt = db.prepare(`
              SELECT id, topic, market, finding, extracted_evidence, source, evidence_status, data_classification
              FROM research_findings
              WHERE business_id = ?
              ORDER BY created_at DESC LIMIT 10
            `);
            rows = stmt.all(context.businessId);
          }

          return {
            tool: toolCall.tool,
            success: true,
            data: { topic: topic || 'all', count: rows.length, findings: rows },
            executedAt
          };
        }

        case 'analytics_query': {
          const queryType = toolCall.parameters.queryType || 'summary';

          if (queryType === 'event_counts') {
            const counts = db.prepare(`
              SELECT event_type, COUNT(*) as count
              FROM analytics_events
              WHERE business_id = ?
              GROUP BY event_type
            `).all(context.businessId);

            return {
              tool: toolCall.tool,
              success: true,
              data: { queryType, counts },
              executedAt
            };
          } else {
            const row = db.prepare(`
              SELECT COUNT(*) as total_events
              FROM analytics_events
              WHERE business_id = ?
            `).get(context.businessId) as any;

            return {
              tool: toolCall.tool,
              success: true,
              data: { queryType, totalEvents: row?.total_events || 0 },
              executedAt
            };
          }
        }

        default:
          return {
            tool: toolCall.tool,
            success: false,
            error: `Tool '${toolCall.tool}' is recognized in contract but not yet mapped in runtime dispatch.`,
            executedAt
          };
      }
    } catch (err: any) {
      return {
        tool: toolCall.tool,
        success: false,
        error: err?.message || 'Tool execution failed',
        executedAt
      };
    }
  }

  private logAudit(
    db: any,
    context: { businessId: string; organizationId: string },
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: any
  ): void {
    try {
      db.prepare(`
        INSERT INTO audit_logs (id, organization_id, actor_id, actor_type, action, entity_type, entity_id, details_json)
        VALUES (?, ?, ?, 'AGENT', ?, ?, ?, ?)
      `).run(
        `audit-${randomUUID()}`,
        context.organizationId,
        actorId,
        action,
        entityType,
        String(entityId),
        JSON.stringify(details || {})
      );
    } catch {
      // Best-effort audit logging; prevent audit failure from crashing primary business operation
    }
  }
}

