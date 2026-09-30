-- 0005_revenue_neutrality_and_tenancy.sql
-- Universal Commercial OS Hardening: Currency Neutrality, Recovery States, Integration Mappings

-- 1. Currency Neutrality for Revenue Records
ALTER TABLE revenue_records ADD COLUMN amount_minor INTEGER;

-- 2. Failure Recovery State Tracking for Universal Orders
ALTER TABLE universal_orders ADD COLUMN offer_title TEXT;
ALTER TABLE universal_orders ADD COLUMN recovery_state TEXT;
ALTER TABLE universal_orders ADD COLUMN failure_reason TEXT;

-- 3. Integration Phone Mappings for Multi-Tenant Messaging (WhatsApp/SMS)
CREATE TABLE IF NOT EXISTS integration_phone_mappings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'WHATSAPP',
  external_phone_number_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE(provider, external_phone_number_id)
);
CREATE INDEX IF NOT EXISTS idx_phone_map_provider ON integration_phone_mappings(provider, external_phone_number_id);
