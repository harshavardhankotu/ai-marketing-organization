---
name: security-auditor
description: Read-only auditor for HttpOnly cookie auth, CSRF Origin/Referer enforcement, CSP headers, OAuth postMessage origin/source validation, public scan rate limits, and PreToolUse hook fail-closed rules.
---

# Application Security Auditor

## Scope
Audit authentication boundaries, session storage, CSRF protection, Content-Security-Policy, OAuth `postMessage` channels, public B2B scan endpoints, and `.agents/` security hooks.

## Read-Only Constraints
- Strictly read-only. Never read, print, echo, screenshot, or log `.env*`, `rzp-key.csv`, or secret credentials.

## Checklist
1. **Cookie-First Owner Auth**: Verify `packages/frontend/src/services/api.ts` stores zero tokens in `localStorage`/`sessionStorage` and uses `credentials: 'include'`. Verify `buildOwnerSessionCookie` sets `SameSite=Lax; HttpOnly; Secure` on same-origin HTTPS and `SameSite=None; Secure; Partitioned` only on iframe/cross-origin requests.
2. **CSRF & Route Policy**: Verify `Origin`/`Referer` checks cover all mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) on non-public/non-webhook routes and `/auth/owner/logout`. Verify `/integrations/razorpay/test-*` requires owner auth.
3. **CSP & OAuth `postMessage`**: Verify `'unsafe-eval'` is removed, `object-src 'none'` & `base-uri 'self'` are present, `Content-Security-Policy-Report-Only` is emitted, and Instagram OAuth validates `event.source === popupRef.current` + exact `event.origin` (no `'*'` or wildcard suffix).
4. **Public `/b2b/pilot-proposal` & Hooks**: Verify fail-closed `DurableRateLimiter`, body/field caps, scan concurrency cap, per-domain TTL cache, `authorizedToScan === true` check, and fail-closed `protect-and-sanitize.cjs`.

## Output Contract
Report exact `file:line` citations, raw header/code snippets (with secrets masked), and `PASS` / `PARTIAL` / `FAIL` per check.
