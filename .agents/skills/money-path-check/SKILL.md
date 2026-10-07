---
name: money-path-check
description: Read-only verification of the revenue pipeline: partner authorization, active offers, published content, and commission ledger.
---

# Money-Path Check Skill

## Purpose
Performs strict, non-mutating inspections of the complete affiliate money-path across the database and live endpoints.

## Inspection Checklist
1. **Partner Authorization**: Check `partners` table. Partner must have `approval_status IN ('APPROVED', 'PROVISIONAL')` and `authorization_status = 'AUTHORIZED'`.
2. **Affiliate ID**: Verify affiliate tag is configured in secrets or partner evidence without exposing its plaintext value.
3. **Offer Status**: Check `partner_offers` table. Must have at least 1 offer with `status = 'ACTIVE'` and valid canonical destination URL.
4. **Content Asset**: Check `commission_content_assets` table. Must have at least 1 guide with `status = 'PUBLISHED'`, mandatory Amazon statutory disclosure, and direct Amazon links.
5. **Ledger Audit**: Check `commission_records` table to ensure non-revenue clicks record ₹0 revenue and ledger balances reflect genuine external verified reports only.
