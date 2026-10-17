-- Migration 0036: Manual UPI Claims & Payment Requests Audit Schema
CREATE TABLE IF NOT EXISTS manual_upi_claims (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  proposal_id TEXT,
  invoice_ref TEXT,
  payer_name TEXT,
  payer_phone TEXT,
  payer_vpa TEXT,
  utr TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  service_rendered TEXT,
  status TEXT NOT NULL DEFAULT 'PAYMENT_CLAIMED',
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verified_by TEXT,
  rejection_reason TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_manual_upi_utr ON manual_upi_claims(utr);
CREATE INDEX IF NOT EXISTS idx_manual_upi_status ON manual_upi_claims(status);
CREATE INDEX IF NOT EXISTS idx_manual_upi_proposal ON manual_upi_claims(proposal_id);
