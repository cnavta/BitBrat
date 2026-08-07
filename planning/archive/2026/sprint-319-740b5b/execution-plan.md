# Execution Plan – `brat backup`: Firestore Config Export / Import

- **Sprint:** sprint-319-740b5b
- **Role:** Lead Implementor
- **Date:** 2026-06-22
- **Source of truth:** `documentation/technical-architecture/brat-firestore-config-backup.md` (Status: Proposed)
- **Status:** Awaiting user approval — **no implementation begins until approved.**

## 1. Purpose

Decompose the Technical Architecture (TA) for the new `brat backup` command into a sequenced,
gated set of accomplishable tasks, with a companion Trackable Prioritized YAML Backlog
(`backlog.yaml`). The command exports/imports JSON backups of the platform's **core configuration**
Firestore collections, **excluding `events` and all other log-based collections**, so the
configuration of one instance can be transferred to a blank instance.

This plan operationalizes TA §4 (registry), §5 (file format / typed serializer), §6 (CLI surface),
§7 (connection, safety, secrets, observability), and §8 (tests) — **plus** the
deployment-target-aware connection mode discussed during the planning gate (importing into the
`local`/`staging` docker stacks, which run the Firestore **emulator** rather than real GCP). That
extension refines TA §7.1/§7.2 and is folded into this plan as Phase 5.

## 2. Guiding Constraints

- **Config-only, fail-safe (TA §3/§4):** the backup set is an **explicit allowlist registry**;
  `FORBIDDEN_PREFIXES` (`events`, `mutation_log`, `state`, `summarization_runs`, `tool_usage`,
  `prompt_logs`) is asserted in code on **both** export and import so logs can never round-trip.
- **No new dependencies:** `brat` compiles against the root `package.json`, which already provides
  `firebase-admin ^13.6.0`. The Firestore provider mirrors `src/common/firebase.ts`.
- **Safe by default (TA §6.2/§7.2):** `import` is **dry-run by default**; a real write requires
  `--confirm`. The resolved (project, database) / emulator endpoint is always echoed and logged
  before any operation (AGENTS.md §8).
- **Lossless round-trip (TA §5.2):** a typed-wrapper JSON encoding preserves Firestore-native types
  (Timestamp, GeoPoint, DocumentReference, Bytes) and nested subcollections; document IDs are
  preserved.
- **Additive to the CLI:** dispatch is a new `c1 === 'backup'` branch in `cli/index.ts` `main()`
  plus a help block in `printHelp()`; no existing command changes behavior.
- **`architecture.yaml` is canonical** (AGENTS.md precedence): deployment-target resolution reads
  `deploymentTargets` from `architecture.yaml`; nothing is hardcoded.
- **WIP limit = 3** in-progress items at a time (mirrors `deploymentDefaults.maxConcurrentDeployments`).

## 3. Phases & Gates

### Phase 0 — Foundation: registry + exclusion guard
- Add `tools/brat/src/backup/registry.ts` with `BackupCollectionSpec`, `CONFIG_BACKUP_REGISTRY`,
  and `FORBIDDEN_PREFIXES` (TA §4).
- Implement a startup assertion that fails fast if any registry path matches a forbidden prefix.
- Unit-test the exclusion guard (**highest priority test**, TA §8): `events`/log collections are
  never representable; a forbidden registry entry throws.
- **Gate G0:** registry + guard exist and the exclusion guard test passes.

### Phase 1 — Typed serializer
- Add `tools/brat/src/backup/serializer.ts`: `encodeValue`/`decodeValue` for the typed-wrapper
  convention (TA §5.2), `__type` reservation + `__escaped` handling, `undefined` stripping
  (consistent with `stripUndefinedDeep`).
- Unit-test round-trip for every type (Timestamp, GeoPoint, DocumentReference, Bytes, nested
  maps/arrays, escaping, `undefined`).
- **Gate G1:** serializer round-trip unit tests pass.

### Phase 2 — Firestore provider
- Add `tools/brat/src/providers/gcp/firestore.ts` mirroring `src/common/firebase.ts`: firebase-admin
  + ADC, project id from `--project-id`/`PROJECT_ID`/`GCLOUD_PROJECT`, multi-database via
  `resolveDatabaseId()`, and `FIRESTORE_EMULATOR_HOST` support.
- Always resolve + log the target (project, database, or emulator host) before any access.
- **Gate G2:** provider connects against the Firestore emulator (`FIRESTORE_EMULATOR_HOST`) in a test.

### Phase 3 — `brat backup list` + `export`
- Add dispatch (`c1 === 'backup'`, `c2 ∈ {list, export, import}`) in `cli/index.ts` + `printHelp()`.
- `list`: print the registry + rationale (no DB access).
- `export`: walk the registry, apply `stripFields`, exclude `sensitive` unless `--include-secrets`,
  recurse subcollections (preserving IDs), encode typed values, write the versioned envelope to
  `--out` (default path) or stdout via `--json` (TA §5.1/§6.1).
- Tests: `list` output; `export` against a seeded emulator produces a valid envelope with log
  collections absent.
- **Gate G3:** `brat backup export` produces a schema-valid envelope; exclusion holds end-to-end.

### Phase 4 — `brat backup import`
- Validate envelope (`format`, `schemaVersion`); reject incompatible versions, warn on
  `registryVersion` mismatch; re-apply `FORBIDDEN_PREFIXES` guard on input (TA §6.2).
- Implement modes `merge` (default) / `overwrite` / `skip`; **dry-run default**, `--confirm` to
  write; `BulkWriter`/batched commits (≤500 ops), parents before subcollections; dry-run prints a
  per-collection create/update/skip diff + op count.
- **Gate G4:** emulator export → wipe → import round-trip restores config collections (with IDs +
  subcollections) while log collections stay empty (TA §8).

### Phase 5 — Deployment-target-aware connection (local/remote docker emulator)
- Read `deploymentTargets` from `architecture.yaml`; add `--target <name>` resolution so
  `type: docker-engine` targets derive the published **emulator** endpoint instead of using ADC:
  - `local` → `localhost:8080`;
  - remote (`ssh://root@bitbrat.lan`) → open an **SSH tunnel** to the published `8080` (preferred)
    or fall back to `bitbrat.lan:8080`.
- Set `FIRESTORE_EMULATOR_HOST` + project `bitbrat-local` for emulator targets; relax the GCP
  `--project-id` match check for emulator targets and echo the resolved `host:port`.
- `--env <gcp>` / `--project-id` continues to mean a real GCP database (TA §7.1).
- Test `--target local` import/export against the running emulator stack.
- **Gate G5:** `brat backup import --in cfg.json --target local --confirm` seeds the local docker
  emulator; `--target staging` resolves the remote endpoint (tunnel) and echoes it.

### Phase 6 — Validation harness + docs + close-out
- Extend `validate_deliverable.sh`: `npm run build`, `npm test` (serializer + guard + emulator
  round-trip via the Firestore emulator), and a `brat backup list` smoke check; gracefully skip the
  emulator round-trip when no runtime is available (logically passable, AGENTS.md §2.6).
- Update `brat` help + add an operator runbook (secrets handling, `--target` usage, emulator
  durability caveat — emulator data lives in the `firebase-data-v2` volume and is wiped by `down -v`).
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; open PR (`publication.yaml`).
- **Gate G6:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 4. Sequencing & Dependencies (summary)

```
Phase0(G0 registry+guard) → Phase1(G1 serializer) → Phase2(G2 provider)
   → Phase3(G3 list+export) → Phase4(G4 import round-trip)
   → Phase5(G5 target-aware emulator) → Phase6(G6 validate+docs+close)
```

The detailed, trackable breakdown (IDs, priorities, effort, deps, acceptance criteria) lives in
`backlog.yaml` (BL-001 … BL-013).

## 5. Definition of Done (this artifact)
- [x] Architecture doc decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Remote/local docker emulator import path (TA §7.1/§7.2 refinement) folded in as Phase 5.
- [x] Constraints, sequencing, and gates explicit and reversible.
- [ ] **User approval to begin implementation (pending).**
