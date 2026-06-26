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

## Partial
- [~] **BL-400 / Phase 3** `McpServer` is already a thin compat shim over `Bit` (the structural part of
      Phase 3 is done). Removing `extends McpServer` from production services, updating `brat service
      bootstrap` templates/docs, and **retiring the `BaseServer` alias (BL-401)** are **deferred** to keep
      this slice behavior-preserving and green.

## Deferred (follow-up sprint)
- [ ] **BL-204** Brat as a fleet MCP client (`bit.*` orchestration via the `tool-gateway` fabric) +
      documented direct-connect break-glass (ADR-003). The `bit.*` surface and registry self-publish that
      Brat would consume are in place; the Brat CLI commands themselves are not yet implemented.
- [ ] **BL-401** Retire the deprecated `BaseServer` alias + bootstrap-template updates (end of migration
      window) — deferred with Phase 3 (BL-400).

## Alignment / Deviations
- **Behavior-preservation choice:** `McpServer extends BaseServer` (not `extends Bit`) was retained so the
  existing prototype chain (`extends McpServer` services) and tests that `jest.spyOn(BaseServer.prototype,
  …)` keep working. `BaseServer` is itself a thin deprecated subclass of `Bit`, so the model is intact.
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
