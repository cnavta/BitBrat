# AGENTS.md — Human–LLM Sprint Protocol v3.1

## 🧱 0. Precedence & Scope

Human and LLM work as accountable partners. Human supplies intent, judgment, approvals, exception acceptance, release authority. LLM produces traceable plans, implementation, validation evidence, reviewable Git history.

### Precedence Order
1. `architecture.yaml` — canonical source of truth
2. `AGENTS.md` — operational and behavioral rules
3. Everything else — examples, legacy docs, supporting materials

**Conflict resolution: `architecture.yaml` wins.** Surface conflict, then align.

---

## 🧠 Partnership, Authority, and Capabilities

### Human Authority

MUST:
- Set or approve sprint intent and scope
- Approve execution plan before implementation
- Decide whether documented exceptions are acceptable
- Declare sprint complete or force-complete
- Make every release decision and execute every real release

### LLM Responsibilities

**ARE allowed**:
- Execute shell commands
- Interact with git (checkout, branch creation, committing, pushing)
- Create and push feature branches
- Create Pull Request only when human explicitly assigns responsibility
- Run non-mutating release dry runs when part of approved validation

**MUST**:
- Record every sprint-relevant Human–LLM turn in `request-log.md`
- Record shell and Git operations when they change state, provide evidence, or fail materially
- Operate only within repository provided
- Halt and request updated credentials if authentication fails
- Report command results transparently
- Preserve human decision points rather than inferring approval

**MUST NOT**:
- Execute real or mutating release command
- Create or push release tags
- Publish package, deployment, or release
- Create or modify PR without explicit human assignment
- Infer approval or release decision
- Implement before human approval
- Absorb unrelated human changes in commits
- Push intermediate commits by default
- Use or depend on `./deprecated` in deliverables
- Violate `architecture.yaml`
- Start sprint without human saying "Start sprint"
- Complete sprint without human declaration
- Proceed with new sprint when active sprint exists
- Begin implementation on default branch or detached HEAD

---

# 🧱 1. Immutable Laws

1. **Treat sprint as Human–LLM partnership.** Ask for human judgment when authority or intent required; proceed autonomously within approved scope when not.
2. **Never violate `architecture.yaml`.** Suggest changes only with justification.
3. **All sprint planning and output artifacts live in `./planning`.**
4. **Never use or depend on `./deprecated` in deliverables.** May read for historical context, MUST NOT import, execute, copy forward, or make deliverables depend on it.
5. **Artifacts in `./preview` are directional only, not implementation-ready.**
6. **Release is always human task.** LLM may prepare evidence, recommend command, perform approved dry run, but MUST NOT perform real release.
7. **This document is executable intent.** Everything must be traceable, reproducible, reversible.

---

# 🌀 2. Human–LLM Sprint Protocol

```
Frame Together → LLM Plans → Human Approves → LLM Implements + Commits
    ↳ Human Follow-Up: Stop → Clarify → Append → Continue
    ↳ Human-Defined PR Path: Human | LLM | Automation, at approved time
    → LLM Validates + Verifies → LLM Produces Retro + Learnings
    → LLM Pushes Completion Handoff → Human Reviews + Completes
    → Human-Defined Release (optional)
```

Human owns intent and consequential decisions. LLM owns faithful execution and evidence within approved scope.

---

## 🧭 2.1 Sprint Control Rules

| Rule | Description |
|------|-------------|
| **S1** | Sprint begins only when human explicitly says **"Start sprint"**. |
| **S2** | Sprint ends only after LLM prepares completion evidence and human says **"Sprint complete"** or **"Force complete sprint"**. Release separate, not required. |
| **S3** | Only one sprint active at a time. |
| **S4** | Human prompts related to repo included in sprint scope unless human specifies otherwise. |
| **S5** | If sprint state unclear, ask once, then proceed with best judgment inside existing authority. Never bypass approval gate or infer release. |
| **S6** | Human approval specific to plan or exception presented. Not blanket approval. |

---

# 🚀 2.2 Sprint Start

LLM MUST:

1. **Verify main branch baseline.** Ensure `main` branch exists (locally or as `origin/main`) with at least one commit. If fails, notify human main must be initialized first.
2. **Check for active sprints.** Verify no `sprint-manifest.yaml` in `planning/` has status other than `complete`. If found, notify human active sprint must be completed or force-closed first (Rule S3).
3. **Generate sprint ID:** `sprint-<number>-<short-hash>`
4. **Create sprint directory:** `planning/sprint-<id>/`
5. **Create git worktree:**
   ```
   git worktree add .worktrees/sprint-<id> -b feature/<sprint-id>-<short-description>
   ```
   Benefits: Isolation, parallel work, clean separation, easy cleanup. Main worktree remains on `main`; sprint work in `.worktrees/sprint-<id>/`.
6. **Change to sprint worktree:** `cd .worktrees/sprint-<id>/`
7. **Create `sprint-manifest.yaml`** in sprint directory with required metadata.
8. **Log action in `request-log.md`**
9. **Verify worktree and branch.** Record `git branch --show-current`, `git status --short --branch`, `pwd`. Implementation MUST NOT begin on default branch or detached HEAD. Current directory should be `.worktrees/sprint-<id>/`.

Worktree creation is initialization requirement, not deferred publication. If worktree cannot be created, keep sprint in `planning`, log blocker, pause implementation.

---

# 🧩 2.3 Sprint Directory Structure

```
planning/
  sprint-7-a13b2f/
    sprint-manifest.yaml
    execution-plan.md
    backlog.yaml
    request-log.md
    validate_deliverable.sh
    verification-report.md
    publication.yaml
    retro.md
    key-learnings.md
```

Single authoritative source of truth. `backlog.yaml` is accountability contract for commitments and current work state. `request-log.md` records Human–LLM interactions, interpretations, decisions, outcomes.

### Sprint Manifest Schema

```yaml
id: sprint-<number>-<short-hash>
title: "Concise sprint title"
goal: "Clear sprint objective"
owner: "@github-handle or name"
createdAt: "YYYY-MM-DDTHH:mm:ssZ"
status: "planning | in-progress | validating | verifying | blocked | ready-for-handoff | complete | cancelled"
completionMode: null # null | normal | forced
blockers: []
links:
  branch: "feature/<sprint-id>-<short-description>"
  pr: null
notes: |
  Key assumptions, constraints, context.
```

## 2.3.1 Backlog Accountability Contract

Every sprint MUST maintain `backlog.yaml` as authoritative contract for commitments and current state. Update as state changes occur, not only during verification or completion.

### Required Backlog Shape

Before creating, read `documentation/reference/backlog-template.md`.

Required fields:
```yaml
meta:
  backlog_id: <sprint-id>-backlog
  updated_at: <ISO-8601>
  status_values: [todo, in-progress, blocked, done, deferred, cancelled]
  approval_values: [not-required, pending, approved]

sprint:
  id: <sprint-id>
  goal: <approved goal>
  status: <current manifest status>
  wip_limit: 1 # optional

items:
  - id: BL-001
    title: <atomic outcome>
    priority: P1 # P0 | P1 | P2 | P3
    status: todo
    approval: approved
    owner: partnership # human | llm | partnership | external
    dependencies: []
    blocked_reason: null
    acceptance: [<observable criterion>]
    evidence: []
    updated_at: <ISO-8601>
    history:
      - at: <ISO-8601>
        from: null
        to: todo
        reason: <why>
        turn_id: <request-log turn ID>
```

### Status Transition Rules

- **Create:** Add as `todo`, normally at end, with acceptance criteria and `approval: pending` when approval required.
- **Start:** Change `todo` to `in-progress`. Must have `approval: approved` or `not-required`, dependencies `done`, WIP limit permits.
- **Block:** Change to `blocked`, populate `blocked_reason` with concrete unmet condition.
- **Unblock:** Change `blocked` to `todo` or `in-progress`, clear `blocked_reason`, state why work can resume.
- **Complete:** Change `in-progress` to `done` only after every acceptance criterion verified. Add stable evidence references.
- **Defer or cancel:** Use `deferred` or `cancelled` only with explicit human direction. Record reason and related turn.
- **Materially revise:** When title, scope, priority, owner, dependencies, or acceptance criteria change, update timestamp and append history even if status unchanged.

Every transition or material revision MUST update `item.updated_at` and `meta.updated_at`, append `history` entry, link responsible `request-log.md` turn through `turn_id`.

## 2.3.2 Sprint Index

**Sprint index** (`planning/sprint-index.yaml`) is derived, regenerable cache of sprint metadata from individual manifests.

### Principles

- **Single Source of Truth**: Sprint manifests authoritative
- **Derived Cache**: Computed from manifests, never manually edited
- **Regenerable**: Rebuild from manifests anytime without data loss
- **Atomic Updates**: Manifest updated first, then index
- **Non-Fatal Failures**: Index update failures logged but don't block operations

### Automatic Updates

Updated by MCP tools:
- `start-sprint` adds new entry
- `update-sprint-status` atomically updates manifest and index
- `regenerate-sprint-index` rebuilds entire index

### Manual Regeneration

Via MCP: `regenerate-sprint-index`
Via npm: `npm run sprint:index:regenerate`

Scans all manifests in `planning/`, extracts metadata, rebuilds index with complete sprint list, statistics, validation.

### Recovery

Index always regenerable from manifests. Universal recovery: regenerate.

### Index Schema

```yaml
version: "1.0"
generatedAt: "2026-07-31T12:00:00Z"
totalSprints: 5
activeSprints: 1
completedSprints: 4

sprints:
  - id: sprint-1-abc123
    title: "Sprint title"
    status: complete | in-progress | planning | ...
    owner: "Owner name"
    createdAt: "2026-07-30T12:00:00Z"
    startedAt: "2026-07-30T14:00:00Z"
    completedAt: "2026-07-30T20:00:00Z"
    completionMode: normal | forced
    manifestPath: "planning/sprint-1-abc123/sprint-manifest.yaml"
    branch: "feature/sprint-1-abc123-title"
    pr: "https://github.com/owner/repo/pull/123"
    worktreePath: ".worktrees/sprint-1-abc123"

statistics:
  byStatus: {...}
  byCompletionMode: {...}
  averageSprintDuration: "PT6H45M"
```

File includes DO NOT EDIT header: derived cache, regenerable, automatically updated by MCP tools.

---

# 📝 2.4 Planning Phase — *Coding Forbidden Until Approved*

Before ANY implementation:

- LLM generates `execution-plan.md` and `backlog.yaml`
- LLM ensures every deliverable maps to backlog items with observable acceptance criteria
- Human reviews and explicitly approves
- LLM records approval in `request-log.md`

### Required Execution Plan Contents

Before creating, read `documentation/reference/execution-plan-template.md`.

Must include:
- Objective (clear human-approved goal)
- Scope (in/out)
- Deliverables (code, tests, deployment/CI, docs)
- Acceptance Criteria (verifiable, observable)
- Testing Strategy
- Deployment Approach (referencing architecture.yaml)
- Completion Handoff and PR Policy (branch-push behavior, PR ownership, timing)
- Release Decision (optional, human-defined, references policy)
- Dependencies
- Definition of Done (reference project-wide DoD unless overridden)

## 2.4.1 Amending an Active Sprint (Handling Rule S4)

When human provides follow-up tasks or scope changes:

1. **Identify Scope Change:** Determine if adds deliverables or alters approved goal, explain impact.
2. **Update Execution Plan:** Add new tasks to `execution-plan.md`.
3. **Update Backlog:** Add or revise items, acceptance criteria, approval state, transition history.
4. **Update Manifest:** If goal evolved significantly, update `goal` or `title`.
5. **Log Request:** Document turn and interpretation in `request-log.md`.
6. **Approval Gate:** If change substantial, MUST pause and request human approval before proceeding.
7. **Maintain Branch Integrity:** Perform amended work on existing feature branch (Rule S11).

---

# ⚙️ 2.5 Execution Phase

Every sprint-relevant Human–LLM turn MUST be recorded in `request-log.md`. Each turn captures:
- Timestamp
- Human intent or request summary
- LLM interpretation and response summary
- Decisions, questions, approvals, exceptions
- Resulting backlog, scope, or sprint-state changes
- Links to request IDs, backlog items, commits, files, validation evidence

Record shell and Git operations when they:
- Change repository or external state
- Produce validation, verification, publication, or release-assistance evidence
- Fail materially or affect sprint decision

Group related commands. Prefer outcomes and affected files over raw output. Routine read-only discovery may be summarized or omitted. Never record secrets.

LLM implements only approved scope. Before starting, blocking, unblocking, completing, deferring, cancelling, or materially revising item, MUST update backlog state per §2.3.1.

## 2.5.1 Intentional Commit Protocol

Feature branch is shared, reviewable narrative. LLM MUST commit regularly after coherent work units, not accumulate entire sprint into one commit.

Before every commit, MUST:
1. Inspect `git status` and staged diff.
2. Stage only approved sprint files; never absorb unrelated human changes.
3. Run validation appropriate to work unit, or state why deferred.
4. Log staged scope, validation result, commit command in `request-log.md`.

Coherent work unit: independently explainable change (one behavior + tests, one schema migration, one documentation policy). Don't commit solely because time elapsed. Don't knowingly commit broken states unless explicitly approved diagnostic checkpoint.

Commit message shape:
```text
sprint(<sprint-id>): <imperative intent>

Intent: <why this change exists and behavior it establishes>
Requests: <REQ-IDs>
Validation: <checks run and concise result>
```

Keep semantically focused. Avoid vague subjects.

MUST NOT push intermediate sprint commits by default. Push branch when approved work complete, validated, verified, prepared for human review per §2.8. Human may explicitly request earlier backup or collaboration push.

## 2.5.2 Human Follow-Up Loop

After any LLM delivery turn, human may add follow-up work:

```
Stop → Clarify → Append → Continue
```

1. **Stop:** Pause progression. Don't start follow-up or silently change priorities.
2. **Clarify:** Ask only questions required to make follow-up actionable or resolve material ambiguity. If none needed, proceed to Append.
3. **Append:** Log in `request-log.md`, add atomic backlog item using §2.3.1 contract. Place at end unless human specifies position, priority, or dependency. Preserve order of multiple follow-ups. Don't reorder existing items without human direction.
4. **Continue:** Apply active-sprint amendment and approval rules §2.4.1. After required answers and approvals recorded, select next ready backlog item in declared order, state which resuming, continue execution.

Appending follow-up doesn't imply it runs next. Existing ready items retain order unless human explicitly reprioritizes. Follow-up substantially changing scope remains behind approval gate.

---

# 🧪 2.6 Validation Phase — *Mandatory Real Build + Test*

Every sprint MUST include **real, executable** `validate_deliverable.sh` script.

Script MUST:
1. Install dependencies
2. Build project
3. Run test suite
4. Start local runtime (if applicable)
5. Perform health checks
6. Shut down local runtime
7. Run deployment dry-run (if defined)

Use stack-appropriate commands. Example for Node/TypeScript:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Installing dependencies..."
npm ci

echo "🧱 Building project..."
npm run build   # MUST succeed

echo "🧪 Running tests..."
npm test        # MUST pass

echo "🏃 Starting local environment..."
npm run local || true

echo "📝 Healthcheck..."
# Script/test/endpoint-based check recommended

echo "🧹 Stopping local environment..."
npm run local:down || true

echo "🚀 Cloud dry-run deployment..."
npm run deploy:cloud -- --dry-run || true

echo "✅ Validation complete."
```

**Critical:** Sprint not ready to close unless `validate_deliverable.sh` logically passable (all commands exist and intended to succeed) and aligned with project-wide DoD. If cannot succeed due to environment issues, log failure, include in `verification-report.md`; closure requires explicit human acceptance.

---

# 🔍 2.7 Verification Phase

`verification-report.md` must summarize:
- Completed items
- Partial implementations
- Deferred items
- Deviations from execution plan
- Reconciliation against every `backlog.yaml` item and current status

Before verification completes, MUST confirm:
- Every `done` item has acceptance evidence
- Every `blocked` item has current blocker
- Every `deferred` or `cancelled` item links to explicit human direction

Differences between backlog and implementation are verification failures until corrected or accepted by human.

---

# 🔀 2.8 Completion Handoff — *Push Required, PR Optional*

Completion handoff transfers validated sprint work from LLM to human. Occurs after approved implementation, validation, verification, sprint learning artifacts complete.

### LLM MUST:

1. Confirm branch contains only approved sprint changes.
2. Update sprint artifacts with final evidence.
3. Create final intent-focused commit if completion artifacts changed after last coherent commit.
4. Push feature branch. Default first push unless human approved other cadence.
5. Give human: branch, head commit, validation result, known exceptions, concise completion recommendation.

Pushing means LLM considers approved sprint work ready for human review. Does not mark sprint `complete`; only human can.

### Pull Request Policy

Sprint Protocol does not require PR. PR never implicit completion gate. Human defines whether PR desired, who creates, when. Policy may be in `architecture.yaml`, approved `execution-plan.md`, or explicit turn.

- PR ownership: human, LLM, automation, or other human-designated actor.
- LLM MUST NOT create or modify PR unless human explicitly assigns responsibility.
- Human-defined sprint may include PR in acceptance criteria, but protocol doesn't impose one.
- When PR exists, record owner, status, URL without treating creation as release authority.

If authorized push or PR action fails, stop action, record material failure, ask human for missing access or decision. Don't treat optional PR failure as protocol-level completion failure unless human made PR part of approved sprint criteria.

### Completion Handoff Rules

| Rule | Description |
|------|-------------|
| **S11** | New feature branch MUST be created and verified at sprint initialization and used for all sprint changes. |
| **S12** | When sprint work complete, LLM MUST push feature branch and record result unless human explicitly accepts push exception. |
| **S13** | Sprint cannot close until either (a) completion branch pushed, or (b) failed or omitted push recorded and explicitly accepted by human. |
| **S14** | PR and release decisions human-defined and independent from protocol's branch-push handoff. |

`publication.yaml` should contain:

```yaml
branch: feature/sprint-X-Y-...
headCommit: <commit-sha>
pushStatus: "pending | succeeded | failed | waived"
pr:
  desired: false
  owner: null # human | llm | automation | other
  timing: null
  status: "not-planned | planned | created | failed | waived"
  url: null
```

### Human-Defined Release (optional, separate from sprint completion)

Human decides whether release occurs and defines timing, criteria, approvals, versioning, execution mechanism. Release policy may live in `architecture.yaml`, other human-approved project document, or sprint's `execution-plan.md`.

- Release optional, never required to complete sprint unless human explicitly adds to approved sprint criteria.
- Human executes release if decides to proceed.
- LLM may prepare evidence, release notes, risk analysis, non-mutating checks when explicitly approved.
- LLM MUST NOT execute mutating release command, create or push release tags, publish packages, or claim release occurred without human-provided evidence.
- Protocol doesn't prescribe release tool, command, versioning scheme, or deployment workflow.

---

# 🏁 2.9 Sprint Completion

Before asking human to complete sprint, LLM MUST present completion packet:
- Validation and verification results
- Completed, partial, deferred, deviated scope
- Pushed branch and head commit, or exact handoff failure
- PR status only when human-defined PR policy makes it relevant
- `retro.md` and `key-learnings.md`
- Recommendation to complete or force-complete, with exceptions called out explicitly

Sprint officially completes only when:
- `validate_deliverable.sh` logically passable, or current failures documented and explicitly accepted by human
- Branch pushed and recorded in `publication.yaml`, or failed or omitted push logged and explicitly accepted by human
- `verification-report.md`, `retro.md`, `key-learnings.md` exist
- Human says `Sprint complete` or `Force complete sprint`

After human's declaration, LLM records it, changes manifest status to `complete`, reports final state. Does not perform release.

- Use `completionMode: normal` when human says `Sprint complete`.
- Use `completionMode: forced` when human says `Force complete sprint`.
- Use `status: blocked` with explicit blockers when progress cannot continue.
- Use `status: cancelled` only when human explicitly cancels sprint.

## Worktree Cleanup

After sprint completion (normal or forced) and after PR merged (if applicable), remove sprint worktree:

```bash
cd /path/to/repo  # Return to main worktree
git worktree remove .worktrees/sprint-<id>
```

**Timing**: Remove worktree:
- After PR merge (if sprint resulted in merged PR)
- After force completion (if force-completed without PR)
- After cancellation (if sprint cancelled)

**Error handling**: If worktree has uncommitted changes:
```bash
git worktree list  # Check status first
git worktree remove .worktrees/sprint-<id> --force  # Use --force only after human confirms
```

Document cleanup action in sprint's `request-log.md` before removal.

Sprint directory `planning/sprint-<id>/` remains as permanent record. Only `.worktrees/sprint-<id>/` working directory removed.

## 2.9.1 Learning Artifacts for Future Extraction

Retrospective artifacts are human-readable records and future inputs to semantic compaction or structured extraction. Write for reuse outside immediate conversation.

### Shared Rules

- Use stable headings and IDs; never rely on document position as identity.
- Keep observations and learnings atomic: one claim, decision, or lesson per record.
- Link claims to concrete request IDs, commits, validation output, file paths when available.
- Separate observed facts from interpretation and recommendation.
- Use explicit nouns rather than context-dependent pronouns.
- Preserve disagreements or uncertainty instead of manufacturing consensus.
- Use lowercase kebab-case tags and confidence values `low`, `medium`, `high`.
- Exclude secrets, credentials, personal data, unnecessary transcript detail.
- Prefer concise repetition of essential context over references requiring conversation reconstruction.

### Required `retro.md` Structure

Before creating, read `documentation/reference/retro-template.md`.

Must include:
- Outcome Summary
- Observations (OBS-001 format: Type, Evidence, Observation, Interpretation, Impact)
- Partnership Review (PART-001 format: Human contribution, LLM contribution, Handoff quality, Improvement)
- Follow-up Candidates (FOLLOW-001 format: Rationale, Suggested owner, Priority, Related evidence)

### Required `key-learnings.md` Structure

Before creating, read `documentation/reference/key-learnings-template.md`.

Must include:
- Learning Records (LEARN-001 format: Statement, Kind, Derived from, Applies when, Does not apply when, Recommended action, Confidence, Tags, Supersedes)

Don't copy entire retrospective. Promote only lessons likely to change future decision or action. If no durable lesson exists, say so explicitly.

---

### 2.10 Force Completion Override

If human says `Force complete sprint`, LLM may close sprint even if:
- `validate_deliverable.sh` would fail
- Tests incomplete or failing
- Completion branch could not be pushed

…as long as:
1. All known failures and gaps documented under **Partial** or **Deferred** in `verification-report.md`.
2. Issues recorded as atomic observations in `retro.md` and, when reusable, as learning records in `key-learnings.md`.
3. Any failed or omitted push recorded in `publication.yaml` and `request-log.md`.

Force completion never authorizes release.

---

# 🧮 3. Project-Wide Definition of Done (DoD)

Deliverable "Done" only if:

### ✅ Code Quality
- Adheres to project and architecture.yaml constraints
- No TODOs or placeholder logic in production paths
- Stubs allowed only in non-production paths or behind feature flags

### ✅ Testing
- Tests for all new behavior (Jest for Node/TypeScript; stack-appropriate frameworks for other stacks)
- Mocks for external dependencies
- `npm test` must pass
- Test deferral requires explicit human approval

### ✅ Deployment Artifacts
If applicable: Dockerfile, Cloud Build YAML, Cloud Run configs, IaC. Must integrate with `validate_deliverable.sh`.

### ✅ Documentation
- Rationale, trade-offs, notes
- LLM hints (`llm_prompt`) where beneficial

### ✅ Traceability
All code changes trace to: sprint, request ID in `request-log.md`, one or more intent-focused commits.

Human may explicitly accept missing or failing tests; gaps MUST be listed under **Deferred** in `verification-report.md` and recorded as evidence-backed observations in `retro.md`.

---

# 🧪 4. Testing Standards

- Tests required
- Node/TypeScript: Jest; other stacks: language-appropriate frameworks (pytest, go test)
- Tests live beside code or in `__tests__/`
- High coverage encouraged
- External services mocked
- Tests run as part of validation

---

# 📦 5. Deliverable Types

Every sprint must produce at least one:
- Code artifact
- Tests
- Deployment scripts
- Architecture documentation

All outputs must: build, test, integrate with validation pipeline.

Planning/Discovery sprints may produce documentation-only deliverables; validation should lint, link-check, verify structure instead of building code.

---

# 🧱 6. Project Structure

```
deprecated/      # Historical reference only
examples/        # Useful templates
planning/        # Sprint artifacts (authoritative)
preview/         # Visionary, non-binding artifacts
infrastructure/  # IaC, Cloud Build, Terraform
src/
  apps/          # Service entrypoints
  common/        # Shared utilities
  config/        # Configuration
  services/      # Core microservices
  types/         # Shared types
```

---

# 🎯 7. Code Style Rules

- Application/services code TypeScript by default. If service specifies different stack, follow that. Scripts and infrastructure files remain in native formats.
- kebab-case filenames
- PascalCase classes and interfaces
- camelCase functions and variables
- UPPER_SNAKE_CASE constants

**Logging:**
- Log through logging facade if possible
- `info` for useful info
- `error` for errors
- `debug` for deep insight
- Log all network + filesystem operations with context

---

# 🧯 8. Error Handling & Events

- Strong try/catch discipline
- Graceful shutdown of services
- Validate environment variables
- Use Pub/Sub for service communication
- Normalize external events to internal schema

---

# 👥 9. Collaboration Roles

Responsibility domains, not rigid job titles. Human or LLM may contribute in several, subject to authority boundaries in §Partnership, Authority, and Capabilities.

- **Human Sponsor**: Frames outcomes and constraints. Approves plans, scope changes, exceptions, completion, releases. Contributes contextual judgment.
- **LLM Implementor**: Produces execution plans and backlogs. Implements approved work, maintains traceability. Creates coherent commits, validation evidence, completion handoff.
- **Architecture Partner**: Analyzes cloud and platform design without silently overriding `architecture.yaml`. Surfaces trade-offs, returns consequential architecture decisions to human.
- **Quality Partner**: Defines and evaluates acceptance criteria. Distinguishes verified facts, accepted exceptions, unresolved risk.
- **Learning Partner**: Converts sprint evidence into atomic retrospective observations and reusable learnings. Preserves uncertainty, applicability boundaries, provenance for future extraction.

---

# 🧠 10. Sprint Lifecycle Summary

```
Frame Together → LLM Plan → Human Approve → LLM Implement + Commit
    ↳ Human-Defined PR Path: Human | LLM | Automation, at approved time
    → Validate + Verify → Retro + Learn → Push Handoff
    → Human Complete → Human-Defined Release (optional)
```

System designed for: high traceability, rigor, iterative improvement, explicit human authority, effective Human–LLM handoffs, extraction-ready organizational learning.

---

# End of AGENTS.md