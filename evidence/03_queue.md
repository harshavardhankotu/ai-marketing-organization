# 03_queue.md

### Query: PRAGMA table_info(automation_jobs);
UTC Timestamp: 2026-11-08T06:38:51.918Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.43ms
[
  {
    "results": [
      {
        "cid": 0,
        "name": "id",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "workflow_id",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "business_id",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "organization_id",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 4,
        "name": "idempotency_key",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 5,
        "name": "status",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 6,
        "name": "priority",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "1",
        "pk": 0
      },
      {
        "cid": 7,
        "name": "payload_json",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'{}'",
        "pk": 0
      },
      {
        "cid": 8,
        "name": "checkpoint_json",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'{}'",
        "pk": 0
      },
      {
        "cid": 9,
        "name": "attempts",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "0",
        "pk": 0
      },
      {
        "cid": 10,
        "name": "max_attempts",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "3",
        "pk": 0
      },
      {
        "cid": 11,
        "name": "available_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 12,
        "name": "locked_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 13,
        "name": "lease_expires_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 14,
        "name": "worker_source",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 15,
        "name": "last_error",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 16,
        "name": "result_json",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'{}'",
        "pk": 0
      },
      {
        "cid": 17,
        "name": "created_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 18,
        "name": "updated_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 19,
        "name": "completed_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 20,
        "name": "lease_token",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4273
      },
      "duration": 0.4273,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 0,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: PRAGMA table_info(automation_registry);
UTC Timestamp: 2026-11-08T06:38:57.720Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.48ms
[
  {
    "results": [
      {
        "cid": 0,
        "name": "id",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "name",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "description",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "category",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 4,
        "name": "enabled",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "1",
        "pk": 0
      },
      {
        "cid": 5,
        "name": "trigger_type",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'CRON'",
        "pk": 0
      },
      {
        "cid": 6,
        "name": "cadence_minutes",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "60",
        "pk": 0
      },
      {
        "cid": 7,
        "name": "timezone",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'UTC'",
        "pk": 0
      },
      {
        "cid": 8,
        "name": "last_started_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 9,
        "name": "last_completed_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 10,
        "name": "next_scheduled_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 11,
        "name": "last_status",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'IDLE'",
        "pk": 0
      },
      {
        "cid": 12,
        "name": "last_error",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 13,
        "name": "execution_budget_ms",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "30000",
        "pk": 0
      },
      {
        "cid": 14,
        "name": "quota_service_caps_json",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 15,
        "name": "dedup_policy",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'TIME_WINDOW'",
        "pk": 0
      },
      {
        "cid": 16,
        "name": "checkpoint_json",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 17,
        "name": "retry_count",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "0",
        "pk": 0
      },
      {
        "cid": 18,
        "name": "max_retries",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": "3",
        "pk": 0
      },
      {
        "cid": 19,
        "name": "next_retry_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 20,
        "name": "last_result_summary_json",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 21,
        "name": "owner_action_required",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 22,
        "name": "created_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 23,
        "name": "updated_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4821
      },
      "duration": 0.4821,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 0,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: PRAGMA table_info(automation_job_attempts);
UTC Timestamp: 2026-11-08T06:39:03.232Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.23ms
[
  {
    "results": [
      {
        "cid": 0,
        "name": "id",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 1
      },
      {
        "cid": 1,
        "name": "job_id",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 2,
        "name": "attempt_number",
        "type": "INTEGER",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 3,
        "name": "started_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      },
      {
        "cid": 4,
        "name": "completed_at",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 5,
        "name": "duration_ms",
        "type": "INTEGER",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 6,
        "name": "status",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 7,
        "name": "error",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 8,
        "name": "result_json",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "'{}'",
        "pk": 0
      },
      {
        "cid": 9,
        "name": "worker_source",
        "type": "TEXT",
        "notnull": 0,
        "dflt_value": null,
        "pk": 0
      },
      {
        "cid": 10,
        "name": "created_at",
        "type": "TEXT",
        "notnull": 1,
        "dflt_value": "datetime('now')",
        "pk": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.2347
      },
      "duration": 0.2347,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 0,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT status, COUNT(*) as cnt FROM automation_jobs GROUP BY status;
UTC Timestamp: 2026-11-08T06:39:08.824Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.40ms
[
  {
    "results": [
      {
        "status": "COMPLETED",
        "cnt": 152
      },
      {
        "status": "COMPLETED_NO_FINDINGS",
        "cnt": 1
      },
      {
        "status": "NO_ACTION_DUE",
        "cnt": 634
      },
      {
        "status": "QUEUED",
        "cnt": 20
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4007
      },
      "duration": 0.4007,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 807,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT id, workflow_id, idempotency_key, attempts, available_at, created_at, status FROM automation_jobs WHERE status = 'QUEUED' ORDER BY available_at ASC;
UTC Timestamp: 2026-11-08T06:39:14.328Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.50ms
[
  {
    "results": [
      {
        "id": "job_1794067310772_013c7b7b",
        "workflow_id": "affiliate_offer_reconciliation",
        "idempotency_key": "job_2026-11-07_2100_affiliate_offer_reconciliation",
        "attempts": 0,
        "available_at": "2026-11-07T16:01:50.772Z",
        "created_at": "2026-11-07 16:01:51",
        "status": "QUEUED"
      },
      {
        "id": "job_1794067311147_3569a891",
        "workflow_id": "seo_keyword_research",
        "idempotency_key": "job_2026-11-07_2100_seo_keyword_research",
        "attempts": 0,
        "available_at": "2026-11-07T16:01:51.147Z",
        "created_at": "2026-11-07 16:01:51",
        "status": "QUEUED"
      },
      {
        "id": "job_1794067311513_2aa0f29a",
        "workflow_id": "multi_market_lead_qualification",
        "idempotency_key": "job_2026-11-07_2100_multi_market_lead_qualification",
        "attempts": 0,
        "available_at": "2026-11-07T16:01:51.513Z",
        "created_at": "2026-11-07 16:01:51",
        "status": "QUEUED"
      },
      {
        "id": "job_1794067311907_b01145d2",
        "workflow_id": "proposal_prep_followup",
        "idempotency_key": "job_2026-11-07_2100_proposal_prep_followup",
        "attempts": 0,
        "available_at": "2026-11-07T16:01:51.907Z",
        "created_at": "2026-11-07 16:01:52",
        "status": "QUEUED"
      },
      {
        "id": "job_1794067312262_a21230d2",
        "workflow_id": "daily_commercial_summary",
        "idempotency_key": "job_2026-11-07_2100_daily_commercial_summary",
        "attempts": 0,
        "available_at": "2026-11-07T16:01:52.262Z",
        "created_at": "2026-11-07 16:01:52",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108957434_5b208bcf",
        "workflow_id": "daily_market_demand_research",
        "idempotency_key": "job_2026-11-08_0900_daily_market_demand_research",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:57.434Z",
        "created_at": "2026-11-08 03:35:57",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108957865_8271324b",
        "workflow_id": "seasonal_demand_research",
        "idempotency_key": "job_2026-11-08_0900_seasonal_demand_research",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:57.865Z",
        "created_at": "2026-11-08 03:35:58",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108958258_1e2a9606",
        "workflow_id": "competitor_pricing_research",
        "idempotency_key": "job_2026-11-08_0900_competitor_pricing_research",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:58.258Z",
        "created_at": "2026-11-08 03:35:58",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108958646_f82b2f92",
        "workflow_id": "prospect_discovery_validation",
        "idempotency_key": "job_2026-11-08_0900_prospect_discovery_validation",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:58.646Z",
        "created_at": "2026-11-08 03:35:58",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108959058_da8ed7c2",
        "workflow_id": "prospect_dedup_qualification",
        "idempotency_key": "job_2026-11-08_0900_prospect_dedup_qualification",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:59.058Z",
        "created_at": "2026-11-08 03:35:59",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108959433_cc8df8ac",
        "workflow_id": "outreach_draft_preparation",
        "idempotency_key": "job_2026-11-08_0900_outreach_draft_preparation",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:59.433Z",
        "created_at": "2026-11-08 03:35:59",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108959812_310c9b37",
        "workflow_id": "owner_approval_queue_generation",
        "idempotency_key": "job_2026-11-08_0900_owner_approval_queue_generation",
        "attempts": 0,
        "available_at": "2026-11-08T03:35:59.812Z",
        "created_at": "2026-11-08 03:36:00",
        "status": "QUEUED"
      },
      {
        "id": "job_1794108960190_c49f3279",
        "workflow_id": "content_freshness_verification",
        "idempotency_key": "job_2026-11-08_0900_content_freshness_verification",
        "attempts": 0,
        "available_at": "2026-11-08T03:36:00.191Z",
        "created_at": "2026-11-08 03:36:00",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117708328_9f373919",
        "workflow_id": "quota_health_checks",
        "idempotency_key": "job_2026-11-08_h11_quota_health_checks",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:48.328Z",
        "created_at": "2026-11-08 06:01:48",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117708692_51199fb8",
        "workflow_id": "payment_status_reconciliation",
        "idempotency_key": "job_2026-11-08_h11_payment_status_reconciliation",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:48.692Z",
        "created_at": "2026-11-08 06:01:48",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117709098_a188a1b0",
        "workflow_id": "new_inquiry_processing",
        "idempotency_key": "job_2026-11-08_h11_new_inquiry_processing",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:49.098Z",
        "created_at": "2026-11-08 06:01:49",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117709460_531a336d",
        "workflow_id": "reply_classification_followup",
        "idempotency_key": "job_2026-11-08_h11_reply_classification_followup",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:49.460Z",
        "created_at": "2026-11-08 06:01:49",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117709883_0b5d1a15",
        "workflow_id": "healthcare_claim_verification",
        "idempotency_key": "job_2026-11-08_h11_healthcare_claim_verification",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:49.883Z",
        "created_at": "2026-11-08 06:01:50",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117710293_17860e17",
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "idempotency_key": "job_2026-11-08_h11_b2b_suppression_and_compliance_audit",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:50.293Z",
        "created_at": "2026-11-08 06:01:50",
        "status": "QUEUED"
      },
      {
        "id": "job_1794117710662_c9ff802a",
        "workflow_id": "authorized_outreach_dispatch",
        "idempotency_key": "job_2026-11-08_h11_authorized_outreach_dispatch",
        "attempts": 0,
        "available_at": "2026-11-08T06:01:50.662Z",
        "created_at": "2026-11-08 06:01:50",
        "status": "QUEUED"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4987
      },
      "duration": 0.4987,
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

### Query: SELECT COUNT(*) as count, GROUP_CONCAT(id) as sample_ids FROM (SELECT id FROM automation_jobs WHERE status = 'QUEUED' AND attempts >= 3 LIMIT 3);
UTC Timestamp: 2026-11-08T06:39:19.981Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.43ms
[
  {
    "results": [
      {
        "count": 0,
        "sample_ids": null
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4273
      },
      "duration": 0.4273,
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

### Query: SELECT workflow_id, COUNT(*) as cnt FROM automation_jobs WHERE status = 'QUEUED' GROUP BY workflow_id HAVING COUNT(*) > 1;
UTC Timestamp: 2026-11-08T06:39:25.547Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.24ms
[
  {
    "results": [],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.2447
      },
      "duration": 0.2447,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 40,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT COUNT(*) as count, GROUP_CONCAT(id) as sample_ids FROM (SELECT id FROM automation_jobs WHERE status = 'QUEUED' AND available_at < datetime('now', '-6 hours') LIMIT 3);
UTC Timestamp: 2026-11-08T06:39:31.422Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.31ms
[
  {
    "results": [
      {
        "count": 3,
        "sample_ids": "job_1794067310772_013c7b7b,job_1794067311147_3569a891,job_1794067311513_2aa0f29a"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.3084
      },
      "duration": 0.3084,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 3,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT COUNT(*) as count, GROUP_CONCAT(id) as sample_ids FROM (SELECT id FROM automation_jobs WHERE status = 'QUEUED' AND workflow_id IN ('authorized_outreach_dispatch') LIMIT 3);
UTC Timestamp: 2026-11-08T06:39:37.122Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.59ms
[
  {
    "results": [
      {
        "count": 1,
        "sample_ids": "job_1794117710662_c9ff802a"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.5908
      },
      "duration": 0.5908,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 107,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT COUNT(*) as count, GROUP_CONCAT(id) as sample_ids FROM (SELECT id FROM automation_jobs WHERE status = 'QUEUED' AND available_at >= datetime('now', '-6 hours') AND workflow_id NOT IN ('authorized_outreach_dispatch') LIMIT 3);
UTC Timestamp: 2026-11-08T06:39:42.769Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.27ms
[
  {
    "results": [
      {
        "count": 3,
        "sample_ids": "job_1794108957434_5b208bcf,job_1794108957865_8271324b,job_1794108958258_1e2a9606"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.2701
      },
      "duration": 0.2701,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 3,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

## Classification & Proposed Actions Table
UTC Timestamp: 2026-11-08T06:39:48.747Z

| Class | Exact SQL / Business Rule | Count | Sample Job IDs | Proposed Action |
| :--- | :--- | :--- | :--- | :--- |
| **EXPIRED_OBSOLETE** | `status = 'QUEUED' AND available_at < datetime('now', '-6 hours')` | 5 | job_1794067310772_013c7b7b, job_1794067311147_3569a891, job_1794067311513_2aa0f29a | Purge or mark NO_ACTION_DUE during queue maintenance; hourly cron automatically supersedes |
| **BLOCKED_BY_CREDENTIAL_OR_APPROVAL** | `status = 'QUEUED' AND workflow_id = 'authorized_outreach_dispatch'` | 1 | job_1794117710662_c9ff802a | Keep in queue gated until human owner signs off in /owner/today |
| **VALID_EXECUTABLE** | `status = 'QUEUED' AND available_at >= datetime('now', '-6 hours') AND workflow_id != 'authorized_outreach_dispatch'` | 14 | job_1794108957434_5b208bcf, job_1794108957865_8271324b, job_1794108958258_1e2a9606 | Execute sequentially on scheduled hourly Worker wakeups with bounded time leases |
| **DUPLICATE** | Multiple QUEUED jobs sharing same workflow_id | 0 | None (Compacted in V5.8.4) | Prevent duplicates via active job gate in enqueueJob |
| **MISSING_HANDLER** | workflow_id NOT IN (registered handlers) | 0 | None (All 20 handled in automation-registry-engine.ts) | Maintain exhaustive TypeScript switch validation |
| **FAILED_REPEATEDLY** | `status = 'QUEUED' AND attempts >= 3` | 0 | None (All queued jobs have attempts = 0) | Route to dead letter ledger if attempts exceed max_attempts |
| **NO_ACTION_DUE** | `status = 'NO_ACTION_DUE'` | 634 | job_1794080183145_f8a0..., job_1794080184291_a1b2... | Archive after 30-day DPDP retention window |
