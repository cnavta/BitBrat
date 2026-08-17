# Deliverable Verification – sprint-326-b8f1a2 (Integrated Version Handling)

## Completed
- [x] **BL-326-100** — SemVer compute + authoritative version reader (`tools/brat/src/release/semver.ts`).
      patch/minor/major/explicit; fails closed on invalid input; pure (no FS side effects).
- [x] **BL-326-101** — Writers: comment-preserving `architecture.yaml` `project.version` (only that field,
      re-validated — Law #2) + formatting-preserving `package.json` (`tools/brat/src/release/version-files.ts`).
- [x] **BL-326-102** — Lockfile sync (`npm install --package-lock-only`, direct-patch fallback) + reusable
      3-file consistency assertion (`assertVersionsConsistent`).
- [x] **BL-326-200** — CHANGELOG transformer: idempotent `[Unreleased]` → dated block + fresh empty
      skeleton (`tools/brat/src/release/changelog.ts`).
- [x] **BL-326-300** — `brat release` CLI group (`tools/brat/src/cli/release.ts`) wired into the flat router
      + help text; orchestrator `runRelease` (`tools/brat/src/release/release.ts`); `--dry-run`/`--tag`/`--yes`.
- [x] **BL-326-301** — Root `package.json` scripts `release` + `release:dry` delegating to `brat release`.
- [x] **BL-326-400** — Jest unit + integration tests (32 tests across 4 specs): SemVer, writers
      (comment/format-preserving), CHANGELOG rollover+idempotency, end-to-end over copied real-file temp
      fixtures (real + dry-run no-op), `--tag` mocked (never pushes), fail-closed.
- [x] **BL-326-500** — `validate_deliverable.sh`: release tests + generalized 3-file version assertion (no
      hardcoded literal) + `release:dry` no-op proof (pre/post hash).
- [x] **BL-326-501** — Docs: README "Versioning & Releases", CONTRIBUTING note, AGENTS.md §2.8 Publish hook,
      CHANGELOG `[Unreleased]` Added entry.

## Verification evidence
- `npx jest tools/brat/src/release` → **4 suites / 32 tests passed**.
- `npm run build` (tsc) → green.
- `npm run release:dry -- patch` → reports `0.7.0 -> 0.7.1`, writes nothing (git working tree unchanged).
- `brat release --help` → renders usage.
- Full suite `npm test` → **1047 passed, 2 skipped**. One full-run failure observed in
  `tests/services/llm-bot/mcp/client-manager.spec.ts` (reconnect `setTimeout` timeout under parallel load);
  it **passes 9/9 in isolation** and touches none of the version-handling code — pre-existing flakiness, not
  a regression (the first full run passed clean).
- Version consistency assertion + `release:dry` no-op proof both verified live against the real repo files.

## Partial
- None.

## Deferred (tracked in backlog, out of scope this sprint)
- [ ] **BL-326-600** — Conventional-Commits / Changesets / standard-version auto-derivation pointed at
      `architecture.yaml` as authoritative.
- [ ] **BL-326-601** — CI-on-merge release + tag push (Cloud Build).

## Alignment Notes
- Single source of truth = `architecture.yaml project.version` (AGENTS.md §0 + runtime via base-server). The
  tool only ever changes `project.version` and re-parses the file (Law #2); no behavioral architecture edit.
- The live platform version was intentionally **not** bumped (tool is the deliverable; a real bump is an
  owner call at Publish) — matches the plan's out-of-scope note.
- CHANGELOG skeleton uses the full Keep-a-Changelog category set; `formatDate` is UTC for deterministic tests.
