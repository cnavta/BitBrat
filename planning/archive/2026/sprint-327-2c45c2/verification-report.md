# Deliverable Verification – sprint-327-2c45c2

**Title:** Documentation Refresh — The Bit Model, Universal MCP Control Plane & Fleet/Release Tooling
**Role:** Lead Technical Writer
**Branch:** `feature/sprint-327-2c45c2-docs-bit-mcp`

## Completed

- [x] **BL-327-001** — New concept doc `documentation/concepts/bit-model.md` (the Bit, three rings,
  `profile:` / `mcp.exposure:` defaults, `bit:`↔`services:` glossary alias, migration notes).
- [x] **BL-327-002** — `README.md` updated to the Bit model: Features (every Bit speaks MCP + `bit.*`
  control plane), Architecture intro, Capabilities Matrix control-plane row, `Bit.next()` lifecycle,
  Bit-based Development Primitives, `brat fleet` Core Commands, and new doc links.
- [x] **BL-327-003** — `documentation/services/mcp-server.md` retitled/rewritten to the Bit vocabulary
  (every Bit speaks MCP; `McpServer` = deprecated compat shim; domain-tools focus); 
  `documentation/services/base-server-routing.md` banner + example now use `Bit`.
- [x] **BL-327-100** — New `documentation/reference/bit-control-plane.md`: all `bit.*` + `bit.llm.*`
  tools with verified `bit:read` / `bit:operate` scopes, secret redaction, transport/auth, exposure model.
- [x] **BL-327-101** — New `documentation/concepts/capability-profiles.md`: `applyProfiles` composition
  and the verified `profile:` → mixin mapping (core/llm/mcp-domain/gateway).
- [x] **BL-327-200** — `documentation/tools/brat.md`: new `brat fleet` and `brat release` sections;
  `service bootstrap` now described as scaffolding a Bit.
- [x] **BL-327-201** — New `documentation/guides/brat-fleet.md` (fabric default vs `--direct` break-glass,
  `--all` read-only fan-out, `--confirm`-gated mutations, `--target` resolution, RBAC posture).
- [x] **BL-327-300** — `mcp-auto-discovery.md` and `mcp-evolution-roadmap.md` reconciled with shipped
  reality (every MCP-enabled Bit self-publishes on `Bit.start()`; fleet self-administration delivered via
  `bit.*` / `brat fleet`).
- [x] **BL-327-301** — Both design-doc status headers flipped to "Implemented"
  (`bit-model-technical-architecture.md` → sprint-324, ADR-001..004 ACCEPTED;
  `bl-204-...md` → sprint-325).
- [x] **BL-327-302** — Documentation index / cross-link pass: README links all new docs; new pages
  cross-link each other; no orphaned pages.
- [x] **BL-327-400** — `planning/sprint-327-2c45c2/validate_deliverable.sh` (structure + optional
  markdownlint + internal link check + version-consistency + `release:dry` no-mutation assertion).
- [x] **BL-327-401** — Accuracy parity check (grep) against source + `architecture.yaml`.

## Validation results

`bash planning/sprint-327-2c45c2/validate_deliverable.sh` → exit 0:

- **Structure:** all 12 required docs present. ✅
- **Markdown lint:** `markdownlint` not installed in this environment → **skipped + logged** (logically
  passable per AGENTS.md §2.6). ⚠️
- **Internal link check:** 139 internal links across 62 Markdown files — **all resolve**. ✅
- **Version consistency:** `architecture.yaml` == `package.json` == `package-lock.json` == `0.7.1`. ✅
- **`release:dry` (`npm run release:dry -- patch`):** reported `0.7.1 -> 0.7.2`, **wrote nothing** (no
  working-tree mutation). ✅

## Accuracy parity (grep vs. canonical source — Law #2)

All documented surfaces were grep-verified to exist in code / `architecture.yaml`:

- **`bit.*` / `bit.llm.*` tools (13):** `bit.info`, `bit.health`, `bit.readiness`, `bit.config.get`,
  `bit.config.describe`, `bit.flags.get`, `bit.flags.set`, `bit.log.level`, `bit.drain`, `bit.shutdown`,
  `bit.llm.model`, `bit.llm.promptPreview`, `bit.llm.toolFilter` — all present in `src/`.
- **RBAC scopes:** `bit:read` / `bit:operate` present in `src/common/base-server.ts`.
- **`brat fleet`:** subcommands + modifiers (`--all`, `--direct`, `--confirm`, `--target`, `--describe`)
  present in `tools/brat/src/cli/fleet.ts`.
- **`brat release`:** `--dry-run`, `--tag`, `--yes` present in `tools/brat/src/cli/release.ts`.
- **Architecture fields:** `profile:` (core/llm/mcp-domain/gateway) and `mcp.exposure:`
  (platform-only/platform+domain) present per-Bit in `architecture.yaml`; `glossary.bit` entry present.

No discrepancies found; docs conform to the canonical source.

## Partial

- None.

## Deferred

- **Markdown lint execution.** `markdownlint` is not installed in this environment; the validation script
  logs and skips it (it runs automatically where the tool is present). Not a content gap.

## Alignment notes / deviations from plan

- The capability-profiles doc was placed at `documentation/concepts/capability-profiles.md` (Concepts),
  matching its reader-facing nature; the implementation plan left the exact path open.
- `mcp.exposure` defaults documented as `platform-only`; in code, a Bit is only promoted to serve MCP when
  it explicitly declares an exposure (unlisted entries stay MCP-off) — both facts are stated in the docs.
- No behavioral code or `architecture.yaml` changes were made (documentation-only sprint; Law #2 upheld).
