/**
 * DurableEventBus — persists all autonomous events to SQLite.
 *
 * Every event survives server restart. The AutonomousRevenueOrchestrator
 * polls for unprocessed events on each wake cycle and routes them to the
 * appropriate agent handlers.
 *
 * Event types (from spec item 16):
 *   NEW_PROSPECT | NEW_RESEARCH | NEW_LEAD | LEAD_NO_RESPONSE | LEAD_REPLIED |
 *   APPOINTMENT_BOOKED | APPOINTMENT_COMPLETED | OFFER_SENT | PAYMENT_REQUESTED |
 *   PAYMENT_RECEIVED | CUSTOMER_CREATED | CUSTOMER_LOST | EXPERIMENT_RESULT |
 *   REVENUE_RECORDED | NEW_OPPORTUNITY | OPPORTUNITY_WON | OPPORTUNITY_STATUS_CHANGED
 */

import { getDb } from '../db/client.js';

export type DurableEventType =
  | 'NEW_PROSPECT'
  | 'NEW_RESEARCH'
  | 'RESEARCH_UPDATED'
  | 'NEW_LEAD'
  | 'LEAD_NO_RESPONSE'
  | 'LEAD_REPLIED'
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_COMPLETED'
  | 'OFFER_SENT'
  | 'PAYMENT_REQUESTED'
  | 'PAYMENT_RECEIVED'
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_LOST'
  | 'EXPERIMENT_RESULT'
  | 'REVENUE_RECORDED'
  | 'NEW_OPPORTUNITY'
  | 'OPPORTUNITY_WON'
  | 'OPPORTUNITY_STATUS_CHANGED'
  | 'CYCLE_STARTED'
  | 'CYCLE_COMPLETED';

export interface DurableEvent {
  id: string;
  eventType: DurableEventType;
  organizationId: string;
  businessId?: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt?: string;
  triggeredAgents: string[];
  errorMessage?: string;
  createdAt: string;
}

export interface EmitEventInput {
  eventType: DurableEventType;
  organizationId: string;
  businessId?: string;
  payload: Record<string, unknown>;
}

export class DurableEventBus {
  /**
   * Emit a durable event. Safe to call from any agent.
   * The event is immediately persisted to SQLite and survives restarts.
   */
  public static emit(input: EmitEventInput): string {
    const db = getDb();
    const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO durable_events (
        id, event_type, organization_id, business_id,
        payload_json, processed, triggered_agents_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, '[]', ?)
    `).run(id, input.eventType, input.organizationId, input.businessId || null, JSON.stringify(input.payload), now);

    return id;
  }

  /**
   * Claim unprocessed events for processing by the orchestrator.
   * Returns up to `limit` events ordered by creation time.
   */
  public static claimPending(organizationId: string, limit = 50): DurableEvent[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM durable_events
      WHERE organization_id = ? AND processed = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(organizationId, limit) as any[];
    return rows.map(DurableEventBus.mapRow);
  }

  /**
   * Mark an event as processed by a specific agent.
   */
  public static markProcessed(eventId: string, agentId: string, error?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    const row = db.prepare(`SELECT triggered_agents_json FROM durable_events WHERE id = ?`).get(eventId) as any;
    const agents: string[] = JSON.parse(row?.triggered_agents_json || '[]');
    if (!agents.includes(agentId)) agents.push(agentId);

    db.prepare(`
      UPDATE durable_events
      SET processed = 1, processed_at = ?, triggered_agents_json = ?, error_message = ?
      WHERE id = ?
    `).run(now, JSON.stringify(agents), error || null, eventId);
  }

  /**
   * List recent events for dashboard/audit.
   */
  public static listRecent(organizationId: string, limit = 100): DurableEvent[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM durable_events
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(organizationId, limit) as any[];
    return rows.map(DurableEventBus.mapRow);
  }

  private static mapRow(row: any): DurableEvent {
    return {
      id: row.id,
      eventType: row.event_type as DurableEventType,
      organizationId: row.organization_id,
      businessId: row.business_id || undefined,
      payload: JSON.parse(row.payload_json || '{}'),
      processed: row.processed === 1,
      processedAt: row.processed_at || undefined,
      triggeredAgents: JSON.parse(row.triggered_agents_json || '[]'),
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at
    };
  }
}
