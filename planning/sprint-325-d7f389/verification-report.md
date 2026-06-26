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

## Test Evidence
- `npm run build` (tsc): green.
- Full suite (`npx jest`): **Test Suites 270 passed / 1 skipped (271 total); Tests 978 passed / 2 skipped
  / 0 failed** — no regressions.
- Targeted: gateway addressing (5), fleet client (11), parity (2), fleet CLI (13) — all green.
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
