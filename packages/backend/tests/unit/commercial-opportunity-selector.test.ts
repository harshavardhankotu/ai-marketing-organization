import { describe, it, expect, beforeEach } from 'vitest';
import { CommercialOpportunitySelector } from '../../src/commission/commercial-opportunity-selector.js';
import { DiscoveredDealInput } from '../../src/commission/deal-types.js';
import { CuelinksCampaign } from '../../src/commission/cuelinks-v3-types.js';

describe('Stage 3 — Commercial Opportunity Selector Mandatory Gates & Truthful Ranking', () => {
  let selector: CommercialOpportunitySelector;

  beforeEach(() => {
    CommercialOpportunitySelector.resetInstance();
    selector = CommercialOpportunitySelector.getInstance();
  });

  const validActiveBoatCampaign: CuelinksCampaign = {
    id: 4232,
    name: 'boAt Lifestyle',
    merchant_name: 'boAt Lifestyle',
    url: 'https://www.boat-lifestyle.com',
    domain: 'boat-lifestyle.com',
    status: 'active',
    access_status: 'approved',
    deeplink_allowed: true,
    payout_type: 'CPS',
    commission_rate: '6.0%'
  };

  const validInStockDeal: DiscoveredDealInput = {
    title: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds',
    brand: 'boAt',
    merchant: 'boAt Lifestyle',
    category: 'Audio',
    productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
    currentPriceINR: 999,
    referencePriceINR: 4490,
    claimedDiscountPercent: 78,
    availability: 'IN_STOCK',
    observedAt: new Date().toISOString(),
    sourceDomain: 'boat-lifestyle.com',
    isMonetizable: true,
    affiliateNetwork: 'CUELINKS',
    affiliateCampaignId: '4232',
    modelOrSku: 'airdopes-141'
  };

  it('rejects candidate if availability is OUT_OF_STOCK or not confirmed IN_STOCK', () => {
    const outOfStockDeal: DiscoveredDealInput = {
      ...validInStockDeal,
      availability: 'OUT_OF_STOCK'
    };

    const res = selector.scoreCandidate(outOfStockDeal, validActiveBoatCampaign);
    expect(res.status).toBe('REJECTED');
    expect(res.rejectionReason).toMatch(/stock|availability/i);
  });

  it('does NOT arbitrarily infer campaign 4232 or 6% CPS based on substring "boat" without active campaign matching merchant domain', () => {
    const unapprovedDeal: DiscoveredDealInput = {
      ...validInStockDeal,
      affiliateCampaignId: undefined,
      isMonetizable: false
    };

    // No campaign passed and no campaign pre-matched
    const res = selector.scoreCandidate(unapprovedDeal, undefined);
    expect(res.affiliateCampaignId).not.toBe('4232');
    expect(res.commissionRatePercent).toBe(0);
    expect(res.status).toBe('REJECTED');
    expect(res.rejectionReason).toMatch(/campaign|affiliate|monetiz/i);
  });

  it('rejects candidate if SKU / model identifier is missing or UNKNOWN_SKU', () => {
    const missingSkuDeal: DiscoveredDealInput = {
      ...validInStockDeal,
      modelOrSku: undefined
    };

    const res = selector.scoreCandidate(missingSkuDeal, validActiveBoatCampaign);
    expect(res.status).toBe('REJECTED');
    expect(res.rejectionReason).toMatch(/sku|model/i);
  });

  it('does not calculate unverified discount when referencePriceINR is missing, scoring on price sweet-spot only', () => {
    const noRefPriceDeal: DiscoveredDealInput = {
      ...validInStockDeal,
      referencePriceINR: undefined,
      claimedDiscountPercent: undefined
    };

    const res = selector.scoreCandidate(noRefPriceDeal, validActiveBoatCampaign);
    expect(res.status).toBe('QUALIFIED');
    expect(res.discountPercent).toBe(0);
    expect(res.referencePriceINR).toBe(999);
  });

  it('qualifies a verified candidate meeting all mandatory gates and ranks deterministically', () => {
    const result = selector.selectBestOpportunity([validInStockDeal], [validActiveBoatCampaign]);
    expect(result.status).toBe('QUALIFIED');
    expect(result.selectedOpportunity).not.toBeNull();
    expect(result.selectedOpportunity?.sku).toBe('airdopes-141');
    expect(result.selectedOpportunity?.currentPriceINR).toBe(999);
    expect(result.selectedOpportunity?.commissionRatePercent).toBe(6.0);
    expect(result.selectedOpportunity?.projectedCommissionINR).toBe(59.94);
    expect(result.selectedOpportunity?.score).toBeGreaterThanOrEqual(70);
  });
});
