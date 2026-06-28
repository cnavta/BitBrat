# {{PLAN_TYPE}} Plan – {{SPRINT_ID_OR_SHORT_TITLE}}

<!--
Template purpose:
Use this when producing an Execution Plan / Implementation Plan for an LLM-led coding sprint.

Core rules from AGENTS.md:
- `architecture.yaml` is the canonical source of truth and wins all conflicts.
- `AGENTS.md` governs agent behavior and sprint protocol.
- Planning artifacts live under `./planning`.
- Coding is forbidden until the implementation plan is explicitly approved.
- A sprint begins only when the user explicitly says "Start sprint".
- Every meaningful shell/git operation and sprint-relevant prompt must be logged in `request-log.md`.
- Every sprint must be traceable, reproducible, reversible, validated, verified, published or explicitly exceptioned, retroed, and learned from.

How to use:
1. Replace all `{{PLACEHOLDER}}` values.
2. Delete sections that are truly not applicable, but preserve the planning gate, scope, acceptance criteria,
   testing strategy, validation, verification, publication, and Definition of Done sections unless the user
   explicitly accepts an exception.
3. Keep claims grounded in `architecture.yaml`, code, docs, schemas, and observed repository facts.
4. Do not invent behavior. If uncertain, label it as an open question with a Plan of Record.
-->

- **Sprint:** {{SPRINT_ID}} <!-- omit only for pre-sprint planning artifacts -->
- **Title:** {{CONCISE_TITLE}}
- **Owner / Role:** {{OWNER_OR_ROLE}} <!-- e.g. Lead Implementor -->
- **Date:** {{YYYY-MM-DD}}
- **Branch:** `{{FEATURE_BRANCH}}` <!-- required once sprint has started -->
- **Source of truth:** `architecture.yaml` + `AGENTS.md` + {{OTHER_CANONICAL_FILES}}
- **Source design / issue / prompt:** {{SOURCE_DESIGN_OR_ISSUE}}
- **Status:** {{PLANNING_STATUS}}
  <!-- Example: PLANNING — awaiting owner approval; no implementation begins until approved. -->

---

## 1. Objective

{{ONE_PARAGRAPH_CLEAR_GOAL}}

State the desired end state in concrete terms. Prefer observable outcomes over intent.

Good:
> Make `architecture.yaml project.version` the single source of truth and add one idempotent release command that keeps package metadata and CHANGELOG in sync.

Weak:
> Improve release stuff.

---

## 2. Problem Statement / Why

{{WHAT_IS_BROKEN_OR_MISSING_AND_WHY_IT_MATTERS}}

Include current-state evidence. Name the files, services, commands, contracts, or workflows involved.

- **Current behavior:** {{CURRENT_BEHAVIOR}}
- **Impact / risk:** {{IMPACT_OR_RISK}}
- **Why now:** {{WHY_THIS_SPRINT}}

---

## 3. Grounding / Verified Baseline Facts

<!--
Use this section to prevent hallucinated implementation.
Only include facts verified from repo files, docs, schemas, test output, or user-provided decisions.
-->

- {{FACT_1_WITH_FILE_OR_COMMAND_REFERENCE}}
- {{FACT_2_WITH_FILE_OR_COMMAND_REFERENCE}}
- {{FACT_3_WITH_FILE_OR_COMMAND_REFERENCE}}

### Conflicts or inconsistencies discovered

| Item | Source A | Source B | Resolution / Plan of Record |
|---|---|---|---|
| {{CONFLICT_NAME}} | {{SOURCE_A}} | {{SOURCE_B}} | {{RESOLUTION_OR_OPEN_QUESTION}} |

---

## 4. Scope

### In scope

- {{IN_SCOPE_ITEM_1}}
- {{IN_SCOPE_ITEM_2}}
- {{IN_SCOPE_ITEM_3}}

### Out of scope

- {{OUT_OF_SCOPE_ITEM_1}}
- {{OUT_OF_SCOPE_ITEM_2}}
- {{OUT_OF_SCOPE_ITEM_3}}

### Non-goals / explicit deferrals

- {{DEFERRED_ITEM}} — deferred because {{REASON}}. Track as {{BACKLOG_ID_IF_ANY}}.

---

## 5. Guiding Constraints

<!--
These should be binding implementation constraints, not vague preferences.
Include AGENTS.md constraints and project-specific constraints from architecture.yaml.
-->

- **Canonical-file discipline:** `architecture.yaml` wins. Any required behavior or contract change must be reflected there first, preferably additively. If this plan conflicts with `architecture.yaml`, stop, surface the conflict, and align to it.
- **Planning approval gate:** No implementation, branch work, code edits, or production file changes begin until this plan is explicitly approved. A sprint starts only when the user says **"Start sprint"**.
- **Repository locality:** Operate only inside the provided repository. Do not depend on `./deprecated` for deliverables.
- **Traceability:** Every task maps to a backlog ID and request-log entry. Every meaningful shell/git operation is logged in `request-log.md`.
- **Reversibility:** Prefer independently shippable, reversible phases. Avoid broad rewrites when targeted changes work.
- **Behavior preservation:** Existing behavior remains unchanged unless this plan explicitly calls out a behavioral change and its acceptance criteria.
- **Validation required:** `validate_deliverable.sh` must be real, executable, and logically passable. Failures caused by environment/credentials must be logged and explicitly accepted before closure.
- **Security / secrets:** Never expose raw secrets, tokens, credentials, or provider keys in logs, admin surfaces, generated docs, tests, or reports.
- **WIP limit:** Limit active implementation work to {{WIP_LIMIT_DEFAULT_3}} items at a time.
- **Deployment target parity:** {{DEPLOYMENT_PARITY_REQUIREMENT_OR_NA}}
- **Project-specific constraints:** {{PROJECT_SPECIFIC_CONSTRAINTS}}

---

## 6. Open Questions and Decisions

<!--
Do not let open questions become silent assumptions.
For each question, provide a default Plan of Record so the user can approve or override.
-->

| # | Question | Why it matters | Plan of Record | Status |
|---|---|---|---|---|
| 1 | {{QUESTION}} | {{WHY}} | {{DEFAULT_DECISION}} | {{Open / Accepted / Rejected}} |
| 2 | {{QUESTION}} | {{WHY}} | {{DEFAULT_DECISION}} | {{Open / Accepted / Rejected}} |

### Owner-accepted decisions

- **{{DECISION_ID}} — {{ACCEPTED / ACCEPTED_WITH_CONDITION}}:** {{DECISION_TEXT}}
- **{{DECISION_ID}} — {{ACCEPTED / ACCEPTED_WITH_CONDITION}}:** {{DECISION_TEXT}}

---

## 7. Deliverables

### Code

- {{CODE_DELIVERABLE_1}}
- {{CODE_DELIVERABLE_2}}

### Tests

- {{TEST_DELIVERABLE_1}}
- {{TEST_DELIVERABLE_2}}

### Validation / CI / deployment artifacts

- {{VALIDATION_DELIVERABLE}}
- {{DEPLOYMENT_OR_CI_DELIVERABLE}}

### Documentation and sprint artifacts

- `planning/{{SPRINT_ID}}/implementation-plan.md`
- `planning/{{SPRINT_ID}}/backlog.yaml`
- `planning/{{SPRINT_ID}}/request-log.md`
- `planning/{{SPRINT_ID}}/validate_deliverable.sh`
- `planning/{{SPRINT_ID}}/verification-report.md`
- `planning/{{SPRINT_ID}}/publication.yaml`
- `planning/{{SPRINT_ID}}/retro.md`
- `planning/{{SPRINT_ID}}/key-learnings.md`
- {{OTHER_DOCS}}

---

## 8. Acceptance Criteria

<!--
Acceptance criteria must be testable or inspectable.
Use numbered criteria so they can map cleanly to verification-report.md.
-->

1. {{ACCEPTANCE_CRITERION_1}}
2. {{ACCEPTANCE_CRITERION_2}}
3. {{ACCEPTANCE_CRITERION_3}}
4. {{ACCEPTANCE_CRITERION_4}}
5. `validate_deliverable.sh` is executable and logically passable.
6. `verification-report.md` maps each acceptance criterion to Completed / Partial / Deferred.
7. Publication is attempted; PR URL is recorded in `publication.yaml`, or a failed attempt is logged and explicitly accepted.

---

## 9. Phases and Exit Gates

<!--
Use phases when the work is more than trivial.
Each phase should produce something coherent and have a gate.
Phase IDs may be numeric, alphabetic, or named, but should map to backlog IDs.
-->

### Phase 0 — Discovery and baseline validation

**Goal:** {{PHASE_0_GOAL}}

Tasks:
- {{TASK}} ({{BACKLOG_ID}})
- {{TASK}} ({{BACKLOG_ID}})
- {{TASK}} ({{BACKLOG_ID}})

**Exit Gate G0:**
- [ ] {{GATE_CHECK}}
- [ ] Baseline validation result recorded.
- [ ] Open questions either answered or Plan of Record accepted.

### Phase 1 — {{PHASE_1_NAME}}

**Goal:** {{PHASE_1_GOAL}}

Tasks:
- {{TASK}} ({{BACKLOG_ID}})
- {{TASK}} ({{BACKLOG_ID}})
- {{TASK}} ({{BACKLOG_ID}})

**Exit Gate G1:**
- [ ] {{GATE_CHECK}}
- [ ] Existing tests remain green unless documented and accepted.
- [ ] No unapproved behavior change.

### Phase 2 — {{PHASE_2_NAME}}

**Goal:** {{PHASE_2_GOAL}}

Tasks:
- {{TASK}} ({{BACKLOG_ID}})
- {{TASK}} ({{BACKLOG_ID}})

**Exit Gate G2:**
- [ ] {{GATE_CHECK}}
- [ ] Security / redaction / permission checks pass where applicable.
- [ ] Documentation updated for changed behavior or contracts.

### Phase V — Validation, verification, publication, close-out

Tasks:
- Extend/create `validate_deliverable.sh` to run install, build, tests, runtime checks where applicable, and deployment dry-run where applicable. ({{BACKLOG_ID}})
- Produce `verification-report.md`, mapping acceptance criteria and phase gates to evidence. ({{BACKLOG_ID}})
- Update `CHANGELOG.md` / README / CONTRIBUTING / project docs where applicable. ({{BACKLOG_ID}})
- Commit, push feature branch, and attempt PR creation. Record result in `publication.yaml`. ({{BACKLOG_ID}})
- Produce `retro.md` and `key-learnings.md`. ({{BACKLOG_ID}})

**Exit Gate GV:**
- [ ] `validate_deliverable.sh` logically passes or failures are documented and explicitly accepted.
- [ ] Verification report complete.
- [ ] PR created or failed PR attempt logged and explicitly accepted.
- [ ] Retro and learnings produced.
- [ ] User says **"Sprint complete"** or **"Force complete sprint"**.

---

## 10. Sequencing and Dependencies

```text
Phase 0: Discovery / baseline
  -> Phase 1: {{PHASE_1_SUMMARY}}
    -> Phase 2: {{PHASE_2_SUMMARY}}
      -> Phase V: Validate / verify / publish / retro / learn
```

### Dependency notes

- {{DEPENDENCY_NOTE_1}}
- {{DEPENDENCY_NOTE_2}}
- {{DEPENDENCY_NOTE_3}}

### Parallelization notes

- Safe to parallelize: {{SAFE_PARALLEL_WORK}}
- Must be serialized: {{SERIAL_WORK_AND_REASON}}

---

## 11. Testing Strategy

### Unit tests

- {{UNIT_TEST_AREA_1}}
- {{UNIT_TEST_AREA_2}}

### Integration tests

- {{INTEGRATION_TEST_AREA_1}}
- {{INTEGRATION_TEST_AREA_2}}

### Contract / conformance tests

- {{CONTRACT_TEST_AREA_1}}
- {{CONTRACT_TEST_AREA_2}}

### Security / negative tests

- {{SECURITY_TEST_AREA_1}}
- {{NEGATIVE_TEST_AREA_1}}

### Regression / behavior-preservation tests

- {{REGRESSION_TEST_AREA_1}}
- {{REGRESSION_TEST_AREA_2}}

### Test framework and execution

- Framework: {{TEST_FRAMEWORK}} <!-- e.g. Jest for Node/TypeScript -->
- Main commands:
  - `{{INSTALL_COMMAND}}`
  - `{{BUILD_COMMAND}}`
  - `{{TEST_COMMAND}}`
  - `{{VALIDATION_COMMAND}}`

---

## 12. Deployment / Runtime Approach

{{DEPLOYMENT_APPROACH_SUMMARY}}

- Runtime targets: {{RUNTIME_TARGETS}}
- Build/deploy commands: {{BUILD_DEPLOY_COMMANDS}}
- Local runtime validation: {{LOCAL_RUNTIME_VALIDATION}}
- Cloud / remote validation: {{CLOUD_OR_REMOTE_VALIDATION}}
- Rollback approach: {{ROLLBACK_APPROACH}}

If this is tooling-only or documentation-only, state that explicitly and explain what validation replaces runtime deployment.

---

## 13. Observability, Security, and Operational Concerns

- **Logging:** {{LOGGING_REQUIREMENTS}}
- **Metrics / tracing:** {{METRICS_TRACING_REQUIREMENTS}}
- **Health / readiness:** {{HEALTH_REQUIREMENTS}}
- **Auth / authorization:** {{AUTH_REQUIREMENTS}}
- **Secret handling:** {{SECRET_HANDLING_REQUIREMENTS}}
- **Failure modes:** {{FAILURE_MODES_AND_EXPECTED_BEHAVIOR}}
- **Backwards compatibility:** {{BACKWARDS_COMPATIBILITY_REQUIREMENTS}}

---

## 14. Backlog Mapping

<!--
A companion `backlog.yaml` is recommended for non-trivial work.
Keep IDs stable so request-log, verification, and PR description can reference them.
-->

| Backlog ID | Priority | Phase | Task | Acceptance |
|---|---:|---|---|---|
| {{BL-001}} | P0 | Phase 0 | {{TASK}} | {{ACCEPTANCE}} |
| {{BL-100}} | P0 | Phase 1 | {{TASK}} | {{ACCEPTANCE}} |
| {{BL-200}} | P1 | Phase 2 | {{TASK}} | {{ACCEPTANCE}} |
| {{BL-500}} | P0 | Phase V | {{TASK}} | {{ACCEPTANCE}} |

---

## 15. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| {{RISK}} | {{Low/Med/High}} | {{Low/Med/High}} | {{MITIGATION}} |
| {{RISK}} | {{Low/Med/High}} | {{Low/Med/High}} | {{MITIGATION}} |

---

## 16. Definition of Done

This sprint follows the project-wide Definition of Done in `AGENTS.md §3`.

- [ ] Implementation adheres to `architecture.yaml` and this approved plan.
- [ ] No TODOs, placeholder logic, or production stubs unless explicitly accepted and documented.
- [ ] Tests for all new behavior are present and pass, or deferrals are explicitly accepted.
- [ ] External dependencies are mocked in tests.
- [ ] Deployment / CI / validation artifacts are updated where applicable.
- [ ] Documentation captures rationale, trade-offs, usage, and operational notes.
- [ ] All meaningful shell/git operations and sprint-relevant prompts are logged in `request-log.md`.
- [ ] `validate_deliverable.sh` is executable and logically passable.
- [ ] `verification-report.md` documents Completed / Partial / Deferred items.
- [ ] PR is created and recorded, or failed PR attempt is logged and accepted.
- [ ] `retro.md` and `key-learnings.md` exist.
- [ ] User has explicitly approved closure with **"Sprint complete"** or **"Force complete sprint"**.

---

## 17. Approval Gate

**Current status:** {{AWAITING_APPROVAL_OR_APPROVED}}

Implementation is forbidden until the owner explicitly approves this plan.

When approved, the next valid sprint command is:

```text
Start sprint
```

