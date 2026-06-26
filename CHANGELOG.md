# Changelog

All notable changes to the BitBrat Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** BitBrat is **pre-1.0 / experimental**; APIs, configuration schemas, and core
> architectures may still change in breaking ways.

## [Unreleased]

### Added
- **The Bit model & universal MCP control plane** (sprint-324). The MCP capability was promoted from a
  per-service subclass decision (`extends McpServer` vs `extends BaseServer`) down into the base
  abstraction: `BaseServer` was refactored to **`Bit`** (with `BaseServer` kept as a deprecated alias),
  and the MCP transport (`/sse` + `POST /message`), tool/resource/prompt registration, discovery handlers,
  token auth, and registry self-publish were folded into `Bit`, gated by `mcp.exposure`.
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

### Changed
- **`McpServer` is now a thin compatibility shim** over `Bit` (selecting `platform+domain` exposure);
  existing `extends McpServer` services are behavior-identical. New code should `extend Bit` and declare
  `mcp.exposure` in `architecture.yaml`.
- Reconciled the project **version to `0.7.0`** across `package.json` and `architecture.yaml`, and added an
  explicit `project.status: experimental`.
- Fixed the README/quickstart **clone URL** to `https://github.com/cnavta/BitBrat.git`.
- Extended the Zod `ArchitectureSchema` to recognize the `document-database` (`cloud-firestore`)
  infrastructure resource, so `brat config validate` passes on the current file.
- Moved `ajv`/`ajv-formats` to runtime dependencies (used by `brat config validate`).

### Removed
- Untracked and deleted repo-root scratch artifacts (`dummy-creds.json`, `route.json`, `test.json`,
  `validation_output.txt`) and tightened `.gitignore` so they cannot return.

### Security
- Applied non-breaking `npm audit fix`: vulnerabilities reduced from 51 to 42, clearing all critical and
  nearly all high advisories. Remaining moderate/transitive advisories are tracked and deferred pending
  upstream fixes (see `planning/sprint-323-49faff/verification-report.md`).
