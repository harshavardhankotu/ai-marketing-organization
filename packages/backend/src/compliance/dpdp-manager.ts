import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

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

export interface DPDPPurgeResult {
  purgedCount: number;
  localDeleted: number;
  localStatus: 'EXECUTED' | 'ERROR' | 'PARTIAL';
  remoteDeleted: number;
  remoteStatus: 'EXECUTED' | 'SKIPPED' | 'ERROR' | 'PARTIAL';
  timestamp: string;
  localErrors?: string[];
  remoteError?: string;
}

export class DPDPComplianceManager {
  private static instance: DPDPComplianceManager;

  public static getInstance(): DPDPComplianceManager {
    if (!DPDPComplianceManager.instance) {
      DPDPComplianceManager.instance = new DPDPComplianceManager();
    }
    return DPDPComplianceManager.instance;
  }

  private get db() {
    return getDb();
  }

  private get d1Repo() {
    return D1RevenueRepository.getInstance();
  }

  /**
   * Step 9d: Daily 30-Day Retention Purge Job (DPDP Act 2023)
   * Purges unconverted lead inquiries older than 30 days.
   * Clears personal identifiable data (phone, email, contact name) and marks status 'PURGED_RETENTION_EXPIRED'.
   * Safely purges expired price drop subscriptions and terminal claims while strictly preserving delivery-safety tombstones.
   * Executes remote D1 deletion through the authorized write path (executeWrite) and awaits completion.
   */
  public async purgeExpiredInquiries(retentionDays: number = 30): Promise<DPDPPurgeResult> {
    const db = getDb();
    const thresholdDateStr = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const updateProspectsSql = `
      UPDATE platform_prospects
      SET
        phone = NULL,
        prospect_phone = NULL,
        email = NULL,
        prospect_email = NULL,
        prospect_owner_name = '[PURGED_RETENTION_EXPIRED]',
        status = 'PURGED_RETENTION_EXPIRED',
        stage = 'PURGED_RETENTION_EXPIRED',
        notes = COALESCE(notes, '') || ' | Purged after 30-day retention period pursuant to DPDP policy',
        updated_at = datetime('now')
      WHERE datetime(created_at) < datetime(?)
        AND status != 'CONVERTED'
        AND status != 'PURGED_RETENTION_EXPIRED'
        AND (source IN ('OFFER_PAGE_INQUIRY', 'DIRECT_INBOUND', 'INBOUND_LEAKAGE_CALCULATOR')
             OR discovery_source IN ('DIRECT_INBOUND', 'INBOUND_LEAKAGE_CALCULATOR'))
    `;

    const deleteSubEventsSql = `
      DELETE FROM durable_events
      WHERE datetime(created_at) < datetime(?)
        AND event_type = 'PRICE_DROP_SUBSCRIPTION'
    `;

    // Only purge terminal completed claims (processed = 1); NEVER delete in-flight or uncertain provider calls
    const deleteTerminalClaimsSql = `
      DELETE FROM durable_events
      WHERE datetime(created_at) < datetime(?)
        AND event_type = 'PRICE_ALERT_DELIVERY_CLAIMED'
        AND processed = 1
        AND (error_message IS NULL OR (error_message NOT LIKE 'PROVIDER_CALL_ATTEMPTED%' AND error_message NOT LIKE 'PRE_SEND_LEASE%'))
    `;

    // Scrub PII payload from in-flight or uncertain provider calls older than 30 days while preserving the non-PII tombstone ID
    const scrubInFlightClaimsSql = `
      UPDATE durable_events
      SET payload_json = '{"scrubbed":true,"dpdp_retention_purged":true}'
      WHERE datetime(created_at) < datetime(?)
        AND event_type = 'PRICE_ALERT_DELIVERY_CLAIMED'
        AND (processed = 0 OR error_message LIKE 'PROVIDER_CALL_ATTEMPTED%' OR error_message LIKE 'PRE_SEND_LEASE%')
        AND payload_json NOT LIKE '%"dpdp_retention_purged":true%'
    `;

    // Purge expired active price-drop alert subscriptions from outbound_contacts (Spec Stage U.1 & Comment #4629753815)
    const purgeOutboundPriceAlertsSql = `
      DELETE FROM outbound_contacts
      WHERE datetime(created_at) < datetime(?)
        AND source IN ('PRICE_DROP_ALERT', 'FAIR_PRICE_ALERT', 'CUSTOMER_DESK_ALERT_OPTIN')
        AND is_opted_out = 0
        AND is_suppressed = 0
    `;

    // Scrub PII from suppressed or opted-out price-drop alert contacts older than 30 days while preserving tombstone status
    const scrubOutboundPriceAlertSuppressedSql = `
      UPDATE outbound_contacts
      SET prospect_name = '[PURGED_RETENTION_EXPIRED]',
          prospect_email = NULL,
          prospect_phone = NULL,
          authorization_evidence_json = '{"purged":true,"dpdp_retention_purged":true}',
          updated_at = datetime('now')
      WHERE datetime(created_at) < datetime(?)
        AND source IN ('PRICE_DROP_ALERT', 'FAIR_PRICE_ALERT', 'CUSTOMER_DESK_ALERT_OPTIN')
        AND (is_opted_out = 1 OR is_suppressed = 1)
        AND (prospect_email IS NOT NULL OR prospect_phone IS NOT NULL OR prospect_name != '[PURGED_RETENTION_EXPIRED]')
    `;

    const localErrors: string[] = [];
    let localProspectsCount = 0;
    try {
      const res = db.prepare(updateProspectsSql).run(thresholdDateStr);
      localProspectsCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`prospects_update_failed: ${err?.message || String(err)}`);
    }

    let localSubCount = 0;
    try {
      const res = db.prepare(deleteSubEventsSql).run(thresholdDateStr);
      localSubCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`sub_events_delete_failed: ${err?.message || String(err)}`);
    }

    let localTerminalClaimsCount = 0;
    try {
      const res = db.prepare(deleteTerminalClaimsSql).run(thresholdDateStr);
      localTerminalClaimsCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`terminal_claims_delete_failed: ${err?.message || String(err)}`);
    }

    let localScrubbedClaimsCount = 0;
    try {
      const res = db.prepare(scrubInFlightClaimsSql).run(thresholdDateStr);
      localScrubbedClaimsCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`claims_scrub_failed: ${err?.message || String(err)}`);
    }

    let localOutboundPurgedCount = 0;
    try {
      const res = db.prepare(purgeOutboundPriceAlertsSql).run(thresholdDateStr);
      localOutboundPurgedCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`outbound_contacts_purge_failed: ${err?.message || String(err)}`);
    }

    let localOutboundScrubbedCount = 0;
    try {
      const res = db.prepare(scrubOutboundPriceAlertSuppressedSql).run(thresholdDateStr);
      localOutboundScrubbedCount = res.changes || 0;
    } catch (err: any) {
      localErrors.push(`outbound_contacts_scrub_failed: ${err?.message || String(err)}`);
    }

    const localDeleted = localProspectsCount + localSubCount + localTerminalClaimsCount + localScrubbedClaimsCount + localOutboundPurgedCount + localOutboundScrubbedCount;
    let localStatus: 'EXECUTED' | 'ERROR' | 'PARTIAL' = 'EXECUTED';
    if (localErrors.length === 6) {
      localStatus = 'ERROR';
    } else if (localErrors.length > 0) {
      localStatus = 'PARTIAL';
    }

    // Remote Cloudflare D1 authorized write path
    let remoteDeleted = 0;
    let remoteStatus: 'EXECUTED' | 'SKIPPED' | 'ERROR' | 'PARTIAL' = 'SKIPPED';
    let remoteError: string | undefined = undefined;

    try {
      const { D1RevenueRepository } = await import('../db/d1-revenue-repository.js');
      const d1Repo = D1RevenueRepository.getInstance();

      if (d1Repo.isRemoteD1WriteAllowed()) {
        const writeSpecs: Array<{ table: any; sql: string; desc: string }> = [
          { table: 'platform_prospects', sql: updateProspectsSql, desc: 'prospects_update' },
          { table: 'durable_events', sql: deleteSubEventsSql, desc: 'sub_events_delete' },
          { table: 'durable_events', sql: deleteTerminalClaimsSql, desc: 'terminal_claims_delete' },
          { table: 'durable_events', sql: scrubInFlightClaimsSql, desc: 'in_flight_claims_scrub' },
          { table: 'outbound_contacts', sql: purgeOutboundPriceAlertsSql, desc: 'outbound_contacts_delete' },
          { table: 'outbound_contacts', sql: scrubOutboundPriceAlertSuppressedSql, desc: 'outbound_contacts_scrub' }
        ];

        const remoteWrites: Array<{ rowsAffected: number; source: string; desc: string }> = [];
        const remoteWriteErrors: string[] = [];

        for (const spec of writeSpecs) {
          try {
            const w = await d1Repo.executeWrite(spec.table, spec.sql, [thresholdDateStr]);
            remoteWrites.push({ ...w, desc: spec.desc });
          } catch (writeErr: any) {
            remoteWriteErrors.push(`${spec.desc}: ${writeErr?.message || String(writeErr)}`);
          }
        }

        const successfulRemote = remoteWrites.filter(w => w.source === 'CLOUDFLARE_D1');
        const fallbackLocal = remoteWrites.filter(w => w.source !== 'CLOUDFLARE_D1');

        remoteDeleted = successfulRemote.reduce((acc, w) => acc + (w.rowsAffected || 0), 0);

        if (remoteWriteErrors.length === 0 && fallbackLocal.length === 0 && successfulRemote.length === writeSpecs.length) {
          remoteStatus = 'EXECUTED';
        } else if (successfulRemote.length > 0) {
          remoteStatus = 'PARTIAL';
          const errParts: string[] = [];
          if (remoteWriteErrors.length > 0) errParts.push(`Remote write errors: ${remoteWriteErrors.join('; ')}`);
          if (fallbackLocal.length > 0) errParts.push(`${fallbackLocal.length} writes fell back to local SQLite`);
          remoteError = errParts.join(' | ');
        } else {
          remoteStatus = 'ERROR';
          remoteError = remoteWriteErrors.length > 0
            ? `All remote writes failed: ${remoteWriteErrors.join('; ')}`
            : 'All remote writes fell back to local SQLite';
        }
      } else {
        remoteStatus = 'SKIPPED';
      }
    } catch (err: any) {
      remoteStatus = 'ERROR';
      remoteError = err?.message || String(err);
      console.error(`[DPDPComplianceManager] Remote D1 purge write error: ${remoteError}`);
    }

    return {
      purgedCount: localDeleted + remoteDeleted,
      localDeleted,
      localStatus,
      remoteDeleted,
      remoteStatus,
      timestamp: new Date().toISOString(),
      ...(localErrors.length > 0 ? { localErrors } : {}),
      ...(remoteError ? { remoteError } : {})
    };
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

    const errors: string[] = [];

    // 4. Anonymize Outbound Contacts (Price Drop Alerts & Inquiries) (Spec Stage U.1 & Comment #4629753815)
    try {
      const outboundRows = this.db.prepare(
        `SELECT id, is_suppressed, is_opted_out FROM outbound_contacts WHERE prospect_email = ? OR prospect_phone = ? OR id = ?`
      ).all(identifier, identifier, identifier) as any[];

      for (const row of outboundRows) {
        this.db.prepare(
          `UPDATE outbound_contacts
           SET prospect_name = '[ERASED_DPDP_REQUEST]',
               prospect_email = CASE WHEN is_suppressed = 1 OR is_opted_out = 1 THEN prospect_email ELSE NULL END,
               prospect_phone = NULL,
               authorization_evidence_json = '{"erased":true,"dpdp_erasure_timestamp":"' || ? || '"}',
               is_opted_out = 1,
               is_suppressed = 1,
               updated_at = ?
           WHERE id = ?`
        ).run(now, now, row.id);
        anonymizedCount++;

        if (this.d1Repo.isRemoteD1WriteAllowed()) {
          this.d1Repo.executeWrite(
            'outbound_contacts',
            `UPDATE outbound_contacts
             SET prospect_name = '[ERASED_DPDP_REQUEST]',
                 prospect_email = CASE WHEN is_suppressed = 1 OR is_opted_out = 1 THEN prospect_email ELSE NULL END,
                 prospect_phone = NULL,
                 authorization_evidence_json = '{"erased":true,"dpdp_erasure_timestamp":"' || ? || '"}',
                 is_opted_out = 1,
                 is_suppressed = 1,
                 updated_at = ?
             WHERE id = ?`,
            [now, now, row.id]
          ).catch((d1Err: any) => {
            console.warn(`[DPDPComplianceManager] Remote D1 outbound_contacts erasure write failed: ${d1Err?.message || String(d1Err)}`);
          });
        }
      }
    } catch (err: any) {
      errors.push(`outbound_contacts_erasure_failed: ${err?.message || String(err)}`);
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
      success: errors.length === 0,
      anonymizedRecordsCount: anonymizedCount,
      financialRecordsPreservedCount: financialCount,
      auditMessage: `Personal data erased under DPDP Act Section 12 for ${identifier}. Financial ledgers preserved under statutory accounting laws.`,
      ...(errors.length > 0 ? { errors } : {})
    };
  }
}
