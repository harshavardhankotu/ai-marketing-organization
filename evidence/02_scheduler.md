# 02_scheduler.md

### Query: SELECT * FROM cron_telemetry;
UTC Timestamp: 2026-11-08T06:37:33.737Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.28ms
[
  {
    "results": [
      {
        "id": "cloudflare_worker_cron",
        "status": "OBSERVED",
        "received_at": "2026-09-29 20:37:15",
        "execution_started_at": null,
        "execution_finished_at": null,
        "cycle_id": null,
        "http_status": null,
        "error_message": null,
        "metadata_json": "{}",
        "last_observed_ping": "2026-11-08 06:23:12",
        "total_pings": 1103,
        "last_user_agent": "curl/8.18.0",
        "worker_source": "curl/8.18.0",
        "last_successful_cycle": "2026-11-08 06:02:10",
        "last_failed_cycle": "2026-09-29 22:33:49",
        "cycle_result": "SUCCESS",
        "created_at": "2026-09-29 20:37:15",
        "updated_at": "2026-11-08 06:23:12"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.2772
      },
      "duration": 0.2772,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT worker_source, last_user_agent, status, total_pings, last_observed_ping, last_successful_cycle, last_failed_cycle, cycle_result, created_at, updated_at FROM cron_telemetry GROUP BY worker_source, last_user_agent;
UTC Timestamp: 2026-11-08T06:37:39.435Z
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
        "worker_source": "curl/8.18.0",
        "last_user_agent": "curl/8.18.0",
        "status": "OBSERVED",
        "total_pings": 1103,
        "last_observed_ping": "2026-11-08 06:23:12",
        "last_successful_cycle": "2026-11-08 06:02:10",
        "last_failed_cycle": "2026-09-29 22:33:49",
        "cycle_result": "SUCCESS",
        "created_at": "2026-09-29 20:37:15",
        "updated_at": "2026-11-08 06:23:12"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.4755
      },
      "duration": 0.4755,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 2,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT trigger_source, status, count(*), min(started_at), max(started_at) FROM automation_execution_log WHERE started_at >= datetime('now', '-72 hours') GROUP BY trigger_source, status ORDER BY max(started_at) DESC;
UTC Timestamp: 2026-11-08T06:37:45.419Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 1.11ms
[
  {
    "results": [
      {
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "count(*)": 113,
        "min(started_at)": "2026-11-05T00:01:51.490Z",
        "max(started_at)": "2026-11-08T06:02:07.371Z"
      },
      {
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "count(*)": 84,
        "min(started_at)": "2026-11-05T00:01:45.691Z",
        "max(started_at)": "2026-11-08T06:01:54.783Z"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 1.112
      },
      "duration": 1.112,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1333,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT id, workflow_id, trigger_source, status, started_at, completed_at, duration_ms, items_processed, items_succeeded, items_failed FROM automation_execution_log WHERE started_at >= datetime('now', '-72 hours') ORDER BY started_at DESC LIMIT 30;
UTC Timestamp: 2026-11-08T06:37:50.972Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.97ms
[
  {
    "results": [
      {
        "id": "aex_1794117727371_f23e5631",
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T06:02:07.371Z",
        "completed_at": "2026-11-08T06:02:08.084Z",
        "duration_ms": 713,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794117721748_80c0dc22",
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T06:02:01.748Z",
        "completed_at": "2026-11-08T06:02:02.593Z",
        "duration_ms": 845,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794117714783_5138729f",
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T06:01:54.783Z",
        "completed_at": "2026-11-08T06:01:56.352Z",
        "duration_ms": 1569,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794114062272_9b5d613d",
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T05:01:02.272Z",
        "completed_at": "2026-11-08T05:01:03.049Z",
        "duration_ms": 777,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794114056416_d86f5c33",
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T05:00:56.416Z",
        "completed_at": "2026-11-08T05:00:57.190Z",
        "duration_ms": 774,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794114049558_379a96c2",
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T05:00:49.558Z",
        "completed_at": "2026-11-08T05:00:51.364Z",
        "duration_ms": 1806,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794106927907_495407ff",
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T03:02:07.907Z",
        "completed_at": "2026-11-08T03:02:08.770Z",
        "duration_ms": 863,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794106921806_cdeddc65",
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T03:02:01.806Z",
        "completed_at": "2026-11-08T03:02:02.341Z",
        "duration_ms": 535,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794106915551_16454c34",
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T03:01:55.551Z",
        "completed_at": "2026-11-08T03:01:55.923Z",
        "duration_ms": 372,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0
      },
      {
        "id": "aex_1794103325172_f5d477f7",
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:02:05.172Z",
        "completed_at": "2026-11-08T02:02:05.932Z",
        "duration_ms": 760,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794103319304_e2461f50",
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:01:59.304Z",
        "completed_at": "2026-11-08T02:02:00.113Z",
        "duration_ms": 809,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794103313716_6fd97277",
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T02:01:53.716Z",
        "completed_at": "2026-11-08T02:01:54.450Z",
        "duration_ms": 734,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794099725987_fcb7d9b6",
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T01:02:05.987Z",
        "completed_at": "2026-11-08T01:02:07.644Z",
        "duration_ms": 1657,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794099720184_eedb9904",
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T01:02:00.184Z",
        "completed_at": "2026-11-08T01:02:00.958Z",
        "duration_ms": 774,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794099714671_ffc86966",
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T01:01:54.671Z",
        "completed_at": "2026-11-08T01:01:55.059Z",
        "duration_ms": 388,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794096127465_8c59b9a2",
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-08T00:02:07.465Z",
        "completed_at": "2026-11-08T00:02:07.931Z",
        "duration_ms": 466,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0
      },
      {
        "id": "aex_1794096121479_d93469ee",
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T00:02:01.479Z",
        "completed_at": "2026-11-08T00:02:02.258Z",
        "duration_ms": 779,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794096115311_2fad6276",
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-08T00:01:55.311Z",
        "completed_at": "2026-11-08T00:01:56.065Z",
        "duration_ms": 754,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794092528630_14be90d0",
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T23:02:08.630Z",
        "completed_at": "2026-11-07T23:02:09.359Z",
        "duration_ms": 729,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794092521578_a0ea3ed3",
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T23:02:01.578Z",
        "completed_at": "2026-11-07T23:02:03.201Z",
        "duration_ms": 1623,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794092515439_c673e029",
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T23:01:55.439Z",
        "completed_at": "2026-11-07T23:01:56.203Z",
        "duration_ms": 764,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794088926859_dee31948",
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T22:02:06.859Z",
        "completed_at": "2026-11-07T22:02:07.289Z",
        "duration_ms": 430,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794088921328_ff047eca",
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T22:02:01.328Z",
        "completed_at": "2026-11-07T22:02:01.719Z",
        "duration_ms": 391,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0
      },
      {
        "id": "aex_1794088915474_843ed581",
        "workflow_id": "reply_classification_followup",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T22:01:55.474Z",
        "completed_at": "2026-11-07T22:01:56.226Z",
        "duration_ms": 752,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794085327923_7f1259c8",
        "workflow_id": "new_inquiry_processing",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T21:02:07.923Z",
        "completed_at": "2026-11-07T21:02:08.677Z",
        "duration_ms": 754,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794085321969_ea868413",
        "workflow_id": "payment_status_reconciliation",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T21:02:01.969Z",
        "completed_at": "2026-11-07T21:02:02.746Z",
        "duration_ms": 777,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794085315211_da2f11a9",
        "workflow_id": "quota_health_checks",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T21:01:55.211Z",
        "completed_at": "2026-11-07T21:01:56.852Z",
        "duration_ms": 1641,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794081725665_e06740d1",
        "workflow_id": "authorized_outreach_dispatch",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "NO_ACTION_DUE",
        "started_at": "2026-11-07T20:02:05.665Z",
        "completed_at": "2026-11-07T20:02:06.481Z",
        "duration_ms": 816,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794081720221_83ae6883",
        "workflow_id": "b2b_suppression_and_compliance_audit",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T20:02:00.221Z",
        "completed_at": "2026-11-07T20:02:00.581Z",
        "duration_ms": 360,
        "items_processed": 0,
        "items_succeeded": 0,
        "items_failed": 0
      },
      {
        "id": "aex_1794081714795_e18eb9bc",
        "workflow_id": "healthcare_claim_verification",
        "trigger_source": "CLOUDFLARE_CRON",
        "status": "COMPLETED",
        "started_at": "2026-11-07T20:01:54.795Z",
        "completed_at": "2026-11-07T20:01:55.195Z",
        "duration_ms": 400,
        "items_processed": 3,
        "items_succeeded": 3,
        "items_failed": 0
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.9663
      },
      "duration": 0.9663,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1331,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT trigger_source, status, count(*), min(cycle_start), max(cycle_start) FROM autonomous_cycle_log WHERE cycle_start >= datetime('now', '-72 hours') GROUP BY trigger_source, status ORDER BY max(cycle_start) DESC;
UTC Timestamp: 2026-11-08T06:37:56.469Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 1.52ms
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
        "sql_duration_ms": 1.5171
      },
      "duration": 1.5171,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1268,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT id, trigger_source, cycle_start, cycle_end, status, opportunities_discovered, opportunities_qualified, actions_taken, revenue_recorded_inr FROM autonomous_cycle_log WHERE cycle_start >= datetime('now', '-72 hours') ORDER BY cycle_start DESC LIMIT 20;
UTC Timestamp: 2026-11-08T06:38:01.863Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.63ms
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
        "sql_duration_ms": 0.6316
      },
      "duration": 0.6316,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 1267,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

