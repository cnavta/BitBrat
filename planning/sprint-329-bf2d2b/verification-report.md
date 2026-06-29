# Deliverable Verification – sprint-329-bf2d2b (Scheduler: full InternalEventV2 events + optional emit topic)

- **Date:** 2026-06-28
- **Branch:** `feature/sprint-329-bf2d2b-scheduler-full-event-topic`
- **Decisions:** OD-1 = Plan of Record; OD-2 = Plan of Record; **G4 (owner override): NO back-compat —
  existing schedule data will be deleted.**

## Completed
- [x] **BL-329-001** — `EventDefinitionSchema` widened to a full `InternalEventV2` authoring Zod schema:
      `type`, `egress` (mirrors `Egress`, `connector` reuses `ConnectorType` incl. `'twitch'`), `ingress`
      overrides, `identity`, `payload`, `message` (MessageV1), `annotations` (AnnotationV1[]), `candidates`
      (CandidateV1[]), `qos`, `externalEvent`, `metadata`. No invented fields/connectors.
- [x] **BL-329-002** — Optional `topic` added to `CreateScheduleSchema`/`UpdateScheduleSchema`;
      `ScheduleDoc.event` retyped to `ScheduledEventInput` (full shape) and `ScheduleDoc.topic?: string`
      added. `CreateScheduleSchema` + `DEFAULT_PUBLISH_TOPIC`/`ALLOWED_PUBLISH_TOPICS` exported for tests.
- [x] **BL-329-003** — `executeSchedule` honors author-supplied `egress`/`identity`/`message`/`annotations`/
      `candidates`/`qos`/`externalEvent`/`metadata`; egress falls back to `{ destination:'system',
      connector:'system' }` ONLY when unset. Server still owns `v`, `correlationId`, `traceId`,
      `ingress.ingressAt`+`source:'scheduler'`, and `routing` (OD-2).
- [x] **BL-329-004** — `handleTick` publishes each due schedule on `topic ?? internal.ingress.v1`, caching
      one publisher per distinct topic. Tick `lastRun`/`nextRun`/`enabled` (once-off disable) unchanged.
- [x] **BL-329-100** — `topic` validated via Zod refine against the curated governed allow-list
      (`internal.ingress.v1`, `internal.egress.v1`); unknown topic rejected; omitted topic → default.
- [x] **BL-329-101** — `architecture.yaml`: scheduler `topics.publishes` += `internal.egress.v1`, and
      `scheduler` added as a producer on the `internal.egress.v1` catalog entry. `brat config validate`
      passes ("Config valid").
- [x] **BL-329-102** — `create_schedule` description advertises the full `InternalEventV2`, the `egress`
      Twitch example, and the optional `topic` (default `internal.ingress.v1`). Context Pack binding intact.
- [x] **BL-329-200** — Integration tests: Twitch egress passthrough (exact equality), chosen-topic +
      default-topic via captured publisher subject, server-owned fields present.
- [x] **BL-329-201** — `CreateScheduleSchema` unit tests (full event ok; malformed `type` / bad
      `egress.connector` rejected; known/unknown/omitted topic) + system-egress fallback test.
- [x] **BL-329-500** — `validate_deliverable.sh` present, idempotent, logically passable.

## Validation Evidence
- `npx tsc -p tsconfig.json --noEmit` → exit 0 (type-check clean).
- `npm run build` → exit 0.
- `npx jest tests/apps/scheduler-service.spec.ts` → 9/9 passed.
- `npm test` (full suite) → **279 suites passed / 1 skipped; 1097 tests passed / 2 skipped**; no regressions.
- `npm run brat -- config validate` → "Config valid".
- `npm run release:dry -- patch` → 0.7.2 → 0.7.3 (dry-run; wrote nothing; three version files agree).

## Partial
- None.

## Deferred
- None for the sprint goal. (No release was cut this sprint; a `brat release <bump>` may be run at Publish
  if the owner wants 0.7.3 tagged.)

## Alignment Notes
- **G4 deviation from the original plan:** the back-compat goal (G4 in `execution-plan.md`) and its
  back-compat test (original BL-329-201) were intentionally **dropped per the owner's override** — there is
  no legacy partial-event path; existing data is deleted, not migrated. CHANGELOG records this as a BREAKING
  removal under `[Unreleased]`.
- OD-1 realized as a **curated** allow-list (`internal.ingress.v1`, `internal.egress.v1`) — narrow, with the
  egress topic being exactly what the Twitch scenario needs; widen later with evidence.
