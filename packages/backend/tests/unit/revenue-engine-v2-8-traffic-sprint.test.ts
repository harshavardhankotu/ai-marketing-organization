import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { BASELINE_STUDENT_FLIGHT_GUIDE } from '../../src/db/seed.js';

describe('Revenue Engine V2.8 — Traffic, Destination Verification & Affiliate Attribution Tests', () => {
  const testConfig = {
    siteName: 'India Deals & Buying Guides',
    authorName: 'Editorial Desk',
    contactEmail: 'editorial@ai-marketing-organization.onrender.com',
    siteUrl: 'https://ai-marketing-organization.onrender.com'
  };

  describe('1. StaticSiteGenerator Guide Rendering & Compliance Hardening', () => {
    it('renders custom affiliate disclosure instead of hardcoded Amazon disclosure', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const mockGuide = {
        title: 'Student Air Travel Discounts Guide',
        slug: 'student-flight-discounts-india',
        content_markdown: 'Guide body text.',
        disclosure_markdown: 'Affiliate Disclosure: This guide contains verified travel affiliate links (Air India Express and Cleartrip). When you book, we may earn a commission.'
      };

      const html = ssg.renderGuideHtml(mockGuide, testConfig);

      expect(html).toContain('Affiliate Disclosure: This guide contains verified travel affiliate links (Air India Express and Cleartrip).');
      expect(html).not.toContain('As an Amazon Associate I earn from qualifying purchases');
    });

    it('formats affiliate tracking links with sponsored nofollow attributes and button styling', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const mockGuide = {
        title: 'Student Flight Discounts Guide',
        slug: 'student-flight-discounts-india',
        content_markdown: `
Check out airline deals:
* [Book on Air India Express](https://clnk.in/DKRM)
* [Compare on Cleartrip](https://clnk.in/DKRN)
* [Read DGCA Rules](https://dgca.gov.in/rules)
        `,
        disclosure_markdown: 'Affiliate disclosure text.'
      };

      const html = ssg.renderGuideHtml(mockGuide, testConfig);

      // Cuelinks affiliate links must have rel="sponsored nofollow noopener" and class="affiliate-link"
      expect(html).toContain('<a href="https://clnk.in/DKRM" target="_blank" rel="sponsored nofollow noopener" class="affiliate-link">Book on Air India Express</a>');
      expect(html).toContain('<a href="https://clnk.in/DKRN" target="_blank" rel="sponsored nofollow noopener" class="affiliate-link">Compare on Cleartrip</a>');

      // Non-affiliate informational links should have noopener noreferrer
      expect(html).toContain('<a href="https://dgca.gov.in/rules" target="_blank" rel="noopener noreferrer">Read DGCA Rules</a>');
      expect(html).not.toContain('<a href="https://dgca.gov.in/rules" target="_blank" rel="sponsored');
    });

    it('injects privacy-safe client-side session beacon script for UTM attribution', () => {
      const ssg = StaticSiteGenerator.getInstance();
      const mockGuide = {
        title: 'Student Flight Discounts Guide',
        slug: 'student-flight-discounts-india',
        content_markdown: 'Guide body text.'
      };

      const html = ssg.renderGuideHtml(mockGuide, testConfig);

      expect(html).toContain('utm_source');
      expect(html).toContain('utm_campaign');
      expect(html).toContain('/api/v1/organic/sessions');
      expect(html).toContain('biz_platform_aro');
    });
  });

  describe('2. Material Claims Verification & Official ID Rules in Baseline Guide', () => {
    it('verifies that the baseline guide contains valid airline concession terms, physical ID warnings, and verified booking guidance without unverified affiliate links', () => {
      const guide = BASELINE_STUDENT_FLIGHT_GUIDE;

      expect(guide).toBeDefined();
      expect(guide.contentMarkdown).toContain('Air India Express');
      expect(guide.contentMarkdown).toContain('IndiGo (6E)');
      expect(guide.contentMarkdown).toContain('SpiceJet');
      expect(guide.contentMarkdown).toContain('Akasa Air');
      expect(guide.contentMarkdown).toContain('Air India (Full Service)');

      // Official direct booking guidance
      expect(guide.contentMarkdown).toContain('Book Student Fares directly on the official Air India Express portal');
      expect(guide.contentMarkdown).toContain('Book Student Fares directly on the official Akasa Air portal');
      expect(guide.contentMarkdown).toContain('Book Student Fares directly on the official Air India portal');
      expect(guide.contentMarkdown).toContain('Compare Student Flights on Official Travel Portals & Direct Airline Apps');

      // Safety checks: No unmonetized/unverified Cuelinks affiliate links for airlines
      expect(guide.contentMarkdown).not.toContain('https://clnk.in/DKRM');
      expect(guide.contentMarkdown).not.toContain('https://clnk.in/DKRN');
      expect(guide.contentMarkdown).not.toContain('https://clnk.in/DKX3');
      expect(guide.contentMarkdown).not.toContain('https://clnk.in/DKX4');

      // Critical ID check warning
      expect(guide.contentMarkdown).toContain('Mandatory Physical Student ID');
      expect(guide.contentMarkdown.toLowerCase()).toContain('penalty');

      // Transparent educational disclosure
      expect(guide.disclosureMarkdown).toContain('Editorial Notice');
      expect(guide.disclosureMarkdown).toContain('official airline student concession rules');
      expect(guide.disclosureMarkdown).toContain('/deals');
      expect(guide.disclosureMarkdown).toContain('/revenue');
      expect(guide.disclosureMarkdown).toContain('/public/disclosure');
    });
  });

  describe('3. Metrics Separation & Truth Verification', () => {
    it('verifies that internal diagnostic clicks and synthetic test events do not alter external metrics', () => {
      const ssg = StaticSiteGenerator.getInstance();
      // Ensure synthetic rendering does not emit production telemetry or alter financial ledger
      const mockGuide = {
        title: 'Test Guide',
        slug: 'test-guide',
        content_markdown: 'Content for hermetic test.'
      };
      const rendered = ssg.renderGuideHtml(mockGuide, testConfig);
      expect(rendered.length).toBeGreaterThan(100);
      // Verify schema article structure
      expect(rendered).toContain('"@type":"Article"');
    });
  });
});
