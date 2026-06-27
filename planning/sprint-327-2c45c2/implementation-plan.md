# Implementation Plan – sprint-327-2c45c2

**Title:** Documentation Refresh — The Bit Model, Universal MCP Control Plane & Fleet/Release Tooling
**Role:** Lead Technical Writer
**Status:** Planning — awaiting owner approval (Rule S1; no doc edits until "Start sprint").

## Objective
Bring the project documentation up to date so it accurately reflects and incorporates the architecture
introduced across three recently completed sprints:

- **sprint-324-00782d** — The **Bit model** & the **universal `bit.*` MCP control plane** (`BaseServer` →
  `Bit`; every Bit speaks MCP; mandatory `bit.*` admin toolset; capability **profiles**; additive
  `profile:` / `mcp.exposure:` fields in `architecture.yaml`; `McpServer` reduced to a compat shim).
- **sprint-325-d7f389** — **Brat as a fleet MCP client**: the new **`brat fleet`** command group that drives
  the `bit.*` plane fleet-wide through the `tool-gateway` fabric, with a `--direct` break-glass path.
- **sprint-326-b8f1a2** — **Integrated version handling**: `architecture.yaml project.version` as the single
  source of truth and the **`brat release`** tool (already largely reflected in `README.md`/`AGENTS.md`).

The documentation must speak the **Bit** vocabulary, retire the obsolete "choose `BaseServer` vs `McpServer`"
guidance, and present the new control plane / fleet / release surfaces coherently across `README.md` and the
`./documentation` tree.

## Scope
**In scope (documentation only):**
- `README.md` (Architecture, Features, Capabilities Matrix, Management CLI / Core Commands, Mermaid diagram,
  Development Primitives, Extending BitBrat).
- `./documentation/**` Markdown: architecture, services, tools, concepts, technical-architecture, getting
  started, guides, roadmaps, and any linked docs that reference the base abstraction, MCP, or the CLI.
- The two design docs' **status headers** and a short "Implemented in sprint-3xx" note to mark them as
  shipped (content already matches reality).
- A documentation index / cross-link pass so new Bit/fleet/release docs are discoverable from `README.md`.

**Out of scope:**
- Any behavioral code change. Source may be **read** only to verify documentation accuracy.
- Any `architecture.yaml` edit (Law #2). Documentation must conform to the canonical file, not change it.
- New product features, new CLI commands, or test-logic changes (beyond doc-validation wiring).
- Rewriting historical sprint artifacts under `planning/` (except this sprint's own files).
- `./deprecated/**` and `./preview/**` (Laws #4/#5) — not used as deliverables.

## Deliverables
1. **Updated `README.md`** — Bit model + universal `bit.*` control plane explained; MCP described as a
   baseline capability of every Bit (not a separate server class); `brat fleet` and `brat release` added to
   the Core Commands; Capabilities Matrix / Architecture diagram aligned; links to the new/updated docs.
2. **New concept doc** — `documentation/concepts/bit-model.md`: reader-facing explanation of the Bit, the
   three rings (Platform / Capability / Business), `profile:` + `mcp.exposure:`, and the `bit:`↔`services:`
   glossary alias (distilled from the architecture design doc, with a link to it).
3. **New control-plane reference** — `documentation/reference/bit-control-plane.md`: the mandatory `bit.*`
   toolset and `bit.llm.*` tools, RBAC scopes (`bit:read` / `bit:operate`), secret redaction, exposure
   model (`platform-only` vs `platform+domain`).
4. **Updated service/base docs** — `documentation/services/mcp-server.md` and
   `documentation/services/base-server-routing.md` finalized to the Bit vocabulary (banner already added in
   sprint-324; complete the body + retire the BaseServer/McpServer decision narrative).
5. **Updated `brat` reference** — `documentation/tools/brat.md`: new `brat fleet` and `brat release` sections;
   note `service bootstrap` now scaffolds a Bit.
6. **New fleet guide** — `documentation/guides/brat-fleet.md` (or a `brat fleet` section): fabric-default vs
   `--direct` break-glass, `--all`/`--confirm`/`--target`/`--json`, RBAC posture.
7. **Roadmap/auto-discovery reconciliation** — update `documentation/mcp-evolution-roadmap.md` and
   `documentation/technical-architecture/mcp-auto-discovery.md` to reflect that registry self-publish now
   happens for **every** Bit (not just `McpServer`).
8. **Capability profiles doc** — short reference for the `EventingProfile` / `ResourcesProfile` /
   `McpClientProfile` / `LlmProfile` composition model and the `profile:` → mixin mapping.
9. **Design-doc status updates** — flip the two `architecture/*-technical-architecture.md` status headers
   from "Draft / pre-sprint" to "Implemented (sprint-324 / sprint-325)".
10. **Validation artifact** — `validate_deliverable.sh` (doc-appropriate: Markdown lint + internal link
    check + structure verification + `release:dry` assertion per AGENTS.md), plus
    `verification-report.md`, `retro.md`, `key-learnings.md`, `publication.yaml`, `request-log.md`.

## Acceptance Criteria
- No documentation references the old "extends `BaseServer` vs extends `McpServer`" **decision** as current
  guidance; the Bit model is the primary vocabulary (historical mentions clearly marked as legacy/compat).
- `README.md` documents: every Bit speaks MCP; the `bit.*` control plane; `brat fleet`; `brat release`; and
  the Capabilities Matrix / diagram reflect the Bit model.
- The mandatory `bit.*` toolset, RBAC scopes, exposure model, and `bit.llm.*` are documented in one
  discoverable reference and linked from `README.md`.
- `brat fleet` and `brat release` are documented in `documentation/tools/brat.md` with accurate flags
  matching the shipped CLI.
- Every documented tool name, flag, field (`profile`, `mcp.exposure`), and command matches the canonical
  `architecture.yaml` and the shipped code (spot-verified by reading source — no invented surface).
- All internal documentation links resolve (link check passes); Markdown lint passes.
- The two design docs are marked "Implemented"; no doc still calls the Bit model "proposed/draft".

## Testing Strategy
This is a documentation/discovery sprint (AGENTS.md §6 note): validation **lints, link-checks, and verifies
structure** instead of building product code.
- **Markdown lint** across changed docs.
- **Internal link check** for `README.md` + `documentation/**` (no broken relative links/anchors).
- **Accuracy spot-checks**: grep the documented `bit.*` tool names, `brat fleet`/`brat release` flags, and
  `profile:`/`mcp.exposure:` against `src/**`, `tools/brat/**`, and `architecture.yaml` to ensure parity.
- **No code tests are modified.** The existing Jest suite is unaffected (docs-only diff); a quick
  `npm run build` may be run only to confirm the docs change introduced no accidental code-path edits.

## Deployment Approach
No runtime deployment. `validate_deliverable.sh` runs the doc lint/link/structure checks and the existing
`npm run release:dry -- patch` assertion (CI-safe, mutates nothing) so the sprint still proves a bump is
mechanically possible before close (AGENTS.md §2.6).

## Dependencies
- Read access to the shipped artifacts (already present): `architecture.yaml`, `src/common/base-server.ts`,
  `src/common/profiles/**`, `tools/brat/src/cli/{fleet,release}.ts`, and the two architecture design docs.
- A Markdown lint + link-check tool available locally (e.g. `markdownlint` / a link-check script). If none is
  installed, the validation script will use a lightweight repo-local link checker and log the tool status.
- Owner approval of this plan + the backlog before any doc edits (Rule S1).
- GitHub credentials for the Publication phase PR (Rules S12/S13).

## Definition of Done
Per the project-wide DoD (AGENTS.md §3), adapted for a documentation deliverable:
- **Content quality:** accurate, consistent Bit vocabulary; no stale BaseServer/McpServer decision guidance;
  no TODO/placeholder text in shipped docs.
- **Traceability:** every change traces to a backlog item (`BL-327-xxx`) and a request ID in
  `request-log.md`; documented surfaces trace to the source sprints / canonical `architecture.yaml`.
- **Validation:** `validate_deliverable.sh` is logically passable (lint + link-check + structure +
  `release:dry`); failures, if any (e.g. missing lint tool), are logged and surfaced in
  `verification-report.md`.
- **Publication:** branch pushed; PR attempted and its URL (or a logged failure + explicit owner acceptance)
  recorded in `publication.yaml` (Rules S12/S13).
- **Close-out:** `verification-report.md`, `retro.md`, and `key-learnings.md` exist; owner says
  "Sprint complete." (Rule S2).

## Execution Shape (phases)
- **Phase P (Plan/Approve):** this document + `backlog.yaml`; owner approval gate.
- **Phase A (Foundational vocabulary):** README Architecture/Features + Bit concept doc + finalize
  service/base docs (retire the old decision).
- **Phase B (Control plane & profiles):** `bit.*` control-plane reference + capability-profiles doc + RBAC
  /exposure; link from README.
- **Phase C (CLI surfaces):** `brat.md` + fleet guide (`brat fleet`) + `brat release` section.
- **Phase D (Reconciliation):** roadmap + auto-discovery updates; flip the two design-doc status headers;
  documentation index / cross-link pass.
- **Phase V (Validate/Verify/Publish):** run doc validation; write verification/retro/learnings; push branch;
  open PR.
