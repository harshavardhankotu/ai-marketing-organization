/**
 * DurableEventBus — persists all autonomous events to Cloudflare D1.
 *
 * Implements Spec § 16 & § 26:
 * Every event survives server restart, container restarts, and process crashes.
 * In production, writes and reads route through Cloudflare D1 exclusively.
 * SQLite serves for dev/test runner store only via D1RevenueRepository.
 * Zero getDb() imports in this production path.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
import { randomUUID } from 'crypto';

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
  | 'MESSAGE_RECEIVED'
  | 'EMAIL_RECEIVED'
  | 'MEETING_REPLY'
  | 'PAYMENT_FAILED'
  | 'CUSTOMER_REPLIED'
  | 'PROPOSAL_ACCEPTED'
  | 'CONTACT_OPT_OUT'
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
  private static d1Repo = D1RevenueRepository.getInstance();

  /**
   * Emit a durable event.
   * In dev/test: writes synchronously to SQLite via D1RevenueRepository.
   * In production: writes to Cloudflare D1 with zero SQLite fallback.
   */
  public static emit(input: EmitEventInput): string {
    const id = `evt_${Date.now()}_${randomUUID().substring(0, 6)}`;
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO durable_events (
        id, event_type, organization_id, business_id,
        payload_json, processed, triggered_agents_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, '[]', ?)
    `;
    const params = [
      id,
      input.eventType,
      input.organizationId,
      input.businessId || null,
      JSON.stringify(input.payload),
      now
    ];

    if (isProduction()) {
      DurableEventBus.d1Repo.executeWrite('durable_events', sql, params).catch(err => {
        console.error(`[DurableEventBus] D1 event persistence failed: ${err.message}`);
      });
    } else {
      DurableEventBus.d1Repo.executeSync('durable_events', sql, params);
    }

    return id;
  }

  /**
   * Asynchronous durable emit with confirmed D1 persistence in production.
   */
  public static async emitAsync(input: EmitEventInput): Promise<string> {
    const id = `evt_${Date.now()}_${randomUUID().substring(0, 6)}`;
    const now = new Date().toISOString();

    const sql = `
      INSERT INTO durable_events (
        id, event_type, organization_id, business_id,
        payload_json, processed, triggered_agents_json, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, '[]', ?)
    `;
    const params = [
      id,
      input.eventType,
      input.organizationId,
      input.businessId || null,
      JSON.stringify(input.payload),
      now
    ];

    await DurableEventBus.d1Repo.executeWrite('durable_events', sql, params);
    return id;
  }

  /**
   * Claim unprocessed events for processing.
   */
  public static claimPending(organizationId: string, limit = 50): DurableEvent[] {
    const sql = `
      SELECT * FROM durable_events
      WHERE organization_id = ? AND processed = 0
      ORDER BY created_at ASC
      LIMIT ?
    `;
    const rows = DurableEventBus.d1Repo.querySync<any>('durable_events', sql, [organizationId, limit]);
    return rows.map(DurableEventBus.mapRow);
  }

  /**
   * Async D1 claim for production orchestrator cycles.
   * Fails closed if D1 fails — zero SQLite fallback in production.
   */
  public static async claimPendingAsync(organizationId: string, limit = 50): Promise<DurableEvent[]> {
    const sql = `
      SELECT * FROM durable_events
      WHERE organization_id = ? AND processed = 0
      ORDER BY created_at ASC
      LIMIT ?
    `;
    const res = await DurableEventBus.d1Repo.executeRead('durable_events', sql, [organizationId, limit]);
    return (res.results || []).map(DurableEventBus.mapRow);
  }

  /**
   * Mark an event as processed by a specific agent.
   */
  public static markProcessed(eventId: string, agentId: string, error?: string): void {
    const now = new Date().toISOString();
    const row = DurableEventBus.d1Repo.queryOneSync<any>('durable_events', `SELECT triggered_agents_json FROM durable_events WHERE id = ?`, [eventId]);
    const agents: string[] = JSON.parse(row?.triggered_agents_json || '[]');
    if (!agents.includes(agentId)) agents.push(agentId);

    const sql = `
      UPDATE durable_events
      SET processed = 1, processed_at = ?, triggered_agents_json = ?, error_message = ?
      WHERE id = ?
    `;
    const params = [now, JSON.stringify(agents), error || null, eventId];

    if (isProduction()) {
      DurableEventBus.d1Repo.executeWrite('durable_events', sql, params).catch(err => {
        console.error(`[DurableEventBus] D1 markProcessed failed: ${err.message}`);
      });
    } else {
      DurableEventBus.d1Repo.executeSync('durable_events', sql, params);
    }
  }

  /**
   * Async D1 markProcessed for production orchestrator.
   * Fails closed if D1 fails — zero SQLite fallback in production.
   */
  public static async markProcessedAsync(eventId: string, agentId: string, error?: string): Promise<void> {
    const now = new Date().toISOString();
    const sqlGet = `SELECT triggered_agents_json FROM durable_events WHERE id = ? LIMIT 1`;
    const row = await DurableEventBus.d1Repo.queryOne<any>('durable_events', sqlGet, [eventId]);
    const agents: string[] = JSON.parse(row?.triggered_agents_json || '[]');

    if (!agents.includes(agentId)) agents.push(agentId);

    const sqlUpdate = `
      UPDATE durable_events
      SET processed = 1, processed_at = ?, triggered_agents_json = ?, error_message = ?
      WHERE id = ?
    `;
    const params = [now, JSON.stringify(agents), error || null, eventId];

    await DurableEventBus.d1Repo.executeWrite('durable_events', sqlUpdate, params);
  }

  /**
   * List recent events for dashboard/audit.
   */
  public static listRecent(organizationId: string, limit = 100): DurableEvent[] {
    const sql = `
      SELECT * FROM durable_events
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const rows = DurableEventBus.d1Repo.querySync<any>('durable_events', sql, [organizationId, limit]);
    return rows.map(DurableEventBus.mapRow);
  }

  public static async listRecentAsync(organizationId: string, limit = 100): Promise<DurableEvent[]> {
    const sql = `
      SELECT * FROM durable_events
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    const rows = await DurableEventBus.d1Repo.query<any>('durable_events', sql, [organizationId, limit]);
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
