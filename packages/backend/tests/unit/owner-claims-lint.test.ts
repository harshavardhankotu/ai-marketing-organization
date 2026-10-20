import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

// Import from scripts/lint-owner-claims.mjs
// @ts-ignore
import {
  checkOwnerClaimsContent,
  checkOwnerClaimsFile,
  lintOwnerClaimsDirectory,
  validateSourceMarker,
} from '../../../../scripts/lint-owner-claims.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getOwnerPath = (sub: string = '') => {
  const fromCwd = path.resolve(process.cwd(), 'owner', sub);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, '../../../../owner', sub);
};

describe('Step 2: Durable Owner Claims Lint Guardrail', () => {
  describe('1. validateSourceMarker helper', () => {
    it('validates legitimate HTTP and HTTPS URLs', () => {
      expect(validateSourceMarker('SOURCE: https://hbr.org/2011/03/the-short-life-of-online-sales-leads').valid).toBe(true);
      expect(validateSourceMarker('SOURCE: http://example.com/source').valid).toBe(true);
    });

    it('rejects malformed or empty URLs', () => {
      expect(validateSourceMarker('').valid).toBe(false);
      expect(validateSourceMarker('SOURCE: not-a-url').valid).toBe(false);
      expect(validateSourceMarker('SOURCE: ftp://invalid-scheme.org').valid).toBe(false);
    });

    it('validates substantive OWNER_MEASURED markers', () => {
      expect(validateSourceMarker('OWNER_MEASURED: Day 1 reception call and WhatsApp intake audit').valid).toBe(true);
      expect(validateSourceMarker('OWNER_MEASURED: 2026 intake audit of reception desk phone logs').valid).toBe(true);
    });

    it('rejects empty or trivial OWNER_MEASURED markers (< 8 characters)', () => {
      expect(validateSourceMarker('OWNER_MEASURED:').valid).toBe(false);
      expect(validateSourceMarker('OWNER_MEASURED: abc').valid).toBe(false);
    });
  });

  describe('2. Failing examples (flags unsourced commercial claims)', () => {
    it('flags unsourced evening inquiry delay claim', () => {
      const content = `
# Sample Pitch
Inquiry response delay of 4–12 hours when reaching out after hours.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('RESPONSE_DELAY_HOURS');
      expect(errors[0].line).toBe(3);
    });

    it('flags unsourced commercial percentage statistics', () => {
      const content = `
# Statistics
According to benchmarks, over 40% of patient inquiries arrive outside standard office hours.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('COMMERCIAL_PERCENTAGE');
    });

    it('flags unsourced time-to-first-rupee promises', () => {
      const content = `
# Timeline
Time to first rupee: 1–2 weeks from pilot launch.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('DELIVERY_TIMELINE_PROMISE');
    });

    it('flags unsourced result timeline promises', () => {
      const content = `
# Performance
ROI guaranteed in 30 days of setup.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('RESULT_TIMELINE_PROMISE');
    });

    it('flags unfounded 100% attribution certainty claims', () => {
      const content = `
# Attribution
We provide 100% attribution certainty on all patient conversions.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('ATTRIBUTION_CERTAINTY');
    });

    it('flags lead/patient quantity guarantees', () => {
      const content = `
# Volume Guarantee
Guaranteed 50 leads every single month.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].claimType).toBe('QUANTITY_GUARANTEE');
    });
  });

  describe('3. Passing examples with valid source markers', () => {
    it('passes claim with valid SOURCE: URL marker', () => {
      const content = `
# Cited Statistic
According to industry research, over 40% of leads drop off when response is delayed.
(SOURCE: https://hbr.org/2011/03/the-short-life-of-online-sales-leads)
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors).toEqual([]);
    });

    it('passes claim with valid OWNER_MEASURED marker', () => {
      const content = `
# Owner Measured Finding
In our Day 1 intake audit, we measure your clinic's exact after-hours inquiry volume and response delay directly from your reception logs (OWNER_MEASURED: Day 1 reception call and WhatsApp intake audit). Every un-replied evening inquiry risks becoming a lost patient chair.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors).toEqual([]);
    });
  });

  describe('4. Boundary cases and false-positive resilience', () => {
    it('does not flag claims inside markdown code fences', () => {
      const content = `
# Code Example
\`\`\`markdown
Time to first rupee: 1–2 weeks. Over 40% of inquiries drop off.
\`\`\`
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors).toEqual([]);
    });

    it('does not flag negative prohibitions (e.g. "NEVER promise 100% conversion")', () => {
      const content = `
# Prohibitions
- NEVER promise 100% attribution certainty.
- Do NOT guarantee 50 leads per month.
- Avoid claiming inquiry delay of 4 hours without measurement.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors).toEqual([]);
    });

    it('does not flag standard operating hour clock ranges or dates', () => {
      const content = `
# Clinic Operating Hours
- Clinic hours: 9:30 AM – 8:00 PM Monday through Saturday.
- Staff available between 9:00 AM and 6:00 PM.
- Handover date: October 20, 2026.
      `;
      const errors = checkOwnerClaimsContent(content, 'test.md');
      expect(errors).toEqual([]);
    });

    it('exempts historical archive file OWN_OFFER.legacy_agent_written.md', () => {
      const content = `
# Historical Agent Written Offer
Time to first rupee: 1–2 weeks. 100% attribution certainty.
      `;
      const errors = checkOwnerClaimsContent(content, 'OWN_OFFER.legacy_agent_written.md');
      expect(errors).toEqual([]);
    });
  });

  describe('5. Real owner/ directory verification', () => {
    it('verifies owner/PILOT_DELIVERY_SPEC.md has 0 unsourced commercial claims', () => {
      const specPath = getOwnerPath('PILOT_DELIVERY_SPEC.md');
      expect(fs.existsSync(specPath)).toBe(true);
      const errors = checkOwnerClaimsFile(specPath);
      expect(errors).toEqual([]);
    });

    it('verifies owner/PILOT_SALES_KIT.md has 0 unsourced commercial claims', () => {
      const kitPath = getOwnerPath('PILOT_SALES_KIT.md');
      expect(fs.existsSync(kitPath)).toBe(true);
      const errors = checkOwnerClaimsFile(kitPath);
      expect(errors).toEqual([]);
    });

    it('verifies all files in owner/ directory pass the claims lint', () => {
      const result = lintOwnerClaimsDirectory(getOwnerPath());
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.checkedCount).toBeGreaterThanOrEqual(5);
    });
  });
});
