-- 0008_seed_default_customer_offers.sql
-- Money fix: 0006 seeded funnels with offer_ids_json='[]' and no customer_offers,
-- so OfferDecisionEngine returned INELIGIBLE and checkout could never charge.
-- Seed minimal real offers and link them to funnels.

INSERT OR IGNORE INTO customer_offers (
  id, business_id, organization_id, title, description, category,
  price_minor, currency, billing_model, target_segment,
  fulfillment_type, active
) VALUES
  ('coff_smilekraft_consult_500', 'biz_smilekraft_hyd', 'org_smilekraft_01',
   'Dental Consultation & Assessment', 'Chair-side consultation with treatment plan.',
   'GENERAL', 50000, 'INR', 'ONE_TIME', 'General', 'SERVICE_DELIVERY', 1),
  ('coff_smilekraft_aligners_45000', 'biz_smilekraft_hyd', 'org_smilekraft_01',
   'Invisible Clear Aligners - Phase 1', '3D smile scan + aligner phase 1.',
   'GENERAL', 4500000, 'INR', 'ONE_TIME', 'General', 'SERVICE_DELIVERY', 1),
  ('coff_platform_setup_15000', 'biz_platform_aro', 'org_owner_primary',
   'AI Inbound Lead Conversion System - Setup', 'Day 0-5 setup and integration.',
   'GENERAL', 1500000, 'INR', 'ONE_TIME', 'General', 'SERVICE_DELIVERY', 1);

UPDATE funnels SET offer_ids_json = '["coff_smilekraft_consult_500","coff_smilekraft_aligners_45000"]'
WHERE id IN ('fnl_smilekraft_main', 'fnl_smilekraft_makeover');

UPDATE funnels SET offer_ids_json = '["coff_platform_setup_15000"]'
WHERE id = 'fnl_platform_main';
