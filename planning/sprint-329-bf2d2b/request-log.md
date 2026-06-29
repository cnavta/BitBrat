# Request Log – sprint-329-bf2d2b (Scheduler: full InternalEventV2 events + optional emit topic)

Per AGENTS.md §2.5, every meaningful prompt, interpretation, and the shell/git/file
operations it triggered are logged here. Code changes trace back to a BL-329-NNN item.

---

## REQ-001 — 2026-06-28 — Sprint start (planning deliverables)
- **Prompt:** "We are starting a new sprint. Assume the role of Lead Implementor. … address the gap in the
  scheduler bit … make ScheduleDoc.event a full InternalEventV2 … add an optional `topic` (default
  internal.ingress.v1). Your first task … create an Execution Plan and Trackable Prioritized YAML Backlog."
- **Interpretation:** Open a new sprint as Lead Implementor; produce `execution-plan.md` +
  `backlog.yaml` (+ supporting sprint artifacts); pause at the planning gate (Rule S1) — implement only
  after explicit owner approval + "Start sprint".
- **Actions:**
  - Verified no active sprint (all `planning/*/sprint-manifest.yaml` are `complete`) → Rule S3 satisfied.
  - Grounded the plan in code: `src/apps/scheduler-service.ts` (EventDefinitionSchema ~L23-31; ScheduleDoc
    ~L52-71; executeSchedule ~L305-350 hard-codes egress=system @L324; handleTick ~L269-303 hard-codes topic
    @L284), `src/types/events.ts` (InternalEventV2/Egress/ConnectorType incl. 'twitch'/Ingress/Identity/
    MessageV1/AnnotationV1), `src/services/message-bus/index.ts` (`createMessagePublisher(subject)`),
    `architecture.yaml` (topic catalog L88-177; scheduler publishes L613-615),
    `tests/apps/scheduler-service.spec.ts`.
  - `git checkout -b feature/sprint-329-bf2d2b-scheduler-full-event-topic`.
  - Created `planning/sprint-329-bf2d2b/{sprint-manifest.yaml, execution-plan.md, implementation-plan.md,
    backlog.yaml, request-log.md, validate_deliverable.sh}`.
- **Result:** Planning deliverables authored; **no production code changed**. Awaiting owner approval and
  answers to **OD-1** (topic allow-list scope) and **OD-2** (author-settable field whitelist), then
  "Start sprint".

---

## REQ-002 — 2026-06-28 — Owner approval + "Start sprint" (implementation begins)
- **Prompt:** "Open Decisions: OD-1 – Use Plan of Record. OS-2 – Use Plan of Record. Plan approved with the
  above decisions and one additional change to the plan: G4: NO backward compatibility with the existing
  schema is needed. Any existing data will be deleted. Start sprint. Please be sure to keep backlog items
  status up to date as they change."
- **Interpretation:** Owner approves the plan + backlog and says "Start sprint" (Rule S1 gate cleared).
  OD-1 → Plan of Record: validate `topic` against a curated governed subset and update scheduler
  `topics.publishes` to that subset. OD-2 → Plan of Record author-settable whitelist. **G4 override:**
  drop back-compat entirely — `ScheduleDoc.event` becomes a full `InternalEventV2` authoring shape with no
  legacy partial-event path or back-compat test; existing stored data will be deleted by the owner.
- **Actions (this session):**
  - Curated emit allow-list resolved to `[internal.ingress.v1, internal.egress.v1]` (egress topic is the
    one the Twitch-egress scenario needs; default remains `internal.ingress.v1`).
  - Implementing BL-329-001…004 in `src/apps/scheduler-service.ts`; BL-329-100/101 governance in
    `architecture.yaml`; BL-329-102 description; BL-329-200/201 tests; BL-329-500/501 close-out.
- **Result:** Sprint moved from `planning` → `in-progress`; backlog item statuses updated as work proceeds.
