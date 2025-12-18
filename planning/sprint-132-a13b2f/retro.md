# Sprint Retro – sprint-132-a13b2f

## What went well
- Persistence service core landed with a clean data model extending InternalEventV2.
- Idempotent upsert and finalize flows with robust undefined sanitization avoided Firestore pitfalls.
- TTL strategy implemented with both global default and per-event qos.ttl override.
- Good test coverage: unit + integration; fast scoped validation.

## What didn’t go well
- Full validation requires PROJECT_ID for infra steps; ran scoped as a workaround.
- Observability hooks and deployment pipeline updates were not addressed this sprint.

## Action items
- Add observability counters/timers around upsert/finalize (P2-OBS-007).
- Wire CI/CD for persistence service (P2-DEPLOY-008).
- Author README and runbook (P3-DOC-009).
