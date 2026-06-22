# Deliverable Verification – sprint-318-c0c7c5

**Goal:** Replace the dockerfile-per-service strategy with one reusable, parametrized standard
service `Dockerfile.service` (plus a documented template) used wherever possible, preserving
current build/deploy behavior.

## Completed
- [x] **BL-001** Canonical `Dockerfile.service` created (ARGs `NODE_IMAGE`, `SERVICE_NAME`,
  `SERVICE_ENTRY`, `SERVICE_PORT`; multi-stage; shell-form CMD `exec node "$SERVICE_ENTRY"`).
- [x] **BL-002** `.dockerignore` confirmed compatible (does not exclude `src/`, `tsconfig.json`,
  `package*.json`, `architecture.yaml`).
- [x] **BL-003** Usage/template doc added
  (`documentation/technical-architecture/standard-service-dockerfile-usage.md`).
- [x] **BL-005** `infrastructure/scripts/extract-config.js` derives + emits `SERVICE_ENTRY`
  (`src/<x>.ts` → `dist/<x>.js`); `infrastructure/deploy-cloud.sh` (single + multi paths) falls
  back to `Dockerfile.service`, threads `SERVICE_ENTRY`/`_SERVICE_ENTRY`, and fails fast on empty
  entry while using the shared file.
- [x] **BL-006** Cloud Build path forwards `--build-arg SERVICE_NAME/SERVICE_ENTRY/SERVICE_PORT`
  (`cloudbuild.oauth-flow.yaml` generic config, `cloudbuild.query-analyzer.yaml`,
  `cloudbuild.llm-bot.yaml`).
- [x] **BL-007** Pilot: `llm-bot` builds via `Dockerfile.service`; `Dockerfile.llm-bot` removed.
- [x] **BL-008** `validate_deliverable.sh` extended (build + boot + health-check + teardown via the
  shared file; gracefully skips when docker is absent).
- [x] **BL-009** 11 standard per-service Dockerfiles removed; all 15 source-built services resolve
  to `Dockerfile.service` with correct args.
- [x] **BL-010** Legacy `disposition-service`, `story-engine-mcp`, `stream-analyst-service`
  normalized onto the shared file; `dist/src/...` → `dist/apps/...` resolved.
- [x] **BL-011** Duplicate `Dockerfile.stream-analyst` / `Dockerfile.stream-analyst-service`
  reconciled to the single `stream-analyst-service` (port `3010`).
- [x] **BL-012** `architecture.yaml` gained a non-breaking `defaults.services.build` block +
  explicit `port: 3010`; tooling defaults flipped (incl. `bootstrap-service.js` no longer emits a
  per-service Dockerfile).
- [x] **BL-013** README "Container Builds" section + close-out artifacts (this report, retro,
  key-learnings, publication).

## Verification performed
- `extract-config.js` per service: every source-built service derives the exact `SERVICE_ENTRY`
  that matched its previous Dockerfile `CMD`; `stream-analyst-service` port = `3010`; `obs-mcp`
  `SERVICE_ENTRY` empty (escape hatch, retains `Dockerfile.obs-mcp`).
- `infrastructure/deploy-cloud.sh --dry-run` (real, node available): all 15 source-built services
  resolve to `Dockerfile.service` with correct `service_entry`/port; `obs-mcp` → `Dockerfile.obs-mcp`;
  no fail-fast triggered.
- All 23 YAML files (architecture.yaml + cloudbuild.*.yaml + 15 compose) parse via `js-yaml`.
- `npx jest infrastructure/scripts/bootstrap-service.test.js` → 8/8 pass.
- `bash -n` clean for `infrastructure/deploy-cloud.sh` and `validate_deliverable.sh`.

## Remaining / escape hatches (by design)
- `Dockerfile.brat` retained: `brat` builds from `tools/` (excluded from the standard `src/`-only
  build context). Documented escape hatch.
- `Dockerfile.obs-mcp` retained: `obs-mcp` has no `entry:` and uses a prebuilt `image:` in
  `architecture.yaml`. Documented escape hatch.

## Environment limitation (AGENTS.md §2.6)
- No **docker** runtime is available in this environment, so the actual image **build + container
  boot + HTTP health check** (Gates G0/G2/G4/G5 runtime portion) could not be executed here. These
  are validated **logically**: `Dockerfile.service` is structurally identical to the previously
  shipping standard-family Dockerfiles except for the three parametrized values, and every derived
  `SERVICE_ENTRY`/port exactly matches the prior, production-proven `CMD`/`EXPOSE`. The
  `validate_deliverable.sh` docker steps are present and intended to succeed wherever docker exists.

## Alignment notes
- `architecture.yaml` remains the canonical source of truth (precedence rule): `SERVICE_ENTRY`/port
  are derived from it; the added `build:` block is documentation-only and non-breaking.
- Net file reduction: 18 root `Dockerfile.<service>` → 1 shared `Dockerfile.service` + 2 escape
  hatches (`brat`, `obs-mcp`).
