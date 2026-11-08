# 06_providers.md

### Query: SELECT * FROM provider_quota_ledger ORDER BY updated_at DESC;
UTC Timestamp: 2026-11-08T06:44:52.728Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.33ms
[
  {
    "results": [
      {
        "provider": "google_pagespeed",
        "window_key": "2026-11-07",
        "window_type": "UTC_DAY",
        "configured_status": "CONFIGURED",
        "cap_limit": 40,
        "safety_reserve": 5,
        "used_count": 0,
        "reserved_count": 0,
        "failed_count": 0,
        "last_reset_at": "2026-11-07 14:01:36",
        "next_reset_at": "2026-11-08 14:01:36",
        "circuit_breaker_state": "CLOSED",
        "last_error": null,
        "updated_at": "2026-11-08 06:20:30"
      },
      {
        "provider": "google_suggest",
        "window_key": "2026-11-08",
        "window_type": "UTC_DAY",
        "configured_status": "CONFIGURED",
        "cap_limit": 80,
        "safety_reserve": 8,
        "used_count": 12,
        "reserved_count": 0,
        "failed_count": 0,
        "last_reset_at": "2026-11-08 00:01:31",
        "next_reset_at": "2026-11-09 00:01:31",
        "circuit_breaker_state": "CLOSED",
        "last_error": null,
        "updated_at": "2026-11-08 06:20:23"
      },
      {
        "provider": "google_suggest",
        "window_key": "2026-11-07",
        "window_type": "UTC_DAY",
        "configured_status": "CONFIGURED",
        "cap_limit": 80,
        "safety_reserve": 8,
        "used_count": 11,
        "reserved_count": 0,
        "failed_count": 0,
        "last_reset_at": "2026-11-07 14:01:31",
        "next_reset_at": "2026-11-08 14:01:31",
        "circuit_breaker_state": "CLOSED",
        "last_error": null,
        "updated_at": "2026-11-07 23:01:30"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.3283
      },
      "duration": 0.3283,
      "changes": 0,
      "last_row_id": 0,
      "changed_db": false,
      "size_after": 37195776,
      "rows_read": 6,
      "rows_written": 0,
      "total_attempts": 1
    }
  }
]
```

### Query: SELECT * FROM provider_quota_state;
UTC Timestamp: 2026-11-08T06:44:59.287Z
```json
⛅️ wrangler 4.158.0
────────────────────
Resource location: remote 

🌀 Executing on remote database prod-db (0563bb85-f6d2-483f-8b0f-0784e3d604c7):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.52ms
[
  {
    "results": [
      {
        "id": "gemini",
        "provider": "GEMINI",
        "provider_limit": null,
        "application_limit": 50,
        "requests_today": 26,
        "credits_consumed_month": 0,
        "credits_estimated_remaining": null,
        "rate_limit_responses": 0,
        "successful_requests": 12,
        "failed_requests": 14,
        "is_locked": 0,
        "lock_reason": null,
        "last_reset": "2026-10-06T00:12:00.227Z",
        "next_reset": "2026-11-04T00:01:45.850Z",
        "reset_window_hours": 24,
        "last_successful_request": "2026-11-01T23:03:23.807Z",
        "last_rate_limit": null,
        "updated_at": "2026-11-03T00:03:47.992Z",
        "source": "SYSTEM",
        "unlogged_credits": 0,
        "unlogged_reason": null,
        "limit_source": "ASSUMPTION"
      },
      {
        "id": "tavily",
        "provider": "TAVILY",
        "provider_limit": 1000,
        "application_limit": 700,
        "requests_today": 0,
        "credits_consumed_month": 19,
        "credits_estimated_remaining": 681,
        "rate_limit_responses": 0,
        "successful_requests": 65,
        "failed_requests": 0,
        "is_locked": 0,
        "lock_reason": null,
        "last_reset": "2026-10",
        "next_reset": "2026-11-01T00:00:00.000Z",
        "reset_window_hours": 720,
        "last_successful_request": "2026-11-03T00:03:18.721Z",
        "last_rate_limit": null,
        "updated_at": "2026-11-03 07:01:30",
        "source": "PROVIDER_API",
        "unlogged_credits": 0,
        "unlogged_reason": "PROVIDER_API_SYNC",
        "limit_source": "PROVIDER_API"
      }
    ],
    "success": true,
    "meta": {
      "served_by": "v3-prod",
      "served_by_region": "WEUR",
      "served_by_colo": "AMS",
      "served_by_primary": true,
      "timings": {
        "sql_duration_ms": 0.5214
      },
      "duration": 0.5214,
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

### Command: curl.exe -sS -i --max-time 15 -H "Authorization: Bearer [REDACTED]" "https://api.tavily.com/usage"
UTC Timestamp: 2026-11-08T06:45:04.748Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:06 GMT
Content-Type: application/json
Content-Length: 312
Connection: keep-alive
content-security-policy: default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self';base-uri 'self';form-action 'self'; require-trusted-types-for 'script'; upgrade-insecure-requests;

{"key":{"usage":19,"limit":1000,"search_usage":19,"crawl_usage":0,"extract_usage":0,"map_usage":0,"research_usage":0},"account":{"current_plan":"Researcher","plan_usage":19,"plan_limit":1000,"search_usage":19,"crawl_usage":0,"extract_usage":0,"map_usage":0,"research_usage":0,"paygo_usage":0,"paygo_limit":null}}
```

### Provider: Firecrawl
UTC Timestamp: 2026-11-08T06:45:06.197Z
```
FIRECRAWL_API_KEY: NOT_CONFIGURED (Key not present in .env, .env.local, or .env.render.production)
```

### Command: curl.exe -sS -i --max-time 15 -H "Authorization: Token [REDACTED]" "https://developers.cuelinks.com/pub_api/v3/ping"
UTC Timestamp: 2026-11-08T06:45:06.649Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:07 GMT
Content-Type: application/json; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
server: cloudflare
x-frame-options: SAMEORIGIN
x-xss-protection: 0
x-content-type-options: nosniff
x-download-options: noopen
x-permitted-cross-domain-policies: none
referrer-policy: strict-origin-when-cross-origin
etag: W/"3f91934ec38996b436411472a5793ca2"
cache-control: max-age=0, private, must-revalidate
x-request-id: c9ba729a-0ead-40f6-a0d8-01174c14b63d
x-runtime: 0.031834
vary: Accept, Origin
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
cf-cache-status: DYNAMIC
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=1xi2jdOBvE7acHn73KJfUmOXTTdJssDqNA6bO%2FECU3qId9h1ekiaOoHukiJsG4rZK0LzfBj5U5x%2Fj5SWEONQP21gYW83c%2FHVdYGk7EJ4r1YqI9oJNRpzIEV7jOSZyvZ5aoHK%2F3IaG7Er"}]}
CF-RAY: a5729ceefa72a7b7-BOM

{"status":"ok","version":"3.0","publisher":{"id":281897,"name":"Harshavardhan Venkata Sai Kotu","email":"vardhankotu@gmail.com","publisher_id":"281897","currency":"INR"},"api_key":{"name":"Marketing","scopes":["read:campaigns","read:reports","read:transactions","read:offers","write:links","read:channels","write:channels","read:invoices","read:missing_transactions","write:missing_transactions"],"last_used_at":"2026-11-08T06:45:07.114Z"}}
```

### Command: curl.exe -sS -i --max-time 15 -H "Authorization: Token [REDACTED]" "https://developers.cuelinks.com/pub_api/v3/channels.json"
UTC Timestamp: 2026-11-08T06:45:07.017Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:07 GMT
Content-Type: application/json; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
server: cloudflare
x-frame-options: SAMEORIGIN
x-xss-protection: 0
x-content-type-options: nosniff
x-download-options: noopen
x-permitted-cross-domain-policies: none
referrer-policy: strict-origin-when-cross-origin
etag: W/"8437c6d3ab1b4a3d52c0ce74ffdc1538"
cache-control: max-age=0, private, must-revalidate
x-request-id: 6ce19521-3e09-4ded-9631-569311bb223e
x-runtime: 0.036788
vary: Origin
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
cf-cache-status: DYNAMIC
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=3e0jJNnNK3jf69egTDDQvk5K1mPWOof4iOCGEvQCHrqY2ICJDaryZ5%2FTIFw%2Bvc%2FA7fJoPFxzn04%2Bipdy95BPlhh2M%2Bux4%2FPwrqpwdXDvLa4vjacGKTPYd9b%2B48Kv3KQ%2Fm8xlz157CZjM"}]}
CF-RAY: a5729cf1298269ae-BOM

{"data":[{"id":331585,"name":"AI Marketing Organization - Autonomous closed-loop marketing for Indian SMBs","source_url":"https://ai-marketing-organization.onrender.com","category":"Website / Blog","status":"approved","is_default":true,"created_at":"2026-10-24T20:33:36Z"}],"meta":{"page":1,"per_page":30,"total":1,"total_pages":1,"next_page":null,"prev_page":null}}
```

### Command: curl.exe -sS -i --max-time 15 -H "Authorization: Token [REDACTED]" "https://developers.cuelinks.com/pub_api/v3/campaigns.json?channel_id=331585&page=1&per_page=2"
UTC Timestamp: 2026-11-08T06:45:07.437Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:07 GMT
Content-Type: application/json; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
server: cloudflare
x-frame-options: SAMEORIGIN
x-xss-protection: 0
x-content-type-options: nosniff
x-download-options: noopen
x-permitted-cross-domain-policies: none
referrer-policy: strict-origin-when-cross-origin
etag: W/"fcf0ba8ea715ee642b99e62fd73a8849"
cache-control: max-age=0, private, must-revalidate
x-request-id: 9b8e8f30-0ed3-4455-ac9c-05235a0b0481
x-runtime: 0.138127
vary: Origin
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
cf-cache-status: DYNAMIC
Report-To: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=jsHI5KGwhBLT8NzXoRJSGDWfBZXyAvDN6lWxVReotbktrb%2F%2FBYk0U19a5XUpnL2U0erg7CSkk8FaFyBKBuyGXw1%2Bmx2f%2FxnsvUWom3cv0TjC86KmhJ0pBlBv76tleSBIWyG3eSmZVURg"}]}
CF-RAY: a5729cf36866b1e3-BOM

{"data":[{"id":43666,"name":"0000art","url":"https://www.0000art.com","domain":"0000art.com","image":"https://cdn0.cuelinks.com/uploads/images/Placeholder-Campaign.png","payout_type":"Per Click","payout":"0.14","payout_currency":"INR","campaign_type":"CPC","access_status":"not_applied","categories":[{"id":1,"name":"Fashion"}],"countries":[{"id":57,"iso":"DE","name":"Germany"}],"reporting_type":"Offline","deeplink_allowed":false,"sub_ids_allowed":true,"cashback_publishers_allowed":false,"social_media_publishers_allowed":false,"missing_transactions_accepted":false,"cookie_duration":"30 minutes","is_featured":false,"epc_7d":"0.0","epc_90d":"0.0","tracking_url":"https://linksredirect.com/?cid=331585\u0026source=api\u0026url=https%3A%2F%2Fwww.0000art.com","updated_at":"2026-08-11T10:14:48Z"},{"id":75252,"name":"001lens","url":"https://www.001lens.jp","domain":"001lens.jp","image":"https://cdn0.cuelinks.com/uploads/images/Placeholder-Campaign.png","payout_type":"Per Click","payout":"0.14","payout_currency":"INR","campaign_type":"CPC","access_status":"not_applied","categories":[{"id":8,"name":"Health \u0026 Beauty"}],"countries":[{"id":114,"iso":"JP","name":"Japan"}],"reporting_type":"Offline","deeplink_allowed":true,"sub_ids_allowed":false,"cashback_publishers_allowed":false,"social_media_publishers_allowed":false,"missing_transactions_accepted":false,"cookie_duration":"30 minutes","is_featured":false,"epc_7d":"0.0","epc_90d":"0.0","tracking_url":"https://linksredirect.com/?cid=331585\u0026source=api\u0026url=https%3A%2F%2Fwww.001lens.jp","updated_at":"2026-07-22T11:34:31Z"}],"meta":{"page":1,"per_page":2,"total":25821,"total_pages":12911,"next_page":2,"prev_page":null}}
```

## Provider Credential Mode Report
UTC Timestamp: 2026-11-08T06:45:07.437Z

| Provider | Key Name in Environment | Key Prefix / Mode Indicator | Classified Mode |
| :--- | :--- | :--- | :--- |
| **Razorpay** | `RAZORPAY_KEY_ID` / `RAZORPAY_TEST_KEY_ID` | Prefix: `rzp_test_*` (or unconfigured in production) | **TEST_MODE / SANDBOX** (Verified in /api/v1/public/autonomy-status: paymentMode = 'SANDBOX') |
| **Cuelinks** | `CUELINKS_API_KEY` | Live Token Authenticated | **LIVE_MODE (Network: developers.cuelinks.com/pub_api/v3, Channel ID: 331585, Status: approved)** |
| **Tavily** | `TAVILY_API_KEY` | Prefix: `tvly-*` (Plan: Researcher, Limit: 1000/mo, Used: 19) | **LIVE_MODE (Free Researcher Tier)** |
| **Firecrawl** | `FIRECRAWL_API_KEY` | Unset | **NOT_CONFIGURED** |
| **Google Gemini** | `GEMINI_API_KEY` | Configured in .env & Render | **LIVE_MODE (Google AI Studio Free Tier)** |
