import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveAffiliateAdapter,
  VCommissionAdapter,
  CuelinksAdapter,
  EarnKaroAdapter,
  PartnerTrackingLinkBuilder,
} from '../../src/commission/affiliate-adapters.js';

describe('Non-Amazon Affiliate Adapters & Tracking Link Builder (Indian Networks)', () => {
  beforeEach(() => {
    process.env.VCOMMISSION_AFF_ID = 'aff_vcomm_test';
    process.env.CUELINKS_CAMPAIGN_ID = 'camp_cuelinks_test';
    process.env.EARNKARO_REFERRAL_ID = 'ref_earnkaro_test';
  });

  afterEach(() => {
    delete process.env.VCOMMISSION_AFF_ID;
    delete process.env.CUELINKS_CAMPAIGN_ID;
    delete process.env.EARNKARO_REFERRAL_ID;
  });

  it('adapter refuses to build link if owner-entered template is missing', () => {
    const vcAdapter = new VCommissionAdapter();
    expect(() => {
      vcAdapter.buildTrackedDestination({
        baseUrl: 'https://store.example.com/product-123',
        clickId: 'clk_vc_missing',
      });
    }).toThrow(/MISSING_PARTNER_TRACKING_TEMPLATE/);

    const cueAdapter = new CuelinksAdapter();
    expect(() => {
      cueAdapter.buildTrackedDestination({
        baseUrl: 'https://store.example.com/product-123',
        clickId: 'clk_cue_missing',
      });
    }).toThrow(/MISSING_PARTNER_TRACKING_TEMPLATE/);

    const ekAdapter = new EarnKaroAdapter();
    expect(() => {
      ekAdapter.buildTrackedDestination({
        baseUrl: 'https://store.example.com/product-123',
        clickId: 'clk_ek_missing',
      });
    }).toThrow(/MISSING_PARTNER_TRACKING_TEMPLATE/);
  });

  it('vCommission adapter resolves host and formats HasOffers tracking link with aff_sub using partner template', () => {
    const adapter = resolveAffiliateAdapter('https://tracking.vcommission.com/aff_c?offer_id=555');
    expect(adapter.network).toBe('VCOMMISSION');

    const tracked = adapter.buildTrackedDestination({
      baseUrl: 'https://store.example.com/product-123',
      clickId: 'clk_vc_001',
      template: 'https://tracking.vcommission.com/aff_c?offer_id={offerId}&aff_id={affId}&aff_sub={clickId}&url={encodedUrl}',
      variables: { offerId: '890' },
    });

    expect(tracked).toContain('tracking.vcommission.com/aff_c');
    expect(tracked).toContain('offer_id=890');
    expect(tracked).toContain('aff_id=aff_vcomm_test');
    expect(tracked).toContain('aff_sub=clk_vc_001');
    expect(tracked).toContain('url=' + encodeURIComponent('https://store.example.com/product-123'));

    const urlWithAttribution = new URL(tracked);
    expect(adapter.hasAttribution(urlWithAttribution)).toBe(true);
  });

  it('Cuelinks adapter resolves host and formats redirect link with subid using partner template', () => {
    const adapter = resolveAffiliateAdapter('https://linksredirect.com/?cid=123');
    expect(adapter.network).toBe('CUELINKS');

    const tracked = adapter.buildTrackedDestination({
      baseUrl: 'https://store.example.com/item-456',
      clickId: 'clk_cue_002',
      template: 'https://linksredirect.com/?cid={campaignId}&subid={clickId}&url={encodedUrl}',
      variables: { campaignId: '777' },
    });

    expect(tracked).toContain('linksredirect.com/?cid=777');
    expect(tracked).toContain('subid=clk_cue_002');
    expect(tracked).toContain('url=' + encodeURIComponent('https://store.example.com/item-456'));

    const urlWithAttribution = new URL(tracked);
    expect(adapter.hasAttribution(urlWithAttribution)).toBe(true);
  });

  it('EarnKaro adapter resolves host and formats deal redirect link with referralId and subid using partner template', () => {
    const adapter = resolveAffiliateAdapter('https://earnkaro.com/share');
    expect(adapter.network).toBe('EARNKARO');

    const tracked = adapter.buildTrackedDestination({
      baseUrl: 'https://store.example.com/deal-789',
      clickId: 'clk_ek_003',
      template: 'https://earnkaro.com/deal?r={referralId}&url={encodedUrl}&subid={clickId}',
      variables: { referralId: 'my_ek_id' },
    });

    expect(tracked).toContain('earnkaro.com/deal?r=my_ek_id');
    expect(tracked).toContain('subid=clk_ek_003');
    expect(tracked).toContain('url=' + encodeURIComponent('https://store.example.com/deal-789'));

    const urlWithAttribution = new URL(tracked);
    expect(adapter.hasAttribution(urlWithAttribution)).toBe(true);
  });

  it('PartnerTrackingLinkBuilder applies custom partner tracking templates with tokens', () => {
    const template = 'https://custom-network.in/click?pub={affId}&camp={campaignId}&sub1={clickId}&dest={encodedUrl}';
    const built = PartnerTrackingLinkBuilder.buildFromTemplate(template, {
      baseUrl: 'https://target.in/laptop',
      clickId: 'clk_custom_004',
      affId: 'pub_999',
      campaignId: 'camp_888',
    });

    expect(built).toBe(
      'https://custom-network.in/click?pub=pub_999&camp=camp_888&sub1=clk_custom_004&dest=' +
        encodeURIComponent('https://target.in/laptop')
    );
  });

  it('PartnerTrackingLinkBuilder fails-closed on unapproved fixture partners', () => {
    // Unapproved partner must be blocked: "The owner must apply and prove it."
    expect(() => {
      PartnerTrackingLinkBuilder.buildPartnerLink({
        baseUrl: 'https://unapproved-partner.in/item',
        clickId: 'clk_unapproved_005',
        partner: {
          id: 'part_unapproved_fixture',
          approvalStatus: 'PENDING',
          authorizationStatus: 'PENDING_REVIEW',
        },
      });
    }).toThrow(/UNAPPROVED_PARTNER_ERROR/);

    // Explicitly approved and authorized partner builds successfully
    const approvedResult = PartnerTrackingLinkBuilder.buildPartnerLink({
      baseUrl: 'https://linksredirect.com/?cid=123',
      clickId: 'clk_approved_006',
      partner: {
        id: 'part_cuelinks_fixture',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        trackingTemplate: 'https://linksredirect.com/?cid={campaignId}&subid={clickId}&url={encodedUrl}',
      },
    });

    expect(approvedResult).toContain('subid=clk_approved_006');
  });
});
