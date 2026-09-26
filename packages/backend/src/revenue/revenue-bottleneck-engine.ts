/**
 * RevenueBottleneckEngine — Identifies the exact operational constraint blocking real revenue generation.
 *
 * Implements Spec § 37:
 * - Diagnoses the single primary bottleneck in the revenue pipeline:
 *     NO_PROSPECTS | AUTHORIZED_OUTBOUND_MISSING | NO_RESPONSES | NO_QUALIFIED_LEADS |
 *     NO_MEETINGS | NO_PAYMENT_METHOD | NO_CUSTOMER | NO_DELIVERY_CAPABILITY |
 *     NO_RETENTION_DATA | QUOTA_LIMITED | PROVIDER_DOWN | PERSISTENCE_DOWN
 * - Outputs actionable CEO diagnostic: exact bottleneck, operational effect, and the single best remedial action.
 */

import { getDb } from '../db/client.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { isPlaceholderCredential } from '../config/env.js';

export type RevenueBottleneckType =
  | 'NO_PROSPECTS'
  | 'AUTHORIZED_OUTBOUND_MISSING'
  | 'NO_RESPONSES'
  | 'NO_QUALIFIED_LEADS'
  | 'NO_MEETINGS'
  | 'NO_PAYMENT_METHOD'
  | 'NO_CUSTOMER'
  | 'NO_DELIVERY_CAPABILITY'
  | 'NO_RETENTION_DATA'
  | 'QUOTA_LIMITED'
  | 'PROVIDER_DOWN'
  | 'PERSISTENCE_DOWN'
  | 'NONE_REVENUE_FLOWING';

export interface BottleneckDiagnosis {
  bottleneck: RevenueBottleneckType;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  effect: string;
  bestNextAction: string;
  details: {
    prospectCount: number;
    contactedCount: number;
    respondedCount: number;
    meetingCount: number;
    paymentRequestCount: number;
    payingCustomerCount: number;
    verifiedRevenueINR: number;
    isOutboundLive: boolean;
    isPaymentLive: boolean;
  };
}

export class RevenueBottleneckEngine {
  private static instance: RevenueBottleneckEngine;
  private quotaService = UnifiedQuotaService.getInstance();

  public static getInstance(): RevenueBottleneckEngine {
    if (!RevenueBottleneckEngine.instance) {
      RevenueBottleneckEngine.instance = new RevenueBottleneckEngine();
    }
    return RevenueBottleneckEngine.instance;
  }

  /**
   * Evaluates the sales pipeline, provider credentials, and quota state to diagnose the revenue bottleneck.
   */
  public diagnose(businessId: string, organizationId: string): BottleneckDiagnosis {
    const db = getDb();

    // 1. Check Quota / Provider Locks
    const quota = this.quotaService.getStatus();
    if (quota.TAVILY.isLocked || quota.GEMINI.isLocked) {
      return {
        bottleneck: 'QUOTA_LIMITED',
        severity: 'HIGH',
        effect: 'API quotas have reached safety caps. External discovery and reasoning are paused until reset.',
        bestNextAction: 'Wait for quota reset window or authorize higher tier API quotas.',
        details: this.getPipelineMetrics(db, businessId)
      };
    }

    // 2. Check Payment Gateway Integration
    const isPaymentLive = Boolean(
      process.env.RAZORPAY_KEY_ID &&
      !isPlaceholderCredential(process.env.RAZORPAY_KEY_ID) &&
      !process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')
    );

    // 3. Check Outbound Channel Integration (WhatsApp / Email)
    const isOutboundLive = Boolean(
      (process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN) &&
      !isPlaceholderCredential(process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || '') &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      !isPlaceholderCredential(process.env.WHATSAPP_PHONE_NUMBER_ID)
    );

    const metrics = this.getPipelineMetrics(db, businessId);
    metrics.isOutboundLive = isOutboundLive;
    metrics.isPaymentLive = isPaymentLive;

    // 4. Bottleneck: Payment Gateway missing while leads exist
    if (!isPaymentLive && (metrics.meetingCount > 0 || metrics.paymentRequestCount > 0 || metrics.respondedCount > 0)) {
      return {
        bottleneck: 'NO_PAYMENT_METHOD',
        severity: 'CRITICAL',
        effect: 'Leads and meetings are active, but no live payment gateway (Razorpay) is configured to collect verified revenue.',
        bestNextAction: 'Add production RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable automated payment collection.',
        details: metrics
      };
    }

    // 5. Bottleneck: No Outbound channel authorized
    if (!isOutboundLive) {
      return {
        bottleneck: 'AUTHORIZED_OUTBOUND_MISSING',
        severity: 'CRITICAL',
        effect: 'The organization can discover opportunities and leads, but cannot legally/technically contact them without approved WhatsApp Cloud credentials.',
        bestNextAction: 'Connect verified Meta Cloud WhatsApp credentials (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID) to enable outbound sales outreach.',
        details: metrics
      };
    }

    // 6. Bottleneck: No Prospects discovered
    if (metrics.prospectCount === 0) {
      return {
        bottleneck: 'NO_PROSPECTS',
        severity: 'HIGH',
        effect: 'The sales pipeline is empty. No prospects or opportunities have been identified yet.',
        bestNextAction: 'Trigger autonomous market research and opportunity discovery via OpportunityEngine / Tavily.',
        details: metrics
      };
    }

    // 7. Bottleneck: Prospects exist but zero contacted
    if (metrics.contactedCount === 0) {
      return {
        bottleneck: 'NO_PROSPECTS',
        severity: 'MEDIUM',
        effect: 'Prospects exist in the pipeline but have not yet been reached.',
        bestNextAction: 'Execute outbound outreach batch to initial qualified prospects.',
        details: metrics
      };
    }

    // 8. Bottleneck: Contacted but zero responses
    if (metrics.contactedCount > 0 && metrics.respondedCount === 0) {
      return {
        bottleneck: 'NO_RESPONSES',
        severity: 'MEDIUM',
        effect: 'Prospects have been contacted, but no replies have been received yet.',
        bestNextAction: 'Refine value proposition messaging, subject lines, or offer positioning in OfferEngine.',
        details: metrics
      };
    }

    // 9. Bottleneck: Responses received but no meetings booked
    if (metrics.respondedCount > 0 && metrics.meetingCount === 0) {
      return {
        bottleneck: 'NO_MEETINGS',
        severity: 'MEDIUM',
        effect: 'Prospects are responding, but consultations or demos have not converted to booked appointments.',
        bestNextAction: 'Shorten booking friction with automated 1-click consultation slot links.',
        details: metrics
      };
    }

    // 10. Bottleneck: Meetings booked but no paying customer yet
    if (metrics.meetingCount > 0 && metrics.payingCustomerCount === 0) {
      return {
        bottleneck: 'NO_CUSTOMER',
        severity: 'HIGH',
        effect: 'Consultations are occurring, but no proposals have converted to completed payments.',
        bestNextAction: 'Dispatch immediate payment requests with limited-time consultation or treatment plan guarantees.',
        details: metrics
      };
    }

    // 11. Pipeline is flowing!
    return {
      bottleneck: 'NONE_REVENUE_FLOWING',
      severity: 'LOW',
      effect: 'Verified revenue is actively flowing through the pipeline.',
      bestNextAction: 'Scale customer delivery, referral capture, and expansion loops.',
      details: metrics
    };
  }

  private getPipelineMetrics(db: any, businessId: string): BottleneckDiagnosis['details'] {
    try {
      const prospectCount = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ?`).get(businessId) as any)?.count || 0;
      const contactedCount = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('CONTACTED','REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
      const respondedCount = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
      const meetingCount = (db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND stage IN ('MEETING_BOOKED','PAID','ONBOARDED')`).get(businessId) as any)?.count || 0;
      const paymentRequestCount = (db.prepare(`SELECT COUNT(*) as count FROM payment_requests WHERE business_id = ?`).get(businessId) as any)?.count || 0;
      const payingCustomerCount = (db.prepare(`SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND stage = 'CUSTOMER'`).get(businessId) as any)?.count || 0;
      const revRow = (db.prepare(`SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`).get(businessId) as any);
      const verifiedRevenueINR = revRow?.total || 0;

      return {
        prospectCount,
        contactedCount,
        respondedCount,
        meetingCount,
        paymentRequestCount,
        payingCustomerCount,
        verifiedRevenueINR,
        isOutboundLive: false,
        isPaymentLive: false
      };
    } catch {
      return {
        prospectCount: 0,
        contactedCount: 0,
        respondedCount: 0,
        meetingCount: 0,
        paymentRequestCount: 0,
        payingCustomerCount: 0,
        verifiedRevenueINR: 0,
        isOutboundLive: false,
        isPaymentLive: false
      };
    }
  }
}
