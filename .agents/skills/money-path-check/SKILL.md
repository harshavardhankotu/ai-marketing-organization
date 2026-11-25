---
name: money-path-check
description: Read-only verification of the B2B SiteFix/Founding Pilot, Razorpay checkout, Cuelinks affiliate, and commission ledger pipelines.
---

# Money-Path Check Skill

## Purpose
Performs strict, non-mutating inspections of active revenue lanes across the database and live read-only endpoints.

## Inspection Checklist
1. **B2B Founding Pilot & SiteFix Checkout**: Check `durable_events` (`b2b_proposal_*`) and `universal_orders` to confirm public proposals remain `UNPRICED_DRAFT` until owner approval and `create-b2b-order` / Razorpay orders enforce server-side prices only.
2. **Razorpay Readiness & Ledger**: Confirm `RAZORPAY_KEY_ID` / webhook verification integrity without exposing secrets; confirm `revenue_records` and `delivery_tasks` reflect genuine captured payments only.
3. **Cuelinks Partner Authorization**: Check `partners` and `partner_offers` tables (`approval_status IN ('APPROVED', 'PROVISIONAL')`, `authorization_status = 'AUTHORIZED'`, `status = 'ACTIVE'`).
4. **Ledger Audit**: Check `commission_records` and `revenue_records` to ensure non-revenue clicks/views record ₹0 revenue and bank-confirmed cash remains ₹0.00 until verified settlement.
5. **Optional Amazon Associates**: When auditing Amazon Associates specifically, load `.agents/skills/amazon-associates-compliance/SKILL.md`.
