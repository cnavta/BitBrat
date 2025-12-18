# Key Learnings - sprint-147-3f8a1b

- **Test Coverage Awareness**: Tests located in `infrastructure/` and `tests/` (outside `src/`) can easily be missed if the validation strategy only focuses on `src/`.
- **Event Source semantics**: Re-confirmed that in our V2 architecture, `source` in transport attributes (message bus level) identifies the service currently handling/sending the message, while the internal payload `source` identifies the original ingress point.
