/**
 * OutboundActionLedger
 *
 * Implements Spec § 16: Strict Outbound Send Idempotency.
 *
 * Prevents repeat sends of the same message across cron wake cycles.
 * Checks the ledger before dispatching an outbound action.
 * Records the action with provider_external_id once accepted by the live provider.
 */

import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

export interface OutboundActionEntry {
  id: string;
  organizationId: string;
  businessId: string;
  opportunityId: string;
  outboundContactId: string;
  sequenceNumber: number;
  channel: 'EMAIL' | 'WHATSAPP';
  actionKey: string;
  provider: string;
  providerExternalId?: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'REJECTED';
  createdAt?: string;
  updatedAt?: string;
}

export class OutboundActionLedger {
  private static instance: OutboundActionLedger;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): OutboundActionLedger {
    if (!OutboundActionLedger.instance) {
      OutboundActionLedger.instance = new OutboundActionLedger();
    }
    return OutboundActionLedger.instance;
  }

  /**
   * Checks if an action has already been successfully dispatched and accepted.
   */
  public async isAlreadySent(
    organizationId: string,
    opportunityId: string,
    outboundContactId: string,
    sequenceNumber = 1,
    channel: 'EMAIL' | 'WHATSAPP' = 'EMAIL'
  ): Promise<boolean> {
    const sql = `
      SELECT status, provider_external_id FROM outbound_action_ledger
      WHERE organization_id = ? AND opportunity_id = ? AND outbound_contact_id = ?
        AND sequence_number = ? AND channel = ?
      LIMIT 1
    `;
    const params = [organizationId, opportunityId, outboundContactId, sequenceNumber, channel];

    if (isProduction()) {
      try {
        const res = await this.d1Repo.executeRead(
          'outbound_action_ledger',
          sql,
          params
        );
        const row = res.results?.[0] as any;
        return Boolean(row && (row.status === 'SENT' || row.status === 'DELIVERED') && row.provider_external_id);
      } catch {
        // Fall back to local SQLite if D1 read fails
      }
    }

    try {
      const db = getDb();
      const row = db.prepare(sql).get(...params) as any;
      return Boolean(row && (row.status === 'SENT' || row.status === 'DELIVERED') && row.provider_external_id);
    } catch {
      return false;
    }
  }

  /**
   * Records a successfully dispatched outbound action in the ledger.
   */
  public async recordAction(entry: OutboundActionEntry): Promise<void> {
    const sql = `
      INSERT INTO outbound_action_ledger (
        id, organization_id, business_id, opportunity_id, outbound_contact_id,
        sequence_number, channel, action_key, provider, provider_external_id, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(organization_id, opportunity_id, outbound_contact_id, sequence_number, channel)
      DO UPDATE SET
        provider_external_id = excluded.provider_external_id,
        status = excluded.status,
        updated_at = datetime('now')
    `;
    const params = [
      entry.id,
      entry.organizationId,
      entry.businessId,
      entry.opportunityId,
      entry.outboundContactId,
      entry.sequenceNumber,
      entry.channel,
      entry.actionKey,
      entry.provider,
      entry.providerExternalId || null,
      entry.status
    ];

    await this.d1Repo.executeWrite('outbound_action_ledger', sql, params);
  }
}
