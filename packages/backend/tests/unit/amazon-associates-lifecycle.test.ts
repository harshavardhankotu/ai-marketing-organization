import { describe, it, expect } from 'vitest';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { Partner } from '../../src/commission/types.js';

describe('Amazon Associates India Application Lifecycle & Circular Dependency Resolution (Phase B)', () => {
  const registry = PartnerRegistryEngine.getInstance();

  const basePartner: Partner = {
    id: 'part_amazon_in_test',
    organizationId: 'org_owner_primary',
    name: 'Amazon India Associates',
    industry: 'E-commerce',
    country: 'India',
    website: 'https://affiliate-program.amazon.in',
    partnerType: 'AFFILIATE',
    approvalStatus: 'QUALIFYING_SALES_IN_PROGRESS',
    activeStatus: 1,
    authorizationStatus: 'AUTHORIZED',
    trackingType: 'AFFILIATE_LINK',
    evidence: {
      applicationSubmitted: true,
      trackingIdIssued: true,
      probation180DaysActive: true
    }
  };

  it('authorizes partners in QUALIFYING_SALES_IN_PROGRESS state to drive initial qualifying referrals', () => {
    const partner: Partner = {
      ...basePartner,
      approvalStatus: 'QUALIFYING_SALES_IN_PROGRESS'
    };

    expect(registry.isPartnerAuthorizedForProduction(partner)).toBe(true);
  });

  it('authorizes partners in TRACKING_ID_ISSUED state to generate links', () => {
    const partner: Partner = {
      ...basePartner,
      approvalStatus: 'TRACKING_ID_ISSUED'
    };

    expect(registry.isPartnerAuthorizedForProduction(partner)).toBe(true);
  });

  it('authorizes confirmed APPROVED partners', () => {
    const partner: Partner = {
      ...basePartner,
      approvalStatus: 'APPROVED'
    };

    expect(registry.isPartnerAuthorizedForProduction(partner)).toBe(true);
  });

  it('rejects partners that have NOT_APPLIED, REJECTED, or SUSPENDED', () => {
    const notApplied: Partner = {
      ...basePartner,
      approvalStatus: 'NOT_APPLIED'
    };
    expect(registry.isPartnerAuthorizedForProduction(notApplied)).toBe(false);

    const rejected: Partner = {
      ...basePartner,
      approvalStatus: 'REJECTED'
    };
    expect(registry.isPartnerAuthorizedForProduction(rejected)).toBe(false);

    const suspended: Partner = {
      ...basePartner,
      approvalStatus: 'SUSPENDED'
    };
    expect(registry.isPartnerAuthorizedForProduction(suspended)).toBe(false);
  });

  it('rejects inactive or revoked partners even if approval status is APPROVED or QUALIFYING', () => {
    const inactive: Partner = {
      ...basePartner,
      approvalStatus: 'APPROVED',
      activeStatus: 0
    };
    expect(registry.isPartnerAuthorizedForProduction(inactive)).toBe(false);

    const revoked: Partner = {
      ...basePartner,
      approvalStatus: 'QUALIFYING_SALES_IN_PROGRESS',
      authorizationStatus: 'REVOKED'
    };
    expect(registry.isPartnerAuthorizedForProduction(revoked)).toBe(false);
  });
});
