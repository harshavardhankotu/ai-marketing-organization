import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { ReferralTrackingEngine } from '../../src/commission/referral-tracking.js';
import { ConversionVerificationAdapter } from '../../src/commission/conversion-verification.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';

const ORG = 'org_owner_primary';

/**
 * Affiliate simulation harness (honest ladder):
 * demand -> offer -> referral click -> SIMULATED conversion (expected>0, verified=0,
 * zero revenue_records) -> REAL conversion approve (verified>0, one revenue record).
 * Proves simulations can never fabricate revenue.
 */
describe('Affiliate simulation harness — Amazon/eBay attribution + honest revenue ladder', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    process.env.AMAZON_AFFILIATE_TAG = 'testsite-21';
    process.env.EBAY_CAMPID = '9999999999';
  });

  afterEach(() => {
    delete process.env.AMAZON_AFFILIATE_TAG;
    delete process.env.EBAY_CAMPID;
  });

  it('rejects Amazon offers without any affiliate tag configured', async () => {
    delete process.env.AMAZON_AFFILIATE_TAG;
    const registry = PartnerRegistryEngine.getInstance();
    const partner = await registry.createPartner({
      organizationId: ORG,
      name: 'Amazon India',
      industry: 'Ecommerce',
      website: 'https://www.amazon.in',
      partnerType: 'AFFILIATE',
    });
    await expect(registry.createOffer({
      partnerId: partner.id,
      organizationId: ORG,
      title: 'Test Product',
      offerSlug: 'test-product-no-tag',
      category: 'Electronics',
      targetCustomer: 'Testers',
      commissionModel: 'PERCENTAGE',
      commissionAmountINR: 100,
      destinationUrl: 'https://www.amazon.in/dp/B0TEST123',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B0TEST123',
    })).rejects.toThrow(/MISSING_AFFILIATE_ID/);
  });

  it('injects tag/campid at click time and keeps internal subid attribution', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const tracker = ReferralTrackingEngine.getInstance();

    const amz = await registry.createPartner({
      organizationId: ORG, name: 'Amazon India', industry: 'Ecommerce',
      website: 'https://www.amazon.in', partnerType: 'AFFILIATE',
    });
    const amzOfferDraft = await registry.createOffer({
      partnerId: amz.id, organizationId: ORG, title: 'Echo Dot', offerSlug: 'echo-dot-sim',
      category: 'Electronics', targetCustomer: 'Smart home buyers',
      commissionModel: 'PERCENTAGE', commissionAmountINR: 150,
      destinationUrl: 'https://www.amazon.in/dp/B0ECHO1',
      // No tag in URL — env tag must be injected at click time
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B0ECHO1',
    });
    // Phase 2 lifecycle: operator verifies, then activates
    const amzOffer = await registry.setOfferStatus(amzOfferDraft.id, 'ACTIVE');
    const amzLink = await tracker.createReferralLink(amzOffer.id);
    expect(amzLink.destinationUrl).toContain('tag=testsite-21');
    expect(amzLink.destinationUrl).toContain(`subid=${amzLink.clickId}`);

    const ebay = await registry.createPartner({
      organizationId: ORG, name: 'eBay', industry: 'Ecommerce',
      website: 'https://www.ebay.com', partnerType: 'AFFILIATE',
    });
    const ebayOfferDraft = await registry.createOffer({
      partnerId: ebay.id, organizationId: ORG, title: 'Vintage Camera', offerSlug: 'vintage-cam-sim',
      category: 'Cameras', targetCustomer: 'Collectors',
      commissionModel: 'FIXED', commissionAmountINR: 200,
      destinationUrl: 'https://www.ebay.com/itm/12345',
      authorizedTrackingUrl: 'https://www.ebay.com/itm/12345',
    });
    const ebayOffer = await registry.setOfferStatus(ebayOfferDraft.id, 'ACTIVE');
    const ebayLink = await tracker.createReferralLink(ebayOffer.id);
    expect(ebayLink.destinationUrl).toContain('campid=9999999999');
    expect(ebayLink.destinationUrl).toContain(`customid=${ebayLink.clickId}`);
  });

  it('simulated conversion stays expected-only: zero verified revenue, zero revenue_records', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const tracker = ReferralTrackingEngine.getInstance();
    const verifier = ConversionVerificationAdapter.getInstance();
    const ledger = CommissionLedgerEngine.getInstance();
    const db = getDb();

    const partner = await registry.createPartner({
      organizationId: ORG, name: 'Amazon India Sim', industry: 'Ecommerce',
      website: 'https://www.amazon.in', partnerType: 'AFFILIATE',
    });
    const offerDraft = await registry.createOffer({
      partnerId: partner.id, organizationId: ORG, title: 'Kindle', offerSlug: 'kindle-sim',
      category: 'Electronics', targetCustomer: 'Readers',
      commissionModel: 'PERCENTAGE', commissionAmountINR: 120,
      destinationUrl: 'https://www.amazon.in/dp/B0KINDLE?tag=testsite-21',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B0KINDLE?tag=testsite-21',
    });
    const offer = await registry.setOfferStatus(offerDraft.id, 'ACTIVE');
    const link = await tracker.createReferralLink(offer.id);

    // Attacker-style: request APPROVED with verified cash on a sim_ transaction.
    // Guard must cap it at PENDING with zeros.
    const sim = await verifier.reportConversion({
      partnerId: partner.id,
      referralId: link.referralId,
      externalTransactionId: 'sim_txn_attack_001',
      expectedCommissionINR: 120,
      verifiedCommissionINR: 120,
      status: 'COMMISSION_APPROVED',
      verificationSource: 'MANUAL_VERIFICATION',
      evidence: { harness: 'affiliate-simulation' },
    });
    expect(sim.status).toBe('COMMISSION_PENDING');
    expect(sim.verifiedCommissionINR).toBe(0);
    expect(sim.receivedCommissionINR).toBe(0);

    // Approve/pay on a simulated record must be refused outright.
    await expect(verifier.reconcileCommission({
      commissionId: sim.id, action: 'APPROVE', verifiedCommissionINR: 120,
      verificationSource: 'MANUAL_VERIFICATION', evidence: { by: 'owner' },
    })).rejects.toThrow(/SIMULATION_GUARD/);

    const revRows = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).all(sim.id) as any[];
    expect(revRows.length).toBe(0);

    const summary = await ledger.getSummary(ORG);
    expect(summary.verifiedRevenueINR).toBe(0);
    expect(summary.expectedCommissionINR).toBeGreaterThanOrEqual(120);
  });

  it('real provider-verified conversion creates exactly one REAL revenue record', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const tracker = ReferralTrackingEngine.getInstance();
    const verifier = ConversionVerificationAdapter.getInstance();
    const db = getDb();

    const partner = await registry.createPartner({
      organizationId: ORG, name: 'Amazon India Real', industry: 'Ecommerce',
      website: 'https://www.amazon.in', partnerType: 'AFFILIATE',
    });
    const offerDraft = await registry.createOffer({
      partnerId: partner.id, organizationId: ORG, title: 'Fire Stick', offerSlug: 'fire-stick-real',
      category: 'Electronics', targetCustomer: 'Streamers',
      commissionModel: 'PERCENTAGE', commissionAmountINR: 90,
      destinationUrl: 'https://www.amazon.in/dp/B0FIRE?tag=testsite-21',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B0FIRE?tag=testsite-21',
    });
    const offer = await registry.setOfferStatus(offerDraft.id, 'ACTIVE');
    const link = await tracker.createReferralLink(offer.id);

    const real = await verifier.reportConversion({
      partnerId: partner.id,
      referralId: link.referralId,
      externalTransactionId: 'amz_txn_9ZQ2_live_001',
      expectedCommissionINR: 90,
      status: 'COMMISSION_APPROVED',
      verificationSource: 'PARTNER_API',
      evidence: { networkReportId: 'epn-rep-2026-10-02', tag: 'testsite-21' },
    });
    expect(real.status).toBe('COMMISSION_APPROVED');
    expect(real.verifiedCommissionINR).toBe(90);

    const revRows = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).all(real.id) as any[];
    expect(revRows.length).toBe(1);
    expect(revRows[0].classification).toBe('REAL');
    expect(Number(revRows[0].amount_inr)).toBe(90);
  });
});
