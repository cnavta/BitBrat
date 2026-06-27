# Request Log – sprint-327-2c45c2

> Per AGENTS.md §2.5, every sprint-relevant prompt and the agent's interpretation + actions are logged here.

## REQ-001 — Sprint kickoff & planning (2026-06-26T21:25)

**Prompt summary:** "We are starting a new sprint. Assume the role of Lead Technical Writer. Update the
documentation to accurately reflect and incorporate the new 'Bit' architecture and MCP control plane
(sprints 324, 325, 326). First task: analyze the changes and the existing documentation (./documentation,
README.md and linked docs) and create an execution plan and a Trackable Prioritized YAML Backlog."

**Interpretation:** Initialize a documentation-only sprint following the AGENTS.md Sprint Protocol. Perform
the Planning phase only — analysis + execution plan + backlog — and stop at the approval gate (Rule S1: no
doc edits until the owner approves and says "Start sprint"). Backlog must follow the attached
`planning/backlog-example.yaml` schema (Trackable Prioritized YAML Backlog).

**Analysis performed (read-only):**
- Reviewed sprint manifests, implementation plans, verification reports, and key-learnings for:
  - sprint-324-00782d (The Bit Model & Universal MCP Control Plane) — BaseServer→Bit; MCP folded into the
    base; mandatory `bit.*` toolset + `bit.llm.*`; capability profiles via `applyProfiles`; additive
    `profile:`/`mcp.exposure:` in architecture.yaml; McpServer reduced to a compat shim; BaseServer alias
    retired.
  - sprint-325-d7f389 (Brat as a Fleet MCP Client / BL-204) — new `brat fleet` command group; fabric default
    + `--direct` break-glass; `--all`/`--confirm`/`--target`/`--json`; Bit-qualified addressing in
    tool-gateway.
  - sprint-326-b8f1a2 (Integrated Version Handling) — architecture.yaml `project.version` single source of
    truth; `brat release` tool (already reflected in README/AGENTS.md).
- Inventoried existing documentation: `README.md` (partially updated for release tooling, still
  BaseServer/McpServer-framed for architecture), `documentation/tools/brat.md` (no fleet/release sections),
  `documentation/services/mcp-server.md` (Bit banner present, body stale), `documentation/services/
  base-server-routing.md`, `documentation/mcp-evolution-roadmap.md` and `documentation/technical-architecture/
  mcp-auto-discovery.md` (pre-Bit; "McpServer publishes registration"), and the two `documentation/
  architecture/*-technical-architecture.md` design docs (status headers still "Draft/pre-sprint").
- Confirmed no active sprint (all `planning/sprint-*/sprint-manifest.yaml` are `status: complete`) — Rule S3
  satisfied.

**Shell/git commands executed:**
- Read-only exploration of `planning/`, `documentation/`, `README.md` (file reads / structure listing).
- `git checkout -b feature/sprint-327-2c45c2-docs-bit-mcp` (Rule S11 — new feature branch at sprint start).
- `mkdir -p planning/sprint-327-2c45c2`.

**Files created (planning artifacts only — no source/doc edits):**
- `planning/sprint-327-2c45c2/sprint-manifest.yaml` (status: planning)
- `planning/sprint-327-2c45c2/implementation-plan.md`
- `planning/sprint-327-2c45c2/backlog.yaml`
- `planning/sprint-327-2c45c2/request-log.md` (this file)

**Status:** Planning phase complete; awaiting owner approval of the plan + backlog before implementation
(Rule S1).

## REQ-002 — Plan approved; implement (2026-06-26T21:35)

**Prompt summary:** "Plan approved. Start sprint. As you implement be sure to keep backlog items up to date
as they change."

**Interpretation:** Approval gate passed (Rule S1). Execute the documentation deliverables on the existing
feature branch, updating `backlog.yaml` statuses/logs as each item progresses (todo → in_progress → done),
then validate, verify, and publish.

**Source verification (read-only, for accuracy):**
- `src/common/base-server.ts` `registerPlatformTools()` — `bit.*` tools + `bit:read`/`bit:operate` scopes,
  `safeConfig` redaction, `mcp.exposure` resolution.
- `src/common/profiles/registry.ts` + profile files — profile names + `PROFILE_REQUIREMENTS`.
- `src/common/profiles/llm-profile.ts` — `bit.llm.*` admin tools.
- `tools/brat/src/cli/fleet.ts` (`FLEET_HELP`) and `release.ts` — exact subcommands/flags.
- `architecture.yaml` — `project.version` (0.7.1), per-Bit `profile:` / `mcp.exposure:`, `glossary.bit`.

**Files created:**
- `documentation/concepts/bit-model.md`, `documentation/concepts/capability-profiles.md`,
  `documentation/reference/bit-control-plane.md`, `documentation/guides/brat-fleet.md`
- `planning/sprint-327-2c45c2/validate_deliverable.sh`, `verification-report.md`, `retro.md`,
  `key-learnings.md`, `publication.yaml`

**Files modified:**
- `README.md`, `documentation/services/mcp-server.md`, `documentation/services/base-server-routing.md`,
  `documentation/tools/brat.md`, `documentation/technical-architecture/mcp-auto-discovery.md`,
  `documentation/mcp-evolution-roadmap.md`,
  `documentation/architecture/bit-model-technical-architecture.md`,
  `documentation/architecture/bl-204-brat-fleet-mcp-client-technical-architecture.md`,
  `planning/sprint-327-2c45c2/{backlog.yaml,sprint-manifest.yaml}`

**Validation:** `bash planning/sprint-327-2c45c2/validate_deliverable.sh` → exit 0 (structure OK; 139
internal links resolve; version 0.7.1 consistent; `release:dry` wrote nothing; markdownlint skipped/logged).

**Commands executed:** read-only `grep`/source reads for parity; `bash planning/sprint-327-2c45c2/validate_deliverable.sh`;
`git add`/`git commit`/`git push`; PR attempt (see `publication.yaml`).

**Status:** All backlog items (BL-327-001..401) done; close-out (BL-327-500) — branch pushed + PR attempted;
awaiting owner "Sprint complete." (Rule S2).
