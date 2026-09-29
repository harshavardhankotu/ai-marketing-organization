-- 0004_universal_commercial_os.sql
-- Universal Commercial Operating System: Funnels, Customer Offers, Scheduling, Universal Orders & Fulfillment

-- 1. Businesses Table Universal Columns
ALTER TABLE businesses ADD COLUMN locale TEXT DEFAULT 'en-US';
ALTER TABLE businesses ADD COLUMN email TEXT;
ALTER TABLE businesses ADD COLUMN service_area_json TEXT DEFAULT '[]';

-- 2. Funnels (First-class Universal Demand Capture Funnels)
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  public_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DRAFT | ARCHIVED
  funnel_type TEXT NOT NULL DEFAULT 'UNIVERSAL',
  objective TEXT NOT NULL,
  target_intent TEXT,
  audience TEXT,
  headline TEXT,
  subheadline TEXT,
  proof_points_json TEXT NOT NULL DEFAULT '[]',
  offer_ids_json TEXT NOT NULL DEFAULT '[]',
  cta_strategy TEXT NOT NULL DEFAULT 'BOOK_OR_BUY',
  qualification_strategy TEXT,
  scheduling_strategy TEXT,
  payment_strategy TEXT NOT NULL DEFAULT 'OPTIONAL', -- REQUIRED | DEPOSIT | OPTIONAL | NONE
  language TEXT NOT NULL DEFAULT 'en',
  currency TEXT NOT NULL DEFAULT 'INR',
  design_config_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(business_id, public_slug)
);
CREATE INDEX IF NOT EXISTS idx_funnels_biz ON funnels(business_id);
CREATE INDEX IF NOT EXISTS idx_funnels_slug ON funnels(public_slug);

-- 3. Customer Offers (Offers sold by client businesses to their customers - completely decoupled from Platform Offers)
CREATE TABLE IF NOT EXISTS customer_offers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'GENERAL',
  price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_model TEXT NOT NULL DEFAULT 'ONE_TIME', -- ONE_TIME | MONTHLY | ANNUAL | DEPOSIT | USAGE | CUSTOM
  deposit_minor INTEGER,
  target_segment TEXT,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  qualification_rules_json TEXT NOT NULL DEFAULT '[]',
  availability_rules_json TEXT NOT NULL DEFAULT '{}',
  fulfillment_type TEXT NOT NULL DEFAULT 'SERVICE_DELIVERY', -- APPOINTMENT | SERVICE_DELIVERY | DIGITAL | SHIPMENT | SUBSCRIPTION | CONSULTATION
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cust_offers_biz ON customer_offers(business_id);

-- 4. Availability Slots (Universal Resource & Scheduling Engine)
CREATE TABLE IF NOT EXISTS availability_slots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  resource_id TEXT,
  resource_type TEXT NOT NULL DEFAULT 'STAFF', -- STAFF | PRACTITIONER | ROOM | TABLE | VEHICLE | VIRTUAL
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_avail_slots_biz_time ON availability_slots(business_id, start_time, end_time);

-- 5. Booking Reservations (Universal Appointment / Table / Service Reservations)
CREATE TABLE IF NOT EXISTS booking_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  customer_email TEXT,
  service_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION', -- PENDING_CONFIRMATION | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_booking_res_biz ON booking_reservations(business_id);

-- 6. Universal Orders (Server-authoritative Order Lifecycle)
CREATE TABLE IF NOT EXISTS universal_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  funnel_id TEXT,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CHECKOUT', -- QUOTE | CHECKOUT | ORDER | PAYMENT_PENDING | PAID | FULFILLMENT | COMPLETED | CANCELLED | REFUNDED
  payment_provider TEXT, -- RAZORPAY | STRIPE | MANUAL
  provider_order_id TEXT,
  provider_payment_id TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SCHEDULED | IN_PROGRESS | DELIVERED | ACKNOWLEDGED
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_uorders_biz ON universal_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_uorders_prov_order ON universal_orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_uorders_status ON universal_orders(status);

-- 7. Fulfillment Tasks (Execution, Delivery Tracking & SLA)
CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL,
  assigned_owner TEXT,
  sla_hours INTEGER NOT NULL DEFAULT 24,
  state TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED | BLOCKED
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES universal_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fulfill_tasks_order ON fulfillment_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_tasks_biz ON fulfillment_tasks(business_id);
