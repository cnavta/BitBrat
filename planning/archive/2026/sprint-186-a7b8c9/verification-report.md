# Deliverable Verification – sprint-186-a7b8c9

## Completed
- [x] Firestore collection `schedules` schema defined and implemented.
- [x] `scheduler-service` updated with Firestore integration.
- [x] MCP tools implemented: `list_schedules`, `create_schedule`, `update_schedule`, `delete_schedule`, `get_schedule`.
- [x] Execution logic implemented via `/tick` endpoint and `internal.scheduler.tick` topic.
- [x] Cron expression support for repeatable events.
- [x] Once-off event support with auto-disable.
- [x] Events published to `internal.ingress.v1` as `InternalEventV2`.
- [x] Unit/Integration tests created and passing.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- Added `/tick` HTTP endpoint in addition to Pub/Sub for easier Cloud Scheduler integration and testing.
- Events use `source: 'scheduler'` to distinguish them from other ingress sources.
