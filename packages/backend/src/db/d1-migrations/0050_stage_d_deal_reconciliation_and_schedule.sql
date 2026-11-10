-- D1 Migration 0050: Stage D Deal Reconciliation, Scheduling & Integrity Cleanup
-- 1. Reset synthetic scores on example.com in site_audits
UPDATE site_audits
SET performance_score = NULL,
    seo_score = NULL,
    accessibility_score = NULL,
    best_practices_score = NULL,
    fcp_ms = NULL,
    lcp_ms = NULL,
    cls_score = NULL,
    pagespeed_status = 'UNAVAILABLE',
    pagespeed_unavailable_reason = 'NO_PAGESPEED_API_KEY',
    updated_at = datetime('now')
WHERE domain = 'example.com';

-- 2. Neutralize 5 Stage-B auto-flagged outreach rows in direct_outreach_log
UPDATE direct_outreach_log
SET human_approved = 0
WHERE human_approved = 1 AND dispatched = 0;

-- 3. Set commercial workflows (affiliate_offer_reconciliation & daily_market_demand_research) to 60m cadence, due immediately
UPDATE automation_registry
SET cadence_minutes = 60,
    next_scheduled_at = datetime('now'),
    updated_at = datetime('now')
WHERE id IN ('affiliate_offer_reconciliation', 'daily_market_demand_research');

-- 4. Set 4 low-value workflows to 360m cadence to eliminate cron starvation
UPDATE automation_registry
SET cadence_minutes = 360,
    updated_at = datetime('now')
WHERE id IN (
  'authorized_outreach_dispatch',
  'new_inquiry_processing',
  'reply_classification_followup',
  'proposal_prep_followup'
);

-- 5. Seed unmonetized deal candidates into public_deals from workflows for Stage D reconciliation
INSERT OR IGNORE INTO public_deals (
  id, slug, canonical_slug, title, brand, merchant, category, sector_code,
  product_url, current_price_inr, reference_price_inr, discount_percent,
  availability, verification_status, deal_kind, evidence_json,
  is_monetizable, discount_verification_type, product_verified, affiliate_verified,
  created_at, updated_at
)
SELECT
  w.id,
  COALESCE(json_extract(w.inputs_json, '$.slug'), w.id),
  COALESCE(json_extract(w.inputs_json, '$.canonicalSlug'), json_extract(w.inputs_json, '$.slug'), w.id),
  COALESCE(json_extract(w.inputs_json, '$.title'), 'Untitled Deal'),
  json_extract(w.inputs_json, '$.brand'),
  COALESCE(json_extract(w.inputs_json, '$.merchant'), 'Unknown Merchant'),
  COALESCE(json_extract(w.inputs_json, '$.category'), 'General'),
  CASE
    WHEN json_extract(w.inputs_json, '$.category') LIKE '%Electronic%' THEN 'ELECTRONICS'
    WHEN json_extract(w.inputs_json, '$.category') LIKE '%Fashion%' OR json_extract(w.inputs_json, '$.category') LIKE '%Beauty%' THEN 'FASHION'
    WHEN json_extract(w.inputs_json, '$.category') LIKE '%Travel%' THEN 'TRAVEL'
    WHEN json_extract(w.inputs_json, '$.category') LIKE '%Home%' THEN 'HOME_KITCHEN'
    WHEN json_extract(w.inputs_json, '$.category') LIKE '%Health%' THEN 'HEALTH_WELLNESS'
    ELSE 'GENERAL'
  END,
  json_extract(w.inputs_json, '$.productUrl'),
  CAST(COALESCE(json_extract(w.inputs_json, '$.currentPriceINR'), 0) AS REAL),
  CAST(json_extract(w.inputs_json, '$.referencePriceINR') AS REAL),
  CAST(json_extract(w.inputs_json, '$.claimedDiscountPercent') AS REAL),
  COALESCE(json_extract(w.inputs_json, '$.availability'), 'IN_STOCK'),
  'CANDIDATE',
  COALESCE(json_extract(w.inputs_json, '$.dealKind'), 'PRODUCT'),
  '{"source":"STAGE_D_MIGRATION_CANDIDATE"}',
  0,
  'UNCONFIRMED',
  1,
  0,
  datetime('now'),
  datetime('now')
FROM workflows w
WHERE w.workflow_type = 'PUBLIC_DEAL'
  AND w.status = 'VERIFIED'
  AND json_extract(w.inputs_json, '$.productUrl') IS NOT NULL
  AND CAST(json_extract(w.inputs_json, '$.currentPriceINR') AS REAL) > 0;
