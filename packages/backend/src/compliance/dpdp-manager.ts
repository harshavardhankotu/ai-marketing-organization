import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';

export interface ConsentRecordInput {
  businessId: string;
  journeyId?: string;
  customerName: string;
  customerPhone?: string;
  ipAddress?: string;
  purpose: string;
  consentVersion?: string;
}

export interface ConsentRecord {
  id: string;
  businessId: string;
  journeyId?: string;
  customerName: string;
  customerPhone?: string;
  ipAddress?: string;
  purpose: string;
  consentVersion: string;
  status: 'ACTIVE' | 'REVOKED' | 'ERASED';
  consentTimestamp: string;
}

export class DPDPComplianceManager {
  private get db() {
    return getDb();
  }

  /**
   * Captures unambiguous, itemized patient consent pursuant to Section 6 of the DPDP Act 2023.
   */
  public recordConsent(input: ConsentRecordInput): ConsentRecord {
    const id = `dpdp_${randomUUID().substring(0, 12)}`;
    const now = new Date().toISOString();
    const version = input.consentVersion || '2026.1';

    this.db
      .prepare(
        `INSERT INTO patient_dpdp_consents (
          id, business_id, journey_id, customer_name, customer_phone,
          ip_address, purpose, consent_version, status, consent_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
      )
      .run(
        id,
        input.businessId,
        input.journeyId || null,
        input.customerName,
        input.customerPhone || null,
        input.ipAddress || null,
        input.purpose,
        version,
        now
      );

    return {
      id,
      businessId: input.businessId,
      journeyId: input.journeyId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      ipAddress: input.ipAddress,
      purpose: input.purpose,
      consentVersion: version,
      status: 'ACTIVE',
      consentTimestamp: now,
    };
  }

  /**
   * Retrieves active consent records for a customer phone or journey ID.
   */
  public getConsent(identifier: string): ConsentRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM patient_dpdp_consents 
         WHERE customer_phone = ? OR journey_id = ? OR id = ?
         ORDER BY consent_timestamp DESC LIMIT 1`
      )
      .get(identifier, identifier, identifier) as any;

    if (!row) return null;

    return {
      id: row.id,
      businessId: row.business_id,
      journeyId: row.journey_id || undefined,
      customerName: row.customer_name,
      customerPhone: row.customer_phone || undefined,
      ipAddress: row.ip_address || undefined,
      purpose: row.purpose,
      consentVersion: row.consent_version,
      status: row.status,
      consentTimestamp: row.consent_timestamp,
    };
  }

  /**
   * Implements Section 12 of the DPDP Act 2023 (Right to Erasure / Withdrawal of Consent).
   * Anonymizes identifiable personal data while preserving statutory tax/accounting records.
   */
  public requestErasure(params: {
    businessId: string;
    phoneOrJourneyId: string;
    reason?: string;
  }): {
    success: boolean;
    anonymizedRecordsCount: number;
    financialRecordsPreservedCount: number;
    auditMessage: string;
  } {
    const now = new Date().toISOString();
    const identifier = params.phoneOrJourneyId;

    // Find matching journey
    const journeys = this.db
      .prepare(
        `SELECT id, customer_name, customer_phone FROM customer_journeys 
         WHERE business_id = ? AND (customer_phone = ? OR id = ?)`
      )
      .all(params.businessId, identifier, identifier) as any[];

    const matchedJourneyIds = journeys.map((j) => j.id);
    let anonymizedCount = 0;

    for (const j of journeys) {
      const anonName = `Anonymized Patient [${j.id.substring(0, 8)}]`;

      // 1. Anonymize Customer Journey
      this.db
        .prepare(
          `UPDATE customer_journeys 
           SET customer_name = ?, customer_phone = NULL, customer_email = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(anonName, now, j.id);

      // 2. Anonymize Appointment Records
      this.db
        .prepare(
          `UPDATE appointments 
           SET patient_name = ?, updated_at = ?
           WHERE journey_id = ?`
        )
        .run(anonName, now, j.id);

      // 3. Mark Consent as ERASED
      this.db
        .prepare(
          `UPDATE patient_dpdp_consents 
           SET status = 'ERASED', customer_name = ?, customer_phone = NULL, ip_address = NULL, revoked_timestamp = ?
           WHERE journey_id = ? OR customer_phone = ?`
        )
        .run(anonName, now, j.id, j.customer_phone);

      anonymizedCount++;
    }

    // Check financial transactions preserved under Section 8/12 statutory exception (tax & audit requirement)
    let financialCount = 0;
    if (matchedJourneyIds.length > 0) {
      const placeholders = matchedJourneyIds.map(() => '?').join(',');
      const financialTxRow = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM transactions 
           WHERE business_id = ? AND journey_id IN (${placeholders})`
        )
        .get(params.businessId, ...matchedJourneyIds) as any;
      financialCount = financialTxRow?.count || 0;
    }

    return {
      success: true,
      anonymizedRecordsCount: anonymizedCount,
      financialRecordsPreservedCount: financialCount,
      auditMessage: `Personal data erased under DPDP Act Section 12 for ${identifier}. Financial ledgers preserved under statutory accounting laws.`,
    };
  }
}
