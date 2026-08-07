# Implementation Plan – sprint-319-740b5b

## Objective
Introduce a new `brat backup` command that exports and imports **JSON backups of the platform's
core configuration Firestore collections**, explicitly **excluding `events` and all other
log-based collections**, so the core configuration of one platform instance can be transferred to
a blank instance (disaster recovery, environment cloning, and dev/prod seeding).

## Scope

### In scope
- **Task 1 (current):** Author a Technical Architecture document that defines the approach:
  problem statement, collection classification (config vs. log/event), backup file format, the
  allowlist collection registry, export/import data flow, CLI surface, Firestore-type
  serialization, safety/idempotency/secrets handling, risks, and a phased rollout.
- Future tasks (to be appended per section 2.4.1 once Task 1 is approved): implementation of the
  `brat backup export|import` command, a Firestore provider for brat, the collection registry,
  the typed JSON (de)serializer, and tests.

### Out of scope (for Task 1)
- Writing or modifying any `brat` command code, providers, or the CLI dispatcher.
- Changes to `architecture.yaml`, `firestore.rules`, `firestore.indexes.json`, or service code.
- Performing any real export/import against a live Firestore database.

## Deliverables
- **Task 1:** `documentation/technical-architecture/brat-firestore-config-backup.md`.
- Sprint protocol artifacts: `sprint-manifest.yaml`, `request-log.md`, `implementation-plan.md`,
  and (at completion) `verification-report.md`, `validate_deliverable.sh`, `publication.yaml`,
  `retro.md`, `key-learnings.md`.

## Acceptance Criteria
- **Task 1:** A reviewed Technical Architecture document exists that:
  - Accurately classifies the platform's existing Firestore collections into **config/core**
    (included) and **log/event** (excluded), with the `events` family explicitly excluded.
  - Defines an **allowlist-based collection registry** (fail-safe: unknown collections excluded).
  - Specifies a **versioned JSON backup envelope** that round-trips Firestore-native types
    (Timestamp, GeoPoint, DocumentReference, Bytes) and nested subcollections, preserving document IDs.
  - Defines the `brat backup export|import` CLI surface consistent with existing brat command
    conventions (`--env`, `--project-id`, `--dry-run`, JSON output, exit codes).
  - Defines import safety semantics (dry-run default, merge/overwrite/skip modes, `--confirm`,
    batched writes), secrets handling, and a "blank target" restore path.
  - Aligns with `architecture.yaml` (precedence) and AGENTS.md.

## Testing Strategy
- Task 1 is a **documentation deliverable**; validation is structural (Markdown structure/link
  sanity + verification that every referenced collection/file/symbol exists in the repo). No code
  build is required for Task 1 (AGENTS.md §6 documentation note + DoD "non-code tasks").
- Implementation tasks (future) will add real validation via `validate_deliverable.sh`: unit tests
  for the typed serializer (round-trip of all Firestore types), registry/exclusion guard tests
  (assert `events` and log collections are never exported), and an export→import round-trip test
  against the Firestore emulator (`FIRESTORE_EMULATOR_HOST`).

## Deployment Approach
- No deployment for Task 1. The `brat` tool ships via `Dockerfile.brat` / `cloudbuild.brat.yaml`;
  the future command runs as an operator CLI using firebase-admin + ADC (and the
  `FIRESTORE_EMULATOR_HOST` override for tests), consistent with `src/common/firebase.ts`.

## Dependencies
- `firebase-admin` (already in root `package.json`).
- `src/common/firebase.ts` connection semantics (ADC, `resolveDatabaseId()` multi-database,
  emulator host) as the reference for a brat Firestore provider.
- Firestore collection definitions across `src/**` (source of the registry).

## Definition of Done
- References the project-wide DoD in AGENTS.md §3. For Task 1 (docs-only), "Done" = the TA
  document is authored, internally consistent, accurate to the codebase, and traceable to REQ-001
  in `request-log.md`. Test/build gates apply to the future implementation tasks, not Task 1.

---

## Task Breakdown & Status

1. Sprint scaffolding (branch, manifest, request log, this plan). — DONE
2. **Task 1:** Technical Architecture document. — DONE
3. **Task 2 (Lead Implementor):** Execution Plan (`execution-plan.md`, Phases 0–6 / Gates G0–G6) +
   Trackable Prioritized YAML Backlog (`backlog.yaml`, BL-001 … BL-013). — DONE (pending approval to implement)
4. (Future, pending approval) Implement `brat backup export|import` + provider + registry + serializer
   (BL-001/003/005/006/007/008), incl. the deployment-target-aware emulator path (BL-011).
5. (Future) Tests: serializer round-trip, exclusion guard, emulator export/import round-trip
   (BL-002/004/009); wire `validate_deliverable.sh` (BL-012).
6. (Future) Wire CLI help/dispatch + operator runbook; close-out artifacts + PR (BL-013).

> The authoritative, trackable task breakdown lives in `execution-plan.md` and `backlog.yaml`.
