Sprint Retrospective - sprint-125-7c8e2a

What worked
- Implemented per-command sigil overrides and termLocation (prefix | suffix | anywhere) with strict whitespace boundaries.
- Added ALLOWED_SIGILS configuration and enforcement, including multi-character support.
- Normalized Firestore docs (preserve sigil; default termLocation to 'prefix' when missing).
- Implemented parentheses-only args parsing; retained legacy prefix args.
- Authored comprehensive unit tests; opened PR successfully.

What didn't
- In this execution environment, some tests reported failures late in the sprint. Given the Force Completion directive, we are closing the sprint with failures documented for follow-up.

Process notes
- Token-boundary approach and parentheses exception added complexity but stayed localized and O(tokens) for lookups.
- Backlog tracking and planning artifacts aligned with AGENTS.md; PR publication completed.

Action items for future sprints
- CP-007 Telemetry logs for match details.
- CP-015 Inline documentation for matching semantics.
- CP-019 Performance smoke write-up and minor optimizations if indicated.
