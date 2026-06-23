# Request Log – sprint-319-740b5b

Sprint: Firestore Config Backup & Restore (brat backup export/import)
Role: Architect

---

## REQ-001 — Sprint kickoff & Technical Architecture document
- **Timestamp:** 2026-06-22T19:39:00Z
- **Prompt summary:** Start a new sprint (Architect role). Add a new `brat` command that exports
  and imports JSON-based backups of key Firestore collections. The `events` collection and other
  log-based collections must NOT be included. Goal: take the core configuration data of the
  platform and transfer it to a blank instance. First task: create a Technical Architecture
  document describing how we should approach this.
- **Interpretation:** Initialize the sprint per AGENTS.md Sprint Protocol (Rule S1 — user is
  starting a new sprint), then (Task 1 only) author a Technical Architecture document that defines
  the design of a `brat backup export|import` command. Do NOT implement the command yet —
  implementation will be a follow-up task appended to the plan per section 2.4.1.
- **Shell/git commands executed:**
  - Verified no active (non-`complete`) sprint manifest exists (Rule S3): sprint-318 and sprint-317
    are both `status: complete`.
  - Surveyed Firestore usage across `src/**` (`collection(...)` calls) to classify config vs.
    log/event collections; inspected `src/services/persistence/model.ts` (`events`, `sources`,
    `snapshots` constants), `scheduler-service.ts` (`schedules`), `state-engine.ts`
    (`state`, `mutation_log`), `event-router-service.ts` (`configs/routingRules/rules`),
    `auth-service.ts` (`gateways/api/tokens`), `tool-gateway.ts` (`mcp_servers`),
    `common/mcp/observability.ts` (`tool_usage`), and `llm-bot`/`query-analyzer` (`prompt_logs`).
  - Inspected the brat CLI (`tools/brat/src/cli/index.ts` `main()`, `printHelp()`) and confirmed
    there is no Firestore provider yet; confirmed brat compiles against root `package.json`
    (firebase-admin present) and that `src/common/firebase.ts` `getFirestore()` is the canonical
    connection pattern.
  - Reviewed `documentation/technical-architecture/` doc conventions and the sprint-318 artifact
    set as a structural template.
  - `git checkout main` then `git checkout -b feature/sprint-319-740b5b-firestore-config-backup`
    (Rule S11).
  - Created `planning/sprint-319-740b5b/`.
- **Files created/modified:**
  - `planning/sprint-319-740b5b/sprint-manifest.yaml`
  - `planning/sprint-319-740b5b/request-log.md` (this file)
  - `planning/sprint-319-740b5b/implementation-plan.md`
  - `documentation/technical-architecture/brat-firestore-config-backup.md` (Technical Architecture
    document — Task 1 deliverable)
- **Notes / findings:**
  - Two collection families identified: **config/core** (backup) vs **log/event** (exclude). The
    design uses an explicit **allowlist registry** (not a denylist) so newly added log collections
    are excluded by default — fail-safe.
  - Firestore-native types (Timestamp, GeoPoint, DocumentReference, Bytes) and nested subcollections
    (e.g. `configs/*`, `users/*/roles`) require a typed JSON envelope + recursive traversal to
    round-trip correctly; document IDs must be preserved on import (some collections use auto-IDs).
  - Sensitive data (`gateways/api/tokens`) must be handled explicitly (excluded by default /
    opt-in via `--include-secrets`).

---

## REQ-002 — Execution Plan & Trackable Prioritized YAML Backlog (Lead Implementor)
- **Timestamp:** 2026-06-22T21:22:00Z
- **Prompt summary:** Assume the role of Lead Implementor. Based on the approved-in-principle TA
  document, create an Execution Plan and a Trackable Prioritized YAML Backlog breaking the project
  down into accomplishable tasks.
- **Interpretation:** Decompose `brat-firestore-config-backup.md` into a phased, gated execution
  plan plus a companion `backlog.yaml` (schema per `planning/backlog-example.yaml` and the
  sprint-318 precedent). Fold in the planning-gate Q&A outcome — the deployment-target-aware
  emulator import path (TA §7.1/§7.2 refinement) — as a dedicated phase/backlog item. Still a
  planning deliverable: NO command implementation begins until the user approves (AGENTS.md §2.4).
- **Shell/git commands executed:**
  - Reviewed `planning/sprint-318-c0c7c5/execution-plan.md` + `backlog.yaml` and
    `planning/backlog-example.yaml` for the house format (meta/sprint/items, P0–P2, S/M/L, deps,
    acceptance, log).
  - Inspected `tools/brat/src/cli/docker.ts`, `tools/brat/src/orchestration/docker/*`,
    `infrastructure/docker-compose/docker-compose.local.yaml`, and `env/{local,staging}/infra.yaml`
    to ground the Phase 5 emulator/`--target` design (`firebase-emulator:8080` published; project
    `bitbrat-local`).
  - Lint-checked `backlog.yaml` (no errors/warnings); `node`/`pyyaml` unavailable in this env.
- **Files created/modified:**
  - `planning/sprint-319-740b5b/execution-plan.md` (Phases 0–6, gates G0–G6).
  - `planning/sprint-319-740b5b/backlog.yaml` (BL-001 … BL-013, prioritized, dependency-ordered).
  - `planning/sprint-319-740b5b/implementation-plan.md` (task breakdown refreshed to reference both).
- **Notes / findings:**
  - The TA doc as written targets real GCP via ADC + a local emulator only; importing into the
    `local`/`staging` docker stacks needs a `--target` resolution path that reads
    `deploymentTargets` from `architecture.yaml` and sets `FIRESTORE_EMULATOR_HOST` (SSH tunnel for
    remote `staging`). Captured as Phase 5 / **BL-011**.
  - Critical path: registry+guard (BL-001/002) → serializer (BL-003/004) → provider (BL-005) →
    list+export (BL-006/007) → import (BL-008) → round-trip test (BL-009); safety/secrets (BL-010),
    target-aware (BL-011), validation (BL-012) and close-out (BL-013) follow.

---

## REQ-003 — Implementation: `brat backup` command (Lead Implementor)
- **Timestamp:** 2026-06-22T22:10:00Z
- **Prompt summary:** Documentation approved; begin implementation, keeping backlog item statuses
  up to date.
- **Interpretation:** Approval gate cleared (AGENTS.md §2.4). Implement the `brat backup`
  list/export/import command per the TA doc + execution-plan.md / backlog.yaml (BL-001 … BL-013),
  marking backlog items in_progress/done as gates G0–G6 are met. Sprint manifest moved to
  `in-progress`.
- **Shell/git commands executed (running log):**
  - Located Node runtime at `/opt/homebrew/bin` (added to PATH) — `node`/`npx` were not on the
    default non-login PATH.
  - Ran `jest` on the Phase 0 exclusion-guard test — Gate G0 PASS (11/11).
- **Files created/modified (running log):**
  - `tools/brat/src/backup/registry.ts` (BL-001).
  - `tools/brat/src/backup/__tests__/registry.guard.test.ts` (BL-002, Gate G0).
- **Notes / findings:**
  - Implementation grounded in the conventions confirmed during discovery: dispatch via
    `c1`/`c2` string matching in `cli/index.ts` `main()`, flags via `parseArgs`/`parseKeyValueFlags`,
    logging via `orchestration/logger`, errors via `BratError`/`exitCodeForError`, and the
    `src/common/firebase.ts` Firestore connection pattern.
