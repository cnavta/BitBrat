# Changelog

All notable changes to the BitBrat Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** BitBrat is **pre-1.0 / experimental**; APIs, configuration schemas, and core
> architectures may still change in breaking ways.

## [Unreleased]

### Added
- Just-in-Time Context Provisioning ("Context Packs"): a `src/common/context/` convention
  (`ContextPack`/`ContextBinding`/`ContextProvider`, de-duplicating `resolveContextPacks`, and a
  `packToNamedContext` renderer) that surfaces relevant, versioned schema/usage context to agents only
  when the related MCP tool/task/event is active (sprint-328).
- `Bit.registerToolWithContext()` + `registerContextPack`/`registerContextBinding`/`getContextProvider`
  on the base abstraction; scheduler and event-router now expose `context://schema/internal-event-v2`
  and `context://router/jsonlogic-guide` MCP Resources and bind them to `create_schedule`/`create_rule`.
- Generated, drift-guarded packs derived from the source of truth (`events.ts` annotation kinds;
  `jsonlogic-evaluator.ts` custom operators + EvalContext paths) with tests that fail on drift.
- `INTERNAL_MCP_REGISTRATION_V1` optionally advertises `payload.context.{packs,bindings}` (additive);
  the tool-gateway aggregates them and exposes `resolveContextForTools()` for just-in-time injection.
- llm-bot prompt logging now lists the ContextPacks that contributed to each generated prompt: an
  `llm_bot.prompt.context_packs` log line plus a `contextPacks[]` field on the `prompt_logs` document,
  backed by shared `formatPackSubheader`/`parsePackSubheader`/`extractContextPacksFromNamedContexts`
  helpers so pack detection never drifts from rendering (sprint-328).

### Changed

### Deprecated

### Removed

### Fixed
- **state-engine `propose_mutation` no longer reports a false-positive success for disallowed keys**
  (sprint-328 follow-up). The mutation pipeline is fire-and-forget (publish to `internal.state.mutation.v1`,
  validate asynchronously in the consumer), so a proposal for a key outside the allow-list was silently
  rejected (`Key not allowed`) while the tool still returned `Mutation … proposed` — the caller (and the
  LLM) saw success even though nothing was persisted. `propose_mutation` now pre-validates the key against
  the same allow-list the consumer enforces and returns an `isError` result that lists the allowed
  namespaces; its description advertises them too, so agents pick a valid key. A `user.fact.*` namespace was
  added to the default allow-list so personal facts (e.g. "store that I love the band Yes") can actually be
  stored under `user.fact.<userId>.<topic>`.

### Security

## [0.7.1] - 2026-06-27
### Added
- **Integrated version handling — `brat release` / `npm run release`** (sprint-326, BL-326). A single,
  idempotent, dry-run-able release tool makes `architecture.yaml` `project.version` the **single source
  of truth** for the platform version. `brat release <patch|minor|major|x.y.z>` (or `npm run release --
  <bump>`) computes the next SemVer, writes it to `architecture.yaml` (ONLY `project.version`,
  comment-preserving, then re-validated — Law #2) and `package.json`, syncs `package-lock.json`, asserts
  all three agree, and rolls `CHANGELOG.md` `## [Unreleased]` into a dated `## [<version>]` block with a
  fresh empty `## [Unreleased]` skeleton. Flags: `--dry-run` (writes nothing; CI-safe), `--tag` (local
  `git tag v<version>`, never pushes; off by default), `--yes`. `npm run release:dry -- patch` is wired
  into `validate_deliverable.sh` (with a generalized three-file version-consistency assertion) so every
  shipping sprint proves a bump is mechanically possible. Lives in `tools/brat/src/release/`
  (`semver` + `version-files` + `changelog` + `release` orchestrator) with the thin
  `tools/brat/src/cli/release.ts` shell.
- **Brat as a fleet MCP client — `brat fleet`** (sprint-325, BL-204). A new Brat command group turns
  Brat into a consumer of the universal `bit.*` control plane: `brat fleet list|info|health|config|flags|
  log|drain|shutdown`, mapping each subcommand to the corresponding `bit.*` tool (Appendix A). The
  default path is the **`tool-gateway` fabric** (one auth/RBAC/discovery chokepoint, ADR-003); a
  documented, audited **`--direct <bit>` break-glass** bypasses the gateway to reach a single Bit
  directly (emits a `fleet.break_glass` audit line, single-Bit only, rejected with `--all`, OQ4).
  Commands are **fail-closed**: without a resolvable `MCP_AUTH_TOKEN` they refuse to run (non-zero exit
  + posture warning, OQ3). `--all` fans out **read-only** via a bounded queue (partial-failure tolerant);
  fleet-wide mutations require an explicit `--confirm` and run sequentially. RBAC is server-authoritative
  (`bit:read` vs `bit:operate`); Brat only forwards identity (`_meta.{userRoles,userId}`) and never
  self-authorizes. Lives in `tools/brat/src/fleet/` (`FleetClient` + `gateway-transport` +
  `direct-transport` + `rbac-context` + Firestore `RegistryReader`), reusing the platform
  `@modelcontextprotocol/sdk` `Client`/`SSEClientTransport` wrappers.
- **Bit-qualified addressing in `tool-gateway`** (additive, read-path only). `McpBridge.translateTool`
  now assigns platform (`bit.*`) tools a Bit-qualified discovery id `mcp:<bit>/<tool>` (derived from the
  registry key / origin Bit name), so identically-named `bit.*` tools across the fleet no longer collide
  (last-writer-wins) and each Bit's control tools are individually enumerable and invocable through the
  fabric (MCP `CallTool` + REST `POST /v1/tools/:id`). Domain tools and `displayName` are unchanged; no
  `bit.*` definition or `architecture.yaml` change (Law #2).
- **The Bit model & universal MCP control plane** (sprint-324). The MCP capability was promoted from a
  per-service subclass decision (`extends McpServer` vs `extends BaseServer`) down into the base
  abstraction: `BaseServer` was refactored to **`Bit`**, and the MCP transport (`/sse` + `POST /message`),
  tool/resource/prompt registration, discovery handlers, token auth, and registry self-publish were folded
  into `Bit`, gated by `mcp.exposure`. (Phase 3) All 14 services now `extend Bit` directly; the
  deprecated `BaseServer` alias has been retired.
- **Mandatory `bit.*` control plane** on every MCP-enabled Bit: `bit.info`, `bit.health`/`bit.readiness`,
  `bit.config.get`/`bit.config.describe` (secret-redacted), `bit.flags.get`/`bit.flags.set`,
  `bit.log.level`, `bit.drain`/`bit.shutdown` — registered on the Platform Ring before any domain tools,
  with RBAC scopes (`bit:read` for read-only, elevated `bit:operate` for mutating/lifecycle tools).
- **Declarative Bit fields in `architecture.yaml`**: optional `profile:` (`core | llm | mcp-domain |
  gateway`, default `core`) and `mcp.exposure:` (`platform-only | platform+domain`, default
  `platform-only`) per Bit, a `bit:` glossary entry, and the §6.3 promotion of the six former
  `BaseServer` services to a `platform-only` control plane (sensitive `persistence`/`oauth` stay
  platform-only behind elevated scopes). Mirrored in the Zod + JSON config schemas.
- **Platform Ring conformance suite** (`tests/common/bit-conformance.spec.ts`) with a `hello-bit` fixture
  asserting the full `bit.*` contract, transport wiring, secret redaction, RBAC scopes, default-deny
  exposure, and legacy-off behavior; wired into `validate_deliverable.sh` with a PubSub/NATS
  messaging-driver parity check (GCP / Local Docker / Remote Docker).
- **Capability profiles — composition over inheritance** (sprint-324 Phase 2, ADR-002). A Bit now
  *composes* capability mixins via `applyProfiles(<Class>, [...])` (no new inheritance depth):
  `EventingProfile`, `ResourcesProfile`, `McpClientProfile`, and `LlmProfile` under `src/common/profiles/`.
  The declared `architecture.yaml` `profile:` is enforced against the applied mixins at `Bit` bootstrap
  (`profile: llm` ⇒ `LlmProfile`), so declared intent cannot diverge from runtime capability; an unknown
  profile or a missing required mixin fails fast.
- **`bit.llm.*` LLM-admin tools** (registered by `LlmProfile`, namespaced under the `bit.*` control plane,
  RBAC-scoped): `bit.llm.model` (read/set the active provider+model), `bit.llm.promptPreview` (assembled
  prompt, redacted), and `bit.llm.toolFilter` (inspect/adjust the exposed tool set). Memory/behavioral
  knobs are surfaced as `LlmProfile` config.
- **`Bit` lifecycle hooks** `onStartup`/`onShutdown` so profiles (e.g. `McpClientProfile`) can wire their
  connect/teardown choreography in the historical order.
- **Agent-framework framing** in the README: a "What is BitBrat?" section mapping the platform onto the
  perceive → plan → act → observe agent loop, a "Core Agent Concepts" table, an "Extending BitBrat" guide,
  and a high-level mermaid architecture diagram + capabilities matrix.
- **Offline / Local-LLM quickstart** (Ollama via the existing `ai-sdk-ollama` dependency): run with no
  OpenAI key or GCP using `LLM_PROVIDER`/`LLM_MODEL`/`LLM_BASE_URL`.
- **Published config schema** `documentation/schemas/architecture.v1.json` for `architecture.yaml`, wired
  into `brat config validate` (Zod + JSON Schema via ajv) and pointed to by `references.architecture_schema`
  and a top-of-file `# yaml-language-server: $schema=` comment.
- **`extension_points:` block** in `architecture.yaml` describing how to add a service / MCP tool / rule.
- **Evaluator's Guide** (`documentation/getting-started/evaluating-bitbrat.md`) and a standalone
  architecture-diagram asset (`assets/architecture-overview.md`).
- **Dependency Scanning & Remediation Cadence** section in `SECURITY.md`.
- This `CHANGELOG.md`.

### Fixed
- **`brat fleet` now honors `--target` for fleet discovery** (sprint-325, BL-204 follow-up). Fleet
  commands previously ignored the deployment target and always read the `mcp_servers` registry from
  real GCP (ADC / `PROJECT_ID`), so `brat fleet list --target local` connected to the cloud project
  (e.g. `twitch-452523`) and failed with `5 NOT_FOUND` while the local Docker stack ran its own
  Firestore emulator. `--target` now resolves the same docker-engine endpoint `brat backup` uses
  (via `resolveBackupConnection`) and points the `FirestoreRegistryReader` at that stack's emulator
  (`localhost:8080`, project `bitbrat-local` for `local`), with `--project-id` / `--emulator-host` /
  `--database` overrides for parity. The gateway base URL is derived from the resolved emulator host
  (so a local run probes the local stack), and any SSH tunnel opened for a remote target is torn down
  after the command.
- **`brat fleet` now uses each service's PUBLISHED local Docker port instead of the hardcoded `:3000`**
  (sprint-325, BL-204 follow-up). Against a local docker `--target`, the tool-gateway is reached on its
  published host port — resolved from `<SERVICE>_HOST_PORT` (e.g. `TOOL_GATEWAY_HOST_PORT`) or a
  `docker ps` port-mapping probe (mirroring `brat chat`), with a `3001` fallback — rather than the
  internal container port `3000` (which is only reachable from inside the compose network). Likewise,
  the `--direct <bit>` break-glass now remaps each Bit's internal registry URL
  (`http://<svc>.bitbrat.local:3000/sse`) to its operator-reachable `http://localhost:<publishedPort>/sse`.
  An explicit `--url` / `TOOL_GATEWAY_URL` still wins, and remote/SSH targets keep their published URLs.
- **`brat fleet` no longer lists non-Bit MCP servers (or the gateway itself), and labels RBAC denials
  accurately** (sprint-325, BL-204 follow-up). Two defects surfaced by `fleet info --all --target local`:
  (1) the `mcp_servers` registry is the gateway's *upstream* catalog and also contains manually-added
  external MCP servers (e.g. a stdio web-search tool) and the `tool-gateway` itself — none of which
  expose the universal `bit.*` plane — so they leaked into the fleet and then failed every call with
  `unreachable (Tool not found)`. The registry-fallback contribution is now filtered to genuine,
  self-registered Bits (the gateway stamps `discoverySource: 'auto-registration'`), and the gateway's
  own service is never rendered as a fleet member. (2) `--all` previously rendered every failure as
  `unreachable (...)`, mislabeling a server-authoritative RBAC denial (a *reachable* but unauthorized
  Bit) as a connectivity failure; failures are now classified (`forbidden` / `unreachable` / `error`)
  and rendered distinctly, with a hint to re-run with elevated `--roles` when any Bit is `forbidden`.

### Changed
- **`McpServer` is now a thin compatibility shim** over `Bit` (selecting `platform+domain` exposure).
  (Phase 3) No production code `extends McpServer` any more — every service now `extends Bit` and either
  declares `mcp.exposure` in `architecture.yaml` or passes `mcpExposure: 'platform+domain'`. New code
  should `extend Bit`; `McpServer` is retained only for backward compatibility.
- **`brat service bootstrap` templates and developer docs now speak “Bit”** (sprint-324 Phase 3): generated
  services `extend Bit` (with `mcpExposure: 'platform+domain'` when MCP is requested), and
  `documentation/services/mcp-server.md` / `base-server-routing.md` were updated to the Bit vocabulary.
- Reconciled the project **version to `0.7.0`** across `package.json` and `architecture.yaml`, and added an
  explicit `project.status: experimental`.
- Fixed the README/quickstart **clone URL** to `https://github.com/cnavta/BitBrat.git`.
- Extended the Zod `ArchitectureSchema` to recognize the `document-database` (`cloud-firestore`)
  infrastructure resource, so `brat config validate` passes on the current file.
- Moved `ajv`/`ajv-formats` to runtime dependencies (used by `brat config validate`).

### Removed
- **Retired the deprecated `BaseServer = Bit` alias** (sprint-324 Phase 3 / BL-401) at the end of the
  migration window. All production and test code now extends/imports `Bit` directly; the
  `BaseServerOptions` constructor-options interface is retained as the canonical `Bit` options shape.
- Untracked and deleted repo-root scratch artifacts (`dummy-creds.json`, `route.json`, `test.json`,
  `validation_output.txt`) and tightened `.gitignore` so they cannot return.

### Security
- Applied non-breaking `npm audit fix`: vulnerabilities reduced from 51 to 42, clearing all critical and
  nearly all high advisories. Remaining moderate/transitive advisories are tracked and deferred pending
  upstream fixes (see `planning/sprint-323-49faff/verification-report.md`).
