-- 0006_production_public_funnel.sql
-- Production Demand-Capture Funnels for Authoritative Business Profiles

INSERT OR IGNORE INTO funnels (
  id, business_id, organization_id, public_slug, status, funnel_type,
  objective, headline, subheadline, proof_points_json, offer_ids_json,
  cta_strategy, payment_strategy, currency
) VALUES (
  'fnl_smilekraft_main', 'biz_smilekraft_hyd', 'org_smilekraft_01', 'main', 'ACTIVE', 'UNIVERSAL',
  'LEAD_CAPTURE', 'SmileKraft Dental Clinic Hyderabad — Invisible Clear Aligners & Orthodontics',
  'Serving Banjara Hills, Hyderabad with advanced 3D digital smile design.',
  '["AI 3D Smile Scanning", "Zero-Cost EMI Financing"]',
  '[]', 'BOOK_OR_BUY', 'OPTIONAL', 'INR'
);

INSERT OR IGNORE INTO funnels (
  id, business_id, organization_id, public_slug, status, funnel_type,
  objective, headline, subheadline, proof_points_json, offer_ids_json,
  cta_strategy, payment_strategy, currency
) VALUES (
  'fnl_smilekraft_makeover', 'biz_smilekraft_hyd', 'org_smilekraft_01', 'smile-makeover', 'ACTIVE', 'UNIVERSAL',
  'LEAD_CAPTURE', 'SmileKraft Dental Clinic Hyderabad — Invisible Clear Aligners & Orthodontics',
  'Serving Banjara Hills, Hyderabad with advanced 3D digital smile design.',
  '["AI 3D Smile Scanning", "Zero-Cost EMI Financing"]',
  '[]', 'BOOK_OR_BUY', 'OPTIONAL', 'INR'
);

INSERT OR IGNORE INTO funnels (
  id, business_id, organization_id, public_slug, status, funnel_type,
  objective, headline, subheadline, proof_points_json, offer_ids_json,
  cta_strategy, payment_strategy, currency
) VALUES (
  'fnl_platform_main', 'biz_platform_aro', 'org_owner_primary', 'main', 'ACTIVE', 'UNIVERSAL',
  'LEAD_CAPTURE', 'Platform Autonomous Revenue System',
  'Autonomous inbound lead triage and appointment booking.',
  '["24/7 Response under 2 minutes", "Zero ad spend required"]',
  '[]', 'BOOK_OR_BUY', 'OPTIONAL', 'INR'
);
