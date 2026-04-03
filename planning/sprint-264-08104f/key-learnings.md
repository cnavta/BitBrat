# Key Learnings – sprint-264-08104f

- Canonical service naming in `architecture.yaml` must override TA or bootstrap naming immediately; preserving compatibility wrappers is safer than renaming the canonical contract late.
- Ephemeral behavioral features benefit from explicit contract boundaries: observation events, TTL-backed storage, state mutation keys, and downstream prompt guidance were easier to validate because each boundary had focused tests.
- Closing the loop with targeted post-validation regressions (`/health` in this sprint) prevents sprint-closeout surprises and should remain part of the final verification habit.