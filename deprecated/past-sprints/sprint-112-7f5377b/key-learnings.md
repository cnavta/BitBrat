# Key Learnings – sprint-112-7f5377b

- Default-off timeouts avoid phantom duplicates in at-least-once systems
- Retry filters must be explicit; timeouts aren’t safely retryable without idempotency
- Lightweight dedupe can dramatically reduce blast radius during incidents