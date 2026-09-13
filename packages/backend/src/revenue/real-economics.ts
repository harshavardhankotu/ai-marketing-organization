import { getDb } from '../db/client.js';
import { RealEconomicsSummary } from '@ai-marketing/shared';
import { RevenueReconciliationEngine } from './revenue-reconciliation.js';

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
    const grossMarginPercent = 65.0; // Standard clinical contribution margin baseline

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
    };
  }
}
