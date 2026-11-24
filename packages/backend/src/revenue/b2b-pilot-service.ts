/**
 * B2B Pilot Service Engine — Done-For-You Audit & Pilot Proposal Generator
 *
 * Implements PR #94:
 * - Fail-closed live scanning: throws SCAN_FAILED on timeout/network/HTTP error (zero fake findings)
 * - Strict 3-state audit truth classification: VERIFIED_PRESENT | VERIFIED_MISSING | NOT_CHECKED
 * - Inspects actual live HTML for WhatsApp links (wa.me/, api.whatsapp.com/send, whatsapp://) and <form>/enquiry inputs
 * - Maps SiteAuditScanner ISSUE / FAIL / PASS / NOT_CHECKED accurately
 * - Authenticated owner approval boundary: public proposals ALWAYS render as UNPRICED_DRAFT / PENDING_OWNER_APPROVAL
 *   and completely ignore any client-supplied ownerApproved or priceINR fields
 * - Durable D1 persistence via durable_events and customer_journeys
 * - Real server-side Razorpay checkout link (/b2b/checkout/:proposalId) ONLY after owner approval
 */

import { randomUUID } from 'crypto';
import { SiteAuditScanner } from '../tools/site-audit/site-audit-scanner.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { getTrustedPublicSiteUrl, isProduction } from '../config/env.js';

export type B2BAuditFindingStatus = 'VERIFIED_PRESENT' | 'VERIFIED_MISSING' | 'NOT_CHECKED';
export type B2BProposalApprovalStatus = 'PENDING_OWNER_APPROVAL' | 'OWNER_APPROVED' | 'EXPIRED' | 'PAID';

export interface B2BVerifiedFinding {
  category: string;
  item: string;
  status: B2BAuditFindingStatus;
  observation: string;
  evidence?: string;
}

export interface B2BPilotProposalRequest {
  targetUrl: string;
  businessName: string;
  packageId?: 'WEBSITE_ENQUIRY_CONVERSION_SETUP';
  contactEmail?: string;
  /** Public callers must never be able to self-approve; ignored by generateProposal */
  ownerApproved?: boolean;
  /** Public callers must never be able to self-price; ignored by generateProposal */
  priceINR?: number | null;
  checkoutBaseUrl?: string;
}

export interface B2BApproveProposalParams {
  proposalId: string;
  priceINR: number;
  scopeNotes?: string;
  expiresInHours?: number;
  checkoutBaseUrl?: string;
}

export interface B2BPilotProposalResult {
  proposalId: string;
  targetUrl: string;
  businessName: string;
  packageId: 'WEBSITE_ENQUIRY_CONVERSION_SETUP';
  packageName: string;
  scannedAt: string;
  status: 'UNPRICED_DRAFT' | 'OWNER_APPROVED' | 'EXPIRED' | 'PAID';
  approvalStatus: B2BProposalApprovalStatus;
  ownerApproved: boolean;
  priceINR: number | null;
  approvedPriceINR: number | null;
  scopeNotes: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  checkoutUrl: string | null;
  contactEmail: string | null;
  verifiedFindings: B2BVerifiedFinding[];
  markdown: string;
  html: string;
}

export const B2B_PILOT_PACKAGE_ID = 'WEBSITE_ENQUIRY_CONVERSION_SETUP' as const;
export const B2B_PILOT_OFFER_ID = 'B2B_WEBSITE_ENQUIRY_SETUP' as const;
export const B2B_PILOT_PACKAGE_NAME = 'Website & Admissions Enquiry Conversion Setup' as const;

export class B2BPilotService {
  private static instance: B2BPilotService;
  private scanner = new SiteAuditScanner();
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): B2BPilotService {
    if (!B2BPilotService.instance) {
      B2BPilotService.instance = new B2BPilotService();
    }
    return B2BPilotService.instance;
  }

  public static resetInstance(): void {
    (B2BPilotService as any).instance = undefined;
  }

  /**
   * Generates a public, UNPRICED_DRAFT proposal from a live website scan.
   * Completely ignores any client-supplied ownerApproved or priceINR fields.
   * Fails closed with SCAN_FAILED if live scan fails, times out, or returns HTTP >= 400.
   */
  public async generateProposal(
    req: B2BPilotProposalRequest,
    options?: { scanner?: SiteAuditScanner }
  ): Promise<B2BPilotProposalResult> {
    const rawUrl = String(req.targetUrl || '').trim();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`INVALID_URL: Target URL must be a valid http:// or https:// URL: received '${rawUrl}'`);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`INVALID_URL: Target URL must begin with http:// or https://: received '${rawUrl}'`);
    }

    const businessName = String(req.businessName || 'Business Owner').trim() || 'Business Owner';
    const contactEmail = req.contactEmail && String(req.contactEmail).includes('@')
      ? String(req.contactEmail).trim().toLowerCase()
      : null;
    const nowIso = new Date().toISOString();
    const proposalId = `b2b_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;

    // 1. Run deterministic live HTML & technical scan — FAIL CLOSED on any error
    const activeScanner = options?.scanner || this.scanner;
    let scanResult: any;
    try {
      scanResult = await activeScanner.scanUrl({
        url: rawUrl,
        businessCategory: 'EDUCATION_OR_LOCAL_SERVICE',
        businessName,
        includeRawHtml: true
      });
    } catch (scanErr: any) {
      throw new Error(`SCAN_FAILED: Live website scan failed for '${rawUrl}': ${scanErr?.message || String(scanErr)}`);
    }

    if (!scanResult || !Array.isArray(scanResult.findings)) {
      throw new Error(`SCAN_FAILED: Live website scan returned no valid audit payload for '${rawUrl}'.`);
    }

    const httpStatus = Number(scanResult.metrics?.httpStatus ?? 200);
    if (Number.isFinite(httpStatus) && httpStatus >= 400) {
      throw new Error(`SCAN_FAILED: Target URL '${rawUrl}' responded with HTTP ${httpStatus}.`);
    }

    // 2. Synthesize strict 3-state verified observations from actual HTML & scanner findings
    const verifiedFindings = this.buildVerifiedFindings(scanResult);

    // 3. Enforce UNPRICED_DRAFT / PENDING_OWNER_APPROVAL boundary (ignore client ownerApproved/priceINR)
    const draftPayload: Omit<B2BPilotProposalResult, 'markdown' | 'html'> = {
      proposalId,
      targetUrl: rawUrl,
      businessName,
      packageId: B2B_PILOT_PACKAGE_ID,
      packageName: B2B_PILOT_PACKAGE_NAME,
      scannedAt: nowIso,
      status: 'UNPRICED_DRAFT',
      approvalStatus: 'PENDING_OWNER_APPROVAL',
      ownerApproved: false,
      priceINR: null,
      approvedPriceINR: null,
      scopeNotes: null,
      approvedAt: null,
      expiresAt: null,
      checkoutUrl: null,
      contactEmail,
      verifiedFindings
    };

    await this.persistProposalEvent(draftPayload, false);

    return {
      ...draftPayload,
      markdown: this.renderProposalMarkdown(draftPayload),
      html: this.renderProposalHtml(draftPayload)
    };
  }

  /**
   * Builds strict 3-state findings: VERIFIED_PRESENT | VERIFIED_MISSING | NOT_CHECKED.
   * Inspects raw HTML for WhatsApp links and enquiry <form> elements, and maps scanner ISSUE/FAIL accurately.
   */
  public buildVerifiedFindings(scanResult: any): B2BVerifiedFinding[] {
    const findingsList: any[] = Array.isArray(scanResult?.findings) ? scanResult.findings : [];
    const rawHtml = typeof scanResult?.rawHtml === 'string' ? scanResult.rawHtml : '';
    const hasRawHtml = rawHtml.trim().length > 0;
    const verifiedFindings: B2BVerifiedFinding[] = [];

    // 1. Direct WhatsApp Click-to-Chat CTA (inspect actual HTML)
    if (hasRawHtml) {
      const waMatch = rawHtml.match(/(?:https?:\/\/)?(?:wa\.me\/[^\s"'<>]+|api\.whatsapp\.com\/send[^\s"'<>]*|whatsapp:\/\/[^\s"'<>]+)/i);
      if (waMatch) {
        verifiedFindings.push({
          category: 'Lead Capture',
          item: 'Direct WhatsApp Click-to-Chat CTA',
          status: 'VERIFIED_PRESENT',
          observation: 'Direct WhatsApp click-to-chat link detected in live page HTML.',
          evidence: waMatch[0].slice(0, 120)
        });
      } else {
        verifiedFindings.push({
          category: 'Lead Capture',
          item: 'Direct WhatsApp Click-to-Chat CTA',
          status: 'VERIFIED_MISSING',
          observation: 'No direct WhatsApp enquiry link (wa.me/, api.whatsapp.com/send, or whatsapp://) detected in live HTML.'
        });
      }
    } else {
      verifiedFindings.push({
        category: 'Lead Capture',
        item: 'Direct WhatsApp Click-to-Chat CTA',
        status: 'NOT_CHECKED',
        observation: 'Raw HTML was not available to verify direct WhatsApp click-to-chat links.'
      });
    }

    // 2. Course & Admissions Enquiry Form (inspect actual HTML for <form> / admissions enquiry inputs)
    if (hasRawHtml) {
      const hasEnquiryForm = this.detectEnquiryFormInHtml(rawHtml);
      if (hasEnquiryForm.detected) {
        verifiedFindings.push({
          category: 'Conversion',
          item: 'Course & Admissions Enquiry Form',
          status: 'VERIFIED_PRESENT',
          observation: 'HTML enquiry/admissions form or lead capture inputs detected in live page HTML.',
          evidence: hasEnquiryForm.evidence
        });
      } else {
        verifiedFindings.push({
          category: 'Conversion',
          item: 'Course & Admissions Enquiry Form',
          status: 'VERIFIED_MISSING',
          observation: 'No HTML <form> or admissions enquiry input fields detected in live page HTML.'
        });
      }
    } else {
      verifiedFindings.push({
        category: 'Conversion',
        item: 'Course & Admissions Enquiry Form',
        status: 'NOT_CHECKED',
        observation: 'Raw HTML was not available to inspect HTML <form> and enquiry inputs.'
      });
    }

    // 3. LocalBusiness / EducationalOrganization Schema (map scanner ISSUE and FAIL accurately)
    const schemaFindings = findingsList.filter((f: any) =>
      String(f?.id || '').startsWith('schema_') ||
      /schema|json-ld|structured data/i.test(`${f?.id || ''} ${f?.title || ''}`)
    );
    const hasSchemaDefect = schemaFindings.some((f: any) => {
      const st = String(f?.status || '').toUpperCase();
      return (st === 'ISSUE' || st === 'FAIL') &&
        (f?.id === 'schema_jsonld_missing' || String(f?.id || '').startsWith('schema_jsonld_syntax_error'));
    });
    const hasSchemaPass = schemaFindings.some((f: any) =>
      String(f?.status || '').toUpperCase() === 'PASS' &&
      (f?.id === 'schema_types_detected' || /valid schema|structured data detected/i.test(String(f?.title || '')))
    );

    if (hasSchemaDefect) {
      verifiedFindings.push({
        category: 'Search Presence',
        item: 'LocalBusiness / EducationalOrganization Schema',
        status: 'VERIFIED_MISSING',
        observation: 'Missing or invalid Schema.org JSON-LD structured data in live HTML.'
      });
    } else if (hasSchemaPass) {
      const types = Array.isArray(scanResult?.metrics?.jsonLdTypesFound) ? scanResult.metrics.jsonLdTypesFound : [];
      verifiedFindings.push({
        category: 'Search Presence',
        item: 'LocalBusiness / EducationalOrganization Schema',
        status: 'VERIFIED_PRESENT',
        observation: types.length > 0
          ? `Valid Schema.org JSON-LD structured data detected (${types.join(', ')}).`
          : 'Valid Schema.org JSON-LD structured data detected.'
      });
    } else if (schemaFindings.length === 0) {
      verifiedFindings.push({
        category: 'Search Presence',
        item: 'LocalBusiness / EducationalOrganization Schema',
        status: 'NOT_CHECKED',
        observation: 'Structured data check did not return a deterministic schema signal.'
      });
    } else {
      verifiedFindings.push({
        category: 'Search Presence',
        item: 'LocalBusiness / EducationalOrganization Schema',
        status: 'VERIFIED_MISSING',
        observation: 'Structured data markup is incomplete or missing required business properties.'
      });
    }

    // 4. Mobile Viewport & Touch Target Configuration (map scanner ISSUE and FAIL accurately)
    const viewportFindings = findingsList.filter((f: any) =>
      /viewport|mobile|responsive/i.test(`${f?.id || ''} ${f?.title || ''}`)
    );
    const hasViewportDefect = viewportFindings.some((f: any) => {
      const st = String(f?.status || '').toUpperCase();
      return st === 'ISSUE' || st === 'FAIL' || st === 'WARNING';
    });
    const hasViewportPass = viewportFindings.some((f: any) => String(f?.status || '').toUpperCase() === 'PASS');

    if (hasViewportDefect) {
      verifiedFindings.push({
        category: 'Mobile Experience',
        item: 'Mobile Viewport Configuration',
        status: 'VERIFIED_MISSING',
        observation: 'Missing or misconfigured <meta name="viewport"> tag detected for mobile devices.'
      });
    } else if (hasViewportPass) {
      verifiedFindings.push({
        category: 'Mobile Experience',
        item: 'Mobile Viewport Configuration',
        status: 'VERIFIED_PRESENT',
        observation: 'Responsive mobile viewport meta tag detected in page <head>.'
      });
    } else {
      verifiedFindings.push({
        category: 'Mobile Experience',
        item: 'Mobile Viewport Configuration',
        status: 'NOT_CHECKED',
        observation: 'Mobile viewport check did not run on this scan.'
      });
    }

    // 5. Open Graph / WhatsApp Share Preview
    const ogFindings = findingsList.filter((f: any) =>
      String(f?.id || '').startsWith('opengraph_') || /open graph/i.test(String(f?.title || ''))
    );
    const hasOgDefect = ogFindings.some((f: any) => {
      const st = String(f?.status || '').toUpperCase();
      return st === 'ISSUE' || st === 'FAIL';
    });
    const hasOgPass = ogFindings.some((f: any) => String(f?.status || '').toUpperCase() === 'PASS');
    if (hasOgDefect) {
      verifiedFindings.push({
        category: 'Social Sharing',
        item: 'Open Graph WhatsApp Preview Metadata',
        status: 'VERIFIED_MISSING',
        observation: 'Incomplete Open Graph tags (og:title / og:image) for WhatsApp link previews.'
      });
    } else if (hasOgPass) {
      verifiedFindings.push({
        category: 'Social Sharing',
        item: 'Open Graph WhatsApp Preview Metadata',
        status: 'VERIFIED_PRESENT',
        observation: 'Open Graph metadata tags detected for rich link previews.'
      });
    } else {
      verifiedFindings.push({
        category: 'Social Sharing',
        item: 'Open Graph WhatsApp Preview Metadata',
        status: 'NOT_CHECKED',
        observation: 'Open Graph metadata was not evaluated during this scan.'
      });
    }

    // 6. Core Web Vitals (PageSpeed Lab Metrics) — NOT_CHECKED unless PageSpeed actually ran
    const hasPageSpeed = Boolean(scanResult?.pageSpeed && scanResult.pageSpeed.status === 'SUCCESS');
    verifiedFindings.push({
      category: 'Performance Lab',
      item: 'Core Web Vitals (PageSpeed Insights)',
      status: hasPageSpeed ? 'VERIFIED_PRESENT' : 'NOT_CHECKED',
      observation: hasPageSpeed
        ? `PageSpeed Insights measured score: ${scanResult.pageSpeed.performanceScore ?? 'N/A'}/100.`
        : 'PageSpeed Insights Core Web Vitals lab check was not executed during this HTML scan.'
    });

    return verifiedFindings;
  }

  private detectEnquiryFormInHtml(html: string): { detected: boolean; evidence?: string } {
    const formMatches = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
    for (const formBlock of formMatches) {
      const isPureSearch =
        /role=["']search["']/i.test(formBlock) ||
        (/type=["']search["']/i.test(formBlock) && !/email|phone|tel|enquiry|inquiry|admission|message|callback|name/i.test(formBlock));
      if (isPureSearch) continue;
      if (/<(input|textarea|select|button)\b/i.test(formBlock)) {
        return { detected: true, evidence: 'Matched non-search <form> element with input controls' };
      }
    }

    // Also inspect standalone admissions/enquiry input fields (for JS-bound forms without <form> wrapper)
    const enquiryInputMatch = html.match(
      /<(input|textarea|select)\b[^>]*(?:name|id|placeholder|aria-label)=["'][^"']*(?:enquir|inquir|admission|callback|counsel|student|course|phone|mobile|whatsapp|email)[^"']*["'][^>]*>/i
    );
    if (enquiryInputMatch) {
      return { detected: true, evidence: 'Matched enquiry/admissions input field' };
    }

    return { detected: false };
  }

  /**
   * Authenticated Owner Approval: Sets authoritative priceINR and expiry in D1.
   */
  public async approveProposal(params: B2BApproveProposalParams): Promise<B2BPilotProposalResult> {
    const proposalId = String(params.proposalId || '').trim();
    if (!proposalId) {
      throw new Error('INVALID_REQUEST: proposalId is required.');
    }

    const priceNum = Number(params.priceINR);
    if (!Number.isFinite(priceNum) || priceNum < 1 || priceNum > 5_000_000) {
      throw new Error('INVALID_PRICE: priceINR must be a positive number between ₹1 and ₹50,00,000.');
    }
    const approvedPriceINR = Math.round(priceNum);

    const existing = await this.getProposalById(proposalId);
    if (!existing) {
      throw new Error(`PROPOSAL_NOT_FOUND: No B2B pilot proposal found for ID '${proposalId}'.`);
    }

    const expiresInHoursRaw = Number(params.expiresInHours ?? 168);
    const expiresInHours = Number.isFinite(expiresInHoursRaw)
      ? Math.min(720, Math.max(1, expiresInHoursRaw))
      : 168;
    const approvedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    const scopeNotes = params.scopeNotes ? String(params.scopeNotes).trim().slice(0, 1000) : existing.scopeNotes;
    const checkoutBase = (params.checkoutBaseUrl || getTrustedPublicSiteUrl()).replace(/\/$/, '');
    const checkoutUrl = `${checkoutBase}/b2b/checkout/${encodeURIComponent(proposalId)}`;

    const updatedRecord: Omit<B2BPilotProposalResult, 'markdown' | 'html'> = {
      proposalId: existing.proposalId,
      targetUrl: existing.targetUrl,
      businessName: existing.businessName,
      packageId: B2B_PILOT_PACKAGE_ID,
      packageName: existing.packageName || B2B_PILOT_PACKAGE_NAME,
      scannedAt: existing.scannedAt,
      status: 'OWNER_APPROVED',
      approvalStatus: 'OWNER_APPROVED',
      ownerApproved: true,
      priceINR: approvedPriceINR,
      approvedPriceINR,
      scopeNotes: scopeNotes || null,
      approvedAt,
      expiresAt,
      checkoutUrl,
      contactEmail: existing.contactEmail || null,
      verifiedFindings: existing.verifiedFindings
    };

    await this.persistProposalEvent(updatedRecord, true);
    await this.upsertB2BCustomerJourney(updatedRecord, 'PROPOSAL_APPROVED');

    return {
      ...updatedRecord,
      markdown: this.renderProposalMarkdown(updatedRecord),
      html: this.renderProposalHtml(updatedRecord)
    };
  }

  public async getProposalById(proposalId: string): Promise<B2BPilotProposalResult | null> {
    const cleanId = String(proposalId || '').trim();
    if (!cleanId) return null;
    const eventId = cleanId.startsWith('b2b_proposal_') ? cleanId : `b2b_proposal_${cleanId}`;

    const requireDurableD1 = isProduction() && (process.env.RENDER === 'true' || this.d1Repo.isRemoteD1Configured() || !process.env.VITEST);
    let row: any = null;
    if (this.d1Repo.isRemoteD1ReadAllowed() || requireDurableD1) {
      row = await this.d1Repo.queryOne<any>(
        'durable_events',
        'SELECT * FROM durable_events WHERE id = ? LIMIT 1',
        [eventId]
      );
    } else {
      row = getDb().prepare('SELECT * FROM durable_events WHERE id = ? LIMIT 1').get(eventId) as any;
    }

    if (!row || !row.payload_json) return null;

    let parsed: any = null;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      return null;
    }

    const verifiedFindings: B2BVerifiedFinding[] = Array.isArray(parsed.verifiedFindings)
      ? parsed.verifiedFindings
      : (typeof parsed.verifiedFindingsJson === 'string' ? JSON.parse(parsed.verifiedFindingsJson) : []);

    const isExpired = Boolean(
      parsed.expiresAt &&
      parsed.approvalStatus === 'OWNER_APPROVED' &&
      Date.parse(parsed.expiresAt) <= Date.now()
    );

    const approvalStatus: B2BProposalApprovalStatus = isExpired
      ? 'EXPIRED'
      : (parsed.approvalStatus || 'PENDING_OWNER_APPROVAL');
    const status = isExpired
      ? 'EXPIRED'
      : (parsed.status || (approvalStatus === 'OWNER_APPROVED' ? 'OWNER_APPROVED' : approvalStatus === 'PAID' ? 'PAID' : 'UNPRICED_DRAFT'));

    const approvedPriceINR =
      typeof parsed.approvedPriceINR === 'number' && Number.isFinite(parsed.approvedPriceINR) && parsed.approvedPriceINR > 0
        ? parsed.approvedPriceINR
        : null;
    const ownerApproved = approvalStatus === 'OWNER_APPROVED' && approvedPriceINR !== null && !isExpired;
    const checkoutBase = getTrustedPublicSiteUrl().replace(/\/$/, '');
    const checkoutUrl = ownerApproved
      ? (parsed.checkoutUrl || `${checkoutBase}/b2b/checkout/${encodeURIComponent(parsed.proposalId)}`)
      : null;

    const record: Omit<B2BPilotProposalResult, 'markdown' | 'html'> = {
      proposalId: parsed.proposalId,
      targetUrl: parsed.targetUrl,
      businessName: parsed.businessName,
      packageId: B2B_PILOT_PACKAGE_ID,
      packageName: parsed.packageName || B2B_PILOT_PACKAGE_NAME,
      scannedAt: parsed.scannedAt,
      status,
      approvalStatus,
      ownerApproved,
      priceINR: ownerApproved ? approvedPriceINR : null,
      approvedPriceINR,
      scopeNotes: parsed.scopeNotes || null,
      approvedAt: parsed.approvedAt || null,
      expiresAt: parsed.expiresAt || null,
      checkoutUrl,
      contactEmail: parsed.contactEmail || null,
      verifiedFindings
    };

    return {
      ...record,
      markdown: this.renderProposalMarkdown(record),
      html: this.renderProposalHtml(record)
    };
  }

  public async markProposalPaid(proposalId: string, orderId: string, paymentId: string): Promise<void> {
    const existing = await this.getProposalById(proposalId);
    if (!existing) return;

    const updated: Omit<B2BPilotProposalResult, 'markdown' | 'html'> = {
      ...existing,
      status: 'PAID',
      approvalStatus: 'PAID',
      ownerApproved: true,
      priceINR: existing.approvedPriceINR,
      checkoutUrl: existing.checkoutUrl
    };

    await this.persistProposalEvent({ ...updated, paidOrderId: orderId, paidPaymentId: paymentId }, true);
  }

  private async persistProposalEvent(
    proposal: Omit<B2BPilotProposalResult, 'markdown' | 'html'> & { paidOrderId?: string; paidPaymentId?: string },
    processed: boolean
  ): Promise<void> {
    const eventId = `b2b_proposal_${proposal.proposalId}`;
    const payloadJson = JSON.stringify({
      ...proposal,
      verifiedFindingsJson: JSON.stringify(proposal.verifiedFindings || [])
    });

    await this.d1Repo.executeWrite(
      'durable_events',
      `INSERT INTO durable_events (
        id, event_type, business_id, organization_id, payload_json, processed, processed_at, created_at
      ) VALUES (?, 'B2B_PILOT_PROPOSAL', 'biz_platform_aro', 'org_owner_primary', ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        processed = excluded.processed,
        processed_at = CASE WHEN excluded.processed = 1 THEN datetime('now') ELSE durable_events.processed_at END`,
      [eventId, payloadJson, processed ? 1 : 0, processed ? 1 : 0]
    );
  }

  private async upsertB2BCustomerJourney(
    proposal: Omit<B2BPilotProposalResult, 'markdown' | 'html'>,
    stage: string
  ): Promise<void> {
    const journeyId = `b2b_cj_${proposal.proposalId}`;
    const email = proposal.contactEmail || `${proposal.proposalId}@b2b-proposal.local`;
    const touchpoints = JSON.stringify([
      { channel: 'B2B_PILOT_PROPOSAL', targetUrl: proposal.targetUrl, proposalId: proposal.proposalId, at: new Date().toISOString() }
    ]);

    try {
      await this.d1Repo.executeWrite(
        'customer_journeys',
        `INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, customer_name,
          customer_email, stage, first_touch_channel, last_touch_channel,
          touchpoints_json, classification, created_at, updated_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', ?, ?, ?, ?, 'B2B_PILOT', 'B2B_PILOT', ?, 'REAL', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          stage = excluded.stage,
          touchpoints_json = excluded.touchpoints_json,
          updated_at = datetime('now')`,
        [journeyId, proposal.proposalId, proposal.businessName, email, stage, touchpoints]
      );
    } catch (err: any) {
      const errMsg = String(err?.message || '');
      if (errMsg.includes('no such column: organization_id') || errMsg.includes('has no column named organization_id')) {
        await this.d1Repo.executeWrite(
          'customer_journeys',
          `INSERT INTO customer_journeys (
            id, business_id, visitor_id, customer_name,
            customer_email, stage, first_touch_channel, last_touch_channel,
            touchpoints_json, classification, created_at, updated_at
          ) VALUES (?, 'biz_platform_aro', ?, ?, ?, ?, 'B2B_PILOT', 'B2B_PILOT', ?, 'REAL', datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            stage = excluded.stage,
            touchpoints_json = excluded.touchpoints_json,
            updated_at = datetime('now')`,
          [journeyId, proposal.proposalId, proposal.businessName, email, stage, touchpoints]
        );
      } else {
        throw err;
      }
    }
  }

  public renderProposalMarkdown(proposal: Omit<B2BPilotProposalResult, 'markdown' | 'html'>): string {
    const isApproved = proposal.approvalStatus === 'OWNER_APPROVED' && proposal.approvedPriceINR !== null;
    return [
      `# Before-Action Audit & Pilot Implementation Proposal`,
      `**Prepared For:** ${proposal.businessName}  `,
      `**Website Audited:** ${proposal.targetUrl}  `,
      `**Audit Date:** ${proposal.scannedAt.split('T')[0]}  `,
      `**Pilot Package:** ${proposal.packageName}  `,
      `**Proposal ID:** \`${proposal.proposalId}\`  `,
      `**Proposal Status:** ${proposal.status} (${proposal.approvalStatus})  `,
      '',
      `---`,
      '',
      `## 1. Verified Live Website Audit Findings`,
      '',
      `The following findings reflect verified technical and conversion observations on **${proposal.targetUrl}** (zero invented scores or unbacked traffic guarantees):`,
      '',
      ...proposal.verifiedFindings.map(vf => `- **[${vf.status}] ${vf.category} — ${vf.item}:** ${vf.observation}`),
      '',
      `---`,
      '',
      `## 2. Done-For-You Scope of Work`,
      '',
      `Our team implements the complete technical and conversion foundation so your institution captures and tracks student/client inquiries without subscription software bills:`,
      '',
      `1. **Technical Foundation & Fixes:** Resolve verified HTML, viewport, meta tags, and schema markup deficiencies.`,
      `2. **Conversion Landing Section:** High-clarity admissions/service hero section with direct enquiry CTA.`,
      `3. **Direct WhatsApp Click-to-Chat Integration:** Setup direct WhatsApp button with pre-filled inquiry text (routes directly to your official WhatsApp Business phone with zero monthly API fees).`,
      `4. **Free Lead Tracker Integration:** Route web and inquiry submissions immediately to a structured Google Sheet tracker + instant email alerts.`,
      `5. **Google Business Profile & Monthly Maintenance Brief:** Weekly verification of business hours, contact consistency, and inquiry log review.`,
      ...(proposal.scopeNotes ? ['', `**Owner Scope Notes:** ${proposal.scopeNotes}`] : []),
      '',
      `---`,
      '',
      `## 3. Commercial Investment & Engagement Terms`,
      '',
      isApproved && proposal.checkoutUrl
        ? [
            `**Commercial Pilot Fee:** ₹${proposal.approvedPriceINR!.toLocaleString('en-IN')} (One-time, Owner-Approved Implementation)`,
            `**Valid Until:** ${proposal.expiresAt || 'See checkout page'}`,
            `**Live Razorpay Checkout:** [Proceed to Secure Implementation Setup](${proposal.checkoutUrl})`,
            `*Terms: Delivery within 5 business days upon receiving asset credentials. 100% refund policy if technical deliverables are not furnished as specified.*`
          ].join('\n')
        : [
            `**Commercial Pilot Fee:** To be confirmed upon owner consultation and scope agreement.`,
            `*Status: UNPRICED_DRAFT / PENDING_OWNER_APPROVAL. Implementation terms and pricing are finalized directly by the business owner before checkout is enabled.*`
          ].join('\n'),
      '',
      `---`,
      `*Editorial Independence Notice: This proposal is based exclusively on factual web observations. We never guarantee specific student admission counts or search ranking positions.*`
    ].join('\n');
  }

  public renderProposalHtml(proposal: Omit<B2BPilotProposalResult, 'markdown' | 'html'>): string {
    const isApproved = proposal.approvalStatus === 'OWNER_APPROVED' && proposal.approvedPriceINR !== null && Boolean(proposal.checkoutUrl);
    const badgeClass = (st: B2BAuditFindingStatus) =>
      st === 'VERIFIED_MISSING' ? 'badge-missing' : st === 'VERIFIED_PRESENT' ? 'badge-ok' : 'badge-unchecked';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audit &amp; Pilot Proposal — ${this.escapeHtml(proposal.businessName)}</title>
  <style>
    :root { color-scheme: light dark; --bg: #090d16; --card: #111827; --text: #f1f5f9; --text-muted: #94a3b8; --border: #1e293b; --accent: #06b6d4; --success: #10b981; --warning: #f59e0b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem 1.5rem; line-height: 1.6; }
    .container { max-width: 840px; margin: 0 auto; background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 2.5rem; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    h1 { font-size: 1.6rem; color: #fff; margin-top: 0; margin-bottom: 0.5rem; }
    .meta { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .badge { display: inline-block; padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.75rem; font-weight: 700; }
    .badge-missing { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-unchecked { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.3); }
    .badge-ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .finding-card { background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; }
    .finding-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem; gap: 0.5rem; }
    .finding-title { font-weight: 600; font-size: 0.95rem; }
    .finding-desc { font-size: 0.86rem; color: var(--text-muted); }
    .scope-list { list-style: none; padding-left: 0; }
    .scope-list li { margin-bottom: 0.75rem; padding-left: 1.5rem; position: relative; font-size: 0.92rem; }
    .scope-list li::before { content: "✓"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
    .commercial-box { background: rgba(6, 182, 212, 0.08); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 10px; padding: 1.5rem; margin-top: 1.5rem; }
    .btn-checkout { display: inline-block; background: var(--accent); color: #020617; font-weight: 700; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; margin-top: 1rem; font-size: 0.95rem; }
    .disclaimer { font-size: 0.78rem; color: var(--text-muted); margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Before-Action Audit &amp; Pilot Proposal</h1>
    <div class="meta">
      <strong>Client:</strong> ${this.escapeHtml(proposal.businessName)} &bull;
      <strong>Target:</strong> <a href="${this.escapeHtml(proposal.targetUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">${this.escapeHtml(proposal.targetUrl)}</a> &bull;
      <strong>Package:</strong> ${this.escapeHtml(proposal.packageName)} &bull;
      <strong>Status:</strong> <code>${this.escapeHtml(proposal.status)}</code>
    </div>

    <h2 style="font-size:1.15rem; color:#fff;">1. Verified Live Website Audit Findings</h2>
    <div style="margin-bottom:1.75rem;">
      ${proposal.verifiedFindings.map(vf => `
        <div class="finding-card">
          <div class="finding-header">
            <span class="finding-title">${this.escapeHtml(vf.item)}</span>
            <span class="badge ${badgeClass(vf.status)}">${this.escapeHtml(vf.status)}</span>
          </div>
          <div class="finding-desc">${this.escapeHtml(vf.observation)}</div>
        </div>
      `).join('')}
    </div>

    <h2 style="font-size:1.15rem; color:#fff;">2. Done-For-You Scope of Work</h2>
    <ul class="scope-list">
      <li><strong>Technical Website Fixes:</strong> Direct resolution of verified HTML, viewport, meta tags, and schema markup deficiencies.</li>
      <li><strong>Course &amp; Admissions Conversion Hero:</strong> High-clarity landing banner with direct enquiry CTA.</li>
      <li><strong>Direct WhatsApp Click-to-Chat Wiring:</strong> Direct wa.me integration with pre-filled enquiry text (routes to your official WhatsApp Business with zero monthly software bills).</li>
      <li><strong>Free Lead Tracker Integration:</strong> Automatic enquiry capture routed to a structured Google Sheet + instant email notification.</li>
      <li><strong>Google Business Profile &amp; Maintenance Brief:</strong> Weekly audit of listings consistency and enquiry review.</li>
    </ul>

    <div class="commercial-box">
      <h3 style="margin-top:0; color:#fff; font-size:1.05rem;">Commercial Investment &amp; Terms</h3>
      ${isApproved ? `
        <div style="font-size:1.25rem; font-weight:700; color:#fff; margin-bottom:0.5rem;">₹${proposal.approvedPriceINR!.toLocaleString('en-IN')} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">(One-time Owner-Approved Fee)</span></div>
        ${proposal.scopeNotes ? `<p style="font-size:0.86rem; color:#cbd5e1; margin:0.35rem 0;">${this.escapeHtml(proposal.scopeNotes)}</p>` : ''}
        <p style="font-size:0.86rem; color:var(--text-muted); margin:0.5rem 0 1rem 0;">Delivery in 5 business days upon receiving asset credentials. 100% refund policy if technical deliverables are not furnished as specified.</p>
        <a href="${this.escapeHtml(proposal.checkoutUrl!)}" class="btn-checkout">Proceed to Secure Implementation Setup &rarr;</a>
      ` : `
        <p style="font-size:0.9rem; color:var(--text); margin-bottom:0.5rem;"><strong>Status:</strong> <code>UNPRICED_DRAFT</code> / <code>PENDING_OWNER_APPROVAL</code></p>
        <p style="font-size:0.84rem; color:var(--text-muted); margin:0;">Commercial terms and fee are confirmed directly by the business owner before extending formal checkout commitments.</p>
      `}
    </div>

    <div class="disclaimer">
      <strong>Honest Attribution Notice:</strong> All observations above reflect factual, verified scan outputs from our deterministic auditing engine. We never promise guaranteed search ranking positions or synthetic conversion quotas.
    </div>
  </div>
</body>
</html>`;
  }

  public renderB2BCheckoutHtml(proposal: B2BPilotProposalResult): string {
    const isApproved = proposal.approvalStatus === 'OWNER_APPROVED' && proposal.approvedPriceINR !== null;
    const isExpired = proposal.approvalStatus === 'EXPIRED';
    const isPaid = proposal.approvalStatus === 'PAID';

    if (!isApproved) {
      const heading = isExpired
        ? 'Proposal Expired'
        : isPaid
          ? 'Implementation Order Already Paid'
          : 'Proposal Pending Owner Approval';
      const msg = isExpired
        ? 'This owner-approved proposal has expired. Please request an updated proposal approval from the business owner.'
        : isPaid
          ? 'Payment for this B2B implementation proposal has already been captured and queued for delivery.'
          : 'This proposal is currently an UNPRICED_DRAFT (PENDING_OWNER_APPROVAL). Checkout is disabled until the owner approves final scope and price.';
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${this.escapeHtml(heading)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f8fafc; padding: 3rem 1.5rem; margin: 0; }
    .card { max-width: 640px; margin: 0 auto; background: #111827; border: 1px solid #1e293b; border-radius: 12px; padding: 2rem; }
    h1 { margin-top: 0; font-size: 1.4rem; }
    p { color: #94a3b8; font-size: 0.95rem; }
    a { color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${this.escapeHtml(heading)}</h1>
    <p>${this.escapeHtml(msg)}</p>
    <p>Proposal ID: <code>${this.escapeHtml(proposal.proposalId)}</code> &bull; Status: <code>${this.escapeHtml(proposal.approvalStatus)}</code></p>
  </div>
</body>
</html>`;
    }

    const amountFormatted = proposal.approvedPriceINR!.toLocaleString('en-IN');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>B2B Implementation Checkout — ${this.escapeHtml(proposal.businessName)}</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --border: #1e293b; --text: #f8fafc; --muted: #94a3b8; --accent: #06b6d4; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem 1rem; line-height: 1.6; }
    .container { max-width: 720px; margin: 0 auto; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 1.75rem; margin-bottom: 1.25rem; }
    .badge { display: inline-block; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.78rem; font-weight: 700; margin-bottom: 0.75rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.4rem 0; }
    .price { font-size: 2rem; font-weight: 800; color: #34d399; margin: 0.5rem 0; }
    label { display: block; font-size: 0.85rem; color: var(--muted); margin-top: 0.85rem; margin-bottom: 0.25rem; }
    input { width: 100%; padding: 0.65rem 0.8rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.92rem; }
    .btn { display: inline-block; width: 100%; margin-top: 1.25rem; padding: 0.85rem 1.25rem; border-radius: 8px; border: none; background: var(--accent); color: #020617; font-weight: 800; font-size: 1rem; cursor: pointer; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .status-box { display: none; margin-top: 1rem; padding: 1rem; border-radius: 8px; background: #0f172a; border: 1px solid #334155; font-size: 0.9rem; }
    ul { padding-left: 1.25rem; color: #cbd5e1; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="badge">OWNER_APPROVED &bull; Secure Razorpay Checkout</div>
      <h1>${this.escapeHtml(proposal.packageName)}</h1>
      <p style="color: var(--muted); margin: 0 0 0.75rem 0;">
        Prepared for <strong>${this.escapeHtml(proposal.businessName)}</strong> (${this.escapeHtml(proposal.targetUrl)})
      </p>
      <div class="price">₹${amountFormatted} <span style="font-size:0.85rem;font-weight:400;color:var(--muted);">INR (One-Time Implementation Fee)</span></div>
      ${proposal.scopeNotes ? `<p style="font-size:0.88rem;color:#cbd5e1;margin-top:0.5rem;"><strong>Approved Scope Notes:</strong> ${this.escapeHtml(proposal.scopeNotes)}</p>` : ''}
      <p style="font-size:0.8rem;color:var(--muted);margin-bottom:0;">
        Proposal ID: <code>${this.escapeHtml(proposal.proposalId)}</code>
        ${proposal.expiresAt ? ` &bull; Valid until: <code>${this.escapeHtml(proposal.expiresAt)}</code>` : ''}
      </p>
    </div>

    <div class="card">
      <h2 style="font-size:1.15rem;margin-top:0;">Verified Audit Summary</h2>
      <ul>
        ${proposal.verifiedFindings.map(vf => `<li><strong>[${this.escapeHtml(vf.status)}] ${this.escapeHtml(vf.item)}:</strong> ${this.escapeHtml(vf.observation)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h2 style="font-size:1.15rem;margin-top:0;">Complete Implementation Order</h2>
      <form id="b2b-checkout-form" onsubmit="startB2BCheckout(event)">
        <label for="customerName">Contact / Authorized Representative Name</label>
        <input id="customerName" name="customerName" type="text" required value="${this.escapeHtml(proposal.businessName)}" />

        <label for="customerEmail">Official Contact Email (for implementation kickoff &amp; receipt)</label>
        <input id="customerEmail" name="customerEmail" type="email" required placeholder="founder@institute.in" value="${this.escapeHtml(proposal.contactEmail || '')}" />

        <label for="customerPhone">Phone / WhatsApp Number (optional)</label>
        <input id="customerPhone" name="customerPhone" type="tel" placeholder="+91 98XXXXXXXX" />

        <button id="b2b-pay-btn" type="submit" class="btn">Pay ₹${amountFormatted} Securely via Razorpay &rarr;</button>
      </form>
      <div id="b2b-status-box" class="status-box"></div>
    </div>
  </div>

  <script>
    async function startB2BCheckout(e) {
      e.preventDefault();
      var btn = document.getElementById('b2b-pay-btn');
      var statusBox = document.getElementById('b2b-status-box');
      var customerName = (document.getElementById('customerName').value || '').trim();
      var customerEmail = (document.getElementById('customerEmail').value || '').trim();
      var customerPhone = (document.getElementById('customerPhone').value || '').trim();

      btn.disabled = true;
      btn.textContent = 'Creating Server-Authorized Order...';
      statusBox.style.display = 'none';

      try {
        var res = await fetch('/api/v1/payments/razorpay/create-b2b-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId: ${JSON.stringify(proposal.proposalId)},
            customerName: customerName,
            customerEmail: customerEmail,
            customerPhone: customerPhone
          })
        });
        var data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Could not create Razorpay order');
        }
        if (typeof window.Razorpay !== 'function') {
          throw new Error('Razorpay Checkout script failed to load.');
        }

        var options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency || 'INR',
          name: 'AI Marketing Organization',
          description: ${JSON.stringify(proposal.packageName + ' (' + proposal.proposalId + ')')},
          order_id: data.razorpayOrderId,
          prefill: {
            name: customerName,
            email: customerEmail,
            contact: customerPhone
          },
          theme: { color: '#06b6d4' },
          modal: {
            ondismiss: function () {
              btn.disabled = false;
              btn.textContent = 'Pay ₹${amountFormatted} Securely via Razorpay →';
              statusBox.style.display = 'block';
              statusBox.style.borderColor = '#f59e0b';
              statusBox.innerHTML = 'Checkout modal closed. No payment was charged.';
            }
          },
          handler: async function (response) {
            btn.textContent = 'Verifying Payment Capture...';
            try {
              var verifyRes = await fetch('/api/v1/payments/razorpay/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId: data.orderId,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                })
              });
              var verifyData = await verifyRes.json();
              if (!verifyRes.ok || !verifyData.success) {
                throw new Error(verifyData.error || 'Payment verification failed');
              }
              btn.style.display = 'none';
              statusBox.style.display = 'block';
              statusBox.style.borderColor = '#10b981';
              statusBox.innerHTML = '<strong style="color:#34d399;">Payment Verified &amp; Implementation Queued!</strong><br>' +
                'Order ID: <code>' + data.orderId + '</code><br>' +
                'Fulfillment Status: <code>' + (verifyData.fulfillmentStatus || 'PENDING_IMPLEMENTATION') + '</code>';
            } catch (verErr) {
              btn.disabled = false;
              btn.textContent = 'Pay ₹${amountFormatted} Securely via Razorpay →';
              statusBox.style.display = 'block';
              statusBox.style.borderColor = '#ef4444';
              statusBox.textContent = 'Verification Error: ' + (verErr.message || 'Failed');
            }
          }
        };

        var rzp = new window.Razorpay(options);
        rzp.open();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Pay ₹${amountFormatted} Securely via Razorpay →';
        statusBox.style.display = 'block';
        statusBox.style.borderColor = '#ef4444';
        statusBox.textContent = 'Error: ' + (err.message || 'Order creation failed');
      }
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
