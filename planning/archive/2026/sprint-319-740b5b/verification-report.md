# Deliverable Verification – sprint-319-740b5b

`brat backup` — Firestore config export / import.

## Completed
- [x] **BL-001** Collection registry + `FORBIDDEN_PREFIXES` exclusion guard (`tools/brat/src/backup/registry.ts`).
- [x] **BL-002** Exclusion guard unit tests — **Gate G0** (`registry.guard.test.ts`, 11 tests).
- [x] **BL-003** Typed value serializer (`serializer.ts`) — Timestamp/Date/GeoPoint/DocumentReference/Bytes, `__type`/`__escaped`, undefined stripping.
- [x] **BL-004** Serializer round-trip tests — **Gate G1** (`serializer.test.ts`, 11 tests, incl. JSON.stringify/parse path).
- [x] **BL-005** brat Firestore provider (`providers/gcp/firestore.ts`) — ADC, project resolution, multi-db, `FIRESTORE_EMULATOR_HOST`, target echo — **Gate G2** (live emulator connect test).
- [x] **BL-006** CLI dispatch + help (`cli/backup.ts` + `cli/index.ts`); `brat backup list` verified.
- [x] **BL-007** `brat backup export` (read-only envelope writer; stripFields/sensitive/recursion) — **Gate G3**.
- [x] **BL-008** `brat backup import` (dry-run default, merge/overwrite/skip, BulkWriter, parents-before-subcollections, input forbidden re-guard).
- [x] **BL-009** Emulator export→wipe→import round-trip test — **Gate G4** (config restored w/ IDs+subcollections; logs stay empty).
- [x] **BL-010** Safety rails, secrets handling & observability (target echo, explicit `--project-id` for real GCP writes, sensitive opt-in, logging, BratError exit codes).
- [x] **BL-011** Deployment-target-aware connection (`connection.ts`): `--target local/staging` → emulator endpoint, SSH tunnel for remote — **Gate G5** (endpoint resolution unit tests).
- [x] **BL-012** `validate_deliverable.sh` extended (build + backup tests + `brat backup list` smoke).
- [x] **BL-013** Operator runbook (`documentation/runbooks/brat-backup.md`), brat help updated, TA cross-linked; close-out artifacts + PR.

## Verification evidence
- `npm run build` (tsc) — clean.
- Backup/provider tests: **40 passed** (`tools/brat/src/backup` + `providers/gcp/__tests__/firestore.test.ts`) against a live Firestore emulator (v1.19.8, port 8088).
- Regression check: brat `cli` + `config` suites — **54 passed / 12 suites**.
- CLI smoke: `brat backup list`, `brat backup export` (valid envelope, sensitive skipped, target echoed), `brat backup import` (dry-run default) — all OK end-to-end against the emulator.

## Partial
- None.

## Deferred / Not exercised live
- The **remote `--target staging` SSH-tunnel** branch could not be exercised end-to-end (no remote
  docker host in this environment). It is covered by unit tests for endpoint resolution and includes
  a direct `host:port` fallback; the tunnel mechanics (`openSshTunnel`) are implemented but only
  validated structurally.
- `brat backup --target local` live seeding was validated via an emulator on port **8088** (the
  default host port **8080** was occupied by an unrelated nginx in this environment); the resolver
  correctly derives `localhost:8080` for the `local` target.

## Alignment notes
- Added `--target`/`--emulator-host`/`--database` flags and a `testing/emulator-utils.ts` test
  helper (kept out of `__tests__` so jest doesn't treat it as a suite) beyond the original TA text;
  consistent with the planning-gate Q&A (TA §7.1/§7.2 refinement).
- `firebase-tools` was used **transiently** to run the emulator for verification and was **not**
  added to `package.json` (honors the "no new dependencies" constraint); emulator-dependent tests
  gracefully skip when no runtime is reachable (AGENTS.md §2.6).
