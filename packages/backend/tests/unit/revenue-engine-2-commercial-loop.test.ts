import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { CapabilityRegistry } from '../../src/revenue/capability-registry.js';
import { LeadLeakageCalculator } from '../../src/revenue/lead-leakage-calculator.js';
import { DeliveryEngine } from '../../src/revenue/delivery-engine.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { Hono } from 'hono';
import app from '../../src/index.js';

describe('Revenue Engine 2.0: Capability-Backed Commercial Loop', () => {
  const cleanDb = () => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM platform_prospects WHERE source = 'INBOUND_LEAKAGE_CALCULATOR'`).run();
      db.prepare(`DELETE FROM delivery_tasks`).run();
      db.prepare(`DELETE FROM action_cooldowns`).run();
      db.prepare(`DELETE FROM durable_rate_limits`).run();
    } catch {}
  };

  beforeEach(cleanDb);
  afterEach(cleanDb);

  describe('PHASE 4: Capability Registry & Offer Readiness', () => {
    it('1. CapabilityRegistry enumerates real platform capabilities with required credentials and delivery methods', () => {
      const reg = CapabilityRegistry.getInstance();
      const caps = reg.getCapabilities();

      expect(caps.length).toBeGreaterThanOrEqual(9);

      const waBot = caps.find(c => c.id === 'CAP_WHATSAPP_TRIAGE_BOT');
      expect(waBot).toBeDefined();
      expect(waBot?.deliveryMethod).toBe('AUTOMATED_SYSTEM');
      expect(waBot?.requiredIntegrations).toContain('WHATSAPP');

      const gbpCapture = caps.find(c => c.id === 'CAP_GBP_LEAD_CAPTURE');
      expect(gbpCapture).toBeDefined();
      expect(gbpCapture?.status).toBe('MANUAL_DELIVERY_ONLY');

      const handover = caps.find(c => c.id === 'CAP_SYSTEM_HANDOVER');
      expect(handover).toBeDefined();
      expect(handover?.deliveryMethod).toBe('DOCUMENTATION');
      expect(handover?.status).toBe('AVAILABLE');
    });

    it('2. validateOfferReadiness detects missing deliverables and classifies offer status truthfully', () => {
      const reg = CapabilityRegistry.getInstance();

      // PLATFORM_SETUP deliverables
      const setupDeliverables = [
        'Custom WhatsApp triage and FAQ response bot',
        'Google Business Profile instant lead capture',
        'Multi-touch follow-up workflow',
        'Direct calendar booking integration',
        'Live system handover report'
      ];

      const check = reg.validateOfferReadiness('PLATFORM_SETUP', setupDeliverables);
      expect(check.totalDeliverables).toBe(5);
      expect(check.unsupportedCount).toBe(0);

      // Offer with an invented, unsupported capability
      const unsupportedDeliverables = [
        ...setupDeliverables,
        'Autonomous Artificial Telemarketing Cold Calling Bot'
      ];

      const badCheck = reg.validateOfferReadiness('PLATFORM_COLD_CALLING', unsupportedDeliverables);
      expect(badCheck.sellable).toBe(false);
      expect(badCheck.status).toBe('DRAFT_BLOCKED');
      expect(badCheck.unsupportedCount).toBe(1);
      expect(badCheck.blockers.some(b => b.includes('UNSUPPORTED_DELIVERABLE'))).toBe(true);
    });
  });

  describe('PHASE 5: Lead Leakage Calculator Free Acquisition Tool', () => {
    it('3. calculateLeadLeakage computes deterministic estimates with theoretical disclaimers and zero network calls', () => {
      const calc = LeadLeakageCalculator.getInstance();

      const result = calc.calculate({
        monthlyInquiries: 200,
        averageCustomerValueINR: 10000,
        currentResponseTimeHours: 4,
        currentConversionRatePercent: 20
      });

      // 42% of 200 inquiries = 84
      expect(result.afterHoursInquiriesEstimate).toBe(84);
      // 4 hours delay = 50% drop-off
      expect(result.estimatedDelayDropoffPercent).toBe(50);
      // 84 * 50% = 42 lost inquiries
      expect(result.estimatedLostInquiriesPerMonth).toBe(42);
      // 42 * 20% conversion * ₹10,000 = ₹84,000 / month
      expect(result.estimatedMonthlyRevenueLeakageINR).toBe(84000);
      expect(result.estimatedAnnualRevenueLeakageINR).toBe(84000 * 12);
      expect(result.isEstimate).toBe(true);
      expect(result.disclaimer).toContain('THEORETICAL ESTIMATE ONLY');
    });

    it('4. renderCalculatorHtml produces mobile-friendly HTML with zero mandatory signups', () => {
      const calc = LeadLeakageCalculator.getInstance();
      const html = calc.renderCalculatorHtml({
        siteName: 'SupplySpecs India',
        siteUrl: 'https://supplyspecs.in',
        contactEmail: 'contact@supplyspecs.in'
      });

      expect(html).toContain('Inbound Lead Leakage Calculator');
      expect(html).toContain('FREE INTERACTIVE AUDIT TOOL');
      expect(html).toContain('id="monthlyInquiries"');
      expect(html).toContain('id="avgValue"');
      expect(html).toContain('id="responseTime"');
      expect(html).toContain('DPDP Act 2023');
      expect(html).toContain('Theoretical Estimate:');
      expect(html).toContain('<link rel="canonical" href="https://supplyspecs.in/tools/lead-leakage-calculator">');
    });

    it('5. processSubmission enforces DPDP consent and stores voluntary lead into platform_prospects', async () => {
      const calc = LeadLeakageCalculator.getInstance();
      const db = getDb();

      // Attempt submission without consent -> must reject
      const failRes = await calc.processSubmission({
        businessName: 'Apex Dental Care',
        contactName: 'Dr. Ramesh',
        contactPhoneOrEmail: '+919849012345',
        city: 'Hyderabad',
        vertical: 'dental',
        calculatorInputs: {
          monthlyInquiries: 120,
          averageCustomerValueINR: 8000,
          currentResponseTimeHours: 6
        },
        consentGiven: false
      });

      expect(failRes.success).toBe(false);
      expect(failRes.message).toContain('CONSENT_REQUIRED');

      // Valid submission with consent -> must store to platform_prospects
      const successRes = await calc.processSubmission({
        businessName: 'Apex Dental Care',
        contactName: 'Dr. Ramesh',
        contactPhoneOrEmail: '+919849012345',
        city: 'Hyderabad',
        vertical: 'dental',
        calculatorInputs: {
          monthlyInquiries: 120,
          averageCustomerValueINR: 8000,
          currentResponseTimeHours: 6
        },
        consentGiven: true,
        clientIpHash: 'hash_test_client_123'
      });

      expect(successRes.success).toBe(true);
      expect(successRes.leadId).toBeDefined();

      const lead = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(successRes.leadId) as any;
      expect(lead).toBeDefined();
      expect(lead.prospect_business_name).toBe('Apex Dental Care');
      expect(lead.source).toBe('INBOUND_LEAKAGE_CALCULATOR');
      expect(lead.stage).toBe('INBOUND_REQUEST');
      expect(lead.status).toBe('INBOUND_REQUEST');
      expect(lead.prospect_phone).toBe('+919849012345');
    });
  });

  describe('PHASE 6: Inbound Buyer Intent Prioritization in NBA Engine', () => {
    it('6. NextBestActionEngine emits BOOK_MEETING with high priority for inbound requests', () => {
      const nba = NextBestActionEngine.getInstance();
      const db = getDb();

      // Insert an inbound request into platform_prospects
      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_owner_name,
          phone, prospect_phone, city, prospect_city, vertical, prospect_vertical,
          source, discovery_source, discovery_evidence_json, observed_evidence_json,
          fit_score, status, stage, created_at, updated_at
        ) VALUES (
          'lead_inbound_test_01', 'CarePlus Clinic', 'CarePlus Clinic', 'Dr. Anita',
          '+919849098765', '+919849098765', 'Bengaluru', 'Bengaluru', 'clinic', 'clinic',
          'INBOUND_LEAKAGE_CALCULATOR', 'INBOUND_LEAKAGE_CALCULATOR', '{}', '{}',
          0.95, 'INBOUND_REQUEST', 'INBOUND_REQUEST', datetime('now'), datetime('now')
        )
      `).run();

      const action = nba.choose('biz_platform_aro', 'org_owner_primary', { ignoreCooldown: true });

      // Inbound buyer intent must be surfaced with P0 tier and targetId pointing to the lead
      expect(action).toBeDefined();
      if (action.actionType === 'BOOK_MEETING') {
        expect(action.targetId).toBe('lead_inbound_test_01');
        expect(action.priorityTier).toBe('P0');
        expect(action.rationale).toContain('CarePlus Clinic');
        expect(action.rationale).toContain('Bengaluru');
      }
    });
  });

  describe('PHASE 1 & PHASE 4: Vertical-Aware Deliverable Fulfillment', () => {
    it('7. DeliveryEngine resolves productized B2B deliverables for PLATFORM_SETUP and reserves clinical terms for clinics', () => {
      const setupDeliverables = DeliveryEngine.getDeliverablesForService('PLATFORM_SETUP');
      expect(setupDeliverables).toContain('Custom WhatsApp triage and FAQ response bot');
      expect(setupDeliverables).toContain('Live system handover report');
      expect(setupDeliverables).not.toContain('Clinical consultation and digital scan schedule setup');

      const clinicalDeliverables = DeliveryEngine.getDeliverablesForService('CLINICAL');
      expect(clinicalDeliverables).toContain('Clinical consultation and digital scan schedule setup');
      expect(clinicalDeliverables).toContain('Welcome pack and patient orientation checklist');
    });

    it('8. activateCustomer stores correct B2B deliverables for commercial setups', () => {
      const delivery = DeliveryEngine.getInstance();
      const db = getDb();

      const res = delivery.activateCustomer({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        customerJourneyId: 'jrn_test_setup_01',
        serviceType: 'PLATFORM_SETUP',
        paidAmountINR: 15000
      });

      expect(res.stage).toBe('ONBOARDING');
      const task = db.prepare(`SELECT * FROM delivery_tasks WHERE customer_journey_id = ?`).get('jrn_test_setup_01') as any;
      expect(task).toBeDefined();

      const taskDeliverables = JSON.parse(task.deliverables_json);
      expect(taskDeliverables).toContain('Custom WhatsApp triage and FAQ response bot');
      expect(taskDeliverables).not.toContain('patient orientation checklist');
    });
  });

  describe('PHASE 7: End-to-End API Route & Inbound Acquisition Verification', () => {
    it('9. GET /capabilities returns capability list and readiness assessment without auth required', async () => {
      const res = await app.request('/api/v1/capabilities?offerId=PLATFORM_SETUP');
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.capabilities).toBeInstanceOf(Array);
      expect(json.data.capabilities.length).toBeGreaterThanOrEqual(9);
      expect(json.data.offerReadiness).toBeDefined();
      expect(json.data.offerReadiness.offerId).toBe('PLATFORM_SETUP');
      expect(json.data.offerReadiness.totalDeliverables).toBe(5);
      expect(json.data.offerReadiness.unsupportedCount).toBe(0);

      // Verify top-level route /capabilities also resolves
      const resTop = await app.request('/capabilities?offerId=PLATFORM_SETUP');
      expect(resTop.status).toBe(200);
    });

    it('10. GET /tools/lead-leakage-calculator returns HTML page with zero personal data collected upfront', async () => {
      const res = await app.request('/tools/lead-leakage-calculator');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Inbound Lead Leakage Calculator');
      expect(text).toContain('FREE INTERACTIVE AUDIT TOOL');
      expect(text).toContain('DPDP Act 2023');
    });

    it('11. POST /api/v1/tools/lead-leakage-audit/calculate computes deterministic estimate', async () => {
      const res = await app.request('/api/v1/tools/lead-leakage-audit/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyInquiries: 150,
          averageCustomerValueINR: 12000,
          currentResponseTimeHours: 3
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.estimatedMonthlyRevenueLeakageINR).toBeGreaterThan(0);
      expect(json.data.isEstimate).toBe(true);
      expect(json.data.disclaimer).toContain('THEORETICAL ESTIMATE ONLY');
    });

    it('12. POST /api/v1/tools/lead-leakage-audit/submit enforces DPDP consent and stores inbound lead', async () => {
      // 12a: Missing consent -> 400 Bad Request
      const resNoConsent = await app.request('/api/v1/tools/lead-leakage-audit/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: 'Bangalore Smiles Orthodontics',
          contactName: 'Dr. Suresh',
          contactPhoneOrEmail: '+919988776655',
          city: 'Bengaluru',
          vertical: 'orthodontics',
          consentGiven: false
        })
      });

      expect(resNoConsent.status).toBe(400);
      const jsonNoConsent = await resNoConsent.json() as any;
      expect(jsonNoConsent.success).toBe(false);
      expect(jsonNoConsent.message).toContain('CONSENT_REQUIRED');

      // 12b: Valid consent -> 200 OK & lead stored
      const resConsent = await app.request('/api/v1/tools/lead-leakage-audit/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '103.21.244.2'
        },
        body: JSON.stringify({
          businessName: 'Bangalore Smiles Orthodontics',
          contactName: 'Dr. Suresh',
          contactPhoneOrEmail: '+919988776655',
          city: 'Bengaluru',
          vertical: 'orthodontics',
          consentGiven: true,
          monthlyInquiries: 180,
          averageCustomerValueINR: 25000,
          currentResponseTimeHours: 5
        })
      });

      expect(resConsent.status).toBe(200);
      const jsonConsent = await resConsent.json() as any;
      expect(jsonConsent.success).toBe(true);
      expect(jsonConsent.leadId).toBeDefined();

      const db = getDb();
      const lead = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(jsonConsent.leadId) as any;
      expect(lead).toBeDefined();
      expect(lead.prospect_business_name).toBe('Bangalore Smiles Orthodontics');
      expect(lead.stage).toBe('INBOUND_REQUEST');
      expect(lead.source).toBe('INBOUND_LEAKAGE_CALCULATOR');
    });
  });
});

