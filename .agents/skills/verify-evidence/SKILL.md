---
name: verify-evidence
description: Standards and procedures for auditing evidence and grading requirements PASS, PARTIAL, or FAIL.
---

# Verify Evidence Skill

## Purpose
Enforces rigorous, unforgeable verification standards across all operational reports and task evaluations.

## Grading Rubric
- **PASS**: Requirement is 100% met, confirmed with verbatim raw machine evidence (database rows, HTTP status codes, command outputs).
- **PARTIAL**: Requirement is only proposed, drafted, or partly implemented without complete end-to-end operational proof.
- **FAIL**: Requirement is not met, broken, or violates system invariants.

## Evidence Rules
1. **Raw Evidence Required**: Every claim must quote exact command outputs, file paths, and database query results.
2. **Never Print Secrets**: Mask API keys, tokens, session hashes, and the private affiliate tracking tag.
3. **Execution Limits**: All HTTP verification requests must use `curl -m 30` (or `curl.exe -m 30`). Unit test runs must use `--test-timeout=30000`. Kill any process exceeding 60 seconds.
