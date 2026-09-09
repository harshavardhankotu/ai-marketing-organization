# Security & Regulatory Compliance Guide

## Core Safeguards
1. **Tenant Isolation**: Every database query is strictly partitioned by `organization_id`.
2. **Emergency Kill Switch**: Accessible via UI or API (`POST /api/v1/kill-switch`). Halts all active executions immediately while preserving state.
3. **Indian Medical & Advertising Compliance**:
   - ASCI Code adherence: All claims require documented evidence.
   - Medical Council of India (MCI) compliance: Prohibits guaranteed medical cure claims or misleading before/after images without clinical disclaimers.
   - RERA compliance for real estate campaigns.
4. **Secret Sanitization**: No credentials or private tokens are logged or included in model prompts.