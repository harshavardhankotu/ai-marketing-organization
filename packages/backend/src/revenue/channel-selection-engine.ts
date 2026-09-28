/**
 * ChannelSelectionEngine
 *
 * Implements Spec § 14: Deterministic Outbound Channel Selection.
 *
 * Priority:
 * 1. EMAIL when authorized and live provider connected
 * 2. WHATSAPP only when explicit opt-in exists + approved template is available
 * 3. BLOCKED when neither is authorized
 *
 * Invariant: Authorization comes first. A channel is never selected merely
 * because a provider is configured or a phone number exists.
 */

export interface ChannelSelectionInput {
  prospect?: {
    contactEmail?: string;
    contactPhone?: string;
    isOptedOut?: boolean;
  };
  outboundContact?: {
    emailAuthorized?: boolean | number;
    whatsappOptIn?: boolean | number;
    isOptedOut?: boolean | number;
    isSuppressed?: boolean | number;
    suppressionReason?: string;
    channel?: string;
  };
  policySafety?: string; // from AutonomyPolicyController.getContactSafety()
  providerHealth?: {
    emailConnected?: boolean;
    whatsappConnected?: boolean;
  };
  approvedTemplateName?: string;
}

export interface ChannelSelectionResult {
  allowed: boolean;
  channel?: 'EMAIL' | 'WHATSAPP';
  reason: string;
}

export class ChannelSelectionEngine {
  private static instance: ChannelSelectionEngine;

  public static getInstance(): ChannelSelectionEngine {
    if (!ChannelSelectionEngine.instance) {
      ChannelSelectionEngine.instance = new ChannelSelectionEngine();
    }
    return ChannelSelectionEngine.instance;
  }

  /**
   * Deterministically evaluates the compliant outbound channel for an opportunity.
   */
  public selectChannel(input: ChannelSelectionInput): ChannelSelectionResult {
    // 1. Check global policy safety
    if (input.policySafety && input.policySafety !== 'CONTACTABLE') {
      return {
        allowed: false,
        reason: `BLOCKED_AUTHORIZATION: Contact is suppressed by policy (${input.policySafety})`
      };
    }

    // 2. Check suppression / opt-out
    if (input.prospect?.isOptedOut) {
      return {
        allowed: false,
        reason: 'BLOCKED_AUTHORIZATION: Prospect has opted out'
      };
    }

    if (input.outboundContact?.isOptedOut || input.outboundContact?.isSuppressed) {
      return {
        allowed: false,
        reason: `BLOCKED_AUTHORIZATION: Outbound contact is opted out or suppressed (${input.outboundContact.suppressionReason || 'POLICY'})`
      };
    }

    const email = input.prospect?.contactEmail;
    const isEmailAuthorized = Boolean(input.outboundContact?.emailAuthorized);
    const isEmailLive = input.providerHealth?.emailConnected !== false;

    // Priority 1: EMAIL when email exists, email is authorized, and email provider is connected
    if (email && isEmailAuthorized && isEmailLive) {
      return {
        allowed: true,
        channel: 'EMAIL',
        reason: 'Authorized public business email channel selected'
      };
    }

    // Priority 2: WHATSAPP only when explicit opt-in + approved template exist
    const phone = input.prospect?.contactPhone;
    const isWhatsAppOptIn = Boolean(input.outboundContact?.whatsappOptIn);
    const hasApprovedTemplate = Boolean(input.approvedTemplateName);
    const isWhatsAppLive = input.providerHealth?.whatsappConnected !== false;

    if (phone && isWhatsAppOptIn) {
      if (!hasApprovedTemplate) {
        return {
          allowed: false,
          reason: 'BLOCKED_AUTHORIZATION: WhatsApp opt-in exists but no approved Meta template specified'
        };
      }
      if (!isWhatsAppLive) {
        return {
          allowed: false,
          reason: 'BLOCKED_AUTHORIZATION: WhatsApp provider not connected'
        };
      }
      return {
        allowed: true,
        channel: 'WHATSAPP',
        reason: 'Authorized WhatsApp channel with explicit opt-in selected'
      };
    }

    // Spec § 12: Cold WhatsApp without opt-in is strictly blocked
    if (phone && !isWhatsAppOptIn) {
      if (email && !isEmailAuthorized) {
        return {
          allowed: false,
          reason: 'BLOCKED_AUTHORIZATION: Phone number requires WhatsApp opt-in; email is not yet authorized'
        };
      }
      return {
        allowed: false,
        reason: 'BLOCKED_WHATSAPP_NO_OPT_IN: Public phone number does not constitute WhatsApp consent'
      };
    }

    return {
      allowed: false,
      reason: 'BLOCKED_AUTHORIZATION: No authorized outbound channel available'
    };
  }
}
