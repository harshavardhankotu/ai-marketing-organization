import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository, D1_REVENUE_CRITICAL_TABLES } from '../../src/db/d1-revenue-repository.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import app from '../../src/index.js';

describe('V5.2 — First Genuine Customer, Revenue Activation & Autonomous Operations', () => {
  const discEngine = PlatformProspectDiscoveryEngine.getInstance();
  const d1Repo = D1RevenueRepository.getInstance();
  const digestService = OwnerDigestService.getInstance();

  beforeEach(() => {
    vi.spyOn(DurableRateLimiter.getInstance(), 'checkRateLimit').mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 100,
      resetAt: new Date(Date.now() + 60000).toISOString()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Priority Zero — Production Data Durability & D1 Suppression List', () => {
    it('1a. registers direct_outreach_log and outreach_suppression_list in D1_REVENUE_CRITICAL_TABLES', () => {
      expect(D1_REVENUE_CRITICAL_TABLES).toContain('direct_outreach_log');
      expect(D1_REVENUE_CRITICAL_TABLES).toContain('outreach_suppression_list');
    });

    it('1b. persists suppressions durably and checks phone, email, and domain accurately', async () => {
      const db = getDb();
      try {
        db.prepare("DELETE FROM outreach_suppression_list WHERE identifier IN ('9849011111', 'optout@testclinic.in', 'testoptoutclinic.in')").run();
      } catch {}

      expect(discEngine.isContactSuppressed('9849011111')).toBe(false);

      await discEngine.suppressContact('+91 98490 11111', 'PHONE', 'OPTOUT', 60);
      await discEngine.suppressContact('optout@testclinic.in', 'EMAIL', 'OPTOUT', 60);
      await discEngine.suppressContact('https://testoptoutclinic.in/contact', 'DOMAIN', 'OPTOUT', 60);

      expect(discEngine.isContactSuppressed('+91 98490 11111')).toBe(true);
      expect(discEngine.isContactSuppressed(undefined, 'optout@testclinic.in')).toBe(true);
      expect(discEngine.isContactSuppressed(undefined, undefined, 'testoptoutclinic.in')).toBe(true);
      expect(await discEngine.isContactSuppressedAsync('+91 98490 11111')).toBe(true);
      expect(await discEngine.isContactSuppressedAsync(undefined, 'optout@testclinic.in')).toBe(true);
      expect(await discEngine.isContactSuppressedAsync(undefined, undefined, 'testoptoutclinic.in')).toBe(true);
      expect(discEngine.isContactSuppressed('9999999999')).toBe(false);
    });

    it('1c. fail-closed invariant: rejects approve and record-dispatch if recipient is in outreach_suppression_list', async () => {
      const db = getDb();
      const testDraftId = 'dlog_test_suppressed_clinic_com';
      try {
        db.prepare('DELETE FROM direct_outreach_log WHERE id = ?').run(testDraftId);
        db.prepare('DELETE FROM outreach_suppression_list WHERE identifier = ?').run('suppressedclinic.com');
      } catch {}

      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved, dispatched,
          response_status, created_at
        ) VALUES (?, 'biz_test', 'HEALTHCARE_DENTAL_SMB', 'Suppressed Test Clinic', 'WHATSAPP', 'Hello Doctor', 1, 0, 0, 'APPROVAL_REQUIRED', datetime('now'))
      `).run(testDraftId);

      // Now add to suppression list
      await discEngine.suppressContact('Suppressed Test Clinic', 'DOMAIN', 'OPTOUT', 60);

      // Attempt to approve
      const resApprove = await app.request(`/api/v1/owner/direct-outreach/${testDraftId}/approve`, {
        method: 'POST',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      // Should reject approval with 400
      expect(resApprove.status).toBe(400);
      const jsonApprove = await resApprove.json();
      expect(jsonApprove.success).toBe(false);
      expect(jsonApprove.error).toContain('outreach_suppression_list');

      // Attempt to record-dispatch
      const resDispatch = await app.request(`/api/v1/owner/direct-outreach/${testDraftId}/record-dispatch`, {
        method: 'POST',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      expect(resDispatch.status).toBe(400);
      const jsonDispatch = await resDispatch.json();
      expect(jsonDispatch.success).toBe(false);
      expect(jsonDispatch.error).toContain('outreach_suppression_list');
    });
  });

  describe('2. Priority One & Two — Researched Prospect Shortlist & Outreach Gate', () => {
    it('2a. seeds the curated qualified prospect batch with 10 independent dental clinics in Hyderabad', async () => {
      await discEngine.ensureCuratedQualifiedProspectBatch();
      const db = getDb();

      // Check independent Hyderabad dental practices
      const independentDrafts = db.prepare(`
        SELECT id, prospect_name, response_status, channel, human_approved, dispatched 
        FROM direct_outreach_log 
        WHERE response_status = 'APPROVAL_REQUIRED' AND segment = 'HEALTHCARE_DENTAL_SMB'
      `).all() as any[];

      expect(independentDrafts.length).toBeGreaterThanOrEqual(10);
      for (const d of independentDrafts) {
        expect(d.human_approved).toBe(0);
        expect(d.dispatched).toBe(0);
        expect(d.channel).toBe('WHATSAPP');
      }

      // Check specific verified clinics
      const names = independentDrafts.map(d => d.prospect_name);
      expect(names).toContain('The Dental Specialists');
      expect(names).toContain('Hyderabad Smiles Dental Clinic');
      expect(names).toContain('Capture Life Dental Care');
      expect(names).toContain('Siri Dental Hospital');
      expect(names).toContain("Dr. Gowd's Dental Hospitals");
      expect(names).toContain('Secunderabad Dental Hospital');
      expect(names).toContain('aRdent Dental Care');
      expect(names).toContain('Park Dental Care');
      expect(names).toContain('Healthy Smile Dental Clinic');
      expect(names).toContain('Smile Signature Dental Clinic');
    });

    it('2b. enforces quarantine and enterprise chain deferral', () => {
      const db = getDb();
      const deferred = db.prepare(`
        SELECT prospect_name, response_status 
        FROM direct_outreach_log 
        WHERE response_status = 'ENTERPRISE_CHAIN_DEFERRED'
      `).all() as any[];
      const quarantined = db.prepare(`
        SELECT prospect_name, response_status 
        FROM direct_outreach_log 
        WHERE response_status = 'QUARANTINED'
      `).all() as any[];

      const deferredNames = deferred.map(d => d.prospect_name);
      expect(deferredNames).toContain('Partha Dental Skin Hair Clinic');
      expect(deferredNames).toContain('FMS Dental Hospitals');
      expect(deferredNames).toContain('Clove Dental Clinic & Implant Center');
      expect(deferredNames).toContain('Apollo White Dental');
      expect(deferredNames).toContain('Vasan Dental Care');

      const quarantinedNames = quarantined.map(d => d.prospect_name);
      expect(quarantinedNames).toContain('Roots Dental Clinic');
    });

    it('2c. draft messages contain personalized observations, demo link, and opt-out mechanism', () => {
      const db = getDb();
      const curatedNames = [
        'Secunderabad Dental Hospital',
        'The Dental Specialists',
        'aRdent Dental Care',
        'Park Dental Care',
        'Healthy Smile Dental Clinic',
        'Smile Signature Dental Clinic',
        'Hyderabad Smiles Dental Clinic',
        'Capture Life Dental Care',
        'Siri Dental Hospital',
        "Dr. Gowd's Dental Hospitals"
      ];
      const placeholders = curatedNames.map(() => '?').join(',');
      const drafts = db.prepare(`
        SELECT message_draft FROM direct_outreach_log 
        WHERE prospect_name IN (${placeholders}) AND response_status = 'APPROVAL_REQUIRED'
      `).all(...curatedNames) as any[];

      expect(drafts.length).toBeGreaterThanOrEqual(10);
      for (const d of drafts) {
        expect(d.message_draft).toContain('https://ai-marketing-organization.onrender.com/#interactive-demo');
        expect(d.message_draft).toContain('opt out');
        expect(d.message_draft).toContain('WhatsApp');
      }
    });

    it('2d. deduplication: normalized domain prevents duplicate draft records', async () => {
      const db = getDb();
      const rowsBefore = (db.prepare(`SELECT COUNT(*) as c FROM direct_outreach_log WHERE segment = 'HEALTHCARE_DENTAL_SMB'`).get() as any)?.c;

      // Run seeding again
      await discEngine.ensureCuratedQualifiedProspectBatch();

      const rowsAfter = (db.prepare(`SELECT COUNT(*) as c FROM direct_outreach_log WHERE segment = 'HEALTHCARE_DENTAL_SMB'`).get() as any)?.c;
      expect(rowsAfter).toBe(rowsBefore);
    });
  });

  describe('3. Priority Three — Demo-to-Customer Conversion & Inquiry Form', () => {
    it('3a. validates consent and mobile phone on /offer/inquiry', async () => {
      // Missing consent
      const resNoConsent = await app.request('/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Valid Doctor',
          customerPhone: '9876543210',
          clinicName: 'Valid Clinic'
        })
      });
      expect(resNoConsent.status).toBe(400);

      // Short phone (< 10 digits)
      const resShortPhone = await app.request('/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Valid Doctor',
          customerPhone: '98765',
          clinicName: 'Valid Clinic',
          consentGiven: true
        })
      });
      expect(resShortPhone.status).toBe(400);
      const jsonShort = await resShortPhone.json();
      expect(jsonShort.error).toContain('10 to 15 digit');

      // Valid inquiry
      const resValid = await app.request('/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Genuine Practice',
          customerPhone: '9849012345',
          customerEmail: 'doctor@genuinepractice.in',
          clinicName: 'Genuine Practice Hyderabad',
          notes: 'Interested in evening WhatsApp appointment capture',
          consentGiven: true
        })
      });
      expect(resValid.status).toBe(200);
      const jsonValid = await resValid.json();
      expect(jsonValid.success).toBe(true);
      expect(jsonValid.status).toBe('PENDING_OWNER_REVIEW');
    });
  });

  describe('4. Priority Seven — Owner Dashboard /owner/today', () => {
    it('4a. excludes suppressed, quarantined, and enterprise deferred from pending outreach queue', async () => {
      const digest = await digestService.generateDigestAsync();
      const pending = digest.pendingOutreachDrafts || [];

      for (const p of pending) {
        expect(p.prospectName).not.toContain('Partha Dental');
        expect(p.prospectName).not.toContain('FMS Dental');
        expect(p.prospectName).not.toContain('Roots Dental');
        expect(p.prospectName).not.toContain('Clove Dental');
        expect(p.prospectName).not.toContain('Apollo White');
      }
    });

    it('4b. renders Commercial Operations & Revenue Reality summary in HTML', async () => {
      const digest = await digestService.generateDigestAsync();
      const html = digestService.renderHtml(digest);

      expect(html).toContain('Commercial Reality &amp; Operations Centre');
      expect(html).toContain('Bank Cash Received');
      expect(html).toContain('₹0.00');
      expect(html).toContain('Paid Ad Spend');
      expect(html).toContain('Human Dispatched');
      expect(html).toContain('Demos Completed');
      expect(html).toContain('10');
      expect(html).toContain('Qualified Dental SMBs in Hyderabad');
      expect(html).toContain('5');
      expect(html).toContain('Enterprise Chains Deferred');
    });
  });
});
