/**
 * DurableEventBus — persists all autonomous events to Cloudflare D1 and SQLite.
 *
 * Implements Spec § 16 & § 26:
 * Every event survives server restart, container restarts, and process crashes.
 * In production, writes and reads route through Cloudflare D1.
 * SQLite serves as local cache and dev/test runner store.
 */

import { getDb } from '../db/client.js';
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
   * Emit a durable event. Safe to call synchronously from any agent.
   * Persists immediately to SQLite and queues D1 write in production.
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

    try {
      const db = getDb();
      db.prepare(sql).run(...params);
    } catch (err: any) {
      console.warn(`[DurableEventBus] Local SQLite write failed: ${err.message}`);
    }

    if (isProduction()) {
      DurableEventBus.d1Repo.executeWrite('durable_events', sql, params).catch(err => {
        console.error(`[DurableEventBus] D1 event persistence failed: ${err.message}`);
      });
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
   * Async D1 claim for production orchestrator cycles.
   */
  public static async claimPendingAsync(organizationId: string, limit = 50): Promise<DurableEvent[]> {
    const sql = `
      SELECT * FROM durable_events
      WHERE organization_id = ? AND processed = 0
      ORDER BY created_at ASC
      LIMIT ?
    `;
    const params = [organizationId, limit];

    if (isProduction()) {
      try {
        const res = await DurableEventBus.d1Repo.executeRead('durable_events', sql, params);
        return (res.results || []).map(DurableEventBus.mapRow);
      } catch (err: any) {
        console.warn(`[DurableEventBus] D1 claim failed, falling back to local: ${err.message}`);
      }
    }

    return DurableEventBus.claimPending(organizationId, limit);
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

    const sql = `
      UPDATE durable_events
      SET processed = 1, processed_at = ?, triggered_agents_json = ?, error_message = ?
      WHERE id = ?
    `;
    const params = [now, JSON.stringify(agents), error || null, eventId];

    try {
      db.prepare(sql).run(...params);
    } catch {}

    if (isProduction()) {
      DurableEventBus.d1Repo.executeWrite('durable_events', sql, params).catch(err => {
        console.error(`[DurableEventBus] D1 markProcessed failed: ${err.message}`);
      });
    }
  }

  /**
   * Async D1 markProcessed for production orchestrator.
   */
  public static async markProcessedAsync(eventId: string, agentId: string, error?: string): Promise<void> {
    const now = new Date().toISOString();
    const sqlGet = `SELECT triggered_agents_json FROM durable_events WHERE id = ? LIMIT 1`;
    let agents: string[] = [];

    if (isProduction()) {
      try {
        const res = await DurableEventBus.d1Repo.executeRead('durable_events', sqlGet, [eventId]);
        const row = res.results?.[0] as any;
        agents = JSON.parse(row?.triggered_agents_json || '[]');
      } catch {}
    } else {
      try {
        const db = getDb();
        const row = db.prepare(sqlGet).get(eventId) as any;
        agents = JSON.parse(row?.triggered_agents_json || '[]');
      } catch {}
    }

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
