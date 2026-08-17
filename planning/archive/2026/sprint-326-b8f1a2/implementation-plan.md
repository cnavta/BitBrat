# Implementation Plan – sprint-326-b8f1a2

**Title:** Integrated Version Handling — single-source-of-truth release tooling
**Owner:** Lead Implementor
**Branch:** `feature/sprint-326-b8f1a2-integrated-version-handling`
**Source design:** attached scratch _"If we wanted to up the version of the platform…"_
**Status:** PLANNING — awaiting owner approval (AGENTS.md §2.4; coding forbidden until approved)

---

## Objective
Eliminate version drift by making **`architecture.yaml` `project.version` the single source of truth** and
adding **one idempotent, dry-run-able release tool** that bumps the version everywhere, rolls the CHANGELOG,
and is wired into the Sprint **Publish** phase so any shipping sprint can cut a version with one traceable
command.

## Problem statement (why)
The version is hand-maintained in **three files that must stay in lockstep**:
- `architecture.yaml` → `project.version: 0.7.0` — AGENTS.md §0 precedence source of truth **and** the runtime
  source (`src/common/base-server.ts:1120,1167` read `arch?.project?.version`; `fleet info` reports it).
- `package.json` → `"version": "0.7.0"` — npm/build identity.
- `package-lock.json` → `"version": "0.7.0"` — mirror of `package.json`.

Sprint-323 had to **manually reconcile** these (1.0.0 / 0.1.0 → 0.7.0). That manual reconciliation is the drift
risk this sprint automates. `CHANGELOG.md` is already Keep-a-Changelog + SemVer with a `## [Unreleased]` block.

## Scope
**In scope**
- A release tool exposing `brat release <patch|minor|major|x.y.z> [--dry-run] [--tag] [--yes]`.
  - Primary implementation as a new Brat CLI group (`tools/brat/src/cli/release.ts`), wired into the flat
    router `tools/brat/src/cli/index.ts` (matches the in-house `docker|backup|chat|bootstrap|setup|trigger|fleet`
    shape).
  - Core logic factored into a testable module (e.g. `tools/brat/src/release/`), so the CLI is a thin shell.
- `npm run release` / `npm run release:dry` scripts in root `package.json` delegating to the Brat command.
- Reusable version utilities: read current version from `architecture.yaml`; compute next SemVer from a bump
  keyword or explicit `x.y.z`; write to `architecture.yaml` (only `project.version`) and `package.json`; sync
  `package-lock.json` (`npm install --package-lock-only`); re-parse/validate `architecture.yaml`.
- CHANGELOG rollover: rename `## [Unreleased]` → `## [<version>] - <YYYY-MM-DD>` and insert a fresh empty
  `## [Unreleased]` (with the Keep-a-Changelog section skeleton) above it.
- Optional `--tag` → `git tag v<version>` (off by default; never auto-pushes).
- Unit + integration tests (Jest) for the release module and CLI wiring (using temp fixtures, no real git/npm
  mutation of the repo).
- `validate_deliverable.sh`: generalize the sprint-323 version-consistency assertion (architecture.yaml ==
  package.json == package-lock.json) and add a `release --dry-run` invocation that proves the bump is
  mechanically possible.
- Documentation: README/CONTRIBUTING note + CHANGELOG `[Unreleased]` entry; brief AGENTS.md §2.8 Publish-phase
  hook note (how to cut a version during Publish).

**Out of scope (this sprint)**
- Actually bumping the live platform version to `0.7.1` as a release act (the *tool* is the deliverable; a real
  bump can be performed at Publish or in a follow-up, owner's call).
- Conventional-Commits/changesets/`standard-version`/`release-please` auto-derivation and CI-on-merge tagging
  (scratch §5 "later"; captured as deferred backlog items).
- Any **behavioral** `architecture.yaml` change (Law #2) — the tool touches only `project.version`.
- Multi-package / monorepo workspace versioning.

## Deliverables
- **Code:** release module + `brat release` CLI group + router wiring; `package.json` `release`/`release:dry`
  scripts.
- **Tests:** Jest unit tests (SemVer compute, file writers, CHANGELOG rollover, dry-run no-op) + CLI/integration
  test over temp fixtures.
- **Validation/CI artifacts:** updated `validate_deliverable.sh` (version-consistency assertion + `release:dry`);
  no new Cloud Build target required (tooling-only), but `release:dry` is CI-safe.
- **Documentation:** README/CONTRIBUTING usage; CHANGELOG `[Unreleased]` Added entry; AGENTS.md §2.8 note.

## Acceptance Criteria (verifiable)
1. `npm run release:dry -- patch` from `0.7.0` reports the planned changes (→ `0.7.1`), **writes nothing**, exits 0.
2. `brat release patch` (non-dry) sets `architecture.yaml project.version`, `package.json version`, and
   `package-lock.json version` to the **same** computed SemVer; re-parsing `architecture.yaml` succeeds and only
   `project.version` differs (no behavioral diff).
3. `brat release 1.2.3` honors an explicit SemVer; `minor`/`major` bumps compute correctly under pre-1.0 rules
   (documented), and invalid inputs fail closed with a non-zero exit and a clear message.
4. CHANGELOG rollover renames `## [Unreleased]` → `## [<version>] - <date>` and inserts a fresh empty
   `## [Unreleased]`; running twice is idempotent (no duplicate Unreleased / no double-roll).
5. Runtime parity: after a bump, `arch?.project?.version` (and therefore `bit.info` / `fleet info`) reflects the
   new version with **no code change** to base-server (verified by reading the value the tool wrote).
6. `validate_deliverable.sh` asserts the three files agree and runs `release:dry` successfully; `npm run build`
   and `npm test` pass with the new tests included.

## Testing Strategy
- **Unit:** SemVer next-version compute (patch/minor/major/explicit/invalid); architecture.yaml version
  reader/writer (preserves comments/formatting, changes only `project.version`); package.json writer; CHANGELOG
  transformer (rollover + idempotency + empty-Unreleased skeleton).
- **Integration:** copy `architecture.yaml`/`package.json`/`CHANGELOG.md` into a temp dir, run the release module
  end-to-end in both `--dry-run` (assert no writes) and real mode (assert all three updated + CHANGELOG rolled);
  assert re-parse validity. Mock/stub `git tag` and `npm install`.
- **Framework:** Jest (per AGENTS.md §5), tests co-located under the brat tool's test layout.
- Set no randomness; deterministic fixtures.

## Deployment Approach
Tooling-only — no new runtime service. `release:dry` is wired into `validate_deliverable.sh` (CI-safe, no
mutation). No Cloud Build/Cloud Run change required; references `architecture.yaml` per §4 only as the version
source. (Future CI-on-merge tagging is deferred — see backlog BL-326-50x.)

## Dependencies
- Node + existing build (`tsc`) and Jest already present.
- A YAML library is already used in-repo (sprint-323 validation used `js-yaml`); reuse it for read; **prefer a
  comment-preserving write** of only `project.version` (line-targeted replace) to honor Law #2 / minimal diff.
- `git` available for optional `--tag`; `npm` for lockfile sync. No external credentials needed for the tool.

## Definition of Done
References the project-wide DoD (AGENTS.md §3): code adheres to architecture.yaml constraints with no
TODO/placeholder in production paths; tests for all new behavior pass (`npm test`); validation pipeline
(`validate_deliverable.sh`) green/logically-passable; docs + rationale present; every change traces to a
backlog item + a `request-log.md` REQ id; and a PR is attempted at Publish (Rules S12/S13).

## Phases & Exit Gates
- **Phase A — Version core (GA):** SemVer compute + architecture.yaml/package.json read/write + lockfile sync +
  re-validate. (BL-326-100..102)
- **Phase B — CHANGELOG rollover (GB):** `[Unreleased]` → dated block + fresh skeleton, idempotent. (BL-326-200)
- **Phase C — CLI + scripts (GC):** `brat release` group + router wiring + `npm run release[:dry]` + `--dry-run`/
  `--tag`/`--yes`. (BL-326-300..301)
- **Phase D — Tests (GD):** unit + integration coverage of A–C. (BL-326-400)
- **Phase V — Validation, docs, protocol hook (GV):** validate_deliverable.sh assertion + dry-run, README/
  CONTRIBUTING/AGENTS.md §2.8 note, CHANGELOG entry, close-out. (BL-326-500..501)
- **Deferred:** Conventional-Commits/changesets auto-derivation + CI-on-merge tagging. (BL-326-600/601)
