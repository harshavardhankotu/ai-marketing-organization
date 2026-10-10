import { describe, it, expect } from 'vitest';
import { maskAffiliateTag, formatPartnerStatus } from '../../src/security/sanitizer.js';

describe('Secret and Label Hygiene (Step 4)', () => {
  describe('1. Affiliate Tag Masking in Evidence JSON and Strings', () => {
    it('masks raw tag occurrences in JSON string', () => {
      const rawEvidenceJson = JSON.stringify({
        tag: 'marketing98-21',
        tag_status: 'FORMAT_VALID',
        operator_confirmed: true
      });

      const masked = maskAffiliateTag(rawEvidenceJson);
      expect(masked).not.toContain('marketing98-21');
      expect(masked).toContain('[MASKED_AFFILIATE_TAG]');
      expect(masked).toContain('FORMAT_VALID');
    });

    it('masks URL affiliate tags in tracking strings', () => {
      const trackingUrl = 'https://www.amazon.in/dp/B08P13WGLX?tag=marketing98-21&linkCode=osi';
      const masked = maskAffiliateTag(trackingUrl);
      expect(masked).not.toContain('marketing98-21');
      expect(masked).toContain('tag=[MASKED_AFFILIATE_TAG]');
    });

    it('masks nested partner evidence objects', () => {
      const partnerObj = {
        name: 'Amazon India Associates',
        evidence_json: '{"tag":"marketing98-21","status":"VALID"}',
        tag: 'marketing98-21'
      };

      const sanitized = maskAffiliateTag(partnerObj);
      expect(sanitized.tag).toBe('[MASKED_AFFILIATE_TAG]');
      expect(sanitized.evidence_json).not.toContain('marketing98-21');
    });
  });

  describe('2. Amazon Partner Status Display (Step 4b)', () => {
    it('shows PROVISIONAL for Amazon and never APPROVED alone', () => {
      const amazonPartner = {
        name: 'Amazon India Associates',
        network: 'AMAZON_ASSOCIATES',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED'
      };

      const statusDisplay = formatPartnerStatus(amazonPartner);
      expect(statusDisplay).toBe('PROVISIONAL (OPERATOR_CONFIRMED)');
      expect(statusDisplay).not.toBe('APPROVED');
    });

    it('preserves non-Amazon partner statuses accurately', () => {
      const ebayPartner = {
        name: 'eBay Partner Network',
        network: 'EBAY_PARTNER_NETWORK',
        approvalStatus: 'PENDING',
        authorizationStatus: 'PENDING_REVIEW'
      };

      const statusDisplay = formatPartnerStatus(ebayPartner);
      expect(statusDisplay).toBe('PENDING');
    });
  });
});
