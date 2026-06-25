# Changelog

All notable changes to the BitBrat Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** BitBrat is **pre-1.0 / experimental**; APIs, configuration schemas, and core
> architectures may still change in breaking ways.

## [Unreleased]

### Added
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
