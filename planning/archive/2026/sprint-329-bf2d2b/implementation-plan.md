# Implementation Plan – sprint-329-bf2d2b

> AGENTS.md §2.4 implementation plan. The full, detailed plan lives in
> `execution-plan.md`; this file is the §2.4-shaped summary. Companion backlog:
> `backlog.yaml`. **Planning gate: no implementation until the owner approves and says "Start sprint" (Rule S1).**

## Objective
- Make the scheduler emit a **full `InternalEventV2`** (not a partial projection) and publish on an
  **optional `topic`** defaulting to `internal.ingress.v1` — closing the Twitch-egress gap from the
  owner-attached note.

## Scope
- **In:** widen `EventDefinitionSchema`/`ScheduleDoc.event` to the full `InternalEventV2` authoring shape;
  add optional `topic`; remove hard-coded egress in `executeSchedule` and hard-coded topic in `handleTick`;
  validate `topic` against the governed catalog; update scheduler `topics.publishes`; tests + docs.
- **Out:** changing `InternalEventV2`/envelope/topic versions; new connectors or ingress-egress delivery;
  auth hardening beyond the author-settable field whitelist.

## Deliverables
- Code: `src/apps/scheduler-service.ts` (schema + `ScheduleDoc` + `executeSchedule` + `handleTick`).
- Config: `architecture.yaml` scheduler `topics.publishes` (additive).
- Tests: extend `tests/apps/scheduler-service.spec.ts` (egress passthrough, topic select/default,
  back-compat, negative).
- Docs: `create_schedule` description; `CHANGELOG.md`.

## Acceptance Criteria
- See `execution-plan.md` §6 and per-item `acceptance` in `backlog.yaml`.

## Testing Strategy
- Jest unit (Zod schema + topic validation) and integration (`/tick`) per `execution-plan.md` §7; reuse
  existing message-bus + Firestore mocks.

## Deployment Approach
- No new services; library/config-level change. Re-validate `architecture.yaml` via `brat config validate`.

## Dependencies
- `src/types/events.ts`, `src/services/message-bus/index.ts`, `architecture.yaml` topic catalog.

## Definition of Done
- Project-wide DoD (AGENTS.md §3): build + full Jest suite green; tests for all new behavior; CHANGELOG
  updated; every change traces to a BL-329-NNN item + `request-log.md`; `validate_deliverable.sh` logically
  passable; verification/retro/key-learnings authored; PR attempted (Rules S12/S13).

## Open Decisions (owner)
- **OD-1:** topic allow-list scope (full governed catalog vs curated subset) + scheduler `publishes` update.
- **OD-2:** author-settable vs server-owned `InternalEventV2` field whitelist.
