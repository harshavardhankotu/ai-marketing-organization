/**
 * outbound-reservation-concurrency.test.ts
 *
 * Implements Spec Item 4 Verification:
 * "The outbound lock must be atomic at the database level: insert a row
 *  with status RESERVED using a unique constraint on (org, opportunity,
 *  contact, sequence, channel). If that insert fails because a row already
 *  exists, the send MUST NOT happen — return RESERVATION_CONFLICT. Only
 *  if the insert succeeds does the message dispatch. On success, update
 *  status to SENT. On failure, update to FAILED. Two concurrent processes
 *  must never both send. Write a concurrency test with Promise.all to
 *  prove this."
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { OutboundActionLedger } from '../../src/revenue/outbound-action-ledger.js';

describe('Spec Item 4: Atomic Outbound Reservation State Machine & Concurrency', () => {
  const orgId = 'org_test_outbound_res';
  const bizId = 'biz_test_outbound_res';
  const oppId = 'opp_test_outbound_res_001';
  const contactId = 'cnt_test_outbound_res_001';

  beforeEach(() => {
    resetDbForTesting();
    const db = getDb();

    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug)
      VALUES (?, 'Test Outbound Org', 'test-outbound-org')
    `).run(orgId);

    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice)
      VALUES (?, ?, 'Test Outbound Biz', 'v_tech', 'Technology', 'Hyderabad', 'Banjara Hills', 'Professional')
    `).run(bizId, orgId);

    db.prepare(`
      INSERT OR IGNORE INTO opportunities (id, business_id, organization_id, source)
      VALUES (?, ?, ?, 'OUTBOUND_PROSPECT')
    `).run(oppId, bizId, orgId);

    db.prepare(`
      INSERT OR IGNORE INTO outbound_contacts (id, organization_id, business_id, prospect_name, channel)
      VALUES (?, ?, ?, 'Dr. Sharma', 'EMAIL')
    `).run(contactId, orgId, bizId);
  });

  it('atomically prevents double-send under high concurrency (Promise.all)', async () => {
    const ledger = OutboundActionLedger.getInstance();
    let dispatchCallCount = 0;

    const mockSend = async () => {
      dispatchCallCount++;
      // Simulate non-zero external API latency
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        success: true,
        externalId: 'ext_msg_resend_99999'
      };
    };

    const entry = {
      id: `act_${Date.now()}`,
      organizationId: orgId,
      businessId: bizId,
      opportunityId: oppId,
      outboundContactId: contactId,
      sequenceNumber: 1,
      channel: 'EMAIL' as const,
      actionKey: `outreach_${oppId}_EMAIL`,
      provider: 'RESEND'
    };

    // Run two concurrent dispatch attempts simultaneously
    const [result1, result2] = await Promise.all([
      ledger.executeWithReservation(entry, mockSend),
      ledger.executeWithReservation(entry, mockSend)
    ]);

    // Exactly one must succeed, exactly one must receive RESERVATION_CONFLICT
    const successResults = [result1, result2].filter((r) => r.executed && r.status === 'SENT');
    const conflictResults = [result1, result2].filter(
      (r) => !r.executed && r.status === 'RESERVATION_CONFLICT'
    );

    expect(successResults.length).toBe(1);
    expect(conflictResults.length).toBe(1);
    expect(conflictResults[0].error).toContain('RESERVATION_CONFLICT');

    // Crucial: The dispatch function must have been invoked EXACTLY ONCE
    expect(dispatchCallCount).toBe(1);

    // Verify DB state in outbound_action_ledger
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM outbound_action_ledger
      WHERE organization_id = ? AND opportunity_id = ? AND outbound_contact_id = ?
    `).all(orgId, oppId, contactId) as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('SENT');
    expect(rows[0].provider_external_id).toBe('ext_msg_resend_99999');
  });

  function seedOpportunity(oId: string, cId: string) {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO opportunities (id, business_id, organization_id, source)
      VALUES (?, ?, ?, 'OUTBOUND_PROSPECT')
    `).run(oId, bizId, orgId);

    db.prepare(`
      INSERT OR IGNORE INTO outbound_contacts (id, organization_id, business_id, prospect_name, channel)
      VALUES (?, ?, ?, 'Contact Name', 'EMAIL')
    `).run(cId, orgId, bizId);
  }

  it('reserve step returns RESERVATION_CONFLICT on duplicate and permits only one lock', async () => {
    const ledger = OutboundActionLedger.getInstance();
    seedOpportunity('opp_direct_test', 'cnt_direct_test');

    const entry = {
      id: `act_direct_${Date.now()}`,
      organizationId: orgId,
      businessId: bizId,
      opportunityId: 'opp_direct_test',
      outboundContactId: 'cnt_direct_test',
      sequenceNumber: 1,
      channel: 'WHATSAPP' as const,
      actionKey: 'outreach_direct_WHATSAPP',
      provider: 'META_WHATSAPP'
    };

    const res1 = await ledger.reserve(entry);
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.status).toBe('RESERVED');

    // Immediate second attempt on the same unique tuple
    const res2 = await ledger.reserve(entry);
    expect(res2.success).toBe(false);
    if (res2.success) return;
    expect(res2.error).toBe('RESERVATION_CONFLICT');
    expect(res2.reason).toContain('RESERVATION_CONFLICT');

    // Transitions to SENT on successful dispatch
    await ledger.markSent(res1.ledgerId, 'wa_wamid_987654');

    const db = getDb();
    const row = db.prepare(`SELECT status, provider_external_id FROM outbound_action_ledger WHERE id = ?`).get(res1.ledgerId) as any;
    expect(row.status).toBe('SENT');
    expect(row.provider_external_id).toBe('wa_wamid_987654');
  });

  it('marks reserved action as FAILED if send encounters a fatal failure', async () => {
    const ledger = OutboundActionLedger.getInstance();
    seedOpportunity('opp_fail_test', 'cnt_fail_test');

    const entry = {
      id: `act_fail_${Date.now()}`,
      organizationId: orgId,
      businessId: bizId,
      opportunityId: 'opp_fail_test',
      outboundContactId: 'cnt_fail_test',
      sequenceNumber: 1,
      channel: 'EMAIL' as const,
      actionKey: 'outreach_fail_EMAIL',
      provider: 'RESEND'
    };

    const result = await ledger.executeWithReservation(entry, async () => {
      throw new Error('FATAL_SMTP_550: Recipient address rejected');
    });

    expect(result.executed).toBe(false);
    expect(result.status).toBe('SEND_FAILED');
    expect(result.error).toContain('FATAL_SMTP_550');

    const db = getDb();
    const row = db.prepare(`SELECT status, provider_external_id FROM outbound_action_ledger WHERE id = ?`).get(result.ledgerId!) as any;
    expect(row.status).toBe('FAILED');
    expect(row.provider_external_id).toBeNull();
  });
});
