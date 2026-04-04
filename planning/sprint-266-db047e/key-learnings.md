# Key Learnings – sprint-266-db047e

- Wrapping routing state in `InternalEventV2.routing` and `RuleDoc.routing` requires synchronized updates across rule ingestion, runtime routing helpers, service entrypoints, and all fixture layers; partial migrations leave easy-to-miss failures in shared tests.
- For staged routing, finalizing the current slip before promoting a pending route is essential; otherwise completion bookkeeping leaks into the newly promoted route and corrupts ordered `routing.history`.
- A sprint-specific validation script is useful when the repository-wide validator is broader than the sprint scope, because it preserves a real build/test workflow while staying aligned to the exact modules changed.