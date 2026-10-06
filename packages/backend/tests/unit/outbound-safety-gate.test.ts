import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OutboundEngine, OutboundMessageRequest } from '../../src/revenue/outbound-engine.js';
import { AutonomyPolicyController } from '../../src/revenue/autonomy-policy.js';
import { EmailAdapter } from '../../src/integrations/adapter-base.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Outbound Safety Gate & WhatsApp Cold Outreach Pause (Spec Item 9)', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;
  let outboundEngine: OutboundEngine;
  let policyController: AutonomyPolicyController;

  beforeEach(() => {
    process.env.OUTBOUND_ENABLED = 'true';
    resetDbForTesting();
    seedDatabase();
    (OutboundEngine as any).instance = undefined;
    (AutonomyPolicyController as any).instance = undefined;
    outboundEngine = OutboundEngine.getInstance();
    policyController = AutonomyPolicyController.getInstance();
  });

  it('1. Cold WhatsApp is rejected with CHANNEL_PAUSED', async () => {
    // 1a. Via Policy Controller directly
    const policyResult = policyController.evaluateAction(orgId, 'OUTBOUND_SEND', {
      channel: 'WHATSAPP',
      isColdOutreach: true
    });
    expect(policyResult.allowed).toBe(false);
    expect(policyResult.violatedRule).toBe('CHANNEL_PAUSED');
    expect(policyResult.reason).toContain('WhatsApp cold outreach is paused');

    // 1b. Via OutboundEngine.dispatch
    const dispatchReq: OutboundMessageRequest = {
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      recipientId: 'rec_prospect_01',
      recipientContact: '+919876543210',
      recipientName: 'Dr. Ramesh Gupta',
      body: 'Hello Dr. Ramesh, would you be open to an automated lead demonstration?'
    };

    const result = await outboundEngine.dispatch(dispatchReq);
    expect(result.success).toBe(false);
    expect(result.status).toBe('CHANNEL_PAUSED');
    expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(result.error).toContain('CHANNEL_PAUSED');
  });

  it('2. Inbound WhatsApp response is allowed', async () => {
    // 2a. Via Policy Controller directly
    const policyResult = policyController.evaluateAction(orgId, 'OUTBOUND_SEND', {
      channel: 'WHATSAPP',
      isInboundResponse: true
    });
    expect(policyResult.allowed).toBe(true);

    // 2b. Via OutboundEngine.dispatch with isInboundResponse: true
    // (Should bypass CHANNEL_PAUSED gate; will hit credentials gate in test environment)
    const dispatchReq: OutboundMessageRequest = {
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      recipientId: 'rec_prospect_02',
      recipientContact: '+919876543211',
      recipientName: 'Inbound Patient',
      body: 'Thank you for reaching out. Our consultation hours are 9 AM - 6 PM.',
      isInboundResponse: true
    };

    const result = await outboundEngine.dispatch(dispatchReq);
    // Not paused — it passed the safety gate
    expect(result.status).not.toBe('CHANNEL_PAUSED');
    // Reaches credential check as expected in test environment without live Meta tokens
    expect(result.status).toBe('BLOCKED_AUTHORIZATION');
    expect(result.error).toContain('credentials not configured');
  });

  it('3. Cold Email requires approval before send (APPROVAL_REQUIRED)', async () => {
    // 3a. Via Policy Controller: unapproved cold email is blocked
    const unapprovedPolicy = policyController.evaluateAction(orgId, 'OUTBOUND_SEND', {
      channel: 'EMAIL',
      isColdOutreach: true
    });
    expect(unapprovedPolicy.allowed).toBe(false);
    expect(unapprovedPolicy.violatedRule).toBe('APPROVAL_REQUIRED');

    // 3b. Via Policy Controller: approved cold email is allowed
    const approvedPolicy = policyController.evaluateAction(orgId, 'OUTBOUND_SEND', {
      channel: 'EMAIL',
      isColdOutreach: true,
      isApproved: true,
      approverId: 'owner_user_01'
    });
    expect(approvedPolicy.allowed).toBe(true);

    // 3c. Via OutboundEngine.dispatch: unapproved cold email creates pending draft
    const dispatchReq: OutboundMessageRequest = {
      businessId: bizId,
      organizationId: orgId,
      channel: 'EMAIL',
      recipientId: 'rec_prospect_03',
      recipientContact: 'dr.sharma@example.com',
      recipientName: 'Dr. Sharma',
      subject: 'Inbound patient qualification system',
      body: 'Hello Dr. Sharma, we help dental clinics respond to inquiries instantly.',
      isColdOutreach: true
    };

    const result = await outboundEngine.dispatch(dispatchReq);
    expect(result.success).toBe(false);
    expect(result.status).toBe('APPROVAL_REQUIRED');
    expect(result.actionClassification).toBe('APPROVAL_REQUIRED');
    expect(result.error).toContain('APPROVAL_REQUIRED');

    // 3d. Verify draft persisted in direct_outreach_log with response_status = 'APPROVAL_REQUIRED'
    const db = getDb();
    const draftRow = db.prepare(`
      SELECT * FROM direct_outreach_log
      WHERE response_status = 'APPROVAL_REQUIRED' AND channel = 'EMAIL'
      ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    expect(draftRow).toBeDefined();
    expect(draftRow.business_id).toBe(bizId);
    expect(draftRow.human_approved).toBe(0);
    expect(draftRow.dispatched).toBe(0);
    expect(draftRow.message_draft).toContain('Hello Dr. Sharma');
  });

  it('4. 6th outbound action in 24h is rejected with DAILY_OUTBOUND_CAP_REACHED', async () => {
    const db = getDb();

    // Insert 5 historical outbound actions in the last 24 hours
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved,
          dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, ?, 'OUTBOUND_PROSPECT', ?, 'EMAIL', 'Historical outreach message', 1, 1, 1, datetime('now'), 'LIVE_EXTERNAL_ACTION', datetime('now'))
      `).run(`out_hist_0${i}`, bizId, `Prospect ${i}`);
    }

    // Verify rolling 24h count is exactly 5
    const count = policyController.getRolling24hOutboundCount(orgId);
    expect(count).toBe(5);

    // 4a. Via Policy Controller directly
    const policyResult = policyController.evaluateAction(orgId, 'OUTBOUND_SEND', {
      channel: 'EMAIL',
      costINR: 0,
      isApproved: true
    });
    expect(policyResult.allowed).toBe(false);
    expect(policyResult.violatedRule).toBe('DAILY_OUTBOUND_CAP_REACHED');
    expect(policyResult.reason).toContain('Rolling 24-hour outbound action limit');

    // 4b. Via OutboundEngine.dispatch
    const dispatchReq: OutboundMessageRequest = {
      businessId: bizId,
      organizationId: orgId,
      channel: 'EMAIL',
      recipientId: 'rec_prospect_06',
      recipientContact: 'dr.sixth@example.com',
      recipientName: 'Dr. Sixth',
      subject: 'Follow up',
      body: 'Sixth outreach message of the day',
      isApproved: true,
      approverId: 'owner_user_01'
    };

    const result = await outboundEngine.dispatch(dispatchReq);
    expect(result.success).toBe(false);
    expect(result.status).toBe('DAILY_OUTBOUND_CAP_REACHED');
    expect(result.error).toContain('DAILY_OUTBOUND_CAP_REACHED');
  });

  it('5. EmailAdapter appends unsubscribe footer and rejects suppressed recipient', async () => {
    // 5a. Suppressed recipient is blocked
    policyController.suppressContact('suppressed.recipient@example.com', 'UNSUBSCRIBED');

    const emailAdapter = new EmailAdapter({ smtpKey: 'mock_sendgrid_key_01' });
    const blockedRes = await emailAdapter.publish({
      title: 'Monthly Update',
      body: 'This should not be delivered to a suppressed contact.',
      channel: 'EMAIL',
      recipientEmail: 'suppressed.recipient@example.com'
    });

    expect(blockedRes.success).toBe(false);
    expect(blockedRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(blockedRes.message).toContain('suppressed');

    // 5b. Verify unsubscribe footer insertion
    let capturedBody = '';
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: any, init: any) => {
      if (typeof url === 'string' && url.includes('sendgrid.com')) {
        const bodyObj = JSON.parse(init.body);
        capturedBody = bodyObj.content[0].value;
        return {
          ok: true,
          status: 202,
          headers: new Headers({ 'x-message-id': 'mock_sg_msg_id_12345' }),
          json: async () => ({})
        };
      }
      return originalFetch(url, init);
    });

    try {
      const activeRes = await emailAdapter.publish({
        title: 'Valid Lead Demonstration',
        body: 'Here is your demonstration schedule.',
        channel: 'EMAIL',
        recipientEmail: 'valid.prospect@example.com'
      });

      expect(activeRes.success).toBe(true);
      expect(activeRes.actionClassification).toBe('LIVE_EXTERNAL_ACTION');
      expect(activeRes.externalId).toBe('mock_sg_msg_id_12345');
      expect(capturedBody).toContain('Here is your demonstration schedule.');
      expect(capturedBody).toContain('/api/v1/unsubscribe?email=valid.prospect%40example.com');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
