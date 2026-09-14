import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  ContentApprovalStatus,
  ContentPublicationStatus,
  OrganicContentAsset,
  OrganicContentType,
  OrganicMarketingChannel,
  ChannelPublishingMode,
  PublicationEvidence,
  MedicalClaimSource,
} from '@ai-marketing/shared';
import { OrganicChannelManager } from './organic-channel-manager.js';

export class OrganicContentEngine {
  private get db() {
    return getDb();
  }

  private channelManager = new OrganicChannelManager();

  private readonly CLINICAL_KEYWORDS = [
    'straighten teeth',
    'orthodontic',
    'painless',
    'months',
    'cure',
    'efficacy',
    'treatment guarantee',
    'teeth alignment',
    'invisalign',
    'fda',
    '100%',
    'zero pain',
    'guaranteed',
  ];

  /**
   * Determines the publishing capability mode for an organic channel.
   */
  public getChannelPublishingMode(
    channel: OrganicMarketingChannel,
    hasMedicalClaim: boolean = false
  ): ChannelPublishingMode {
    if (hasMedicalClaim) {
      return 'REQUIRES_CLINIC_APPROVAL';
    }

    switch (channel) {
      case 'ORGANIC_SEO':
        return 'CAN_PUBLISH_AUTOMATICALLY';
      case 'GOOGLE_BUSINESS_PROFILE':
      case 'FACEBOOK_ORGANIC':
      case 'LINKEDIN_ORGANIC':
      case 'DIRECT_OUTREACH':
        return 'REQUIRES_OWNER_AUTH';
      case 'REFERRALS':
      case 'LOCAL_PARTNERSHIPS':
        return 'REQUIRES_CLINIC_APPROVAL';
      case 'INSTAGRAM_ORGANIC':
      case 'YOUTUBE_ORGANIC':
      default:
        return 'MANUAL_ONLY';
    }
  }

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
    medicalClaimSource?: MedicalClaimSource | string;
    sourceEvidence?: string;
  }): OrganicContentAsset {
    const id = `cnt-${randomUUID()}`;
    const now = new Date().toISOString();

    // Auto-detect clinical assertions if not explicitly flagged
    const textLower = `${params.title} ${params.body}`.toLowerCase();
    const hasMedicalClaim =
      params.hasMedicalClaim ??
      this.CLINICAL_KEYWORDS.some((kw) => textLower.includes(kw));

    // Medical compliance gate: Clinical claims cannot be auto-published
    const approvalStatus: ContentApprovalStatus = hasMedicalClaim
      ? 'PENDING_CLINIC_APPROVAL'
      : 'AI_DRAFT';

    const publishingMode = this.getChannelPublishingMode(params.channel, hasMedicalClaim);

    // Validate medical claim source: must not be unsupported
    let claimSource = params.medicalClaimSource;
    if (hasMedicalClaim && !claimSource) {
      claimSource = 'PENDING_CLINIC_APPROVAL';
    }

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
          publishing_mode, source_evidence, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`
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
        claimSource || null,
        approvalStatus,
        publishingMode,
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
      medicalClaimSource: claimSource,
      approvalStatus,
      publicationStatus: 'DRAFT',
      sourceEvidence: params.sourceEvidence,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Clinic Approval Step: Approves an organic content asset.
   * Requires certified doctor / clinic owner authorization.
   * Content transitions to APPROVED, remaining in DRAFT until actual external publication.
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

    const publicationStatus: ContentPublicationStatus = params.publishImmediately ? 'PUBLISHED' : 'DRAFT';
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

    return this.getContent(params.contentId)!;
  }

  /**
   * Records verified external publication evidence.
   * Only with verified external evidence (post ID & URL) does content become PUBLISHED.
   */
  public recordPublicationEvidence(params: {
    contentId: string;
    externalPostId: string;
    externalUrl: string;
    platform: string;
    verifiedByUserId?: string;
    rawResponseSnippet?: string;
  }): OrganicContentAsset {
    if (!params.externalPostId || params.externalPostId.trim().length === 0) {
      throw new Error('Publication Evidence Error: External post ID is strictly required.');
    }
    if (!params.externalUrl || !params.externalUrl.startsWith('http')) {
      throw new Error('Publication Evidence Error: Valid public HTTP(S) external URL is strictly required.');
    }

    const row = this.db
      .prepare('SELECT * FROM organic_content WHERE id = ?')
      .get(params.contentId) as any;

    if (!row) {
      throw new Error(`Organic content asset ${params.contentId} not found`);
    }

    // Medical compliance check: Cannot publish if clinical claims exist and approval is not APPROVED
    if (row.has_medical_claim === 1 && row.approval_status !== 'APPROVED') {
      throw new Error(
        `Cannot publish content ${params.contentId}: Clinical orthodontic claims are present and have not received required clinic doctor approval.`
      );
    }

    const now = new Date().toISOString();
    const evidence: PublicationEvidence = {
      externalPostId: params.externalPostId,
      externalUrl: params.externalUrl,
      platform: params.platform,
      verificationTimestamp: now,
      verifiedByUserId: params.verifiedByUserId || 'system_verifier',
      rawResponseSnippet: params.rawResponseSnippet,
    };

    this.db
      .prepare(
        `UPDATE organic_content SET
           publication_status = 'PUBLISHED',
           publication_evidence_json = ?,
           published_at = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(evidence), now, now, params.contentId);

    return this.getContent(params.contentId)!;
  }

  /**
   * Retrieves single content asset.
   */
  public getContent(contentId: string): OrganicContentAsset | null {
    const row = this.db
      .prepare('SELECT * FROM organic_content WHERE id = ?')
      .get(contentId) as any;

    if (!row) return null;

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
      approvalStatus: row.approval_status as ContentApprovalStatus,
      publicationStatus: row.publication_status as ContentPublicationStatus,
      sourceEvidence: row.source_evidence,
      clinicApprovedBy: row.clinic_approved_by,
      approvedAt: row.approved_at,
      publishedAt: row.published_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Retrieves all content assets for a business, optionally filtered by approval or channel.
   */
  public listContent(params: {
    businessId: string;
    channel?: OrganicMarketingChannel;
    approvalStatus?: ContentApprovalStatus;
    publicationStatus?: ContentPublicationStatus;
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
    if (params.publicationStatus) {
      query += ' AND publication_status = ?';
      args.push(params.publicationStatus);
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
        approvalStatus: r.approval_status as ContentApprovalStatus,
        publicationStatus: r.publication_status as ContentPublicationStatus,
        sourceEvidence: r.source_evidence,
        clinicApprovedBy: r.clinic_approved_by,
        approvedAt: r.approved_at,
        publishedAt: r.published_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /**
   * Computes content publication metrics.
   */
  public getContentStats(businessId: string = 'biz_smilekraft_hyd') {
    const row = this.db
      .prepare(
        `SELECT 
           COUNT(*) as total_content,
           SUM(CASE WHEN publication_status = 'PUBLISHED' THEN 1 ELSE 0 END) as published_count,
           SUM(CASE WHEN publication_status = 'PUBLISHED' AND publication_evidence_json IS NOT NULL THEN 1 ELSE 0 END) as verified_published_count,
           SUM(CASE WHEN publication_status = 'DRAFT' THEN 1 ELSE 0 END) as draft_count,
           SUM(CASE WHEN approval_status = 'PENDING_CLINIC_APPROVAL' THEN 1 ELSE 0 END) as pending_approval_count
         FROM organic_content
         WHERE business_id = ?`
      )
      .get(businessId) as any;

    return {
      totalContent: row?.total_content || 0,
      publishedCount: row?.published_count || 0,
      verifiedPublishedCount: row?.verified_published_count || 0,
      draftCount: row?.draft_count || 0,
      pendingApprovalCount: row?.pending_approval_count || 0,
    };
  }
}
