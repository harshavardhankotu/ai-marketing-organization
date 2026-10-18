import { describe, it, expect } from 'vitest';
import { lintContentAsset } from '../../src/commission/content-asset-engine.js';

describe('Step 7c: B2B Content Lint Gate Rules', () => {
  it('blocks content containing "AI will"', () => {
    const text = `
      # Clinical Triage Guide
      Our system is designed so that AI will automatically convert all patient inquiries into booked appointments.
      See our [Privacy Policy](/privacy). Commercial service disclosure: The owner sells a service.
    `;
    const res = lintContentAsset(text, { isB2B: true });
    expect(res.passed).toBe(false);
    expect(res.violations.some(v => v.includes('AI will'))).toBe(true);
  });

  it('blocks unsourced statistics and percentage improvements', () => {
    const text = `
      # Inbound Lead Guide
      Clinics experience a 45% increase in booked appointments within the first week.
      See our [Privacy Policy](/privacy). Commercial service disclosure: The owner sells a service.
    `;
    const res = lintContentAsset(text, { isB2B: true });
    expect(res.passed).toBe(false);
    expect(res.violations.some(v => v.includes('UNSOURCED_STATISTIC'))).toBe(true);
  });

  it('blocks exaggerated outcome claims and revenue multipliers', () => {
    const text = `
      # Practice Revenue Guide
      We help clinics double your revenue with guaranteed results and risk-free results.
      See our [Privacy Policy](/privacy). Commercial service disclosure: The owner sells a service.
    `;
    const res = lintContentAsset(text, { isB2B: true });
    expect(res.passed).toBe(false);
    expect(res.violations.some(v => v.includes('FORBIDDEN_OUTCOME_CLAIM'))).toBe(true);
  });

  it('blocks medical health and diagnosis claims', () => {
    const text = `
      # Patient Healthcare Management
      Our triage will diagnose dental caries and prescribe treatment protocols for patients.
      See our [Privacy Policy](/privacy). Commercial service disclosure: The owner sells a service.
    `;
    const res = lintContentAsset(text, { isB2B: true });
    expect(res.passed).toBe(false);
    expect(res.violations.some(v => v.includes('FORBIDDEN_HEALTH_CLAIM'))).toBe(true);
  });

  it('blocks prices not present in attested owner terms', () => {
    const text = `
      # Complete Setup Guide
      Get the entire lead management system for just ₹4,999 setup fee.
      See our [Privacy Policy](/privacy). Commercial service disclosure: The owner sells a service.
    `;
    const res = lintContentAsset(text, { isB2B: true, allowedPrices: [15000, 8000, 500] });
    expect(res.passed).toBe(false);
    expect(res.violations.some(v => v.includes('FORBIDDEN_PRICING'))).toBe(true);
  });

  it('passes compliant B2B content with attested prices, privacy link, and commercial disclosure', () => {
    const cleanB2B = `
      # How Clinics Can Eliminate Missed Patient Inquiries

      *Disclosure: The author provides commercial lead conversion automation systems for Indian clinics and businesses. For details on how data is handled, see our [Privacy Policy](/privacy).*

      ### The Problem: Patient Inquiries After Hours
      Local clinics and dental practices in India frequently miss prospective patient inquiries submitted in the evening or during peak clinical hours.

      ### A Free Method You Can Use Today (Zero Cost)
      1. Configure WhatsApp Business Away Message outside operating hours.
      2. Standardize Quick Replies for standard consultation fees (₹500).
      3. Set up a morning review routine for all overnight inquiries.

      ### Automated 24/7 Triage Option
      For clinics desiring automated 2-minute response and direct calendar integration, full custom setup is ₹15,000 one-time, followed by an optional ₹8,000 monthly retainer.
    `;
    const res = lintContentAsset(cleanB2B, { isB2B: true, allowedPrices: [15000, 8000, 500] });
    expect(res.passed).toBe(true);
    expect(res.violations).toHaveLength(0);
  });
});
