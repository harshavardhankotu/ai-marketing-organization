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
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
import { DurableEventBus } from './durable-event-bus.js';
import { AutonomyPolicyController } from './autonomy-policy.js';
import { IntegrationCapabilityRegistry } from '../control-plane/integration-capability-registry.js';

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
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS' | 'WEB_DESK';
  messageText: string;
  productSlugOrContext?: string;
  consentGiven?: boolean;
  externalMessageId?: string;
  receivedAt?: string;
  journeyId?: string;
}

export interface ResolvedCatalogOffer {
  kind: 'AFFILIATE_DEAL' | 'DIGITAL_PRODUCT' | 'SERVICE_OFFER' | 'FINANCIAL_RESEARCH';
  idOrSlug: string;
  title: string;
  merchantOrProvider: string;
  priceINR: number | null;
  referencePriceINR?: number | null;
  verifiedDiscountPercent?: number | null;
  availability: string;
  offerPath: string;
  permittedClaims: string[];
}

export interface IntentProcessingResult {
  intent: InboundIntent;
  confidence: number;
  routedAction: string;
  responseTemplate?: string;
  suppressed: boolean;
  pipelineUpdated: boolean;
  details: string;
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
      const resolvedOffer = await this.resolveCatalogContext(event);
      this.updatePipelineStage(event.senderContact, 'PAYMENT_PENDING', 'Customer confirmed readiness to purchase', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent: 'READY_TO_BUY', nextAction: 'SEND_PAYMENT_REQUEST' }
      });

      const checkoutHint = resolvedOffer
        ? ` For ${resolvedOffer.title} (${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR}` : 'live catalog'}), continue directly at ${resolvedOffer.offerPath}.`
        : ' Please confirm the exact product slug or SiteFix domain so we can share the verified checkout path.';

      return {
        intent,
        confidence: 0.95,
        routedAction: 'SEND_PAYMENT_REQUEST',
        responseTemplate: `Thank you for confirming.${checkoutHint}`,
        suppressed: false,
        pipelineUpdated: true,
        details: 'Ready to buy detected. Product-aware checkout path provided.',
        resolvedOffer,
        escalationCreated: false,
        escalationId: null
      };
    }

    // 4. DEMO_REQUEST / ASKING_FOR_DEMO: Demo requested awaiting calendar confirmation (never auto-marked MEETING_BOOKED)
    if (intent === 'DEMO_REQUEST' || intent === 'ASKING_FOR_DEMO') {
      const resolvedOffer = await this.resolveCatalogContext(event);
      this.updatePipelineStage(event.senderContact, 'DEMO_REQUESTED_PENDING_CONFIRMATION', 'Prospect requested consultation/demo (awaiting slot confirmation)', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent, nextAction: 'BOOK_MEETING', slotConfirmed: false }
      });

      return {
        intent,
        confidence: 0.88,
        routedAction: 'BOOK_MEETING',
        responseTemplate: 'Thank you — we have logged your demo/callback request (status: DEMO_REQUESTED_PENDING_CONFIRMATION). Please share a preferred time window tomorrow so the owner can confirm a calendar slot.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Demo requested. Status set to DEMO_REQUESTED_PENDING_CONFIRMATION awaiting confirmed slot.',
        resolvedOffer,
        escalationCreated: false,
        escalationId: null
      };
    }

    const resolvedOffer = await this.resolveCatalogContext(event);
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
        event,
        intent,
        customOrHumanRequested
          ? 'Customer requested custom scope, pricing terms, or human assistance.'
          : 'Inbound query could not be deterministically matched to an active verified catalog item.'
      );
    }

    // 5. PRICE_QUESTION: Live D1 catalog pricing breakdown (never hardcoded ₹15k/₹8k clinic templates)
    if (intent === 'PRICE_QUESTION') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Pricing inquiry received', event.journeyId);
      DurableEventBus.emit({
        eventType: 'LEAD_REPLIED',
        organizationId: event.organizationId,
        businessId: event.businessId,
        payload: { contact: event.senderContact, intent: 'PRICE_QUESTION', nextAction: 'SEND_PRICING_DETAILS' }
      });

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
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Operational inquiry received', event.journeyId);
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
        details: 'Catalog-grounded operational response dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 7. WHAT_DO_YOU_DO: Truthful platform & active channel summary
    if (intent === 'WHAT_DO_YOU_DO') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'High-level inquiry received', event.journeyId);
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
        details: 'Verified capability overview dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 8. CASE_STUDY_REQUEST / ASKING_FOR_CASE_STUDY: Reference proof without fabricated claims
    if (intent === 'CASE_STUDY_REQUEST' || intent === 'ASKING_FOR_CASE_STUDY') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Case study inquiry received', event.journeyId);
      return {
        intent,
        confidence: 0.88,
        routedAction: 'SEND_CASE_STUDY',
        responseTemplate: 'We publish live, deterministic technical SEO audit reports at /tools/site-audit and verified merchant deal comparisons at /deals. No unverified customer revenue case studies are claimed prior to owner confirmation.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Truthful evidence links dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 9. OBJECTION_PRICE: No unsupported ROI promises
    if (intent === 'OBJECTION_PRICE') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Price objection received', event.journeyId);
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
        details: 'Transparent price response dispatched without unsupported ROI claims.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 10. OBJECTION_TIMING: Defer follow-up
    if (intent === 'OBJECTION_TIMING') {
      this.updatePipelineStage(event.senderContact, 'CONTACTED', 'Timing objection received', event.journeyId);
      return {
        intent,
        confidence: 0.8,
        routedAction: 'DEFER_FOLLOW_UP',
        responseTemplate: 'Understood. We will check back when your schedule opens up.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Follow-up deferred on cooldown.',
        resolvedOffer,
        escalationCreated: false,
        escalationId: null
      };
    }

    // 11. NEEDS_APPROVAL: Executive summary
    if (intent === 'NEEDS_APPROVAL') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Stakeholder approval needed', event.journeyId);
      return {
        intent,
        confidence: 0.85,
        routedAction: 'SEND_EXECUTIVE_SUMMARY',
        responseTemplate: resolvedOffer
          ? `Summary for stakeholder review: ${resolvedOffer.title} (${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR}` : 'catalog rate'}, ${resolvedOffer.availability}) at ${resolvedOffer.offerPath}.`
          : 'Summary links for partner review: verified deals (/deals), SiteFix audits (/tools/site-audit), and financial research tools (/tools/financial-radar). Escalated to owner for formal brief if needed.',
        suppressed: false,
        pipelineUpdated: true,
        details: 'Stakeholder brief dispatched.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 12. SEND_DETAILS / NEEDS_INFORMATION: Brief & deliverables grounded in catalog
    if (intent === 'SEND_DETAILS' || intent === 'NEEDS_INFORMATION') {
      this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'Details requested', event.journeyId);
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
        details: resolvedOffer
          ? `Catalog brief dispatched for ${resolvedOffer.idOrSlug}.`
          : 'Unresolved details query escalated to OWNER_ESCALATION_REQUIRED.',
        resolvedOffer,
        escalationCreated: Boolean(escalationId),
        escalationId
      };
    }

    // 13. INTERESTED: Catalog-grounded qualification prompt
    this.updatePipelineStage(event.senderContact, 'QUALIFIED', 'General affirmative interest', event.journeyId);
    return {
      intent: 'INTERESTED',
      confidence: 0.8,
      routedAction: 'SEND_QUALIFICATION_PROMPT',
      responseTemplate: resolvedOffer
        ? `Glad you are interested in ${resolvedOffer.title} (${resolvedOffer.priceINR !== null ? `₹${resolvedOffer.priceINR}` : 'live catalog'}, ${resolvedOffer.availability}) — review directly at ${resolvedOffer.offerPath}.`
        : 'Great! Share the deal slug, product category, or website domain you would like checked, or browse /deals and /tools/site-audit.',
      suppressed: false,
      pipelineUpdated: true,
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
    try {
      if (isProduction() && !process.env.VITEST) {
        await D1RevenueRepository.getInstance().executeWrite(table, sql, params);
      } else {
        getDb().prepare(sql).run(...params);
      }
    } catch {}
  }

  private async resolveCatalogContext(event: InboundMessageEvent): Promise<ResolvedCatalogOffer | null> {
    const contextRaw = (event.productSlugOrContext || '').trim();
    const combinedLower = `${contextRaw} ${event.messageText || ''}`.toLowerCase();
    const isCustomScopeQuery = /\b(custom|bespoke|bulk|enterprise|sla|clinic pilot|special terms)\b/.test(combinedLower);
    if (isCustomScopeQuery && !contextRaw) {
      return null;
    }

    // 1. Check SiteFix Audit / Fix-Pack explicit queries
    if (/\b(sitefix|site-audit|site audit|technical audit|fix-pack|499|cwv|pagespeed)\b/.test(combinedLower)) {
      return {
        kind: 'DIGITAL_PRODUCT',
        idOrSlug: 'sitefix_core_499',
        title: 'SiteFix AI Technical Audit & Core Fix-Pack',
        merchantOrProvider: 'AI Marketing Organization (SiteFix)',
        priceINR: 499,
        verifiedDiscountPercent: null,
        availability: 'AVAILABLE_24X7',
        offerPath: '/tools/site-audit',
        permittedClaims: [
          'Live technical SEO, Schema.org & Core Web Vitals inspection',
          '₹499 Core Technical Fix-Pack with Razorpay Sandbox & Direct UPI claim verification'
        ]
      };
    }

    // 2. Check Financial & Commodity Research Radar
    if (/\b(financial-radar|financial radar|mfapi|mutual fund|nifty|gold etf|sgb|g-sec|bond|ytm|duration)\b/.test(combinedLower)) {
      return {
        kind: 'FINANCIAL_RESEARCH',
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
        ]
      };
    }

    // 3. Match verified active affiliate deals in public_deals (by exact slug or keyword scoring)
    const deals = await this.safeQueryAll<any>(
      'public_deals',
      `SELECT slug, canonical_slug, title, brand, merchant, category, current_price_inr, reference_price_inr, discount_percent, availability
       FROM public_deals
       WHERE product_verified = 1 AND affiliate_verified = 1 AND availability = 'IN_STOCK' AND current_price_inr > 0
       LIMIT 150`
    );

    if (deals.length > 0) {
      if (contextRaw) {
        const ctxNorm = contextRaw.toLowerCase().replace(/^\/deals\//, '').replace(/\//g, '');
        const exact = deals.find(
          d =>
            String(d.slug || '').toLowerCase() === ctxNorm ||
            String(d.canonical_slug || '').toLowerCase() === ctxNorm
        );
        if (exact) {
          return this.mapDealToResolvedOffer(exact);
        }
      }

      const stopWords = new Set(['what', 'does', 'cost', 'price', 'rate', 'much', 'how', 'for', 'the', 'this', 'that', 'with', 'about', 'want', 'send', 'details', 'info', 'deal', 'live', 'buy', 'have', 'your', 'our', 'are', 'can', 'you', 'show', 'please']);
      const tokens = Array.from(
        new Set(
          combinedLower
            .replace(/[^a-z0-9]+/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3 && !stopWords.has(t))
        )
      );

      let bestDeal: any = null;
      let bestScore = 0;
      for (const d of deals) {
        const hay = `${d.slug || ''} ${d.title || ''} ${d.brand || ''} ${d.merchant || ''} ${d.category || ''}`.toLowerCase();
        let score = 0;
        for (const tok of tokens) {
          if (hay.includes(tok)) {
            score += tok.length >= 4 ? 2 : 1;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestDeal = d;
        }
      }
      if (bestDeal && bestScore >= 2) {
        return this.mapDealToResolvedOffer(bestDeal);
      }
    }

    // 4. Match active rows in customer_offers when present in DB
    const offers = await this.safeQueryAll<any>(
      'customer_offers',
      `SELECT id, title, description, category, price_minor, billing_model
       FROM customer_offers
       WHERE active = 1
       LIMIT 25`
    );
    if (offers.length > 0 && contextRaw) {
      const ctxNorm = contextRaw.toLowerCase();
      const matchedOffer = offers.find(
        o =>
          String(o.id || '').toLowerCase() === ctxNorm ||
          String(o.title || '').toLowerCase().includes(ctxNorm)
      );
      if (matchedOffer) {
        return {
          kind: 'SERVICE_OFFER',
          idOrSlug: String(matchedOffer.id),
          title: String(matchedOffer.title),
          merchantOrProvider: 'AI Marketing Organization',
          priceINR: Number((Number(matchedOffer.price_minor || 0) / 100).toFixed(2)),
          verifiedDiscountPercent: null,
          availability: 'IN_STOCK',
          offerPath: '/offer',
          permittedClaims: [String(matchedOffer.description || matchedOffer.billing_model || 'Verified service offer')]
        };
      }
    }

    return null;
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

  private updatePipelineStage(contact: string, newStage: string, reason: string, journeyId?: string): void {
    const db = getDb();
    try {
      let targetJourneyId = journeyId;

      if (!targetJourneyId) {
        const journey = db.prepare(`
          SELECT id, business_id FROM customer_journeys
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

        const targetBizId = (db.prepare('SELECT business_id FROM customer_journeys WHERE id = ?').get(targetJourneyId) as any)?.business_id ||
          (db.prepare('SELECT business_id FROM sales_pipeline WHERE journey_id = ? LIMIT 1').get(targetJourneyId) as any)?.business_id;

        if (targetBizId) {
          const transId = `ptrans_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          db.prepare(`
            INSERT INTO pipeline_transitions (
              id, pipeline_id, business_id, previous_state, new_state, actor, reason, timestamp
            ) VALUES (?, ?, ?, 'AUTOMATED_INBOUND', ?, 'sales-conversation-engine', ?, datetime('now'))
          `).run(transId, targetJourneyId, targetBizId, newStage, reason);
        }
      }
    } catch {}
  }
}
