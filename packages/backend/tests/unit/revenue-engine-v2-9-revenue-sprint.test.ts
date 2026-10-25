import { describe, it, expect, beforeEach } from 'vitest';
import { BASELINE_STUDENT_FLIGHT_GUIDE } from '../../src/db/seed.js';
import { isAllowlistedRedirectHost } from '../../src/commission/referral-tracking.js';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';

describe('Revenue Engine V2.9 — Real Revenue Sprint Unit Tests', () => {
  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare('DELETE FROM referral_click_events WHERE referral_id LIKE ?').run('ref_org_%');
    } catch {}
  });

  describe('1. Baseline Student Flight Guide Monetization & Quality Gates', () => {
    it('verifies all 4 active commercial partners have verified links in the guide', () => {
      const guide = BASELINE_STUDENT_FLIGHT_GUIDE;

      expect(guide).toBeDefined();
      expect(guide.contentMarkdown).toContain('https://clnk.in/DKRM'); // Air India Express
      expect(guide.contentMarkdown).toContain('https://clnk.in/DKX3'); // Akasa Air
      expect(guide.contentMarkdown).toContain('https://clnk.in/DKX4'); // Air India
      expect(guide.contentMarkdown).toContain('https://clnk.in/DKRN'); // Cleartrip

      // IndiGo & SpiceJet context
      expect(guide.contentMarkdown).toContain('IndiGo (6E)');
      expect(guide.contentMarkdown).toContain('SpiceJet');
      expect(guide.contentMarkdown).toContain('Cleartrip');

      // Crucial verification rules
      expect(guide.contentMarkdown).toContain('Mandatory Physical Student ID');
      expect(guide.contentMarkdown).toContain('Airport Penalty for Missing ID');
      expect(guide.contentMarkdown).toContain('Base Fare vs Taxes');

      // Disclosure and navigation links
      expect(guide.disclosureMarkdown).toContain('Akasa Air');
      expect(guide.disclosureMarkdown).toContain('Air India');
      expect(guide.disclosureMarkdown).toContain('Air India Express');
      expect(guide.disclosureMarkdown).toContain('Cleartrip');
      expect(guide.disclosureMarkdown).toContain('/deals');
      expect(guide.disclosureMarkdown).toContain('/revenue');
      expect(guide.disclosureMarkdown).toContain('/public/disclosure');
    });
  });

  describe('2. Cuelinks clnk.in Short Domain Allowlist Security', () => {
    it('permits clnk.in and www.clnk.in for Cuelinks network redirects', () => {
      expect(isAllowlistedRedirectHost('https://clnk.in/DKRM', 'CUELINKS')).toBe(true);
      expect(isAllowlistedRedirectHost('https://clnk.in/DKX3', 'CUELINKS')).toBe(true);
      expect(isAllowlistedRedirectHost('https://www.clnk.in/DKX4', 'CUELINKS')).toBe(true);
      expect(isAllowlistedRedirectHost('https://linksredirect.com/?cid=331585', 'CUELINKS')).toBe(true);
      expect(isAllowlistedRedirectHost('https://cuelinks.com/campaigns', 'CUELINKS')).toBe(true);
    });

    it('rejects unapproved or spoofed domains for Cuelinks', () => {
      expect(isAllowlistedRedirectHost('https://malicious-site.com/fake', 'CUELINKS')).toBe(false);
      expect(isAllowlistedRedirectHost('https://clnk.in.attacker.org/steal', 'CUELINKS')).toBe(false);
      expect(isAllowlistedRedirectHost('http://clnk.in/insecure', 'CUELINKS')).toBe(false);
    });
  });

  describe('3. Outbound Affiliate Click Beacon (/api/v1/organic/affiliate-clicks)', () => {
    it('records genuine non-revenue outbound clicks with UTM attribution and hashed IP', async () => {
      const res = await app.request('/api/v1/organic/affiliate-clicks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          destinationUrl: 'https://clnk.in/DKX3',
          anchorText: 'Book Student Fares on Akasa Air',
          pageUrl: '/guides/student-flight-discounts-india',
          utmSource: 'reddit',
          utmMedium: 'community_post',
          utmCampaign: 'student_travel_q4'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.recorded).toBe(true);
      expect(json.data.isRevenue).toBe(false);
      expect(json.data.destinationUrl).toBe('https://clnk.in/DKX3');
      expect(json.data.ipHash).toBeDefined();

      // Verify row persisted in SQLite
      const db = getDb();
      const clickRow = db.prepare(
        "SELECT * FROM referral_click_events WHERE destination_url = ? AND placement = 'guide_outbound_click'"
      ).get('https://clnk.in/DKX3') as any;
      expect(clickRow).toBeDefined();
      expect(clickRow.source).toBe('reddit');
      expect(clickRow.medium).toBe('community_post');
      expect(clickRow.campaign).toBe('student_travel_q4');
    });

    it('rejects requests with missing destinationUrl', async () => {
      const res = await app.request('/api/v1/organic/affiliate-clicks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchorText: 'Click here' })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('MISSING_DESTINATION_URL');
    });

    it('ignores bot traffic without incrementing attribution counters', async () => {
      const res = await app.request('/api/v1/organic/affiliate-clicks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)'
        },
        body: JSON.stringify({
          destinationUrl: 'https://clnk.in/DKRM',
          pageUrl: '/guides/student-flight-discounts-india'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.recorded).toBe(false);
    });

    it('ignores synthetic test traffic without recording attribution event', async () => {
      const res = await app.request('/api/v1/organic/affiliate-clicks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-mode': 'true'
        },
        body: JSON.stringify({
          destinationUrl: 'https://clnk.in/DKRM',
          pageUrl: '/guides/student-flight-discounts-india'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.recorded).toBe(false);
    });
  });

  describe('4. Transparent Public Revenue Funnel (/api/v1/public/revenue-funnel)', () => {
    it('returns structured empirical metrics with zero cash promise', async () => {
      const res = await app.request('/api/v1/public/revenue-funnel', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();

      const funnel = json.data.funnel;
      expect(typeof funnel.verifiedExternalVisits).toBe('number');
      expect(typeof funnel.internalTestSessions).toBe('number');
      expect(typeof funnel.externalOutboundClicks).toBe('number');
      expect(typeof funnel.internalDiagnosticClicks).toBe('number');
      expect(typeof funnel.clickThroughRate).toBe('string');
      expect(typeof funnel.conversions).toBe('number');
      expect(typeof funnel.estimatedPendingCommissionINR).toBe('number');
      expect(typeof funnel.approvedCommissionINR).toBe('number');
      expect(funnel.bankCashReceivedINR).toBe(0);

      // Verify partner campaigns metadata
      expect(json.data.monetizedPartners.length).toBe(4);
      const partnerNames = json.data.monetizedPartners.map((p: any) => p.name);
      expect(partnerNames).toContain('Akasa Air');
      expect(partnerNames).toContain('Air India Express');
      expect(partnerNames).toContain('Air India');
      expect(partnerNames).toContain('Cleartrip Flight');

      // Verify accounting policies
      expect(json.data.accountingPolicies.cashRecognitionRule).toContain('strictly ₹0.00');
      expect(json.data.accountingPolicies.offlineAttributionNotice).toContain('48–72 hour delay');
    });
  });

  describe('5. Public Revenue Web Route (/revenue)', () => {
    it('renders clean HTML dashboard with live metrics, disclosures, and zero false claims', async () => {
      const res = await app.request('/revenue', {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Transparent Public Revenue Funnel');
      expect(html).toContain('Cash Received in Bank');
      expect(html).toContain('₹0.00');
      expect(html).toContain('Akasa Air');
      expect(html).toContain('Air India Express');
      expect(html).toContain('Air India');
      expect(html).toContain('Cleartrip Flights');
      expect(html).toContain('Offline Attribution Delay');
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/guides/student-flight-discounts-india"');
    });
  });
});
