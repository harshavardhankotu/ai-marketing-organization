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

import { createHash, randomUUID } from 'crypto';
import { getSiteAuditFixpackPriceINR, getDirectUpiConfig } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
import { DurableEventBus } from './durable-event-bus.js';
import { AutonomyPolicyController } from './autonomy-policy.js';
import { IntegrationCapabilityRegistry } from '../control-plane/integration-capability-registry.js';

export type IdentityProvenance =
  | 'ANONYMOUS_WEB_SESSION'
  | 'UNVERIFIED_WEB_CONTACT'
  | 'VERIFIED_WHATSAPP_WEBHOOK'
  | 'VERIFIED_EMAIL_WEBHOOK';

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
  senderContact: string; // phone, email, or web session key
  senderName?: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'WEB_DESK';
  messageText: string;
  productSlugOrContext?: string;
  consentGiven?: boolean;
  externalMessageId?: string;
  receivedAt?: string;
  journeyId?: string;
  sessionId?: string;
  provenance?: IdentityProvenance;
  isDiagnosticProbe?: boolean;
}

export interface ResolvedCatalogOffer {
  kind: 'AFFILIATE_DEAL' | 'DIGITAL_PRODUCT' | 'SERVICE_OFFER' | 'FINANCIAL_RESEARCH';
  lane?: 'LANE_A_AFFILIATE' | 'LANE_B_SERVICES' | 'LANE_C_PARTNER_OFFERS' | 'LANE_D_DIGITAL_PRODUCTS' | 'LANE_E_FINANCIAL_RADAR';
  idOrSlug: string;
  title: string;
  merchantOrProvider: string;
  priceINR: number | null;
  referencePriceINR?: number | null;
  verifiedDiscountPercent?: number | null;
  availability: string;
  offerPath: string;
  permittedClaims: string[];
  score?: number;
}

export interface DeskCheckoutPayload {
  checkoutMode: 'OWNED_CHECKOUT_CREATED' | 'AFFILIATE_REDIRECT_READY';
  orderId?: string;
  clickId?: string;
  sku: string;
  amountINR: number | null;
  upiDeepLink?: string;
  upiClaimEndpoint?: string;
  checkoutUrl?: string;
  redirectUrl?: string;
  merchantUrl?: string;
}

export interface IntentProcessingResult {
  intent: InboundIntent;
  confidence: number;
  routedAction: string;
  responseTemplate?: string;
  suppressed: boolean;
  contactSuppressed?: boolean;
  suppressedScope?: 'GLOBAL_CONTACT' | 'SESSION_ONLY' | 'NONE';
  pipelineUpdated: boolean;
  pipelineStage?: string;
  details: string;
  sessionId?: string;
  journeyId?: string;
  provenance?: IdentityProvenance;
  conversationState?: 'ANSWERED' | 'CLARIFICATION_NEEDED' | 'CHECKOUT_CREATED' | 'AFFILIATE_REDIRECT_READY' | 'ESCALATED' | 'SUPPRESSED';
  clarificationOptions?: ResolvedCatalogOffer[];
  checkout?: DeskCheckoutPayload | null;
  resolvedOffer?: ResolvedCatalogOffer | null;
  escalationCreated?: boolean;
  escalationId?: string | null;
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
   * Classifies inbound text and executes durable journey/pipeline/demand persistence,
   * 5-lane universal catalog matching, clarification, and synchronous checkout/redirect orchestration.
   */
  public async handleInboundMessage(event: InboundMessageEvent): Promise<IntentProcessingResult> {
    const provenance: IdentityProvenance =
      event.provenance ||
      (event.channel === 'WHATSAPP'
        ? 'VERIFIED_WHATSAPP_WEBHOOK'
        : event.channel === 'EMAIL'
          ? 'VERIFIED_EMAIL_WEBHOOK'
          : /@|^\+?\d{7,15}$/.test(String(event.senderContact || '').trim())
            ? 'UNVERIFIED_WEB_CONTACT'
            : 'ANONYMOUS_WEB_SESSION');

    const sessionId =
      event.sessionId ||
      `sess_${createHash('sha256').update(`${event.channel}:${event.senderContact}`).digest('hex').slice(0, 14)}`;

    const intent = this.classifyIntent(event.messageText);

    // 0. Ensure durable customer_journeys, sales_pipeline & FIRST_PARTY_CUSTOMER_DESK demand_signal
    const { journeyId, lastOfferContext } = await this.ensureDurableJourneyAndDemandSignal(
      event,
      provenance,
      sessionId,
      intent
    );

    const effectiveEvent: InboundMessageEvent = {
      ...event,
      journeyId: event.journeyId || journeyId,
      sessionId,
      provenance,
      productSlugOrContext: event.productSlugOrContext || lastOfferContext || undefined
    };

    // 1. DO_NOT_CONTACT: Anti-impersonation guard — only verified WhatsApp/Email webhooks write senderContact to outreach_suppression_list
    if (intent === 'DO_NOT_CONTACT') {
      const isVerifiedChannel =
        provenance === 'VERIFIED_WHATSAPP_WEBHOOK' || provenance === 'VERIFIED_EMAIL_WEBHOOK';
      if (isVerifiedChannel) {
        this.policyController.suppressContact(event.senderContact, 'DO_NOT_CONTACT');
      }
      await this.updatePipelineStageAsync(
        event.senderContact,
        'LOST',
        isVerifiedChannel
          ? 'Prospect requested opt-out (DO_NOT_CONTACT via verified channel)'
          : `Unverified web session (${sessionId}) opted out; senderContact NOT globally suppressed to prevent impersonation`,
        effectiveEvent.journeyId
      );

      if (isVerifiedChannel) {
        await DurableEventBus.emitAsync({
          eventType: 'CONTACT_OPT_OUT',
          organizationId: event.organizationId,
          businessId: event.businessId,
          payload: { contact: event.senderContact, provenance, sessionId, reason: 'Explicit opt-out keyword received' }
        }).catch(() => {});
      }

      return {
        intent,
        confidence: 1.0,
        routedAction: isVerifiedChannel ? 'PERMANENT_SUPPRESSION' : 'SESSION_SUPPRESSION',
        responseTemplate: 'You have been unsubscribed for this conversation. We will not message you again.',
        suppressed: true,
        contactSuppressed: isVerifiedChannel,
        suppressedScope: isVerifiedChannel ? 'GLOBAL_CONTACT' : 'SESSION_ONLY',
        pipelineUpdated: true,
        pipelineStage: 'LOST',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'SUPPRESSED',
        details: isVerifiedChannel
          ? 'Verified contact added to permanent suppression table. Outbound communication halted.'
          : 'Unverified web opt-out quarantined to session only (outreach_suppression_list untouched).'
      };
    }

    // 2. NOT_INTERESTED: Mark lost
    if (intent === 'NOT_INTERESTED') {
      await this.updatePipelineStageAsync(event.senderContact, 'LOST', 'Prospect indicated not interested', effectiveEvent.journeyId);
      return {
        intent: 'NOT_INTERESTED',
        confidence: 0.9,
        routedAction: 'CLOSE_OPPORTUNITY',
        responseTemplate: 'Understood, thank you for letting us know. Best wishes.',
        suppressed: false,
        contactSuppressed: false,
        suppressedScope: 'NONE',
        pipelineUpdated: true,
        pipelineStage: 'LOST',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Pipeline stage marked LOST.'
      };
    }

    // 3. READY_TO_BUY: Server-authoritative owned checkout (payment_requests) OR tracked affiliate redirect
    if (intent === 'READY_TO_BUY') {
      const resolution = await this.resolveCatalogContextDetailed(effectiveEvent);
      if (resolution.clarificationNeeded && resolution.clarificationOptions.length >= 2) {
        await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Broad category purchase intent requires product clarification', effectiveEvent.journeyId);
        const optionsSummary = resolution.clarificationOptions
          .map((o, idx) => `${idx + 1}. ${o.title} (${o.priceINR !== null ? `₹${o.priceINR.toLocaleString('en-IN')}` : 'Live rate'}) — ${o.offerPath}`)
          .join(' | ');
        return {
          intent,
          confidence: 0.85,
          routedAction: 'REQUEST_PRODUCT_CLARIFICATION',
          responseTemplate: `Multiple active verified matches found before checkout: ${optionsSummary}. Please reply with the exact item name or slug to generate checkout.`,
          suppressed: false,
          pipelineUpdated: true,
          pipelineStage: 'QUALIFIED',
          sessionId,
          journeyId: effectiveEvent.journeyId,
          provenance,
          conversationState: 'CLARIFICATION_NEEDED',
          clarificationOptions: resolution.clarificationOptions,
          resolvedOffer: null,
          checkout: null,
          escalationCreated: false,
          escalationId: null,
          details: 'Multiple close matches found; clarification requested prior to order creation.'
        };
      }

      const resolvedOffer = resolution.resolvedOffer;
      if (resolvedOffer) {
        if (
          (resolvedOffer.kind === 'DIGITAL_PRODUCT' || resolvedOffer.kind === 'SERVICE_OFFER') &&
          (resolvedOffer.priceINR === null || !(resolvedOffer.priceINR > 0))
        ) {
          await this.updatePipelineStageAsync(event.senderContact, 'PAYMENT_PENDING', 'PRICE_NOT_SET for owned SKU', effectiveEvent.journeyId);
          return {
            intent,
            confidence: 0.9,
            routedAction: 'PRICE_NOT_SET',
            responseTemplate: `Checkout for ${resolvedOffer.title} is temporarily unavailable because the authoritative server price is not configured (PRICE_NOT_SET).`,
            suppressed: false,
            pipelineUpdated: true,
            pipelineStage: 'PAYMENT_PENDING',
            sessionId,
            journeyId: effectiveEvent.journeyId,
            provenance,
            conversationState: 'PRICE_NOT_SET' as any,
            checkout: null,
            resolvedOffer,
            escalationCreated: false,
            escalationId: null,
            details: 'PRICE_NOT_SET: SITE_AUDIT_FIXPACK_PRICE_INR is not configured; no payment_requests order created.'
          };
        }

        await this.recordOfferContextOnJourney(effectiveEvent.journeyId!, sessionId, resolvedOffer.idOrSlug);
        const checkoutRes = await this.createCheckoutOrRedirect(effectiveEvent, resolvedOffer, sessionId, effectiveEvent.journeyId!);
        await this.updatePipelineStageAsync(event.senderContact, checkoutRes.pipelineStage, checkoutRes.reason, effectiveEvent.journeyId);
        await DurableEventBus.emitAsync({
          eventType: 'LEAD_REPLIED',
          organizationId: event.organizationId,
          businessId: event.businessId,
          payload: {
            contact: event.senderContact,
            sessionId,
            journeyId: effectiveEvent.journeyId,
            intent: 'READY_TO_BUY',
            nextAction: 'SEND_PAYMENT_REQUEST',
            checkoutMode: checkoutRes.checkout.checkoutMode,
            orderId: checkoutRes.checkout.orderId || null,
            clickId: checkoutRes.checkout.clickId || null
          }
        }).catch(() => {});

        return {
          intent,
          confidence: 0.96,
          routedAction: 'SEND_PAYMENT_REQUEST',
          responseTemplate: checkoutRes.responseTemplate,
          suppressed: false,
          pipelineUpdated: true,
          pipelineStage: checkoutRes.pipelineStage,
          sessionId,
          journeyId: effectiveEvent.journeyId,
          provenance,
          conversationState: checkoutRes.conversationState,
          checkout: checkoutRes.checkout,
          resolvedOffer,
          escalationCreated: false,
          escalationId: null,
          details: checkoutRes.reason
        };
      }

      await this.updatePipelineStageAsync(event.senderContact, 'PAYMENT_PENDING', 'Customer ready to buy but offer unresolved', effectiveEvent.journeyId);
      const escId = await this.createOwnerEscalationTask(
        effectiveEvent,
        'READY_TO_BUY',
        'Buyer expressed purchase readiness without matching an active verified catalog offer.'
      );
      await DurableEventBus.emitAsync({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, sessionId, journeyId: effectiveEvent.journeyId, intent: 'READY_TO_BUY', nextAction: 'OWNER_CLARIFICATION' }
      }).catch(() => {});

      return {
        intent,
        confidence: 0.9,
        routedAction: 'SEND_PAYMENT_REQUEST',
        responseTemplate: 'Please share the exact verified product slug on /deals or website domain for /tools/site-audit (₹499 Core Fix-Pack) so I can create your verified checkout or merchant link immediately.',
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'PAYMENT_PENDING',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ESCALATED',
        checkout: null,
        resolvedOffer: null,
        escalationCreated: Boolean(escId),
        escalationId: escId,
        details: 'Purchase intent logged cleanly without fallback ₹15,000 fabrication; awaiting exact offer slug or owner review.'
      };
    }

    // 4. DEMO_REQUEST / ASKING_FOR_DEMO: Demo requested awaiting calendar confirmation (never auto-marked MEETING_BOOKED)
    if (intent === 'DEMO_REQUEST' || intent === 'ASKING_FOR_DEMO') {
      const resolution = await this.resolveCatalogContextDetailed(effectiveEvent);
      const resolvedOffer = resolution.resolvedOffer;
      await this.updatePipelineStageAsync(event.senderContact, 'DEMO_REQUESTED_PENDING_CONFIRMATION', 'Prospect requested consultation/demo (awaiting slot confirmation)', effectiveEvent.journeyId);
      await DurableEventBus.emitAsync({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, sessionId, journeyId: effectiveEvent.journeyId, intent, nextAction: 'BOOK_MEETING', slotConfirmed: false }
      }).catch(() => {});

      return {
        intent,
        confidence: 0.88,
        routedAction: 'BOOK_MEETING',
        responseTemplate: 'Thank you — we have logged your demo/callback request (status: DEMO_REQUESTED_PENDING_CONFIRMATION). Please share a preferred time window tomorrow so the owner can confirm a calendar slot.',
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'DEMO_REQUESTED_PENDING_CONFIRMATION',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Demo requested. Status set to DEMO_REQUESTED_PENDING_CONFIRMATION awaiting confirmed slot.',
        resolvedOffer,
        escalationCreated: false,
        escalationId: null
      };
    }

    const resolution = await this.resolveCatalogContextDetailed(effectiveEvent);
    if (resolution.clarificationNeeded && resolution.clarificationOptions.length >= 2) {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Broad category query matched multiple verified offers', effectiveEvent.journeyId);
      const optionsText = resolution.clarificationOptions
        .map((o, idx) => `${idx + 1}) ${o.title} (${o.priceINR !== null ? `₹${o.priceINR.toLocaleString('en-IN')}` : 'Live rate'}, ${o.merchantOrProvider}) — ${o.offerPath}`)
        .join(' | ');
      return {
        intent,
        confidence: 0.86,
        routedAction: 'REQUEST_PRODUCT_CLARIFICATION',
        responseTemplate: `We found ${resolution.clarificationOptions.length} active verified options matching your query: ${optionsText}. Which one would you like details or checkout for?`,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'CLARIFICATION_NEEDED',
        clarificationOptions: resolution.clarificationOptions,
        resolvedOffer: null,
        escalationCreated: false,
        escalationId: null,
        details: `Broad query returned ${resolution.clarificationOptions.length} clarification candidates.`
      };
    }

    const resolvedOffer = resolution.resolvedOffer;
    if (resolvedOffer && effectiveEvent.journeyId) {
      await this.recordOfferContextOnJourney(effectiveEvent.journeyId, sessionId, resolvedOffer.idOrSlug);
    }
    const whatsAppVerified = this.isWhatsAppOperationallyVerified();
    const customOrHumanRequested = /\b(custom|bespoke|bulk|enterprise|sla|negotiate|human|manager|support|complaint|refund|special terms|clinic pilot)\b/i.test(
      `${event.messageText} ${event.productSlugOrContext || ''}`
    );

    // Trigger human escalation whenever query asks for custom/human support OR cannot be matched to verified catalog data
    const needsEscalation =
      customOrHumanRequested ||
      (!resolvedOffer && ['PRICE_QUESTION', 'HOW_IT_WORKS', 'WHAT_DO_YOU_DO', 'SEND_DETAILS', 'NEEDS_INFORMATION', 'OBJECTION_PRICE', 'NEEDS_APPROVAL', 'INTERESTED'].includes(intent));

    let escalationId: string | null = null;
    if (needsEscalation) {
      escalationId = await this.createOwnerEscalationTask(
        effectiveEvent,
        intent,
        customOrHumanRequested
          ? 'Customer requested custom scope, pricing terms, or human assistance.'
          : 'Inbound query could not be deterministically matched to an active verified catalog item.'
      );
    }

    // 5. PRICE_QUESTION: Live D1 catalog pricing breakdown (never hardcoded ₹15k/₹8k clinic templates)
    if (intent === 'PRICE_QUESTION') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Pricing inquiry received', effectiveEvent.journeyId);
      await DurableEventBus.emitAsync({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, sessionId, journeyId: effectiveEvent.journeyId, intent: 'PRICE_QUESTION', nextAction: 'SEND_PRICING_DETAILS' }
      }).catch(() => {});

      let responseTemplate: string;
      if (resolvedOffer) {
        const pricePart = resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR.toLocaleString('en-IN')}` : 'See live listing';
        const discPart = resolvedOffer.verifiedDiscountPercent ? ` (${resolvedOffer.verifiedDiscountPercent}% verified reduction)` : '';
        responseTemplate = `${resolvedOffer.title} (${resolvedOffer.merchantOrProvider}) is currently listed at ${pricePart}${discPart}, availability: ${resolvedOffer.availability}. Permitted details: ${resolvedOffer.permittedClaims.join('; ')}. Direct path: ${resolvedOffer.offerPath}.`;
      } else {
        responseTemplate = 'Custom or unattested pilot scopes require an explicit owner-confirmed quote before commercial terms are issued. Meanwhile, verified SiteFix Core Audits are ₹499 (/tools/site-audit) and live merchant deals are browsable at /deals. Your request has been queued for owner review.';
      }

      return {
        intent,
        confidence: 0.9,
        routedAction: 'SEND_PRICING_DETAILS',
        responseTemplate,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: escalationId && !resolvedOffer ? 'ESCALATED' : 'ANSWERED',
        details: resolvedOffer
          ? `Resolved live catalog pricing for ${resolvedOffer.idOrSlug}.`
          : 'Unresolved pricing query escalated to OWNER_ESCALATION_REQUIRED.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 6. HOW_IT_WORKS: Deterministic delivery / workflow summary grounded in live catalog
    if (intent === 'HOW_IT_WORKS') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Operational inquiry received', effectiveEvent.journeyId);
      const waCapabilityNote = whatsAppVerified
        ? 'WhatsApp replies and web desk triage are both active.'
        : '24/7 web desk triage (/api/v1/customer-desk/message) and email/offer forms are active; WhatsApp Cloud API auto-dispatch awaits owner credentials (DISCOVERED).';
      const responseTemplate = resolvedOffer
        ? `${resolvedOffer.title} is ${resolvedOffer.availability} via ${resolvedOffer.offerPath}. ${resolvedOffer.permittedClaims.join(' ')}. ${waCapabilityNote}`
        : `Our 24/7 web customer desk answers verified product and SiteFix queries immediately, while SiteFix runs deterministic SEO/CWV audits on /tools/site-audit and verified merchant offers live on /deals. ${waCapabilityNote}`;
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_DELIVERY_ROADMAP',
        responseTemplate,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Catalog-grounded operational response dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 7. WHAT_DO_YOU_DO: Truthful platform & active channel summary
    if (intent === 'WHAT_DO_YOU_DO') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'High-level inquiry received', effectiveEvent.journeyId);
      const waStatusText = whatsAppVerified
        ? 'including verified WhatsApp replies'
        : 'via 24/7 web desk & audit tools (WhatsApp Cloud API is currently unconfigured/DISCOVERED)';
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_VALUE_PROPOSITION',
        responseTemplate: `We operate verified Indian consumer deal comparisons (/deals), deterministic technical SEO audits (/tools/site-audit), and SEBI-educational market research tools (/tools/financial-radar), ${waStatusText}.`,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Verified capability overview dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 8. CASE_STUDY_REQUEST / ASKING_FOR_CASE_STUDY: Reference proof without fabricated claims
    if (intent === 'CASE_STUDY_REQUEST' || intent === 'ASKING_FOR_CASE_STUDY') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Case study inquiry received', effectiveEvent.journeyId);
      return {
        intent,
        confidence: 0.88,
        routedAction: 'SEND_CASE_STUDY',
        responseTemplate: 'We publish live, deterministic technical SEO audit reports at /tools/site-audit and verified merchant deal comparisons at /deals. No unverified customer revenue case studies are claimed prior to owner confirmation.',
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Truthful evidence links dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 9. OBJECTION_PRICE: No unsupported ROI promises
    if (intent === 'OBJECTION_PRICE') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Price objection received', effectiveEvent.journeyId);
      const responseTemplate = resolvedOffer
        ? `For ${resolvedOffer.title}, the live verified price is ${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR.toLocaleString('en-IN')}` : 'determined by merchant'} via ${resolvedOffer.offerPath}. We never invent projected ROI; the SiteFix Core diagnostic is ₹499 one-time and public research tools on /tools/financial-radar are free.`
        : 'We do not promise unverified ROI multipliers. Free technical diagnostics run at /tools/site-audit and ₹499 unlocks the Core Fix-Pack, while custom commercial quotes are reviewed by the owner.';
      return {
        intent,
        confidence: 0.82,
        routedAction: 'SEND_ROI_BREAKDOWN',
        responseTemplate,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: escalationId ? 'ESCALATED' : 'ANSWERED',
        details: 'Transparent price response dispatched without unsupported ROI claims.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 10. OBJECTION_TIMING: Defer follow-up
    if (intent === 'OBJECTION_TIMING') {
      await this.updatePipelineStageAsync(event.senderContact, 'CONTACTED', 'Timing objection received', effectiveEvent.journeyId);
      return {
        intent,
        confidence: 0.8,
        routedAction: 'DEFER_FOLLOW_UP',
        responseTemplate: 'Understood. We will check back when your schedule opens up.',
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'CONTACTED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: 'ANSWERED',
        details: 'Follow-up deferred on cooldown.',
        resolvedOffer,
        escalationCreated: false,
        escalationId: null
      };
    }

    // 11. NEEDS_APPROVAL: Executive summary
    if (intent === 'NEEDS_APPROVAL') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Stakeholder approval needed', effectiveEvent.journeyId);
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_EXECUTIVE_SUMMARY',
        responseTemplate: resolvedOffer
          ? `Summary for stakeholder review: ${resolvedOffer.title} (${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR}` : 'catalog rate'}, ${resolvedOffer.availability}) at ${resolvedOffer.offerPath}.`
          : 'Summary links for partner review: verified deals (/deals), SiteFix audits (/tools/site-audit), and financial research tools (/tools/financial-radar). Escalated to owner for formal brief if needed.',
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: escalationId ? 'ESCALATED' : 'ANSWERED',
        details: 'Stakeholder brief dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 12. SEND_DETAILS / NEEDS_INFORMATION: Brief & deliverables grounded in catalog
    if (intent === 'SEND_DETAILS' || intent === 'NEEDS_INFORMATION') {
      await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'Details requested', effectiveEvent.journeyId);
      const waCapabilityNote = whatsAppVerified
        ? 'WhatsApp Cloud API replies are active.'
        : '24/7 web desk inquiries are answered immediately; WhatsApp Cloud API auto-dispatch is currently unconfigured (DISCOVERED).';
      const responseTemplate = resolvedOffer
        ? `${resolvedOffer.title} (${resolvedOffer.merchantOrProvider}): ${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR.toLocaleString('en-IN')}` : 'Live catalog'}, ${resolvedOffer.availability}. Link: ${resolvedOffer.offerPath}. ${waCapabilityNote}`
        : `Could you clarify which product, deal slug, or website domain you are asking about? Live listings are on /deals and audits on /tools/site-audit. Your inquiry has been flagged for owner follow-up. ${waCapabilityNote}`;
      return {
        intent,
        confidence: 0.8,
        routedAction: 'SEND_OFFER_BRIEF',
        responseTemplate,
        suppressed: false,
        pipelineUpdated: true,
        pipelineStage: 'QUALIFIED',
        sessionId,
        journeyId: effectiveEvent.journeyId,
        provenance,
        conversationState: escalationId && !resolvedOffer ? 'ESCALATED' : 'ANSWERED',
        details: resolvedOffer
          ? `Catalog brief dispatched for ${resolvedOffer.idOrSlug}.`
          : 'Unresolved details query escalated to OWNER_ESCALATION_REQUIRED.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 13. INTERESTED: Catalog-grounded qualification prompt
    await this.updatePipelineStageAsync(event.senderContact, 'QUALIFIED', 'General affirmative interest', effectiveEvent.journeyId);
    return {
      intent: 'INTERESTED',
      confidence: 0.8,
      routedAction: 'SEND_QUALIFICATION_PROMPT',
      responseTemplate: resolvedOffer
        ? `Glad you are interested in ${resolvedOffer.title} (${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR}` : 'live catalog'}, ${resolvedOffer.availability}) — review directly at ${resolvedOffer.offerPath}.`
        : 'Great! Share the deal slug, product category, or website domain you would like checked, or browse /deals and /tools/site-audit.',
      suppressed: false,
      pipelineUpdated: true,
      pipelineStage: 'QUALIFIED',
      sessionId,
      journeyId: effectiveEvent.journeyId,
      provenance,
      conversationState: escalationId && !resolvedOffer ? 'ESCALATED' : 'ANSWERED',
      details: 'Catalog-grounded qualification prompt dispatched.',
      resolvedOffer,
      escalationCreated: Boolean(escalationId),
      escalationId
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
    if (/ready to (buy|proceed|move forward|purchase)|want to (buy|order|purchase)|buy (this|it|the)|order (this|it|now)|grab (this|it)|i'?ll take it|confirm purchase|confirm order|yes[ ,]+buy|proceed to pay|pay now|buy now|checkout|send payment link|how do i pay|send invoice|i accept|proceed with booking|book my slot|send payment/.test(lower)) {
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

  private isWhatsAppOperationallyVerified(): boolean {
    try {
      const reg = IntegrationCapabilityRegistry.evaluateAll();
      const wa = reg.integrations.find(i => i.id === 'META_WHATSAPP');
      return wa?.state === 'OPERATIONALLY_VERIFIED';
    } catch {
      return false;
    }
  }

  private async safeQueryAll<T = any>(table: string, sql: string, params: any[] = []): Promise<T[]> {
    try {
      if (isProduction() && !process.env.VITEST) {
        return await D1RevenueRepository.getInstance().query<T>(table, sql, params);
      }
      return getDb().prepare(sql).all(...params) as T[];
    } catch {
      return [];
    }
  }

  private async safeExecWrite(table: string, sql: string, params: any[] = []): Promise<void> {
    if (isProduction() && !process.env.VITEST) {
      await D1RevenueRepository.getInstance().executeWrite(table, sql, params);
    } else {
      getDb().prepare(sql).run(...params);
    }
  }

  private async safeQueryOne<T = any>(table: string, sql: string, params: any[] = []): Promise<T | null> {
    try {
      if (isProduction() && !process.env.VITEST) {
        return await D1RevenueRepository.getInstance().queryOne<T>(table, sql, params);
      }
      return (getDb().prepare(sql).get(...params) as T) || null;
    } catch {
      return null;
    }
  }

  private async ensureDurableJourneyAndDemandSignal(
    event: InboundMessageEvent,
    provenance: IdentityProvenance,
    sessionId: string,
    intent: InboundIntent
  ): Promise<{ journeyId: string; lastOfferContext: string | null }> {
    const useD1 = isProduction() && !process.env.VITEST;
    const isVerifiedChannel = provenance === 'VERIFIED_WHATSAPP_WEBHOOK' || provenance === 'VERIFIED_EMAIL_WEBHOOK';
    let journeyRow: any = null;

    if (event.journeyId) {
      journeyRow = await this.safeQueryOne('customer_journeys', 'SELECT id, visitor_id, touchpoints_json FROM customer_journeys WHERE id = ?', [event.journeyId]);
    }
    if (!journeyRow) {
      journeyRow = await this.safeQueryOne('customer_journeys', 'SELECT id, visitor_id, touchpoints_json FROM customer_journeys WHERE visitor_id = ? LIMIT 1', [sessionId]);
    }
    if (!journeyRow && isVerifiedChannel && event.senderContact) {
      journeyRow = await this.safeQueryOne(
        'customer_journeys',
        'SELECT id, visitor_id, touchpoints_json FROM customer_journeys WHERE customer_phone = ? OR customer_email = ? LIMIT 1',
        [event.senderContact, event.senderContact]
      );
    }

    let journeyId = journeyRow?.id ? String(journeyRow.id) : '';
    let lastOfferContext: string | null = null;
    if (journeyRow?.touchpoints_json) {
      try {
        const tps = JSON.parse(journeyRow.touchpoints_json);
        if (Array.isArray(tps)) {
          for (let i = tps.length - 1; i >= 0; i--) {
            if (tps[i]?.offerSlug) {
              lastOfferContext = String(tps[i].offerSlug);
              break;
            }
          }
        }
      } catch {}
    }

    const classification = event.isDiagnosticProbe ? 'TEST' : 'REAL';
    const cleanContact = String(event.senderContact || '').trim();
    const emailVal = cleanContact.includes('@') ? cleanContact.slice(0, 120) : null;
    const phoneVal = !cleanContact.includes('@') && /\d{7,15}/.test(cleanContact) ? cleanContact.slice(0, 25) : null;

    if (!journeyId) {
      journeyId = `cj_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const initTouchpoints = JSON.stringify([
        {
          channel: event.channel,
          provenance,
          offerSlug: event.productSlugOrContext || null,
          at: new Date().toISOString()
        }
      ]);
      const insertWithoutOrgSql = `INSERT INTO customer_journeys (
        id, business_id, visitor_id, customer_name, customer_phone, customer_email,
        stage, first_touch_channel, last_touch_channel, touchpoints_json,
        classification, attribution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'LEAD', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
      const insertWithoutOrgParams = [
        journeyId,
        event.businessId,
        sessionId,
        event.senderName ? event.senderName.slice(0, 120) : null,
        phoneVal,
        emailVal,
        event.channel,
        event.channel,
        initTouchpoints,
        classification,
        isVerifiedChannel ? 'VERIFIED' : provenance
      ];
      try {
        if (useD1) {
          // Production Cloudflare D1 (0002_core_production_schema.sql) omits organization_id on customer_journeys
          await this.safeExecWrite('customer_journeys', insertWithoutOrgSql, insertWithoutOrgParams);
        } else {
          // Local SQLite schema.ts defines organization_id NOT NULL on customer_journeys
          try {
            await this.safeExecWrite(
              'customer_journeys',
              `INSERT INTO customer_journeys (
                id, organization_id, business_id, visitor_id, customer_name, customer_phone, customer_email,
                stage, first_touch_channel, last_touch_channel, touchpoints_json,
                classification, attribution_status, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'LEAD', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                journeyId,
                event.organizationId,
                event.businessId,
                sessionId,
                event.senderName ? event.senderName.slice(0, 120) : null,
                phoneVal,
                emailVal,
                event.channel,
                event.channel,
                initTouchpoints,
                classification,
                isVerifiedChannel ? 'VERIFIED' : provenance
              ]
            );
          } catch (localErr: any) {
            if (String(localErr?.message || '').includes('no such column: organization_id')) {
              await this.safeExecWrite('customer_journeys', insertWithoutOrgSql, insertWithoutOrgParams);
            } else {
              throw localErr;
            }
          }
        }
      } catch (err: any) {
        if (useD1) throw err;
      }

      try {
        const existingPipe = await this.safeQueryOne('sales_pipeline', 'SELECT id FROM sales_pipeline WHERE journey_id = ? LIMIT 1', [journeyId]);
        if (!existingPipe) {
          await this.safeExecWrite(
            'sales_pipeline',
            `INSERT INTO sales_pipeline (
              id, business_id, organization_id, journey_id, stage, owner_agent, next_action, next_action_at, reason, is_test, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'QUALIFIED', 'sales-conversation-engine', 'ANSWER_INQUIRY', datetime('now'), ?, ?, datetime('now'), datetime('now'))`,
            [
              `pipe_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 6)}`,
              event.businessId,
              event.organizationId,
              journeyId,
              `Inbound ${event.channel} inquiry (${provenance})`,
              event.isDiagnosticProbe ? 1 : 0
            ]
          );
        }
      } catch {}
    }

    // Persist first-party demand signal (diagnostic probes quarantined)
    try {
      const today = new Date().toISOString().slice(0, 10);
      const dedupeHash = createHash('sha256')
        .update(`${sessionId}|${today}|${String(event.messageText || '').trim().toLowerCase()}`)
        .digest('hex')
        .slice(0, 24);
      const existingSig = await this.safeQueryOne('demand_signals', 'SELECT id FROM demand_signals WHERE dedupe_hash = ? LIMIT 1', [dedupeHash]);
      if (!existingSig) {
        const sigId = `dsig_desk_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 6)}`;
        const signalStatus = event.isDiagnosticProbe ? 'QUARANTINED' : 'DISCOVERED';
        await this.safeExecWrite(
          'demand_signals',
          `INSERT INTO demand_signals (
            id, organization_id, topic, category, intent_type, raw_query, evidence_snippet,
            source_url, urgency, estimated_monthly_volume, status, intent_class, commercial_score,
            source_host, dedupe_hash, signal_type, found_at, created_at
          ) VALUES (?, ?, ?, ?, 'SEARCH_QUERY', ?, ?, 'first_party://customer-desk', ?, 100, ?, ?, ?, 'FIRST_PARTY_CUSTOMER_DESK', ?, 'BUYER_QUESTION', datetime('now'), datetime('now'))`,
          [
            sigId,
            event.organizationId,
            event.productSlugOrContext || 'FIRST_PARTY_CUSTOMER_DESK',
            event.productSlugOrContext ? 'PRODUCT_INQUIRY' : 'GENERAL_DESK_INQUIRY',
            String(event.messageText || '').slice(0, 300),
            `First-party inquiry via ${event.channel} (${provenance})`.slice(0, 300),
            intent === 'READY_TO_BUY' ? 0.95 : 0.7,
            signalStatus,
            intent === 'READY_TO_BUY' ? 'BUYING' : 'COMMERCIAL',
            intent === 'READY_TO_BUY' ? 90 : 60,
            dedupeHash
          ]
        );
      }
    } catch {}

    return { journeyId, lastOfferContext };
  }

  private async recordOfferContextOnJourney(journeyId: string, sessionId: string, offerSlug: string): Promise<void> {
    if (!journeyId || !offerSlug) return;
    try {
      const row = await this.safeQueryOne<any>('customer_journeys', 'SELECT touchpoints_json FROM customer_journeys WHERE id = ?', [journeyId]);
      let tps: any[] = [];
      try {
        tps = JSON.parse(row?.touchpoints_json || '[]');
        if (!Array.isArray(tps)) tps = [];
      } catch {
        tps = [];
      }
      if (tps[tps.length - 1]?.offerSlug === offerSlug) return;
      tps.push({ sessionId, offerSlug, at: new Date().toISOString() });
      await this.safeExecWrite(
        'customer_journeys',
        `UPDATE customer_journeys SET touchpoints_json = ?, updated_at = datetime('now') WHERE id = ?`,
        [JSON.stringify(tps.slice(-15)), journeyId]
      );
    } catch {}
  }

  private async resolveCatalogContextDetailed(event: InboundMessageEvent): Promise<{
    resolvedOffer: ResolvedCatalogOffer | null;
    clarificationNeeded: boolean;
    clarificationOptions: ResolvedCatalogOffer[];
  }> {
    const contextRaw = (event.productSlugOrContext || '').trim();
    const combinedLower = `${contextRaw} ${event.messageText || ''}`.toLowerCase();
    const isCustomScopeQuery = /\b(custom|bespoke|bulk|enterprise|sla|clinic pilot|special terms)\b/.test(combinedLower);
    if (isCustomScopeQuery && !contextRaw) {
      return { resolvedOffer: null, clarificationNeeded: false, clarificationOptions: [] };
    }

    // Explicit SiteFix context -> deterministic single match (Lane D)
    const authoritativeFixpackPrice = getSiteAuditFixpackPriceINR();
    const sitefixOffer: ResolvedCatalogOffer = {
      kind: 'DIGITAL_PRODUCT',
      lane: 'LANE_D_DIGITAL_PRODUCTS',
      idOrSlug: 'sitefix_core_499',
      title: 'SiteFix AI Technical Audit & Core Fix-Pack',
      merchantOrProvider: 'AI Marketing Organization (SiteFix)',
      priceINR: authoritativeFixpackPrice,
      verifiedDiscountPercent: null,
      availability: 'AVAILABLE_24X7',
      offerPath: '/tools/site-audit',
      permittedClaims: [
        'Live technical SEO, Schema.org & Core Web Vitals inspection',
        authoritativeFixpackPrice !== null
          ? `₹${authoritativeFixpackPrice} Core Technical Fix-Pack with Razorpay & Direct UPI claim verification`
          : 'Core Technical Fix-Pack (price pending server configuration)'
      ],
      score: 10
    };
    if (
      contextRaw.toLowerCase() === 'sitefix_core_499' ||
      contextRaw.toLowerCase() === 'sitefix' ||
      /\b(sitefix|site-audit|site audit|technical audit|fix-pack|499|cwv|pagespeed|website audit)\b/.test(combinedLower)
    ) {
      return { resolvedOffer: sitefixOffer, clarificationNeeded: false, clarificationOptions: [] };
    }

    // Explicit Financial Radar context (Lane E)
    if (/\b(financial-radar|financial radar|mfapi|mutual fund|nifty|gold etf|sgb|g-sec|bond|ytm|duration)\b/.test(combinedLower)) {
      const finOffer: ResolvedCatalogOffer = {
        kind: 'FINANCIAL_RESEARCH',
        lane: 'LANE_E_FINANCIAL_RADAR',
        idOrSlug: 'financial_radar',
        title: 'SEBI-Safe Financial & Commodity Research Radar',
        merchantOrProvider: 'AI Marketing Organization Research',
        priceINR: 0,
        verifiedDiscountPercent: null,
        availability: 'AVAILABLE_24X7',
        offerPath: '/tools/financial-radar',
        permittedClaims: [
          'AMFI / MFAPI.in live NAV drawdown & volatility analytics',
          '10Y G-Sec YTM & SGB vs Spot Gold parity calculators (Educational Research Only)'
        ],
        score: 10
      };
      return { resolvedOffer: finOffer, clarificationNeeded: false, clarificationOptions: [] };
    }

    // Load active items across Lanes A (public_deals), B/D (customer_offers), and C (partner_offers)
    const deals = await this.safeQueryAll<any>(
      'public_deals',
      `SELECT slug, canonical_slug, title, brand, merchant, category, current_price_inr, reference_price_inr, discount_percent, availability, last_verified_at
       FROM public_deals
       WHERE product_verified = 1
         AND affiliate_verified = 1
         AND is_monetizable = 1
         AND availability = 'IN_STOCK'
         AND current_price_inr > 0
         AND (last_verified_at IS NULL OR datetime(last_verified_at) >= datetime('now', '-14 days'))
       LIMIT 150`
    );

    const customerOffers = await this.safeQueryAll<any>(
      'customer_offers',
      `SELECT id, title, description, category, price_minor, billing_model
       FROM customer_offers
       WHERE active = 1
       LIMIT 25`
    );

    const partnerOffers = await this.safeQueryAll<any>(
      'partner_offers',
      `SELECT id, offer_slug, title, description, category, current_price_inr, destination_url, status, active
       FROM partner_offers
       WHERE active = 1 AND status = 'ACTIVE'
       LIMIT 50`
    );

    // Exact slug/ID match across lanes first
    if (contextRaw) {
      const ctxNorm = contextRaw.toLowerCase().replace(/^\/deals\//, '').replace(/\//g, '');
      const exactDeal = deals.find(
        d => String(d.slug || '').toLowerCase() === ctxNorm || String(d.canonical_slug || '').toLowerCase() === ctxNorm
      );
      if (exactDeal) {
        return { resolvedOffer: this.mapDealToResolvedOffer(exactDeal), clarificationNeeded: false, clarificationOptions: [] };
      }

      const exactCustOffer = customerOffers.find(
        o => String(o.id || '').toLowerCase() === ctxNorm || String(o.title || '').toLowerCase().includes(ctxNorm)
      );
      if (exactCustOffer) {
        return {
          resolvedOffer: {
            kind: 'SERVICE_OFFER',
            lane: 'LANE_B_SERVICES',
            idOrSlug: String(exactCustOffer.id),
            title: String(exactCustOffer.title),
            merchantOrProvider: 'AI Marketing Organization',
            priceINR: Number((Number(exactCustOffer.price_minor || 0) / 100).toFixed(2)),
            verifiedDiscountPercent: null,
            availability: 'IN_STOCK',
            offerPath: '/offer',
            permittedClaims: [String(exactCustOffer.description || exactCustOffer.billing_model || 'Verified service offer')]
          },
          clarificationNeeded: false,
          clarificationOptions: []
        };
      }

      const exactPartner = partnerOffers.find(
        p => String(p.offer_slug || '').toLowerCase() === ctxNorm || String(p.id || '').toLowerCase() === ctxNorm
      );
      if (exactPartner && Number(exactPartner.current_price_inr || 0) > 0) {
        return {
          resolvedOffer: {
            kind: 'AFFILIATE_DEAL',
            lane: 'LANE_C_PARTNER_OFFERS',
            idOrSlug: String(exactPartner.offer_slug || exactPartner.id),
            title: String(exactPartner.title || exactPartner.offer_slug),
            merchantOrProvider: 'Verified Partner',
            priceINR: Number(exactPartner.current_price_inr),
            verifiedDiscountPercent: null,
            availability: 'IN_STOCK',
            offerPath: `/deals/${encodeURIComponent(String(exactPartner.offer_slug || exactPartner.id))}`,
            permittedClaims: [String(exactPartner.description || 'Verified partner offer')]
          },
          clarificationNeeded: false,
          clarificationOptions: []
        };
      }
    }

    const stopWords = new Set([
      'what', 'does', 'cost', 'price', 'rate', 'much', 'how', 'for', 'the', 'this', 'that', 'with',
      'about', 'want', 'send', 'details', 'info', 'deal', 'deals', 'live', 'buy', 'have', 'your',
      'our', 'are', 'can', 'you', 'show', 'please', 'which', 'best', 'find', 'looking', 'ready',
      'purchase', 'confirm', 'order', 'proceed', 'checkout', 'under', 'good'
    ]);
    const tokens = Array.from(
      new Set(
        combinedLower
          .replace(/[^a-z0-9]+/g, ' ')
          .split(/\s+/)
          .filter(t => t.length >= 3 && !stopWords.has(t))
      )
    );

    if (tokens.length === 0) {
      return { resolvedOffer: null, clarificationNeeded: false, clarificationOptions: [] };
    }

    const candidates: ResolvedCatalogOffer[] = [];
    for (const d of deals) {
      const hay = `${d.slug || ''} ${d.title || ''} ${d.brand || ''} ${d.merchant || ''} ${d.category || ''}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) {
          score += tok.length >= 4 ? 2 : 1;
        }
      }
      if (score >= 2) {
        const mapped = this.mapDealToResolvedOffer(d);
        mapped.score = score;
        candidates.push(mapped);
      }
    }

    for (const o of customerOffers) {
      const hay = `${o.id || ''} ${o.title || ''} ${o.description || ''} ${o.category || ''}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += tok.length >= 4 ? 2 : 1;
      }
      if (score >= 2) {
        candidates.push({
          kind: 'SERVICE_OFFER',
          lane: 'LANE_B_SERVICES',
          idOrSlug: String(o.id),
          title: String(o.title),
          merchantOrProvider: 'AI Marketing Organization',
          priceINR: Number((Number(o.price_minor || 0) / 100).toFixed(2)),
          verifiedDiscountPercent: null,
          availability: 'IN_STOCK',
          offerPath: '/offer',
          permittedClaims: [String(o.description || o.billing_model || 'Verified service offer')],
          score
        });
      }
    }

    const existingSlugs = new Set(candidates.map(c => c.idOrSlug.toLowerCase()));
    for (const p of partnerOffers) {
      const slug = String(p.offer_slug || p.id || '');
      if (!slug || existingSlugs.has(slug.toLowerCase()) || !(Number(p.current_price_inr || 0) > 0)) continue;
      const hay = `${slug} ${p.title || ''} ${p.description || ''} ${p.category || ''}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += tok.length >= 4 ? 2 : 1;
      }
      if (score >= 2) {
        candidates.push({
          kind: 'AFFILIATE_DEAL',
          lane: 'LANE_C_PARTNER_OFFERS',
          idOrSlug: slug,
          title: String(p.title || slug),
          merchantOrProvider: 'Verified Partner',
          priceINR: Number(p.current_price_inr),
          verifiedDiscountPercent: null,
          availability: 'IN_STOCK',
          offerPath: `/deals/${encodeURIComponent(slug)}`,
          permittedClaims: [String(p.description || 'Verified partner offer')],
          score
        });
      }
    }

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    if (candidates.length === 0) {
      return { resolvedOffer: null, clarificationNeeded: false, clarificationOptions: [] };
    }

    const topScore = candidates[0].score || 0;
    const secondScore = candidates[1]?.score || 0;
    const isAmbiguousCategoryQuery =
      candidates.length >= 2 &&
      !contextRaw &&
      (secondScore === topScore || topScore - secondScore <= 2);

    if (isAmbiguousCategoryQuery) {
      return {
        resolvedOffer: null,
        clarificationNeeded: true,
        clarificationOptions: candidates.slice(0, 3)
      };
    }

    return {
      resolvedOffer: candidates[0],
      clarificationNeeded: false,
      clarificationOptions: []
    };
  }

  private async createCheckoutOrRedirect(
    event: InboundMessageEvent,
    offer: ResolvedCatalogOffer,
    sessionId: string,
    journeyId: string
  ): Promise<{
    checkout: DeskCheckoutPayload;
    pipelineStage: string;
    conversationState: 'CHECKOUT_CREATED' | 'AFFILIATE_REDIRECT_READY';
    responseTemplate: string;
    reason: string;
  }> {
    if ((offer.kind === 'DIGITAL_PRODUCT' || offer.kind === 'SERVICE_OFFER') && (offer.priceINR ?? 0) > 0) {
      const orderId = `ord_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const amountINR = Number(offer.priceINR);
      const upiCfg = getDirectUpiConfig();
      const upiDeepLink = upiCfg.configured && upiCfg.vpa
        ? `upi://pay?pa=${encodeURIComponent(upiCfg.vpa)}&pn=${encodeURIComponent(upiCfg.payeeName || 'AI Marketing Organization')}&am=${amountINR}&cu=INR&tn=${encodeURIComponent(orderId)}`
        : '';
      const checkoutUrl = `${offer.offerPath}${offer.offerPath.includes('?') ? '&' : '?'}orderId=${encodeURIComponent(orderId)}`;

      const useD1 = isProduction() && !process.env.VITEST;
      const d1InsertSql = `INSERT INTO payment_requests (
        id, business_id, organization_id, lead_id, offer_id, offer_description,
        amount_inr, currency, billing_model, payment_link_url, short_url, status,
        classification, provider, reference_id, is_test, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'ONE_TIME', ?, ?, 'PAYMENT_PENDING', ?, 'DIRECT_UPI', ?, ?, datetime('now'), datetime('now'))`;
      const d1InsertParams = [
        orderId,
        event.businessId,
        event.organizationId,
        journeyId || sessionId,
        offer.idOrSlug,
        offer.title,
        amountINR,
        upiDeepLink,
        checkoutUrl,
        event.isDiagnosticProbe ? 'TEST' : 'REAL',
        orderId,
        event.isDiagnosticProbe ? 1 : 0
      ];

      if (useD1) {
        // Production Cloudflare D1 (0002_core_production_schema.sql) uses lead_id & payment_link_url
        await this.safeExecWrite('payment_requests', d1InsertSql, d1InsertParams);
      } else {
        try {
          await this.safeExecWrite(
            'payment_requests',
            `INSERT INTO payment_requests (
              id, business_id, organization_id, journey_id, offer_id, offer_description,
              amount_inr, currency, billing_model, payment_link, short_url, status,
              classification, provider, reference_id, is_test, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'ONE_TIME', ?, ?, 'PAYMENT_PENDING', ?, 'DIRECT_UPI', ?, ?, datetime('now'), datetime('now'))`,
            [
              orderId,
              event.businessId,
              event.organizationId,
              journeyId || null,
              offer.idOrSlug,
              offer.title,
              amountINR,
              upiDeepLink,
              checkoutUrl,
              event.isDiagnosticProbe ? 'TEST' : 'REAL',
              orderId,
              event.isDiagnosticProbe ? 1 : 0
            ]
          );
        } catch (localErr: any) {
          if (String(localErr?.message || '').includes('no such column: journey_id')) {
            await this.safeExecWrite('payment_requests', d1InsertSql, d1InsertParams);
          } else {
            throw localErr;
          }
        }
      }

      return {
        checkout: {
          checkoutMode: 'OWNED_CHECKOUT_CREATED',
          orderId,
          sku: offer.idOrSlug,
          amountINR,
          upiDeepLink,
          upiClaimEndpoint: '/api/v1/offer/upi-claim',
          checkoutUrl
        },
        pipelineStage: 'PAYMENT_REQUEST_CREATED',
        conversationState: 'CHECKOUT_CREATED',
        responseTemplate: `Checkout order ${orderId} created for ${offer.title} (₹${amountINR.toLocaleString('en-IN')}). Complete UPI payment via ${upiDeepLink} and submit your 12-digit UTR to /api/v1/offer/upi-claim with orderId=${orderId} (or complete on ${checkoutUrl}).`,
        reason: `Server-authoritative owned checkout order ${orderId} created in payment_requests (₹${amountINR}).`
      };
    }

    const clickId = `desk_clk_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const redirectUrl = `/api/v1/public/deals/${encodeURIComponent(offer.idOrSlug)}/redirect?sessionId=${encodeURIComponent(sessionId)}&placement=customer_desk&clickRef=${encodeURIComponent(clickId)}`;
    return {
      checkout: {
        checkoutMode: 'AFFILIATE_REDIRECT_READY',
        clickId,
        sku: offer.idOrSlug,
        amountINR: offer.priceINR,
        redirectUrl,
        merchantUrl: offer.offerPath
      },
      pipelineStage: 'MERCHANT_REFERRAL_ISSUED',
      conversationState: 'AFFILIATE_REDIRECT_READY',
      responseTemplate: `Tracked merchant checkout link ready for ${offer.title} (${offer.priceINR !== null ? `₹${offer.priceINR.toLocaleString('en-IN')}` : 'live rate'}): proceed securely via ${redirectUrl} (Click Ref: ${clickId}).`,
      reason: `Issued tracked affiliate merchant redirect ${clickId} for ${offer.idOrSlug}.`
    };
  }

  private async resolveCatalogContext(event: InboundMessageEvent): Promise<ResolvedCatalogOffer | null> {
    const detailed = await this.resolveCatalogContextDetailed(event);
    return detailed.resolvedOffer;
  }

  private mapDealToResolvedOffer(d: any): ResolvedCatalogOffer {
    const cur = Number(d.current_price_inr || 0);
    const ref = d.reference_price_inr ? Number(d.reference_price_inr) : null;
    const disc =
      ref && ref > cur && cur > 0
        ? Math.round(((ref - cur) / ref) * 100)
        : d.discount_percent
        ? Number(d.discount_percent)
        : null;
    const slug = String(d.slug || d.canonical_slug || '');
    return {
      kind: 'AFFILIATE_DEAL',
      idOrSlug: slug,
      title: String(d.title || slug),
      merchantOrProvider: String(d.merchant || d.brand || 'Verified Merchant'),
      priceINR: cur,
      referencePriceINR: ref,
      verifiedDiscountPercent: disc,
      availability: String(d.availability || 'IN_STOCK'),
      offerPath: `/deals/${encodeURIComponent(slug)}`,
      permittedClaims: [
        `Listed merchant price ₹${cur.toLocaleString('en-IN')}`,
        `Availability: ${String(d.availability || 'IN_STOCK')}`,
        'Fulfilled directly via verified merchant tracking link'
      ]
    };
  }

  private async createOwnerEscalationTask(
    event: InboundMessageEvent,
    intent: InboundIntent,
    reason: string
  ): Promise<string | null> {
    const id = `esc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const today = new Date().toISOString().slice(0, 10);
    const senderLabel = event.senderName ? `${event.senderName} (${event.senderContact})` : event.senderContact;
    const sql = `
      INSERT INTO reply_desk_drafts (
        id, source_url, title, snippet, draft_answer, status,
        intent_class, qualification_status, qualification_reason,
        next_permitted_action, query_date, is_test, created_at
      ) VALUES (?, ?, ?, ?, ?, 'OWNER_ESCALATION_REQUIRED', ?, 'OWNER_ESCALATION_REQUIRED', ?, 'OWNER_ESCALATION_REQUIRED', ?, 0, datetime('now'))
    `;
    try {
      await this.safeExecWrite('reply_desk_drafts', sql, [
        id,
        `customer-desk://${id}`,
        `OWNER_ESCALATION_REQUIRED: ${senderLabel}`.slice(0, 180),
        String(event.messageText || '').slice(0, 400),
        `Pending manual owner response via ${event.channel} for ${senderLabel}. Reason: ${reason}`.slice(0, 400),
        intent,
        reason,
        today
      ]);
      return id;
    } catch {
      return null;
    }
  }

  private async updatePipelineStageAsync(contact: string, newStage: string, reason: string, journeyId?: string): Promise<void> {
    try {
      let targetJourneyId = journeyId;
      let targetBizId = '';

      if (!targetJourneyId) {
        const journey = await this.safeQueryOne<any>(
          'customer_journeys',
          `SELECT id, business_id FROM customer_journeys WHERE customer_phone = ? OR customer_email = ? LIMIT 1`,
          [contact, contact]
        );
        targetJourneyId = journey?.id;
        targetBizId = journey?.business_id || '';
      }

      if (targetJourneyId) {
        await this.safeExecWrite(
          'sales_pipeline',
          `UPDATE sales_pipeline SET stage = ?, reason = ?, updated_at = datetime('now') WHERE journey_id = ?`,
          [newStage, reason, targetJourneyId]
        );
        await this.safeExecWrite(
          'customer_journeys',
          `UPDATE customer_journeys SET stage = ?, updated_at = datetime('now') WHERE id = ?`,
          [newStage, targetJourneyId]
        );

        if (!targetBizId) {
          const jRow = await this.safeQueryOne<any>('customer_journeys', 'SELECT business_id FROM customer_journeys WHERE id = ?', [targetJourneyId]);
          const pRow = !jRow ? await this.safeQueryOne<any>('sales_pipeline', 'SELECT business_id FROM sales_pipeline WHERE journey_id = ? LIMIT 1', [targetJourneyId]) : null;
          targetBizId = jRow?.business_id || pRow?.business_id || '';
        }

        if (targetBizId) {
          const transId = `ptrans_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await this.safeExecWrite(
            'pipeline_transitions',
            `INSERT INTO pipeline_transitions (
              id, pipeline_id, business_id, previous_state, new_state, actor, reason, timestamp
            ) VALUES (?, ?, ?, 'AUTOMATED_INBOUND', ?, 'sales-conversation-engine', ?, datetime('now'))`,
            [transId, targetJourneyId, targetBizId, newStage, reason]
          ).catch(() => {});
        }
      }
    } catch {}
  }
}
