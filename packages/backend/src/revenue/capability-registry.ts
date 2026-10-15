/**
 * CapabilityRegistry — Single authoritative source of truth for what the platform
 * can genuinely deliver to paying clients.
 *
 * Implements Phase 4: Capability-Backed Offer Engine
 * Statuses:
 *   - AVAILABLE: Code implemented, verified with tests, credentials present or not required.
 *   - CONFIGURATION_REQUIRED: Implementation ready, but requires live provider credentials/tokens.
 *   - MANUAL_DELIVERY_ONLY: Requires manual operator intervention/handover; not fully autonomous.
 *   - UNSUPPORTED: Feature requested or claimed in drafts, but not implemented in codebase.
 */

import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { getDb } from '../db/client.js';

export type CapabilityStatus =
  | 'AVAILABLE'
  | 'CONFIGURATION_REQUIRED'
  | 'MANUAL_DELIVERY_ONLY'
  | 'UNSUPPORTED';

export interface SystemCapability {
  id: string;
  deliverableName: string;
  description: string;
  status: CapabilityStatus;
  requiredIntegrations: string[];
  requiredCredentials: string[];
  configurationStatus: 'CONFIGURED' | 'MISSING_CREDENTIALS' | 'NOT_APPLICABLE';
  testEvidence: string;
  deliveryMethod: 'AUTOMATED_SYSTEM' | 'MANUAL_ASSISTED' | 'DOCUMENTATION';
  knownLimitations: string;
  ownerApprovalRequired: boolean;
  ownerApproved: boolean;
}

export interface OfferReadinessCheck {
  offerId: string;
  sellable: boolean;
  status: 'READY' | 'DRAFT_BLOCKED';
  totalDeliverables: number;
  availableCount: number;
  configurationRequiredCount: number;
  manualOnlyCount: number;
  unsupportedCount: number;
  blockers: string[];
  capabilities: SystemCapability[];
}

export class CapabilityRegistry {
  private static instance: CapabilityRegistry;

  public static getInstance(): CapabilityRegistry {
    if (!CapabilityRegistry.instance) {
      CapabilityRegistry.instance = new CapabilityRegistry();
    }
    return CapabilityRegistry.instance;
  }

  /**
   * Evaluates the live environment to determine the genuine operational state of each capability.
   */
  public getCapabilities(): SystemCapability[] {
    const hasMetaSecret = Boolean(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET) &&
      !isPlaceholderCredential(process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '');

    const hasWhatsAppToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN) &&
      !isPlaceholderCredential(process.env.WHATSAPP_ACCESS_TOKEN || '');

    const hasWhatsApp = hasMetaSecret && hasWhatsAppToken;

    const hasGoogleSearch = Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_CX) &&
      !isPlaceholderCredential(process.env.GOOGLE_SEARCH_API_KEY || '');

    const hasRazorpay = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) &&
      !isPlaceholderCredential(process.env.RAZORPAY_KEY_ID || '');

    const hasTavily = Boolean(process.env.TAVILY_API_KEY) &&
      !isPlaceholderCredential(process.env.TAVILY_API_KEY || '');

    return [
      {
        id: 'CAP_WHATSAPP_TRIAGE_BOT',
        deliverableName: 'Custom WhatsApp triage and FAQ response bot',
        description: 'Automated greeting, inquiry qualification, and instant response under 2 minutes for WhatsApp inquiries.',
        status: hasWhatsApp ? 'AVAILABLE' : 'CONFIGURATION_REQUIRED',
        requiredIntegrations: ['WHATSAPP'],
        requiredCredentials: ['WHATSAPP_ACCESS_TOKEN', 'META_APP_SECRET'],
        configurationStatus: hasWhatsApp ? 'CONFIGURED' : 'MISSING_CREDENTIALS',
        testEvidence: 'packages/backend/tests/unit/sales-reality-and-false-live-regression.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'Requires client to have an active WhatsApp Business API account or verified number.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_GBP_LEAD_CAPTURE',
        deliverableName: 'Google Business Profile instant lead capture',
        description: 'Automated routing of Google Maps message inquiries into conversion flow.',
        status: 'MANUAL_DELIVERY_ONLY',
        requiredIntegrations: ['GOOGLE_BUSINESS_PROFILE'],
        requiredCredentials: ['GOOGLE_BUSINESS_ACCOUNT_ID'],
        configurationStatus: 'MISSING_CREDENTIALS',
        testEvidence: 'packages/backend/tests/unit/commercial-activation.test.ts',
        deliveryMethod: 'MANUAL_ASSISTED',
        knownLimitations: 'Requires manual OAuth authorization by the business owner on Google Cloud Console.',
        ownerApprovalRequired: true,
        ownerApproved: true
      },
      {
        id: 'CAP_MULTI_TOUCH_FOLLOWUP',
        deliverableName: 'Multi-touch follow-up workflow',
        description: '3-step automated follow-up sequence for inquiries that stop responding before booking.',
        status: 'AVAILABLE',
        requiredIntegrations: ['INTERNAL_SCHEDULER'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/customer-journey.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'WhatsApp messaging outside 24-hour service window requires pre-approved Meta message templates.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_CALENDAR_BOOKING',
        deliverableName: 'Direct calendar booking integration',
        description: 'Frictionless appointment scheduling link connected to practitioner or staff calendar.',
        status: 'AVAILABLE',
        requiredIntegrations: ['CALENDAR_WEBHOOK'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/universal-funnel.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'Requires client to provide an accessible calendar booking URL (e.g., Cal.com, Calendly).',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_SYSTEM_HANDOVER',
        deliverableName: 'Live system handover report',
        description: 'Step-by-step walkthrough documentation and verification test run confirming zero missed inquiries.',
        status: 'AVAILABLE',
        requiredIntegrations: ['DELIVERY_ENGINE'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/commercial-activation.test.ts',
        deliveryMethod: 'DOCUMENTATION',
        knownLimitations: 'Delivered digitally upon Day 5 milestone completion.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_24_7_LEAD_RESPONSE',
        deliverableName: '24/7 automated lead response under 2 minutes',
        description: 'Continuous uptime monitoring and instant response for evening and weekend inquiries.',
        status: hasWhatsApp ? 'AVAILABLE' : 'CONFIGURATION_REQUIRED',
        requiredIntegrations: ['RENDER_BACKEND', 'CLOUDFLARE_WORKER_CRON', 'WHATSAPP'],
        requiredCredentials: ['CRON_PING_SECRET'],
        configurationStatus: Boolean(process.env.CRON_PING_SECRET) ? 'CONFIGURED' : 'MISSING_CREDENTIALS',
        testEvidence: 'packages/backend/tests/unit/health.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'Render free instance may experience up to 50-second cold-start on sleeping wake.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_PROMPT_TUNING',
        deliverableName: 'Ongoing prompt & qualification rubric tuning',
        description: 'Bi-weekly optimization of conversation prompts based on real chat transcripts.',
        status: 'AVAILABLE',
        requiredIntegrations: ['LEARNING_ENGINE'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/evolution-loop.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'Requires minimum of 20 customer chat transcripts per cycle to derive statistical adjustments.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_CONVERSION_REPORTING',
        deliverableName: 'Weekly appointment show-rate reporting',
        description: 'Automated weekly performance summary detailing inquiries, leads, and bookings.',
        status: 'AVAILABLE',
        requiredIntegrations: ['ATTRIBUTION_ENGINE'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/revenue-reconciliation.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'Reporting depends on verified event recordings from webhook and booking triggers.',
        ownerApprovalRequired: false,
        ownerApproved: true
      },
      {
        id: 'CAP_DPDP_COMPLIANCE',
        deliverableName: 'Continuous DPDP compliance monitoring',
        description: 'Routine privacy audits complying with India Digital Personal Data Protection Act 2023.',
        status: 'AVAILABLE',
        requiredIntegrations: ['DPDP_MANAGER'],
        requiredCredentials: [],
        configurationStatus: 'NOT_APPLICABLE',
        testEvidence: 'packages/backend/tests/unit/free-distribution-and-share-kit.test.ts',
        deliveryMethod: 'AUTOMATED_SYSTEM',
        knownLimitations: 'IP addresses are cryptographically hashed; personal identification data is minimized.',
        ownerApprovalRequired: false,
        ownerApproved: true
      }
    ];
  }

  public getCapability(id: string): SystemCapability | undefined {
    return this.getCapabilities().find(c => c.id === id);
  }

  public getCapabilityByDeliverable(deliverableName: string): SystemCapability | undefined {
    const norm = deliverableName.toLowerCase().trim();
    return this.getCapabilities().find(c =>
      c.deliverableName.toLowerCase().trim() === norm ||
      norm.includes(c.deliverableName.toLowerCase().trim()) ||
      c.deliverableName.toLowerCase().trim().includes(norm)
    );
  }

  /**
   * Validates whether an offer can be sold publicly based on actual capability readiness.
   * If any mandatory deliverable is UNSUPPORTED, the offer CANNOT be sold.
   * If any deliverable requires configuration, it records explicit blockers.
   */
  public validateOfferReadiness(offerId: string, deliverables: string[]): OfferReadinessCheck {
    const allCapabilities = this.getCapabilities();
    const matched: SystemCapability[] = [];
    const blockers: string[] = [];

    let availableCount = 0;
    let configurationRequiredCount = 0;
    let manualOnlyCount = 0;
    let unsupportedCount = 0;

    for (const deliv of deliverables) {
      const cap = this.getCapabilityByDeliverable(deliv);
      if (!cap) {
        unsupportedCount++;
        blockers.push(`UNSUPPORTED_DELIVERABLE: '${deliv}' has no matching capability in registry.`);
      } else {
        matched.push(cap);
        if (cap.status === 'AVAILABLE') {
          availableCount++;
        } else if (cap.status === 'CONFIGURATION_REQUIRED') {
          configurationRequiredCount++;
          blockers.push(`CONFIGURATION_REQUIRED: '${deliv}' requires unconfigured credentials (${cap.requiredCredentials.join(', ')}).`);
        } else if (cap.status === 'MANUAL_DELIVERY_ONLY') {
          manualOnlyCount++;
          // Manual delivery does not block sale if client accepts manual onboarding SLA
        } else if (cap.status === 'UNSUPPORTED') {
          unsupportedCount++;
          blockers.push(`UNSUPPORTED_CAPABILITY: '${deliv}' is marked unsupported.`);
        }
      }
    }

    // An offer is publicly sellable only if 0 deliverables are unsupported
    // and all critical credentials are configured or flagged for assisted setup
    const sellable = unsupportedCount === 0 && configurationRequiredCount === 0;

    return {
      offerId,
      sellable,
      status: sellable ? 'READY' : 'DRAFT_BLOCKED',
      totalDeliverables: deliverables.length,
      availableCount,
      configurationRequiredCount,
      manualOnlyCount,
      unsupportedCount,
      blockers,
      capabilities: matched
    };
  }
}
