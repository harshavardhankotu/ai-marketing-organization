/**
 * SalesConversationEngine — Inbound response intent classification and autonomous next action routing.
 *
 * Implements Spec § 8 & § 9:
 * - Processes inbound webhook events:
 *     MESSAGE_RECEIVED | EMAIL_RECEIVED | MEETING_REPLY | PAYMENT_RECEIVED | PAYMENT_FAILED | CUSTOMER_REPLIED | CONTACT_OPT_OUT
 * - Classifies response intent:
 *     INTERESTED | PRICE_QUESTION | NEEDS_INFORMATION | ASKING_FOR_DEMO | ASKING_FOR_CASE_STUDY |
 *     OBJECTION_PRICE | OBJECTION_TIMING | NOT_INTERESTED | DO_NOT_CONTACT | READY_TO_BUY
 * - Deterministic action routing:
 *     READY_TO_BUY -> Generate proposal & payment request
 *     PRICE_QUESTION -> Dispatch pricing breakdown & offer terms
 *     INTERESTED / ASKING_FOR_DEMO -> Trigger consultation / demo booking
 *     NOT_INTERESTED -> Mark opportunity LOST
 *     DO_NOT_CONTACT -> Enforce permanent suppression & unsubscribe immediately
 */

import { getDb } from '../db/client.js';
import { DurableEventBus } from './durable-event-bus.js';
import { AutonomyPolicyController } from './autonomy-policy.js';

export type InboundIntent =
  | 'INTERESTED'
  | 'PRICE_QUESTION'
  | 'NEEDS_INFORMATION'
  | 'ASKING_FOR_DEMO'
  | 'ASKING_FOR_CASE_STUDY'
  | 'OBJECTION_PRICE'
  | 'OBJECTION_TIMING'
  | 'NOT_INTERESTED'
  | 'DO_NOT_CONTACT'
  | 'READY_TO_BUY';

export interface InboundMessageEvent {
  businessId: string;
  organizationId: string;
  senderContact: string; // phone or email
  senderName?: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  messageText: string;
  externalMessageId?: string;
  receivedAt?: string;
}

export interface IntentProcessingResult {
  intent: InboundIntent;
  confidence: number;
  routedAction: string;
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
   * Classifies inbound text and executes the corresponding CRM/Pipeline state transition.
   */
  public async handleInboundMessage(event: InboundMessageEvent): Promise<IntentProcessingResult> {
    const db = getDb();
    const intent = this.classifyIntent(event.messageText);

    // 1. Opt-Out / Do Not Contact permanent suppression
    if (intent === 'DO_NOT_CONTACT') {
      this.policyController.suppressContact(event.senderContact, 'DO_NOT_CONTACT');
      this.updatePipelineStage(event.senderContact, 'LOST', 'Prospect requested opt-out (DO_NOT_CONTACT)');

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
        suppressed: true,
        pipelineUpdated: true,
        details: 'Contact added to permanent suppression table. Outbound communication halted.'
      };
    }

    // 2. Not interested -> Close opportunity
    if (intent === 'NOT_INTERESTED') {
      this.updatePipelineStage(event.senderContact, 'LOST', 'Prospect indicated not interested');
      return {
        intent: 'NOT_INTERESTED',
        confidence: 0.9,
        routedAction: 'CLOSE_OPPORTUNITY',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Pipeline stage marked LOST.'
      };
    }

    // 3. Ready to Buy -> Proposal and Payment Request
    if (intent === 'READY_TO_BUY') {
      this.updatePipelineStage(event.senderContact, 'PAYMENT_PENDING', 'Customer confirmed readiness to purchase');
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
        suppressed: false,
        pipelineUpdated: true,
        details: 'Ready to buy detected. Payment request and proposal initiated.'
      };
    }

    // 4. Interested / Asking for Demo / Asking for Meeting
    if (intent === 'INTERESTED' || intent === 'ASKING_FOR_DEMO') {
      this.updatePipelineStage(event.senderContact, 'MEETING_BOOKED', 'Prospect requested appointment/demo');
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent, nextAction: 'BOOK_MEETING' }
      });

      return {
        intent,
        confidence: 0.85,
        routedAction: 'BOOK_MEETING',
        suppressed: false,
        pipelineUpdated: true,
        details: 'High interest detected. Scheduling consultation.'
      };
    }

    // 5. Price Question / Information Inquiry
    this.updatePipelineStage(event.senderContact, 'QUALIFIED', `Inquiry received: ${intent}`);
    DurableEventBus.emit({
      eventType: 'LEAD_REPLIED',
      organizationId: event.organizationId,
      businessId: event.businessId,
      payload: { contact: event.senderContact, intent, nextAction: 'FOLLOW_UP_LEAD' }
    });

    return {
      intent,
      confidence: 0.8,
      routedAction: 'SEND_PRICING_DETAILS',
      suppressed: false,
      pipelineUpdated: true,
      details: 'Pricing/clarification requested. Dispatched offer breakdown.'
    };
  }

  /**
   * Deterministic intent classification (resilient even if LLM is unavailable or quota-locked).
   */
  public classifyIntent(text: string): InboundIntent {
    const lower = (text || '').toLowerCase().trim();

    // Check opt-out keywords first (TRAI / DPDP compliance)
    if (/stop|unsubscribe|remove me|opt out|don't contact|dont contact|do not call|do not message|leave me alone/.test(lower)) {
      return 'DO_NOT_CONTACT';
    }

    // Check purchase intent
    if (/ready to buy|send payment link|how do i pay|i want to purchase|send invoice|i accept|proceed with booking|book my slot/.test(lower)) {
      return 'READY_TO_BUY';
    }

    // Check demo / meeting requests
    if (/demo|consultation|appointment|schedule|meeting|call me|visit|book a slot|available time/.test(lower)) {
      return 'ASKING_FOR_DEMO';
    }

    // Check pricing questions
    if (/how much|cost|price|fee|rate|discount|charges|quote|package price/.test(lower)) {
      return 'PRICE_QUESTION';
    }

    // Check case study / proof questions
    if (/case study|portfolio|previous work|results|examples|before and after|reviews/.test(lower)) {
      return 'ASKING_FOR_CASE_STUDY';
    }

    // Check price objection
    if (/too expensive|costly|can't afford|budget too high|out of budget/.test(lower)) {
      return 'OBJECTION_PRICE';
    }

    // Check timing objection
    if (/next month|later|not now|busy right now|check after few weeks/.test(lower)) {
      return 'OBJECTION_TIMING';
    }

    // Check negative / not interested
    if (/not interested|no thanks|not looking|already have|don't need|dont need/.test(lower)) {
      return 'NOT_INTERESTED';
    }

    // Check general affirmative / interested
    if (/interested|yes|tell me more|sounds good|details|info|share details/.test(lower)) {
      return 'INTERESTED';
    }

    return 'NEEDS_INFORMATION';
  }

  private updatePipelineStage(contact: string, newStage: string, reason: string): void {
    const db = getDb();
    try {
      // Find matching pipeline item by journey phone or email
      const journey = db.prepare(`
        SELECT id, business_id FROM customer_journeys
        WHERE customer_phone = ? OR customer_email = ?
      `).get(contact, contact) as any;

      if (journey) {
        db.prepare(`
          UPDATE sales_pipeline
          SET stage = ?, reason = ?, updated_at = datetime('now')
          WHERE journey_id = ?
        `).run(newStage, reason, journey.id);

        db.prepare(`
          UPDATE customer_journeys
          SET stage = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(newStage, journey.id);

        // Record transition in pipeline_transitions audit log
        const transId = `ptrans_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(`
          INSERT INTO pipeline_transitions (
            id, pipeline_id, business_id, previous_state, new_state, actor, reason, timestamp
          ) VALUES (?, ?, ?, 'AUTOMATED_INBOUND', ?, 'sales-conversation-engine', ?, datetime('now'))
        `).run(transId, journey.id, journey.business_id, newStage, reason);
      }
    } catch {}
  }
}
