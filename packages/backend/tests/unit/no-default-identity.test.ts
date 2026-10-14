import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateOwnerEnvFacts, initOwnerEnvIntake } from '../../src/config/owner-env-intake.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { AutomaticOfferLane } from '../../src/commission/automatic-offer-lane.js';
import { getDb } from '../../src/db/client.js';

describe('Step 3: No Default Identity Suite (mst_default_identity guard)', () => {
  const db = getDb();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear owner env facts for clean testing
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // Guard test referenced by mistake row
  it('enforces all six owner facts and prevents default identity reintroduction', () => {
    const res = validateOwnerEnvFacts({});
    expect(res.valid).toBe(false);
    expect(res.missingFields).toContain('ASSOCIATES_APPLICATION_DATE');
    expect(res.missingFields).toContain('ASSOCIATES_LISTED_SITE_URL');
    expect(res.missingFields).toContain('ASSOCIATES_AGREEMENT_READ');
    expect(res.missingFields).toContain('PUBLIC_SITE_NAME');
    expect(res.missingFields).toContain('PUBLIC_AUTHOR_NAME');
    expect(res.missingFields).toContain('PUBLIC_CONTACT_EMAIL');
    expect(res.missingFields.length).toBe(6);
  });

  it('each missing name blocks publishing', () => {
    const ssg = StaticSiteGenerator.getInstance();

    // 1. Missing all facts throws error
    expect(() => ssg.validateConfig()).toThrow(/CONFIG_ERROR: Missing required public site configuration/);

    // 2. Each missing individually throws
    const validFacts = {
      PUBLIC_SITE_NAME: 'Valid Site',
      PUBLIC_AUTHOR_NAME: 'Valid Author',
      PUBLIC_CONTACT_EMAIL: 'contact@validsite.org'
    };

    // Missing PUBLIC_SITE_NAME
    process.env.PUBLIC_AUTHOR_NAME = validFacts.PUBLIC_AUTHOR_NAME;
    process.env.PUBLIC_CONTACT_EMAIL = validFacts.PUBLIC_CONTACT_EMAIL;
    expect(() => ssg.validateConfig()).toThrow(/PUBLIC_SITE_NAME/);

    // Missing PUBLIC_AUTHOR_NAME
    delete process.env.PUBLIC_AUTHOR_NAME;
    process.env.PUBLIC_SITE_NAME = validFacts.PUBLIC_SITE_NAME;
    expect(() => ssg.validateConfig()).toThrow(/PUBLIC_AUTHOR_NAME/);

    // Missing PUBLIC_CONTACT_EMAIL
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;
    process.env.PUBLIC_SITE_NAME = validFacts.PUBLIC_SITE_NAME;
    process.env.PUBLIC_AUTHOR_NAME = validFacts.PUBLIC_AUTHOR_NAME;
    expect(() => ssg.validateConfig()).toThrow(/PUBLIC_CONTACT_EMAIL/);
  });

  it('a default never appears in any generated page or owner configuration', () => {
    // Check owner auth configuration
    const ownerAuth = OwnerAuthService.getInstance();
    const config = ownerAuth.getOwnerConfiguration();

    // Owner name must not default to legal name
    expect(config.owner_name).not.toBe('Harsha Vardhan Kotu');

    // Generating guide must not invent author or site name
    const lane = AutomaticOfferLane.getInstance();
    const guide = lane.generateGuide(
      {
        category: 'printers',
        brand: 'GenericBrand',
        model: 'Model100',
        targetQuery: 'printers'
      },
      [
        {
          id: 'spec_1',
          productId: 'prod_1',
          brand: 'GenericBrand',
          model: 'Model100',
          specLine: 'Print speed: 100mm/s',
          sourceUrl: 'https://genericbrand.com/specs',
          retrievedAt: '2026-10-14'
        }
      ]
    );

    expect(guide.contentMarkdown).not.toContain('Harsha Vardhan Kotu');
  });

  it('rejects placeholders and bracketed text in owner environment variables', () => {
    const invalidInputs = {
      ASSOCIATES_APPLICATION_DATE: '2026-01-01',
      ASSOCIATES_LISTED_SITE_URL: 'https://mysite.com',
      ASSOCIATES_AGREEMENT_READ: 'true',
      PUBLIC_SITE_NAME: '[YOUR_SITE_NAME]',
      PUBLIC_AUTHOR_NAME: '<AUTHOR_NAME>',
      PUBLIC_CONTACT_EMAIL: 'placeholder@email.com'
    };

    const res = validateOwnerEnvFacts(invalidInputs);
    expect(res.valid).toBe(false);
    expect(res.invalidFields.some(f => f.field === 'PUBLIC_SITE_NAME')).toBe(true);
    expect(res.invalidFields.some(f => f.field === 'PUBLIC_AUTHOR_NAME')).toBe(true);
    expect(res.invalidFields.some(f => f.field === 'PUBLIC_CONTACT_EMAIL')).toBe(true);
  });
});
