import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerRegistryEngine } from './partner-registry.js';
import { ReferralTrackingEngine } from './referral-tracking.js';
import { CommissionRecord, CommissionStatus, VerificationSource } from './types.js';

/**
 * Detects simulated / test conversion reports that must never become revenue.
 * Signals: explicit `evidence.simulated`, or a test-style external transaction id
 * (`sim_`, `test_`, `mock_`, `fixture` prefixes).
 */
export function isSimulatedConversionReport(input: {
  externalTransactionId?: string;
  evidence?: Record<string, any>;
}): boolean {
  if ((input.evidence as any)?.simulated === true) return true;
  const tx = (input.externalTransactionId || '').trim().toLowerCase();
  return tx.startsWith('sim_') || tx.startsWith('test_') || tx.startsWith('mock_') ||
    tx.startsWith('sandbox_') || tx.includes('fixture') || tx.includes('sandbox');
}

export interface ReportConversionInput {
  partnerId: string;
  clickId?: string;
  referralId?: string;
  externalTransactionId: string;
  eventType?: string;
  expectedCommissionINR: number;
  verifiedCommissionINR?: number;
  receivedCommissionINR?: number;
  verificationSource: VerificationSource;
  evidence: Record<string, any>;
  status?: CommissionStatus;
}

export interface ReconcileCommissionInput {
  commissionId: string;
  action: 'APPROVE' | 'PAY' | 'REJECT' | 'CANCEL' | 'REFUND' | 'CHARGEBACK';
  verifiedCommissionINR?: number;
  receivedCommissionINR?: number;
  verificationSource: VerificationSource;
  evidence: Record<string, any>;
}

export class ConversionVerificationAdapter {
  private static instance: ConversionVerificationAdapter;
  private d1Repo = D1RevenueRepository.getInstance();
  private registry = PartnerRegistryEngine.getInstance();
  private tracker = ReferralTrackingEngine.getInstance();

  public static getInstance(): ConversionVerificationAdapter {
    if (!ConversionVerificationAdapter.instance) {
      ConversionVerificationAdapter.instance = new ConversionVerificationAdapter();
    }
    return ConversionVerificationAdapter.instance;
  }

  /**
   * Records or ingests a conversion reported from an external provider/network.
   * Mode 1 (API), Mode 2 (Webhook), Mode 3 (CSV/Export), Mode 5 (Ref Code).
   *
   * Idempotent: duplicate reports on the same (partnerId, externalTransactionId) will update,
   * not duplicate records.
   */
  public async reportConversion(input: ReportConversionInput): Promise<CommissionRecord> {
    const partner = await this.registry.getPartner(input.partnerId);
    if (!partner) {
      throw new Error(`PARTNER_NOT_FOUND: Unknown partner '${input.partnerId}'.`);
    }

    if (!input.externalTransactionId || !input.externalTransactionId.trim()) {
      throw new Error('INVALID_CONVERSION: externalTransactionId is required from provider.');
    }

    if (!input.evidence || Object.keys(input.evidence).length === 0) {
      if (isSimulatedConversionReport(input)) {
        input.evidence = { simulated: true };
      } else {
        throw new Error('EVIDENCE_REQUIRED: External provider evidence or document reference is required to report conversion.');
      }
    }

    // Try finding referral by clickId or referralId
    let referral = input.referralId ? await this.tracker.getReferral(input.referralId) : null;
    if (!referral && input.clickId) {
      referral = await this.tracker.getReferralByClickId(input.clickId);
    }

    // Check for existing commission by partner + externalTransactionId (Idempotency)
    const existing = await this.d1Repo.queryOne<any>(
      'commission_records',
      'SELECT * FROM commission_records WHERE partner_id = ? AND external_transaction_id = ?',
      [input.partnerId, input.externalTransactionId.trim()]
    );

    // Simulation guard (§ honest design): simulated/test conversions must NEVER
    // become verified revenue. Cap them at COMMISSION_PENDING with zero verified
    // amounts, regardless of the requested status.
    const now = new Date().toISOString();
    const simulated = isSimulatedConversionReport(input);
    const initialStatus: CommissionStatus = simulated ? 'COMMISSION_PENDING' : (input.status || 'COMMISSION_PENDING');
    const verifiedCommission = simulated ? 0 : (input.verifiedCommissionINR ?? (initialStatus === 'COMMISSION_APPROVED' || initialStatus === 'COMMISSION_PAID' ? input.expectedCommissionINR : 0));
    const receivedCommission = simulated ? 0 : (input.receivedCommissionINR ?? (initialStatus === 'COMMISSION_PAID' ? verifiedCommission : 0));

    if (existing) {
      // Idempotent update
      await this.d1Repo.executeWrite(
        'commission_records',
        `UPDATE commission_records
        SET expected_commission_inr = ?, verified_commission_inr = ?,
            received_commission_inr = ?, status = ?, evidence_json = ?,
            verification_source = ?, updated_at = ?
        WHERE id = ?`,
        [
          input.expectedCommissionINR,
          verifiedCommission,
          receivedCommission,
          initialStatus,
          JSON.stringify({ ...JSON.parse(existing.evidence_json || '{}'), ...input.evidence }),
          input.verificationSource,
          now,
          existing.id
        ]
      );

      const updated = await this.getCommission(existing.id)!;
      await this.syncRevenueLedger(updated!);
      return updated!;
    }

    const id = `comm_${randomUUID().substring(0, 10)}`;
    const record: CommissionRecord = {
      id,
      referralId: referral?.id,
      partnerId: partner.id,
      offerId: referral?.offerId,
      organizationId: partner.organizationId,
      externalTransactionId: input.externalTransactionId.trim(),
      eventType: input.eventType || partner.qualifyingEvent || 'PURCHASE',
      externalStatus: initialStatus,
      expectedCommissionINR: input.expectedCommissionINR,
      verifiedCommissionINR: verifiedCommission,
      receivedCommissionINR: receivedCommission,
      verificationSource: input.verificationSource,
      evidence: { ...(input.evidence || {}), ...(simulated ? { simulated: true } : {}) },
      status: initialStatus,
      createdAt: now,
      verifiedAt: verifiedCommission > 0 ? now : undefined,
      paidAt: receivedCommission > 0 ? now : undefined,
      updatedAt: now
    };

    await this.d1Repo.executeWrite(
      'commission_records',
      `INSERT INTO commission_records (
        id, referral_id, partner_id, offer_id, organization_id,
        external_transaction_id, event_type, external_status,
        expected_commission_inr, verified_commission_inr,
        received_commission_inr, verification_source, evidence_json,
        status, created_at, verified_at, paid_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.referralId || null,
        record.partnerId,
        record.offerId || null,
        record.organizationId,
        record.externalTransactionId,
        record.eventType,
        record.externalStatus,
        record.expectedCommissionINR,
        record.verifiedCommissionINR,
        record.receivedCommissionINR,
        record.verificationSource,
        JSON.stringify(record.evidence),
        record.status,
        record.createdAt,
        record.verifiedAt || null,
        record.paidAt || null,
        record.updatedAt
      ]
    );

    // Sync to revenue_records if verified/paid
    await this.syncRevenueLedger(record);

    return record;
  }

  /**
   * Reconciles a commission through approval, payment, cancellation, or refund.
   * Mode 4 (Manual Verification with mandatory evidence) or programmatic reconciliation.
   */
  public async reconcileCommission(input: ReconcileCommissionInput): Promise<CommissionRecord> {
    const commission = await this.getCommission(input.commissionId);
    if (!commission) {
      throw new Error(`COMMISSION_NOT_FOUND: Record '${input.commissionId}' not found.`);
    }

    // Simulation guard: a simulated record can never be approved or paid.
    if ((commission.evidence as any)?.simulated && (input.action === 'APPROVE' || input.action === 'PAY')) {
      throw new Error('SIMULATION_GUARD: Simulated conversions cannot be approved or paid. Only real provider-verified conversions create revenue.');
    }

    if (!input.evidence || Object.keys(input.evidence).length === 0) {
      throw new Error('EVIDENCE_REQUIRED: External proof or document reference is required to reconcile commission status.');
    }

    if ((input.action === 'APPROVE' || input.action === 'PAY')) {
      const hasProviderProof = Boolean(
        input.evidence.payoutId ||
        input.evidence.reportId ||
        input.evidence.transactionId ||
        input.evidence.documentRef ||
        input.evidence.providerStatementId ||
        input.evidence.statementUrl ||
        input.evidence.providerApprovalReference ||
        input.evidence.networkNotice
      );
      if (!hasProviderProof) {
        throw new Error('PROVIDER_PROOF_REQUIRED: Transition to VERIFIED/PAID requires attached external provider statement, payout ID, or transaction proof.');
      }
    }

    const now = new Date().toISOString();
    let newStatus: CommissionStatus = commission.status;
    let verifiedINR = commission.verifiedCommissionINR;
    let receivedINR = commission.receivedCommissionINR;
    let verifiedAt = commission.verifiedAt;
    let paidAt = commission.paidAt;

    switch (input.action) {
      case 'APPROVE':
        newStatus = 'COMMISSION_APPROVED';
        verifiedINR = input.verifiedCommissionINR ?? (commission.expectedCommissionINR > 0 ? commission.expectedCommissionINR : verifiedINR);
        verifiedAt = now;
        break;

      case 'PAY':
        newStatus = 'COMMISSION_PAID';
        verifiedINR = input.verifiedCommissionINR ?? (commission.verifiedCommissionINR || commission.expectedCommissionINR);
        receivedINR = input.receivedCommissionINR ?? verifiedINR;
        verifiedAt = verifiedAt || now;
        paidAt = now;
        break;

      case 'REJECT':
        newStatus = 'REJECTED';
        verifiedINR = 0;
        receivedINR = 0;
        break;

      case 'CANCEL':
        newStatus = 'CANCELLED';
        verifiedINR = 0;
        receivedINR = 0;
        break;

      case 'REFUND':
        newStatus = 'REFUNDED';
        verifiedINR = 0;
        receivedINR = 0;
        break;

      case 'CHARGEBACK':
        newStatus = 'CHARGEBACK';
        verifiedINR = 0;
        receivedINR = 0;
        break;
    }

    const mergedEvidence = {
      ...commission.evidence,
      ...input.evidence,
      reconciledAt: now,
      reconciledAction: input.action
    };

    await this.d1Repo.executeWrite(
      'commission_records',
      `UPDATE commission_records
      SET status = ?, external_status = ?, verified_commission_inr = ?,
          received_commission_inr = ?, evidence_json = ?,
          verification_source = ?, verified_at = ?, paid_at = ?, updated_at = ?
      WHERE id = ?`,
      [
        newStatus,
        newStatus,
        verifiedINR,
        receivedINR,
        JSON.stringify(mergedEvidence),
        input.verificationSource,
        verifiedAt || null,
        paidAt || null,
        now,
        commission.id
      ]
    );

    const updated = await this.getCommission(commission.id)!;
    await this.syncRevenueLedger(updated!);
    return updated!;
  }

  public async getCommission(id: string): Promise<CommissionRecord | null> {
    const row = await this.d1Repo.queryOne<any>('commission_records', 'SELECT * FROM commission_records WHERE id = ?', [id]);
    return row ? this.mapCommission(row) : null;
  }

  public async listCommissions(organizationId: string, filter?: { partnerId?: string; status?: CommissionStatus }): Promise<CommissionRecord[]> {
    let sql = 'SELECT * FROM commission_records WHERE organization_id = ?';
    const params: any[] = [organizationId];

    if (filter?.partnerId) {
      sql += ' AND partner_id = ?';
      params.push(filter.partnerId);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await this.d1Repo.query<any>('commission_records', sql, params);
    return rows.map(r => this.mapCommission(r));
  }

  /**
   * CRITICAL REVENUE TRUTH BRIDGE (§ 2, § 3):
   * Syncs verified commission into the official `revenue_records` ledger.
   *
   * Rules:
   * - Only COMMISSION_APPROVED or COMMISSION_PAID can create REAL revenue.
   * - Any other status (PENDING, REJECTED, REFUNDED) MUST NOT create revenue.
   * - If a previously verified commission is REFUNDED or CANCELLED, a compensating negative entry is inserted.
   */
  private async syncRevenueLedger(commission: CommissionRecord): Promise<void> {
    // Simulation guard (defense in depth): simulated records never touch revenue_records,
    // even if a caller passes APPROVED/PAID with a positive amount.
    if ((commission.evidence as any)?.simulated) return;

    const revenueRecordId = `rev_comm_${commission.id}`;

    // Check if revenue record exists
    const existing = await this.d1Repo.queryOne<any>(
      'revenue_records',
      'SELECT * FROM revenue_records WHERE id = ? OR transaction_id = ?',
      [revenueRecordId, commission.id]
    );

    if (commission.status === 'COMMISSION_APPROVED' || commission.status === 'COMMISSION_PAID') {
      const verifiedAmount = commission.verifiedCommissionINR;
      if (verifiedAmount > 0) {
        if (!existing) {
          await this.d1Repo.executeWrite(
            'revenue_records',
            `INSERT INTO revenue_records (
              id, organization_id, business_id, revenue_type, source,
              transaction_id, amount_inr, currency, verified,
              verification_method, classification, recurring_model, timestamp
            ) VALUES (?, ?, ?, 'VERIFIED_COMMISSION', 'EXTERNAL_CONVERSION', ?, ?, 'INR', 1, ?, 'REAL', 'ONE_TIME', ?)`,
            [
              revenueRecordId,
              commission.organizationId,
              `part_${commission.partnerId}`,
              commission.id,
              verifiedAmount,
              commission.verificationSource,
              commission.verifiedAt || commission.createdAt
            ]
          );
        } else {
          await this.d1Repo.executeWrite(
            'revenue_records',
            `UPDATE revenue_records SET amount_inr = ?, verified = 1, classification = 'REAL' WHERE id = ?`,
            [verifiedAmount, existing.id]
          );
        }
      }
    } else if (existing && (commission.status === 'REFUNDED' || commission.status === 'CANCELLED' || commission.status === 'REJECTED' || commission.status === 'CHARGEBACK')) {
      // Compensating negative entry to reverse unearned revenue
      const refundId = `rev_refund_${commission.id}_${Date.now()}`;
      await this.d1Repo.executeWrite(
        'revenue_records',
        `INSERT INTO revenue_records (
          id, organization_id, business_id, revenue_type, source,
          transaction_id, amount_inr, currency, verified,
          verification_method, classification, recurring_model, timestamp
        ) VALUES (?, ?, ?, 'COMMISSION_REFUND', 'PARTNER_REVERSAL', ?, ?, 'INR', 1, ?, 'REAL', 'ONE_TIME', datetime('now'))`,
        [
          refundId,
          commission.organizationId,
          `part_${commission.partnerId}`,
          commission.id,
          -existing.amount_inr,
          commission.verificationSource
        ]
      );
    }
  }

  private mapCommission(row: any): CommissionRecord {
    let evidence = {};
    try { evidence = JSON.parse(row.evidence_json || '{}'); } catch {}
    return {
      id: row.id,
      referralId: row.referral_id,
      partnerId: row.partner_id,
      offerId: row.offer_id,
      organizationId: row.organization_id,
      externalTransactionId: row.external_transaction_id,
      eventType: row.event_type,
      externalStatus: row.external_status,
      expectedCommissionINR: row.expected_commission_inr,
      verifiedCommissionINR: row.verified_commission_inr,
      receivedCommissionINR: row.received_commission_inr,
      verificationSource: row.verification_source,
      evidence,
      status: row.status,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
      paidAt: row.paid_at,
      updatedAt: row.updated_at
    };
  }
}
