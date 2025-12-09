# Sprint Retro – sprint-116-4f7a1c

What worked:
- Rapid assessment of services and clear backlog creation.
- Incremental migrations using BaseServer helpers minimized risk and improved observability.
- Adding explicit Cloud Build parameter echoes made deployments auditable end-to-end.

What didn’t:
- None noted (planning-only).
- Early test flakiness around message subscriptions under Jest until we standardized on MESSAGE_BUS_DISABLE_SUBSCRIBE=1.

Improvements:
- Confirm priorities with stakeholders before starting refactors.
- Keep a standard test harness toggle for bus subscriptions across all suites.
- Add end-to-end dry-run checks in CI for brat deploy to continuously verify substitutions.