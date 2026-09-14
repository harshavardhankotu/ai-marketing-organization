import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  DataClassification,
  ImmutableTruthEvent,
  ImmutableTruthEventType,
  PaymentGateway,
  PaymentMethod,
  RevenueReconciliationSummary,
  RevenueTruthSummary,
  TransactionRecord,
  TreatmentPlanRecord,
} from '@ai-marketing/shared';
import { CustomerJourneyTracker } from './customer-journey-tracker.js';

export class RevenueReconciliationEngine {
  private get db() {
    return getDb();
  }
  private journeyTracker = new CustomerJourneyTracker();

  /**
   * Event Sourcing: Records an immutable truth event to the audit event stream.
   */
  public recordImmutableTruthEvent(params: {
    businessId: string;
    eventType: ImmutableTruthEventType;
    journeyId?: string;
    entityId: string;
    entityType: string;
    actorId: string;
    actorType: 'AGENT' | 'CLINIC' | 'PATIENT' | 'SYSTEM' | 'EXTERNAL_GATEWAY';
    payload: Record<string, unknown>;
  }): ImmutableTruthEvent {
    const id = `ite-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO immutable_truth_events (
          id, business_id, event_type, journey_id, entity_id, entity_type,
          actor_id, actor_type, payload_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.eventType,
        params.journeyId || null,
        params.entityId,
        params.entityType,
        params.actorId,
        params.actorType,
        JSON.stringify(params.payload),
        now
      );

    return {
      id,
      businessId: params.businessId,
      eventType: params.eventType,
      journeyId: params.journeyId,
      entityId: params.entityId,
      entityType: params.entityType,
      actorId: params.actorId,
      actorType: params.actorType,
      payload: params.payload,
      timestamp: now,
    };
  }

  /**
   * Lists immutable truth events for a business or specific journey.
   */
  public listImmutableTruthEvents(businessId: string, journeyId?: string): ImmutableTruthEvent[] {
    let rows: any[];
    if (journeyId) {
      rows = this.db
        .prepare(
          'SELECT * FROM immutable_truth_events WHERE business_id = ? AND journey_id = ? ORDER BY timestamp ASC'
        )
        .all(businessId, journeyId);
    } else {
      rows = this.db
        .prepare('SELECT * FROM immutable_truth_events WHERE business_id = ? ORDER BY timestamp ASC')
        .all(businessId);
    }

    return rows.map((r) => {
      let payload = {};
      try {
        payload = JSON.parse(r.payload_json);
      } catch {}
      return {
        id: r.id,
        businessId: r.business_id,
        eventType: r.event_type as ImmutableTruthEventType,
        journeyId: r.journey_id || undefined,
        entityId: r.entity_id,
        entityType: r.entity_type,
        actorId: r.actor_id,
        actorType: r.actor_type as any,
        payload,
        timestamp: r.timestamp,
      };
    });
  }

  /**
   * Records a treatment plan quote.
   * INVARIANT 2: A treatment plan quote is strictly NOT revenue and does not create a ledger transaction.
   */
  public recordTreatmentPlan(params: {
    businessId: string;
    journeyId: string;
    service: string;
    quotedAmountINR: number;
    doctorNotes: string;
    acceptedTreatmentAmountINR?: number;
    depositAmountINR?: number;
    paidAmountINR?: number;
    clinicConfirmation?: 'CONFIRMED' | 'PENDING' | 'REJECTED';
    confirmationSource?: string;
    status?: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED';
    treatmentPlanReference?: string;
  }): TreatmentPlanRecord {
    if (params.quotedAmountINR <= 0) {
      throw new Error('Treatment plan quote must be greater than zero.');
    }

    const id = `tp-${randomUUID()}`;
    const now = new Date().toISOString();
    const acceptedAmount = params.acceptedTreatmentAmountINR ?? params.quotedAmountINR;
    const depositAmount = params.depositAmountINR ?? 0;
    const paidAmount = params.paidAmountINR ?? 0;
    const outstanding = Math.max(0, acceptedAmount - (depositAmount + paidAmount));
    const confirmation = params.clinicConfirmation || 'PENDING';
    const status = params.status || 'PROPOSED';
    const source = params.confirmationSource || 'MANUAL';
    const ref = params.treatmentPlanReference || `TP-REF-${Math.floor(100000 + Math.random() * 900000)}`;

    this.db
      .prepare(
        `INSERT INTO treatment_plans (
          id, business_id, journey_id, service, quoted_amount_inr,
          accepted_treatment_amount_inr, deposit_amount_inr, paid_amount_inr,
          outstanding_amount_inr, doctor_notes, clinic_confirmation,
          confirmation_source, confirmation_timestamp, status,
          treatment_plan_reference, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.journeyId,
        params.service,
        params.quotedAmountINR,
        acceptedAmount,
        depositAmount,
        paidAmount,
        outstanding,
        params.doctorNotes,
        confirmation,
        source,
        now,
        status,
        ref,
        now,
        now
      );

    // Emit immutable truth event
    this.recordImmutableTruthEvent({
      businessId: params.businessId,
      eventType: status === 'ACCEPTED' ? 'TREATMENT_ACCEPTED' : 'TREATMENT_QUOTED',
      journeyId: params.journeyId,
      entityId: id,
      entityType: 'TREATMENT_PLAN',
      actorId: 'clinic_doctor',
      actorType: 'CLINIC',
      payload: {
        service: params.service,
        quotedAmountINR: params.quotedAmountINR,
        acceptedAmountINR: acceptedAmount,
        outstandingAmountINR: outstanding,
        status,
        clinicConfirmation: confirmation,
      },
    });

    return {
      id,
      businessId: params.businessId,
      journeyId: params.journeyId,
      service: params.service,
      quotedAmountINR: params.quotedAmountINR,
      acceptedTreatmentAmountINR: acceptedAmount,
      depositAmountINR: depositAmount,
      paidAmountINR: paidAmount,
      outstandingAmountINR: outstanding,
      doctorNotes: params.doctorNotes,
      clinicConfirmation: confirmation,
      confirmationSource: source,
      confirmationTimestamp: now,
      status,
      treatmentPlanReference: ref,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Retrieves treatment plans for a journey.
   */
  public getTreatmentPlans(journeyId: string): TreatmentPlanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM treatment_plans WHERE journey_id = ? ORDER BY created_at DESC')
      .all(journeyId) as any[];

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      journeyId: r.journey_id,
      service: r.service,
      quotedAmountINR: r.quoted_amount_inr,
      acceptedTreatmentAmountINR: r.accepted_treatment_amount_inr,
      depositAmountINR: r.deposit_amount_inr,
      paidAmountINR: r.paid_amount_inr,
      outstandingAmountINR: r.outstanding_amount_inr,
      doctorNotes: r.doctor_notes,
      clinicConfirmation: r.clinic_confirmation,
      confirmationSource: r.confirmation_source,
      confirmationTimestamp: r.confirmation_timestamp,
      status: r.status,
      treatmentPlanReference: r.treatment_plan_reference,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Records verified deposit or treatment payment linked to a treatment plan.
   * INVARIANT 1: Consultation cannot become customer without treatment acceptance.
   * INVARIANT 3: Quoted amount cannot become paid amount (deposit ₹20,000 -> revenue ₹20,000, outstanding ₹130,000).
   * INVARIANT 4: External evidence (gateway ref or bank UTR) is strictly required.
   */
  public recordTreatmentPayment(params: {
    businessId: string;
    organizationId?: string;
    journeyId: string;
    treatmentPlanId: string;
    amountINR: number;
    paymentMethod: PaymentMethod;
    paymentGateway?: PaymentGateway;
    transactionRef: string;
    invoiceNumber: string;
    verificationSource: string;
    verifiedByUserId: string;
    serviceRendered?: string;
  }): { transaction: TransactionRecord; treatmentPlan: TreatmentPlanRecord } {
    // 1. Invariant 4: Require external payment evidence
    if (!params.transactionRef || params.transactionRef.length < 6) {
      throw new Error('External payment evidence (valid gateway transaction ID or bank UTR) is required.');
    }

    // 2. Fetch Treatment Plan
    const tplan = this.db
      .prepare('SELECT * FROM treatment_plans WHERE id = ? AND journey_id = ?')
      .get(params.treatmentPlanId, params.journeyId) as any;

    if (!tplan) {
      throw new Error(`Treatment plan ${params.treatmentPlanId} not found for journey ${params.journeyId}`);
    }

    // 3. Invariant 1: Consultation cannot become customer without treatment acceptance
    if (tplan.clinic_confirmation !== 'CONFIRMED' || (tplan.status !== 'ACCEPTED' && tplan.status !== 'IN_PROGRESS')) {
      throw new Error('Cannot convert consultation to customer: treatment plan has not been accepted and confirmed by clinic.');
    }

    // 4. Record the verified revenue transaction for the actual paid amount (NOT the quote!)
    const tx = this.recordVerifiedManualRevenue({
      businessId: params.businessId,
      organizationId: params.organizationId,
      journeyId: params.journeyId,
      invoiceNumber: params.invoiceNumber,
      amountINR: params.amountINR,
      paymentMethod: params.paymentMethod,
      transactionRef: params.transactionRef,
      verificationSource: params.verificationSource,
      verifiedByUserId: params.verifiedByUserId,
      serviceRendered: params.serviceRendered || tplan.service,
    });

    // 5. Update Treatment Plan Balances
    const newPaid = tplan.paid_amount_inr + params.amountINR;
    const newDeposit = tplan.deposit_amount_inr + params.amountINR;
    const newOutstanding = Math.max(0, tplan.accepted_treatment_amount_inr - newPaid);
    const newStatus = newOutstanding === 0 ? 'COMPLETED' : 'IN_PROGRESS';
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE treatment_plans SET
           deposit_amount_inr = ?,
           paid_amount_inr = ?,
           outstanding_amount_inr = ?,
           status = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(newDeposit, newPaid, newOutstanding, newStatus, now, params.treatmentPlanId);

    // 6. Elevate journey stage to CUSTOMER upon verified payment
    this.db
      .prepare(
        "UPDATE customer_journeys SET stage = 'CUSTOMER', updated_at = datetime('now') WHERE id = ?"
      )
      .run(params.journeyId);

    // 7. Emit immutable truth events
    this.recordImmutableTruthEvent({
      businessId: params.businessId,
      eventType: 'PAYMENT_RECEIVED',
      journeyId: params.journeyId,
      entityId: tx.id,
      entityType: 'TRANSACTION',
      actorId: params.verifiedByUserId,
      actorType: 'CLINIC',
      payload: {
        invoiceNumber: params.invoiceNumber,
        amountPaidINR: params.amountINR,
        paymentMethod: params.paymentMethod,
        transactionRef: params.transactionRef,
      },
    });

    this.recordImmutableTruthEvent({
      businessId: params.businessId,
      eventType: 'PAYMENT_VERIFIED',
      journeyId: params.journeyId,
      entityId: tx.id,
      entityType: 'TRANSACTION',
      actorId: params.verifiedByUserId,
      actorType: 'CLINIC',
      payload: {
        verificationSource: params.verificationSource,
        outstandingAmountINR: newOutstanding,
        treatmentStatus: newStatus,
      },
    });

    const updatedPlan: TreatmentPlanRecord = {
      id: tplan.id,
      businessId: tplan.business_id,
      journeyId: tplan.journey_id,
      service: tplan.service,
      quotedAmountINR: tplan.quoted_amount_inr,
      acceptedTreatmentAmountINR: tplan.accepted_treatment_amount_inr,
      depositAmountINR: newDeposit,
      paidAmountINR: newPaid,
      outstandingAmountINR: newOutstanding,
      doctorNotes: tplan.doctor_notes,
      clinicConfirmation: tplan.clinic_confirmation,
      confirmationSource: tplan.confirmation_source,
      confirmationTimestamp: tplan.confirmation_timestamp,
      status: newStatus,
      treatmentPlanReference: tplan.treatment_plan_reference,
      createdAt: tplan.created_at,
      updatedAt: now,
    };

    return { transaction: tx, treatmentPlan: updatedPlan };
  }

  recordTransaction(params: {
    businessId: string;
    organizationId?: string;
    journeyId?: string;
    campaignId?: string;
    invoiceNumber: string;
    amountINR: number;
    paymentMethod: PaymentMethod;
    paymentGateway?: PaymentGateway;
    transactionRef?: string;
    status?: 'SUCCESS' | 'PENDING' | 'REFUNDED' | 'FAILED';
    classification?: DataClassification;
    serviceRendered?: string;
  }): TransactionRecord {
    // 1. Strict Duplicate Prevention (Requirement 27)
    const existingInv = this.db
      .prepare('SELECT id FROM transactions WHERE business_id = ? AND invoice_number = ?')
      .get(params.businessId, params.invoiceNumber) as any;

    if (existingInv) {
      throw new Error(`Duplicate transaction: Invoice ${params.invoiceNumber} already exists`);
    }

    if (params.transactionRef) {
      const existingRef = this.db
        .prepare('SELECT id FROM transactions WHERE business_id = ? AND transaction_ref = ?')
        .get(params.businessId, params.transactionRef) as any;
      if (existingRef) {
        throw new Error(`Duplicate transaction: Reference ${params.transactionRef} already recorded`);
      }
    }

    const id = `tx-${randomUUID()}`;
    const now = new Date().toISOString();
    const orgId = params.organizationId || 'org_smilekraft_01';
    const status = params.status || 'SUCCESS';
    const classification = params.classification || 'TEST';
    const gateway = params.paymentGateway || (classification === 'REAL' ? 'MANUAL' : 'SIMULATED');

    // Strict REAL vs SIMULATED distinction: REAL revenue must never use SIMULATED gateway
    if (classification === 'REAL' && (gateway === 'SIMULATED' || params.paymentGateway === 'SIMULATED')) {
      throw new Error('Cannot record REAL revenue using a SIMULATED payment gateway. REAL revenue must come from verified sources or production gateways.');
    }

    this.db
      .prepare(
        `INSERT INTO transactions (
          id, organization_id, business_id, journey_id, campaign_id,
          invoice_number, amount_inr, payment_method, payment_gateway,
          transaction_ref, status, classification, service_rendered, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        orgId,
        params.businessId,
        params.journeyId || null,
        params.campaignId || null,
        params.invoiceNumber,
        params.amountINR,
        params.paymentMethod,
        gateway,
        params.transactionRef || null,
        status,
        classification,
        params.serviceRendered || null,
        now
      );

    // If successful transaction linked to a journey, update journey lifetime value and stage
    if (status === 'SUCCESS' && params.journeyId) {
      this.journeyTracker.addRevenue(params.journeyId, params.amountINR);
    }

    // Ingest into analytics events for full attribution tracing
    if (status === 'SUCCESS') {
      const eventId = `event-rev-${randomUUID()}`;
      this.db
        .prepare(
          `INSERT INTO analytics_events (
            id, organization_id, business_id, campaign_id,
            channel, event_type, user_identifier, revenue_inr, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          eventId,
          orgId,
          params.businessId,
          params.campaignId || null,
          params.paymentMethod === 'UPI' ? 'WHATSAPP' : 'META_ADS',
          'revenue',
          params.journeyId || null,
          params.amountINR,
          JSON.stringify({
            invoiceNumber: params.invoiceNumber,
            serviceRendered: params.serviceRendered,
            classification,
          }),
          now
        );
    }

    return {
      id,
      organizationId: orgId,
      businessId: params.businessId,
      journeyId: params.journeyId,
      campaignId: params.campaignId,
      invoiceNumber: params.invoiceNumber,
      amountINR: params.amountINR,
      paymentMethod: params.paymentMethod,
      paymentGateway: gateway,
      transactionRef: params.transactionRef,
      status,
      classification,
      serviceRendered: params.serviceRendered,
      createdAt: now,
    };
  }

  recordVerifiedManualRevenue(params: {
    businessId: string;
    organizationId?: string;
    verifiedByUserId: string;
    invoiceNumber: string;
    amountINR: number;
    paymentMethod: PaymentMethod;
    transactionRef: string;
    verificationSource: 'BANK_STATEMENT' | 'RAZORPAY_PORTAL' | 'CLINIC_POS_RECEIPT' | 'CASHFREE' | 'OTHER' | string;
    journeyId?: string;
    campaignId?: string;
    serviceRendered?: string;
  }): TransactionRecord {
    const orgId = params.organizationId || 'org_smilekraft_01';
    const service = params.serviceRendered || 'Verified In-Clinic Treatment';

    // 1. Single Trusted Authority Enforcement: Caller must be authenticated clinic OWNER
    const user = this.db
      .prepare('SELECT id, role, organization_id FROM users WHERE id = ?')
      .get(params.verifiedByUserId) as any;

    if (!user || user.role !== 'OWNER') {
      throw new Error(
        `Unauthorized: Only an authenticated clinic OWNER can certify REAL revenue. User '${params.verifiedByUserId}' is not an OWNER.`
      );
    }

    // 2. Audit Evidence Requirement
    if (!params.verificationSource || !params.transactionRef) {
      throw new Error('External verificationSource and transactionRef are required to certify REAL revenue.');
    }

    // 3. Prevent cross-contamination: REAL revenue can NEVER attach to a TEST or SIMULATED journey
    if (params.journeyId) {
      const journey = this.db
        .prepare('SELECT id, classification FROM customer_journeys WHERE id = ?')
        .get(params.journeyId) as any;
      if (!journey) {
        throw new Error(`Customer journey ${params.journeyId} not found`);
      }
      if (journey.classification !== 'REAL') {
        throw new Error(
          `Cannot record REAL revenue against a ${journey.classification} customer journey. Real clinic revenue must attach only to REAL patient journeys.`
        );
      }
    }

    const tx = this.recordTransaction({
      businessId: params.businessId,
      organizationId: orgId,
      journeyId: params.journeyId,
      campaignId: params.campaignId,
      invoiceNumber: params.invoiceNumber,
      amountINR: params.amountINR,
      paymentMethod: params.paymentMethod,
      paymentGateway: 'MANUAL',
      transactionRef: params.transactionRef,
      status: 'SUCCESS',
      classification: 'REAL',
      serviceRendered: service,
    });

    // Record formal audit trail
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, organization_id, actor_id, actor_type, action, entity_type, entity_id, details_json)
         VALUES (?, ?, ?, 'USER', 'VERIFIED_REVENUE_ENTRY', 'TRANSACTION', ?, ?)`
      )
      .run(
        `audit-${randomUUID()}`,
        orgId,
        params.verifiedByUserId,
        tx.id,
        JSON.stringify({
          invoiceNumber: params.invoiceNumber,
          amountINR: params.amountINR,
          verificationSource: params.verificationSource,
          transactionRef: params.transactionRef,
        })
      );

    return tx;
  }

  refundTransaction(businessId: string, transactionId: string, reason: string): TransactionRecord {
    const tx = this.db
      .prepare('SELECT * FROM transactions WHERE id = ? AND business_id = ?')
      .get(transactionId, businessId) as any;

    if (!tx) throw new Error('Transaction not found');
    if (tx.status === 'REFUNDED') throw new Error('Transaction is already refunded');

    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE transactions SET status = 'REFUNDED' WHERE id = ?`)
      .run(transactionId);

    if (tx.journey_id) {
      this.journeyTracker.subtractRevenue(tx.journey_id, tx.amount_inr);
    }

    // Log refund event
    const eventId = `event-ref-${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO analytics_events (
          id, organization_id, business_id, campaign_id,
          channel, event_type, user_identifier, revenue_inr, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        tx.organization_id,
        businessId,
        tx.campaign_id,
        tx.payment_method === 'UPI' ? 'WHATSAPP' : 'META_ADS',
        'refund',
        tx.journey_id || null,
        -tx.amount_inr,
        JSON.stringify({ reason, originalInvoice: tx.invoice_number }),
        now
      );

    return {
      id: tx.id,
      organizationId: tx.organization_id,
      businessId: tx.business_id,
      journeyId: tx.journey_id || undefined,
      campaignId: tx.campaign_id || undefined,
      invoiceNumber: tx.invoice_number,
      amountINR: tx.amount_inr,
      paymentMethod: tx.payment_method,
      paymentGateway: tx.payment_gateway,
      transactionRef: tx.transaction_ref || undefined,
      status: 'REFUNDED',
      classification: tx.classification,
      serviceRendered: tx.service_rendered || undefined,
      createdAt: tx.created_at,
    };
  }

  getRevenueSummary(businessId: string): RevenueTruthSummary {
    // 1. Separate Real, Test, and Simulated Revenue (Only status = 'SUCCESS')
    const revRows = this.db
      .prepare(
        `SELECT classification, SUM(amount_inr) as total_rev
         FROM transactions
         WHERE business_id = ? AND status = 'SUCCESS'
         GROUP BY classification`
      )
      .all(businessId) as Array<{ classification: DataClassification; total_rev: number }>;

    let realRevenueRecordedINR = 0;
    let testRevenueINR = 0;
    let simulatedRevenueINR = 0;

    for (const r of revRows) {
      if (r.classification === 'REAL') realRevenueRecordedINR = r.total_rev;
      else if (r.classification === 'TEST') testRevenueINR = r.total_rev;
      else if (r.classification === 'SIMULATED') simulatedRevenueINR = r.total_rev;
    }

    // 2. Independently verified real revenue (from external payment gateways or audited owner entries)
    const verifiedManualRows = this.db
      .prepare(
        `SELECT SUM(t.amount_inr) as verified_rev
         FROM transactions t
         JOIN audit_logs a ON a.entity_id = t.id AND a.action = 'VERIFIED_REVENUE_ENTRY'
         WHERE t.business_id = ? AND t.status = 'SUCCESS' AND t.classification = 'REAL'`
      )
      .get(businessId) as any;
    const verifiedGatewayRows = this.db
      .prepare(
        `SELECT SUM(amount_inr) as gateway_rev
         FROM transactions
         WHERE business_id = ? AND status = 'SUCCESS' AND classification = 'REAL' 
           AND payment_gateway NOT IN ('SIMULATED', 'MANUAL')`
      )
      .get(businessId) as any;
    const realRevenueIndependentlyVerifiedINR =
      (verifiedManualRows?.verified_rev || 0) + (verifiedGatewayRows?.gateway_rev || 0);

    // 3. Marketing-Attributed REAL Revenue:
    // Strictly requires verified Google click evidence (attribution_status = 'VERIFIED') if linked to a journey,
    // or an explicitly assigned campaign if a direct campaign conversion.
    // Unverified journeys (such as Suresh Reddy) are strictly excluded and categorized as unattributedRealRevenueINR.
    const attributedRealRev = this.db
      .prepare(
        `SELECT SUM(t.amount_inr) as attributed_rev
         FROM transactions t
         LEFT JOIN customer_journeys j ON t.journey_id = j.id
         WHERE t.business_id = ? 
           AND t.status = 'SUCCESS' 
           AND t.classification = 'REAL'
           AND (
             (t.journey_id IS NOT NULL AND j.attribution_status = 'VERIFIED')
             OR (t.journey_id IS NULL AND t.campaign_id IS NOT NULL)
           )`
      )
      .get(businessId) as any;
    const realMarketingAttributedRevenueINR = attributedRealRev?.attributed_rev || 0;
    const unattributedRealRevenueINR = Math.max(0, realRevenueRecordedINR - realMarketingAttributedRevenueINR);

    // 4. Transaction counts (All SUCCESS transactions)
    const txStats = this.db
      .prepare(
        `SELECT 
           COUNT(*) as total,
           SUM(CASE WHEN (t.journey_id IS NOT NULL AND j.attribution_status = 'VERIFIED') OR (t.journey_id IS NULL AND t.campaign_id IS NOT NULL) THEN 1 ELSE 0 END) as attributed,
           SUM(CASE WHEN (t.journey_id IS NOT NULL AND (j.attribution_status != 'VERIFIED' OR j.attribution_status IS NULL)) OR (t.journey_id IS NULL AND t.campaign_id IS NULL) THEN 1 ELSE 0 END) as unattributed
         FROM transactions t
         LEFT JOIN customer_journeys j ON t.journey_id = j.id
         WHERE t.business_id = ? AND t.status = 'SUCCESS'`
      )
      .get(businessId) as any;

    const totalTransactions = txStats?.total || 0;
    const attributedTransactions = txStats?.attributed || 0;
    const unattributedTransactions = txStats?.unattributed || 0;

    // 5. Total ad spend from campaigns
    const campaignSpend = this.db
      .prepare(`SELECT SUM(spent_inr) as total_spent FROM campaigns WHERE business_id = ?`)
      .get(businessId) as any;
    const marketingSpendINR = campaignSpend?.total_spent || 0;

    // Actual Google Ads spend: strictly live experiment spend, excluding mock seed spend (e.g. camp_seed_*)
    const liveSpendRow = this.db
      .prepare(
        `SELECT SUM(spent_inr) as live_spend FROM campaigns 
         WHERE business_id = ? AND id NOT LIKE 'camp_seed_%' AND status IN ('LIVE', 'ACTIVE')`
      )
      .get(businessId) as any;
    const verifiedActualGoogleAdsSpendINR = liveSpendRow?.live_spend || 0;

    // Google Clicks count
    const clicksCountRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM google_clicks`
    ).get() as any;
    const googleClicksCount = clicksCountRow?.cnt || 0;

    // Tracked sessions count
    const sessionsCountRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM customer_journeys WHERE business_id = ? AND stage IN ('SESSION', 'LEAD', 'QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER')`
    ).get(businessId) as any;
    const trackedSessionsCount = sessionsCountRow?.cnt || 0;

    // Attributed vs Unverified leads count (REAL classification)
    const leadStatsRow = this.db.prepare(
      `SELECT 
         SUM(CASE WHEN attribution_status = 'VERIFIED' THEN 1 ELSE 0 END) as attributed,
         SUM(CASE WHEN attribution_status != 'VERIFIED' OR attribution_status IS NULL THEN 1 ELSE 0 END) as unverified
       FROM customer_journeys
       WHERE business_id = ? AND classification = 'REAL' AND stage IN ('LEAD', 'QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER')`
    ).get(businessId) as any;
    const attributedLeadsCount = leadStatsRow?.attributed || 0;
    const unverifiedLeadsCount = leadStatsRow?.unverified || 0;

    // 6. AI Costs
    const costStats = this.db
      .prepare(
        `SELECT SUM(estimated_cost_inr) as total_cost FROM ai_cost_logs WHERE business_id = ?`
      )
      .get(businessId) as any;
    const totalAICostINR = costStats?.total_cost || 0;

    // 7. Unit economics (Count qualified leads and customers)
    const journeyStats = this.db
      .prepare(
        `SELECT 
           SUM(CASE WHEN stage IN ('QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER') THEN 1 ELSE 0 END) as qualified_leads,
           SUM(CASE WHEN stage = 'CUSTOMER' THEN 1 ELSE 0 END) as customers
         FROM customer_journeys
         WHERE business_id = ?`
      )
      .get(businessId) as any;

    const qualifiedLeads = journeyStats?.qualified_leads || 0;
    const customers = journeyStats?.customers || 0;

    const aiCostPerQualifiedLeadINR = qualifiedLeads > 0 ? totalAICostINR / qualifiedLeads : 0;
    const aiCostPerCustomerINR = customers > 0 ? totalAICostINR / customers : 0;

    // 8. ROAS & ROI - Computed on real marketing-attributed revenue
    const verifiedRoas = marketingSpendINR > 0 
      ? Math.round((realMarketingAttributedRevenueINR / marketingSpendINR) * 100) / 100 
      : 0;
    const verifiedRoi = marketingSpendINR > 0
      ? Math.round(((realMarketingAttributedRevenueINR - marketingSpendINR) / marketingSpendINR) * 100) / 100
      : 0;
    const testRoas = marketingSpendINR > 0 
      ? Math.round((testRevenueINR / marketingSpendINR) * 100) / 100 
      : 0;

    // Zero test bleed: verifiedRoas is strictly used for ROAS
    const realRoas = verifiedRoas;
    const roas = verifiedRoas;

    return {
      realRevenueRecordedINR,
      realRevenueIndependentlyVerifiedINR,
      realMarketingAttributedRevenueINR,
      unattributedRealRevenueINR,
      testRevenueINR,
      simulatedRevenueINR,
      simulatedValueINR: simulatedRevenueINR,
      totalTransactions,
      attributedTransactions,
      unattributedTransactions,
      marketingSpendINR,
      totalAICostINR,
      aiCost: totalAICostINR,
      aiCostStatus: totalAICostINR > 0 ? 'ESTIMATED' : 'UNKNOWN',
      aiCostStatusReason: totalAICostINR > 0 
        ? 'Cost estimated from nominal model token rates' 
        : 'Zero external tokens consumed; deterministic execution',
      aiCostPerQualifiedLeadINR: Math.round(aiCostPerQualifiedLeadINR * 100) / 100,
      aiCostPerCustomerINR: Math.round(aiCostPerCustomerINR * 100) / 100,
      roas,
      realRoas,
      testRoas,
      verifiedRoas,
      verifiedRoi,
      realRevenueINR: realRevenueRecordedINR,
      googleClicksCount,
      trackedSessionsCount,
      attributedLeadsCount,
      unverifiedLeadsCount,
      verifiedActualGoogleAdsSpendINR,
    };
  }

  listTransactions(
    businessId: string,
    options: {
      classification?: DataClassification;
      limit?: number;
    } = {}
  ): TransactionRecord[] {
    let sql = `SELECT * FROM transactions WHERE business_id = ?`;
    const args: any[] = [businessId];

    if (options.classification) {
      sql += ` AND classification = ?`;
      args.push(options.classification);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    args.push(options.limit || 50);

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      businessId: r.business_id,
      journeyId: r.journey_id || undefined,
      campaignId: r.campaign_id || undefined,
      invoiceNumber: r.invoice_number,
      amountINR: r.amount_inr,
      paymentMethod: r.payment_method,
      paymentGateway: r.payment_gateway,
      transactionRef: r.transaction_ref || undefined,
      status: r.status,
      classification: r.classification,
      serviceRendered: r.service_rendered || undefined,
      createdAt: r.created_at,
    }));
  }
}
