# Rule: Repository-First Source of Truth

## Core Principle
The repository filesystem, Git commits, and the SQLite/D1 database are the absolute single source of truth. The AI model's context window is ephemeral, transient, and subject to termination or compaction.

## Invariant Rules
1. **Never Depend on Model Memory**: Do not assume any previous turn or conversation history is remembered. Every session must inspect the actual files, `.agent/` state files, git history, and database before acting.
2. **State Persistence**: Every state transition, workflow execution, agent decision, approval, and metric must be persisted directly to the database or `.agent/` state files.
3. **Reproducible Builds**: All configuration, dependencies, environmental defaults, seeds, and test suites must run deterministically from the repository code without hidden manual steps.
4. **Resumability**: If the process or model execution terminates abruptly at any moment, another instance must be able to inspect `git status`, `.agent/project-state.json`, and database checkpoints to resume cleanly without duplicate work or corrupted state.
