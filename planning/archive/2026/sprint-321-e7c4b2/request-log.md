# Request Log – sprint-321-e7c4b2

Traceability log for every meaningful prompt, interpretation, and shell/git operation in this sprint
(AGENTS.md §2.5 / Capabilities).

---

## REQ-001 — Sprint start + planning artifacts
- **At:** 2026-06-23T19:20:00-05:00
- **Prompt summary:** "We are starting a new sprint. Assume the role of Lead Implementor. Feature: allow an
  MCP server configuration's `envs` and `args` to reference env vars available to the tool-gateway in
  their values (primary use case: avoid storing secrets in Firestore; reference a secret provided by the
  container env). First task: create an Execution Plan and a Prioritized Trackable YAML Backlog."
- **Interpretation:** Begin a new sprint. Produce planning-phase deliverables only — `execution-plan.md`
  and `backlog.yaml` — decomposing the feature into accomplishable, gated, trackable tasks. No
  implementation until the user approves (AGENTS.md §2.4). Field is actually `env`; flag the `envs`
  naming question for confirmation.
- **Discovery / commands executed:**
  - `git branch --show-current` / `git status` — confirmed prior sprint context.
  - Read `planning/sprint-320-1cc8aa/sprint-manifest.yaml`, `execution-plan.md`, `backlog.yaml` —
    confirmed sprint-320 status `complete` (Rule S3 satisfied) and the artifact format to mirror.
  - Inspected `src/common/mcp/types.ts`, `src/common/mcp/client-manager.ts`,
    `src/common/mcp/registry-watcher.ts`, `src/apps/tool-gateway.ts` — located config type, Firestore
    load path, and the `connectServer` consumption point (env/args).
  - Inspected `architecture.yaml` (tool-gateway entry; `${VAR:-default}` usage) and
    `src/services/twitch-oauth.ts#interpolateEnv` — confirmed the established `${VAR}`/`${VAR:-default}`
    interpolation syntax to reuse.
  - `git checkout -b feature/sprint-321-e7c4b2-mcp-config-env-refs` (Rule S11) — branch created.
  - `mkdir -p planning/sprint-321-e7c4b2` — sprint directory created.
- **Files created:**
  - `planning/sprint-321-e7c4b2/sprint-manifest.yaml`
  - `planning/sprint-321-e7c4b2/request-log.md` (this file)
  - `planning/sprint-321-e7c4b2/execution-plan.md`
  - `planning/sprint-321-e7c4b2/backlog.yaml`
- **Status:** Planning deliverables drafted; awaiting user approval before implementation.

---

## REQ-002 — Plan approved + implementation
- **At:** 2026-06-23T19:55:00-05:00
- **Prompt summary:** "Answers to open questions: (1) implement on the canonical `env` field; (2) unresolved
  references => empty-string substitution + a single `mcp.config.env_ref.unresolved` warning listing the
  missing names; (3) resolve before computing `connectionSignature()`. Plan approved — begin implementation,
  keep backlog item statuses up to date."
- **Interpretation:** Approval gate cleared (AGENTS.md §2.4). Implement Phases 0–4 with the three confirmed
  decisions. No `envs` alias — canonical `env` only.
- **Commands / changes executed:**
  - Created `src/common/env-interpolation.ts` (shared `${VAR}` / `${VAR:-default}` resolver with
    referenced/unresolved name metadata; never logs values).
  - Updated `src/common/mcp/client-manager.ts#connectServer`: added `resolveConfig()`; resolve `env`/`args`
    BEFORE `connectionSignature()`; transports built from the resolved view; cached/persisted config stays
    unresolved; added a `connectedSignatures` map so rotation reconnects while benign metadata rewrites do
    not; emit `mcp.config.env_ref.resolved` (info) and `mcp.config.env_ref.unresolved` (warn) — names only;
    clear the signature on disconnect.
  - Added `tests/common/env-interpolation.spec.ts` (10 cases) and `tests/common/mcp/env-refs.spec.ts`
    (7 cases: stdio env/args, SSE headers, literal-unchanged, unresolved→empty+warn, no-secret-in-logs,
    idempotency, rotation).
  - Added `documentation/guides/mcp-config-env-references.md`.
  - Added `planning/sprint-321-e7c4b2/validate_deliverable.sh`.
  - `npm run build` → clean; new suites + reconnect + tool-gateway regression → green
    (env-interpolation 10/10, env-refs 7/7, mcp suite + tool-gateway 54/54). `validate_deliverable.sh` passes.
- **Files modified/created:** see above; backlog.yaml BL-001…BL-008 marked `done`.
- **Status:** Implementation complete and validated; preparing close-out artifacts + PR.

## REQ-003 — Sprint complete (close-out + publication)
- **Timestamp:** 2026-06-23T20:33:00Z
- **Prompt summary:** User: "Sprint complete."
- **Interpretation:** Trigger sprint close-out (AGENTS.md Rule S2 / §2.9): author `retro.md` +
  `key-learnings.md`, commit & push the feature branch, attempt the GitHub PR (Rules S12/S13), record
  the outcome in `publication.yaml`, and finalize the manifest.
- **Commands / changes executed:**
  - Created `retro.md` and `key-learnings.md`.
  - `git add` sprint artifacts + code; `git commit` (with `Co-authored-by: Junie` trailer).
  - `git push -u origin feature/sprint-321-e7c4b2-mcp-config-env-refs` → success (branch on origin).
  - PR attempt #1: `gh` CLI not on PATH and no GITHUB_TOKEN/GH_TOKEN → automated PR creation failed
    (logged in `publication.yaml`). User then installed `gh` (v2.95.0).
  - PR attempt #2: `gh pr create` (authenticated as cnavta, repo scope) → SUCCESS, PR #241:
    https://github.com/cnavta/BitBrat/pull/241 (recorded in `publication.yaml`, status `created`).
  - Manifest status → `complete`; `pr` link set.
- **Status:** Sprint complete. Rule S13 satisfied (PR created). All close-out artifacts present and pushed.
