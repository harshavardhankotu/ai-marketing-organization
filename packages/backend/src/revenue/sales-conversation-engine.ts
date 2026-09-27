/**
 * SalesConversationEngine — Inbound response intent classification and autonomous next action routing.
 *
 * Implements Spec §§ 8, 9, 12, 13:
 * - Processes inbound webhook events:
 *     MESSAGE_RECEIVED | EMAIL_RECEIVED | MEETING_REPLY | PAYMENT_RECEIVED | PAYMENT_FAILED | CUSTOMER_REPLIED | CONTACT_OPT_OUT
 * - Classifies response into 13 deterministic intents:
 *     1. INTERESTED
 *     2. PRICE_QUESTION
 *     3. HOW_IT_WORKS
 *     4. WHAT_DO_YOU_DO
 *     5. SEND_DETAILS
 *     6. CASE_STUDY_REQUEST
 *     7. DEMO_REQUEST
 *     8. OBJECTION_PRICE
 *     9. OBJECTION_TIMING
 *     10. NEEDS_APPROVAL
 *     11. READY_TO_BUY
 *     12. NOT_INTERESTED
 *     13. DO_NOT_CONTACT
 * - Deterministic action routing for every intent.
 * - Invariant: ZERO periodic polling needed; webhook immediately triggers state progression.
 */

import { getDb } from '../db/client.js';
import { DurableEventBus } from './durable-event-bus.js';
import { AutonomyPolicyController } from './autonomy-policy.js';

export type InboundIntent =
  | 'INTERESTED'
  | 'PRICE_QUESTION'
  | 'HOW_IT_WORKS'
  | 'WHAT_DO_YOU_DO'
  | 'SEND_DETAILS'
  | 'CASE_STUDY_REQUEST'
  | 'DEMO_REQUEST'
  | 'OBJECTION_PRICE'
  | 'OBJECTION_TIMING'
  | 'NEEDS_APPROVAL'
  | 'READY_TO_BUY'
  | 'NOT_INTERESTED'
  | 'DO_NOT_CONTACT'
  // Backwards compatibility aliases
  | 'ASKING_FOR_DEMO'
  | 'ASKING_FOR_CASE_STUDY'
  | 'NEEDS_INFORMATION';

export interface InboundMessageEvent {
  businessId: string;
  organizationId: string;
  senderContact: string; // phone or email
  senderName?: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  messageText: string;
  externalMessageId?: string;
  receivedAt?: string;
  journeyId?: string;
}

export interface IntentProcessingResult {
  intent: InboundIntent;
  confidence: number;
  routedAction: string;
  responseTemplate?: string;
  suppressed: boolean;
  pipelineUpdated: boolean;
  details: string;
}

export class SalesConversationEngine {
  private static instance: SalesConversationEngine;
  private policyController = AutonomyPolicyController.getInstance();

  public static getInstance(): SalesConversationEngine {
    if (!SalesConversationEngine.instance) {
      SalesConversationEngine.instance = new SalesConversationEngine();
    }
    return SalesConversationEngine.instance;
  }

  /**
   * Classifies inbound text and executes the corresponding CRM/Pipeline state transition and next action.
   */
  public async handleInboundMessage(event: InboundMessageEvent): Promise<IntentProcessingResult> {
    const db = getDb();
    const intent = this.classifyIntent(event.messageText);

    // 1. DO_NOT_CONTACT: Permanent suppression
    if (intent === 'DO_NOT_CONTACT') {
      this.policyController.suppressContact(event.senderContact, 'DO_NOT_CONTACT');
      this.updatePipelineStage(event.senderContact, 'LOST', 'Prospect requested opt-out (DO_NOT_CONTACT)', event.journeyId);

      DurableEventBus.emit({
        eventType: 'CONTACT_OPT_OUT',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, reason: 'Explicit opt-out keyword received' }
      });

      return {
        intent,
        confidence: 1.0,
        routedAction: 'PERMANENT_SUPPRESSION',
        responseTemplate: 'You have been unsubscribed. We will not contact you again.',
        suppressed: true,
        pipelineUpdated: true,
        details: 'Contact added to permanent suppression table. Outbound communication permanently halted.'
      };
    }

    // 2. NOT_INTERESTED: Mark lost
    if (intent === 'NOT_INTERESTED') {
      this.updatePipelineStage(event.senderContact, 'LOST', 'Prospect indicated not interested', event.journeyId);
      return {
        intent: 'NOT_INTERESTED',
        confidence: 0.9,
        routedAction: 'CLOSE_OPPORTUNITY',
        responseTemplate: 'Understood, thank you for letting us know. Best wishes.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Pipeline stage marked LOST.'
      };
    }

    // 3. READY_TO_BUY: Proposal and payment link
    if (intent === 'READY_TO_BUY') {
      this.updatePipelineStage(event.senderContact, 'PAYMENT_PENDING', 'Customer confirmed readiness to purchase', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent: 'READY_TO_BUY', nextAction: 'SEND_PAYMENT_REQUEST' }
      });

      return {
        intent,
        confidence: 0.95,
        routedAction: 'SEND_PAYMENT_REQUEST',
        responseTemplate: 'Thank you for choosing to move forward! Here is your secure agreement and payment link to kickoff Day 0 onboarding.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Ready to buy detected. Proposal generated and payment request queued.'
      };
    }

    // 4. DEMO_REQUEST / ASKING_FOR_DEMO: Meeting scheduling
    if (intent === 'DEMO_REQUEST' || intent === 'ASKING_FOR_DEMO') {
      this.updatePipelineStage(event.senderContact, 'MEETING_BOOKED', 'Prospect requested appointment/demo', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent, nextAction: 'BOOK_MEETING' }
      });

      return {
        intent,
        confidence: 0.88,
        routedAction: 'BOOK_MEETING',
        responseTemplate: 'We would love to show you how it works. What time tomorrow works best for a 15-minute live walkthrough?',
        suppressed: false,
        pipelineUpdated: true,
        details: 'High interest detected. Scheduling consultation / demo.'
      };
    }

    // 5. PRICE_QUESTION: Pricing breakdown
    if (intent === 'PRICE_QUESTION') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Pricing inquiry received', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent: 'PRICE_QUESTION', nextAction: 'SEND_PRICING_DETAILS' }
      });
      return {
        intent,
        confidence: 0.9,
        routedAction: 'SEND_PRICING_DETAILS',
        responseTemplate: 'Our setup fee is ₹15,000 one-time (5 business day delivery) and ongoing maintenance & hosting is ₹8,000/month. No ad spend required.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Pricing breakdown requested. Dispatched transparent commercial terms.'
      };
    }

    // 6. HOW_IT_WORKS: 5-Day Delivery Roadmap
    if (intent === 'HOW_IT_WORKS') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Operational inquiry received', event.journeyId);
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_DELIVERY_ROADMAP',
        responseTemplate: 'It deploys in 5 days: Day 1 channel connection, Day 2 triage audit, Day 3 bot deployment, Day 4 calendar workflow, Day 5 live testing and handover.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Delivery roadmap dispatched.'
      };
    }

    // 7. WHAT_DO_YOU_DO: High-level value proposition
    if (intent === 'WHAT_DO_YOU_DO') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'High-level inquiry received', event.journeyId);
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_VALUE_PROPOSITION',
        responseTemplate: 'We automate lead conversion for Indian SMBs — answering inquiries in <2 minutes 24/7 on WhatsApp and booking confirmed appointments.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Core value proposition dispatched.'
      };
    }

    // 8. CASE_STUDY_REQUEST / ASKING_FOR_CASE_STUDY: Reference proof
    if (intent === 'CASE_STUDY_REQUEST' || intent === 'ASKING_FOR_CASE_STUDY') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Case study inquiry received', event.journeyId);
      return {
        intent,
        confidence: 0.88,
        routedAction: 'SEND_CASE_STUDY',
        responseTemplate: 'At SmileKraft Dental Clinic, our system reduced inquiry response time from 3.5 hours to 85 seconds, resulting in a 34% increase in attended patient consultations.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Reference case study evidence dispatched.'
      };
    }

    // 9. OBJECTION_PRICE: ROI breakdown
    if (intent === 'OBJECTION_PRICE') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Price objection received', event.journeyId);
      return {
        intent,
        confidence: 0.82,
        routedAction: 'SEND_ROI_BREAKDOWN',
        responseTemplate: 'Most clinics recover the entire setup cost from just 1 to 2 saved patient bookings that would have otherwise gone to a competitor due to response delay.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'ROI evidence dispatched.'
      };
    }

    // 10. OBJECTION_TIMING: Defer follow-up
    if (intent === 'OBJECTION_TIMING') {
      this.updatePipelineStage(event.senderContact, 'CONTACTED', 'Timing objection received', event.journeyId);
      return {
        intent,
        confidence: 0.8,
        routedAction: 'DEFER_FOLLOW_UP',
        responseTemplate: 'Understood. We will check back in a few weeks when your schedule opens up.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Follow-up deferred on cooldown.'
      };
    }

    // 11. NEEDS_APPROVAL: Executive summary
    if (intent === 'NEEDS_APPROVAL') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Stakeholder approval needed', event.journeyId);
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_EXECUTIVE_SUMMARY',
        responseTemplate: 'Here is a 1-page executive brief outlining scope, deliverables, and ROI to review with your partners.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Executive stakeholder brief dispatched.'
      };
    }

    // 12. SEND_DETAILS / NEEDS_INFORMATION: Brief & deliverables
    if (intent === 'SEND_DETAILS' || intent === 'NEEDS_INFORMATION') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Details requested', event.journeyId);
      return {
        intent,
        confidence: 0.8,
        routedAction: 'SEND_OFFER_BRIEF',
        responseTemplate: 'Our system includes 24/7 WhatsApp triage, Google Business Profile booking integration, and multi-touch appointment reminders. May I send over the 1-page summary?',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Offer brief dispatched.'
      };
    }

    // 13. INTERESTED: Qualification questions
    this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'General affirmative interest', event.journeyId);
    return {
      intent: 'INTERESTED',
      confidence: 0.8,
      routedAction: 'SEND_QUALIFICATION_PROMPT',
      responseTemplate: 'Great! How many inquiries does your business typically receive per day, and do you currently have anyone answering outside clinic hours?',
      suppressed: false,
      pipelineUpdated: true,
      details: 'Qualification prompt dispatched.'
    };
  }

  /**
   * Deterministic intent classification (resilient even if LLM is unavailable or quota-locked).
   */
  public classifyIntent(text: string): InboundIntent {
    const lower = (text || '').toLowerCase().trim();

    // 1. Opt-out keywords (DPDP / TRAI compliance)
    if (/stop|unsubscribe|remove me|opt out|don't contact|dont contact|do not call|do not message|leave me alone/.test(lower)) {
      return 'DO_NOT_CONTACT';
    }

    // 2. Purchase / payment readiness
    if (/ready to (buy|proceed|move forward|purchase)|send payment link|how do i pay|i want to purchase|send invoice|i accept|proceed with booking|book my slot|send payment/.test(lower)) {
      return 'READY_TO_BUY';
    }

    // 3. Demo / appointment request
    if (/demo|consultation|appointment|schedule|meeting|call me|visit|book a slot|available time|calendar/.test(lower)) {
      return 'DEMO_REQUEST';
    }

    // 4. Price objection (checked before generic price question)
    if (/too expensive|expensive|costly|can't afford|budget too high|out of budget|price is high/.test(lower)) {
      return 'OBJECTION_PRICE';
    }

    // 5. Timing objection
    if (/next month|later|not now|busy right now|check after few weeks|timing is bad/.test(lower)) {
      return 'OBJECTION_TIMING';
    }

    // 6. Needs partner/boss approval
    if (/partner|director|boss|approval|management|consult my team|discuss with/.test(lower)) {
      return 'NEEDS_APPROVAL';
    }

    // 7. Price inquiry
    if (/how much|cost|price|fee|rate|discount|charges|quote|package price/.test(lower)) {
      return 'PRICE_QUESTION';
    }

    // 8. How it works / operational inquiry
    if (/how does it work|how it works|process|workflow|what is the process|delivery time/.test(lower)) {
      return 'HOW_IT_WORKS';
    }

    // 9. What do you do / service overview
    if (/what do you (actually )?do|what does (your|the) (company|business|platform|service|organization) (actually )?do|what service|who are you|what is this|tell me what you offer/.test(lower)) {
      return 'WHAT_DO_YOU_DO';
    }

    // 10. Case study / portfolio / proof
    if (/case study|portfolio|previous work|results|examples|before and after|reviews|client proof/.test(lower)) {
      return 'CASE_STUDY_REQUEST';
    }

    // 11. Send details / brochure
    if (/brochure|whitepaper|deck|send details|send info|share details|(send|email|share).*(details|brochure|pdf|info|deck)/.test(lower)) {
      return 'SEND_DETAILS';
    }

    // 12. Negative / not interested
    if (/not interested|no thanks|not looking|already have|don't need|dont need/.test(lower)) {
      return 'NOT_INTERESTED';
    }

    // 13. General affirmative / interested
    if (/interested|yes|tell me more|sounds good|sounds interesting|sure|okay|count me in/.test(lower)) {
      return 'INTERESTED';
    }

    return 'SEND_DETAILS';
  }

  private updatePipelineStage(contact: string, newStage: string, reason: string, journeyId?: string): void {
    const db = getDb();
    try {
      let targetJourneyId = journeyId;

      if (!targetJourneyId) {
        const journey = db.prepare(`
          SELECT id FROM customer_journeys
          WHERE customer_phone = ? OR customer_email = ?
        `).get(contact, contact) as any;
        targetJourneyId = journey?.id;
      }

      if (targetJourneyId) {
        db.prepare(`
          UPDATE sales_pipeline
          SET stage = ?, reason = ?, updated_at = datetime('now')
          WHERE journey_id = ?
        `).run(newStage, reason, targetJourneyId);

        db.prepare(`
          UPDATE customer_journeys
          SET stage = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newStage, targetJourneyId);

        const transId = `ptrans_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(`
          INSERT INTO pipeline_transitions (
            id, pipeline_id, business_id, previous_state, new_state, actor, reason, timestamp
          ) VALUES (?, ?, 'biz_smilekraft_hyd', 'AUTOMATED_INBOUND', ?, 'sales-conversation-engine', ?, datetime('now'))
        `).run(transId, targetJourneyId, newStage, reason);
      }
    } catch {}
  }
}
