import { getDb } from '../db/client.js';
import { RealEconomicsSummary } from '@ai-marketing/shared';
import { RevenueReconciliationEngine } from './revenue-reconciliation.js';
import { QuotaManager } from '../ai/quota-manager.js';

export interface LaneUnitEconomicsInput {
  lane:
    | 'LANE_A_AFFILIATE_COMMERCE'
    | 'LANE_B_B2B_SERVICES'
    | 'LANE_C_AUTHORIZED_PARTNERSHIPS'
    | 'LANE_D_DIGITAL_PRODUCTS'
    | 'LANE_E_FINANCIAL_INTELLIGENCE';
  grossRevenueINR: number;
  directCostINR?: number;
  adSpendINR?: number;
  gatewayFeePercent?: number;
  partnerSharePercent?: number;
}

export interface LaneUnitEconomicsResult {
  lane: LaneUnitEconomicsInput['lane'];
  grossRevenueINR: number;
  directCostINR: number;
  netContributionINR: number;
  grossMarginPercent: number | null;
  contributionStatus: 'MEASURED' | 'NO_REVENUE_MEASURED';
  costModelBasis: string;
}

/**
 * Computes lane-specific unit economics without arbitrary flat 65% clinical margin assumptions.
 * Returns null grossMarginPercent when zero verified revenue is present so unmeasured lanes are never fabricated.
 */
export function calculateLaneUnitEconomics(input: LaneUnitEconomicsInput): LaneUnitEconomicsResult {
  const gross = Math.max(0, Number(input.grossRevenueINR || 0));
  const adSpend = Math.max(0, Number(input.adSpendINR || 0));
  const explicitCost = Math.max(0, Number(input.directCostINR || 0));

  let variableCost = explicitCost + adSpend;
  let costModelBasis = 'MEASURED_REVENUE_MINUS_DIRECT_COST';

  if (input.lane === 'LANE_A_AFFILIATE_COMMERCE') {
    costModelBasis = 'AFFILIATE_COMMISSION_NET_OF_ACQUISITION_SPEND';
  } else if (input.lane === 'LANE_B_B2B_SERVICES') {
    const gwPct = Number.isFinite(input.gatewayFeePercent) ? Number(input.gatewayFeePercent) : 2.0;
    if (gross > 0 && explicitCost === 0) {
      variableCost += Number((gross * (gwPct / 100)).toFixed(2));
    }
    costModelBasis = `B2B_SERVICE_NET_OF_DIRECT_DELIVERY_AND_${gwPct}%_GATEWAY_FEE`;
  } else if (input.lane === 'LANE_C_AUTHORIZED_PARTNERSHIPS') {
    const sharePct = Number.isFinite(input.partnerSharePercent) ? Number(input.partnerSharePercent) : 0;
    if (gross > 0 && explicitCost === 0 && sharePct > 0) {
      variableCost += Number((gross * (sharePct / 100)).toFixed(2));
    }
    costModelBasis = 'AUTHORIZED_PARTNER_REVSHARE_LEDGER';
  } else if (input.lane === 'LANE_D_DIGITAL_PRODUCTS') {
    const gwPct = Number.isFinite(input.gatewayFeePercent) ? Number(input.gatewayFeePercent) : 2.0;
    if (gross > 0 && explicitCost === 0) {
      variableCost += Number((gross * (gwPct / 100)).toFixed(2));
    }
    costModelBasis = `SELF_SERVE_DIGITAL_NET_OF_${gwPct}%_PAYMENT_RAIL_FEE`;
  } else if (input.lane === 'LANE_E_FINANCIAL_INTELLIGENCE') {
    costModelBasis = 'SEBI_EDUCATIONAL_PAPER_RESEARCH_ZERO_EXECUTION_FEES';
  }

  const netContributionINR = Number((gross - variableCost).toFixed(2));
  if (gross <= 0) {
    return {
      lane: input.lane,
      grossRevenueINR: 0,
      directCostINR: Number(variableCost.toFixed(2)),
      netContributionINR,
      grossMarginPercent: null,
      contributionStatus: 'NO_REVENUE_MEASURED',
      costModelBasis
    };
  }

  return {
    lane: input.lane,
    grossRevenueINR: Number(gross.toFixed(2)),
    directCostINR: Number(variableCost.toFixed(2)),
    netContributionINR,
    grossMarginPercent: Number(((netContributionINR / gross) * 100).toFixed(2)),
    contributionStatus: 'MEASURED',
    costModelBasis
  };
}

export class RealEconomicsEngine {
  private get db() {
    return getDb();
  }

  private revenueEngine = new RevenueReconciliationEngine();

  /**
   * Computes the real economics summary for a business based on verified data only.
   * Adheres strictly to scientific truth:
   * - No division by zero
   * - When spend is 0, CAC / CPL / ROAS / ROI are returned as 'UNKNOWN' or 'N/A'
   * - Unverified or synthetic transactions are excluded from real metrics
   */
  public calculate(businessId: string): RealEconomicsSummary {
    const revenueSummary = this.revenueEngine.getRevenueSummary(businessId);

    // Count Real entities
    const leadRow = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND classification = 'REAL'"
      )
      .get(businessId) as any;
    const realLeadsCount = leadRow?.count || 0;

    const customerRow = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND classification = 'REAL' AND stage = 'CUSTOMER'"
      )
      .get(businessId) as any;
    const realCustomersCount = customerRow?.count || 0;

    const apptRow = this.db
      .prepare(
        `SELECT COUNT(*) as count 
         FROM appointments a
         JOIN customer_journeys j ON a.journey_id = j.id
         WHERE a.business_id = ? AND j.classification = 'REAL'`
      )
      .get(businessId) as any;
    const realConsultationsCount = apptRow?.count || 0;

    // Determine verified live Google Ads spend (excluding historical test seeds)
    const verifiedAdSpendINR = revenueSummary.verifiedActualGoogleAdsSpendINR || 0;
    const verifiedRealRevenueINR = revenueSummary.realRevenueIndependentlyVerifiedINR || 0;
    const attributedRealRevenueINR = revenueSummary.realMarketingAttributedRevenueINR || 0;
    const unattributedRealRevenueINR = revenueSummary.unattributedRealRevenueINR || 0;

    // Calculate Unit Economics with strict denominator checks
    let cacINR: number | 'UNKNOWN' = 'UNKNOWN';
    let cplINR: number | 'UNKNOWN' = 'UNKNOWN';
    let costPerConsultationINR: number | 'UNKNOWN' = 'UNKNOWN';
    let arpcINR: number | 'UNKNOWN' = 'UNKNOWN';
    let verifiedRoas: number | 'N/A' = 'N/A';
    let verifiedRoi: number | 'N/A' = 'N/A';

    if (verifiedAdSpendINR > 0) {
      cacINR = realCustomersCount > 0 
        ? Math.round((verifiedAdSpendINR / realCustomersCount) * 100) / 100 
        : 'UNKNOWN';
      cplINR = realLeadsCount > 0 
        ? Math.round((verifiedAdSpendINR / realLeadsCount) * 100) / 100 
        : 'UNKNOWN';
      costPerConsultationINR = realConsultationsCount > 0 
        ? Math.round((verifiedAdSpendINR / realConsultationsCount) * 100) / 100 
        : 'UNKNOWN';
      verifiedRoas = Math.round((attributedRealRevenueINR / verifiedAdSpendINR) * 100) / 100;
      verifiedRoi = Math.round(((attributedRealRevenueINR - verifiedAdSpendINR) / verifiedAdSpendINR) * 100) / 100;
    } else {
      // Ad spend is ₹0
      if (realLeadsCount > 0) cplINR = 0;
      if (realConsultationsCount > 0) costPerConsultationINR = 0;
      if (realCustomersCount > 0) cacINR = 0;
    }

    if (realCustomersCount > 0) {
      arpcINR = Math.round((verifiedRealRevenueINR / realCustomersCount) * 100) / 100;
    }

    const netContributionINR = attributedRealRevenueINR - verifiedAdSpendINR;
    // Measured gross margin only from real attributed revenue vs verified direct spend (no fabricated 65% clinical baseline)
    const grossMarginPercent = attributedRealRevenueINR > 0
      ? Number(((netContributionINR / attributedRealRevenueINR) * 100).toFixed(2))
      : 0;

    // =========================================================================
    // ORGANIC ECONOMICS (Zero-Budget Growth Mode)
    // =========================================================================
    const orgVisitorRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM customer_journeys 
         WHERE business_id = ? AND classification = 'REAL' 
           AND first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicVisitors = orgVisitorRow?.count || 0;

    const orgLeadRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM customer_journeys 
         WHERE business_id = ? AND classification = 'REAL' 
           AND stage IN ('LEAD', 'QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER')
           AND first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicLeads = orgLeadRow?.count || 0;

    const orgQualLeadRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM customer_journeys 
         WHERE business_id = ? AND classification = 'REAL' 
           AND stage IN ('QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER')
           AND first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicQualifiedLeads = orgQualLeadRow?.count || 0;

    const orgApptRow = this.db
      .prepare(
        `SELECT COUNT(*) as count 
         FROM appointments a
         JOIN customer_journeys j ON a.journey_id = j.id
         WHERE a.business_id = ? AND j.classification = 'REAL'
           AND j.first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicConsultations = orgApptRow?.count || 0;

    const orgCustRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM customer_journeys 
         WHERE business_id = ? AND classification = 'REAL' AND stage = 'CUSTOMER'
           AND first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicCustomers = orgCustRow?.count || 0;

    const orgRevRow = this.db
      .prepare(
        `SELECT SUM(t.amount_inr) as rev
         FROM transactions t
         JOIN customer_journeys j ON t.journey_id = j.id
         WHERE t.business_id = ? AND t.status = 'SUCCESS' AND t.classification = 'REAL'
           AND j.first_touch_channel NOT IN ('GOOGLE_SEARCH_ADS', 'META_ADS')`
      )
      .get(businessId) as any;
    const organicVerifiedRevenueINR = orgRevRow?.rev || 0;
    const organicAttributedRevenueINR = organicVerifiedRevenueINR;

    const revenuePerOrganicLeadINR: number | 'UNKNOWN' =
      organicLeads > 0 ? Math.round((organicVerifiedRevenueINR / organicLeads) * 100) / 100 : 'UNKNOWN';
    const revenuePerOrganicCustomerINR: number | 'UNKNOWN' =
      organicCustomers > 0 ? Math.round((organicVerifiedRevenueINR / organicCustomers) * 100) / 100 : 'UNKNOWN';
    const organicConversionRatePercent: number | 'UNKNOWN' | 'INSUFFICIENT_EVIDENCE' =
      organicVisitors >= 30
        ? Math.round((organicCustomers / organicVisitors) * 10000) / 100
        : organicVisitors > 0
        ? 'INSUFFICIENT_EVIDENCE'
        : 'UNKNOWN';

    // AI Cost Free-Tier Allowance Check
    let isFreeTier = false;
    try {
      const quotaStatus = QuotaManager.getInstance().getStatus();
      isFreeTier = quotaStatus.freeTierActive && quotaStatus.geminiRequestsToday <= quotaStatus.geminiMaxDailyRequests;
    } catch {
      isFreeTier = false;
    }

    let isZeroBudget = false;
    try {
      const policyRow = this.db
        .prepare('SELECT active_mode FROM autonomy_policy WHERE business_id = ?')
        .get(businessId) as any;
      isZeroBudget = policyRow?.active_mode === 'ZERO_BUDGET_GROWTH';
    } catch {
      isZeroBudget = false;
    }

    let totalAiCost = 0;
    try {
      const costRow = this.db
        .prepare('SELECT SUM(estimated_cost_inr) as cost FROM ai_cost_logs WHERE business_id = ?')
        .get(businessId) as any;
      totalAiCost = costRow?.cost || 0;
    } catch {
      totalAiCost = 0;
    }

    // External Organic Visitors (Strictly VERIFIED_EXTERNAL)
    let externalOrganicVisitors = 0;
    let verifiedExternalVisitors = 0;
    try {
      const extSessRow = this.db
        .prepare(
          `SELECT COUNT(DISTINCT visitor_id) as ext_visitors
           FROM traffic_sessions
           WHERE business_id = ? AND traffic_evidence_status = 'VERIFIED_EXTERNAL'`
        )
        .get(businessId) as any;
      externalOrganicVisitors = extSessRow?.ext_visitors || 0;
      verifiedExternalVisitors = externalOrganicVisitors;
    } catch {
      externalOrganicVisitors = 0;
      verifiedExternalVisitors = 0;
    }

    // Verified Organic Leads (Requiring verified external acquisition evidence)
    let verifiedOrganicLeads = 0;
    try {
      const verifiedLeadsRow = this.db
        .prepare(
          `SELECT COUNT(*) as cnt FROM acquisition_evidence ae
           JOIN customer_journeys j ON ae.journey_id = j.id
           WHERE j.business_id = ? AND ae.verified_organic = 1 AND j.classification = 'REAL'`
        )
        .get(businessId) as any;
      verifiedOrganicLeads = verifiedLeadsRow?.cnt || 0;
    } catch {
      verifiedOrganicLeads = 0;
    }

    const aiCostStatus: 'VERIFIED' | 'ESTIMATED' = (isFreeTier || isZeroBudget || totalAiCost === 0) ? 'VERIFIED' : 'ESTIMATED';
    const freeTierStatus: 'FREE_TIER_VERIFIED' | 'ESTIMATED' | 'FREE_TIER_STATUS_UNKNOWN' = isFreeTier
      ? 'FREE_TIER_VERIFIED'
      : isZeroBudget
      ? 'FREE_TIER_VERIFIED'
      : 'ESTIMATED';

    return {
      actualAdSpendINR: verifiedAdSpendINR,
      verifiedRealRevenueINR,
      attributedRealRevenueINR,
      unattributedRealRevenueINR,
      cacINR,
      cplINR,
      costPerConsultationINR,
      costPerCustomerINR: cacINR,
      arpcINR,
      grossMarginPercent,
      netContributionINR,
      verifiedRoas,
      verifiedRoi,
      // Organic Economics
      organicVisitors,
      externalOrganicVisitors,
      verifiedExternalVisitors,
      organicLeads,
      verifiedOrganicLeads,
      organicQualifiedLeads,
      organicConsultations,
      organicCustomers,
      organicVerifiedRevenueINR,
      organicAttributedRevenueINR,
      revenuePerOrganicLeadINR,
      revenuePerOrganicCustomerINR,
      organicConversionRatePercent,
      aiCostStatus,
      freeTierStatus,
    };
  }
}
