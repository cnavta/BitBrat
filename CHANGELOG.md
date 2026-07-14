# Changelog

All notable changes to the BitBrat Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** BitBrat is **pre-1.0 / experimental**; APIs, configuration schemas, and core
> architectures may still change in breaking ways.

## [Unreleased]

### Added
- **`brat code` Documentation**: Comprehensively documented the new `brat code` command for AI-assisted coding
  - Added `brat code` to README.md Getting Started section as recommended exploration step
  - Added comprehensive `brat code` command reference to README.md Management CLI section
  - Updated Prerequisites to include optional coding agent installation (Claude Code, Aider, Continue, OpenHands)
  - Updated Quickstart guide with "Explore with AI Assistance" section
  - Updated Evaluator's Guide with interactive `brat code` introduction as fastest evaluation path
  - Added complete `brat code` section to `documentation/tools/brat.md` with examples, options, and troubleshooting
  - Created `documentation/guides/coding-with-brat-code.md` - comprehensive 8-section guide covering:
    - Installing and using coding agents
    - Agent features and comparison
    - MCP auto-configuration (Claude Code)
    - Configuration and preferences
    - Advanced usage and troubleshooting
  - Created `documentation/guides/coding-agent-plugins.md` - plugin development guide for adding custom agent support
  - Updated CLAUDE.md with coding agent integration section for LLM context

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.12.0] - 2026-07-13
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.11.2] - 2026-07-11
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.11.1] - 2026-07-11
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.11.0] - 2026-07-11
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.10.2] - 2026-07-11
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.10.1] - 2026-07-11
### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.10.0] - 2026-07-10
### Added
- **Fleet observability tools for Dev MCP Server** (sprint-334). Added `fleet.logs` and `fleet.trace` tools providing comprehensive log access and distributed tracing across all deployment targets:
  - **fleet.logs**: Multi-target log retrieval supporting Cloud Run (Google Cloud Logging API) and Docker (docker compose logs) with filtering by level, time range, correlation ID, and bit name. Supports `--all` mode for fleet-wide queries. Output formats: text (human-readable), json (structured), raw (unmodified). Includes client-side filtering, partial failure tolerance, and graceful error handling.
  - **fleet.trace**: Correlation-based distributed request tracing aggregates logs from all services by correlation ID, sorts chronologically, calculates duration, and renders as timeline (HH:MM:SS.mmm relative timestamps) or JSON. Enables debugging complex multi-service flows.
  - Infrastructure: `LogRetriever` with deployment type auto-detection (queries mcp_servers registry to determine cloud-run vs docker), `log-parser` utilities (JSON/text parsing, duration strings, filtering), `log-formatter` utilities (text/json/raw/timeline formats).
  - Dependencies: Added `@google-cloud/logging@^11.0.0` for Cloud Run log access.
  - Tests: 139 total tests passing (36 log-parser, 29 log-formatter, 12 log-retriever, 24 fleet tools, 38 other dev-mcp tests). Full test coverage for both deployment targets, all filters, all formats, partial failures, and error scenarios.
  - Validation: `planning/sprint-334-fleet-logs-trace/validate_deliverable.sh` verifies file structure, TypeScript compilation, dependencies, test execution (>130 tests), code quality (no deprecated imports, no console.log), security (read-only posture, no write operations), tool registration, schema validation, and sprint artifacts.

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.9.0] - 2026-07-08
### Added
- **Dev MCP Server for unified development tooling access** (sprint-333). New `brat dev-mcp start` command exposes 9 read-only MCP tools for coding agents to inspect and query BitBrat platforms across all deployment targets (local Docker, remote SSH, GCP Cloud Run):
  - **Config tools (4)**: `config.show` (resolved architecture), `config.validate` (schema validation), `config.doctor` (environment diagnostics), `schema.read` (JSON schema access)
  - **Fleet tools (2)**: `fleet.list` (enumerate Bits), `fleet.info` (detailed Bit metadata)
  - **Persistence tools (3)**: `db.collections` (list collections), `db.get` (retrieve document), `db.query` (query with filters/ordering/pagination)
  - All tools are **read-only** (no mutations), **fail-closed** (requires MCP_DEV_TOKEN or MCP_AUTH_TOKEN), **target-aware** (--target parameter), with **audit logging** (.brat/dev-mcp-audit.log) and **secret redaction**
  - Server implemented at `tools/brat/src/dev-mcp/` with MCP stdio transport, target connection manager, tool router, and comprehensive test suite (46 tests passing)
  - Documentation: `documentation/guides/mcp-dev-tools-reference.md` (complete tool reference), `documentation/guides/mcp-setup.md` (Claude Code integration guide), `tools/brat/README-MCP-SETUP.md` (quick reference)
  - Validation script: `planning/sprint-333-dev-mcp-server/validate_deliverable.sh` (build, tests, read-only enforcement, fail-closed checks, security audits)

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.8.0] - 2026-07-07
### Added
- **Comprehensive documentation refactor for Reflex and Platform vs Domain architecture** (sprint-332 / documentation-refactor).
  - New guide: `documentation/guides/choosing-platform-vs-domain.md` — Decision framework for categorizing Bits as Platform (core orchestration) or Domain (optional extensions) with 4-question checklist, current categorization tables (10 Platform, 6 Domain), 4 worked examples, and gray areas discussion.
  - New reference: `documentation/reference/reflex-mcp-tools.md` — Complete reference for all 6 `reflex.*` domain tools (`create`, `list`, `update`, `delete`, `test`, `stats`) with parameter schemas, tool naming conventions, event type conventions, parameter interpolation, cache behavior, and priority semantics.
  - New tutorial: `documentation/tutorials/creating-a-reflex.md` — Step-by-step guide for creating deterministic <150ms reflexes with pattern matching (exact/contains/prefix/suffix/regex), conditions filtering, tool execution, response variations, troubleshooting, and best practices. Includes comparison table: Event Router rules vs Reflexes.
  - New tutorial: `documentation/tutorials/creating-a-domain-mcp-server.md` — End-to-end guide for building Domain MCP Servers (category: domain, profile: mcp-server) with weather service example, Bit scaffold generation, tool registration with Zod, configuration management, testing workflows, deployment, advanced topics (context binding, resources, metrics), and common patterns.
  - Updated `documentation/tutorials/lurk-command.md` with "Alternative: The Reflex Approach" section explaining when to use Event Router rules vs Reflexes.
  - Updated core documentation (`README.md`, `platform-flow.md`, `event-router-rules.md`, `capability-profiles.md`, `bit-model.md`, `bit-control-plane.md`, `bit-model-technical-architecture.md`, `quickstart.md`, `evaluating-bitbrat.md`) with dual execution paths (Reflex deterministic <150ms vs LLM-based 2-10s), Platform vs Domain categorization, and profile rename (mcp-domain → mcp-server).
  - Added validation summary (`planning/sprint-documentation-refactor/validation-summary.md`) with automated and manual validation results: 0 mcp-domain references, 100% terminology consistency, 35+ cross-references, 5 new documents (1,524 lines), 15 updated documents.

### Changed
- **Profile renamed: `mcp-domain` → `mcp-server`** (sprint-332 / documentation-refactor). Clarifies that this profile serves MCP tools (matches `kind: mcp-server`). Clears namespace conflict with `category: domain` and `mcp.exposure: platform+domain`. Updated across `architecture.yaml`, JSON schema, Zod schema, CLI validation, templates, and all documentation. Contract enforced: `profile: mcp-server` requires `mcp.exposure: platform+domain`.

### Deprecated

### Removed

### Fixed

### Security

## [0.7.4] - 2026-07-03
### Added
- **`brat bit create` command for modern Bit scaffolding** (sprint-331). New `brat bit create <name> [options]`
  replaces `brat service bootstrap` with profile-aware scaffolding, MCP exposure validation, and optional
  architecture.yaml registration. Profiles (`core`, `gateway`, `llm`, `mcp-domain`) generate appropriate imports
  and setup code. Enforces profile/exposure contract (e.g., mcp-domain requires platform+domain). Flags include
  `--profile`, `--exposure`, `--kind`, `--port`, `--register`, `--active`, `--force`. Generates app source, test,
  Dockerfile, and docker-compose config. 110 unit + integration tests. See updated CLAUDE.md and README.md.

- **`brat fleet restart <bit>` + universal `bit.restart` control-plane tool** (sprint-330). Every Bit now
  exposes `bit.restart` (scope `bit:operate`), which gracefully `close(reason)`s and then exits so the
  orchestrator (Cloud Run min-instances / local supervisor) respawns a fresh instance, returning
  `{ restarting: true, reason }`. The fleet CLI gains a matching `restart` subcommand with the same
  `--all` + `--confirm` and RBAC ergonomics as `drain`/`shutdown`. Set `BIT_RESTART_NO_EXIT=1` to perform
  only the graceful close (used by tests). Conformance and fleet CLI tests cover the new verb.

### Changed
- **`brat deploy services` now honors `active: false`** (sprint-330). `deploy services --all` skips any
  service whose `active` is not `true` (absent `active` is disabled by default per
  `defaults.services.active`), matching the IaC synth path — previously inactive Bits (e.g. `obs-mcp`)
  were still built and deployed. Deploying an inactive service **by name** now fails fast with a
  `ConfigurationError` instead of silently deploying it.

### Deprecated

### Removed
- **BREAKING: `brat service bootstrap` command removed** (sprint-331). The legacy `brat service bootstrap --name <name> [--mcp]`
  command and all variants (`brat bootstrap service`) have been removed. Use `brat bit create <name> [options]` instead.
  Migration: `brat service bootstrap --name foo --mcp` → `brat bit create foo --profile mcp-domain --register`.
  Also removed legacy `infrastructure/scripts/bootstrap-service.js` and associated test file.

### Fixed
- **Slow Bits no longer emit duplicate responses** (sprint-330). With at-least-once delivery, a Bit whose
  processing approached the ack deadline (e.g. `image-gen-mcp`, `llm-bot`) could have its message
  redelivered and produce a second egress. Two fixes: (1) the message-bus consumer dedupe is now keyed on
  the canonical `correlationId+step+attempt` (per the architecture invariant) **with a transport
  message-id fallback**, so a redelivery of the same message is dropped before the handler runs again —
  even when the message carries no correlation attributes; this is now shared by both the Pub/Sub and NATS
  drivers. (2) Lease/ack-deadline extension is kept alive while a slow handler runs — Pub/Sub sets an
  explicit, configurable `maxExtensionTime` (`PUBSUB_MAX_ACK_EXTENSION_SECONDS`, default 600s) and NATS
  sets `ackWait` (`NATS_ACK_WAIT_SECONDS`, default 60s) plus periodic `msg.working()` calls — so a
  slow-but-successful handler is not redelivered in the first place.

### Security

## [0.7.3] - 2026-06-29
### Added
- **Scheduler can now emit ANY `InternalEventV2` on a selectable topic** (sprint-329). `create_schedule`'s
  `event` was widened from a partial `{ type, payload, message, annotations }` projection to a full
  `InternalEventV2` authoring shape (adds `egress`, `identity`, `candidates`, `qos`, `externalEvent`,
  `metadata`, and ingress connector/channel overrides — mirroring `src/types/events.ts`, with `egress`
  reusing `ConnectorType` incl. `'twitch'`). A new **optional top-level `topic`** selects the publish
  topic (validated against a curated governed allow-list — `internal.ingress.v1`, `internal.egress.v1`)
  and defaults to `internal.ingress.v1` when unset. This makes the "schedule an event … with egress set
  for Twitch" request expressible end-to-end.

### Changed
- **Scheduler execution no longer hard-codes egress or the publish topic** (sprint-329). `executeSchedule`
  now honors the author-supplied `egress`/`identity`/`message`/`annotations`/`candidates`/`qos`/
  `externalEvent`/`metadata`, falling back to `{ destination: 'system', connector: 'system' }` egress only
  when unset; server-owned envelope fields (`v`, `correlationId`, `traceId`, `ingress.ingressAt`+`source`,
  `routing`) remain server-owned (OD-2). `handleTick` publishes each due schedule on its `topic`
  (default `internal.ingress.v1`), caching one publisher per distinct topic. `architecture.yaml` now
  declares the scheduler as a producer on `internal.egress.v1` (Law #2; `brat config validate` passes).

### Deprecated

### Removed
- **BREAKING (sprint-329, G4): `ScheduleDoc.event` is no longer the legacy partial projection.** No
  backward compatibility is provided for stored schedules using the old `event` shape; any existing
  schedule documents must be deleted/recreated against the full `InternalEventV2` authoring contract.

### Fixed
- **event-router now registers with the tool-gateway.** Its service entrypoint called `app.listen()`
  directly instead of going through the `Bit.start()` lifecycle, so the post-listen
  `publishRegistration()` step never ran — leaving event-router absent from the tool-gateway's
  registered MCP servers (a sprint-324 Bit-migration miss; every other service uses
  `server.start(PORT)`). The entrypoint now instantiates the Bit and calls `server.start(PORT)`, so
  event-router self-publishes on `INTERNAL_MCP_REGISTRATION_V1` like the rest of the fleet. Added a
  regression test asserting `start()` self-publishes the registration.
- **tool-gateway no longer "continually reloads" the MCP registry.** `handleMcpRegistration` upserted
  the `mcp_servers` Firestore doc on every registration event — and because each write stamped a fresh
  `updatedAt`/`correlationId`, the `RegistryWatcher.onSnapshot` fired and re-loaded every server, even
  though Bits re-publish identical registrations on a heartbeat. This created a self-sustaining
  write → snapshot → reload loop. The gateway now caches a stable signature of each Bit's meaningful
  registration payload (excluding the volatile per-event `correlationId`) and skips the Firestore write
  when nothing changed, breaking the loop while still persisting genuine changes. Added a regression
  test asserting repeated identical registrations write once and a changed payload re-persists.

### Security

## [0.7.2] - 2026-06-28
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
