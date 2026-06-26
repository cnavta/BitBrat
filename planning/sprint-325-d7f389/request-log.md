# Request Log – sprint-325-d7f389 (BL-204 — Brat as a Fleet MCP Client)

Per AGENTS.md §2.5: every meaningful user prompt + shell/git operation relevant to the sprint is logged here.

---

## REQ-001 — Sprint start + planning artifacts

- **at:** 2026-06-26T17:22:00-04:00
- **prompt (summary):** "We are starting a new sprint. Assume the role of Lead Implementor. Implement the brat fleet capabilities outlined in the attached TA document. First task: analyze it and create an Execution Plan and a Trackable Prioritized YAML Backlog breaking the sprint down into accomplishable tasks."
- **interpretation:** Open sprint-325 against the BL-204 Technical Architecture
  (`documentation/architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md`). Produce the
  Planning-Phase deliverables only — `implementation-plan.md` (Execution Plan) and `backlog.yaml`
  (Trackable Prioritized YAML Backlog). No implementation code yet (AGENTS.md §2.4: coding forbidden
  until the plan is approved). The backlog example to mirror was supplied
  (`planning/backlog-example.yaml`); the richer house style is `planning/bit-model/backlog.yaml`.
- **shell / git commands executed:**
  - Reviewed planning conventions (existing sprint dirs + manifests) — confirmed no active sprint
    (Rule S3): every `planning/*/sprint-manifest.yaml` is `status: complete`. Next sprint number = 325.
  - Verified TA-referenced source paths exist: `tools/brat/src/cli/index.ts`,
    `tools/brat/src/cli/chat.ts`, `tools/brat/src/orchestration/queue.ts`,
    `src/common/mcp/{bridge,client-manager,rbac,registry-watcher}.ts`, `src/apps/tool-gateway.ts`,
    `tests/apps/` (gateway coverage lives here).
  - `git checkout -b feature/sprint-325-d7f389-brat-fleet-mcp-client` (Rule S11 — new feature branch at
    sprint start; prior branch `feature/sprint-324-00782d-bit-model-universal-mcp`, clean tree).
  - `mkdir -p planning/sprint-325-d7f389` (sprint directory, §2.3).
- **files modified / created:**
  - `planning/sprint-325-d7f389/sprint-manifest.yaml` (status `planning`).
  - `planning/sprint-325-d7f389/request-log.md` (this file).
  - `planning/sprint-325-d7f389/implementation-plan.md` (Execution Plan).
  - `planning/sprint-325-d7f389/backlog.yaml` (Trackable Prioritized YAML Backlog, BL2-001 … BL2-700).
- **gate / next action:** Planning approval gate (§2.4). Awaiting an explicit owner approval / "Start sprint."
  before any implementation begins.

---

## REQ-002 — Planning approved; Start sprint

- **at:** 2026-06-26T17:31:00-04:00
- **prompt (summary):** "Planning approved. Start sprint. Be sure to keep backlog items statuses up to date as they change."
- **interpretation:** Owner approval of `implementation-plan.md` satisfied (AGENTS.md §2.4 / Rule S1).
  Begin implementation on the existing feature branch. Keep `backlog.yaml` item statuses
  (todo→in_progress→done) current as work progresses, honoring the WIP limit of 3.
- **plan of execution (gateway-first):**
  - Phase A — additive Bit-qualified addressing in `tool-gateway` (BL2-100/101).
  - Phase B — `tools/brat/src/fleet/` client module (BL2-200..203).
  - Phase C — `brat fleet` command surface (BL2-300..304).
  - Phase V — full Jest matrix + bus-driver parity + docs/CHANGELOG + validate + close-out (BL2-400..500).
- **shell / git commands executed:**
  - Grounded the change set by reading `src/apps/tool-gateway.ts`, `src/common/mcp/{bridge,client-manager,rbac,types}.ts`,
    `src/services/llm-bot/tools/registry.ts`, `src/types/tools.ts`, `tools/brat/src/cli/{index,chat}.ts`,
    `tools/brat/src/orchestration/queue.ts`, `tests/apps/tool-gateway-rest.spec.ts`, `jest.config.js`,
    `validate_deliverable.sh`, `package.json`.
  - Confirmed toolchain: node v24 / npm 11 at `/opt/homebrew/bin` (matches `validate_deliverable.sh` PATH fix).
- **files modified / created (this request, ongoing):**
  - `planning/sprint-325-d7f389/sprint-manifest.yaml` (status `planning` → `in-progress`).
  - `planning/sprint-325-d7f389/backlog.yaml` (sprint.start set; item statuses updated as work proceeds).
- **gate / next action:** Implement BL2-100 (Bit-qualified ids in `McpBridge.translateTool`).

---

## REQ-003 — Bugfix: `brat fleet list --target local` cannot reach the local stack

- **at:** 2026-06-26T18:10:00-04:00
- **prompt (summary):** "When trying to list the bits running in a local docker env, we get an
  error. `npm run brat -- fleet list --target local` → gateway SSE/REST ECONNREFUSED on :3000, then
  registry read against project `twitch-452523` fails `5 NOT_FOUND`; empty list."
- **interpretation:** Defect in the shipped BL-204 surface: `brat fleet` ignored `--target`
  entirely. `runFleet` hardcoded the gateway URL (`http://localhost:3000`) and built the
  `FirestoreRegistryReader` with empty connect options, so discovery read the `mcp_servers` registry
  from real GCP (ADC / `PROJECT_ID=twitch-452523`) instead of the local Docker stack's Firestore
  emulator. The local compose stack runs only NATS + the emulator (no tool-gateway), so the SSE/REST
  attempts are expected to fail and discovery must fall back to the registry — which was pointed at
  the wrong place.
- **root cause:** `brat fleet` never threaded the deployment target into connection resolution
  (unlike `brat backup`, which already maps `--target` → emulator via `resolveBackupConnection` /
  `resolveTargetEndpoint`).
- **fix:**
  - `tools/brat/src/cli/fleet.ts`: parse `--target` (+ `--project-id` / `--emulator-host` /
    `--database` overrides); when `--target` is set, resolve the Firestore connection via the shared
    `resolveBackupConnection` and build `FirestoreRegistryReader(connectOptions)` from it; derive the
    gateway base URL from the resolved emulator host; tear down any remote SSH tunnel in `finally`.
    Added a `connectionResolverFn` seam and changed `registryFactory` to accept `connect` first.
  - Help text + `CHANGELOG.md` (`### Fixed`) updated.
- **tests:** `tools/brat/src/cli/__tests__/fleet.spec.ts` — new `--target` parse + resolution cases
  (resolver consulted, emulator connect options reach the registry factory, Bits still render from
  the emulator registry, cleanup invoked; resolver NOT consulted without `--target`).
- **shell / git commands executed:**
  - `npm run build` (green); `npx jest` full suite — **983 passed / 2 skipped / 0 failed**.
  - Live: `MCP_AUTH_TOKEN=… node dist/.../index.js fleet list --target local` now logs
    `fleet.target.resolved` + `backup.firestore.connect emulatorHost=localhost:8080
    projectId=bitbrat-local` (was `twitch-452523` / `emulatorHost: none`).
- **gate / next action:** Commit + push to the existing BL-204 feature branch (PR #250).

---

## REQ-004 — Verify `--target` applies to ALL `brat fleet` commands (not just `list`)

- **at:** 2026-06-26T18:30:00-04:00
- **prompt (summary):** "Will the standard brat --target parameter work for all the other fleet
  commands as well? If not, please make sure it does."
- **interpretation:** Confirm the REQ-003 fix is not `list`-specific — every `brat fleet` subcommand
  (info/health/config/flags get+set/log/drain/shutdown) must honor `--target`.
- **finding (already correct by construction):** `--target` is NOT a recognized global flag in
  `parseArgs` (`tools/brat/src/cli/index.ts`), so it falls through into `rest` (as `--target=local`)
  and is forwarded to `cmdFleet` for every fleet invocation. `runFleet` resolves `--target`
  (`connectionResolverFn` → `registryFactory(connectOptions)` + target-aware gateway URL) BEFORE
  `dispatch`, so the resolution is shared across all subcommands. No production change required.
- **hardening (test coverage / proof):** `tools/brat/src/cli/__tests__/fleet.spec.ts` — added a
  parametrized `it.each` over all nine subcommands asserting the target resolver is consulted exactly
  once, the resolved emulator connect options reach the registry factory, and the connection cleanup
  runs — locking in cross-command parity.
- **shell / git commands executed:**
  - `npx jest tools/brat/src/cli/__tests__/fleet.spec.ts` — **25 passed** (incl. 9 new per-command
    `--target` cases); `npm run build` green.
- **gate / next action:** Run full Jest suite; commit + push to the BL-204 feature branch (PR #250).

---

## REQ-005 — Bugfix: `brat fleet` always used `:3000`, ignoring local Docker mapped ports

- **at:** 2026-06-26T18:16:00-04:00
- **prompt (summary):** "`brat fleet` is not using the correct local Docker mapped port for different
  bits, and instead is always using 3000." `fleet list --target local` now resolves the emulator
  registry correctly (15 Bits read), but the gateway SSE/REST probe still fails with
  `ECONNREFUSED ::1:3000 / 127.0.0.1:3000`.
- **interpretation:** Second defect on the local path. After REQ-003 the registry resolves correctly,
  but `runFleet` still derived the tool-gateway URL with a hardcoded internal port `3000`. In the
  local Docker stack every Bit (and the tool-gateway) listens on its *internal* container port
  (3000/8080) and is published to the host on a *different* mapped port — `<SERVICE>_HOST_PORT`
  (e.g. `TOOL_GATEWAY_HOST_PORT`, default `3001`, auto-assigned by `deploy-local.sh` to avoid
  collisions). Each Bit self-publishes an internal URL `http://<svc>.bitbrat.local:3000/sse` to
  `mcp_servers`, which is unreachable from the host. So the gateway probe (and any `--direct` Bit
  connection) hit `:3000` instead of the published host port.
- **root cause:** `resolveGatewayUrl` hardcoded `:3000`; the `--direct` transport used the
  registry-published internal URL verbatim. Neither consulted the published host-port mapping that
  `brat chat` (`discoverLocalPort`) / `deploy-local.sh` already rely on.
- **fix:**
  - New `tools/brat/src/fleet/docker-ports.ts`: `resolveServiceHostPort` (`<SVC>_HOST_PORT` env →
    `docker ps` port-mapping probe → `3001` fallback) + `rewriteToLocalHostPort` (remaps an internal
    compose URL to `http://localhost:<publishedPort>/sse`), plus pure `parseDockerPortMapping`.
  - `tools/brat/src/cli/fleet.ts`: for a **local** docker `--target` (new `targetKind` from
    `resolveBackupConnection`), derive the gateway URL from the tool-gateway's published host port and
    pass a per-Bit `urlRewriter` to the `--direct` transport. Explicit `--url` / `TOOL_GATEWAY_URL`
    still wins; remote/SSH targets keep their published URLs. Added injectable `hostPortResolverFn`.
  - `tools/brat/src/fleet/transports/direct-transport.ts`: optional `urlRewriter` applied in
    `resolveUrl` (logged as `fleet.direct.url_remapped`).
  - `tools/brat/src/backup/connection.ts`: `ResolvedBackupConnection.targetKind` ('local'|'remote').
  - Help text + `CHANGELOG.md` (`### Fixed`) updated.
- **tests:** new `tools/brat/src/fleet/__tests__/docker-ports.spec.ts` (parser/resolver/rewriter);
  `tools/brat/src/cli/__tests__/fleet.spec.ts` — gateway URL derives from the published host port for
  local docker, stays `:3000` without a target, explicit `--url` wins, and the `--direct` rewriter is
  threaded only for local targets.
- **shell / git commands executed:**
  - `npm run build` (green); targeted suites `docker-ports.spec.ts` + `fleet.spec.ts` — **42 passed**.
- **gate / next action:** Run full Jest suite; commit + push to the BL-204 feature branch (PR #250).
