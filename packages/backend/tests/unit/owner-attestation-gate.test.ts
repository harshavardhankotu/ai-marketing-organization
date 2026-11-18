import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { apiRouter } from '../../src/routes/api.js';

describe('Owner Attestation Gate & Offer Truth (mst_p1_agent_set_owner_attestation_variable)', () => {
  const originalHash = process.env.DIRECT_OFFER_TERMS_SHA256;
  const originalConfirmed = process.env.OWN_OFFER_CONFIRMED;
  const originalAttested = process.env.DIRECT_OFFER_TERMS_ATTESTED;

  beforeEach(() => {
    delete process.env.DIRECT_OFFER_TERMS_SHA256;
    delete process.env.OWN_OFFER_CONFIRMED;
    delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
  });

  afterEach(() => {
    if (originalHash) process.env.DIRECT_OFFER_TERMS_SHA256 = originalHash;
    else delete process.env.DIRECT_OFFER_TERMS_SHA256;

    if (originalConfirmed) process.env.OWN_OFFER_CONFIRMED = originalConfirmed;
    else delete process.env.OWN_OFFER_CONFIRMED;

    if (originalAttested) process.env.DIRECT_OFFER_TERMS_ATTESTED = originalAttested;
    else delete process.env.DIRECT_OFFER_TERMS_ATTESTED;
  });

  it('1. Refuses attestation if DIRECT_OFFER_TERMS_ATTESTED is missing, even if hash matches', () => {
    const computedHash = DirectCommercialOfferPage.computeDirectOfferHash();
    expect(computedHash).toBeDefined();

    // Set matching hash, but leave DIRECT_OFFER_TERMS_ATTESTED unset
    process.env.DIRECT_OFFER_TERMS_SHA256 = computedHash!;
    delete process.env.DIRECT_OFFER_TERMS_ATTESTED;

    expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);
  });

  it('2. Attestation succeeds only when both DIRECT_OFFER_TERMS_ATTESTED=true and hash matches DIRECT_OFFER.md', () => {
    const computedHash = DirectCommercialOfferPage.computeDirectOfferHash();
    process.env.DIRECT_OFFER_TERMS_SHA256 = computedHash!;
    process.env.DIRECT_OFFER_TERMS_ATTESTED = 'true';

    expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(true);
  });

  it('SiteFix OWN_OFFER.md hash does not unlock DirectCommercialOfferPage', () => {
    const sitefixHash = DirectCommercialOfferPage.computeOwnOfferHash();
    process.env.DIRECT_OFFER_TERMS_SHA256 = sitefixHash!;
    process.env.DIRECT_OFFER_TERMS_ATTESTED = 'true';
    process.env.OWN_OFFER_CONFIRMED = 'true';

    expect(DirectCommercialOfferPage.isDirectOfferAttested()).toBe(false);
  });

  it('3. Unattested /offer page hides price, guarantee, deliverable list, and payment section', () => {
    delete process.env.OWN_OFFER_CONFIRMED;
    const html = DirectCommercialOfferPage.getInstance().renderOfferHtml();

    // Must show Problem and short description and inquiry form
    expect(html).toContain('The Problem');
    expect(html.toLowerCase()).toContain('falling through the cracks');
    expect(html).toContain('lead-inquiry-form');

    // Must hide pricing, guarantees, deliverable checklist, and payment rails
    expect(html).not.toContain('₹15,000');
    expect(html).not.toContain('14-Day Performance Guarantee');
    expect(html).not.toContain('What The System Delivers');
    expect(html).not.toContain('razorpay.me');
  });

  it('4. GET /api/v1/owner/facts-status returns attestation notice and validates OWN_OFFER_CONFIRMED', async () => {
    const req = new Request('http://localhost/owner/facts-status', {
      method: 'GET',
      headers: { 'x-user-id': 'usr_owner_01' }
    });
    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.success).toBe(true);
    expect(body.data.attestationNotice).toContain('A hash match proves the page equals the file');

    const confirmedFact = (body.data.allFacts || body.data.facts).find((f: any) => f.field === 'OWN_OFFER_CONFIRMED');
    expect(confirmedFact).toBeDefined();
    expect(confirmedFact.status).toBe('MISSING');
    expect(confirmedFact.validity).toBe('INVALID');
  });
});
