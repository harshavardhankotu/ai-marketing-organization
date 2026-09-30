/**
 * Canonical Action Registry
 * Single authoritative contract for all autonomous and revenue-critical external actions.
 */

import { ActionClassification, CycleExecutionStatus } from './autonomous-revenue-orchestrator.js';

export type CanonicalActionType =
  | 'CREATE_FUNNEL'
  | 'PUBLISH_CONTENT'
  | 'PUBLISH_GBP'
  | 'CREATE_GOOGLE_CAMPAIGN'
  | 'CREATE_META_CAMPAIGN'
  | 'SEND_WHATSAPP'
  | 'SEND_EMAIL'
  | 'QUALIFY_LEAD'
  | 'FOLLOW_UP_LEAD'
  | 'BOOK_RESOURCE'
  | 'CREATE_ORDER'
  | 'CREATE_PAYMENT'
  | 'REQUEST_PAYMENT'
  | 'TRIGGER_FULFILLMENT'
  | 'REQUEST_REVIEW'
  | 'REACTIVATE_CUSTOMER'
  | 'PAUSE_CAMPAIGN'
  | 'ENABLE_CAMPAIGN'
  | 'PURSUE_OPPORTUNITY'
  | 'MANUAL_OFFER_HANDOVER';

export interface ActionDefinition {
  type: CanonicalActionType;
  description: string;
  category: 'REVENUE' | 'MARKETING' | 'FULFILLMENT' | 'CUSTOMER_SERVICE' | 'GOVERNANCE';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresAuthorization: boolean;
  requiredProvider?: 'STRIPE' | 'RAZORPAY' | 'WHATSAPP' | 'EMAIL' | 'GOOGLE_ADS' | 'META_ADS' | 'GEMINI' | 'TAVILY';
  quotaCost: number;
  isExternalSideEffect: boolean;
  supportsRollback: boolean;
}

export const CANONICAL_ACTIONS: Record<CanonicalActionType, ActionDefinition> = {
  CREATE_FUNNEL: {
    type: 'CREATE_FUNNEL',
    description: 'Create and deploy a customer demand capture funnel',
    category: 'MARKETING',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: false,
    supportsRollback: true
  },
  PUBLISH_CONTENT: {
    type: 'PUBLISH_CONTENT',
    description: 'Publish generated marketing content asset to social/web channel',
    category: 'MARKETING',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  PUBLISH_GBP: {
    type: 'PUBLISH_GBP',
    description: 'Publish update or post to Google Business Profile',
    category: 'MARKETING',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    requiredProvider: 'GOOGLE_ADS',
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  CREATE_GOOGLE_CAMPAIGN: {
    type: 'CREATE_GOOGLE_CAMPAIGN',
    description: 'Launch real Google Search Ads campaign',
    category: 'MARKETING',
    riskLevel: 'HIGH',
    requiresAuthorization: true,
    requiredProvider: 'GOOGLE_ADS',
    quotaCost: 5,
    isExternalSideEffect: true,
    supportsRollback: true
  },
  CREATE_META_CAMPAIGN: {
    type: 'CREATE_META_CAMPAIGN',
    description: 'Launch real Meta Ads campaign',
    category: 'MARKETING',
    riskLevel: 'HIGH',
    requiresAuthorization: true,
    requiredProvider: 'META_ADS',
    quotaCost: 5,
    isExternalSideEffect: true,
    supportsRollback: true
  },
  SEND_WHATSAPP: {
    type: 'SEND_WHATSAPP',
    description: 'Send live outbound WhatsApp message to customer or prospect',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    requiredProvider: 'WHATSAPP',
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  SEND_EMAIL: {
    type: 'SEND_EMAIL',
    description: 'Send live outbound email message to customer or prospect',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    requiredProvider: 'EMAIL',
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  QUALIFY_LEAD: {
    type: 'QUALIFY_LEAD',
    description: 'Evaluate customer intent against offer catalog and qualification rules',
    category: 'REVENUE',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: false,
    supportsRollback: false
  },
  FOLLOW_UP_LEAD: {
    type: 'FOLLOW_UP_LEAD',
    description: 'Execute automated follow-up sequence for stalled lead',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  BOOK_RESOURCE: {
    type: 'BOOK_RESOURCE',
    description: 'Reserve appointment slot or resource in availability engine',
    category: 'REVENUE',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: false,
    supportsRollback: true
  },
  CREATE_ORDER: {
    type: 'CREATE_ORDER',
    description: 'Create server-authoritative universal order for customer',
    category: 'REVENUE',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: false,
    supportsRollback: true
  },
  CREATE_PAYMENT: {
    type: 'CREATE_PAYMENT',
    description: 'Create payment order or intent with configured payment provider',
    category: 'REVENUE',
    riskLevel: 'HIGH',
    requiresAuthorization: true,
    quotaCost: 3,
    isExternalSideEffect: true,
    supportsRollback: true
  },
  REQUEST_PAYMENT: {
    type: 'REQUEST_PAYMENT',
    description: 'Send payment link or invoice notification to customer',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  TRIGGER_FULFILLMENT: {
    type: 'TRIGGER_FULFILLMENT',
    description: 'Trigger fulfillment task execution and SLA monitoring',
    category: 'FULFILLMENT',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: false,
    supportsRollback: false
  },
  REQUEST_REVIEW: {
    type: 'REQUEST_REVIEW',
    description: 'Request customer testimonial or verified review post-delivery',
    category: 'CUSTOMER_SERVICE',
    riskLevel: 'LOW',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  REACTIVATE_CUSTOMER: {
    type: 'REACTIVATE_CUSTOMER',
    description: 'Send win-back or subscription renewal campaign to dormant customer',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  PAUSE_CAMPAIGN: {
    type: 'PAUSE_CAMPAIGN',
    description: 'Pause live ad campaign due to underperformance or budget limit',
    category: 'GOVERNANCE',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 1,
    isExternalSideEffect: true,
    supportsRollback: true
  },
  ENABLE_CAMPAIGN: {
    type: 'ENABLE_CAMPAIGN',
    description: 'Re-enable paused ad campaign within approved budget bounds',
    category: 'MARKETING',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 1,
    isExternalSideEffect: true,
    supportsRollback: true
  },
  PURSUE_OPPORTUNITY: {
    type: 'PURSUE_OPPORTUNITY',
    description: 'Convert qualified opportunity into active commercial pipeline pitch',
    category: 'REVENUE',
    riskLevel: 'MEDIUM',
    requiresAuthorization: true,
    quotaCost: 2,
    isExternalSideEffect: true,
    supportsRollback: false
  },
  MANUAL_OFFER_HANDOVER: {
    type: 'MANUAL_OFFER_HANDOVER',
    description: 'Route high-ticket or complex inquiry to human business owner',
    category: 'CUSTOMER_SERVICE',
    riskLevel: 'LOW',
    requiresAuthorization: false,
    quotaCost: 0,
    isExternalSideEffect: false,
    supportsRollback: false
  }
};

export class ActionRegistry {
  public static getActionDefinition(type: CanonicalActionType | string): ActionDefinition {
    const def = CANONICAL_ACTIONS[type as CanonicalActionType];
    if (!def) {
      throw new Error(`UNKNOWN_ACTION_TYPE: Action '${type}' is not registered in CanonicalActionRegistry.`);
    }
    return def;
  }

  public static isExternalAction(type: CanonicalActionType | string): boolean {
    const def = CANONICAL_ACTIONS[type as CanonicalActionType];
    return def ? def.isExternalSideEffect : false;
  }
}
