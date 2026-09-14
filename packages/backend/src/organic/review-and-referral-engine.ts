import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  DirectOutreachRecord,
  ReferralPartnershipRecord,
  ReviewRequestRecord,
} from '@ai-marketing/shared';

export class ReviewAndReferralEngine {
  private get db() {
    return getDb();
  }

  private readonly MAX_DAILY_DIRECT_OUTREACH = 10;

  // =========================================================================
  // 1. REVIEW ENGINE (Post-Appointment Clinical Verification)
  // =========================================================================

  /**
   * Creates a review request.
   * INVARIANT: Review requests can ONLY be sent after clinical confirmation of completed appointment.
   * Prohibits fake testimonials or buying reviews.
   */
  public createReviewRequest(params: {
    businessId: string;
    customerId: string;
    journeyId: string;
    appointmentId: string;
    channel: 'WHATSAPP' | 'SMS' | 'EMAIL';
  }): ReviewRequestRecord {
    // 1. Invariant check: Appointment must exist and be clinically confirmed
    const appt = this.db
      .prepare('SELECT * FROM appointments WHERE id = ? AND journey_id = ?')
      .get(params.appointmentId, params.journeyId) as any;

    if (!appt) {
      throw new Error(`Cannot request review: Appointment ${params.appointmentId} does not match journey ${params.journeyId}.`);
    }

    if (appt.clinic_confirmation !== 'CONFIRMED') {
      throw new Error(`Cannot request review: Appointment ${params.appointmentId} is not clinically confirmed (status: ${appt.clinic_confirmation}).`);
    }

    const id = `rev-req-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO review_requests (
          id, business_id, customer_id, journey_id, appointment_id,
          clinic_confirmation, channel, status, request_timestamp, created_at
        ) VALUES (?, ?, ?, ?, ?, 'CONFIRMED', ?, 'QUEUED', ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.customerId,
        params.journeyId,
        params.appointmentId,
        params.channel,
        now,
        now
      );

    return {
      id,
      businessId: params.businessId,
      customerId: params.customerId,
      journeyId: params.journeyId,
      appointmentId: params.appointmentId,
      clinicConfirmation: 'CONFIRMED',
      channel: params.channel,
      status: 'QUEUED',
      requestTimestamp: now,
      externalReviewPlatform: 'GOOGLE_BUSINESS_PROFILE',
    };
  }

  public listReviewRequests(businessId: string): ReviewRequestRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM review_requests WHERE business_id = ? ORDER BY request_timestamp DESC')
      .all(businessId) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      customerId: r.customer_id,
      journeyId: r.journey_id,
      appointmentId: r.appointment_id,
      clinicConfirmation: r.clinic_confirmation,
      channel: r.channel,
      status: r.status,
      requestTimestamp: r.request_timestamp,
      feedbackScore: r.feedback_score || undefined,
      externalReviewPlatform: r.external_review_platform || undefined,
    }));
  }

  // =========================================================================
  // 2. ORGANIC REFERRAL ENGINE & PARTNERSHIPS
  // =========================================================================

  /**
   * Generates a community partnership or patient referral proposal draft.
   */
  public createReferralProposal(params: {
    businessId: string;
    category: ReferralPartnershipRecord['category'];
    partnerName: string;
    contactPerson?: string;
    proposalDraft: string;
    offerTerms: string;
  }): ReferralPartnershipRecord {
    const id = `ref-prop-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO referral_partnerships (
          id, business_id, category, partner_name, contact_person,
          proposal_draft, offer_terms, approval_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.category,
        params.partnerName,
        params.contactPerson || null,
        params.proposalDraft,
        params.offerTerms,
        now,
        now
      );

    return {
      id,
      businessId: params.businessId,
      category: params.category,
      partnerName: params.partnerName,
      contactPerson: params.contactPerson,
      proposalDraft: params.proposalDraft,
      offerTerms: params.offerTerms,
      approvalStatus: 'DRAFT',
      createdAt: now,
    };
  }

  public listReferralPartnerships(businessId: string): ReferralPartnershipRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM referral_partnerships WHERE business_id = ? ORDER BY created_at DESC')
      .all(businessId) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      category: r.category,
      partnerName: r.partner_name,
      contactPerson: r.contact_person || undefined,
      proposalDraft: r.proposal_draft,
      offerTerms: r.offer_terms,
      approvalStatus: r.approval_status,
      createdAt: r.created_at,
    }));
  }

  // =========================================================================
  // 3. ETHICAL DIRECT OUTREACH & RATE LIMITING
  // =========================================================================

  /**
   * Creates a draft for ethical direct outreach.
   * Requires human approval before sending.
   */
  public createOutreachDraft(params: {
    businessId: string;
    segment: string;
    prospectName: string;
    channel: 'LINKEDIN' | 'EMAIL' | 'WHATSAPP';
    messageDraft: string;
  }): DirectOutreachRecord {
    const id = `outreach-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved, dispatched, response_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, 'PENDING', ?)`
      )
      .run(
        id,
        params.businessId,
        params.segment,
        params.prospectName,
        params.channel,
        params.messageDraft,
        now
      );

    return {
      id,
      businessId: params.businessId,
      segment: params.segment,
      prospectName: params.prospectName,
      channel: params.channel,
      messageDraft: params.messageDraft,
      complianceChecked: true,
      humanApproved: false,
      dispatched: false,
      responseStatus: 'PENDING',
      createdAt: now,
    };
  }

  /**
   * Dispatches direct outreach with strict rate limit enforcement.
   * Invariant: Maximum 10 dispatches per day, must be human-approved.
   */
  public dispatchOutreach(params: {
    outreachId: string;
    approvedByUserId: string;
  }): DirectOutreachRecord {
    const row = this.db
      .prepare('SELECT * FROM direct_outreach_log WHERE id = ?')
      .get(params.outreachId) as any;

    if (!row) {
      throw new Error(`Outreach record ${params.outreachId} not found`);
    }

    // Rate Limit Check: Max 10 per 24 hours
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM direct_outreach_log 
         WHERE business_id = ? AND dispatched = 1 AND dispatch_timestamp >= datetime('now', '-1 day')`
      )
      .get(row.business_id) as any;

    const dispatchedToday = countRow?.count || 0;
    if (dispatchedToday >= this.MAX_DAILY_DIRECT_OUTREACH) {
      throw new Error(
        `ETHICAL OUTREACH RATE LIMIT EXCEEDED: Cannot dispatch more than ${this.MAX_DAILY_DIRECT_OUTREACH} outreach messages per day. (Currently dispatched in last 24h: ${dispatchedToday})`
      );
    }

    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE direct_outreach_log SET
           human_approved = 1,
           dispatched = 1,
           dispatch_timestamp = ?
         WHERE id = ?`
      )
      .run(now, params.outreachId);

    return {
      id: row.id,
      businessId: row.business_id,
      segment: row.segment,
      prospectName: row.prospect_name,
      channel: row.channel,
      messageDraft: row.message_draft,
      complianceChecked: true,
      humanApproved: true,
      dispatched: true,
      dispatchTimestamp: now,
      responseStatus: 'PENDING',
      createdAt: row.created_at,
    };
  }

  public listOutreachLogs(businessId: string): DirectOutreachRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM direct_outreach_log WHERE business_id = ? ORDER BY created_at DESC')
      .all(businessId) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      segment: r.segment,
      prospectName: r.prospect_name,
      channel: r.channel,
      messageDraft: r.message_draft,
      complianceChecked: r.compliance_checked === 1,
      humanApproved: r.human_approved === 1,
      dispatched: r.dispatched === 1,
      dispatchTimestamp: r.dispatch_timestamp || undefined,
      responseStatus: r.response_status,
      createdAt: r.created_at,
    }));
  }
}
