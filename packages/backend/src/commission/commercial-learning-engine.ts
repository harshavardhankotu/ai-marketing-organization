/**
 * Commercial Learning Engine (V5.0 Spec § 6 & § 8)
 *
 * Implements the continuous 8-stage commercial state machine:
 * DISCOVER ➔ QUALIFY ➔ PUBLISH ➔ DISTRIBUTE ➔ MEASURE ➔ RECONCILE ➔ EVALUATE ➔ IMPROVE
 *
 * Guarantees:
 * 1. Strictly ₹0 paid acquisition spend.
 * 2. Strictly 0 LLM tokens consumed for background evaluation cycles.
 * 3. Persists cycle telemetry into Cloudflare D1 workflows table.
 * 4. Learns from empirical conversion rates to adjust opportunity scoring weights.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { CommercialOpportunitySelector, QualifiedCommercialOpportunity } from './commercial-opportunity-selector.js';
import { OrganicDistributionEngine, OrganicDistributionPackage } from './organic-distribution-engine.js';
import { CuelinksSyncManager } from './cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from './autonomous-deal-discovery-engine.js';
import { DiscoveredDealInput } from './deal-types.js';
import { SectorCode, COMMERCIAL_SECTOR_TAXONOMY } from '@ai-marketing/shared';

export type CommercialRewardEventType =
  | 'BOT_OR_INTERNAL_CLICK'
  | 'VERIFIED_HUMAN_VISIT'
  | 'SITEFIX_COMPLETED_SCAN'
  | 'VERIFIED_HUMAN_AFFILIATE_CLICK'
  | 'CONSENTED_QUALIFIED_ENQUIRY'
  | 'PROVIDER_ATTRIBUTED_CONVERSION'
  | 'VALIDATED_COMMISSION'
  | 'BANK_CONFIRMED_CASH'
  | 'REFUND_OR_COMMISSION_REVERSAL'
  | 'UNPRODUCTIVE_API_QUOTA_UNIT';

export interface CommercialRewardEvent {
  eventType: CommercialRewardEventType;
  commissionINR?: number;
  cashINR?: number;
  unproductiveQuotaUnits?: number;
  sourceClickId?: string;
  notes?: string;
}

export interface SectorBanditState {
  sectorCode: SectorCode;
  displayName: string;
  alpha: number;
  beta: number;
  cumulativeReward: number;
  verifiedHumanInteractions: number;
  conversionsCount: number;
  inColdStart: boolean;
  allocationWeight: number;
  lastUpdated: string;
}

export interface SectorSelectionResult {
  selectedSector: SectorCode;
  selectionMode: 'COLD_START_EXPLORATION' | 'THOMPSON_SAMPLING_EXPLOITATION' | 'EXPLORATION_FLOOR';
  sampleScore: number;
  allSectors: Record<SectorCode, SectorBanditState>;
}

export type CommercialCycleState =
  | 'DISCOVER'
  | 'QUALIFY'
  | 'PUBLISH'
  | 'ASSET_GENERATION'
  | 'DISTRIBUTE'
  | 'MEASURE'
  | 'RECONCILE'
  | 'EVALUATE'
  | 'IMPROVE';

export interface CommercialCycleReport {
  cycleId: string;
  state: CommercialCycleState;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  stagesCompleted: CommercialCycleState[];
  candidateDealsDiscovered: number;
  qualifiedOpportunity: QualifiedCommercialOpportunity | null;
  distributionPackage: OrganicDistributionPackage | null;
  clicksMeasured: number;
  providerAttributedClicks: number;
  transactionsReconciled: number;
  pendingCommissionINR: number;
  validatedCommissionINR: number;
  paidCommissionINR: number;
  cashReceivedINR: number;
  cycleHypothesis: string;
  cycleVerdict: 'REVENUE_GENERATED' | 'TRAFFIC_CONVERTING' | 'ASSET_GENERATED_AWAITING_PUBLICATION' | 'OPPORTUNITY_DISTRIBUTED' | 'NO_OPPORTUNITY_QUALIFIED' | 'CYCLE_BLOCKED';
  nextCycleRecommendations: string[];
}

export class CommercialLearningEngine {
  private static instance: CommercialLearningEngine | null = null;
  private d1Repo = D1RevenueRepository.getInstance();
  private selector = CommercialOpportunitySelector.getInstance();
  private distributor = OrganicDistributionEngine.getInstance();

  public static readonly CANONICAL_SECTORS: SectorCode[] = [
    'SECTOR_A_PRECIOUS_METALS',
    'SECTOR_B_ELECTRONICS',
    'SECTOR_C_HOME_APPLIANCES',
    'SECTOR_D_TRAVEL',
    'SECTOR_E_SOFTWARE',
    'SECTOR_F_OFFICE_INDUSTRIAL',
    'SECTOR_G_LIFESTYLE',
    'SECTOR_H_LOCAL_SERVICES_B2B'
  ];

  public static readonly EXPLORATION_FLOOR = 0.20; // 20% minimum exploration floor
  public static readonly COLD_START_INTERACTION_THRESHOLD = 10; // Thompson Sampling only after >= 10 interactions

  private sectorBanditStates: Map<SectorCode, SectorBanditState> = new Map();

  /**
   * Initializes or gets the bandit state for all 8 canonical sectors.
   */
  public ensureBanditInitialized(): void {
    if (this.sectorBanditStates.size === 8) return;
    for (const code of CommercialLearningEngine.CANONICAL_SECTORS) {
      if (!this.sectorBanditStates.has(code)) {
        const def = COMMERCIAL_SECTOR_TAXONOMY[code];
        this.sectorBanditStates.set(code, {
          sectorCode: code,
          displayName: def?.displayName || code,
          alpha: 1.0,
          beta: 1.0,
          cumulativeReward: 0.0,
          verifiedHumanInteractions: 0,
          conversionsCount: 0,
          inColdStart: true,
          allocationWeight: 1.0 / 8.0,
          lastUpdated: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Staged Evidence-Weighted Reward Function:
   * bot / internalDiagnostic / unknown clicks = 0
   * verifiedHumanVisit = +1
   * siteFixCompletedScan = +3
   * verifiedHumanAffiliateClick = +10
   * consentedQualifiedEnquiry = +25
   * providerAttributedConversion = +60
   * validatedCommissionINR = +100 + (0.5 * commissionINR)
   * bankConfirmedCashINR = +250 + (1.0 * cashINR)
   * refundOrCommissionReversal = -120
   * unproductiveApiQuotaUnitConsumed = -0.5
   */
  public static computeReward(event: CommercialRewardEvent): number {
    switch (event.eventType) {
      case 'BOT_OR_INTERNAL_CLICK':
        return 0;
      case 'VERIFIED_HUMAN_VISIT':
        return 1;
      case 'SITEFIX_COMPLETED_SCAN':
        return 3;
      case 'VERIFIED_HUMAN_AFFILIATE_CLICK':
        return 10;
      case 'CONSENTED_QUALIFIED_ENQUIRY':
        return 25;
      case 'PROVIDER_ATTRIBUTED_CONVERSION':
        return 60;
      case 'VALIDATED_COMMISSION':
        return 100 + (0.5 * Math.max(0, event.commissionINR || 0));
      case 'BANK_CONFIRMED_CASH':
        return 250 + (1.0 * Math.max(0, event.cashINR || 0));
      case 'REFUND_OR_COMMISSION_REVERSAL':
        return -120;
      case 'UNPRODUCTIVE_API_QUOTA_UNIT':
        return -0.5 * Math.max(1, event.unproductiveQuotaUnits || 1);
      default:
        return 0;
    }
  }

  /**
   * Records a commercial evidence event and updates the sector's Bayesian posterior.
   */
  public recordCommercialEvent(sectorCode: SectorCode, event: CommercialRewardEvent): number {
    this.ensureBanditInitialized();
    const state = this.sectorBanditStates.get(sectorCode);
    if (!state) return 0;

    const reward = CommercialLearningEngine.computeReward(event);
    state.cumulativeReward += reward;
    state.lastUpdated = new Date().toISOString();

    const isHumanInteraction = [
      'VERIFIED_HUMAN_VISIT',
      'SITEFIX_COMPLETED_SCAN',
      'VERIFIED_HUMAN_AFFILIATE_CLICK',
      'CONSENTED_QUALIFIED_ENQUIRY',
      'PROVIDER_ATTRIBUTED_CONVERSION',
      'VALIDATED_COMMISSION',
      'BANK_CONFIRMED_CASH'
    ].includes(event.eventType);

    if (isHumanInteraction) {
      state.verifiedHumanInteractions++;
    }

    if (state.verifiedHumanInteractions >= CommercialLearningEngine.COLD_START_INTERACTION_THRESHOLD) {
      state.inColdStart = false;
    }

    if (['PROVIDER_ATTRIBUTED_CONVERSION', 'VALIDATED_COMMISSION', 'BANK_CONFIRMED_CASH'].includes(event.eventType)) {
      state.conversionsCount++;
    }

    // Bayesian updating: positive rewards update alpha, negative updates beta
    if (reward > 0) {
      state.alpha += Math.min(reward / 10, 5);
    } else if (reward < 0) {
      state.beta += Math.min(Math.abs(reward) / 10, 5);
    }

    this.recomputeAllocationWeights();
    return reward;
  }

  private sampleBeta(alpha: number, beta: number): number {
    const gA = this.sampleGamma(Math.max(0.1, alpha));
    const gB = this.sampleGamma(Math.max(0.1, beta));
    if (gA + gB <= 0) return 0.5;
    return gA / (gA + gB);
  }

  private sampleGamma(k: number): number {
    if (k < 1) {
      return this.sampleGamma(k + 1) * Math.pow(Math.max(1e-6, Math.random()), 1 / k);
    }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let z = 0;
      do {
        const u1 = Math.max(1e-6, Math.random());
        const u2 = Math.random();
        z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      } while (1 + c * z <= 0);
      const v = Math.pow(1 + c * z, 3);
      const u = Math.random();
      if (u < 1 - 0.0331 * Math.pow(z, 4)) return d * v;
      if (Math.log(u) < 0.5 * Math.pow(z, 2) + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  private recomputeAllocationWeights(): void {
    let totalWeight = 0;
    const weights: Map<SectorCode, number> = new Map();
    for (const [code, state] of this.sectorBanditStates.entries()) {
      const mean = state.alpha / (state.alpha + state.beta);
      weights.set(code, mean);
      totalWeight += mean;
    }
    for (const [code, state] of this.sectorBanditStates.entries()) {
      const w = weights.get(code) || 1;
      state.allocationWeight = totalWeight > 0 ? Number((w / totalWeight).toFixed(4)) : 0.125;
    }
  }

  /**
   * Selects the next commercial sector to explore or exploit.
   * Enforces 20% minimum exploration floor across all 8 sectors.
   * Thompson Sampling engages only after >= 10 verified human interactions.
   */
  public selectNextSectorToExplore(): SectorSelectionResult {
    this.ensureBanditInitialized();
    const sectors = CommercialLearningEngine.CANONICAL_SECTORS;
    const allStates: Record<SectorCode, SectorBanditState> = {} as any;
    for (const code of sectors) {
      allStates[code] = { ...this.sectorBanditStates.get(code)! };
    }

    // 1. Cold-start check: Find sectors with < 10 verified human interactions
    const coldStartSectors = sectors.filter(code => (allStates[code]?.verifiedHumanInteractions || 0) < CommercialLearningEngine.COLD_START_INTERACTION_THRESHOLD);
    if (coldStartSectors.length > 0) {
      const picked = coldStartSectors[Math.floor(Math.random() * coldStartSectors.length)];
      return {
        selectedSector: picked,
        selectionMode: 'COLD_START_EXPLORATION',
        sampleScore: 0.5,
        allSectors: allStates
      };
    }

    // 2. Exploration Floor check: 20% probability exploration across all 8 sectors
    if (Math.random() < CommercialLearningEngine.EXPLORATION_FLOOR) {
      const picked = sectors[Math.floor(Math.random() * sectors.length)];
      return {
        selectedSector: picked,
        selectionMode: 'EXPLORATION_FLOOR',
        sampleScore: 0.2,
        allSectors: allStates
      };
    }

    // 3. Thompson Sampling exploitation across posterior distributions
    let bestSector = sectors[0];
    let maxSample = -Infinity;
    for (const code of sectors) {
      const state = allStates[code];
      const sample = this.sampleBeta(state.alpha, state.beta);
      if (sample > maxSample) {
        maxSample = sample;
        bestSector = code;
      }
    }

    return {
      selectedSector: bestSector,
      selectionMode: 'THOMPSON_SAMPLING_EXPLOITATION',
      sampleScore: Number(maxSample.toFixed(4)),
      allSectors: allStates
    };
  }

  /**
   * Returns live snapshot of all 8 sector states.
   */
  public getSectorBanditIntelligence(): Record<SectorCode, SectorBanditState> {
    this.ensureBanditInitialized();
    const result: Record<SectorCode, SectorBanditState> = {} as any;
    for (const code of CommercialLearningEngine.CANONICAL_SECTORS) {
      result[code] = { ...this.sectorBanditStates.get(code)! };
    }
    return result;
  }

  public static getInstance(): CommercialLearningEngine {
    if (!CommercialLearningEngine.instance) {
      CommercialLearningEngine.instance = new CommercialLearningEngine();
    }
    return CommercialLearningEngine.instance;
  }

  public static resetInstance(): void {
    CommercialLearningEngine.instance = null;
  }

  /**
   * Executes a complete closed-loop commercial cycle.
   */
  public async executeCycle(options?: {
    candidateDeals?: DiscoveredDealInput[];
    organizationId?: string;
    businessId?: string;
  }): Promise<CommercialCycleReport> {
    const startTime = Date.now();
    const cycleId = `cycle_${startTime}_${Math.random().toString(36).substring(2, 9)}`;
    const stagesCompleted: CommercialCycleState[] = [];

    // Stage 1: DISCOVER
    stagesCompleted.push('DISCOVER');
    const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    let candidates = options?.candidateDeals;

    if (!candidates || candidates.length === 0) {
      const allDeals = dealEngine.getAllDeals();
      candidates = allDeals.map(d => ({
        id: d.id,
        title: d.title,
        brand: d.brand,
        merchant: d.merchant,
        category: d.category,
        productUrl: d.productUrl,
        currentPriceINR: d.currentPriceINR,
        referencePriceINR: d.referencePriceINR,
        claimedDiscountPercent: d.claimedDiscountPercent,
        availability: d.availability,
        geographicRestrictions: ['India'],
        offerStart: d.offerStart,
        expiryDate: d.expiryDate,
        sourceUrl: d.productUrl,
        sourceDomain: (d as any).merchantDomain || (d as any).sourceDomain || 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        modelOrSku: d.modelOrSku,
        affiliateNetwork: d.affiliateNetwork,
        affiliateCampaignId: d.affiliateCampaignId,
        trackingUrl: d.trackingUrl,
        slug: d.slug
      }));
    }

    // Stage 2: QUALIFY
    stagesCompleted.push('QUALIFY');
    const selection = this.selector.selectBestOpportunity(candidates);
    const qualifiedOpp = selection.selectedOpportunity;

    let distPackage: OrganicDistributionPackage | null = null;

    if (qualifiedOpp) {
      // Stage 3: PUBLISH
      stagesCompleted.push('PUBLISH');
      let hostDomain = 'authorized-merchant.com';
      try {
        hostDomain = new URL(qualifiedOpp.productUrl).hostname;
      } catch {}

      const existingDeal = dealEngine.getDealById(qualifiedOpp.dealId);
      await dealEngine.registerDeal({
        title: qualifiedOpp.title,
        brand: existingDeal?.brand || qualifiedOpp.merchant,
        merchant: qualifiedOpp.merchant,
        category: existingDeal?.category || 'General Merchandise',
        productUrl: qualifiedOpp.productUrl,
        currentPriceINR: qualifiedOpp.currentPriceINR,
        referencePriceINR: qualifiedOpp.referencePriceINR,
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: existingDeal?.expiryDate,
        sourceUrl: qualifiedOpp.productUrl,
        sourceDomain: hostDomain,
        sourceType: 'RETAILER_BRAND',
        modelOrSku: qualifiedOpp.sku,
        affiliateNetwork: qualifiedOpp.affiliateNetwork,
        affiliateCampaignId: qualifiedOpp.affiliateCampaignId,
        isMonetizable: true
      });

      // Stage 4: ASSET GENERATION / DISTRIBUTE
      stagesCompleted.push('ASSET_GENERATION');
      distPackage = this.distributor.generateDistributionPackage(qualifiedOpp);
      await this.distributor.logDistributionEvent(distPackage);

      // In-memory generation is AWAITING_PUBLICATION until an external publication proof is confirmed
      if ((distPackage as any)?.published === true) {
        stagesCompleted.push('DISTRIBUTE');
      }
    }

    // Stage 5: MEASURE
    stagesCompleted.push('MEASURE');
    let localClicks = 0;
    try {
      const clickRows = await this.d1Repo.query<{ count: number }>(
        'referrals',
        'SELECT COUNT(*) as count FROM referrals'
      );
      localClicks = clickRows[0]?.count || 0;
    } catch {}

    // Stage 6: RECONCILE
    stagesCompleted.push('RECONCILE');
    let reconciliationMetrics = {
      localClicks,
      providerAttributedClicks: 0,
      reportedConversions: 0,
      pendingCommissionINR: 0,
      validatedCommissionINR: 0,
      paidCommissionINR: 0,
      cashReceivedINR: 0
    };

    try {
      const syncMgr = CuelinksSyncManager.getInstance();
      if (syncMgr.getStatus().configured) {
        const reconRes = await syncMgr.reconcileTransactionsIncremental();
        reconciliationMetrics = {
          localClicks,
          providerAttributedClicks: reconRes.providerAttributedClicks,
          reportedConversions: reconRes.reportedConversions,
          pendingCommissionINR: reconRes.pendingCommissionINR,
          validatedCommissionINR: reconRes.validatedCommissionINR,
          paidCommissionINR: reconRes.paidCommissionINR,
          cashReceivedINR: 0
        };
      }
    } catch (reconErr: any) {
      console.warn(`[CommercialLearning] Reconciliation notice: ${reconErr.message}`);
    }

    // Stage 7: EVALUATE
    stagesCompleted.push('EVALUATE');
    let verdict: CommercialCycleReport['cycleVerdict'] = 'NO_OPPORTUNITY_QUALIFIED';
    if (reconciliationMetrics.paidCommissionINR > 0) {
      verdict = 'REVENUE_GENERATED';
    } else if (reconciliationMetrics.reportedConversions > 0) {
      verdict = 'TRAFFIC_CONVERTING';
    } else if (distPackage !== null) {
      verdict = (distPackage as any)?.published === true ? 'OPPORTUNITY_DISTRIBUTED' : 'ASSET_GENERATED_AWAITING_PUBLICATION';
    }

    // Stage 8: IMPROVE
    stagesCompleted.push('IMPROVE');
    const recommendations: string[] = [];
    if (!qualifiedOpp) {
      recommendations.push('Broaden upstream Cuelinks campaign sync across Consumer Electronics and Wearables.');
      recommendations.push('Verify merchant URLs before candidate scoring to prevent 404 exclusions.');
    } else if (reconciliationMetrics.localClicks === 0) {
      recommendations.push(`Syndicate organic buying guide '${distPackage?.buyingGuideUrl}' via permitted SEO sitemaps.`);
      recommendations.push(`Deploy Reply Desk comparison answers for ${qualifiedOpp.title} to high-intent forums.`);
    } else if (reconciliationMetrics.reportedConversions === 0) {
      recommendations.push(`Monitor attribution latency for Cuelinks Campaign ${qualifiedOpp.affiliateCampaignId} (reporting delay 24-72h).`);
      recommendations.push(`Evaluate price point competitiveness against festive promotional discounts.`);
    }

    const endTime = Date.now();
    const report: CommercialCycleReport = {
      cycleId,
      state: 'IMPROVE',
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      stagesCompleted,
      candidateDealsDiscovered: candidates.length,
      qualifiedOpportunity: qualifiedOpp,
      distributionPackage: distPackage,
      clicksMeasured: localClicks,
      providerAttributedClicks: reconciliationMetrics.providerAttributedClicks,
      transactionsReconciled: reconciliationMetrics.reportedConversions,
      pendingCommissionINR: reconciliationMetrics.pendingCommissionINR,
      validatedCommissionINR: reconciliationMetrics.validatedCommissionINR,
      paidCommissionINR: reconciliationMetrics.paidCommissionINR,
      cashReceivedINR: 0,
      cycleHypothesis: qualifiedOpp
        ? `Testing conversion on ${qualifiedOpp.title} at ₹${qualifiedOpp.currentPriceINR} through Campaign ${qualifiedOpp.affiliateCampaignId} (${qualifiedOpp.commissionRatePercent}% CPS) with organic buying guides and zero paid ads.`
        : 'Evaluating broad consumer catalog for high-demand, high-margin qualified products.',
      cycleVerdict: verdict,
      nextCycleRecommendations: recommendations
    };

    // Persist cycle log in Cloudflare D1 workflows
    try {
      const cycleSql = `
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          retry_count, max_retries, inputs_json, outputs_json, updated_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'COMMERCIAL_LEARNING_CYCLE', 'COMPLETED', ?, 0, 3, '{}', ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')
      `;
      await this.d1Repo.executeWrite(
        'workflows',
        cycleSql,
        [cycleId, verdict, JSON.stringify(report)]
      );
    } catch (saveErr: any) {
      console.warn(`[CommercialLearning] Failed to persist cycle report: ${saveErr.message}`);
    }

    return report;
  }
}
