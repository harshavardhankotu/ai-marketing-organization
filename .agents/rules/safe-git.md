# Rule: Safe Git and Atomic State Checkpointing

## Core Principle
Git history is the durable, immutable timeline of product development. Every commit must represent a coherent, tested, and compile-clean state.

## Invariant Rules
1. **Never Break the Build on Main**: Every commit pushed to `main` must compile (`tsc --noEmit`) and pass existing tests.
2. **State Sync with Git**: Whenever a significant milestone or implementation unit is reached:
   - Run tests to confirm zero regressions.
   - Update `.agent/project-state.json` and `.agent/validation-state.json`.
   - Update `.agent/decision-log.md` if architectural decisions changed.
   - Stage relevant files and create an atomic git commit with a descriptive message.
3. **Protect Sensitive and Ephemeral Data**:
   - Never commit API keys, `.env` files with secrets, or personal credentials.
   - Never commit SQLite write-ahead logs (`*.db*`, `*.sqlite-shm`, `*.sqlite-wal`).
   - Keep node_modules, build outputs (`dist/`), and scratch scripts out of git.
