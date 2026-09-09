# Known Issues & Observations

- **Stability Test**: Fully passed.
- **Port Allocations**: Backend on `:3001`, Frontend on `:3000` with reverse proxy `/api/*` -> `:3001`.
- **Zero External API Dependency**: Offline fallback and sandbox adapters ensure 100% operational reliability even if external Gemini or Meta credentials are absent.