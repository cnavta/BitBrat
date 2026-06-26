# Deliverable Verification – sprint-324-00782d (The Bit Model & Universal MCP Control Plane)

- **Baseline (pre-sprint):** build green; 265 suites / 927 tests passing.
- **Final (Phases R/0/1-core + Phase 2):** build green; **267 suites / 949 tests passing**, 0 failing;
  `validate_deliverable.sh` exits 0 (logically passable per AGENTS.md §2.6); `brat config validate` passes.

## Completed
- [x] **BL-001** Discovery & baseline inventory (verified 10 `extends McpServer` / 6 `extends BaseServer`;
      `MCP_AUTH_TOKEN` coverage; profile→mixin targets).
- [x] **BL-002 (Gate GR)** Ratified `architecture.yaml` **additively**: added `profile:` and `mcp.exposure:`
      to the Zod `ServiceSchema`/`DefaultsServicesSchema` and the JSON schema; added a `bit:` glossary
      entry, platform-wide `defaults.services` Bit defaults (`profile: core`, `mcp.exposure: platform-only`),
      and per-Bit annotations for all 16 services with the §6.3 promotion noted in-file. `brat config
      validate` passes; changes are backward-compatible (the `services:` key is retained, ADR-004).
- [x] **BL-100 / BL-101 / BL-102 / BL-103 (Gate G0)** Refactored `BaseServer` → **`Bit`** with a deprecated
      `BaseServer` alias (subclass + one-time deprecation log); folded the MCP control plane (SSE transport,
      `registerTool/Resource/Prompt`, discovery handlers, `executeTool`, `traceMcpOperation`, token auth,
      `publishRegistration`) **down into `Bit`**, gated by `mcp.exposure`. `McpServer` is now a thin shim
      selecting `platform+domain`. Full suite green; behavior preserved.
- [x] **BL-200 / BL-201 (part of Gate G1)** Implemented the mandatory `bit.*` Platform Ring toolset
      (`bit.info`, `bit.health`, `bit.readiness`, `bit.config.get`, `bit.config.describe`, `bit.flags.get`,
      `bit.flags.set`, `bit.log.level`, `bit.drain`, `bit.shutdown`), registered before any Business-Ring
      tools, each backed by an existing primitive. RBAC scopes applied (`bit:read` for read-only, elevated
      `bit:operate` for mutating/lifecycle); config tools redact secrets (via `safeConfig`); token auth on
      the transport is unchanged.
- [x] **BL-202** Registry self-publish now runs on `start()` for **every** MCP-enabled Bit (the
      `publishRegistration` path moved to `Bit`), not just the former `McpServer` set; idempotent and
      messaging-driver agnostic.
- [x] **BL-203 (§6.3 promotion)** The 6 former `BaseServer` services are promoted to a `platform-only`
      MCP control endpoint by the ratified `architecture.yaml` exposure (read by `resolveMcpExposure`);
      sensitive `persistence`/`oauth` stay `platform-only` behind elevated scopes; full suite stayed green.
- [x] **BL-205** Platform Ring conformance suite (`tests/common/bit-conformance.spec.ts`) + `hello-bit`
      fixture: asserts the full `bit.*` contract, transport wiring, secret redaction, RBAC scopes,
      default-deny exposure, and that an unlisted Bit stays MCP-off. Wired into `validate_deliverable.sh`.
- [x] **BL-500 (validation portion)** Extended `validate_deliverable.sh`: build + conformance + MCP
      fold-down + discovery suites + `brat config validate` + a **PubSub/NATS messaging-driver parity**
      loop (GCP / Local Docker / Remote Docker). CHANGELOG updated.
- [x] **BL-300 (Gate G2)** Composition mechanism (ADR-002): `src/common/profiles/{types,registry}.ts` —
      `applyProfiles(<Class>, [...])` (class-level, inherited, de-duped by name) + `collectProfiles` +
      `enforceProfileContract` over `PROFILE_REQUIREMENTS` (`llm` ⇒ `['llm']`). `Bit.bootstrapProfiles()` /
      `resolveProfile()` run after `initializeMcp`; an unknown profile or a missing required mixin fails
      fast. `Bit.onStartup`/`onShutdown` lifecycle hooks added (run in the historical order).
- [x] **BL-301 (Gate G2)** Extracted profiles under `src/common/profiles/`: `EventingProfile` +
      `ResourcesProfile` (marker mixins exposing `publishEvent` / `getFirestore|getStorage|getPublisher`
      over existing `Bit` capabilities — no behavior change); `McpClientProfile` (factory wiring
      `McpClientManager` + `RegistryWatcher` via the new lifecycle hooks, exposed as `bit.mcpClient`);
      `LlmProfile` (provider-factory resolution + prompt-assembly/redaction + `bit.llm.*` tools, exposed as
      `bit.llm`). Unit-tested in `tests/common/bit-profiles.spec.ts`.
- [x] **BL-302 (Gate G2)** `bit.llm.*` admin tools registered by `LlmProfile` (only when `isMcpEnabled()`),
      namespaced under `bit.*` and RBAC-scoped: `bit.llm.model` (read/set; `bit:operate`),
      `bit.llm.promptPreview` (assembled + redacted; `bit:read`), `bit.llm.toolFilter` (inspect/adjust;
      `bit:operate`). Memory/behavioral knobs surfaced via `capability.getConfigKnobs()`.
- [x] **BL-303 (Gate G2)** `llm-bot` refit onto `Bit` + `applyProfiles([EventingProfile, LlmProfile,
      McpClientProfile({createRegistry: () => new ToolRegistry()})])`; removed the hand-rolled
      `McpClientManager`/`RegistryWatcher` fields, connect-retry loop, and `close()` override (now owned by
      `McpClientProfile`). Existing llm-bot + processor tests pass unchanged.
- [x] **BL-304 (Gate G2 exit)** `query-analyzer` (now `extends Bit`) and `stream-analyst` (over its
      `McpServer` base) compose `[EventingProfile, LlmProfile]`; all three LLM Bits share the identical
      `bit.llm.*` surface. Domain paths unchanged; existing tests pass unchanged.
- [x] **BL-400 (Gate G3)** Removed `extends McpServer` from **all** production code: the 10 former MCP
      services now `extends Bit` with explicit `mcpExposure: 'platform+domain'`, and the 4 former
      `extends BaseServer` services now `extends Bit` (platform-only via `architecture.yaml`). `McpServer`
      is retained only as a thin compat shim (now `extends Bit`). `brat service bootstrap` template and the
      `mcp-server.md` / `base-server-routing.md` developer docs were updated to the Bit vocabulary.
- [x] **BL-401 (Gate G3 exit)** Retired the deprecated `export class BaseServer extends Bit` alias.
      Migrated all remaining ~40 test files (imports / `extends` / `jest.spyOn(BaseServer.prototype, …)` /
      `as BaseServer` casts / module-mock keys) and the base-server internal static self-refs to `Bit`.
      `BaseServerOptions` is retained as the canonical Bit options interface. CHANGELOG updated.

## Deferred (follow-up sprint)
- [ ] **BL-204** Brat as a fleet MCP client (`bit.*` orchestration via the `tool-gateway` fabric) +
      documented direct-connect break-glass (ADR-003). The `bit.*` surface and registry self-publish that
      Brat would consume are in place; the Brat CLI commands themselves are not yet implemented. (This was
      a deferred **Phase 1** item, out of Phase 3 scope.)

## Alignment / Deviations
- **Phase 3 resolved the prototype-spy coupling.** Earlier phases kept `McpServer extends BaseServer` so
  tests spying on `BaseServer.prototype` kept working. In Phase 3 all services moved to `extends Bit`, so
  those spies were repointed to `Bit.prototype` and `McpServer` now `extends Bit` directly. The deprecated
  `BaseServer` alias has been fully removed with no production or test dependency remaining.
- **Behavior-preservation choice (BL-400):** former `extends McpServer` services pass explicit
  `mcpExposure: 'platform+domain'` rather than relying on `architecture.yaml` lookup, so exposure is
  identical to the old `McpServer` shim regardless of any serviceName↔architecture-key mismatch (e.g.
  `stream-analyst` vs key `stream-analyst-service`, or `api-gateway`'s bare `super()`).
- **Promotion gating:** `resolveMcpExposure` promotes only services that **explicitly** declare
  `mcp.exposure` in `architecture.yaml`; unlisted Bits (test fixtures) stay MCP-off, which preserved the
  full suite without per-test edits.
- **Test/mocks updated (not weakened):** `tests/unit/apps/state-engine.test.ts` base-server mock was
  extended to provide the MCP surface that the fold-down moved into the base; no assertions were weakened.
- **Phase 2 composition (ADR-002):** profiles are installed per-instance at `Bit` bootstrap rather than
  via the illustrative-only bare `applyProfiles(LlmBot, [...])` of design §5.2. `McpClientProfile` is a
  factory taking an injected `createRegistry` (the shared `ToolRegistry` is per-instance and must be
  shared between the manager and the loop), keeping the common profile decoupled from llm-bot's domain
  registry. Marker profiles (`Eventing`/`Resources`) expose convenience accessors over capabilities `Bit`
  already provides — no behavior change. The `profile:` contract currently enforces only `llm` ⇒
  `LlmProfile`; `eventing`/`resources`/`mcp-client` are layered on freely (not required by the map).

## Deployment-target parity (owner approval condition)
- The `bit.*` / registration / auth path is messaging-driver agnostic; parity is asserted in
  `validate_deliverable.sh` by running the conformance suite under both `MESSAGE_BUS_DRIVER=pubsub` (GCP)
  and `MESSAGE_BUS_DRIVER=nats` (Local/Remote Docker). No GCP-only or Compose-only assumption is baked
  into the base abstraction.
