# Retrospective – sprint-318-c0c7c5

## What we set out to do
Collapse 18 near-identical root `Dockerfile.<service>` files into one reusable, parametrized
`Dockerfile.service`, driven entirely by existing `architecture.yaml` configuration, while
preserving build/deploy behavior.

## What went well
- **Config-driven, zero new source of truth.** `SERVICE_ENTRY` is derived from the existing
  `entry:` field, so `architecture.yaml` stays canonical. The build tooling was already
  parameter-driven (`_DOCKERFILE`/`_SERVICE_NAME`/`_PORT`), so wiring `_SERVICE_ENTRY` was low-risk.
- **Behavior-preserving.** Every derived `SERVICE_ENTRY`/port matched the prior, production-proven
  per-service `CMD`/`EXPOSE` exactly (verified with `extract-config.js` and a real `deploy-cloud.sh`
  dry-run across all services).
- **Clean escape hatch.** `brat` (builds from `tools/`) and `obs-mcp` (prebuilt `image:`) are
  retained as documented exceptions; the resolution order (per-service Dockerfile wins, else shared)
  made this automatic.
- **Net simplification.** 18 Dockerfiles → 1 shared + 2 escape hatches; new services need no
  Dockerfile (bootstrap generator + compose flipped to the shared file).

## What was tricky
- **Latent config bugs surfaced.** `obs-mcp` had no `entry:` (and a prebuilt `image:`); the
  duplicate `stream-analyst` / `stream-analyst-service` pair (only the latter in `architecture.yaml`)
  used the legacy `dist/src/...` path and an implicit 3010 port. Resolved by treating the
  architecture.yaml service as canonical and making the 3010 port explicit.
- **`dist/src/...` vs `dist/apps/...`.** The legacy family used `COPY . .` (whole context),
  changing the tsc `rootDir` and the output path. The shared file `COPY src ./src` only, so output
  normalizes to `dist/apps/...`, matching the derived `SERVICE_ENTRY`.
- **Wide blast radius.** Deleting per-service Dockerfiles required repointing 15 compose files,
  2 per-service Cloud Build configs, the generic Cloud Build default, and the bootstrap generator.

## Post-implementation: test timeout remediation
- After the migration, two `llm-bot` processor specs began failing on Jest's 5s timeout. The cause
  was unrelated to the Dockerfile work: awaited best-effort Firestore reads in the request hot path
  hang indefinitely without an emulator/credentials. Fixed at the source by bounding those reads
  with a new `withTimeout` helper (`src/common/async-timeout.ts`, env-overridable
  `FIRESTORE_LOOKUP_TIMEOUT_MS`) so a slow/unreachable Firestore degrades gracefully instead of
  hanging — a genuine production robustness improvement, not a weakened assertion. Specs were also
  made hermetic. Full suite is now green (254 suites / 834 tests, 0 failures).

## Environment limitation
- No docker runtime here, so actual image build/boot/health-check was validated **logically** plus a
  real config-level dry-run; the docker steps in `validate_deliverable.sh` are present and intended
  to pass wherever docker is available.

## If we did it again
- Audit `architecture.yaml` for missing/copy-pasted `entry:` and implicit ports **before** rollout
  (would have surfaced obs-mcp/stream-analyst sooner).
- Consider a tiny CI check that asserts each active, source-built service has a derivable
  `SERVICE_ENTRY`.
