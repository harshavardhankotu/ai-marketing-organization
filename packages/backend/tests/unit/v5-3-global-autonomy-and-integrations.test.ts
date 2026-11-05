import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { GoogleIndexingClient } from '../../src/integrations/google-indexing-client.js';
import { OutboundEngine } from '../../src/revenue/outbound-engine.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';

describe('V5.3 — Global Autonomy Brain, Integrations & 4-Engine Multi-Sector Platform Tests', () => {
  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, created_at, updated_at)
        VALUES ('org_test', 'Test Organization', 'org-test', datetime('now'), datetime('now'))
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, created_at, updated_at
        ) VALUES (
          'biz_test', 'org_test', 'Test Business', 'biz-test', 'v_test', 'Testing',
          'Hyderabad', 'Madhapur', 'Helpful', datetime('now'), datetime('now')
        )
      `).run();
    } catch {}
  });

  describe('1. Priority Two Fix — Razorpay CSP Iframe & Security Headers', () => {
    it('sets unblocked CSP and COEP unsafe-none on root HTML route /', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const csp = res.headers.get('content-security-policy') || '';
      const coep = res.headers.get('cross-origin-embedder-policy');

      expect(coep).toBe('unsafe-none');
      expect(csp).toContain('https://checkout.razorpay.com');
      expect(csp).toContain('https://*.razorpay.com');
      expect(csp).toContain("frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com");
      expect(csp).toContain("child-src 'self' https://api.razorpay.com https://checkout.razorpay.com");
      expect(csp).toContain("connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com");
    });

    it('sets unblocked CSP on /offer and /tools/site-audit', async () => {
      const resOffer = await app.request('/offer');
      expect(resOffer.status).toBe(200);
      const cspOffer = resOffer.headers.get('content-security-policy') || '';
      expect(cspOffer).toContain('https://checkout.razorpay.com');

      const resAudit = await app.request('/tools/site-audit');
      expect(resAudit.status).toBe(200);
      const cspAudit = resAudit.headers.get('content-security-policy') || '';
      expect(cspAudit).toContain('https://checkout.razorpay.com');
    });

    it('redirects /checkout to /offer with 302', async () => {
      const res = await app.request('/checkout');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/offer');
    });
  });

  describe('2. Priority Three — Brevo MCP Server & Transactional Guard', () => {
    it('hard-blocks sending WhatsApp via Brevo', () => {
      const brevo = BrevoMcpClient.getInstance();
      expect(() => brevo.sendWhatsApp()).toThrowError(/BREVO_WHATSAPP_DISABLED_ON_FREE_TIER/);
    });

    it('enforces 200 sends/day limit and queues overflow messages in D1/SQLite', async () => {
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      // Seed daily quota to 200 (max cap)
      db.prepare(`
        INSERT INTO brevo_daily_quota (date_utc, sends_count, updated_at)
        VALUES (?, 200, datetime('now'))
        ON CONFLICT(date_utc) DO UPDATE SET sends_count = 200
      `).run(today);

      const brevo = BrevoMcpClient.getInstance();
      const result = await brevo.sendTransactionalEmail({
        to: [{ email: 'overflow-test@example.com', name: 'Dr. Test' }],
        subject: 'SiteFix AI Optimization Pack',
        textContent: 'Your audit package is ready.'
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('QUEUED_NEXT_UTC_WINDOW');
      expect(result.dailySendsRemaining).toBe(0);

      // Verify row exists in brevo_message_queue
      const queued = db.prepare('SELECT * FROM brevo_message_queue WHERE recipient_email = ?').get('overflow-test@example.com') as any;
      expect(queued).toBeDefined();
      expect(queued.status).toBe('QUEUED_NEXT_UTC_WINDOW');

      // Reset quota for subsequent tests
      db.prepare('DELETE FROM brevo_daily_quota WHERE date_utc = ?').run(today);
    });

    it('rejects sending to suppressed recipient email', async () => {
      const discEngine = PlatformProspectDiscoveryEngine.getInstance();
      await discEngine.suppressContact('suppressed-doctor@example.com', 'EMAIL', 'OPTOUT', 30);

      const brevo = BrevoMcpClient.getInstance();
      const result = await brevo.sendTransactionalEmail({
        to: [{ email: 'suppressed-doctor@example.com' }],
        subject: 'Appointment Confirmation',
        textContent: 'Booking confirmed.'
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('SUPPRESSED');
    });

    it('processes webhook bounces and unsubscribes into D1 suppression list', async () => {
      const brevo = BrevoMcpClient.getInstance();
      const bounceResult = await brevo.handleWebhookEvent({
        event: 'hard_bounce',
        email: 'bounced-client@example.com',
        reason: 'Mailbox does not exist'
      });

      expect(bounceResult.processed).toBe(true);
      expect(bounceResult.suppressed).toBe(true);

      const isSuppressed = await PlatformProspectDiscoveryEngine.getInstance().isContactSuppressedAsync(undefined, 'bounced-client@example.com');
      expect(isSuppressed).toBe(true);
    });
  });

  describe('3. Priority Three — Google Indexing API Schema Gate & Daily Cap', () => {
    it('rejects ordinary pages lacking JobPosting or BroadcastEvent schema', async () => {
      const client = GoogleIndexingClient.getInstance();
      const res = await client.publishUrl('https://ai-marketing-organization.onrender.com/deals', 'URL_UPDATED', {
        html: '<html><head><title>Deals</title></head><body><h1>Best Electronics</h1></body></html>'
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('SKIPPED_INELIGIBLE_SCHEMA_TYPE');
      expect(res.fallback).toBe('ROUTED_TO_SITEMAP_INDEXNOW');
    });

    it('permits pages with JobPosting schema and checks daily quota cap (180/day)', async () => {
      const client = GoogleIndexingClient.getInstance();
      const res = await client.publishUrl('https://ai-marketing-organization.onrender.com/careers/seo-lead', 'URL_UPDATED', {
        hasJobPosting: true
      });

      expect(res.success).toBe(true);
      expect(['PUBLISHED', 'PUBLISHED_SANDBOX']).toContain(res.status);
      expect(res.remainingToday).toBeDefined();
    });

    it('enforces 180 requests/day cap', async () => {
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(`
        INSERT INTO google_indexing_daily_quota (date_utc, requests_count, updated_at)
        VALUES (?, 180, datetime('now'))
        ON CONFLICT(date_utc) DO UPDATE SET requests_count = 180
      `).run(today);

      const client = GoogleIndexingClient.getInstance();
      const res = await client.publishUrl('https://ai-marketing-organization.onrender.com/events/live-demo', 'URL_UPDATED', {
        hasBroadcastEvent: true
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('QUOTA_EXHAUSTED');
      expect(res.fallback).toBe('ROUTED_TO_SITEMAP_INDEXNOW');

      db.prepare('DELETE FROM google_indexing_daily_quota WHERE date_utc = ?').run(today);
    });
  });

  describe('4. Priority Four — WhatsApp Inbound-to-Reply Loop & Policy Invariants', () => {
    it('blocks cold unsolicited WhatsApp outreach (BLOCKED_NO_OPT_IN)', async () => {
      const outbound = OutboundEngine.getInstance();
      const res = await outbound.sendWhatsAppMessage({
        businessId: 'biz_test',
        organizationId: 'org_test',
        recipientContact: '+919988776655',
        body: 'Cold promotional message',
        isInboundResponse: false,
        isAuthorizedNotification: false
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('BLOCKED_NO_OPT_IN');
      expect(res.error).toContain('BLOCKED_NO_OPT_IN');
    });

    it('allows customer-initiated inbound reply within 24-hour service window', async () => {
      const outbound = OutboundEngine.getInstance();
      const res = await outbound.sendWhatsAppMessage({
        businessId: 'biz_test',
        organizationId: 'org_test',
        recipientContact: '+919876543210',
        body: 'Thank you for reaching out! Our receptionist is confirming your appointment slot.',
        isInboundResponse: true
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('SENT');
      expect(res.providerMessageId).toBeDefined();
    });

    it('Meta Cloud API inbound webhook deduplicates message ID and triggers auto-reply', async () => {
      const testMsgId = 'wamid.HBgL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const webhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15550234567',
                    phone_number_id: 'pn_test_123'
                  },
                  contacts: [{ profile: { name: 'Dr. Ramesh' }, wa_id: '919876543210' }],
                  messages: [
                    {
                      from: '919876543210',
                      id: testMsgId,
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      text: { body: 'What are your prices for the WhatsApp triage bot?' },
                      type: 'text'
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      const res = await app.request('/api/v1/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data?.[0]?.intent).toBe('PRICE_QUESTION');
      expect(json.data?.[0]?.outboundDispatch?.success).toBe(true);

      // Re-sending the same message ID must be deduplicated
      const resDup = await app.request('/api/v1/webhooks/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });
      expect(resDup.status).toBe(200);
      const jsonDup = await resDup.json();
      expect(jsonDup.data?.[0]?.duplicate).toBe(true);
      expect(jsonDup.data?.[0]?.reason).toBe('MESSAGE_ALREADY_PROCESSED');
    });
  });

  describe('5. Priority Five — Partner & Integration Distribution Feeds (Engine 4)', () => {
    it('GET /api/v1/public/feeds/deals.json returns JSON feed format', async () => {
      const res = await app.request('/api/v1/public/feeds/deals.json');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/feed+json');

      const json = await res.json();
      expect(json.version).toBe('https://jsonfeed.org/version/1.1');
      expect(json.title).toContain('Deals');
      expect(Array.isArray(json.items)).toBe(true);
    });

    it('GET /feeds/deals.json redirects to /api/v1/public/feeds/deals.json', async () => {
      const res = await app.request('/feeds/deals.json');
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('/api/v1/public/feeds/deals.json');
    });
  });
});
