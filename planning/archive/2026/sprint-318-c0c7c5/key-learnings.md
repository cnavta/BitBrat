# Key Learnings – sprint-318-c0c7c5

1. **Parametrize, don't fork.** Near-identical per-service Dockerfiles should be one
   `Dockerfile.service` driven by `--build-arg`s. Only `SERVICE_NAME`, `SERVICE_ENTRY`, and
   `SERVICE_PORT` ever varied across the standard family.

2. **Derive from the canonical config.** `SERVICE_ENTRY` is computed from `architecture.yaml`'s
   `entry:` (`src/<x>.ts` → `dist/<x>.js`) in `extract-config.js` — no new source of truth, honoring
   the precedence rule.

3. **Resolution order is the escape hatch.** `deploy-cloud.sh`/compose/Cloud Build use a present
   `Dockerfile.<service>` as an override, else fall back to `Dockerfile.service`. This kept genuine
   exceptions (`brat` from `tools/`, `obs-mcp` prebuilt `image:`) working with zero special-casing.

4. **Fail fast on missing inputs.** When the shared file is selected but `SERVICE_ENTRY` is empty,
   the tooling errors out (instead of building a container that boots then exits).

5. **Build context determines compiled paths.** `COPY src ./src` (not `COPY . .`) makes tsc emit
   `dist/apps/...`, which is what the derivation expects — this silently fixed the legacy
   `dist/src/...` discrepancy.

6. **Flip the defaults end-to-end.** The new-service generator (`bootstrap-service.js`) and its
   compose output now use the shared file, so brand-new services need no Dockerfile at all.

7. **Tooling-level dry-runs are high-value when docker is unavailable.** `deploy-cloud.sh --dry-run`
   + `extract-config.js` + `js-yaml` parsing + jest gave strong, real verification of the wiring
   even though image builds couldn't run locally.

8. **Migrations surface latent config drift.** This effort exposed a copy-pasted/missing `obs-mcp`
   `entry:` and a duplicate stream-analyst service with an implicit port — worth a periodic
   `architecture.yaml` lint.

9. **Bound best-effort I/O in hot paths.** Awaited best-effort Firestore reads with no timeout hang
   forever when the backing service is slow/unreachable (or unconfigured in tests), surfacing as
   Jest 5s timeouts. A small `withTimeout` helper converts an unbounded hang into the existing
   graceful-degradation path — fix flakes at the source, don't bump the test timeout.
