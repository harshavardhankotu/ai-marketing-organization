import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { LearningEngine } from '../../src/revenue/learning-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Learning Provenance & Demotion Rules (Spec § 16 & § 28)', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;
  let engine: LearningEngine;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    (LearningEngine as any).instance = undefined;
    engine = LearningEngine.getInstance();
  });

  function setupConfirmedOutboundAction(actionId: string, status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'REJECTED' = 'SENT') {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO platform_prospects (id, prospect_business_name, prospect_city, prospect_vertical, discovery_source, stage)
      VALUES ('pp_test_lp', 'Test Practice', 'Hyderabad', 'dental', 'INTERNAL', 'QUALIFIED')
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO opportunities (id, business_id, organization_id, prospect_id, source, status)
      VALUES ('opp_test_lp', ?, ?, 'pp_test_lp', 'INBOUND', 'OPEN')
    `).run(bizId, orgId);
    db.prepare(`
      INSERT OR IGNORE INTO outbound_contacts (id, business_id, organization_id, prospect_name, prospect_business_name, channel, source)
      VALUES ('oc_test_lp', ?, ?, 'Test Contact', 'Test Practice', 'EMAIL', 'INBOUND')
    `).run(bizId, orgId);
    db.prepare(`
      INSERT OR REPLACE INTO outbound_action_ledger (
        id, organization_id, business_id, opportunity_id, outbound_contact_id,
        sequence_number, channel, action_key, provider, provider_external_id, status
      ) VALUES (?, ?, ?, 'opp_test_lp', 'oc_test_lp', 1, 'EMAIL', 'act_lp_01', 'MOCK_EMAIL', ?, ?)
    `).run(actionId, orgId, bizId, `ext_${actionId}`, status);
  }

  function setupAuthoritativeRevenue(txId: string, verified: number = 1, classification: string = 'REAL') {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO revenue_records (
        id, organization_id, business_id, revenue_type, source, transaction_id,
        amount_inr, verified, verification_method, classification
      ) VALUES (?, ?, ?, 'PLATFORM_REVENUE', 'RAZORPAY', ?, 15000, ?, 'RAZORPAY_WEBHOOK', ?)
    `).run(`rev_${txId}`, orgId, bizId, txId, verified, classification);
  }

  it('1. Demotes REAL_WORLD_LEARNING to TEST_LEARNING when both action and transaction citations are missing', () => {
    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Cold email headline test',
      hypothesis: 'Short subject line increases open rate',
      action: 'Send short headline email',
      audience: 'Dental clinic owner',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Opened',
      evidence: {}
    });

    expect(record.learningType).toBe('TEST_LEARNING');
  });

  it('2. Demotes REAL_WORLD_LEARNING to TEST_LEARNING when outbound_action_ledger status is PENDING or FAILED', () => {
    const actionId = 'oal_pending_01';
    setupConfirmedOutboundAction(actionId, 'PENDING');
    setupAuthoritativeRevenue('tx_real_01', 1, 'REAL');

    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Test follow-up cadence',
      hypothesis: 'Faster cadence converts better',
      action: 'Send follow-up',
      audience: 'Dental clinic',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Pending dispatch',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'tx_real_01'
      }
    });

    expect(record.learningType).toBe('TEST_LEARNING');
  });

  it('3. Demotes REAL_WORLD_LEARNING to TEST_LEARNING when action citation does not exist in ledger', () => {
    setupAuthoritativeRevenue('tx_real_02', 1, 'REAL');

    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Test offer framing',
      hypothesis: 'Direct framing converts',
      action: 'Send offer',
      audience: 'Dental clinic',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Sent',
      evidence: {
        outboundActionId: 'non_existent_oal_999',
        transactionId: 'tx_real_02'
      }
    });

    expect(record.learningType).toBe('TEST_LEARNING');
  });

  it('4. Demotes REAL_WORLD_LEARNING to TEST_LEARNING when revenue record is missing', () => {
    const actionId = 'oal_confirmed_03';
    setupConfirmedOutboundAction(actionId, 'SENT');

    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Pitch with evidence',
      hypothesis: 'Evidence increases trust',
      action: 'Send evidence pitch',
      audience: 'Dental clinic',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Payment received',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'non_existent_tx_999'
      }
    });

    expect(record.learningType).toBe('TEST_LEARNING');
  });

  it('5. Demotes REAL_WORLD_LEARNING to TEST_LEARNING when revenue record is unverified / SIMULATED', () => {
    const actionId = 'oal_confirmed_04';
    setupConfirmedOutboundAction(actionId, 'DELIVERED');
    setupAuthoritativeRevenue('tx_unverified_01', 0, 'SIMULATED');

    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Pitch with evidence',
      hypothesis: 'Evidence increases trust',
      action: 'Send evidence pitch',
      audience: 'Dental clinic',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Simulated payment',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'tx_unverified_01'
      }
    });

    expect(record.learningType).toBe('TEST_LEARNING');
  });

  it('6. Demotes to SIMULATION_INSIGHT when simulation evidence or hypothesis is present', () => {
    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Budget reallocation',
      hypothesis: 'Simulated model predicts 25% lift',
      action: 'Run simulation projection',
      audience: 'Projected cohort',
      offer: 'PLATFORM_SETUP',
      channel: 'WHATSAPP',
      result: 'Projected positive outcome',
      evidence: { simulation: true }
    });

    expect(record.learningType).toBe('SIMULATION_INSIGHT');
  });

  it('7. Retains REAL_WORLD_LEARNING strictly when both confirmed action and authoritative revenue are proven', () => {
    const actionId = 'oal_proven_05';
    setupConfirmedOutboundAction(actionId, 'DELIVERED');
    setupAuthoritativeRevenue('pay_rzp_proven_05', 1, 'REAL');

    const record = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Specific delay audit message',
      hypothesis: 'Auditing 3.5h delay converts clinic owners',
      action: 'Sent audit email citing 3.5h after-hours gap',
      audience: 'Dr. Rao Smiles Hyderabad',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Captured ₹15,000 onboarding fee via Razorpay',
      revenueINR: 15000,
      evidence: {
        outboundActionId: actionId,
        transactionId: 'pay_rzp_proven_05'
      }
    });

    expect(record.learningType).toBe('REAL_WORLD_LEARNING');
  });

  it('8. TEST_LEARNING or SIMULATION_INSIGHT can NEVER be elevated to REAL_WORLD_LEARNING', () => {
    const actionId = 'oal_proven_06';
    setupConfirmedOutboundAction(actionId, 'SENT');
    setupAuthoritativeRevenue('pay_rzp_proven_06', 1, 'REAL');

    const testRecord = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'TEST_LEARNING',
      decision: 'Regression test',
      hypothesis: 'Harness validation',
      action: 'Execute test suite',
      audience: 'Test runner',
      offer: 'TEST_OFFER',
      channel: 'EMAIL',
      result: 'Pass',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'pay_rzp_proven_06'
      }
    });
    expect(testRecord.learningType).toBe('TEST_LEARNING');

    const simRecord = engine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'SIMULATION_INSIGHT',
      decision: 'Counterfactual projection',
      hypothesis: 'Model projection',
      action: 'Projected outcome',
      audience: 'Synthetic audience',
      offer: 'TEST_OFFER',
      channel: 'EMAIL',
      result: 'Model projected lift',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'pay_rzp_proven_06'
      }
    });
    expect(simRecord.learningType).toBe('SIMULATION_INSIGHT');
  });

  it('9. recordObservationAsync enforces the same demotion rules asynchronously', async () => {
    const actionId = 'oal_async_01';
    setupConfirmedOutboundAction(actionId, 'SENT');
    setupAuthoritativeRevenue('pay_async_01', 1, 'REAL');

    // Valid async observation
    const valid = await engine.recordObservationAsync({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Async valid',
      hypothesis: 'Valid hypothesis',
      action: 'Valid action',
      audience: 'Valid audience',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Success',
      evidence: {
        outboundActionId: actionId,
        transactionId: 'pay_async_01'
      }
    });
    expect(valid.learningType).toBe('REAL_WORLD_LEARNING');

    // Missing action async observation
    const invalid = await engine.recordObservationAsync({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Async missing action',
      hypothesis: 'Missing action hypothesis',
      action: 'Invalid action',
      audience: 'Invalid audience',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Demoted',
      evidence: {
        transactionId: 'pay_async_01'
      }
    });
    expect(invalid.learningType).toBe('TEST_LEARNING');
  });
});
