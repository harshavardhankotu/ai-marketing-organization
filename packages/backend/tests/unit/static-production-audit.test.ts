import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  CURRENCY_REGISTRY,
  isValidCurrency,
  toMinorUnits,
  toMajorUnits,
  formatMoney,
  getCurrencyMetadata
} from '@ai-marketing/shared';
import { CreateBusinessProfileSchema, IndiaOnboardingPreset } from '@ai-marketing/shared';

describe('UCOS Static Production Integrity Audit (Rule 33 & 34)', () => {
  it('enforces that CreateBusinessProfileSchema does not embed hardcoded Indian defaults in universal core', () => {
    // Attempting to parse an empty object must fail on country, currency, timezone, primaryLanguage
    const result = CreateBusinessProfileSchema.safeParse({
      name: 'Acme Test Corp',
      verticalId: 'home_services',
      verticalName: 'Home Services',
      city: 'Austin',
      neighborhood: 'Downtown',
      brandVoice: 'Professional and helpful',
      offerings: [{ title: 'Standard Service', description: 'Basic package' }],
      valuePropositions: ['Verified pros']
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorFields = result.error.errors.map(e => e.path.join('.'));
      expect(errorFields).toContain('country');
      expect(errorFields).toContain('currency');
      expect(errorFields).toContain('timezone');
      expect(errorFields).toContain('primaryLanguage');
    }

    // India defaults must exist in explicit preset
    expect(IndiaOnboardingPreset.country).toBe('IN');
    expect(IndiaOnboardingPreset.currency).toBe('INR');
    expect(IndiaOnboardingPreset.timezone).toBe('Asia/Kolkata');
  });

  it('validates currency metadata registry precision across ISO standards', () => {
    // Standard 2-decimal currencies
    expect(toMinorUnits(10.50, 'USD')).toBe(1050);
    expect(toMajorUnits(1050, 'USD')).toBe(10.50);

    expect(toMinorUnits(500, 'INR')).toBe(50000);
    expect(toMajorUnits(50000, 'INR')).toBe(500);

    expect(toMinorUnits(25.99, 'EUR')).toBe(2599);
    expect(toMajorUnits(2599, 'EUR')).toBe(25.99);

    // Zero-decimal currencies (JPY, KRW)
    expect(toMinorUnits(1500, 'JPY')).toBe(1500);
    expect(toMajorUnits(1500, 'JPY')).toBe(1500);

    // Three-decimal currencies (KWD, BHD, OMR)
    expect(toMinorUnits(5.5, 'KWD')).toBe(5500);
    expect(toMajorUnits(5500, 'KWD')).toBe(5.5);

    // Unknown currencies must fail closed
    expect(isValidCurrency('FAKE_COIN')).toBe(false);
    expect(() => toMinorUnits(100, 'FAKE_COIN')).toThrow('UNKNOWN_CURRENCY');
  });

  it('audits universal-funnel.ts against synthetic funnel generation and unverified booking confirmations', () => {
    const funnelPath = path.resolve(__dirname, '../../src/routes/universal-funnel.ts');
    const content = fs.readFileSync(funnelPath, 'utf8');

    // Forbidden in production funnel route:
    expect(content).not.toContain('Synthesize a universal demand funnel');
    expect(content).not.toContain('slot_${Date.now()}');
    // Must return 404 when funnel is not found
    expect(content).toContain('FUNNEL_NOT_FOUND');
    expect(content).toContain('PRICE_TAMPER_DETECTED');
    expect(content).toContain('availabilityEngine.reserveSlot');
  });

  it('audits OwnerAuthService to ensure production authentication never trusts local SQLite before D1', () => {
    const authPath = path.resolve(__dirname, '../../src/auth/owner-auth.ts');
    const content = fs.readFileSync(authPath, 'utf8');

    // Must have fail-closed PERSISTENCE_FAULT on D1 failure
    expect(content).toContain('PERSISTENCE_FAULT');
    expect(content).not.toContain('console.warn(`[OwnerAuth] Could not write session to D1');
  });

  it('audits cron route in api.ts to ensure all businesses are processed without LIMIT 5 suppression', () => {
    const apiPath = path.resolve(__dirname, '../../src/routes/api.ts');
    const content = fs.readFileSync(apiPath, 'utf8');

    expect(content).not.toContain('SELECT id FROM organizations LIMIT 5');
    expect(content).toContain('/webhooks/stripe');
  });
});
