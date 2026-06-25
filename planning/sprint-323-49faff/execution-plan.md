# Execution Plan – Evaluator & Agent-Framework Readiness

- **Sprint:** sprint-323-49faff
- **Role:** Lead Implementor
- **Date:** 2026-06-25
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 precedence) + this sprint's `sprint-manifest.yaml`
- **Source issue:** `documentation/evaluation/external-evaluation.md` — independent evaluation of BitBrat
  as a candidate **AI Agent framework** (findings §3, recommendations §4, scorecard §5, next steps §6).
- **Status:** Awaiting user approval — **no implementation begins until approved (AGENTS.md §2.4).**

## 1. Purpose

Turn the external evaluation into a sequenced, gated, trackable set of accomplishable tasks (companion
`backlog.yaml`). The evaluation's verdict: *strong foundation and traceability, but the **framing**,
**onboarding**, and **polish** need work before BitBrat reads as a turnkey agent framework to an
outside party.* The lowest scorecard dimensions drive priority:

| Dimension | Score | Sprint focus |
|---|:--:|---|
| "Agent framework" framing/clarity | 2 | Phase 1 (README framing, agent loop, concepts) |
| Repository hygiene | 2 | Phase 2 (untrack scratch files, fixtures, `.gitignore`) |
| Security / dependency health | 2 | Phase 4 (`npm audit` remediation + cadence in `SECURITY.md`) |
| Onboarding / reproducibility | 3 | Phase 1/5 (offline Ollama/mock quickstart, evaluator's guide) |
| Accuracy / consistency | 3 | Phase 0 (clone URL, version story, config schema) |

The work is overwhelmingly **documentation/metadata-focused** and **does not alter runtime behavior**
(evaluation §6 closing note). The only runtime-adjacent items are the dependency remediation (Phase 4)
and the offline quickstart wiring (Phase 1), both gated by validation.

## 2. Guiding Constraints

- **Canonical-file discipline (AGENTS.md §0):** `architecture.yaml` edits (config schema pointer,
  `extension_points:`/`agents:` block, `status:`/`maturity:`, version reconcile) are **additive**;
  no field a consumer parses (deployment/infra/CLI) is renamed/removed without surfacing first.
- **Ground every claim in reality:** the agent-loop mapping, capabilities matrix, and concept docs must
  reflect what the code/services actually do (`llm-bot`, `event-router`, routing-slip, `ingress-egress`,
  `disposition-service`, MCP servers) — no invented behavior. Verified facts (see §3) anchor the work.
- **No secrets, ever:** the fake-credential cleanup renames/relocates only; no real values are added,
  and `.gitignore` is tightened so scratch artifacts cannot re-enter the tree.
- **Reproducibility:** the offline quickstart must be runnable without GCP/OpenAI keys (Ollama or a mock
  LLM); its steps are exercised/sanity-checked, not just asserted.
- **Validation is mandatory (AGENTS.md §2.6):** `validate_deliverable.sh` must be logically passable —
  it parses `architecture.yaml`, validates it against the **newly shipped** config schema, link-checks
  the new docs, and confirms no scratch artifacts remain tracked.
- **Reversible & traceable (AGENTS.md §3):** all work on `feature/sprint-323-49faff-evaluator-readiness`;
  each task maps to a backlog ID (BL-1xx) and a `request-log.md` entry.
- **WIP limit = 3** in-progress items at a time.

## 3. Verified Baseline Facts (grounding)

- `package.json` `version = 1.0.0`; `architecture.yaml` `project.version = 0.1.0`; README says
  "early & experimental" → three conflicting maturity signals (evaluation §3.3).
- Tracked scratch artifacts confirmed in git: `dummy-creds.json`, `route.json`, `test.json`,
  `validation_output.txt` (evaluation §3.4).
- `documentation/schemas/` ships only `envelope.v1.json` and `routing-slip.v1.json` — **no**
  `architecture.yaml` schema, yet `brat config validate` claims to validate against one (evaluation §3.3).
- `ai-sdk-ollama` is already a dependency → an offline path exists "in spirit" but is undocumented
  (evaluation §3.2).
- No `CHANGELOG.md`; `assets/` exists but has no architecture-diagram asset (evaluation §3.6, §4.3).

## 4. Open Questions (to confirm at approval)

1. **Real clone URL:** the evaluation reports README uses `https://github.com/BitBrat/BitBratPlatform.git`
   while origin is `git@github.com:cnavta/BitBrat.git`. Which is the **canonical public URL** to publish
   in the README/quickstart? **Plan of record:** use the actual `origin` (HTTPS form). **Confirm.**
2. **Version reconciliation target:** align all three signals to **one** version + maturity. **Plan of
   record:** set `package.json` to `0.1.0` to match `architecture.yaml` and add `status: experimental`
   to the canonical file (least surprising; keeps the "early/experimental" narrative). **Confirm** (vs.
   bumping `architecture.yaml` to `1.0.0`).
3. **Config-schema scope (BL-105):** ship a JSON Schema for `architecture.yaml` covering the current
   structure (additive `$schema`/`references.architecture_schema` pointer). **Plan of record:** schema
   describes today's top-level keys and is wired into `brat config validate`; we do **not** restructure
   the file. **Confirm** that `brat config validate` should consume this new schema.
4. **Dependency remediation depth (BL-401):** evaluation reports 149 vulns (3 critical, 60 high). **Plan
   of record:** apply non-breaking `npm audit fix` + targeted manual bumps, document residual/breaking
   ones as **Deferred**, and add a scanning cadence to `SECURITY.md`. Full breaking-change upgrades are
   **out of scope** unless you direct otherwise. **Confirm scope.**
5. **Fake-credential file fate (BL-201):** untrack `dummy-creds.json` and either delete it or move a
   clearly-renamed fixture (e.g. `tests/fixtures/fake-gcp-creds.example.json`). **Plan of record:**
   relocate + rename + `.gitignore`. **Confirm** nothing in tooling reads `dummy-creds.json` at its
   root path (discovery will check; surface if it does).

## 5. Phases & Gates

### Phase 0 — Accuracy & consistency quick wins (evaluation §3.3, §4.1, §4.2; "minutes") — P1
- Discovery: confirm the real clone URL, locate every place the clone URL / version / "experimental"
  string appears, and confirm whether any tooling reads the to-be-moved scratch files.
- Fix the README clone URL (BL-101). Reconcile the version story across `package.json`,
  `architecture.yaml`, and README; add an explicit `status:`/`maturity:` field (BL-102).
- **Gate G0:** clone URL is copy-paste runnable; one consistent version+maturity signal across all three
  sources; open questions answered (or defaults accepted) and recorded in `request-log.md`.

### Phase 1 — Agent-framework framing & core concepts (evaluation §3.1, §4.1; highest scorecard lift) — P1
- Add a "**What is BitBrat?**" section to `README.md`: event-driven LLM orchestration engine, a
  "Streaming is the reference application" note, and a paragraph mapping the platform onto the agent loop
  — *ingest = perceive, event-router + routing-slip = plan, llm-bot + MCP tools = act,
  persistence/disposition = memory/observe* (BL-103).
- Add a "**Core Agent Concepts**" subsection + an **extension-guide pointer** ("how to add a new
  service / MCP tool / rule", linking `brat service bootstrap`); link `AGENTS.md` prominently (BL-106).
- Add the **offline/local quickstart** (Ollama via existing `ai-sdk-ollama`, or a mock LLM) so the
  platform can be tried with no OpenAI key / GCP; sanity-check the documented steps (BL-107).
- **Gate G1:** a reader can answer "what is the agent here?" from one place; the agent loop is mapped to
  real services; an offline path is documented and the documented commands actually run.

### Phase 2 — Repository hygiene (evaluation §3.4, §4.3; "minutes") — P1
- Untrack `dummy-creds.json`, `route.json`, `test.json`, `validation_output.txt`; relocate any genuine
  fixtures into `tests/fixtures/` (or `examples/`) and rename the fake credential file to make its dummy
  nature unmistakable; extend `.gitignore` so they cannot return (BL-201).
- **Gate G2:** none of the four scratch files are tracked; `.gitignore` covers their patterns; no tooling
  or test references a removed/renamed path; working tree clean of stray clutter we introduced.

### Phase 3 — Machine-readable agent extension points & config schema (evaluation §3.3, §4.2) — P2
- Ship the **config schema** `brat config validate` references; add a top-of-file `$schema:` /
  `references.architecture_schema` pointer (BL-105).
- Add an `extension_points:` (or `agents:`) block to `architecture.yaml` describing how to add a new
  agent/service/MCP tool and which files change (BL-104).
- **Gate G3:** `brat config validate` validates `architecture.yaml` against a shipped schema and passes;
  the extension-points block resolves to real files/CLI commands; file still parses & is backward-compatible.

### Phase 4 — Security & dependency health (evaluation §3.5, §4.3) — P1/P2
- Run `npm audit`; apply non-breaking remediations + targeted bumps; document residual/breaking items as
  Deferred. Document a scanning cadence (Dependabot / `npm audit`) in `SECURITY.md` (BL-401).
- **Gate G4:** `npm audit` count materially reduced (or residuals justified & deferred); build + tests
  still pass; `SECURITY.md` describes the scanning/remediation cadence.

### Phase 5 — Navigational aids & evaluator onboarding (evaluation §3.6, §4.1, §4.3) — P2/P3
- Embed a high-level **mermaid architecture diagram** in the README near Architecture; add a
  **capabilities matrix** (platforms / LLM providers / persistence backends) (BL-108).
- Add **`documentation/getting-started/evaluating-bitbrat.md`** ("try it in 5 minutes," what to read
  first, how the pieces form an agent) (BL-301).
- Add **`CHANGELOG.md`** and a top-level architecture-diagram asset under `assets/` (BL-302).
- **Gate G5:** diagram renders; capabilities matrix is accurate; evaluator's guide links resolve;
  `CHANGELOG.md` present and seeded.

### Phase 6 — Validation harness, link sync & close-out
- Provide/extend `validate_deliverable.sh`: parse `architecture.yaml`, validate it against the new schema,
  link-check new/changed docs, and assert no scratch artifacts are tracked; logically passable (§2.6).
- Produce `verification-report.md`, `retro.md`, `key-learnings.md`; attempt PR and record in
  `publication.yaml` (Rules S12/S13).
- **Gate G6:** `validate_deliverable.sh` is logically passable and DoD (AGENTS.md §3) is met.

## 6. Sequencing & Dependencies (summary)

```
Phase0 (G0 accuracy fixes: URL + version)            [P1]
  -> Phase1 (G1 agent framing + concepts + offline)  [P1]
  -> Phase2 (G2 repo hygiene)                         [P1]   (parallelizable with Phase1)
  -> Phase3 (G3 config schema + extension_points)     [P2]
  -> Phase4 (G4 dependency remediation + cadence)     [P1/P2]
  -> Phase5 (G5 diagram + matrix + evaluator guide + CHANGELOG) [P2/P3]
  -> Phase6 (G6 validate + docs + close)
```

Phases 0–2 deliver the smallest-effort/highest-impact items from evaluation §6; Phase 4 lifts the
supply-chain score; Phases 3 & 5 are additive depth. The detailed, trackable breakdown (IDs, priorities,
effort, deps, acceptance) lives in `backlog.yaml` (BL-101 … BL-401).

## 7. Definition of Done (this artifact)
- [x] Evaluation decomposed into phased, gated, accomplishable tasks.
- [x] Companion Trackable Prioritized YAML Backlog produced (`backlog.yaml`).
- [x] Constraints (canonical-file discipline, grounded facts, no secrets, mandatory validation) explicit.
- [x] Open questions surfaced for approval (clone URL, version target, schema scope, remediation depth, fake-cred fate).
- [ ] **User approval to begin implementation (pending).**
