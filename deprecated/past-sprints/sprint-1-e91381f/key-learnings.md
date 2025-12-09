Key Learnings – sprint-1-e91381f

- Designing for a noop message bus and mocked LLM agent drastically reduces cycle time and flakiness.
- Keeping architecture.yaml as the single source of truth simplifies service wiring and testing.
- Small, composable helpers (prompt extraction, routing advance) improve testability and reuse.
- Publication metadata should be treated as code and validated in CI to avoid drift.