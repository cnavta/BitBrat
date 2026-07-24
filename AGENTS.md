# AGENTS.md — Human–LLM Sprint Protocol v3.0

## 🧱 0. Precedence & Scope

These rules define an accountable Human–LLM partnership: the human owns intent and consequential decisions; the LLM owns traceable execution within approved scope.

### **Precedence Order**
1. `architecture.yaml` — canonical source of truth for system behavior
2. `AGENTS.md` — operational and behavioral rules for agents
3. Everything else — examples, legacy docs, and supporting materials

If rules conflict, surface the conflict and align to `architecture.yaml`.

---

## 🧠 Partnership, Authority, and Capabilities

The human exclusively approves sprint intent, plans, substantial scope changes, exceptions, completion, PR policy, and release policy. The human executes any release and may explicitly assign PR creation or separately governed deployment work.

Within approved scope, the LLM may use shell and Git, create branches and commits, push the completion branch, and run approved non-mutating checks. The LLM MUST record sprint-relevant turns and material operation evidence, report outcomes, preserve human decision points, and stop on authentication failure.

The LLM MUST NOT infer approval, create or modify a PR without assignment, execute a mutating release, create or push release tags, or claim a release occurred without human evidence.

---

# 🧱 1. Immutable Laws

1. **Never violate `architecture.yaml`.** Suggest changes only with justification.
2. **All sprint planning and output artifacts live in `./planning`.**
3. **Never use or depend on `./deprecated` in deliverables.** Historical reading is allowed; importing, executing, or copying it into deliverables is not.
4. **Treat `./preview` as directional, not implementation-ready.**
5. **Keep work:**
   - Traceable
   - Reproducible
   - Reversible

---

# 🌀 2. Human–LLM Sprint Protocol

This protocol governs every sprint carried out through a Human–LLM partnership.

```
Frame Together → LLM Plans → Human Approves → LLM Implements + Commits
    ↳ Human Follow-Up: Stop → Clarify → Append → Continue
    ↳ Human-Defined PR Path: Human | LLM | Automation, at the approved time
    → LLM Validates + Verifies → LLM Produces Retro + Learnings
    → LLM Pushes Completion Handoff → Human Reviews + Completes
    → Human-Defined Release (optional)
```

The human owns intent and consequential decisions. The LLM owns faithful execution and evidence within the approved scope. The shared artifacts make the partnership reproducible, reviewable, reversible, and capable of improving over time.

---

## 🧭 2.1 Sprint Control Rules

| Rule | Description |
|------|-------------|
| **S1** | A sprint begins only when the human explicitly says **“Start sprint”**. |
| **S2** | A sprint ends only after the LLM has prepared completion evidence and the human says **“Sprint complete.”** Alternatively, the human may say **“Force complete sprint.”** A release is separate and is not required to complete a sprint. |
| **S3** | Only one sprint may be active at a time. |
| **S4** | Human prompts related to this repo are included in sprint scope unless the human specifies otherwise. |
| **S5** | If sprint state is unclear, ask once, then proceed with best judgment inside existing authority. Never bypass a human approval gate or infer a release decision. |
| **S6** | Human approval is specific to the plan or exception presented. It is not blanket approval for later scope, release, or destructive actions. |

---

# 🚀 2.2 Sprint Start

When a sprint starts, the LLM MUST:

1. **Check for active sprints.** Verify no `sprint-manifest.yaml` in `planning/` has a status other than `complete`. If an active sprint is found, do not proceed with a new sprint; notify the human that the active sprint must be completed or force-closed first (Rule S3).
2. **Generate a sprint ID**
   ```
   sprint-<number>-<short-hash>
   ```
3. **Create the sprint directory**
   ```
   planning/sprint-<id>/
   ```
4. **Create a new feature branch**
   ```
   git checkout -b feature/<sprint-id>-<short-description>
   ```
5. **Create `sprint-manifest.yaml`** with required metadata (see schema below)
6. **Log the action in `request-log.md`**
7. **Verify the branch before planning continues.** Record `git branch --show-current` and `git status --short --branch` results. Implementation MUST NOT begin on the default branch or in a detached HEAD state.

Branch creation is an initialization requirement, not deferred publication work. If the working tree is dirty, preserve unrelated human changes, disclose the state, and stage only files within the approved sprint scope. If the branch cannot be created, keep the sprint in `planning`, log the blocker, and pause implementation.

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

This directory is the sprint's authoritative record.

---

## Sprint Manifest Schema

Before creating or updating a manifest, read `documentation/reference/sprint-manifest-example.yaml`. Required fields are `id`, `title`, `goal`, `owner`, `createdAt`, `status`, `completionMode`, `blockers`, `links.branch`, optional `links.pr`, and `notes`.

Allowed lifecycle states are `planning`, `in-progress`, `validating`, `verifying`, `blocked`, `ready-for-handoff`, `complete`, and `cancelled`. Completion mode is `null`, `normal`, or `forced`.

## 2.3.1 Backlog Accountability Contract

`backlog.yaml` is the authoritative commitment and current-state contract; `request-log.md` records Human–LLM interactions and rationale. Update backlog state during execution. History contains concise transitions and evidence links, never duplicate conversation narratives.

### Required backlog shape

Before creating or updating a backlog, read `documentation/reference/backlog-example.yaml`. Required top-level groups are `meta`, `sprint`, and `items`. Each item requires identity, priority, status, approval, owner, dependencies, blocker state, acceptance criteria, evidence, timestamp, and transition history linked to a request-log turn.

Allowed item statuses are `todo`, `in-progress`, `blocked`, `done`, `deferred`, and `cancelled`; approval values are `not-required`, `pending`, and `approved`.

Fields may be extended for project needs, but their meanings MUST NOT be redefined. `priority`, `owner`, and `wip_limit` guide execution; they do not override human approval, dependencies, or acceptance criteria.

### Status transition rules

| Event | Transition | Requirement |
|---|---|---|
| Create | `null → todo` | Acceptance defined; approval pending when required; append by default. |
| Start | `todo → in-progress` | Approved/not-required; dependencies done; WIP available. |
| Block | active → `blocked` | Set concrete `blocked_reason` immediately. |
| Unblock | `blocked → todo/in-progress` | Clear reason and record why work can resume. |
| Complete | `in-progress → done` | Verify all acceptance criteria and add stable evidence. |
| Defer/cancel | active → terminal | Explicit human direction and linked turn required. |
| Revise | status may remain | Record material scope, priority, owner, dependency, or acceptance changes. |

Every row updates item and backlog timestamps and appends history with `turn_id`.

---

# 📝 2.4 Planning Phase — *Coding Forbidden Until Approved*

Before ANY implementation begins, the LLM prepares the plan and the human exercises the approval gate:

- The LLM generates `execution-plan.md` and `backlog.yaml`
- The LLM ensures every planned deliverable maps to one or more backlog items with observable acceptance criteria
- The human reviews and explicitly approves them
- The LLM records the approval in `request-log.md`

Before planning, read `documentation/reference/execution-plan-template.md`. The plan MUST cover objective, scope, deliverables, observable acceptance criteria, testing and validation, deployment, completion handoff and PR policy, release decision, dependencies, and Definition of Done.

## 2.4.1 Amending an Active Sprint (Handling Rule S4)

If the human provides follow-up tasks or scope changes while a sprint is active:

1. **Identify Scope Change:** The LLM determines whether the request adds deliverables or alters the approved goal and explains the impact.
2. **Update Execution Plan:** Add the new tasks to `execution-plan.md`.
3. **Update Backlog:** Add or revise accountable backlog items, acceptance criteria, approval state, and transition history.
4. **Update Manifest:** If the goal has evolved significantly, update the `goal` or `title` in `sprint-manifest.yaml`.
5. **Log Request:** Document the Human–LLM turn and its interpretation in `request-log.md`.
6. **Approval Gate:** If the change is substantial, the LLM MUST pause and request human approval for the amended plan before proceeding.
7. **Maintain Branch Integrity:** Perform all amended work on the existing feature branch (§2.2).

---

# ⚙️ 2.5 Execution Phase

Every sprint-relevant Human–LLM turn MUST be recorded in `request-log.md`. Each turn record should capture:

- Timestamp
- Human intent or request summary
- LLM interpretation and response summary
- Decisions, questions, approvals, or exceptions
- Resulting backlog, scope, or sprint-state changes
- Links to relevant request IDs, backlog items, commits, files, or validation evidence

Commands are supporting evidence, not the primary record. Record shell and Git operations when they:

- Change repository or external state
- Produce validation, verification, publication, or release-assistance evidence
- Fail materially or affect a sprint decision

Group related commands into one concise entry when practical. Prefer outcomes and affected files over raw terminal output. Routine read-only discovery, navigation, and repeated diagnostic checks may be summarized or omitted. Never record secrets or credentials.

Optional:
`code-summary.md` mapping files → request IDs.

The LLM implements only approved scope. When judgment materially affects behavior, trade-offs, or scope, it records the choice and either ties it to existing approval or returns the decision to the human.

Before starting, blocking, unblocking, completing, deferring, cancelling, or materially revising an item, the LLM MUST update its backlog state under §2.3.1. Status changes are part of execution, not end-of-sprint bookkeeping.

## 2.5.1 Intentional Commit Protocol

The feature branch is a shared, reviewable narrative for both humans and future LLMs. The LLM MUST commit regularly after coherent work units rather than accumulating the entire sprint into one opaque commit.

Before every commit, the LLM MUST:

1. Inspect `git status` and the staged diff.
2. Stage only approved sprint files; never absorb unrelated human changes.
3. Run the validation appropriate to that work unit, or state why validation is deferred.
4. Log the staged scope, validation result, and commit command in `request-log.md`.

A coherent work unit is an independently explainable change such as one behavior plus tests, one schema migration, or one documentation policy revision. Do not create commits solely because time elapsed, and do not knowingly commit broken intermediate states unless the commit is an explicitly approved diagnostic checkpoint.

Commit messages MUST be optimized for human review and future LLM retrieval: describe intent, not merely filenames or mechanics. Use this shape:

```text
sprint(<sprint-id>): <imperative intent>

Intent: <why this change exists and the behavior it establishes>
Requests: <REQ-IDs>
Validation: <checks run and concise result>
```

Additional context or trade-offs may follow. Keep each commit semantically focused. Avoid vague subjects such as `updates`, `fix stuff`, or `LLM changes`.

The LLM MUST NOT push intermediate sprint commits by default. It pushes the branch when the approved work is complete, validated, verified, and prepared for human review under §2.8. A human may explicitly request an earlier backup or collaboration push.

## 2.5.2 Human Follow-Up Loop

After any LLM delivery turn, including the first turn that delivers backlog items, the human may add follow-up work. Use this compact protocol:

```text
Stop → Clarify → Append → Continue
```

1. **Stop:** Pause progression toward the next backlog item or sprint completion. Do not start the follow-up or silently change priorities.
2. **Clarify:** Ask only questions required to make the follow-up actionable or resolve a material ambiguity. If no question is necessary, proceed directly to Append.
3. **Append:** Log the interaction in `request-log.md` and add an atomic backlog item using the contract in §2.3.1. Place it at the end of `items` unless the human specifies another position, priority, or dependency. Preserve the order of multiple follow-ups as received. Do not reorder existing items without human direction.
4. **Continue:** Apply the active-sprint amendment and approval rules in §2.4.1. After required answers and approvals are recorded, select the next ready backlog item in declared order, state which item is resuming, and continue execution.

Appending a follow-up does not imply that it runs next. Existing ready items retain their order unless the human explicitly reprioritizes them. A follow-up that substantially changes scope remains behind the human approval gate even when its desired behavior is otherwise clear.

---

# 🧪 2.6 Validation and Definition of Done

Every sprint MUST include a real, executable `validate_deliverable.sh`. Before writing it, read `documentation/reference/validate-deliverable-example.sh` and classify each planned check as:

- **Required:** must run and pass; never mask failure with unconditional success handling.
- **Applicable:** becomes required when its referenced deliverable or environment is present.
- **Not applicable:** omit the command and record the approved rationale in the plan.

All sprints validate artifact structure, backlog acceptance evidence, traceability, and applicable quality rules. Code or runtime work normally validates dependency installation, build, tests, integration/runtime health, and deployment dry runs. Documentation, research, and planning work instead validates applicable schemas, links, structure, and content assertions; it need not invent a build or runtime.

A deliverable is done only when:

- It satisfies every applicable architecture and approved-plan constraint.
- Its backlog acceptance criteria have stable evidence.
- Required checks pass using the project-appropriate toolchain.
- New behavior has appropriate tests; external services are mocked where practical.
- Production paths contain no placeholder logic or unresolved TODOs.
- Applicable deployment and documentation artifacts are integrated and validated.
- Changes trace to the sprint, request-log turns, backlog items, and intent-focused commits.

Any unavailable or failing required check is recorded in `verification-report.md` and the retrospective. Closure then requires explicit human acceptance; force completion follows §2.10. Every sprint must produce at least one accountable artifact, including code, tests, infrastructure, documentation, research, or design.

---

# 🔍 2.7 Verification Phase

`verification-report.md` must summarize:

- Completed items
- Partial implementations
- Deferred items
- Deviations from the execution plan
- Reconciliation against every `backlog.yaml` item and its current status

Before verification completes, the LLM MUST confirm that every `done` item has acceptance evidence, every `blocked` item has a current blocker, and every `deferred` or `cancelled` item links to explicit human direction. Differences between the backlog and implementation are verification failures until corrected or accepted by the human.

Before verification, read `documentation/reference/verification-report-template.md`.

---

# 🔀 2.8 Completion Handoff — *Push Required, PR Optional*

The completion handoff transfers validated sprint work from the LLM to the human. It occurs after approved implementation, validation, verification, and the sprint learning artifacts are complete.

### The LLM MUST:

1. Confirm the branch contains only approved sprint changes.
2. Update the sprint artifacts with final evidence.
3. Create a final intent-focused commit if completion artifacts changed after the last coherent commit.
4. Push the feature branch. This is the default first push unless the human approved another cadence.
5. Give the human the branch, head commit, validation result, known exceptions, and a concise completion recommendation.

Pushing means the LLM considers the approved sprint work ready for human review. It does not mark the sprint `complete`; only the human can do that.

### Pull Request Policy

Under §Authority, a PR is optional and never an implicit completion gate. Record the human-defined desire, owner, timing, status, and URL in the plan and `publication.yaml`. An authorized PR failure blocks completion only when the approved criteria require that PR.

The LLM MUST push and record the completion branch unless the human explicitly accepts a failed or omitted push. Stop an authorized push or PR action on access failure, record it, and ask for the missing access or decision.

Before recording the handoff, read `documentation/reference/publication-example.yaml`. The record MUST include branch, head commit, push status, and optional human-defined PR state.

### Human-Defined Release (optional and separate from sprint completion)

Under §Authority, the human defines and executes any release. Policy may live in `architecture.yaml`, another approved project document, or the plan. Release is optional and separate from sprint completion unless the human adds it to approved criteria. The LLM may prepare evidence, notes, analysis, or approved non-mutating checks; this protocol prescribes no release tool or workflow.

---

# 🏁 2.9 Sprint Completion

Before asking the human to complete the sprint, the LLM MUST present a completion packet containing:

- Validation and verification results
- Completed, partial, deferred, and deviated scope
- The pushed branch and head commit, or the exact handoff failure
- PR status only when the human-defined PR policy makes it relevant
- `retro.md` and `key-learnings.md`
- A recommendation to complete or force-complete, with exceptions called out explicitly

A sprint officially completes only when:

- `validate_deliverable.sh` is logically passable, or current failures are documented and explicitly accepted by the human
- The branch was pushed and recorded in `publication.yaml`, or the failed or omitted push was logged and explicitly accepted by the human
- `verification-report.md`, `retro.md`, and `key-learnings.md` exist
- The human says `Sprint complete` or `Force complete sprint`

After the human's declaration, the LLM records it, changes the manifest status to `complete`, and reports the final state. It does not perform a release.

- Use `completionMode: normal` when the human says `Sprint complete`.
- Use `completionMode: forced` when the human says `Force complete sprint`.
- Use `status: blocked` with explicit blockers when progress cannot continue.
- Use `status: cancelled` only when the human explicitly cancels the sprint.

## 2.9.1 Learning Artifacts for Future Extraction

The retrospective artifacts are both human-readable records and future inputs to semantic compaction or structured extraction. Write them for reuse outside the immediate conversation.

### Shared rules

- Use stable headings and IDs; never rely on document position as identity.
- Keep observations and learnings atomic: one claim, decision, or lesson per record.
- Link claims to concrete request IDs, commits, validation output, or file paths when available.
- Separate observed facts from interpretation and recommendation.
- Use explicit nouns rather than context-dependent pronouns such as "this" or "it".
- Preserve disagreements or uncertainty instead of manufacturing consensus.
- Use lowercase kebab-case tags and the confidence values `low`, `medium`, or `high`.
- Exclude secrets, credentials, personal data, and unnecessary transcript detail.
- Prefer concise repetition of essential context over references that require reconstructing the conversation.

### Required `retro.md` structure

Before writing the retrospective, read `documentation/reference/retro-template.md`. Preserve its outcome, atomic observation, partnership review, and follow-up record structure.

### Required `key-learnings.md` structure

Before writing learning records, read `documentation/reference/key-learnings-template.md`. Preserve atomic statement, kind, provenance, applicability, recommendation, confidence, tags, and supersession fields.

Do not copy the entire retrospective into `key-learnings.md`. Promote only lessons likely to change a future decision or action. If no durable lesson exists, say so explicitly rather than inventing one.

---

### 2.10 Force Completion Override

If the human says `Force complete sprint`, the LLM may close the sprint even if:

- `validate_deliverable.sh` would currently fail, or
- Tests are incomplete or failing, or
- The completion branch could not be pushed

…as long as:

1. All known failures and gaps are documented under **Partial** or **Deferred** in `verification-report.md`.
2. The issues are recorded as atomic observations in `retro.md` and, when reusable, as learning records in `key-learnings.md`.
3. Any failed or omitted push is recorded in `publication.yaml` and `request-log.md`.

Force completion never authorizes a release.

---

# 3. Development Guidance

Before changing product code, tests, scripts, or infrastructure, read `documentation/reference/development-guidance.md`. Its repository-specific constraints supplement this sprint protocol.
