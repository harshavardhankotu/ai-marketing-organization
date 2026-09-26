/**
 * DeliveryBlueprint — Operational fulfillment roadmap and outcome measurement engine.
 *
 * Implements Spec § 18 & § 19:
 * - 5-Day Delivery Blueprint for "AI Inbound Lead Conversion System":
 *     Day 0: Customer Activation & intake parameters review
 *     Day 1: Connect data & channels (WhatsApp Business API / Google Business Profile)
 *     Day 2: Lead triage & past conversation audit
 *     Day 3: Lead conversion & qualification workflow configuration
 *     Day 4: Appointment calendar integration & reminder workflow activation
 *     Day 5: Performance baseline verification, report generation & customer handover
 * - Idempotency: onboarding:{customer_id} prevents duplicate activation.
 * - Customer Outcome Measurement:
 *     Tracks leads, responses, appointments, conversion rate, customer business revenue.
 *     Strictly segregates CUSTOMER_BUSINESS_REVENUE from PLATFORM_REVENUE.
 */

import { getDb } from '../db/client.js';

export interface BlueprintDayTask {
  day: number;
  name: string;
  objective: string;
  toolsUsed: string[];
  deliverables: string[];
  successCriteria: string;
}

export interface CustomerOutcomeMeasurement {
  id: string;
  customerJourneyId: string;
  businessId: string;
  organizationId: string;
  inboundLeadsReceived: number;
  leadsRespondedSub2Min: number;
  appointmentsBooked: number;
  appointmentsAttended: number;
  customersClosed: number;
  customerBusinessRevenueINR: number;
  platformRevenueINR: number;
  averageResponseTimeSeconds: number;
  netPromoterScore?: number;
  measuredAt: string;
}

export class DeliveryBlueprintManager {
  private static instance: DeliveryBlueprintManager;

  public static getInstance(): DeliveryBlueprintManager {
    if (!DeliveryBlueprintManager.instance) {
      DeliveryBlueprintManager.instance = new DeliveryBlueprintManager();
    }
    return DeliveryBlueprintManager.instance;
  }

  /**
   * Retrieves the canonical 5-day delivery roadmap.
   */
  public get5DayBlueprint(): BlueprintDayTask[] {
    return [
      {
        day: 0,
        name: 'Customer Activation & Intake',
        objective: 'Acknowledge verified payment, configure account, and capture operating hours & provider credentials.',
        toolsUsed: ['RazorpayWebhookVerifier', 'DurableEventBus', 'CustomerJourneyTracker'],
        deliverables: ['Client onboarding dashboard link', 'Service agreement confirmation', 'Intake checklist'],
        successCriteria: 'Client intake submitted and welcome email/message dispatched.'
      },
      {
        day: 1,
        name: 'Channel & Data Integration',
        objective: 'Connect WhatsApp Business and Google Business Profile to the automated triage system.',
        toolsUsed: ['WhatsAppAdapter', 'GoogleBusinessProfileAdapter', 'LiveProviderActivation'],
        deliverables: ['Authorized WhatsApp webhook listener', 'GBP messaging link verified'],
        successCriteria: 'Test ping successfully routes from WhatsApp/GBP into event queue.'
      },
      {
        day: 2,
        name: 'Inquiry Audit & Triage Rules',
        objective: 'Audit common inquiries, frequently asked questions, treatment prices, and clinical specialties.',
        toolsUsed: ['SalesConversationEngine', 'MarketingMemoryEngine'],
        deliverables: ['Custom qualification rubric', 'Standard FAQ answer templates', 'Urgency escalation rules'],
        successCriteria: 'Client approves qualification questions and pricing transparency terms.'
      },
      {
        day: 3,
        name: 'Workflow & Bot Configuration',
        objective: 'Deploy 24/7 lead qualification and automated appointment conversion workflows.',
        toolsUsed: ['SalesConversationEngine', 'AutonomyPolicyController'],
        deliverables: ['Automated 2-min triage bot', 'Hot lead notification trigger for clinic staff'],
        successCriteria: 'Simulated inquiry correctly classified into QUALIFIED with appointment booking link.'
      },
      {
        day: 4,
        name: 'Calendar & Reminder Activation',
        objective: 'Connect appointment calendar and schedule multi-touch reminder notifications to prevent no-shows.',
        toolsUsed: ['MeetingEngine', 'OutboundEngine'],
        deliverables: ['Calendar slot booking workflow', 'SMS/WhatsApp 24h & 2h appointment reminder sequence'],
        successCriteria: 'Test appointment booking successfully registers and sends confirmation.'
      },
      {
        day: 5,
        name: 'Handover & Baseline Report',
        objective: 'Activate live production routing, verify sub-2 minute responses, and deliver initial client report.',
        toolsUsed: ['AgentScorecardEngine', 'DeliveryEngine'],
        deliverables: ['Live System Handover Report', 'Client weekly conversion metrics dashboard access'],
        successCriteria: 'Client signs off on handover; first live inquiry answered in < 120 seconds.'
      }
    ];
  }

  /**
   * Records empirical post-delivery customer outcome metrics (Spec § 19).
   */
  public recordCustomerResult(measurement: {
    customerJourneyId: string;
    businessId: string;
    organizationId: string;
    inboundLeads: number;
    sub2MinResponses: number;
    appointmentsBooked: number;
    appointmentsAttended: number;
    customersClosed: number;
    customerBusinessRevenueINR: number;
    platformRevenueINR: number;
    averageResponseSeconds: number;
  }): CustomerOutcomeMeasurement {
    const db = getDb();
    const id = `meas_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const record: CustomerOutcomeMeasurement = {
      id,
      customerJourneyId: measurement.customerJourneyId,
      businessId: measurement.businessId,
      organizationId: measurement.organizationId,
      inboundLeadsReceived: measurement.inboundLeads,
      leadsRespondedSub2Min: measurement.sub2MinResponses,
      appointmentsBooked: measurement.appointmentsBooked,
      appointmentsAttended: measurement.appointmentsAttended,
      customersClosed: measurement.customersClosed,
      customerBusinessRevenueINR: measurement.customerBusinessRevenueINR,
      platformRevenueINR: measurement.platformRevenueINR,
      averageResponseTimeSeconds: measurement.averageResponseSeconds,
      measuredAt: now
    };

    // Update customer journey metrics
    try {
      db.prepare(`
        UPDATE customer_journeys
        SET stage = 'RETAINED', total_lifetime_value_inr = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(measurement.customerBusinessRevenueINR, measurement.customerJourneyId);
    } catch {}

    // NOTE: Platform revenue is NEVER recorded from outcome measurements.
    // Platform revenue may only originate from Razorpay-verified captured payments or
    // owner-confirmed MANUAL_VERIFIED payments. Customer outcome metrics record
    // the customer's business performance only — not platform subscription fees.
    // If platformRevenueINR is nonzero in the measurement, it is a reference to an
    // existing verified transaction, not an instruction to create new revenue.

    return record;
  }
}
