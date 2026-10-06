import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { CommissionLedgerSummary } from './types.js';

export interface LedgerBreakdownItem {
  key: string;
  name: string;
  clicks: number;
  referrals: number;
  conversions: number;
  expectedCommissionINR: number;
  verifiedRevenueINR: number;
  receivedCashINR: number;
}

export class CommissionLedgerEngine {
  private static instance: CommissionLedgerEngine;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): CommissionLedgerEngine {
    if (!CommissionLedgerEngine.instance) {
      CommissionLedgerEngine.instance = new CommissionLedgerEngine();
    }
    return CommissionLedgerEngine.instance;
  }

  /**
   * Computes the top-level commercial ledger summary.
   * Strict separation of Expected vs Verified vs Received.
   */
  public async getSummary(organizationId: string): Promise<CommissionLedgerSummary> {
    // 1. Referrals count
    const refCountRow = await this.d1Repo.queryOne<{ count: number }>(
      'referrals',
      'SELECT COUNT(*) as count FROM referrals WHERE organization_id = ?',
      [organizationId]
    );
    const qualifiedReferrals = refCountRow?.count || 0;

    // 2. Content asset total views and clicks
    const assetViewsRow = await this.d1Repo.queryOne<{ totalViews: number; totalClicks: number }>(
      'commission_content_assets',
      'SELECT COALESCE(SUM(view_count), 0) as totalViews, COALESCE(SUM(referral_click_count), 0) as totalClicks FROM commission_content_assets WHERE organization_id = ?',
      [organizationId]
    );
    const totalViews = assetViewsRow?.totalViews || 0;
    const clicks = Math.max(qualifiedReferrals, assetViewsRow?.totalClicks || 0);

    // 3. Commission records breakdown
    const commRows = await this.d1Repo.query<any>(
      'commission_records',
      'SELECT status, expected_commission_inr, verified_commission_inr, received_commission_inr FROM commission_records WHERE organization_id = ?',
      [organizationId]
    );

    let externalConversions = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;
    let rejectedCount = 0;
    let refundedCount = 0;
    let chargebackCount = 0;

    let expectedCommissionINR = 0;
    let verifiedRevenueINR = 0;
    let receivedCashINR = 0;

    // Phase 2 Task 10: CLICKED / EXPECTED / CONVERSION_REPORTED carry ₹0 realized.
    // Only APPROVED (verified) and PAID (cash) count as revenue.
    const PENDING_STATES = new Set([
      'CLICKED', 'EXPECTED', 'CONVERSION_REPORTED',
      'COMMISSION_PENDING', 'EXTERNAL_CONVERSION_PENDING',
      'DISCOVERED', 'QUALIFIED_DEMAND', 'RECOMMENDATION_PRESENTED',
      'REFERRAL_CLICKED', 'UNVERIFIED'
    ]);

    for (const c of commRows) {
      expectedCommissionINR += (c.expected_commission_inr || 0);

      if (PENDING_STATES.has(c.status)) {
        pendingCount++;
        if (c.status === 'CONVERSION_REPORTED' || c.status === 'EXTERNAL_CONVERSION_PENDING' || c.status === 'COMMISSION_PENDING') {
          externalConversions++;
        }
      } else if (c.status === 'COMMISSION_APPROVED') {
        approvedCount++;
        externalConversions++;
        verifiedRevenueINR += (c.verified_commission_inr || 0);
      } else if (c.status === 'COMMISSION_PAID') {
        paidCount++;
        externalConversions++;
        verifiedRevenueINR += (c.verified_commission_inr || 0);
        receivedCashINR += (c.received_commission_inr || 0);
      } else if (c.status === 'REJECTED') {
        rejectedCount++;
      } else if (c.status === 'REFUNDED' || c.status === 'CANCELLED') {
        refundedCount++;
      } else if (c.status === 'CHARGEBACK') {
        chargebackCount++;
      }
    }

    const commissionPerReferralINR = qualifiedReferrals > 0 ? verifiedRevenueINR / qualifiedReferrals : 0;
    const commissionConversionRate = qualifiedReferrals > 0 ? externalConversions / qualifiedReferrals : 0;
    const revenuePer1000VisitorsINR = totalViews > 0 ? (verifiedRevenueINR / totalViews) * 1000 : 0;

    return {
      clicks,
      qualifiedReferrals,
      externalConversions,
      pendingCommissionsCount: pendingCount,
      approvedCommissionsCount: approvedCount,
      paidCommissionsCount: paidCount,
      rejectedCommissionsCount: rejectedCount,
      refundedCommissionsCount: refundedCount,
      expectedCommissionINR,
      verifiedRevenueINR,
      receivedCashINR,
      commissionPerReferralINR,
      commissionConversionRate,
      revenuePer1000VisitorsINR
    };
  }

  /**
   * Breakdown by partner
   */
  public async getBreakdownByPartner(organizationId: string): Promise<LedgerBreakdownItem[]> {
    const partners = await this.d1Repo.query<any>(
      'partners',
      'SELECT id, name FROM partners WHERE organization_id = ?',
      [organizationId]
    );

    const result: LedgerBreakdownItem[] = [];

    for (const p of partners) {
      const refCount = (await this.d1Repo.queryOne<{ count: number }>(
        'referrals',
        'SELECT COUNT(*) as count FROM referrals WHERE partner_id = ?',
        [p.id]
      ))?.count || 0;

      const comms = await this.d1Repo.query<any>(
        'commission_records',
        'SELECT * FROM commission_records WHERE partner_id = ?',
        [p.id]
      );

      let expected = 0;
      let verified = 0;
      let received = 0;
      let convCount = 0;

      for (const c of comms) {
        expected += (c.expected_commission_inr || 0);
        if (c.status === 'COMMISSION_APPROVED' || c.status === 'COMMISSION_PAID') {
          verified += (c.verified_commission_inr || 0);
        }
        if (c.status === 'COMMISSION_PAID') {
          received += (c.received_commission_inr || 0);
        }
        if (c.status !== 'REJECTED' && c.status !== 'CANCELLED' && c.status !== 'REFUNDED' && c.status !== 'CHARGEBACK') {
          convCount++;
        }
      }

      result.push({
        key: p.id,
        name: p.name,
        clicks: refCount,
        referrals: refCount,
        conversions: convCount,
        expectedCommissionINR: expected,
        verifiedRevenueINR: verified,
        receivedCashINR: received
      });
    }

    return result;
  }
}
