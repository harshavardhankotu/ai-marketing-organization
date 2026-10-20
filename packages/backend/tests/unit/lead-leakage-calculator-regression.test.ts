import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LeadLeakageCalculator } from '../../src/revenue/lead-leakage-calculator.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { DPDPComplianceManager } from '../../src/compliance/dpdp-manager.js';
import { getDb } from '../../src/db/client.js';

describe('LeadLeakageCalculator Regression & Inquiry Integration Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    const db = getDb();
    // Clean up test prospect records
    db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'prosp_test_%' OR prospect_business_name LIKE '%Test%'`).run();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    const db = getDb();
    db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'prosp_test_%' OR prospect_business_name LIKE '%Test%'`).run();
  });

  describe('1. Public Acquisition Page Truth & Attestation Gating', () => {
    it('when offer is unattested: omits unconfirmed price, 5-day SLA, and 2-minute guarantees', () => {
      // Ensure offer is NOT attested
      delete process.env.OWN_OFFER_CONFIRMED;
      delete process.env.DIRECT_OFFER_TERMS_SHA256;
      expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);

      const calc = LeadLeakageCalculator.getInstance();
      const html = calc.renderCalculatorHtml({
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com',
        contactEmail: null
      });

      // Assert that unconfirmed commercial promises do NOT appear
      expect(html).not.toContain('₹15,000 Setup');
      expect(html).not.toContain('5 business days');
      expect(html).not.toContain('Automated 2-Minute Triage');

      // Assert that safe neutral technical overview and manual review appear
      expect(html).toContain('Explore Inbound Lead Triage Architecture');
      expect(html).toContain('View Technical Overview');
      expect(html).toContain('Request a Manual Inquiry-Flow Review');
      expect(html).toContain('Theoretical Estimate Only');
      expect(html).toContain('Theoretical Estimate:');

      // Assert that without contactEmail, no unconfigured mailto link is created
      expect(html).not.toContain('mailto:contact@aimarketing.org');
      expect(html).not.toContain('mailto:null');
    });

    it('when offer is attested: renders commercial offer link and pricing', () => {
      // Simulate attested offer
      const computedHash = DirectCommercialOfferPage.computeOwnOfferHash();
      if (computedHash) {
        process.env.OWN_OFFER_CONFIRMED = 'true';
        process.env.DIRECT_OFFER_TERMS_SHA256 = computedHash;

        const calc = LeadLeakageCalculator.getInstance();
        const html = calc.renderCalculatorHtml({
          siteName: 'AI Marketing Organization',
          siteUrl: 'https://ai-marketing-organization.onrender.com',
          contactEmail: 'owner@verified.com'
        });

        expect(html).toContain('View Commercial Offer &amp; Pricing');
        expect(html).toContain('mailto:owner@verified.com');
      }
    });

    it('renders contactEmail only when explicitly provided', () => {
      const calc = LeadLeakageCalculator.getInstance();

      const htmlWithEmail = calc.renderCalculatorHtml({
        siteName: 'Test Clinic Org',
        siteUrl: 'https://test.example.com',
        contactEmail: 'dr.sharma@clinic.example'
      });
      expect(htmlWithEmail).toContain('mailto:dr.sharma@clinic.example');

      const htmlWithoutEmail = calc.renderCalculatorHtml({
        siteName: 'Test Clinic Org',
        siteUrl: 'https://test.example.com',
        contactEmail: null
      });
      expect(htmlWithoutEmail).not.toContain('mailto:');
    });
  });

  describe('2. Deterministic Mathematical Calculations', () => {
    it('computes after-hours volume and leakage deterministically without AI', () => {
      const calc = LeadLeakageCalculator.getInstance();
      const output = calc.calculate({
        monthlyInquiries: 100,
        averageCustomerValueINR: 5000,
        currentResponseTimeHours: 4
      });

      expect(output.monthlyInquiries).toBe(100);
      expect(output.afterHoursSharePercent).toBe(42);
      expect(output.afterHoursInquiriesEstimate).toBe(42);
      expect(output.estimatedDelayDropoffPercent).toBe(50);
      expect(output.estimatedLostInquiriesPerMonth).toBe(21);
      expect(output.estimatedMonthlyRevenueLeakageINR).toBe(15750);
      expect(output.estimatedAnnualRevenueLeakageINR).toBe(189000);
      expect(output.isEstimate).toBe(true);
      expect(output.disclaimer).toContain('THEORETICAL ESTIMATE ONLY');
    });

    it('handles boundary inputs gracefully', () => {
      const calc = LeadLeakageCalculator.getInstance();

      const sub15Min = calc.calculate({
        monthlyInquiries: 50,
        averageCustomerValueINR: 2000,
        currentResponseTimeHours: 0.1
      });
      expect(sub15Min.estimatedDelayDropoffPercent).toBe(5);

      const delayOver12h = calc.calculate({
        monthlyInquiries: 50,
        averageCustomerValueINR: 2000,
        currentResponseTimeHours: 16
      });
      expect(delayOver12h.estimatedDelayDropoffPercent).toBe(70);
    });
  });

  describe('3. Inbound Lead Submission & DPDP Act 2023 Enforcement', () => {
    it('rejects submissions where consentGiven is false', async () => {
      const calc = LeadLeakageCalculator.getInstance();
      const result = await calc.processSubmission({
        businessName: 'Test Dental Clinic',
        contactName: 'Dr. Ramesh',
        contactPhoneOrEmail: '9849012345',
        city: 'Hyderabad',
        vertical: 'dental',
        calculatorInputs: {
          monthlyInquiries: 100,
          averageCustomerValueINR: 5000,
          currentResponseTimeHours: 4
        },
        consentGiven: false
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('CONSENT_REQUIRED');
    });

    it('rejects submissions with invalid contact information', async () => {
      const calc = LeadLeakageCalculator.getInstance();
      const result = await calc.processSubmission({
        businessName: 'Test Dental Clinic',
        contactName: 'Dr. Ramesh',
        contactPhoneOrEmail: '123',
        city: 'Hyderabad',
        vertical: 'dental',
        calculatorInputs: {
          monthlyInquiries: 100,
          averageCustomerValueINR: 5000,
          currentResponseTimeHours: 4
        },
        consentGiven: true
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('INVALID_CONTACT');
    });

    it('persists valid voluntary submissions to platform_prospects with correct taxonomy', async () => {
      const calc = LeadLeakageCalculator.getInstance();
      const result = await calc.processSubmission({
        businessName: 'Dr. Test Dental Clinic',
        contactName: 'Dr. Test Suresh',
        contactPhoneOrEmail: '+919876543210',
        city: 'Hyderabad',
        vertical: 'dental',
        calculatorInputs: {
          monthlyInquiries: 80,
          averageCustomerValueINR: 6000,
          currentResponseTimeHours: 5
        },
        consentGiven: true
      });

      expect(result.success).toBe(true);
      expect(result.leadId).toBeDefined();

      const db = getDb();
      const row = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(result.leadId) as any;
      expect(row).toBeDefined();
      expect(row.source).toBe('INBOUND_LEAKAGE_CALCULATOR');
      expect(row.discovery_source).toBe('INBOUND_LEAKAGE_CALCULATOR');
      expect(row.status).toBe('INBOUND_REQUEST');
      expect(row.stage).toBe('INBOUND_REQUEST');
      expect(row.prospect_phone).toBe('+919876543210');
      expect(row.prospect_business_name).toBe('Dr. Test Dental Clinic');
    });
  });

  describe('4. End-to-End Inquiry Surfacing in Owner Digest', () => {
    it('surfaces INBOUND_LEAKAGE_CALCULATOR submissions in OwnerDigestService inquiries', async () => {
      const db = getDb();
      const testLeadId = `prosp_test_${Date.now()}`;
      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_owner_name,
          phone, prospect_phone, city, prospect_city, vertical, prospect_vertical,
          source, discovery_source, discovery_evidence_json, observed_evidence_json,
          fit_score, status, stage, is_test, created_at, updated_at
        ) VALUES (
          ?, 'Test Hyderabad Dental Care', 'Test Hyderabad Dental Care', 'Dr. Test Rao',
          '9849098490', '9849098490', 'Hyderabad', 'Hyderabad', 'dental', 'dental',
          'INBOUND_LEAKAGE_CALCULATOR', 'INBOUND_LEAKAGE_CALCULATOR', '{}', '{}',
          0.95, 'INBOUND_REQUEST', 'INBOUND_REQUEST', 0, datetime('now'), datetime('now')
        )
      `).run(testLeadId);

      const digestService = OwnerDigestService.getInstance();
      const digest = digestService.generateDigest();

      const matching = digest.inquiries.find(i => i.id === testLeadId);
      expect(matching).toBeDefined();
      expect(matching?.customerName).toBe('Dr. Test Rao');
      expect(matching?.clinicName).toBe('Test Hyderabad Dental Care');
      expect(matching?.replyOnWhatsAppUrl).toContain('wa.me/919849098490');

      // Async digest should also find it
      const asyncDigest = await digestService.generateDigestAsync();
      const asyncMatching = asyncDigest.inquiries.find(i => i.id === testLeadId);
      expect(asyncMatching).toBeDefined();
    });
  });

  describe('5. DPDP Act 2023 Retention Purge', () => {
    it('purges INBOUND_LEAKAGE_CALCULATOR inquiries older than retention threshold', () => {
      const db = getDb();
      const oldDate = new Date(Date.now() - 35 * 24 * 3600 * 1000).toISOString();
      const oldTestId = `prosp_test_old_${Date.now()}`;

      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_owner_name,
          phone, prospect_phone, email, prospect_email, city, prospect_city,
          vertical, prospect_vertical, source, discovery_source, discovery_evidence_json,
          observed_evidence_json, fit_score, status, stage, is_test, created_at, updated_at
        ) VALUES (
          ?, 'Old Test Clinic', 'Old Test Clinic', 'Dr. Old Person',
          '9999999999', '9999999999', 'old@test.com', 'old@test.com', 'Hyderabad', 'Hyderabad',
          'dental', 'dental', 'INBOUND_LEAKAGE_CALCULATOR', 'INBOUND_LEAKAGE_CALCULATOR', '{}',
          '{}', 0.95, 'INBOUND_REQUEST', 'INBOUND_REQUEST', 0, ?, ?
        )
      `).run(oldTestId, oldDate, oldDate);

      const purgeResult = DPDPComplianceManager.getInstance().purgeExpiredInquiries(30);
      expect(purgeResult.purgedCount).toBeGreaterThanOrEqual(1);

      const purgedRow = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(oldTestId) as any;
      expect(purgedRow.status).toBe('PURGED_RETENTION_EXPIRED');
      expect(purgedRow.phone).toBeNull();
      expect(purgedRow.email).toBeNull();
      expect(purgedRow.prospect_owner_name).toBe('[PURGED_RETENTION_EXPIRED]');
    });
  });
});
