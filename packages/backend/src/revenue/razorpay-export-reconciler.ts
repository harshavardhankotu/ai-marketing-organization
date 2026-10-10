import { ManualReconciliationResult, RazorpayPaymentExportRow } from './own-offer-types.js';
import { getDb } from '../db/client.js';

export const KNOWN_PAYMENT_EXPORT_COLUMNS = new Set([
  'payment_id',
  'entity',
  'amount',
  'currency',
  'status',
  'order_id',
  'invoice_id',
  'international',
  'method',
  'amount_refunded',
  'refund_status',
  'captured',
  'description',
  'card_id',
  'bank',
  'wallet',
  'vpa',
  'email',
  'contact',
  'notes',
  'fee',
  'tax',
  'error_code',
  'error_description',
  'created_at',
  'settled',
  'is_test'
]);

export interface RazorpayExportReconcilerOptions {
  upgradeThreshold?: number; // default 10
}

export class RazorpayExportReconciler {
  private static instance: RazorpayExportReconciler;
  private upgradeThreshold: number;

  constructor(options: RazorpayExportReconcilerOptions = {}) {
    const envThreshold = process.env.RAZORPAY_API_UPGRADE_THRESHOLD
      ? parseInt(process.env.RAZORPAY_API_UPGRADE_THRESHOLD, 10)
      : undefined;
    this.upgradeThreshold = options.upgradeThreshold || envThreshold || 10;
  }

  public static getInstance(): RazorpayExportReconciler {
    if (!RazorpayExportReconciler.instance) {
      RazorpayExportReconciler.instance = new RazorpayExportReconciler();
    }
    return RazorpayExportReconciler.instance;
  }

  public getUpgradeThreshold(): number {
    return this.upgradeThreshold;
  }

  public setUpgradeThreshold(threshold: number): void {
    if (threshold < 1) throw new Error('Threshold must be at least 1');
    this.upgradeThreshold = threshold;
  }

  /**
   * Validates CSV headers against strict known Razorpay export schema.
   * Throws an error listing all unknown columns if unrecognized fields are present.
   */
  public validateHeaders(headers: string[]): void {
    const unknownColumns: string[] = [];
    for (const h of headers) {
      const normalized = h.trim().toLowerCase().replace(/\s+/g, '_');
      if (!KNOWN_PAYMENT_EXPORT_COLUMNS.has(normalized)) {
        unknownColumns.push(h);
      }
    }
    if (unknownColumns.length > 0) {
      throw new Error(`UNKNOWN_COLUMNS_ERROR: Unrecognized column(s) in Razorpay export: ${unknownColumns.join(', ')}. Refusing to guess columns.`);
    }
  }

  /**
   * Reconciles a parsed batch of payment export rows into the durable ledger.
   * Invariants:
   * - No Razorpay API calls are made.
   * - Only 'captured' payments move to VERIFIED.
   * - Settled rows transition to PAID.
   * - Refunded rows reverse earlier revenue.
   * - TEST rows are excluded from KPIs.
   */
  public reconcileExportRows(
    rows: RazorpayPaymentExportRow[],
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): ManualReconciliationResult {
    const db = getDb();
    let verifiedCount = 0;
    let verifiedRevenueINR = 0;
    let paidCount = 0;
    let paidRevenueINR = 0;
    let refundedCount = 0;
    let refundedRevenueINR = 0;
    let testRowsExcluded = 0;
    const errors: string[] = [];

    db.exec(`
      CREATE TABLE IF NOT EXISTS manual_reconciled_payments (
        payment_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        amount_inr REAL NOT NULL,
        status TEXT NOT NULL,
        ledger_state TEXT NOT NULL,
        is_test INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT,
        settled_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    for (const row of rows) {
      try {
        // 1. Check if marked TEST (by flag or note)
        const hasTestNote = row.notes && Object.values(row.notes).some(n => n.toUpperCase().includes('TEST'));
        const isTestRow = Boolean(row.isTest || hasTestNote);
        if (isTestRow) {
          testRowsExcluded++;
          // Persist as TEST row, excluded from revenue
          db.prepare(`
            INSERT INTO manual_reconciled_payments (
              payment_id, organization_id, business_id, amount_inr, status, ledger_state, is_test, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'TEST_IGNORED', 1, ?, datetime('now'))
            ON CONFLICT(payment_id) DO UPDATE SET ledger_state = 'TEST_IGNORED', is_test = 1, updated_at = datetime('now')
          `).run(row.paymentId, organizationId, businessId, row.amountINR, row.status, row.createdAt);
          continue;
        }

        // 2. Handle REFUND
        if (row.status === 'refunded') {
          refundedCount++;
          refundedRevenueINR += row.amountINR;

          db.prepare(`
            INSERT INTO manual_reconciled_payments (
              payment_id, organization_id, business_id, amount_inr, status, ledger_state, is_test, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'refunded', 'REFUNDED_REVERSED', 0, ?, datetime('now'))
            ON CONFLICT(payment_id) DO UPDATE SET status = 'refunded', ledger_state = 'REFUNDED_REVERSED', updated_at = datetime('now')
          `).run(row.paymentId, organizationId, businessId, row.amountINR, row.createdAt);

          // Reverse in revenue_records
          db.prepare(`
            INSERT INTO revenue_records (
              id, organization_id, business_id, revenue_type, source, transaction_id,
              amount_inr, currency, verified, verification_method, classification, timestamp
            ) VALUES (?, ?, ?, 'OWN_OFFER_REVERSAL', 'RAZORPAY_EXPORT_REFUND', ?, ?, 'INR', 1, 'MANUAL_EXPORT', 'REAL', datetime('now'))
          `).run(`rev_refund_${row.paymentId}`, organizationId, businessId, row.paymentId, -row.amountINR);
          continue;
        }

        // 3. Handle CAPTURED (moves EXPECTED -> VERIFIED)
        if (row.captured || row.status === 'captured') {
          const isSettled = Boolean(row.settled);
          const ledgerState = isSettled ? 'PAID' : 'VERIFIED';

          if (isSettled) {
            paidCount++;
            paidRevenueINR += row.amountINR;
          } else {
            verifiedCount++;
            verifiedRevenueINR += row.amountINR;
          }

          db.prepare(`
            INSERT INTO manual_reconciled_payments (
              payment_id, organization_id, business_id, amount_inr, status, ledger_state, is_test, captured_at, settled_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'captured', ?, 0, ?, ?, ?, datetime('now'))
            ON CONFLICT(payment_id) DO UPDATE SET
              ledger_state = excluded.ledger_state,
              status = 'captured',
              settled_at = excluded.settled_at,
              updated_at = datetime('now')
          `).run(
            row.paymentId,
            organizationId,
            businessId,
            row.amountINR,
            ledgerState,
            row.createdAt,
            isSettled ? new Date().toISOString() : null,
            row.createdAt
          );

          // Record in revenue_records as VERIFIED
          db.prepare(`
            INSERT OR REPLACE INTO revenue_records (
              id, organization_id, business_id, revenue_type, source, transaction_id,
              amount_inr, currency, verified, verification_method, classification, timestamp
            ) VALUES (?, ?, ?, 'OWN_OFFER_SALES', 'RAZORPAY_EXPORT', ?, ?, 'INR', 1, 'MANUAL_EXPORT', 'REAL', ?)
          `).run(`rev_rzp_${row.paymentId}`, organizationId, businessId, row.paymentId, row.amountINR, row.createdAt);
        }
      } catch (err: any) {
        errors.push(`Row ${row.paymentId}: ${err.message}`);
      }
    }

    return {
      rowsProcessed: rows.length,
      verifiedCount,
      verifiedRevenueINR,
      paidCount,
      paidRevenueINR,
      refundedCount,
      refundedRevenueINR,
      testRowsExcluded,
      errors
    };
  }

  /**
   * Returns upgrade status to advise owner when verified manual payments cross threshold.
   */
  public getApiUpgradeStatus(totalVerifiedCount: number): {
    currentVerified: number;
    threshold: number;
    upgradeRecommended: boolean;
    actionItem: string | null;
  } {
    const upgradeRecommended = totalVerifiedCount >= this.upgradeThreshold;
    return {
      currentVerified: totalVerifiedCount,
      threshold: this.upgradeThreshold,
      upgradeRecommended,
      actionItem: upgradeRecommended ? 'Attach Razorpay API keys and webhook' : null
    };
  }
}
