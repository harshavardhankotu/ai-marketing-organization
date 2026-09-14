import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  ContentApprovalStatus,
  ContentPublicationStatus,
  OrganicContentAsset,
  OrganicContentType,
  OrganicMarketingChannel,
} from '@ai-marketing/shared';
import { OrganicChannelManager } from './organic-channel-manager.js';

export class OrganicContentEngine {
  private get db() {
    return getDb();
  }

  private channelManager = new OrganicChannelManager();

  /**
   * Drafts an organic content asset.
   * Enforces Medical Compliance Gate: Clinical claims require clinic doctor approval.
   */
  public createContentDraft(params: {
    businessId: string;
    channel: OrganicMarketingChannel;
    campaignId: string;
    contentType: OrganicContentType;
    title: string;
    body: string;
    callToAction: string;
    targetKeyword?: string;
    createdByAgent: string;
    hasMedicalClaim?: boolean;
    medicalClaimSource?: string;
    sourceEvidence?: string;
  }): OrganicContentAsset {
    const id = `cnt-${randomUUID()}`;
    const now = new Date().toISOString();

    // Auto-detect clinical assertions if not explicitly flagged
    const clinicalKeywords = ['straighten teeth', 'orthodontic', 'painless', 'months', 'cure', 'efficacy', 'treatment guarantee', 'teeth alignment'];
    const hasMedicalClaim =
      params.hasMedicalClaim ??
      clinicalKeywords.some((kw) => params.body.toLowerCase().includes(kw) || params.title.toLowerCase().includes(kw));

    // Medical compliance gate: Clinical claims cannot be auto-published
    const approvalStatus: ContentApprovalStatus = hasMedicalClaim
      ? 'PENDING_CLINIC_APPROVAL'
      : 'AI_DRAFT';

    const tracking = this.channelManager.generateOrganicUTM({
      channel: params.channel,
      campaign: params.campaignId,
      content: params.title.substring(0, 30),
      targetKeyword: params.targetKeyword,
    });

    this.db
      .prepare(
        `INSERT INTO organic_content (
          id, business_id, channel, campaign_id, content_type, title, body,
          call_to_action, target_keyword, tracking_params_json, created_by_agent,
          has_medical_claim, medical_claim_source, approval_status, publication_status,
          source_evidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.channel,
        params.campaignId,
        params.contentType,
        params.title,
        params.body,
        params.callToAction,
        params.targetKeyword || null,
        JSON.stringify(tracking),
        params.createdByAgent,
        hasMedicalClaim ? 1 : 0,
        params.medicalClaimSource || (hasMedicalClaim ? 'Clinic Clinical Guidelines' : null),
        approvalStatus,
        params.sourceEvidence || 'Zero-Budget Organic Inbound Experiment',
        now,
        now
      );

    return {
      id,
      businessId: params.businessId,
      channel: params.channel,
      campaignId: params.campaignId,
      contentType: params.contentType,
      title: params.title,
      body: params.body,
      callToAction: params.callToAction,
      targetKeyword: params.targetKeyword,
      trackingParams: tracking,
      createdByAgent: params.createdByAgent,
      hasMedicalClaim,
      medicalClaimSource: params.medicalClaimSource,
      approvalStatus,
      publicationStatus: 'DRAFT',
      sourceEvidence: params.sourceEvidence,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Clinic Approval Step: Approves and publishes an organic content asset.
   * Requires certified doctor / clinic owner authorization.
   */
  public approveContent(params: {
    contentId: string;
    approvedByUserId: string;
    publishImmediately?: boolean;
  }): OrganicContentAsset {
    const row = this.db
      .prepare('SELECT * FROM organic_content WHERE id = ?')
      .get(params.contentId) as any;

    if (!row) {
      throw new Error(`Organic content asset ${params.contentId} not found`);
    }

    // Verify approver is authorized OWNER / DOCTOR
    const user = this.db
      .prepare('SELECT id, role, name FROM users WHERE id = ?')
      .get(params.approvedByUserId) as any;

    if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
      throw new Error(
        `Unauthorized: Only an authenticated clinic OWNER or clinical lead can approve medical content. User '${params.approvedByUserId}' is not authorized.`
      );
    }

    const now = new Date().toISOString();
    const publicationStatus: ContentPublicationStatus = params.publishImmediately ? 'PUBLISHED' : 'SCHEDULED';
    const publishedAt = params.publishImmediately ? now : null;

    this.db
      .prepare(
        `UPDATE organic_content SET
           approval_status = 'APPROVED',
           clinic_approved_by = ?,
           approved_at = ?,
           publication_status = ?,
           published_at = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(user.name, now, publicationStatus, publishedAt, now, params.contentId);

    let trackingParams = { utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '' };
    try {
      trackingParams = JSON.parse(row.tracking_params_json);
    } catch {}

    return {
      id: row.id,
      businessId: row.business_id,
      channel: row.channel,
      campaignId: row.campaign_id,
      contentType: row.content_type,
      title: row.title,
      body: row.body,
      callToAction: row.call_to_action,
      targetKeyword: row.target_keyword,
      trackingParams,
      createdByAgent: row.created_by_agent,
      hasMedicalClaim: row.has_medical_claim === 1,
      medicalClaimSource: row.medical_claim_source,
      approvalStatus: 'APPROVED',
      publicationStatus,
      sourceEvidence: row.source_evidence,
      clinicApprovedBy: user.name,
      approvedAt: now,
      publishedAt: publishedAt || undefined,
      createdAt: row.created_at,
      updatedAt: now,
    };
  }

  /**
   * Retrieves all content assets for a business, optionally filtered by approval or channel.
   */
  public listContent(params: {
    businessId: string;
    channel?: OrganicMarketingChannel;
    approvalStatus?: ContentApprovalStatus;
  }): OrganicContentAsset[] {
    let query = 'SELECT * FROM organic_content WHERE business_id = ?';
    const args: any[] = [params.businessId];

    if (params.channel) {
      query += ' AND channel = ?';
      args.push(params.channel);
    }
    if (params.approvalStatus) {
      query += ' AND approval_status = ?';
      args.push(params.approvalStatus);
    }

    query += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all(...args) as any[];

    return rows.map((r) => {
      let trackingParams = { utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '' };
      try {
        trackingParams = JSON.parse(r.tracking_params_json);
      } catch {}

      return {
        id: r.id,
        businessId: r.business_id,
        channel: r.channel,
        campaignId: r.campaign_id,
        contentType: r.content_type,
        title: r.title,
        body: r.body,
        callToAction: r.call_to_action,
        targetKeyword: r.target_keyword,
        trackingParams,
        createdByAgent: r.created_by_agent,
        hasMedicalClaim: r.has_medical_claim === 1,
        medicalClaimSource: r.medical_claim_source,
        approvalStatus: r.approval_status,
        publicationStatus: r.publication_status,
        sourceEvidence: r.source_evidence,
        clinicApprovedBy: r.clinic_approved_by,
        approvedAt: r.approved_at,
        publishedAt: r.published_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }
}
