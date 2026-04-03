# Retro – sprint-265-7283d4

- What worked:
  - Converting structured user context into first-class prompt sections exposed the root cause quickly and made the regression surface easier to test.
  - Targeted repro tests caught both the original requesting-user bug and the follow-on append-mode / disposition regressions before publication.
- What didn’t go smoothly:
  - Existing prompt annotations were carrying multiple semantic categories (task instructions, user identity, behavioral disposition), so fixing one leakage path exposed additional section-placement regressions.
  - The broader llm-bot Jest sweep still reports pre-existing MCP reconnect timer open handles, which complicates clean shutdown during validation.
- Follow-up note:
  - Future prompt-assembly work should continue separating “instruction”, “user profile/context”, and “behavioral state” inputs so they do not share a generic prompt-annotation path.
- Publication:
  - Branch pushed and PR created successfully: https://github.com/cnavta/BitBrat/pull/179