# Deliverable Verification – sprint-325-d7f389 (BL-204 — Brat as a Fleet MCP Client)

## Completed
- [x] **BL2-100** — `McpBridge.translateTool` qualifies platform (`bit`/`bit.*`) ids as `mcp:<bit>/<tool>`
      (registry key / origin Bit name); `displayName` + domain ids unchanged; upstream `execute` still
      calls the unqualified name. Additive, read-path only (no `architecture.yaml` change, Law #2).
- [x] **BL2-101** — Bit-qualified ids are invocable via MCP `CallTool` and the REST mirror
      (`POST /v1/tools/:id`, URL-encoded id); RBAC enforced at discovery + invocation; no domain-tool
      regression (`tests/apps/tool-gateway-bit-addressing.spec.ts`, existing gateway suites green).
- [x] **BL2-200** — `tools/brat/src/fleet/types.ts` (FleetClient/FleetTransport/RegistryReader) +
      `rbac-context.ts` (token resolution `MCP_AUTH_TOKEN` → `.secure.local`/`.env.brat`/`.env.local`;
      fail-closed `PermissionError` exit 4 + `fleet.auth.posture_warning`, OQ3).
- [x] **BL2-201** — `transports/gateway-transport.ts` (DEFAULT): SDK `Client`/`SSEClientTransport`
      (injectable factory) + REST fallback (`GET /v1/tools`, `POST /v1/tools/:id`); `_meta` identity;
      `Forbidden` surfaced, not retried.
- [x] **BL2-202** — `transports/direct-transport.ts` (BREAK-GLASS): single-Bit, registry-URL lookup,
      qualifier-stripping, no fan-out; missing URL → `ConfigurationError`.
- [x] **BL2-203** — `fleet-client.ts` `discover()/list()/call()/callAll()` (fabric + optional registry
      merge so platform-only Bits appear; bounded `Queue` read fan-out, partial-failure tolerant);
      `FirestoreRegistryReader` reads `mcp_servers`.
- [x] **BL2-300..304** — `tools/brat/src/cli/fleet.ts` (`runFleet` + `cmdFleet`), wired via
      `c1 === 'fleet'`: global modifiers (`--all`/`--direct`/`--json`/`--confirm`/`--env`), full
      read/mutate Appendix-A mapping, `--all` read-only fan-out + `--confirm`-gated sequential mutations,
      `--direct` `fleet.break_glass` audit + gateway-bypass + `--all` rejection; `printHelp` updated.
- [x] **BL2-400** — Full Jest matrix (addressing + fleet client + CLI). Externals mocked.
- [x] **BL2-401** — Deployment-target parity (`fleet-parity.spec.ts`): identical behavior under
      `MESSAGE_BUS_DRIVER=pubsub` and `=nats`; `DirectTransport` connects to each Bit's registry-published
      URL across Cloud Run / compose-host / ssh-resolved shapes (no baked-in host).
- [x] **BL2-500** — CHANGELOG `[Unreleased]` entry; new suites + per-driver parity + `fleet` help
      entrypoint wired into `validate_deliverable.sh`; verification/retro/key-learnings produced; PR
      attempted (see `publication.yaml`).

## Post-publication operator fixes (same branch / PR #250 — all consumer-only, Law #2)
After the PR was opened, four operator-reported defects were fixed while running `brat fleet`
against a real local Docker stack. These are folded into this sprint at close:
- [x] **REQ-003** — `brat fleet` now honors the standard `--target` flag: it resolves the
      deployment-target Firestore connection via the same `resolveBackupConnection` used by
      `brat backup`, so `--target local` reads the emulator-backed `mcp_servers` registry
      (project `bitbrat-local`, `localhost:8080`) instead of real GCP (`twitch-452523` → `5 NOT_FOUND`).
- [x] **REQ-004** — confirmed and locked in that `--target` flows through to **all** nine fleet
      subcommands (resolved once in the shared path before dispatch); +9 parametrized tests.
- [x] **REQ-005** — local-Docker host-port awareness: `docker-ports.ts` resolves each service's
      *published* host port (`<SVC>_HOST_PORT` env → `docker ps` probe → fallback) so the gateway
      probe and `--direct` connections no longer hit the hardcoded internal `:3000`.
- [x] **REQ-006** — fleet discovery filters the `mcp_servers` registry-fallback to genuine
      self-registered Bits (`discoverySource: 'auto-registration'`) and never renders the gateway
      itself, removing bogus `unreachable (Tool not found)` rows; `--all` failures are now classified
      (`forbidden` / `unreachable` / `error`) and rendered distinctly, with an elevated-`--roles` hint.

## Test Evidence (at close)
- `npm run build` (tsc): green.
- Full suite (`npx jest`): **Tests 1016 passed / 2 skipped / 0 failed; Test Suites 272 passed /
  1 skipped (273 total)** — no regressions (grew from 978 as the REQ-003…006 fixes added coverage).
- Targeted fleet suites (gateway addressing, fleet client, parity, fleet CLI, docker-ports) — all green.
- `node dist/tools/brat/src/cli/index.js fleet` prints the command surface (exit 0).

## Partial
- None.

## Deferred
- **Gateway fleet façade (TA §4.2 Option B)** — explicitly out of scope; Option A (Bit-qualified
  aggregation) was chosen. Could be layered later if a single `fleet.call` proxy tool is ever wanted.

## Alignment Notes
- Added `x-mcp-token` alongside `Authorization: Bearer` on the gateway/direct requests (matches the
  platform's `MCP_AUTH_TOKEN` transport-auth convention) — additive, not in the original task wording.
- Default role hint (`bit:read` vs `bit:operate`) is derived per command class purely to forward
  intent; RBAC remains server-authoritative (Brat never self-authorizes), overridable via `--roles`.
- Consumer-only posture held: no `bit.*` toolset change, no `architecture.yaml` behavioral change (Law #2).
