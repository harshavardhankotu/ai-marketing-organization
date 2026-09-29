/**
 * OutboundActionLedger
 *
 * Implements Spec Item 4: Atomic Outbound Reservation State Machine.
 *
 * Lifecycle: reserve -> send -> mark SENT
 * Uses the UNIQUE constraint on (organization_id, opportunity_id, outbound_contact_id, sequence_number, channel)
 * to guarantee at the database level that no recipient can ever receive two messages for the same sequence step.
 * Concurrent reservation attempts result in RESERVATION_CONFLICT.
 *
 * Zero getDb() import in this production path.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { randomUUID } from 'crypto';

export interface OutboundActionEntry {
  id?: string;
  organizationId: string;
  businessId: string;
  opportunityId: string;
  outboundContactId: string;
  sequenceNumber: number;
  channel: 'EMAIL' | 'WHATSAPP';
  actionKey: string;
  provider: string;
  providerExternalId?: string;
  status: 'PENDING' | 'RESERVED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'REJECTED';
  createdAt?: string;
  updatedAt?: string;
}

export type OutboundReservationResult =
  | { success: true; ledgerId: string; status: 'RESERVED' }
  | { success: false; error: 'RESERVATION_CONFLICT'; reason: string };

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
   * Step 1: RESERVE
   * Atomically reserves the outbound slot using the database UNIQUE constraint.
   * If another worker has already reserved or sent for this tuple, fails with RESERVATION_CONFLICT.
   */
  public async reserve(
    entry: Omit<OutboundActionEntry, 'status'>
  ): Promise<OutboundReservationResult> {
    const id = entry.id || `oal_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const sql = `
      INSERT INTO outbound_action_ledger (
        id, organization_id, business_id, opportunity_id, outbound_contact_id,
        sequence_number, channel, action_key, provider, provider_external_id, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'RESERVED', datetime('now'), datetime('now'))
    `;
    const params = [
      id,
      entry.organizationId,
      entry.businessId,
      entry.opportunityId,
      entry.outboundContactId,
      entry.sequenceNumber || 1,
      entry.channel,
      entry.actionKey || `outreach_${entry.opportunityId}_${entry.channel}`,
      entry.provider
    ];

    try {
      await this.d1Repo.executeWrite('outbound_action_ledger', sql, params);
      return { success: true, ledgerId: id, status: 'RESERVED' };
    } catch (err: any) {
      const msg = String(err.message || '');
      if (
        msg.toLowerCase().includes('unique constraint') ||
        msg.includes('UNIQUE constraint failed')
      ) {
        return {
          success: false,
          error: 'RESERVATION_CONFLICT',
          reason: `RESERVATION_CONFLICT: Outbound action already reserved or sent for opportunity=${entry.opportunityId}, contact=${entry.outboundContactId}, sequence=${entry.sequenceNumber || 1}, channel=${entry.channel}`
        };
      }
      throw err;
    }
  }

  /**
   * Step 3: MARK SENT
   * Transitions state from RESERVED -> SENT upon verified dispatch by provider.
   * Stores the provider-issued external identifier.
   */
  public async markSent(ledgerId: string, providerExternalId: string): Promise<void> {
    const sql = `
      UPDATE outbound_action_ledger
      SET status = 'SENT', provider_external_id = ?, updated_at = datetime('now')
      WHERE id = ? AND (status = 'RESERVED' OR status = 'PENDING')
    `;
    await this.d1Repo.executeWrite('outbound_action_ledger', sql, [providerExternalId, ledgerId]);
  }

  /**
   * Marks a reserved action as FAILED if external delivery encounters a fatal failure.
   */
  public async markFailed(ledgerId: string, reason?: string): Promise<void> {
    const sql = `
      UPDATE outbound_action_ledger
      SET status = 'FAILED', updated_at = datetime('now')
      WHERE id = ? AND status = 'RESERVED'
    `;
    await this.d1Repo.executeWrite('outbound_action_ledger', sql, [ledgerId]);
  }

  /**
   * Coordinates the complete atomic state machine: reserve -> send -> mark SENT.
   * Guarantees at the database level that exactly one concurrent attempt succeeds.
   */
  public async executeWithReservation<T extends { externalId?: string; success?: boolean; [key: string]: any }>(
    entry: Omit<OutboundActionEntry, 'status'>,
    sendFn: () => Promise<T>
  ): Promise<{
    executed: boolean;
    status: 'SENT' | 'RESERVATION_CONFLICT' | 'SEND_FAILED';
    result?: T;
    error?: string;
    ledgerId?: string;
  }> {
    const reservation = await this.reserve(entry);
    if (!reservation.success) {
      return {
        executed: false,
        status: 'RESERVATION_CONFLICT',
        error: reservation.reason
      };
    }

    try {
      const sendResult = await sendFn();
      if (sendResult && (sendResult as any).success === false) {
        const errorMsg = (sendResult as any).error || (sendResult as any).message || 'Dispatch returned failure';
        await this.markFailed(reservation.ledgerId, errorMsg);
        return {
          executed: false,
          status: 'SEND_FAILED',
          result: sendResult,
          error: errorMsg,
          ledgerId: reservation.ledgerId
        };
      }
      const extId = sendResult?.externalId || `ext_${Date.now()}`;
      await this.markSent(reservation.ledgerId, extId);
      return {
        executed: true,
        status: 'SENT',
        result: sendResult,
        ledgerId: reservation.ledgerId
      };
    } catch (err: any) {
      await this.markFailed(reservation.ledgerId, err.message);
      return {
        executed: false,
        status: 'SEND_FAILED',
        error: err.message,
        ledgerId: reservation.ledgerId
      };
    }
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

    try {
      const row = await this.d1Repo.queryOne<any>('outbound_action_ledger', sql, params);
      return Boolean(row && (row.status === 'SENT' || row.status === 'DELIVERED') && row.provider_external_id);
    } catch {
      return false;
    }
  }

  /**
   * Backwards-compatible recording helper.
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
