/**
 * Public Lead Endpoint Handler
 *
 * Implements public consultation / inquiry ingestion.
 * Persistence: Cloudflare D1 authoritative in production, SQLite in dev/test.
 * Strict Invariant: Zero getDb() import. If D1 fails in production, the operation fails closed.
 */

import { Context } from 'hono';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { DPDPComplianceManager } from '../compliance/dpdp-manager.js';
import { isProduction } from '../config/env.js';

const publicRateLimitMap = new Map<string, number[]>();
const journeyTracker = new CustomerJourneyTracker();
const dpdpManager = new DPDPComplianceManager();

export async function handlePublicLeadRequest(c: Context): Promise<Response> {
  const d1Repo = D1RevenueRepository.getInstance();
  const body = await c.req.json().catch(() => ({}));
  let businessId = body.businessId;
  let biz: any = null;

  try {
    if (businessId) {
      biz = await d1Repo.queryOne(
        'businesses',
        'SELECT id, organization_id, name, vertical_name, city, neighborhood FROM businesses WHERE id = ?',
        [businessId]
      );
      if (!biz) {
        return c.json({
          success: false,
          error: `PUBLIC_BUSINESS_NOT_FOUND: The requested business profile '${businessId}' was not found or is inactive.`
        }, 404);
      }
    } else {
      biz = await d1Repo.queryOne(
        'businesses',
        'SELECT id, organization_id, name, vertical_name, city, neighborhood FROM businesses ORDER BY created_at ASC LIMIT 1'
      );
      if (!biz) {
        return c.json({
          success: false,
          error: 'PUBLIC_BUSINESS_NOT_FOUND: No active business profile is available to receive consultation requests.'
        }, 404);
      }
      businessId = biz.id;
    }
  } catch (err: any) {
    if (isProduction()) {
      return c.json({
        success: false,
        error: `STORAGE_FAULT: Production Cloudflare D1 business lookup failed: ${err.message}`
      }, 503);
    }
    return c.json({
      success: false,
      error: 'PUBLIC_BUSINESS_NOT_FOUND: Could not verify business profile.'
    }, 404);
  }

  const orgId = biz.organization_id;
  const bizName = biz?.name || 'Business';

  // 1. Anti-Bot Honeypot Defense: Silently absorb scrapers
  if (body.website_url_hp || body.bot_trap) {
    return c.json({
      success: true,
      message: 'Consultation request received successfully.',
      data: { leadId: 'lead_hp_bot', status: 'FILTERED', businessName: bizName }
    }, 200);
  }

  // 2. Sliding-Window Rate Limiter (Max 10 requests per 10 mins per IP)
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || '127.0.0.1';
  const nowMs = Date.now();
  const timestamps = (publicRateLimitMap.get(clientIp) || []).filter(t => nowMs - t < 10 * 60 * 1000);
  if (timestamps.length >= 10) {
    return c.json({
      success: false,
      error: 'Rate limit exceeded: Too many consultation requests from this network. Please wait a few minutes or contact the business directly.'
    }, 429);
  }
  timestamps.push(nowMs);
  publicRateLimitMap.set(clientIp, timestamps);

  if (!body.customerName || !body.customerPhone) {
    return c.json({ success: false, error: 'Full name and mobile phone number are required' }, 400);
  }

  // Validate Indian Phone format (10+ digits)
  const cleanPhone = body.customerPhone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return c.json({ success: false, error: 'Invalid phone number. Must be a valid 10-digit mobile number' }, 400);
  }

  // Check test mode headers or explicit classification
  const testHeader = c.req.header('x-test-mode');
  const forcedClassification = (testHeader === 'true' || testHeader === '1') ? 'TEST' : body.classification;

  try {
    const journey = journeyTracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: body.customerName.trim(),
      customerPhone: body.customerPhone.trim(),
      customerEmail: body.customerEmail ? body.customerEmail.trim() : undefined,
      channel: body.channel || 'WHATSAPP',
      campaignId: body.campaignId || undefined,
      source: body.source || (body.utmSource ? `${body.utmSource}_${body.utmMedium || 'direct'}` : 'direct_organic'),
      serviceOfInterest: body.serviceOfInterest || 'General Consultation',
      notes: body.notes,
      classification: forcedClassification,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      utmTerm: body.utmTerm,
      utmContent: body.utmContent,
      sessionId: body.sessionId,
      gclid: body.gclid,
    });

    // DPDP Act 2023: Record digital patient/customer consent
    if (body.dpdpConsentGiven || body.consentGiven) {
      try {
        dpdpManager.recordConsent({
          businessId,
          journeyId: journey.id,
          customerName: body.customerName.trim(),
          customerPhone: body.customerPhone.trim(),
          ipAddress: clientIp,
          purpose: (biz?.vertical_name?.toLowerCase().includes('dental') || biz?.name?.toLowerCase().includes('dental'))
            ? `Direct dental consultation coordination and orthodontic treatment assessment at ${bizName}`
            : `Direct consultation coordination and appointment booking with ${bizName}`,
          consentVersion: body.consentVersion || '2026.1',
        });
      } catch (dpdpErr) {
        console.warn('[DPDP Consent Warning]:', dpdpErr);
      }
    }

    const leadId = `lead_${journey.id.replace('journey-', '')}`;
    const resolvedSessionId = body.sessionId || `sess_${journey.visitorId.slice(-8)}`;

    return c.json({
      success: true,
      message: `Consultation request received successfully. The ${bizName} team will reach out shortly.`,
      data: {
        campaignId: body.campaignId || 'camp_seed_general_01',
        utmSource: body.utmSource || null,
        utmMedium: body.utmMedium || null,
        utmCampaign: body.utmCampaign || null,
        utmTerm: body.utmTerm || null,
        utmContent: body.utmContent || null,
        gclid: journey.gclid || body.gclid || null,
        attributionStatus: journey.attributionStatus || 'UNVERIFIED',
        visitorId: journey.visitorId,
        sessionId: resolvedSessionId,
        leadId,
        journeyId: journey.id,
        stage: journey.stage,
        classification: journey.classification,
        dpdpConsentCaptured: Boolean(body.dpdpConsentGiven || body.consentGiven),
        businessName: bizName
      }
    }, 201);
  } catch (err: any) {
    console.error('[Public Lead Error]:', err);
    return c.json({
      success: false,
      error: err.message || 'Consultation request could not be processed'
    }, 500);
  }
}
