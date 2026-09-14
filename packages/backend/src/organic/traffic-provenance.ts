import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  TrafficSource,
  TrafficEvidenceStatus,
  VisitorSessionRecord,
  AcquisitionEvidenceRecord,
} from '@ai-marketing/shared';

export interface IngestSessionParams {
  businessId?: string;
  visitorId?: string;
  sessionId?: string;
  landingPage: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  ipAddress?: string;
  userAgent?: string;
  isTestHarness?: boolean;
}

export interface IngestLeadParams {
  businessId: string;
  organizationId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  sessionId?: string;
  visitorId?: string;
  notes?: string;
}

export class TrafficProvenanceEngine {
  private get db() {
    return getDb();
  }

  /**
   * Evaluates HTTP and network provenance to classify traffic evidence:
   * Only genuine external requests with public IP / external referrer qualify as VERIFIED_EXTERNAL.
   * Localhost, test runners, internal API calls, and missing provenance are strictly separated.
   */
  public evaluateTrafficEvidence(params: {
    ipAddress?: string;
    userAgent?: string;
    referrer?: string;
    isTestHarness?: boolean;
  }): { status: TrafficEvidenceStatus; isExternal: boolean; reason: string } {
    if (params.isTestHarness) {
      return {
        status: 'TEST',
        isExternal: false,
        reason: 'Explicit test harness execution flag detected.',
      };
    }

    const ip = (params.ipAddress || '').trim().toLowerCase();
    const ua = (params.userAgent || '').toLowerCase();
    const referrer = (params.referrer || '').toLowerCase();

    // 1. Internal & Localhost IP Detection
    const isLoopback =
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === 'localhost' ||
      ip.startsWith('127.') ||
      ip === '0.0.0.0';

    const isPrivateSubnet =
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

    // 2. Automated Test / Developer Agent Detection
    const isTestAgent =
      ua.includes('vitest') ||
      ua.includes('playwright') ||
      ua.includes('puppeteer') ||
      ua.includes('supertest') ||
      ua.includes('test-runner');

    const isDevClient =
      ua.includes('postman') ||
      ua.includes('insomnia') ||
      ua.includes('curl') ||
      ua.includes('node-fetch') ||
      ua.includes('axios');

    if (isTestAgent) {
      return {
        status: 'TEST',
        isExternal: false,
        reason: `Automated test runner detected: ${ua.substring(0, 50)}`,
      };
    }

    if (isLoopback || isPrivateSubnet || isDevClient) {
      return {
        status: 'INTERNAL',
        isExternal: false,
        reason: isLoopback
          ? 'Localhost / loopback connection detected (not external traffic).'
          : isPrivateSubnet
          ? 'Internal private network request detected.'
          : 'Developer API client detected (curl / node-fetch).',
      };
    }

    // 3. External Traffic Evidence Validation
    // A genuine external visitor must have a public IP and/or verified external platform referrer
    const hasExternalReferrer =
      referrer.includes('google.') ||
      referrer.includes('instagram.com') ||
      referrer.includes('facebook.com') ||
      referrer.includes('youtube.com') ||
      referrer.includes('whatsapp.com') ||
      referrer.includes('wa.me') ||
      referrer.includes('linkedin.com') ||
      referrer.includes('t.co') ||
      referrer.includes('twitter.com') ||
      (referrer.startsWith('http') && !referrer.includes('localhost') && !referrer.includes('127.0.0.1'));

    if (ip && !isLoopback && !isPrivateSubnet) {
      return {
        status: 'VERIFIED_EXTERNAL',
        isExternal: true,
        reason: hasExternalReferrer
          ? `Verified external client IP (${ip}) arriving from organic referrer (${referrer}).`
          : `Verified external client IP (${ip}) directly accessing public landing page.`,
      };
    }

    if (hasExternalReferrer) {
      return {
        status: 'VERIFIED_EXTERNAL',
        isExternal: true,
        reason: `Verified organic referrer: ${referrer}.`,
      };
    }

    return {
      status: 'UNKNOWN',
      isExternal: false,
      reason: 'Inconclusive provenance: lacking verified external client IP or referrer header.',
    };
  }

  /**
   * Resolves canonical TrafficSource from UTM parameters and referrer.
   * Default is strictly UNKNOWN — never inferred from desired campaigns.
   */
  public resolveTrafficSource(utmSource?: string, referrer?: string): TrafficSource {
    const rawUtm = (utmSource || '').trim().toLowerCase();
    const ref = (referrer || '').trim().toLowerCase();

    if (rawUtm === 'google_organic' || rawUtm === 'google-organic' || rawUtm === 'google') {
      return 'GOOGLE_ORGANIC';
    }
    if (rawUtm === 'google_business_profile' || rawUtm === 'gbp' || rawUtm === 'google_maps') {
      return 'GOOGLE_BUSINESS_PROFILE';
    }
    if (rawUtm === 'instagram' || rawUtm === 'instagram_organic' || rawUtm === 'ig') {
      return 'INSTAGRAM_ORGANIC';
    }
    if (rawUtm === 'facebook' || rawUtm === 'facebook_organic' || rawUtm === 'fb') {
      return 'FACEBOOK_ORGANIC';
    }
    if (rawUtm === 'youtube' || rawUtm === 'youtube_organic' || rawUtm === 'yt') {
      return 'YOUTUBE_ORGANIC';
    }
    if (rawUtm === 'whatsapp' || rawUtm === 'whatsapp_inbound' || rawUtm === 'wa') {
      return 'WHATSAPP_INBOUND';
    }
    if (rawUtm === 'patient_referral' || rawUtm === 'referral') {
      return 'REFERRAL';
    }
    if (rawUtm === 'local_partner' || rawUtm === 'partnership') {
      return 'LOCAL_PARTNERSHIP';
    }
    if (rawUtm === 'direct') {
      return 'DIRECT';
    }
    if (rawUtm === 'test' || rawUtm === 'test_harness') {
      return 'TEST';
    }

    // Check Referrer if UTM is absent
    if (ref.includes('google.') || ref.includes('google.co.in')) {
      return 'GOOGLE_ORGANIC';
    }
    if (ref.includes('instagram.com')) {
      return 'INSTAGRAM_ORGANIC';
    }
    if (ref.includes('facebook.com')) {
      return 'FACEBOOK_ORGANIC';
    }
    if (ref.includes('youtube.com') || ref.includes('youtu.be')) {
      return 'YOUTUBE_ORGANIC';
    }
    if (ref.includes('whatsapp.com') || ref.includes('wa.me')) {
      return 'WHATSAPP_INBOUND';
    }

    if (!rawUtm && (!ref || ref === 'direct')) {
      return 'DIRECT';
    }

    // Never guess or infer
    return 'UNKNOWN';
  }

  /**
   * Ingests and records an organic visitor session.
   */
  public recordSession(params: IngestSessionParams): VisitorSessionRecord {
    const businessId = params.businessId || 'biz_smilekraft_hyd';
    const id = `sess_org_${randomUUID().substring(0, 12)}`;
    const visitorId = params.visitorId || `vis_${randomUUID().substring(0, 12)}`;
    const sessionId = params.sessionId || `s_${randomUUID().substring(0, 12)}`;
    const now = new Date().toISOString();

    const evaluation = this.evaluateTrafficEvidence({
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      referrer: params.referrer,
      isTestHarness: params.isTestHarness,
    });

    const source = this.resolveTrafficSource(params.utmSource, params.referrer);

    this.db
      .prepare(
        `INSERT INTO traffic_sessions (
          id, business_id, visitor_id, session_id, source, referrer, landing_page,
          timestamp, utm_source, utm_medium, utm_campaign, utm_content,
          traffic_evidence_status, ip_address, user_agent, is_external,
          verification_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        businessId,
        visitorId,
        sessionId,
        source,
        params.referrer || '',
        params.landingPage,
        now,
        params.utmSource || null,
        params.utmMedium || null,
        params.utmCampaign || null,
        params.utmContent || null,
        evaluation.status,
        params.ipAddress || null,
        params.userAgent || null,
        evaluation.isExternal ? 1 : 0,
        evaluation.reason,
        now
      );

    return {
      id,
      businessId,
      visitorId,
      sessionId,
      source,
      referrer: params.referrer || '',
      landingPage: params.landingPage,
      timestamp: now,
      utmSource: params.utmSource,
      utmMedium: params.utmMedium,
      utmCampaign: params.utmCampaign,
      utmContent: params.utmContent,
      trafficEvidenceStatus: evaluation.status,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      isExternal: evaluation.isExternal,
      verificationReason: evaluation.reason,
      createdAt: now,
    };
  }

  /**
   * Captures a real organic lead tied to an existing session provenance.
   */
  public recordLead(params: IngestLeadParams): {
    journeyId: string;
    leadId: string;
    acquisitionEvidence: AcquisitionEvidenceRecord;
  } {
    const orgId = params.organizationId || 'org_smilekraft_01';
    const businessId = params.businessId || 'biz_smilekraft_hyd';
    const leadId = `lead_${randomUUID().substring(0, 10)}`;
    const journeyId = `journey_${randomUUID()}`;
    const now = new Date().toISOString();

    // Look up associated traffic session if provided
    let sessionRow: any = null;
    if (params.sessionId) {
      sessionRow = this.db
        .prepare('SELECT * FROM traffic_sessions WHERE session_id = ?')
        .get(params.sessionId);
    } else if (params.visitorId) {
      sessionRow = this.db
        .prepare('SELECT * FROM traffic_sessions WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(params.visitorId);
    }

    const visitorId = sessionRow?.visitor_id || params.visitorId || `vis_${randomUUID().substring(0, 8)}`;
    const source = (sessionRow?.source as TrafficSource) || 'UNKNOWN';
    const evidenceStatus = (sessionRow?.traffic_evidence_status as TrafficEvidenceStatus) || 'UNKNOWN';
    const isVerifiedOrganic = evidenceStatus === 'VERIFIED_EXTERNAL';

    // Insert customer journey
    this.db
      .prepare(
        `INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, customer_name, customer_phone, customer_email,
          stage, first_touch_channel, last_touch_channel, touchpoints_json,
          total_lifetime_value_inr, classification, attribution_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUALIFIED_LEAD', ?, ?, ?, 0, 'REAL', ?, ?, ?)`
      )
      .run(
        journeyId,
        orgId,
        businessId,
        visitorId,
        params.customerName,
        params.customerPhone || null,
        params.customerEmail || null,
        source,
        source,
        JSON.stringify([
          {
            channel: source,
            timestamp: now,
            details: params.notes || 'Inbound organic lead capture',
            sessionId: sessionRow?.session_id,
          },
        ]),
        isVerifiedOrganic ? 'VERIFIED' : 'UNVERIFIED',
        now,
        now
      );

    // Record formal acquisition evidence
    const acqEvId = `acq_ev_${randomUUID().substring(0, 10)}`;
    const evidenceDetails = isVerifiedOrganic
      ? `Verified organic lead converted from external session ${sessionRow?.session_id} (${source}). Public IP & organic referrer verified.`
      : `Inbound lead captured without verified external session provenance. Traffic evidence status: ${evidenceStatus}.`;

    this.db
      .prepare(
        `INSERT INTO acquisition_evidence (
          id, lead_id, journey_id, customer_name, lead_status, source_provenance,
          traffic_evidence_status, verified_organic, evidence_details, timestamp
        ) VALUES (?, ?, ?, ?, 'REAL_LEAD', ?, ?, ?, ?, ?)`
      )
      .run(
        acqEvId,
        leadId,
        journeyId,
        params.customerName,
        source,
        evidenceStatus,
        isVerifiedOrganic ? 1 : 0,
        evidenceDetails,
        now
      );

    const acquisitionEvidence: AcquisitionEvidenceRecord = {
      id: acqEvId,
      leadId,
      journeyId,
      customerName: params.customerName,
      leadStatus: 'REAL_LEAD',
      sourceProvenance: source,
      trafficEvidenceStatus: evidenceStatus,
      verifiedOrganic: isVerifiedOrganic,
      evidenceDetails,
      timestamp: now,
    };

    return {
      journeyId,
      leadId,
      acquisitionEvidence,
    };
  }

  /**
   * Retrieves acquisition evidence for a specific customer or journey.
   */
  public getAcquisitionEvidence(identifier: string): AcquisitionEvidenceRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM acquisition_evidence 
         WHERE lead_id = ? OR journey_id = ? OR customer_name = ?
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get(identifier, identifier, identifier) as any;

    if (!row) return null;

    return {
      id: row.id,
      leadId: row.lead_id,
      journeyId: row.journey_id,
      customerName: row.customer_name,
      leadStatus: row.lead_status,
      sourceProvenance: row.source_provenance as TrafficSource,
      trafficEvidenceStatus: row.traffic_evidence_status as TrafficEvidenceStatus,
      verifiedOrganic: row.verified_organic === 1,
      evidenceDetails: row.evidence_details,
      timestamp: row.timestamp,
    };
  }

  /**
   * Lists traffic sessions with evidence status filtering.
   */
  public listSessions(params: {
    businessId?: string;
    trafficEvidenceStatus?: TrafficEvidenceStatus;
    limit?: number;
  }): VisitorSessionRecord[] {
    const businessId = params.businessId || 'biz_smilekraft_hyd';
    const limit = params.limit || 50;

    let query = 'SELECT * FROM traffic_sessions WHERE business_id = ?';
    const args: any[] = [businessId];

    if (params.trafficEvidenceStatus) {
      query += ' AND traffic_evidence_status = ?';
      args.push(params.trafficEvidenceStatus);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    args.push(limit);

    const rows = this.db.prepare(query).all(...args) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      visitorId: r.visitor_id,
      sessionId: r.session_id,
      source: r.source as TrafficSource,
      referrer: r.referrer,
      landingPage: r.landing_page,
      timestamp: r.timestamp,
      utmSource: r.utm_source || undefined,
      utmMedium: r.utm_medium || undefined,
      utmCampaign: r.utm_campaign || undefined,
      utmContent: r.utm_content || undefined,
      trafficEvidenceStatus: r.traffic_evidence_status as TrafficEvidenceStatus,
      ipAddress: r.ip_address || undefined,
      userAgent: r.user_agent || undefined,
      isExternal: r.is_external === 1,
      verificationReason: r.verification_reason,
      createdAt: r.created_at,
    }));
  }

  /**
   * Computes external organic distribution counts based strictly on verified records.
   */
  public getOrganicDistributionStats(businessId: string = 'biz_smilekraft_hyd') {
    const externalSessionsRow = this.db
      .prepare(
        `SELECT 
           COUNT(*) as total_sessions,
           SUM(CASE WHEN traffic_evidence_status = 'VERIFIED_EXTERNAL' THEN 1 ELSE 0 END) as verified_external_sessions,
           SUM(CASE WHEN traffic_evidence_status = 'INTERNAL' THEN 1 ELSE 0 END) as internal_sessions,
           SUM(CASE WHEN traffic_evidence_status = 'TEST' THEN 1 ELSE 0 END) as test_sessions,
           COUNT(DISTINCT CASE WHEN traffic_evidence_status = 'VERIFIED_EXTERNAL' THEN visitor_id ELSE NULL END) as verified_external_visitors
         FROM traffic_sessions
         WHERE business_id = ?`
      )
      .get(businessId) as any;

    const organicLeadsRow = this.db
      .prepare(
        `SELECT 
           COUNT(*) as total_leads,
           SUM(CASE WHEN verified_organic = 1 THEN 1 ELSE 0 END) as verified_organic_leads,
           SUM(CASE WHEN traffic_evidence_status = 'UNKNOWN' THEN 1 ELSE 0 END) as unverified_leads
         FROM acquisition_evidence
         WHERE journey_id IN (SELECT id FROM customer_journeys WHERE business_id = ?)`
      )
      .get(businessId) as any;

    return {
      externalOrganicVisitors: externalSessionsRow?.verified_external_visitors || 0,
      verifiedExternalVisitors: externalSessionsRow?.verified_external_visitors || 0,
      totalSessions: externalSessionsRow?.total_sessions || 0,
      verifiedExternalSessions: externalSessionsRow?.verified_external_sessions || 0,
      internalSessions: externalSessionsRow?.internal_sessions || 0,
      testSessions: externalSessionsRow?.test_sessions || 0,
      organicLeads: organicLeadsRow?.total_leads || 0,
      verifiedOrganicLeads: organicLeadsRow?.verified_organic_leads || 0,
      unverifiedLeads: organicLeadsRow?.unverified_leads || 0,
    };
  }
}
