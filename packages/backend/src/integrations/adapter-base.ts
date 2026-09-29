import { GoogleAdsClient, GoogleAdsCredentials } from './google-ads.js';
import { isPlaceholderCredential, isProduction } from '../config/env.js';
import { AutonomyPolicyController } from '../revenue/autonomy-policy.js';

export type IntegrationProvider = 
  | 'GOOGLE_BUSINESS_PROFILE'
  | 'GOOGLE_ADS'
  | 'META_ADS'
  | 'INSTAGRAM'
  | 'WHATSAPP'
  | 'EMAIL'
  | 'RAZORPAY';

export type ActionClassification =
  | 'INTERNAL_AUTOMATION'
  | 'EXTERNAL_ACTION'
  | 'REVENUE_ACTION'
  | 'SANDBOX_ACTION'
  | 'TEST_ACTION'
  | 'LIVE_EXTERNAL_ACTION'
  | 'BLOCKED_AUTHORIZATION'
  | 'APPROVAL_REQUIRED';

export interface PublishPayload {
  title: string;
  body: string;
  channel: string;
  recipientPhone?: string;
  recipientEmail?: string;
  mediaUrl?: string;
  targetAudience?: string;
  budgetINR?: number;
  metadata?: Record<string, any>;
}

export interface PublishResult {
  success: boolean;
  externalId?: string;
  mode: 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';
  provider: IntegrationProvider;
  providerStatus: string;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'FAILED';
  actionClassification: ActionClassification;
  publishedAt: string;
  message: string;
}

export interface IntegrationHealth {
  provider: IntegrationProvider;
  connected: boolean;
  mode: 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';
  details: string;
  lastChecked: string;
}

export interface IChannelAdapter {
  provider: IntegrationProvider;
  checkHealth(): Promise<IntegrationHealth>;
  publish(payload: PublishPayload): Promise<PublishResult>;
}

// 1. WhatsApp Business Cloud Adapter (Spec § 3)
export class WhatsAppAdapter implements IChannelAdapter {
  public provider: IntegrationProvider = 'WHATSAPP';
  private accessToken?: string;
  private phoneNumberId?: string;

  constructor(credentials?: { accessToken?: string; phoneNumberId?: string }) {
    this.accessToken = credentials?.accessToken || process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
    this.phoneNumberId = credentials?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  }

  private isLiveConfigured(): boolean {
    return Boolean(
      this.accessToken &&
      !isPlaceholderCredential(this.accessToken) &&
      this.phoneNumberId &&
      !isPlaceholderCredential(this.phoneNumberId)
    );
  }

  async checkHealth(): Promise<IntegrationHealth> {
    const isLive = this.isLiveConfigured();
    return {
      provider: this.provider,
      connected: isLive,
      mode: isLive ? 'LIVE' : 'UNCONFIGURED',
      details: isLive
        ? `WhatsApp Cloud API Connected (Phone Number ID: ${this.phoneNumberId})`
        : 'WhatsApp Cloud API Unconfigured (Missing META_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)',
      lastChecked: new Date().toISOString()
    };
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const isLive = this.isLiveConfigured();
    const publishedAt = new Date().toISOString();

    if (!isLive) {
      // In non-live/test environment: explicitly report as BLOCKED_AUTHORIZATION or SANDBOX_ACTION
      // NEVER report success=true as an executed live action!
      return {
        success: false,
        mode: 'UNCONFIGURED',
        provider: this.provider,
        providerStatus: 'BLOCKED_AUTHORIZATION',
        verificationStatus: 'UNVERIFIED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: 'BLOCKED_AUTHORIZATION: WhatsApp Cloud API credentials missing or placeholder'
      };
    }

    try {
      const recipient = payload.recipientPhone || payload.metadata?.phone;
      if (!recipient) {
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: 'REJECTED_MISSING_RECIPIENT',
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: 'Recipient phone number is required for live WhatsApp message delivery'
        };
      }

      // Real WhatsApp Cloud API HTTP POST
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipient.replace(/\D/g, ''),
          type: 'text',
          text: { preview_url: false, body: payload.body }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: `API_ERROR_${res.status}`,
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: `WhatsApp API rejected message (${res.status}): ${errText}`
        };
      }

      const json = await res.json() as any;
      const realMessageId = json?.messages?.[0]?.id;

      if (!realMessageId) {
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: 'MISSING_MESSAGE_ID',
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: 'WhatsApp API did not return message id'
        };
      }

      return {
        success: true,
        externalId: realMessageId,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'DELIVERED_TO_PROVIDER',
        verificationStatus: 'VERIFIED',
        actionClassification: 'LIVE_EXTERNAL_ACTION',
        publishedAt,
        message: `Message accepted by WhatsApp Cloud API (wamid: ${realMessageId})`
      };
    } catch (err: any) {
      return {
        success: false,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'NETWORK_ERROR',
        verificationStatus: 'FAILED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: `Outbound WhatsApp network request failed: ${err.message}`
      };
    }
  }
}

// 2. Meta Ads & Instagram Adapter
export class MetaAdapter implements IChannelAdapter {
  public provider: IntegrationProvider = 'META_ADS';
  private accessToken?: string;
  private adAccountId?: string;

  constructor(credentials?: { accessToken?: string; adAccountId?: string }) {
    this.accessToken = credentials?.accessToken || process.env.META_ACCESS_TOKEN;
    this.adAccountId = credentials?.adAccountId || process.env.META_AD_ACCOUNT_ID;
  }

  private isLiveConfigured(): boolean {
    return Boolean(
      this.accessToken && !isPlaceholderCredential(this.accessToken) &&
      this.adAccountId && !isPlaceholderCredential(this.adAccountId)
    );
  }

  async checkHealth(): Promise<IntegrationHealth> {
    const isLive = this.isLiveConfigured();
    return {
      provider: this.provider,
      connected: isLive,
      mode: isLive ? 'LIVE' : 'UNCONFIGURED',
      details: isLive
        ? `Meta Marketing Graph API Connected (Account: ${this.adAccountId})`
        : 'Meta Marketing API Unconfigured (Missing META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)',
      lastChecked: new Date().toISOString()
    };
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const isLive = this.isLiveConfigured();
    const publishedAt = new Date().toISOString();

    if (!isLive) {
      return {
        success: false,
        mode: 'UNCONFIGURED',
        provider: this.provider,
        providerStatus: 'BLOCKED_AUTHORIZATION',
        verificationStatus: 'UNVERIFIED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: 'BLOCKED_AUTHORIZATION: Meta Ads API credentials missing'
      };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/act_${this.adAccountId}/adcreatives`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: payload.title,
          object_story_spec: {
            page_id: process.env.META_PAGE_ID || '',
            link_data: { message: payload.body, name: payload.title }
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: `API_ERROR_${res.status}`,
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: `Meta API rejected creative (${res.status}): ${errText}`
        };
      }

      const json = await res.json() as any;
      const creativeId = json?.id;

      return {
        success: true,
        externalId: creativeId,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'CREATED',
        verificationStatus: 'VERIFIED',
        actionClassification: 'LIVE_EXTERNAL_ACTION',
        publishedAt,
        message: `Creative published to Meta Graph API (id: ${creativeId})`
      };
    } catch (err: any) {
      return {
        success: false,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'NETWORK_ERROR',
        verificationStatus: 'FAILED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: `Meta network request failed: ${err.message}`
      };
    }
  }
}

// 3. Google Business Profile Adapter
export class GoogleAdapter implements IChannelAdapter {
  public provider: IntegrationProvider = 'GOOGLE_BUSINESS_PROFILE';
  private clientEmail?: string;
  private privateKey?: string;

  constructor(credentials?: { clientEmail?: string; privateKey?: string }) {
    this.clientEmail = credentials?.clientEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    this.privateKey = credentials?.privateKey || process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  }

  private isLiveConfigured(): boolean {
    return Boolean(
      this.clientEmail && !isPlaceholderCredential(this.clientEmail) &&
      this.privateKey && !isPlaceholderCredential(this.privateKey)
    );
  }

  async checkHealth(): Promise<IntegrationHealth> {
    const isLive = this.isLiveConfigured();
    return {
      provider: this.provider,
      connected: isLive,
      mode: isLive ? 'LIVE' : 'UNCONFIGURED',
      details: isLive ? 'Google Business Profile API Connected' : 'Google Business Profile Unconfigured',
      lastChecked: new Date().toISOString()
    };
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const publishedAt = new Date().toISOString();
    return {
      success: false,
      mode: 'UNCONFIGURED',
      provider: this.provider,
      providerStatus: 'BLOCKED_AUTHORIZATION',
      verificationStatus: 'UNVERIFIED',
      actionClassification: 'BLOCKED_AUTHORIZATION',
      publishedAt,
      message: 'BLOCKED_AUTHORIZATION: Real Google Business Profile API publishing endpoint not implemented. Fabricated actions are forbidden.'
    };
  }
}

export { GoogleAdapter as GoogleBusinessProfileAdapter };

// 4. Google Ads Adapter
export class GoogleAdsAdapter implements IChannelAdapter {
  public provider: IntegrationProvider = 'GOOGLE_ADS';
  private client: GoogleAdsClient;

  constructor(credentials?: GoogleAdsCredentials) {
    this.client = new GoogleAdsClient(credentials);
  }

  async checkHealth(): Promise<IntegrationHealth> {
    const isLive = this.client.isConfigured();
    return {
      provider: this.provider,
      connected: isLive,
      mode: isLive ? 'LIVE' : 'UNCONFIGURED',
      details: isLive
        ? `Google Ads API Connected (Customer ID: ${this.client.getCustomerId()})`
        : 'Google Ads API Unconfigured',
      lastChecked: new Date().toISOString()
    };
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const publishedAt = new Date().toISOString();
    return {
      success: false,
      mode: 'UNCONFIGURED',
      provider: this.provider,
      providerStatus: 'BLOCKED_AUTHORIZATION',
      verificationStatus: 'UNVERIFIED',
      actionClassification: 'BLOCKED_AUTHORIZATION',
      publishedAt,
      message: 'BLOCKED_AUTHORIZATION: Real Google Ads API campaign creation endpoint not implemented. Fabricated actions are forbidden.'
    };
  }
}

// 5. Email Adapter (SMTP / SendGrid / Postmark)
export class EmailAdapter implements IChannelAdapter {
  public provider: IntegrationProvider = 'EMAIL';
  private apiKey?: string;

  constructor(credentials?: { smtpKey?: string }) {
    this.apiKey = credentials?.smtpKey || process.env.SENDGRID_API_KEY || process.env.POSTMARK_API_KEY;
  }

  private isLiveConfigured(): boolean {
    return Boolean(this.apiKey && !isPlaceholderCredential(this.apiKey));
  }

  async checkHealth(): Promise<IntegrationHealth> {
    const isLive = this.isLiveConfigured();
    return {
      provider: this.provider,
      connected: isLive,
      mode: isLive ? 'LIVE' : 'UNCONFIGURED',
      details: isLive ? 'Transactional Email Provider Connected' : 'Email Gateway Unconfigured (Missing API key)',
      lastChecked: new Date().toISOString()
    };
  }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const isLive = this.isLiveConfigured();
    const publishedAt = new Date().toISOString();

    if (!isLive) {
      return {
        success: false,
        mode: 'UNCONFIGURED',
        provider: this.provider,
        providerStatus: 'BLOCKED_AUTHORIZATION',
        verificationStatus: 'UNVERIFIED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: 'BLOCKED_AUTHORIZATION: Email provider API key missing'
      };
    }

    try {
      const recipient = payload.recipientEmail || payload.metadata?.email;
      if (!recipient) {
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: 'REJECTED_MISSING_RECIPIENT',
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: 'Recipient email required'
        };
      }

      // Ensure recipient suppression check
      const policyController = AutonomyPolicyController.getInstance();
      const contactSafety = policyController.getContactSafety(recipient);
      if (contactSafety !== 'CONTACTABLE') {
        return {
          success: false,
          mode: isLive ? 'LIVE' : 'UNCONFIGURED',
          provider: this.provider,
          providerStatus: 'SUPPRESSED',
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: `Email blocked: Recipient ${recipient} is suppressed (${contactSafety}).`
        };
      }

      // Platform email sender identity
      let senderEmail = process.env.PLATFORM_SENDER_EMAIL || process.env.SENDER_EMAIL;
      let senderName = process.env.PLATFORM_SENDER_NAME || 'AI Marketing Organization';

      if (isProduction()) {
        if (!senderEmail || isPlaceholderCredential(senderEmail) || senderEmail.includes('smilekraft.in')) {
          return {
            success: false,
            mode: 'LIVE',
            provider: this.provider,
            providerStatus: 'BLOCKED_AUTHORIZATION',
            verificationStatus: 'UNVERIFIED',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            publishedAt,
            message: 'BLOCKED_AUTHORIZATION: PLATFORM_SENDER_EMAIL is required in production and must not use clinic identity.'
          };
        }
      } else {
        if (!senderEmail || senderEmail.includes('smilekraft.in')) {
          senderEmail = 'platform@aimarketing.local';
          senderName = 'AI Marketing Organization';
        }
      }

      // Append working unsubscribe link
      const baseUrl = process.env.APP_BASE_URL || process.env.BACKEND_URL || 'https://ai-marketing-organization.onrender.com';
      const encodedRecipient = encodeURIComponent(recipient);
      const unsubscribeUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/unsubscribe?email=${encodedRecipient}`;
      let emailBody = payload.body;
      if (!emailBody.includes('/unsubscribe') && !emailBody.toLowerCase().includes('unsubscribe:')) {
        emailBody = `${emailBody}\n\n---\nTo unsubscribe from future communications: ${unsubscribeUrl}`;
      }

      // Live SendGrid API request
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: senderEmail, name: senderName },
          subject: payload.title,
          content: [{ type: 'text/plain', value: emailBody }]
        })
      });

      const messageId = res.headers.get('x-message-id');
      if (!res.ok && res.status !== 202) {
        const errText = await res.text();
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: `API_ERROR_${res.status}`,
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: `Email provider error (${res.status}): ${errText}`
        };
      }

      if (!messageId) {
        return {
          success: false,
          mode: 'LIVE',
          provider: this.provider,
          providerStatus: 'PROVIDER_MISSING_ID',
          verificationStatus: 'FAILED',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          publishedAt,
          message: 'Email provider accepted message but returned no verifiable x-message-id.'
        };
      }

      return {
        success: true,
        externalId: messageId,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'ACCEPTED',
        verificationStatus: 'VERIFIED',
        actionClassification: 'LIVE_EXTERNAL_ACTION',
        publishedAt,
        message: `Email accepted for delivery (ID: ${messageId})`
      };
    } catch (err: any) {
      return {
        success: false,
        mode: 'LIVE',
        provider: this.provider,
        providerStatus: 'NETWORK_ERROR',
        verificationStatus: 'FAILED',
        actionClassification: 'BLOCKED_AUTHORIZATION',
        publishedAt,
        message: `Email delivery failed: ${err.message}`
      };
    }
  }
}