/**
 * PaymentTruthService — Implements Part D.2: Four-State Payment Truth & Export Verification
 *
 * Revenue States:
 * 1. PAYMENT_PAGE_VIEW (traffic only, zero revenue)
 * 2. PAYMENT_CLAIMED (buyer provides UTR, zero revenue until verified)
 * 3. OWNER_CONFIRMED (owner verifies bank statement credit, recognized verified revenue)
 * 4. EXPORT_VERIFIED (matches a Razorpay settlement/payment export row, recognized verified revenue)
 *
 * Only OWNER_CONFIRMED and EXPORT_VERIFIED count as verified revenue.
 * Owner can mark an order TEST (excluded from verified revenue).
 */

import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export type PaymentState = 'PAYMENT_PAGE_VIEW' | 'PAYMENT_CLAIMED' | 'OWNER_CONFIRMED' | 'EXPORT_VERIFIED';

export interface RazorpayExportRow {
  paymentId: string;
  amountINR: number;
  status: string;
  utr?: string;
  createdAt: string;
  settlementId?: string;
}

export interface ReconcileExportResult {
  totalProcessed: number;
  matchedCount: number;
  verifiedRevenueAddedINR: number;
  matchedPaymentIds: string[];
  unmatchedPaymentIds: string[];
}

export class PaymentTruthService {
  private static instance: PaymentTruthService;

  public static getInstance(): PaymentTruthService {
    if (!PaymentTruthService.instance) {
      PaymentTruthService.instance = new PaymentTruthService();
    }
    return PaymentTruthService.instance;
  }

  public ensureTable(): void {
    const db = getDb();
    try {
      db.prepare(`
        ALTER TABLE manual_upi_claims ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
      `).run();
    } catch {}

    try {
      db.prepare(`
        ALTER TABLE revenue_records ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0
      `).run();
    } catch {}

    db.prepare(`
      CREATE TABLE IF NOT EXISTS razorpay_export_records (
        id TEXT PRIMARY KEY,
        payment_id TEXT NOT NULL UNIQUE,
        amount_inr REAL NOT NULL,
        status TEXT NOT NULL,
        utr TEXT,
        settlement_id TEXT,
        reconciled INTEGER NOT NULL DEFAULT 0,
        reconciled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  }

  /**
   * State 1: PAYMENT_PAGE_VIEW
   * Logged as traffic only, never revenue.
   */
  public recordPageView(landingPage: string = '/offer', clientIpHash: string = 'unknown'): { state: 'PAYMENT_PAGE_VIEW'; isRevenue: false } {
    return { state: 'PAYMENT_PAGE_VIEW', isRevenue: false };
  }

  /**
   * State 2: PAYMENT_CLAIMED
   * Buyer reports a transaction UTR.
   * Recognized revenue = 0 until verified.
   */
  public registerClaim(claim: {
    businessId: string;
    utr: string;
    amountINR: number;
    serviceRendered?: string;
    notes?: string;
  }): { id: string; state: 'PAYMENT_CLAIMED'; isRevenue: false } {
    this.ensureTable();
    const db = getDb();
    const id = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const utr = String(claim.utr).trim();

    const existing = db.prepare(`SELECT id FROM manual_upi_claims WHERE utr = ?`).get(utr) as any;
    if (existing) {
      db.prepare(`
        UPDATE manual_upi_claims
        SET amount_inr = ?, service_rendered = ?, notes = ?
        WHERE utr = ?
      `).run(claim.amountINR, claim.serviceRendered || 'Lane B Service', claim.notes || null, utr);
      return { id: existing.id, state: 'PAYMENT_CLAIMED', isRevenue: false };
    } else {
      const id = `claim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO manual_upi_claims (
          id, organization_id, business_id, utr, amount_inr, service_rendered, notes,
          status, is_test, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAYMENT_CLAIMED', 0, datetime('now'))
      `).run(id, 'org_owner_primary', claim.businessId, utr, claim.amountINR, claim.serviceRendered || 'Lane B Service', claim.notes || null);
      return { id, state: 'PAYMENT_CLAIMED', isRevenue: false };
    }
  }

  /**
   * State 3: OWNER_CONFIRMED
   * Owner certifies receipt of funds in bank statement.
   * Recognized as verified revenue.
   */
  public confirmByOwner(confirmation: {
    utr: string;
    businessId: string;
    amountINR: number;
    ownerUserId: string;
    organizationId?: string;
    serviceRendered?: string;
  }): { state: 'OWNER_CONFIRMED'; isRevenue: true; amountINR: number; transactionId: string } {
    this.ensureTable();
    const db = getDb();
    const utr = String(confirmation.utr).trim();
    const now = new Date().toISOString();
    const orgId = confirmation.organizationId || 'org_owner_primary';

    // Update claim status
    db.prepare(`
      UPDATE manual_upi_claims
      SET status = 'OWNER_CONFIRMED',
          verified_at = ?,
          verified_by = ?
      WHERE utr = ?
    `).run(now, confirmation.ownerUserId, utr);

    // Ledger verified revenue record
    const existingRev = db.prepare(`SELECT id FROM revenue_records WHERE transaction_id = ?`).get(utr) as any;
    if (existingRev) {
      db.prepare(`
        UPDATE revenue_records
        SET verified = 1,
            classification = 'OWNER_CONFIRMED',
            verification_method = 'OWNER_CONFIRMED',
            amount_inr = ?
        WHERE transaction_id = ?
      `).run(confirmation.amountINR, utr);
    } else {
      const revId = `rev_own_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO revenue_records (
          id, organization_id, business_id, revenue_type, source,
          transaction_id, amount_inr, currency, verified,
          verification_method, classification, is_test, timestamp
        ) VALUES (
          ?, ?, ?, 'DIRECT_SALES', 'MANUAL_UPI',
          ?, ?, 'INR', 1,
          'OWNER_CONFIRMED', 'OWNER_CONFIRMED', 0, ?
        )
      `).run(revId, orgId, confirmation.businessId, utr, confirmation.amountINR, now);
    }

    return {
      state: 'OWNER_CONFIRMED',
      isRevenue: true,
      amountINR: confirmation.amountINR,
      transactionId: utr
    };
  }

  /**
   * State 4: EXPORT_VERIFIED
   * Reconciles official Razorpay export/settlement rows.
   * Recognizes verified revenue for matched captured transactions.
   */
  public reconcileRazorpayExport(rows: RazorpayExportRow[], orgId: string = 'org_owner_primary', bizId: string = 'biz_platform_aro'): ReconcileExportResult {
    this.ensureTable();
    const db = getDb();
    let matchedCount = 0;
    let verifiedRevenueAddedINR = 0;
    const matchedPaymentIds: string[] = [];
    const unmatchedPaymentIds: string[] = [];

    for (const row of rows) {
      const pid = String(row.paymentId).trim();
      const amount = Number(row.amountINR);
      const isPaid = (row.status || '').toLowerCase() === 'captured' || (row.status || '').toLowerCase() === 'paid';

      // Insert into export ledger
      db.prepare(`
        INSERT INTO razorpay_export_records (id, payment_id, amount_inr, status, utr, settlement_id, reconciled)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(payment_id) DO UPDATE SET
          status = excluded.status,
          utr = coalesce(excluded.utr, razorpay_export_records.utr)
      `).run(`rzpx_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, pid, amount, row.status, row.utr || null, row.settlementId || null);

      if (!isPaid || amount <= 0) {
        unmatchedPaymentIds.push(pid);
        continue;
      }

      // Check if already ledgered
      const existing = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).get(pid) as any;
      const now = new Date().toISOString();

      if (existing) {
        db.prepare(`
          UPDATE revenue_records
          SET verified = 1,
              classification = 'EXPORT_VERIFIED',
              verification_method = 'EXPORT_VERIFIED',
              amount_inr = ?
          WHERE transaction_id = ?
        `).run(amount, pid);
      } else {
        const revId = `rev_exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        db.prepare(`
          INSERT INTO revenue_records (
            id, organization_id, business_id, revenue_type, source,
            transaction_id, amount_inr, currency, verified,
            verification_method, classification, is_test, timestamp
          ) VALUES (
            ?, ?, ?, 'DIRECT_SALES', 'RAZORPAY_EXPORT',
            ?, ?, 'INR', 1,
            'EXPORT_VERIFIED', 'EXPORT_VERIFIED', 0, ?
          )
        `).run(revId, orgId, bizId, pid, amount, now);
      }

      db.prepare(`UPDATE razorpay_export_records SET reconciled = 1, reconciled_at = ? WHERE payment_id = ?`).run(now, pid);

      matchedCount++;
      verifiedRevenueAddedINR += amount;
      matchedPaymentIds.push(pid);
    }

    return {
      totalProcessed: rows.length,
      matchedCount,
      verifiedRevenueAddedINR,
      matchedPaymentIds,
      unmatchedPaymentIds
    };
  }

  /**
   * Allows owner to mark an order / transaction as TEST.
   * Test transactions are strictly excluded from verified revenue totals.
   */
  public markOrderTest(transactionIdOrUtr: string): { marked: boolean; transactionId: string } {
    this.ensureTable();
    const db = getDb();
    const id = String(transactionIdOrUtr).trim();

    db.prepare(`
      UPDATE revenue_records
      SET is_test = 1, classification = 'TEST'
      WHERE transaction_id = ?
    `).run(id);

    db.prepare(`
      UPDATE manual_upi_claims
      SET is_test = 1, status = 'TEST'
      WHERE utr = ?
    `).run(id);

    return { marked: true, transactionId: id };
  }

  /**
   * Computes the strictly verified revenue total.
   * Only OWNER_CONFIRMED and EXPORT_VERIFIED (and verified REAL non-test records) count.
   */
  public getVerifiedRevenueTotal(): number {
    this.ensureTable();
    const db = getDb();
    const row = db.prepare(`
      SELECT SUM(amount_inr) as total
      FROM revenue_records
      WHERE verified = 1
        AND is_test = 0
        AND classification IN ('OWNER_CONFIRMED', 'EXPORT_VERIFIED', 'REAL')
    `).get() as any;

    return Number(row?.total || 0);
  }
}
