Deliverable Verification - sprint-125-7c8e2a

Completed:
- Implemented per-command sigil overrides and termLocation (prefix | suffix | anywhere) with strict whitespace boundaries
- Enforced ALLOWED_SIGILS whitelist (supports multi-character)
- Normalized Firestore docs: preserve sigil; default termLocation to 'prefix' when missing
- Parentheses-only args parsing where applicable; legacy space-separated args for prefix retained
- Added unit tests covering normalization, termLocation behaviors, parentheses args, alias behavior, and ALLOWED_SIGILS gating
- Feature branch pushed and PR created: https://github.com/cnavta/BitBrat/pull/27
- Publication recorded in planning/sprint-125-7c8e2a/publication.yaml

Partial:
- Telemetry logs for match type/effectiveSigil/indices (CP-007) — not implemented
- Inline docs/comments for configuration and matching semantics (CP-015) — not implemented

Deferred:
- Performance smoke/review documenting bounded Firestore lookups (CP-019)

Validation Results:
- Build: OK locally
- Tests: Failures observed in this execution environment; per Force Completion directive, closing sprint with failures documented for follow-up.

Publication:
- PR: https://github.com/cnavta/BitBrat/pull/27
- Branch: feature/sprint-125-7c8e2a-command-processor-sigil-term
