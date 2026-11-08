# 04_workflows.md

### Query: SELECT id, name, category, enabled, trigger_type, cadence_minutes, timezone, last_started_at, last_completed_at, last_status, last_error FROM automation_registry ORDER BY id ASC;
UTC Timestamp: 2026-11-08T06:40:40.268Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.42ms
[
  {
    "results": [
      {
        "id": "affiliate_offer_reconciliation",
        "name": "Affiliate Offer & Tracking Reconciliation",
        "category": "COMMERCIAL",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 360,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 17:34:48",
        "last_completed_at": "2026-11-03 17:34:52",
        "last_status": "COMPLETED_NO_FINDINGS",
        "last_error": null
      },
      {
        "id": "authorized_outreach_dispatch",
        "name": "Authorized Outreach Dispatch",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 03:02:08",
        "last_completed_at": "2026-11-08 03:02:09",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "b2b_suppression_and_compliance_audit",
        "name": "B2B Suppression and DPDP Retention Audit",
        "category": "SYSTEM",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 720,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 03:02:02",
        "last_completed_at": "2026-11-08 03:02:02",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "competitor_pricing_research",
        "name": "Competitor and Pricing Research",
        "category": "RESEARCH",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 1440,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 02:03:36",
        "last_completed_at": "2026-11-03 02:03:37",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "content_freshness_verification",
        "name": "Content Freshness & Public Link Verification",
        "category": "COMMERCIAL",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 720,
        "timezone": "UTC",
        "last_started_at": "2026-11-02 19:03:47",
        "last_completed_at": "2026-11-02 19:03:47",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "daily_commercial_summary",
        "name": "Daily Commercial Summary",
        "category": "ACCOUNTING",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 1440,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 17:35:23",
        "last_completed_at": "2026-11-03 17:35:24",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "daily_market_demand_research",
        "name": "Daily Market-Demand Research",
        "category": "RESEARCH",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 00:02:51",
        "last_completed_at": "2026-11-03 00:03:48",
        "last_status": "COMPLETED_NO_FINDINGS",
        "last_error": null
      },
      {
        "id": "healthcare_claim_verification",
        "name": "Healthcare Claim & Evidence Verification",
        "category": "SYSTEM",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 1440,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 03:01:55",
        "last_completed_at": "2026-11-08 03:01:56",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "multi_market_lead_qualification",
        "name": "Multi-Market Lead Qualification & Scoring",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 360,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 17:35:10",
        "last_completed_at": "2026-11-03 17:35:10",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "new_inquiry_processing",
        "name": "New-Inquiry Processing",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 06:02:07",
        "last_completed_at": "2026-11-08 06:02:08",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "outreach_draft_preparation",
        "name": "Outreach Draft Preparation",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 360,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 02:03:30",
        "last_completed_at": "2026-11-03 02:03:31",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "owner_approval_queue_generation",
        "name": "Owner Approval Queue Generation",
        "category": "COMMERCIAL",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 07:02:42",
        "last_completed_at": "2026-11-03 07:02:49",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "payment_status_reconciliation",
        "name": "Payment-Status Reconciliation",
        "category": "ACCOUNTING",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 06:02:02",
        "last_completed_at": "2026-11-08 06:02:02",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "proposal_prep_followup",
        "name": "Proposal Preparation and Follow-Up",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 360,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 17:35:16",
        "last_completed_at": "2026-11-03 17:35:17",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "prospect_dedup_qualification",
        "name": "Prospect Deduplication and Qualification",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 360,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 02:03:26",
        "last_completed_at": "2026-11-03 02:03:27",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "prospect_discovery_validation",
        "name": "Prospect Discovery and Evidence Validation",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 720,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 05:03:15",
        "last_completed_at": "2026-11-03 05:03:26",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "quota_health_checks",
        "name": "Quota, Error & Automation-Health Checks",
        "category": "SYSTEM",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 60,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 06:01:55",
        "last_completed_at": "2026-11-08 06:01:56",
        "last_status": "COMPLETED",
        "last_error": null
      },
      {
        "id": "reply_classification_followup",
        "name": "Reply Classification & Follow-Up Preparation",
        "category": "SALES_PIPELINE",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 120,
        "timezone": "UTC",
        "last_started_at": "2026-11-08 02:02:05",
        "last_completed_at": "2026-11-08 02:02:06",
        "last_status": "NO_ACTION_DUE",
        "last_error": null
      },
      {
        "id": "seasonal_demand_research",
        "name": "Seasonal Demand & Festival Deal Research",
        "category": "COMMERCIAL",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 720,
        "timezone": "UTC",
        "last_started_at": null,
        "last_completed_at": null,
        "last_status": "IDLE",
        "last_error": null
      },
      {
        "id": "seo_keyword_research",
        "name": "SEO Keyword & Organic Intent Research",
        "category": "RESEARCH",
        "enabled": 1,
        "trigger_type": "CRON",
        "cadence_minutes": 720,
        "timezone": "UTC",
        "last_started_at": "2026-11-03 17:34:58",
        "last_completed_at": "2026-11-03 17:35:03",
        "last_status": "COMPLETED",
        "last_error": null
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4242
      },
      "duration": 0.4242,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 20,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT workflow_id, trigger_source, status, started_at, completed_at, duration_ms, items_processed, items_succeeded, items_failed, error_message FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY started_at DESC) as rn FROM automation_execution_log) WHERE rn <= 5 ORDER BY workflow_id, started_at DESC;
UTC Timestamp: 2026-11-08T06:40:45.899Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 5.29ms
[
  {
    "results": [
      {
        "workflow_id": "affiliate_offer_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-11-03T17:34:48.373Z",
        "completed_at": "2026-11-03T17:34:52.482Z",
        "duration_ms": 4109,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "affiliate_offer_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "PARTIAL",
        "started_at": "2026-11-03T01:02:25.449Z",
        "completed_at": "2026-11-03T01:03:14.815Z",
        "duration_ms": 49366,
        "items_processed": 1,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "affiliate_offer_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "PARTIAL",
        "started_at": "2026-11-02T17:04:18.249Z",
        "completed_at": "2026-11-02T17:05:08.519Z",
        "duration_ms": 50270,
        "items_processed": 1,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "affiliate_offer_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "PARTIAL",
        "started_at": "2026-11-02T09:03:00.238Z",
        "completed_at": "2026-11-02T09:03:46.678Z",
        "duration_ms": 46439,
        "items_processed": 1,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "affiliate_offer_reconciliation",
        "trigger_source": "MANUAL_PING",
        "status": "PARTIAL",
        "started_at": "2026-11-02T02:32:59.524Z",
        "completed_at": "2026-11-02T02:33:00.325Z",
        "duration_ms": 801,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 1,
        "error_message": null
      },
      {
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T03:02:07.907Z",
        "completed_at": "2026-11-08T03:02:08.770Z",
        "duration_ms": 863,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T01:02:00.184Z",
        "completed_at": "2026-11-08T01:02:00.958Z",
        "duration_ms": 774,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T23:01:55.439Z",
        "completed_at": "2026-11-07T23:01:56.203Z",
        "duration_ms": 764,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T20:02:05.665Z",
        "completed_at": "2026-11-07T20:02:06.481Z",
        "duration_ms": 816,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T18:02:00.955Z",
        "completed_at": "2026-11-07T18:02:01.696Z",
        "duration_ms": 741,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T03:02:01.806Z",
        "completed_at": "2026-11-08T03:02:02.341Z",
        "duration_ms": 535,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T01:01:54.671Z",
        "completed_at": "2026-11-08T01:01:55.059Z",
        "duration_ms": 388,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T22:02:06.859Z",
        "completed_at": "2026-11-07T22:02:07.289Z",
        "duration_ms": 430,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T20:02:00.221Z",
        "completed_at": "2026-11-07T20:02:00.581Z",
        "duration_ms": 360,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T18:01:55.096Z",
        "completed_at": "2026-11-07T18:01:55.655Z",
        "duration_ms": 559,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "competitor_pricing_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:36.434Z",
        "completed_at": "2026-11-03T02:03:36.887Z",
        "duration_ms": 453,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "competitor_pricing_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T00:02:53.791Z",
        "completed_at": "2026-11-02T00:02:54.191Z",
        "duration_ms": 400,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "competitor_pricing_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-31T23:03:59.735Z",
        "completed_at": "2026-10-31T23:04:00.102Z",
        "duration_ms": 367,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "competitor_pricing_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-30T22:04:04.261Z",
        "completed_at": "2026-10-30T22:04:04.914Z",
        "duration_ms": 653,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "competitor_pricing_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-29T21:04:05.426Z",
        "completed_at": "2026-10-29T21:04:05.961Z",
        "duration_ms": 535,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "content_freshness_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T19:03:47.138Z",
        "completed_at": "2026-11-02T19:03:47.574Z",
        "duration_ms": 436,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "content_freshness_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T06:03:35.306Z",
        "completed_at": "2026-11-02T06:03:35.716Z",
        "duration_ms": 410,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "content_freshness_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-01T17:03:02.199Z",
        "completed_at": "2026-11-01T17:03:02.667Z",
        "duration_ms": 468,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "content_freshness_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-01T04:03:43.724Z",
        "completed_at": "2026-11-01T04:03:44.120Z",
        "duration_ms": 396,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "content_freshness_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-31T15:04:31.007Z",
        "completed_at": "2026-10-31T15:04:31.397Z",
        "duration_ms": 390,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_commercial_summary",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T17:35:22.903Z",
        "completed_at": "2026-11-03T17:35:24.253Z",
        "duration_ms": 1350,
        "items_processed": 4,
        "items_succeeded": 4,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_commercial_summary",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:42.543Z",
        "completed_at": "2026-11-03T02:03:43.113Z",
        "duration_ms": 570,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_commercial_summary",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T00:02:56.200Z",
        "completed_at": "2026-11-02T00:02:56.614Z",
        "duration_ms": 414,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_commercial_summary",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-31T23:04:02.091Z",
        "completed_at": "2026-10-31T23:04:02.489Z",
        "duration_ms": 398,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_commercial_summary",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-10-30T22:04:07.064Z",
        "completed_at": "2026-10-30T22:04:07.630Z",
        "duration_ms": 566,
        "items_processed": 1,
        "items_succeeded": 1,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "daily_market_demand_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-11-03T00:02:51.411Z",
        "completed_at": "2026-11-03T00:03:47.998Z",
        "duration_ms": 56587,
        "items_processed": 2,
        "items_succeeded": 0,
        "items_failed": 2,
        "error_message": null
      },
      {
        "workflow_id": "daily_market_demand_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-11-01T23:03:04.771Z",
        "completed_at": "2026-11-01T23:03:23.813Z",
        "duration_ms": 19042,
        "items_processed": 2,
        "items_succeeded": 0,
        "items_failed": 2,
        "error_message": null
      },
      {
        "workflow_id": "daily_market_demand_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-10-31T22:03:10.506Z",
        "completed_at": "2026-10-31T22:03:24.528Z",
        "duration_ms": 14022,
        "items_processed": 2,
        "items_succeeded": 0,
        "items_failed": 2,
        "error_message": null
      },
      {
        "workflow_id": "daily_market_demand_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-10-30T21:04:11.425Z",
        "completed_at": "2026-10-30T21:05:14.047Z",
        "duration_ms": 62622,
        "items_processed": 2,
        "items_succeeded": 0,
        "items_failed": 2,
        "error_message": null
      },
      {
        "workflow_id": "daily_market_demand_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED_NO_FINDINGS",
        "started_at": "2026-10-29T20:04:31.234Z",
        "completed_at": "2026-10-29T20:05:22.114Z",
        "duration_ms": 50880,
        "items_processed": 2,
        "items_succeeded": 0,
        "items_failed": 2,
        "error_message": null
      },
      {
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T03:01:55.551Z",
        "completed_at": "2026-11-08T03:01:55.923Z",
        "duration_ms": 372,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T00:02:07.465Z",
        "completed_at": "2026-11-08T00:02:07.931Z",
        "duration_ms": 466,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T22:02:01.328Z",
        "completed_at": "2026-11-07T22:02:01.719Z",
        "duration_ms": 391,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T20:01:54.795Z",
        "completed_at": "2026-11-07T20:01:55.195Z",
        "duration_ms": 400,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T17:01:24.462Z",
        "completed_at": "2026-11-07T17:01:24.853Z",
        "duration_ms": 391,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "multi_market_lead_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T17:35:09.719Z",
        "completed_at": "2026-11-03T17:35:10.187Z",
        "duration_ms": 468,
        "items_processed": 7,
        "items_succeeded": 7,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "multi_market_lead_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:33.629Z",
        "completed_at": "2026-11-03T02:03:34.122Z",
        "duration_ms": 493,
        "items_processed": 7,
        "items_succeeded": 7,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "multi_market_lead_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T18:02:52.585Z",
        "completed_at": "2026-11-02T18:02:53.026Z",
        "duration_ms": 441,
        "items_processed": 7,
        "items_succeeded": 7,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "multi_market_lead_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T11:02:49.821Z",
        "completed_at": "2026-11-02T11:02:50.183Z",
        "duration_ms": 362,
        "items_processed": 7,
        "items_succeeded": 7,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "multi_market_lead_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T04:03:13.043Z",
        "completed_at": "2026-11-02T04:03:13.417Z",
        "duration_ms": 374,
        "items_processed": 7,
        "items_succeeded": 7,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T06:02:07.371Z",
        "completed_at": "2026-11-08T06:02:08.084Z",
        "duration_ms": 713,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T05:01:02.272Z",
        "completed_at": "2026-11-08T05:01:03.049Z",
        "duration_ms": 777,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:01:59.304Z",
        "completed_at": "2026-11-08T02:02:00.113Z",
        "duration_ms": 809,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T00:01:55.311Z",
        "completed_at": "2026-11-08T00:01:56.065Z",
        "duration_ms": 754,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T21:02:07.923Z",
        "completed_at": "2026-11-07T21:02:08.677Z",
        "duration_ms": 754,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "outreach_draft_preparation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:29.944Z",
        "completed_at": "2026-11-03T02:03:31.145Z",
        "duration_ms": 1201,
        "items_processed": 30,
        "items_succeeded": 30,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "outreach_draft_preparation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T20:02:49.933Z",
        "completed_at": "2026-11-02T20:02:50.804Z",
        "duration_ms": 871,
        "items_processed": 30,
        "items_succeeded": 30,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "outreach_draft_preparation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T13:03:24.229Z",
        "completed_at": "2026-11-02T13:03:25.203Z",
        "duration_ms": 974,
        "items_processed": 30,
        "items_succeeded": 30,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "outreach_draft_preparation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T06:03:32.427Z",
        "completed_at": "2026-11-02T06:03:33.200Z",
        "duration_ms": 773,
        "items_processed": 30,
        "items_succeeded": 30,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "outreach_draft_preparation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-01T23:03:01.918Z",
        "completed_at": "2026-11-01T23:03:02.701Z",
        "duration_ms": 783,
        "items_processed": 10,
        "items_succeeded": 10,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "owner_approval_queue_generation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T07:02:42.541Z",
        "completed_at": "2026-11-03T07:02:49.041Z",
        "duration_ms": 6500,
        "items_processed": 20,
        "items_succeeded": 20,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "owner_approval_queue_generation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T05:02:56.752Z",
        "completed_at": "2026-11-03T05:03:03.444Z",
        "duration_ms": 6692,
        "items_processed": 20,
        "items_succeeded": 20,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "owner_approval_queue_generation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:06.379Z",
        "completed_at": "2026-11-03T02:03:13.684Z",
        "duration_ms": 7305,
        "items_processed": 20,
        "items_succeeded": 20,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "owner_approval_queue_generation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T01:02:06.624Z",
        "completed_at": "2026-11-03T01:02:13.528Z",
        "duration_ms": 6904,
        "items_processed": 20,
        "items_succeeded": 20,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "owner_approval_queue_generation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T23:02:58.381Z",
        "completed_at": "2026-11-02T23:03:06.683Z",
        "duration_ms": 8302,
        "items_processed": 20,
        "items_succeeded": 20,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T06:02:01.748Z",
        "completed_at": "2026-11-08T06:02:02.593Z",
        "duration_ms": 845,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T05:00:56.416Z",
        "completed_at": "2026-11-08T05:00:57.190Z",
        "duration_ms": 774,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:01:53.716Z",
        "completed_at": "2026-11-08T02:01:54.450Z",
        "duration_ms": 734,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T23:02:08.630Z",
        "completed_at": "2026-11-07T23:02:09.359Z",
        "duration_ms": 729,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T21:02:01.969Z",
        "completed_at": "2026-11-07T21:02:02.746Z",
        "duration_ms": 777,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "proposal_prep_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-03T17:35:15.857Z",
        "completed_at": "2026-11-03T17:35:16.760Z",
        "duration_ms": 903,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "proposal_prep_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T03:03:20.518Z",
        "completed_at": "2026-11-03T03:03:21.378Z",
        "duration_ms": 860,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "proposal_prep_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T20:02:53.017Z",
        "completed_at": "2026-11-02T20:02:53.927Z",
        "duration_ms": 910,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "proposal_prep_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T13:03:27.498Z",
        "completed_at": "2026-11-02T13:03:28.461Z",
        "duration_ms": 963,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "proposal_prep_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T06:03:43.170Z",
        "completed_at": "2026-11-02T06:03:43.932Z",
        "duration_ms": 762,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_dedup_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T02:03:26.580Z",
        "completed_at": "2026-11-03T02:03:27.546Z",
        "duration_ms": 966,
        "items_processed": 1209,
        "items_succeeded": 1209,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_dedup_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T19:03:43.784Z",
        "completed_at": "2026-11-02T19:03:44.695Z",
        "duration_ms": 911,
        "items_processed": 1209,
        "items_succeeded": 1209,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_dedup_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T12:03:49.991Z",
        "completed_at": "2026-11-02T12:03:50.723Z",
        "duration_ms": 732,
        "items_processed": 1209,
        "items_succeeded": 1209,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_dedup_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-02T06:03:29.518Z",
        "completed_at": "2026-11-02T06:03:30.280Z",
        "duration_ms": 762,
        "items_processed": 1209,
        "items_succeeded": 1209,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_dedup_qualification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-01T23:02:59.049Z",
        "completed_at": "2026-11-01T23:02:59.845Z",
        "duration_ms": 796,
        "items_processed": 1199,
        "items_succeeded": 1199,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_discovery_validation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-03T05:03:14.952Z",
        "completed_at": "2026-11-03T05:03:25.905Z",
        "duration_ms": 10953,
        "items_processed": 10,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_discovery_validation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-02T16:03:56.314Z",
        "completed_at": "2026-11-02T16:04:07.083Z",
        "duration_ms": 10769,
        "items_processed": 10,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_discovery_validation",
        "trigger_source": "MANUAL_PING",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-02T02:32:39.762Z",
        "completed_at": "2026-11-02T02:32:54.183Z",
        "duration_ms": 14421,
        "items_processed": 10,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_discovery_validation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-01T14:03:22.273Z",
        "completed_at": "2026-11-01T14:03:27.260Z",
        "duration_ms": 4987,
        "items_processed": 10,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "prospect_discovery_validation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-01T01:03:13.871Z",
        "completed_at": "2026-11-01T01:03:18.577Z",
        "duration_ms": 4706,
        "items_processed": 10,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T06:01:54.783Z",
        "completed_at": "2026-11-08T06:01:56.352Z",
        "duration_ms": 1569,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T05:00:49.558Z",
        "completed_at": "2026-11-08T05:00:51.364Z",
        "duration_ms": 1806,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T01:02:05.987Z",
        "completed_at": "2026-11-08T01:02:07.644Z",
        "duration_ms": 1657,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T23:02:01.578Z",
        "completed_at": "2026-11-07T23:02:03.201Z",
        "duration_ms": 1623,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T21:01:55.211Z",
        "completed_at": "2026-11-07T21:01:56.852Z",
        "duration_ms": 1641,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:02:05.172Z",
        "completed_at": "2026-11-08T02:02:05.932Z",
        "duration_ms": 760,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T00:02:01.479Z",
        "completed_at": "2026-11-08T00:02:02.258Z",
        "duration_ms": 779,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T22:01:55.474Z",
        "completed_at": "2026-11-07T22:01:56.226Z",
        "duration_ms": 752,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T19:02:06.975Z",
        "completed_at": "2026-11-07T19:02:07.722Z",
        "duration_ms": 747,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T17:01:18.300Z",
        "completed_at": "2026-11-07T17:01:19.104Z",
        "duration_ms": 804,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0,
        "error_message": null
      },
      {
        "workflow_id": "seo_keyword_research",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-03T17:34:58.166Z",
        "completed_at": "2026-11-03T17:35:02.743Z",
        "duration_ms": 4577,
        "items_processed": 7,
        "items_succeeded": 3,
        "items_failed": 0,
        "error_message": null
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 5.293
      },
      "duration": 5.293,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 4647,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

## Workflow Handlers Code Audit & Operational Classification
UTC Timestamp: 2026-11-08T06:40:51.595Z

| Workflow ID | Handler Location (File:Line) | Cadence | Behavior / External Call / DB Write | Flags |
| :--- | :--- | :--- | :--- | :--- |
| **daily_market_demand_research** | `automation-registry-engine.ts:802` | 60m (Hourly) | Calls SearchDiscoveryProvider (Tavily/Google); writes to `demand_signals` & `market_experiments` | Active Provider / DB Writer |
| **competitor_pricing_research** | `automation-registry-engine.ts:1033` | 1440m (24h) | Reads competitor topics; writes snapshots to `commercial_evidence` | Active DB Writer |
| **prospect_discovery_validation** | `automation-registry-engine.ts:1091` | 720m (12h) | Queries search engine for clinics in Indian metros; writes to `platform_prospects` | Active Provider / DB Writer |
| **prospect_dedup_qualification** | `automation-registry-engine.ts:1121` | 360m (6h) | Normalizes domains, checks DNC & suppression; writes to `outbound_contacts` | Active DB Writer |
| **outreach_draft_preparation** | `automation-registry-engine.ts:1251` | 360m (6h) | Generates drafts behind human review gate; writes to `outreach_drafts` | Active DB Writer |
| **owner_approval_queue_generation** | `automation-registry-engine.ts:1284` | 60m (1h) | Counts pending drafts in `outreach_drafts`; generates digest summary | **FLAGS: Read-Only / Row-Counter** |
| **authorized_outreach_dispatch** | `automation-registry-engine.ts:1300` | 60m (1h) | Checks `human_approved = 1`; dispatches via Brevo/WhatsApp if approved | **FLAGS: Gated by Human Approval (NO_ACTION_DUE when 0 approved)** |
| **new_inquiry_processing** | `automation-registry-engine.ts:1353` | 60m (1h) | Checks `owner_intake` for new leads; DPDP consent logging | **FLAGS: Returns NO_ACTION_DUE when 0 pending inquiries** |
| **reply_classification_followup** | `automation-registry-engine.ts:1398` | 120m (2h) | Checks inbound responses in `direct_outreach_log` | **FLAGS: Returns NO_ACTION_DUE when 0 inbound replies** |
| **proposal_prep_followup** | `automation-registry-engine.ts:1410` | 360m (6h) | Evaluates proposal expiry & checkout visits | **FLAGS: Returns NO_ACTION_DUE when 0 active proposals** |
| **payment_status_reconciliation** | `automation-registry-engine.ts:1480` | 60m (1h) | Queries Razorpay for pending orders; enforces 0 bank cash | **FLAGS: Returns NO_ACTION_DUE when 0 pending orders** |
| **affiliate_offer_reconciliation** | `automation-registry-engine.ts:1519` | 360m (6h) | Fetches Cuelinks campaigns via API v3; writes to `cuelinks_campaigns` | Active Provider / DB Writer |
| **content_freshness_verification** | `automation-registry-engine.ts:1587` | 720m (12h) | Verifies canonical routes and referral redirects | Active HTTP Prober |
| **daily_commercial_summary** | `automation-registry-engine.ts:1618` | 1440m (24h) | Aggregates daily analytics & operating costs; writes to `stored_reports` | Active DB Writer |
| **seasonal_demand_research** | `automation-registry-engine.ts:1658` | 720m (12h) | Scans `seasonal_festivals` for upcoming commercial windows | Active DB Reader / Matcher |
| **seo_keyword_research** | `automation-registry-engine.ts:1676` | 720m (12h) | Evaluates search intent and clusters canonical URLs | Active DB Writer |
| **quota_health_checks** | `automation-registry-engine.ts:1699` | 60m (1h) | Resets daily quota windows; writes to `provider_quota_ledger` | Active DB Writer |
| **healthcare_claim_verification** | `automation-registry-engine.ts:1729` | 1440m (24h) | Audits citations in `healthcare_evidence_records` | Active DB Auditor |
| **multi_market_lead_qualification** | `automation-registry-engine.ts:1746` | 360m (6h) | Evaluates rubrics on `platform_prospects` | Active DB Writer |
| **b2b_suppression_and_compliance_audit** | `automation-registry-engine.ts:1764` | 720m (12h) | Enforces 60-day outreach cooldown; purges expired DPDP records | Active DB Auditor / Deleter |
