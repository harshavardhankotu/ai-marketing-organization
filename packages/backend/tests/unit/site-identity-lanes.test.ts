import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateSiteIdentityFacts, validateOwnerEnvFacts } from '../../src/config/owner-env-intake.js';
import { apiRouter } from '../../src/routes/api.js';

describe('Step 6: Site Identity Facts Lane Separation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.OWN_OFFER_CONFIRMED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('a) validates site identity with the 3 core facts alone', () => {
    // Missing all 3
    const resEmpty = validateSiteIdentityFacts();
    expect(resEmpty.valid).toBe(false);
    expect(resEmpty.missingFields).toEqual(['PUBLIC_SITE_NAME', 'PUBLIC_AUTHOR_NAME', 'PUBLIC_CONTACT_EMAIL']);

    // Set all 3 valid facts
    process.env.PUBLIC_SITE_NAME = 'Apex Medical Marketing';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@apexmarketing.in';

    const resValid = validateSiteIdentityFacts();
    expect(resValid.valid).toBe(true);
    expect(resValid.missingFields).toHaveLength(0);
    expect(resValid.invalidFields).toHaveLength(0);
  });

  it('b) separates content lane from affiliate lane in /owner/facts-status', async () => {
    // Site identity is set
    process.env.PUBLIC_SITE_NAME = 'Apex Medical Marketing';
    process.env.PUBLIC_AUTHOR_NAME = 'Harsha Vardhan';
    process.env.PUBLIC_CONTACT_EMAIL = 'contact@apexmarketing.in';

    // But Amazon Associates facts are missing
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;

    const req = new Request('http://localhost/owner/facts-status', { method: 'GET' });
    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);

    // Site identity lane is ready
    expect(json.siteIdentityLane).toBeDefined();
    expect(json.siteIdentityLane.ready).toBe(true);

    // Content lane is ready based on site identity alone
    expect(json.contentLane).toBeDefined();
    expect(json.contentLane.ready).toBe(true);

    // Affiliate lane is blocked because Amazon facts are missing
    expect(json.affiliateLane).toBeDefined();
    expect(json.affiliateLane.ready).toBe(false);
    expect(json.affiliateLane.missing).toContain('ASSOCIATES_APPLICATION_DATE');
  });
});
