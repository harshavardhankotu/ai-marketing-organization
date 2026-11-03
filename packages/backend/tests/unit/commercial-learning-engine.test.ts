import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { DiscoveredDealInput } from '../../src/commission/deal-types.js';

describe('Stage 5 — Commercial Learning Engine Metric Truth & Truthful Cycles', () => {
  let engine: CommercialLearningEngine;
  let syncMgr: CuelinksSyncManager;

  const sampleDeal: DiscoveredDealInput = {
    id: 'deal_noise_smartwatch',
    title: 'Noise ColorFit Pulse Grand Smartwatch',
    brand: 'Noise',
    merchant: 'Noise Official',
    category: 'Smartwatches',
    productUrl: 'https://www.gonoise.com/products/colorfit-pulse-grand',
    currentPriceINR: 1299,
    referencePriceINR: 3999,
    availability: 'IN_STOCK',
    isMonetizable: true,
    affiliateNetwork: 'CUELINKS',
    affiliateCampaignId: '5566',
    modelOrSku: 'noise-pulse-grand'
  };

  beforeEach(() => {
    CommercialLearningEngine.resetInstance();
    CuelinksSyncManager.resetInstance();
    engine = CommercialLearningEngine.getInstance();
    syncMgr = CuelinksSyncManager.getInstance();
  });

  it('does NOT conflate provider clicks with reconciled transactions', async () => {
    vi.spyOn(syncMgr, 'getStatus').mockReturnValue({ configured: true } as any);
    vi.spyOn(syncMgr, 'reconcileTransactionsIncremental').mockResolvedValue({
      localClicks: 5,
      providerAttributedClicks: 42, // 42 clicks
      reportedConversions: 2,       // 2 real orders
      pendingCommissionINR: 120,
      validatedCommissionINR: 0,
      paidCommissionINR: 0,
      cashReceivedINR: 0,
      reversedCommissionINR: 0
    });

    const report = await engine.executeCycle({
      candidateDeals: [sampleDeal]
    });

    // transactionsReconciled must NOT equal providerAttributedClicks!
    expect(report.transactionsReconciled).toBe(2);
    expect(report.clicksMeasured).toBeDefined();
  });

  it('does NOT overwrite brand with hardcoded boAt for a non-boAt deal', async () => {
    vi.spyOn(syncMgr, 'getStatus').mockReturnValue({ configured: false } as any);

    const report = await engine.executeCycle({
      candidateDeals: [sampleDeal]
    });

    if (report.qualifiedOpportunity) {
      expect(report.qualifiedOpportunity.merchant).toBe('Noise Official');
      expect(report.cycleHypothesis).not.toContain('boAt Campaign 4232');
    }
  });

  it('does NOT mark DISTRIBUTE as completed when distribution assets are merely generated in-memory', async () => {
    vi.spyOn(syncMgr, 'getStatus').mockReturnValue({ configured: false } as any);

    const report = await engine.executeCycle({
      candidateDeals: [sampleDeal]
    });

    // An in-memory package is generated, but not yet verified published to an external public surface
    expect(report.stagesCompleted).not.toContain('DISTRIBUTE');
  });
});
