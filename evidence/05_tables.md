# 05_tables.md

### Query: SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC;
UTC Timestamp: 2026-11-08T06:43:29.402Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.57ms
[
  {
    "results": [
      {
        "name": "_cf_KV"
      },
      {
        "name": "_d1_migrations"
      },
      {
        "name": "action_cooldowns"
      },
      {
        "name": "analytics_events"
      },
      {
        "name": "automation_execution_log"
      },
      {
        "name": "automation_job_attempts"
      },
      {
        "name": "automation_jobs"
      },
      {
        "name": "automation_registry"
      },
      {
        "name": "autonomous_action_traces"
      },
      {
        "name": "autonomous_cycle_log"
      },
      {
        "name": "availability_slots"
      },
      {
        "name": "booking_reservations"
      },
      {
        "name": "brand_spec_lines"
      },
      {
        "name": "business_autonomy_lock"
      },
      {
        "name": "business_goals"
      },
      {
        "name": "businesses"
      },
      {
        "name": "campaigns"
      },
      {
        "name": "clinical_safety_policies"
      },
      {
        "name": "commercial_evidence"
      },
      {
        "name": "commission_content_assets"
      },
      {
        "name": "commission_records"
      },
      {
        "name": "competitor_topics"
      },
      {
        "name": "content_assets"
      },
      {
        "name": "cron_telemetry"
      },
      {
        "name": "cuelinks_campaigns"
      },
      {
        "name": "customer_acceptance_records"
      },
      {
        "name": "customer_journeys"
      },
      {
        "name": "customer_offers"
      },
      {
        "name": "delivery_tasks"
      },
      {
        "name": "demand_matches"
      },
      {
        "name": "demand_signals"
      },
      {
        "name": "direct_offer_attestation"
      },
      {
        "name": "direct_outreach_log"
      },
      {
        "name": "domain_policy"
      },
      {
        "name": "durable_events"
      },
      {
        "name": "durable_rate_limits"
      },
      {
        "name": "experiments"
      },
      {
        "name": "fulfillment_tasks"
      },
      {
        "name": "funnels"
      },
      {
        "name": "healthcare_compliance_register"
      },
      {
        "name": "healthcare_evidence_records"
      },
      {
        "name": "integration_phone_mappings"
      },
      {
        "name": "learning_records"
      },
      {
        "name": "manual_upi_claims"
      },
      {
        "name": "market_experiments"
      },
      {
        "name": "mistakes_board"
      },
      {
        "name": "opportunities"
      },
      {
        "name": "organizations"
      },
      {
        "name": "outbound_action_ledger"
      },
      {
        "name": "outbound_contacts"
      },
      {
        "name": "outreach_drafts"
      },
      {
        "name": "outreach_log"
      },
      {
        "name": "outreach_suppression_list"
      },
      {
        "name": "owner_intake"
      },
      {
        "name": "owner_sessions"
      },
      {
        "name": "owner_status_snapshots"
      },
      {
        "name": "partner_offers"
      },
      {
        "name": "partners"
      },
      {
        "name": "payment_orders"
      },
      {
        "name": "payment_provider_links"
      },
      {
        "name": "payment_requests"
      },
      {
        "name": "platform_customer_deliveries"
      },
      {
        "name": "platform_prospects"
      },
      {
        "name": "processed_webhook_events"
      },
      {
        "name": "product_proposals"
      },
      {
        "name": "proposals"
      },
      {
        "name": "provider_call_logs"
      },
      {
        "name": "provider_drift_records"
      },
      {
        "name": "provider_quota_ledger"
      },
      {
        "name": "provider_quota_state"
      },
      {
        "name": "public_deals"
      },
      {
        "name": "referral_click_events"
      },
      {
        "name": "referrals"
      },
      {
        "name": "reply_desk_drafts"
      },
      {
        "name": "reply_desk_query_runs"
      },
      {
        "name": "revenue_records"
      },
      {
        "name": "sales_pipeline"
      },
      {
        "name": "search_attempts"
      },
      {
        "name": "search_cache"
      },
      {
        "name": "seasonal_festivals"
      },
      {
        "name": "seo_keywords"
      },
      {
        "name": "site_audits"
      },
      {
        "name": "source_rules"
      },
      {
        "name": "sqlite_sequence"
      },
      {
        "name": "stored_reports"
      },
      {
        "name": "strategies"
      },
      {
        "name": "traffic_sessions"
      },
      {
        "name": "transactions"
      },
      {
        "name": "universal_orders"
      },
      {
        "name": "workflows"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.5681
      },
      "duration": 0.5681,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 399,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 1 (15 tables):
UTC Timestamp: 2026-11-08T06:43:35.570Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 6.04ms
[
  {
    "results": [
      {
        "table_name": "_d1_migrations",
        "row_count": 49
      },
      {
        "table_name": "action_cooldowns",
        "row_count": 9
      },
      {
        "table_name": "analytics_events",
        "row_count": 0
      },
      {
        "table_name": "automation_execution_log",
        "row_count": 1134
      },
      {
        "table_name": "automation_job_attempts",
        "row_count": 354
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.1958
      },
      "duration": 1.1958,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1547,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "automation_jobs",
        "row_count": 807
      },
      {
        "table_name": "automation_registry",
        "row_count": 20
      },
      {
        "table_name": "autonomous_action_traces",
        "row_count": 1155
      },
      {
        "table_name": "autonomous_cycle_log",
        "row_count": 1266
      },
      {
        "table_name": "availability_slots",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 3.8291
      },
      "duration": 3.8291,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 3249,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "booking_reservations",
        "row_count": 0
      },
      {
        "table_name": "brand_spec_lines",
        "row_count": 0
      },
      {
        "table_name": "business_autonomy_lock",
        "row_count": 0
      },
      {
        "table_name": "business_goals",
        "row_count": 0
      },
      {
        "table_name": "businesses",
        "row_count": 3
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.0154
      },
      "duration": 1.0154,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 7,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 2 (15 tables):
UTC Timestamp: 2026-11-08T06:43:41.421Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 4.30ms
[
  {
    "results": [
      {
        "table_name": "campaigns",
        "row_count": 0
      },
      {
        "table_name": "clinical_safety_policies",
        "row_count": 0
      },
      {
        "table_name": "commercial_evidence",
        "row_count": 475
      },
      {
        "table_name": "commission_content_assets",
        "row_count": 1
      },
      {
        "table_name": "commission_records",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.7068
      },
      "duration": 1.7068,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 479,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "competitor_topics",
        "row_count": 80
      },
      {
        "table_name": "content_assets",
        "row_count": 0
      },
      {
        "table_name": "cron_telemetry",
        "row_count": 1
      },
      {
        "table_name": "cuelinks_campaigns",
        "row_count": 7
      },
      {
        "table_name": "customer_acceptance_records",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.9082
      },
      "duration": 0.9082,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 90,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "customer_journeys",
        "row_count": 0
      },
      {
        "table_name": "customer_offers",
        "row_count": 3
      },
      {
        "table_name": "delivery_tasks",
        "row_count": 0
      },
      {
        "table_name": "demand_matches",
        "row_count": 0
      },
      {
        "table_name": "demand_signals",
        "row_count": 176
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.6824
      },
      "duration": 1.6824,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 182,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 3 (15 tables):
UTC Timestamp: 2026-11-08T06:43:47.303Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 4.82ms
[
  {
    "results": [
      {
        "table_name": "direct_offer_attestation",
        "row_count": 0
      },
      {
        "table_name": "direct_outreach_log",
        "row_count": 38
      },
      {
        "table_name": "domain_policy",
        "row_count": 23
      },
      {
        "table_name": "durable_events",
        "row_count": 2814
      },
      {
        "table_name": "durable_rate_limits",
        "row_count": 29
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 3.3221
      },
      "duration": 3.3221,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 2905,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "experiments",
        "row_count": 0
      },
      {
        "table_name": "fulfillment_tasks",
        "row_count": 0
      },
      {
        "table_name": "funnels",
        "row_count": 3
      },
      {
        "table_name": "healthcare_compliance_register",
        "row_count": 0
      },
      {
        "table_name": "healthcare_evidence_records",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.7751
      },
      "duration": 0.7751,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 7,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "integration_phone_mappings",
        "row_count": 0
      },
      {
        "table_name": "learning_records",
        "row_count": 46
      },
      {
        "table_name": "manual_upi_claims",
        "row_count": 1
      },
      {
        "table_name": "market_experiments",
        "row_count": 0
      },
      {
        "table_name": "mistakes_board",
        "row_count": 31
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.7255
      },
      "duration": 0.7255,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 80,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 4 (15 tables):
UTC Timestamp: 2026-11-08T06:43:52.748Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 3.69ms
[
  {
    "results": [
      {
        "table_name": "opportunities",
        "row_count": 1214
      },
      {
        "table_name": "organizations",
        "row_count": 2
      },
      {
        "table_name": "outbound_action_ledger",
        "row_count": 0
      },
      {
        "table_name": "outbound_contacts",
        "row_count": 433
      },
      {
        "table_name": "outreach_drafts",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.866
      },
      "duration": 1.866,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1651,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "outreach_log",
        "row_count": 0
      },
      {
        "table_name": "outreach_suppression_list",
        "row_count": 0
      },
      {
        "table_name": "owner_intake",
        "row_count": 0
      },
      {
        "table_name": "owner_sessions",
        "row_count": 5
      },
      {
        "table_name": "owner_status_snapshots",
        "row_count": 1
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.6623
      },
      "duration": 0.6623,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 9,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "partner_offers",
        "row_count": 2
      },
      {
        "table_name": "partners",
        "row_count": 3
      },
      {
        "table_name": "payment_orders",
        "row_count": 2
      },
      {
        "table_name": "payment_provider_links",
        "row_count": 0
      },
      {
        "table_name": "payment_requests",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.1649
      },
      "duration": 1.1649,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 9,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 5 (15 tables):
UTC Timestamp: 2026-11-08T06:43:58.430Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 3.17ms
[
  {
    "results": [
      {
        "table_name": "platform_customer_deliveries",
        "row_count": 0
      },
      {
        "table_name": "platform_prospects",
        "row_count": 1216
      },
      {
        "table_name": "processed_webhook_events",
        "row_count": 0
      },
      {
        "table_name": "product_proposals",
        "row_count": 0
      },
      {
        "table_name": "proposals",
        "row_count": 1
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.8597
      },
      "duration": 1.8597,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1220,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "provider_call_logs",
        "row_count": 94
      },
      {
        "table_name": "provider_drift_records",
        "row_count": 63
      },
      {
        "table_name": "provider_quota_ledger",
        "row_count": 3
      },
      {
        "table_name": "provider_quota_state",
        "row_count": 2
      },
      {
        "table_name": "public_deals",
        "row_count": 1
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.6771
      },
      "duration": 0.6771,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 163,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "referral_click_events",
        "row_count": 7
      },
      {
        "table_name": "referrals",
        "row_count": 5
      },
      {
        "table_name": "reply_desk_drafts",
        "row_count": 0
      },
      {
        "table_name": "reply_desk_query_runs",
        "row_count": 30
      },
      {
        "table_name": "revenue_records",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.6345
      },
      "duration": 0.6345,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 44,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Tables Batch 6 (14 tables):
UTC Timestamp: 2026-11-08T06:44:03.893Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 3 commands in 10.02ms
[
  {
    "results": [
      {
        "table_name": "sales_pipeline",
        "row_count": 434
      },
      {
        "table_name": "search_attempts",
        "row_count": 5
      },
      {
        "table_name": "search_cache",
        "row_count": 5
      },
      {
        "table_name": "seasonal_festivals",
        "row_count": 0
      },
      {
        "table_name": "seo_keywords",
        "row_count": 7
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.6898
      },
      "duration": 1.6898,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 452,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "site_audits",
        "row_count": 2
      },
      {
        "table_name": "source_rules",
        "row_count": 4
      },
      {
        "table_name": "sqlite_sequence",
        "row_count": 1
      },
      {
        "table_name": "stored_reports",
        "row_count": 0
      },
      {
        "table_name": "strategies",
        "row_count": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.8257
      },
      "duration": 0.8257,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 9,
      "rows_written": 0,
      "total_attempts": 1
    }
  },
  {
    "results": [
      {
        "table_name": "traffic_sessions",
        "row_count": 0
      },
      {
        "table_name": "transactions",
        "row_count": 0
      },
      {
        "table_name": "universal_orders",
        "row_count": 2
      },
      {
        "table_name": "workflows",
        "row_count": 12282
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 7.502
      },
      "duration": 7.502,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 12286,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

## Table Inventory & Writer / Reader Codebase Audit
UTC Timestamp: 2026-11-08T06:44:11.201Z

| Table Name | Row Count in D1 | Writer Files | Reader Files | Status Flag | Sample Writer | Sample Reader |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_d1_migrations` | 49 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/index.ts` | `packages/backend/src/db/d1-migrations/index.ts` |
| `action_cooldowns` | 9 | 1 | 3 | **OPERATIONAL** | `packages/backend/src/revenue/action-cooldown-manager.ts` | `packages/backend/src/commission/owner-control-center.ts` |
| `analytics_events` | 0 | 4 | 5 | **OPERATIONAL** | `packages/backend/src/agents/agent-runtime.ts` | `packages/backend/src/agents/tool-executor.ts` |
| `automation_execution_log` | 1134 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/automation/automation-registry-engine.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `automation_job_attempts` | 354 | 1 | 0 | **NO_READERS** | `packages/backend/src/automation/durable-job-queue.ts` | `NONE` |
| `automation_jobs` | 807 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/automation/durable-job-queue.ts` | `packages/backend/src/automation/durable-job-queue.ts` |
| `automation_registry` | 20 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/automation/automation-registry-engine.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `autonomous_action_traces` | 1155 | 3 | 5 | **OPERATIONAL** | `packages/backend/src/commission/demand-engine.ts` | `packages/backend/src/revenue/autonomy-policy.ts` |
| `autonomous_cycle_log` | 1266 | 1 | 3 | **OPERATIONAL** | `packages/backend/src/revenue/autonomous-revenue-orchestrator.ts` | `packages/backend/src/commission/owner-control-center.ts` |
| `availability_slots` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/revenue/availability-engine.ts` | `packages/backend/src/revenue/availability-engine.ts` |
| `booking_reservations` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/revenue/availability-engine.ts` | `packages/backend/src/revenue/availability-engine.ts` |
| `brand_spec_lines` | 0 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/commission/automatic-offer-lane.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `business_autonomy_lock` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/revenue/business-autonomy-lock.ts` | `packages/backend/src/revenue/business-autonomy-lock.ts` |
| `business_goals` | 0 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/analytics/event-tracker.ts` | `packages/backend/src/routes/api.ts` |
| `businesses` | 3 | 6 | 29 | **OPERATIONAL** | `packages/backend/src/control-plane/autonomy-controller.ts` | `packages/backend/src/agents/agent-runtime.ts` |
| `campaigns` | 0 | 5 | 9 | **OPERATIONAL** | `packages/backend/src/agents/tool-executor.ts` | `packages/backend/src/analytics/event-tracker.ts` |
| `clinical_safety_policies` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/compliance/healthcare-accuracy-engine.ts` | `packages/backend/src/compliance/healthcare-accuracy-engine.ts` |
| `commercial_evidence` | 475 | 4 | 4 | **OPERATIONAL** | `packages/backend/src/revenue/autonomous-revenue-orchestrator.ts` | `packages/backend/src/revenue/commercial-lifecycle.ts` |
| `commission_content_assets` | 1 | 7 | 15 | **OPERATIONAL** | `packages/backend/src/commission/automatic-offer-lane.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `commission_records` | 0 | 2 | 6 | **OPERATIONAL** | `packages/backend/src/commission/conversion-verification.ts` | `packages/backend/src/commission/commission-ledger.ts` |
| `competitor_topics` | 80 | 0 | 0 | **DEAD_TABLE** | `NONE` | `NONE` |
| `content_assets` | 0 | 3 | 1 | **OPERATIONAL** | `packages/backend/src/control-plane/approval-manager.ts` | `packages/backend/src/routes/api.ts` |
| `cron_telemetry` | 1 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/routes/api.ts` | `packages/backend/src/revenue/reality-report-generator.ts` |
| `cuelinks_campaigns` | 7 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/commission/cuelinks-sync-manager.ts` | `packages/backend/src/commission/autonomous-deal-discovery-engine.ts` |
| `customer_acceptance_records` | 0 | 1 | 0 | **NO_READERS** | `packages/backend/src/revenue/customer-onboarding-service.ts` | `NONE` |
| `customer_journeys` | 0 | 12 | 23 | **OPERATIONAL** | `packages/backend/src/agents/tool-executor.ts` | `packages/backend/src/compliance/dpdp-manager.ts` |
| `customer_offers` | 3 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/routes/api.ts` | `packages/backend/src/revenue/offer-catalog.ts` |
| `delivery_tasks` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/revenue/delivery-engine.ts` | `packages/backend/src/revenue/reality-report-generator.ts` |
| `demand_matches` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/commission/demand-engine.ts` | `packages/backend/src/commission/demand-engine.ts` |
| `demand_signals` | 176 | 8 | 13 | **OPERATIONAL** | `packages/backend/src/commission/demand-discovery.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `direct_offer_attestation` | 0 | 0 | 0 | **DEAD_TABLE** | `NONE` | `NONE` |
| `direct_outreach_log` | 38 | 4 | 8 | **OPERATIONAL** | `packages/backend/src/organic/review-and-referral-engine.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `domain_policy` | 23 | 2 | 1 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0025_hermetic_tests_free_tier_and_auto_lane.sql` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `durable_events` | 2814 | 1 | 3 | **OPERATIONAL** | `packages/backend/src/revenue/durable-event-bus.ts` | `packages/backend/src/revenue/durable-event-bus.ts` |
| `durable_rate_limits` | 29 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/security/durable-rate-limiter.ts` | `packages/backend/src/security/durable-rate-limiter.ts` |
| `experiments` | 0 | 1 | 5 | **OPERATIONAL** | `packages/backend/src/experiments/experiment-engine.ts` | `packages/backend/src/control-plane/system-readiness.ts` |
| `fulfillment_tasks` | 0 | 1 | 0 | **NO_READERS** | `packages/backend/src/routes/api.ts` | `NONE` |
| `funnels` | 3 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0009_seed_default_customer_offers.sql` | `packages/backend/src/control-plane/tenant-context-resolver.ts` |
| `healthcare_compliance_register` | 0 | 1 | 0 | **NO_READERS** | `packages/backend/src/compliance/healthcare-accuracy-engine.ts` | `NONE` |
| `healthcare_evidence_records` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/compliance/healthcare-accuracy-engine.ts` | `packages/backend/src/compliance/healthcare-accuracy-engine.ts` |
| `integration_phone_mappings` | 0 | 0 | 1 | **NO_WRITERS** | `NONE` | `packages/backend/src/routes/api.ts` |
| `learning_records` | 46 | 11 | 10 | **OPERATIONAL** | `packages/backend/src/commission/demand-discovery.ts` | `packages/backend/src/commission/automatic-product-pipeline.ts` |
| `manual_upi_claims` | 1 | 4 | 5 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0037_quarantine_synthetic_test_claims.sql` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `market_experiments` | 0 | 2 | 1 | **OPERATIONAL** | `packages/backend/src/revenue/market-experiment-manager.ts` | `packages/backend/src/revenue/market-experiment-manager.ts` |
| `mistakes_board` | 31 | 11 | 2 | **OPERATIONAL** | `packages/backend/src/commission/automatic-offer-lane.ts` | `packages/backend/src/commission/owner-control-center.ts` |
| `opportunities` | 1214 | 7 | 5 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0011_stop_waste_and_safety_pass.sql` | `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql` |
| `organizations` | 2 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/revenue/learning-engine.ts` | `packages/backend/src/revenue/customer-journey-tracker.ts` |
| `outbound_action_ledger` | 0 | 1 | 4 | **OPERATIONAL** | `packages/backend/src/revenue/outbound-action-ledger.ts` | `packages/backend/src/revenue/autonomy-policy.ts` |
| `outbound_contacts` | 433 | 6 | 3 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0011_stop_waste_and_safety_pass.sql` | `packages/backend/src/revenue/autonomous-revenue-orchestrator.ts` |
| `outreach_drafts` | 0 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/commission/demand-engine.ts` | `packages/backend/src/commission/demand-engine.ts` |
| `outreach_log` | 0 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/routes/api.ts` | `packages/backend/src/revenue/owner-digest.ts` |
| `outreach_suppression_list` | 0 | 2 | 3 | **OPERATIONAL** | `packages/backend/src/revenue/autonomy-policy.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `owner_intake` | 0 | 2 | 4 | **OPERATIONAL** | `packages/backend/src/commission/owner-control-center.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `owner_sessions` | 5 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/auth/owner-auth.ts` | `packages/backend/src/auth/owner-auth.ts` |
| `owner_status_snapshots` | 1 | 1 | 0 | **NO_READERS** | `packages/backend/src/commission/owner-control-center.ts` | `NONE` |
| `partner_offers` | 2 | 8 | 10 | **OPERATIONAL** | `packages/backend/src/commission/owner-control-center.ts` | `packages/backend/src/commission/autonomous-deal-discovery-engine.ts` |
| `partners` | 3 | 5 | 8 | **OPERATIONAL** | `packages/backend/src/commission/autonomous-commercial-engine.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `payment_orders` | 2 | 3 | 5 | **OPERATIONAL** | `packages/backend/src/integrations/razorpay-test-service.ts` | `packages/backend/src/integrations/razorpay-test-service.ts` |
| `payment_provider_links` | 0 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/integrations/razorpay.ts` | `packages/backend/src/integrations/razorpay.ts` |
| `payment_requests` | 0 | 4 | 8 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql` | `packages/backend/src/integrations/razorpay.ts` |
| `platform_customer_deliveries` | 0 | 1 | 0 | **NO_READERS** | `packages/backend/src/integrations/razorpay.ts` | `NONE` |
| `platform_prospects` | 1216 | 9 | 12 | **OPERATIONAL** | `packages/backend/src/automation/automation-registry-engine.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `processed_webhook_events` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/routes/api.ts` | `packages/backend/src/routes/api.ts` |
| `product_proposals` | 0 | 4 | 3 | **OPERATIONAL** | `packages/backend/src/commission/automatic-product-pipeline.ts` | `packages/backend/src/commission/automatic-product-pipeline.ts` |
| `proposals` | 1 | 4 | 10 | **OPERATIONAL** | `packages/backend/src/automation/automation-registry-engine.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `provider_call_logs` | 94 | 4 | 0 | **NO_READERS** | `packages/backend/src/db/d1-migrations/0017_spec01_and_quotas.sql` | `NONE` |
| `provider_drift_records` | 63 | 1 | 0 | **NO_READERS** | `packages/backend/src/quota/unified-quota-service.ts` | `NONE` |
| `provider_quota_ledger` | 3 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/quota/unified-quota-service.ts` | `packages/backend/src/quota/unified-quota-service.ts` |
| `provider_quota_state` | 2 | 3 | 3 | **OPERATIONAL** | `packages/backend/src/commission/owner-control-center.ts` | `packages/backend/src/commission/owner-control-center.ts` |
| `public_deals` | 1 | 3 | 4 | **OPERATIONAL** | `packages/backend/src/commission/autonomous-deal-discovery-engine.ts` | `packages/backend/src/commission/autonomous-deal-discovery-engine.ts` |
| `referral_click_events` | 7 | 2 | 5 | **OPERATIONAL** | `packages/backend/src/commission/referral-tracking.ts` | `packages/backend/src/commission/automatic-offer-lane.ts` |
| `referrals` | 5 | 3 | 8 | **OPERATIONAL** | `packages/backend/src/commission/referral-tracking.ts` | `packages/backend/src/commission/commercial-learning-engine.ts` |
| `reply_desk_drafts` | 0 | 2 | 2 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql` | `packages/backend/src/revenue/reply-desk.ts` |
| `reply_desk_query_runs` | 30 | 1 | 2 | **OPERATIONAL** | `packages/backend/src/revenue/reply-desk.ts` | `packages/backend/src/revenue/reply-desk.ts` |
| `revenue_records` | 0 | 5 | 10 | **OPERATIONAL** | `packages/backend/src/commission/conversion-verification.ts` | `packages/backend/src/commission/conversion-verification.ts` |
| `sales_pipeline` | 434 | 7 | 7 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql` | `packages/backend/src/revenue/autonomous-revenue-orchestrator.ts` |
| `search_attempts` | 5 | 1 | 0 | **NO_READERS** | `packages/backend/src/commission/demand-discovery.ts` | `NONE` |
| `search_cache` | 5 | 2 | 4 | **OPERATIONAL** | `packages/backend/src/commission/demand-discovery.ts` | `packages/backend/src/commission/demand-discovery.ts` |
| `seasonal_festivals` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/commission/seasonal-demand-engine.ts` | `packages/backend/src/commission/seasonal-demand-engine.ts` |
| `seo_keywords` | 7 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/seo/seo-research-engine.ts` | `packages/backend/src/seo/seo-research-engine.ts` |
| `site_audits` | 2 | 4 | 4 | **OPERATIONAL** | `packages/backend/src/db/client.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `source_rules` | 4 | 3 | 3 | **OPERATIONAL** | `packages/backend/src/commission/demand-engine.ts` | `packages/backend/src/commission/demand-engine.ts` |
| `sqlite_sequence` | 1 | 0 | 0 | **DEAD_TABLE** | `NONE` | `NONE` |
| `stored_reports` | 0 | 1 | 1 | **OPERATIONAL** | `packages/backend/src/commission/owner-control-center.ts` | `packages/backend/src/commission/owner-control-center.ts` |
| `strategies` | 0 | 1 | 3 | **OPERATIONAL** | `packages/backend/src/control-plane/learning-manager.ts` | `packages/backend/src/control-plane/learning-manager.ts` |
| `traffic_sessions` | 0 | 1 | 3 | **OPERATIONAL** | `packages/backend/src/organic/traffic-provenance.ts` | `packages/backend/src/organic/traffic-provenance.ts` |
| `transactions` | 0 | 1 | 15 | **OPERATIONAL** | `packages/backend/src/revenue/revenue-reconciliation.ts` | `packages/backend/src/automation/automation-registry-engine.ts` |
| `universal_orders` | 2 | 4 | 3 | **OPERATIONAL** | `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql` | `packages/backend/src/routes/api.ts` |
| `workflows` | 12282 | 11 | 6 | **OPERATIONAL** | `packages/backend/src/agents/coordinated-orchestrator.ts` | `packages/backend/src/commission/autonomous-commercial-engine.ts` |
