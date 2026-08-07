# Retro – sprint-329-bf2d2b (Scheduler: full InternalEventV2 events + optional emit topic)

## What worked
- **Grounding the schema in the canonical type** (`src/types/events.ts`) kept the Zod authoring schema in
  lockstep with `InternalEventV2` (G2/Law #2) — egress reuses `ConnectorType`, so `'twitch'` came for free.
- **G4 simplified the work:** dropping back-compat meant `ScheduleDoc.event` could be replaced outright with
  the full authoring shape — no dual-path/migration code, fewer tests, clearer intent.
- **Capturing the publisher subject in the test mock** made topic selection directly assertable; the
  per-topic publisher cache in `handleTick` kept correctness without micro-optimizing.
- **Tight server/author split (OD-2):** server always owns `v/correlationId/traceId/ingress.ingressAt+
  source/routing`, so widening the input surface didn't open an identity/trace forgery hole.

## What didn't (friction)
- `brat`/`release:dry` run from `dist/`, so a `npm run build` is required before `brat config validate` /
  `release:dry` — easy to forget on a fresh checkout.
- The original BL-329-201 assumed back-compat; the owner's G4 override required reshaping that item
  mid-sprint (now negative + default-egress tests). Logged in `request-log.md` (REQ-002).

## Follow-ups
- Consider widening the curated topic allow-list beyond `internal.ingress.v1` / `internal.egress.v1` only
  with concrete need (e.g. `internal.finalize.v1`), and consider sourcing it from the canonical catalog
  rather than a curated constant if the list grows.
- Optional: cut `0.7.3` via `npm run release -- patch` at Publish if the owner wants the version tagged.
