# Rule: Verification Before Claims

## Core Principle
Never claim or state that an implementation, component, agent, pipeline, or integration is complete, functional, or working without verifiable evidence from deterministic automated tests, compiler checks, or live runtime execution.

## Invariant Rules
1. **Evidence-Based Completion**: A task is only complete when:
   - TypeScript compilation succeeds with zero errors (`tsc --noEmit`).
   - Automated unit and integration tests run and pass cleanly.
   - Live endpoints or interfaces are queried and return expected responses.
2. **No False Positives**: Do not declare success simply because code was written or scaffolding was generated.
3. **Transparent Failure**: If a test or build fails, report the exact stack trace, root cause, and immediate corrective action.
4. **Validation Artifacts**: Update `.agent/validation-state.json` with the exact test results, pass counts, and timestamps after each verification run.
