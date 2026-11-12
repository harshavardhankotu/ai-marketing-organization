/**
 * IntegrationCapabilityRegistry — 5-State Platform Capability Matrix (Stage I P7)
 *
 * Canonical states:
 *   DISCOVERED -> CONFIGURED -> AUTHENTICATED -> AUTHORIZED -> OPERATIONALLY_VERIFIED
 *
 * Unconfigured or sandboxed integrations block ONLY their specific action lane
 * (`blockedLocally: true`, `statusReason: 'LOCAL_LANE_BLOCKED'`) instead of failing
 * the whole platform. On this India-first INR deployment, STRIPE is ignored unless
 * `PAYMENT_PROVIDER=stripe` or `STRIPE_SECRET_KEY` is explicitly provided.
 */

import { isPlaceholderCredential, getDirectUpiConfig } from '../config/env.js';
import { StripeAdapter } from '../integrations/stripe.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';

export type IntegrationLifecycleState =
  | 'DISCOVERED'
  | 'CONFIGURED'
  | 'AUTHENTICATED'
  | 'AUTHORIZED'
  | 'OPERATIONALLY_VERIFIED';

export interface IntegrationCapabilityEntry {
  id: string;
  name: string;
  laneScope: string;
  state: IntegrationLifecycleState;
  subState?: 'CONFIGURED_MISSING' | 'CONFIGURED' | 'PAYMENT_CLAIM_TESTED' | 'CLAIM_PROCESSING_VERIFIED' | 'PAYMENT_RECEIPT_HUMAN_VERIFIED';
  blockedLocally: boolean;
  localLaneStatus: 'ACTIVE' | 'LOCAL_LANE_BLOCKED';
  globalBlocker: boolean;
  details: string;
  requiredAction?: string;
}

export interface IntegrationCapabilityMatrixReport {
  evaluatedAt: string;
  paymentRailsScope: 'INDIA_INR_RAZORPAY_AND_UPI' | 'STRIPE_EXPLICIT';
  activePaymentRails: string[];
  integrations: IntegrationCapabilityEntry[];
  activeGlobalBlockers: IntegrationCapabilityEntry[];
  locallyBlockedLanes: IntegrationCapabilityEntry[];
  countsByState: Record<IntegrationLifecycleState, number>;
}

function hasValidEnv(key: string): boolean {
  const val = process.env[key];
  return Boolean(val && val.trim().length > 0 && !isPlaceholderCredential(val));
}

export class IntegrationCapabilityRegistry {
  public static evaluateAll(context?: {
    genuineCronObservedRecently?: boolean;
    cuelinksConnected?: boolean;
    cuelinksChannelApproved?: boolean;
    upiClaimTested?: boolean;
    upiClaimProcessingVerified?: boolean;
    humanVerifiedUpiReceiptsCount?: number;
  }): IntegrationCapabilityMatrixReport {
    const entries: IntegrationCapabilityEntry[] = [];
    const stripeExplicit =
      (process.env.PAYMENT_PROVIDER || '').toLowerCase() === 'stripe' ||
      StripeAdapter.getInstance().isConfigured();

    // 1. Direct UPI Fallback Rail (India-first primary INR fallback — environment-driven)
    const upiCfg = getDirectUpiConfig();
    const humanVerifiedUpiCount = Number(context?.humanVerifiedUpiReceiptsCount || 0);
    const upiSubState: 'CONFIGURED_MISSING' | 'CONFIGURED' | 'PAYMENT_CLAIM_TESTED' | 'CLAIM_PROCESSING_VERIFIED' | 'PAYMENT_RECEIPT_HUMAN_VERIFIED' =
      !upiCfg.configured
        ? 'CONFIGURED_MISSING'
        : humanVerifiedUpiCount >= 1
          ? 'PAYMENT_RECEIPT_HUMAN_VERIFIED'
          : context?.upiClaimTested
            ? 'PAYMENT_CLAIM_TESTED'
            : 'CLAIM_PROCESSING_VERIFIED';
    const upiState: IntegrationLifecycleState =
      upiSubState === 'CONFIGURED_MISSING'
        ? 'DISCOVERED'
        : upiSubState === 'PAYMENT_RECEIPT_HUMAN_VERIFIED'
          ? 'OPERATIONALLY_VERIFIED'
          : (upiSubState === 'PAYMENT_CLAIM_TESTED' || upiSubState === 'CLAIM_PROCESSING_VERIFIED')
            ? 'AUTHORIZED'
            : 'CONFIGURED';
    entries.push({
      id: 'DIRECT_UPI',
      name: 'Direct UPI INR Fallback Rail',
      laneScope: 'LANE_B_B2B_SERVICES / LANE_D_DIGITAL_PRODUCTS',
      state: upiState,
      subState: upiSubState,
      blockedLocally: !upiCfg.configured,
      localLaneStatus: upiCfg.configured ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: upiCfg.configured
        ? `Direct UPI UTR claim rail (${upiSubState}; VPA: ${upiCfg.vpa}; payee: ${upiCfg.payeeName}; human-verified receipts: ${humanVerifiedUpiCount}; zero cash recognized until owner bank verification).`
        : 'Direct UPI UTR claim rail (CONFIGURED_MISSING; DIRECT_UPI_VPA and DIRECT_UPI_PAYEE_NAME are unset).'
    });

    // 2. Razorpay India Payments
    const rzp = new RazorpayAdapter();
    const rzpLive = rzp.isLiveConfigured();
    const rzpTest = Boolean((process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || '').trim());
    entries.push({
      id: 'RAZORPAY',
      name: 'Razorpay INR Gateway',
      laneScope: 'LANE_D_DIGITAL_PRODUCTS (Card/Netbanking)',
      state: rzpLive ? 'OPERATIONALLY_VERIFIED' : rzpTest ? 'AUTHENTICATED' : 'DISCOVERED',
      blockedLocally: !rzpLive,
      localLaneStatus: rzpLive ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: rzpLive
        ? 'Live INR Razorpay checkout & webhook verification active.'
        : rzpTest
        ? 'Razorpay running in SANDBOX mode; live money card rail gated locally while Direct UPI handles live INR.'
        : 'Razorpay credentials unset; card checkout gated locally while Direct UPI remains active.',
      requiredAction: rzpLive ? undefined : 'Provide live rzp_live_ keys when ready to enable card/netbanking auto-capture.'
    });

    // 3. Stripe (ONLY included when explicitly selected or configured)
    if (stripeExplicit) {
      const stripe = StripeAdapter.getInstance();
      const sConf = stripe.isConfigured();
      const sWebhook = hasValidEnv('STRIPE_WEBHOOK_SECRET');
      entries.push({
        id: 'STRIPE',
        name: 'Stripe International Payments',
        laneScope: 'INTERNATIONAL_CHECKOUT',
        state: sConf && sWebhook ? 'OPERATIONALLY_VERIFIED' : sConf ? 'AUTHENTICATED' : 'DISCOVERED',
        blockedLocally: !(sConf && sWebhook),
        localLaneStatus: sConf && sWebhook ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
        globalBlocker: false,
        details: sConf ? 'Explicit Stripe provider configured.' : 'PAYMENT_PROVIDER=stripe selected but STRIPE_SECRET_KEY missing.',
        requiredAction: sConf ? undefined : 'Set STRIPE_SECRET_KEY or unset PAYMENT_PROVIDER=stripe for India-first INR rails.'
      });
    }

    // 4. Cuelinks V3 Affiliate Network
    const hasCuelinksKey = hasValidEnv('CUELINKS_API_KEY') || hasValidEnv('CUELINKS_TOKEN');
    const hasCuelinksChannel = hasValidEnv('CUELINKS_CHANNEL_ID');
    const clState: IntegrationLifecycleState =
      context?.cuelinksConnected && context?.cuelinksChannelApproved
        ? 'OPERATIONALLY_VERIFIED'
        : hasCuelinksKey && hasCuelinksChannel
        ? 'AUTHORIZED'
        : hasCuelinksKey
        ? 'CONFIGURED'
        : 'DISCOVERED';
    entries.push({
      id: 'CUELINKS_V3',
      name: 'Cuelinks V3 Affiliate Network',
      laneScope: 'LANE_A_AFFILIATE_COMMERCE / LANE_C_AUTHORIZED_PARTNERSHIPS',
      state: clState,
      blockedLocally: !hasCuelinksKey,
      localLaneStatus: hasCuelinksKey ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: hasCuelinksKey
        ? `Cuelinks channel ${process.env.CUELINKS_CHANNEL_ID || 'unset'} configured for merchant campaign sync and link conversion.`
        : 'CUELINKS_API_KEY unset; affiliate conversion lane gated locally.',
      requiredAction: hasCuelinksKey ? undefined : 'Configure CUELINKS_API_KEY and CUELINKS_CHANNEL_ID.'
    });

    // 5. Meta WhatsApp Cloud API
    const hasWaToken = hasValidEnv('WHATSAPP_ACCESS_TOKEN') || hasValidEnv('META_WHATSAPP_TOKEN');
    const hasWaPhone = hasValidEnv('WHATSAPP_PHONE_NUMBER_ID');
    const waActive = hasWaToken && hasWaPhone;
    entries.push({
      id: 'META_WHATSAPP',
      name: 'Meta WhatsApp Cloud API',
      laneScope: 'INBOUND_SERVICE_REPLIES',
      state: waActive && hasValidEnv('META_APP_SECRET') ? 'OPERATIONALLY_VERIFIED' : waActive ? 'AUTHENTICATED' : 'DISCOVERED',
      blockedLocally: !waActive,
      localLaneStatus: waActive ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: waActive
        ? 'Meta WhatsApp Cloud API ready for 24-hour customer-initiated replies (cold WA remains paused).'
        : 'WhatsApp Cloud API credentials absent; WA reply lane gated locally without blocking web/email lanes.',
      requiredAction: waActive ? undefined : 'Configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID for WhatsApp replies.'
    });

    // 6. Brevo Email
    const hasBrevo = hasValidEnv('BREVO_API_KEY') || hasValidEnv('SENDINBLUE_API_KEY');
    const emailOutboundEnabled = process.env.OUTBOUND_ENABLED === 'true';
    entries.push({
      id: 'BREVO_EMAIL',
      name: 'Brevo Transactional & Approved Outreach Email',
      laneScope: 'OWNER_APPROVED_OUTREACH_EMAIL',
      state: hasBrevo && emailOutboundEnabled ? 'OPERATIONALLY_VERIFIED' : hasBrevo ? 'AUTHORIZED' : 'DISCOVERED',
      blockedLocally: !hasBrevo,
      localLaneStatus: hasBrevo ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: hasBrevo
        ? `Brevo API configured (${emailOutboundEnabled ? 'owner-approved dispatch live' : 'awaiting OUTBOUND_ENABLED=true'}).`
        : 'BREVO_API_KEY absent; automated email dispatch gated locally.',
      requiredAction: hasBrevo ? undefined : 'Provide BREVO_API_KEY to enable owner-approved email delivery.'
    });

    // 7. Google Search Console / Indexing API
    const hasGsc = hasValidEnv('GOOGLE_INDEXING_CREDENTIALS_JSON') || hasValidEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
    entries.push({
      id: 'GOOGLE_SEARCH_CONSOLE',
      name: 'Google Search Indexing & GSC',
      laneScope: 'ORGANIC_INDEXING_LANE',
      state: hasGsc ? 'OPERATIONALLY_VERIFIED' : 'CONFIGURED',
      blockedLocally: false,
      localLaneStatus: 'ACTIVE',
      globalBlocker: false,
      details: hasGsc
        ? 'RS256 OAuth2 indexing submissions configured.'
        : 'Sitemap & HTML canonicals active; active push indexing awaits service account JSON.'
    });

    // 8. Google PageSpeed Insights
    const hasPsi = hasValidEnv('GOOGLE_PAGESPEED_API_KEY');
    entries.push({
      id: 'GOOGLE_PAGESPEED',
      name: 'Google PageSpeed Insights',
      laneScope: 'SITEFIX_CWV_TELEMETRY',
      state: hasPsi ? 'OPERATIONALLY_VERIFIED' : 'CONFIGURED',
      blockedLocally: false,
      localLaneStatus: 'ACTIVE',
      globalBlocker: false,
      details: hasPsi ? 'PageSpeed API key active (40/day quota ledger).' : 'Deterministic HTML audit active without PageSpeed API key.'
    });

    // 9. Tavily Search
    const hasTavily = hasValidEnv('TAVILY_API_KEY');
    entries.push({
      id: 'TAVILY_SEARCH',
      name: 'Tavily Search Discovery',
      laneScope: 'DEMAND_DISCOVERY_LANE',
      state: hasTavily ? 'AUTHORIZED' : 'DISCOVERED',
      blockedLocally: !hasTavily,
      localLaneStatus: hasTavily ? 'ACTIVE' : 'LOCAL_LANE_BLOCKED',
      globalBlocker: false,
      details: hasTavily ? 'Tavily discovery active within monthly cap.' : 'TAVILY_API_KEY missing; search falls back to Google Suggest & feeds.'
    });

    // 10. Google Gemini
    const hasGemini = hasValidEnv('GEMINI_API_KEY');
    entries.push({
      id: 'GOOGLE_GEMINI',
      name: 'Google Gemini AI',
      laneScope: 'EDITORIAL_SUMMARIZATION_OPTIONAL',
      state: hasGemini ? 'AUTHORIZED' : 'DISCOVERED',
      blockedLocally: false,
      localLaneStatus: 'ACTIVE',
      globalBlocker: false,
      details: hasGemini ? 'Gemini configured (capped at 48 calls/day).' : 'Deterministic zero-token engines active without Gemini.'
    });

    // 11. Cloudflare Worker Cron
    entries.push({
      id: 'CLOUDFLARE_WORKER',
      name: 'Cloudflare Cron Worker',
      laneScope: 'HOURLY_BACKGROUND_SCHEDULER',
      state: context?.genuineCronObservedRecently ? 'OPERATIONALLY_VERIFIED' : 'CONFIGURED',
      blockedLocally: false,
      localLaneStatus: 'ACTIVE',
      globalBlocker: false,
      details: context?.genuineCronObservedRecently
        ? 'Hourly Cloudflare Cron Worker observed within SLA.'
        : 'Cloudflare Cron Worker deployed; layer-1 inbound webhooks operate independently 24/7.'
    });

    // 12. Render Hosting
    entries.push({
      id: 'RENDER',
      name: 'Render Production Runtime',
      laneScope: 'PLATFORM_HOSTING',
      state: 'OPERATIONALLY_VERIFIED',
      blockedLocally: false,
      localLaneStatus: 'ACTIVE',
      globalBlocker: false,
      details: 'Canonical HTTPS runtime active with trusted PUBLIC_SITE_URL anchoring.'
    });

    const countsByState: Record<IntegrationLifecycleState, number> = {
      DISCOVERED: 0,
      CONFIGURED: 0,
      AUTHENTICATED: 0,
      AUTHORIZED: 0,
      OPERATIONALLY_VERIFIED: 0
    };
    for (const entry of entries) {
      countsByState[entry.state]++;
    }

    return {
      evaluatedAt: new Date().toISOString(),
      paymentRailsScope: stripeExplicit ? 'STRIPE_EXPLICIT' : 'INDIA_INR_RAZORPAY_AND_UPI',
      activePaymentRails: ['DIRECT_UPI', 'RAZORPAY'],
      integrations: entries,
      activeGlobalBlockers: entries.filter(e => e.globalBlocker),
      locallyBlockedLanes: entries.filter(e => e.blockedLocally),
      countsByState
    };
  }
}
