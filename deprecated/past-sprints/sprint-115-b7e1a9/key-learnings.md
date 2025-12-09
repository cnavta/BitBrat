# Key Learnings – sprint-115-b7e1a9

- Keep helper APIs minimal, protected, and test-aware to encourage adoption without breaking patterns.
- Skipping message subscriptions in tests greatly simplifies unit testing and avoids flaky CI.
- Centralized subject prefixing (BUS_PREFIX) in BaseServer improves consistency and reduces duplicated code.
- Conservative defaults (explicit acks, safe error handling) help stability early; can be tuned later per service needs.
- Demonstrating usage immediately (llm-bot) helps validate API ergonomics and informs documentation.