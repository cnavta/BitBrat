# Request Log – sprint-323-49faff (Evaluator & Agent-Framework Readiness)

## REQ-001 — Sprint start & planning artifacts
- **At:** 2026-06-25T13:05:00Z
- **Prompt summary:** Start a new sprint as Lead Implementor; analyze the external evaluation and
  produce an Execution Plan + Trackable Prioritized YAML Backlog.
- **Interpretation:** PLANNING phase only (AGENTS.md §2.4). No implementation until approved.
- **Actions:** Created branch `feature/sprint-323-49faff-evaluator-readiness` and
  `planning/sprint-323-49faff/`; authored `sprint-manifest.yaml` (status: planning),
  `execution-plan.md` (Phases 0–6 / Gates G0–G6, 5 open questions), `backlog.yaml`
  (BL-100…BL-600). Surfaced Open Questions OQ1–OQ5 for approval.
- **Files:** `planning/sprint-323-49faff/{sprint-manifest.yaml,execution-plan.md,backlog.yaml}`.

## REQ-002 — Open-question answers + approval to implement
- **At:** 2026-06-25T13:15:00Z
- **Prompt summary:** Answered the open questions and approved the documentation; instructed to
  begin implementation while keeping backlog item statuses up to date.
- **Decisions of record (override execution-plan.md §4 plans-of-record where they differ):**
  1. **Canonical clone URL:** `https://github.com/cnavta/BitBrat`. Use this exact HTTPS URL in
     README/quickstart clone commands.
  2. **Version target:** keep the project **pre-1.0**; reconcile to **`0.7.0`** across
     `package.json` and `architecture.yaml` (NOT 0.1.0 and NOT 1.0.0). README maturity wording stays
     "early / pre-1.0 / experimental". Add an explicit `status:`/`maturity:` field to
     `architecture.yaml`.
  3. **Config-schema scope (BL-105):** CONFIRMED — ship a JSON Schema for `architecture.yaml`
     describing today's top-level structure; wire `brat config validate` to consume it; do not
     restructure the file.
  4. **Dependency remediation depth (BL-401):** CONFIRMED — apply non-breaking `npm audit fix` +
     targeted bumps; document residual/breaking advisories as Deferred; add a scanning cadence to
     `SECURITY.md`. Full breaking upgrades remain out of scope.
  5. **Fake-credential file fate (BL-201):** **Delete `dummy-creds.json` and `.gitignore` it** (no
     renamed fixture needed). Also untrack `route.json`, `test.json`, `validation_output.txt` and
     extend `.gitignore`.
- **Discovery findings (BL-100):**
  - Clone URL `https://github.com/BitBrat/BitBratPlatform.git` appears in `README.md:75` and
    `documentation/getting-started/quickstart.md:17`.
  - Version signals: `package.json` `version: 1.0.0`; `architecture.yaml` `version: 0.1.0`;
    README labels it "early & experimental" → reconcile all to `0.7.0`.
  - Scratch-file consumers: the only live reference is `tools/brat/src/orchestration/docker/orchestrator.ts:197`,
    which includes `dummy-creds.json` in a remote-sync list **guarded by `fs.existsSync(...)`** — so
    deleting the file is safe (it is simply skipped). Old per-sprint `validate_deliverable.sh` scripts
    create their own `dummy-creds.json` locally and are unaffected. `route.json` / `test.json` /
    `validation_output.txt` have no live code consumers (the `internal.test.json` topic string is
    unrelated).
  - Scratch-file contents confirmed trivial/fake: `dummy-creds.json` = `{"type":"service_account"}`;
    `route.json`/`test.json` = sample routing-slip / JSONLogic fixtures; `validation_output.txt` =
    captured validator stdout.
- **Approval gate:** APPROVED — implementation may begin (AGENTS.md §2.4).
