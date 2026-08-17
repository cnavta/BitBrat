# Execution Plan – sprint-329-bf2d2b (Scheduler: full InternalEventV2 events + optional emit topic)

- **Sprint:** sprint-329-bf2d2b
- **Title:** Scheduler — full `InternalEventV2` events + optional per-schedule emit `topic`
- **Owner / Role:** Lead Implementor (AGENTS.md §10)
- **Date:** 2026-06-28
- **Branch:** `feature/sprint-329-bf2d2b-scheduler-full-event-topic`
- **Source of truth:** `architecture.yaml` (AGENTS.md §0 precedence) + `AGENTS.md`
- **Source gap (owner-attached):** scratch note *"Expected behavior for 'Schedule an event in 5 minutes
  with a prompt Scream!!! and egress set for Twitch'"* — §3 "The Twitch egress half — currently a gap" and
  §4 "Summary / takeaway".
- **Companion backlog:** `planning/sprint-329-bf2d2b/backlog.yaml` (BL-329-001 … BL-329-500)
- **Status:** PLANNING — **awaiting owner approval**. Per **AGENTS.md Rule S1 / §2.4** no implementation
  begins until the owner approves this plan + the backlog and says **"Start sprint."** (The sprint
  directory and feature branch have been scaffolded as part of sprint start; no production code is changed yet.)

---

## 1. Objective

Let a scheduled task emit **any** internal event the platform supports — not just the narrow
type/payload/message/annotations projection it can express today — and let it choose the **topic** it is
published on.

Concretely:
1. Change `ScheduleDoc.event` (and the `create_schedule` / `update_schedule` input contract) from a
   **partial** event projection to a **full `InternalEventV2`** authoring shape.
2. Add an **optional** per-schedule `topic` (string). When unset it defaults to **`internal.ingress.v1`**
   (today's hard-coded behavior).
3. Stop hard-coding egress in `executeSchedule` and the publish topic in `handleTick`; honor what the
   schedule specifies, falling back to `system` egress / `internal.ingress.v1` topic only when unset.

End state (observable): the request *"schedule … with egress set for Twitch"* becomes expressible — the
agent can author a schedule whose event carries `egress: { connector: 'twitch', destination: 'twitch',
channel: '#<channel>' }`, optionally on a chosen topic, and `executeSchedule` emits it **unchanged**.

---

## 2. Problem Statement / Why

Per the owner-attached note (§3): even though sprint-328's Context Pack documents `egress` as a real
`InternalEventV2` field and `ConnectorType` already includes `'twitch'`, the scheduler tool **cannot act on
it**:

- `EventDefinitionSchema` (`src/apps/scheduler-service.ts` ~L23–31) only exposes `type`, `payload`,
  `message`, `annotations` — **no `egress`** (and no `ingress`/`identity`/`candidates`/`qos`/`metadata`/
  `externalEvent`/`routing`).
- `ScheduleDoc.event` (~L60–65) mirrors that partial shape.
- `executeSchedule` (~L305–350) **hard-codes** `egress: { destination: 'system', connector: 'system' }`
  (~L324), so anything an agent smuggles into `payload` is silently overwritten.
- `handleTick` (~L284) **hard-codes** the publish topic via `createMessagePublisher('internal.ingress.v1')`
  for **all** schedules.

So *"egress set for Twitch"* (and any non-ingress topic) is not honorable today. The Context Pack improved
**comprehension** of the full contract; this sprint widens the scheduler's **input surface** and removes the
hard-coding so comprehension can translate into action. This is exactly the follow-up the note names in §4.

---

## 3. Design Goals & Constraints

| # | Goal | How this plan honors it |
|---|------|-------------------------|
| G1 | Express the full event | `event` accepts a full `InternalEventV2` authoring shape (mirrors `src/types/events.ts`). |
| G2 | Single source of truth | The authoring schema is derived from / kept in lockstep with `InternalEventV2` (Law #2); reuse `ConnectorType`, `Egress`, `Ingress`, `Identity`, `MessageV1`, `AnnotationV1`. |
| G3 | Optional topic, safe default | `topic?: string`, default `internal.ingress.v1`; validated against the governed topic catalog. |
| G4 | Back-compat | Existing stored `ScheduleDoc`s (old partial `event`, no `topic`) keep emitting an `internal.ingress.v1` event with `system` egress — byte-for-byte where it matters. |
| G5 | No hard-coding | `executeSchedule` fills server-owned envelope fields (correlationId, traceId, ingress, routing) but honors author-supplied `egress`/`identity`/`message`/`annotations`/etc.; `handleTick` publishes on the schedule's topic. |

Hard constraints:
- **Law #2 / canonical:** `architecture.yaml` is authoritative. Today the scheduler declares
  `topics.publishes: [internal.ingress.v1]` (architecture.yaml ~L613–615). Allowing other topics means the
  scheduler becomes a producer on those topics — `architecture.yaml` MUST be updated and re-validated, and
  the `topic` input MUST be validated against the governed topic catalog (architecture.yaml ~L88–177).
  **See Open Decision OD-1.**
- **No `./deprecated` dependence** (Law #4).
- **Server-owned fields stay server-owned:** an author cannot forge `correlationId`/`traceId`/`ingress`/
  `routing`/identity-of-record beyond what is safe; we whitelist the author-settable subset (see §4 scope).
- **WIP limit = 3** (backlog). Full Jest suite stays green at every phase boundary.

---

## 4. Scope

**In scope**
- Widen `EventDefinitionSchema` → a full **`InternalEventV2` authoring schema** (Zod) covering at least
  `type`, `egress`, `payload`, `message`, `annotations`, plus `identity`, `candidates`, `qos`,
  `externalEvent`, `metadata`, `ingress` (author-overridable subset) — server still fills the safe
  envelope fields.
- Add optional `topic?: string` to `CreateScheduleSchema` / `UpdateScheduleSchema` and `ScheduleDoc`,
  defaulting to `internal.ingress.v1`; validate against the governed topic catalog.
- Change `ScheduleDoc.event` type to the full `InternalEventV2` authoring shape.
- `executeSchedule`: merge author-supplied event fields over server-owned defaults; **egress falls back to
  `system` only when unset** (remove the unconditional hard-code).
- `handleTick`: create the publisher per schedule using `schedule.topic ?? 'internal.ingress.v1'` (group by
  topic for efficiency if helpful).
- Update `create_schedule` tool description (and the schema Context Pack wiring is already present) so the
  agent knows it can set `egress`/`topic`.
- `architecture.yaml`: update scheduler `topics.publishes` to reflect the governed allow-list (OD-1).
- Tests (unit + integration) + `validate_deliverable.sh`; `CHANGELOG.md`.

**Out of scope (this sprint)**
- Changing the `InternalEventV2` contract itself, the envelope schema, or any topic/version rename.
- New connectors or ingress-egress delivery changes (Twitch delivery already exists via `ConnectorType`/
  ingress-egress; we only make the scheduler able to *address* it).
- Auth/identity hardening beyond whitelisting the author-settable event subset.
- Any RAG/Context-Pack changes beyond a one-line description nudge.

---

## 5. Deliverables (phased)

- **P0 – Contract widening (types + Zod):** full `InternalEventV2` authoring schema; `topic?` added;
  `ScheduleDoc.event` retyped. *(BL-329-001, -002)*
- **P0 – Execution honors the contract:** `executeSchedule` egress/identity/message passthrough with
  `system` fallback; `handleTick` per-schedule topic with `internal.ingress.v1` default. *(BL-329-003, -004)*
- **P1 – Governance & validation:** validate `topic` against the architecture.yaml catalog; update scheduler
  `topics.publishes` + re-validate (`brat config validate`). Resolve OD-1. *(BL-329-100, -101)*
- **P1 – Agent comprehension:** enrich `create_schedule` description to mention `egress` + `topic`.
  *(BL-329-102)*
- **P2 – Tests:** extend `tests/apps/scheduler-service.spec.ts` with egress passthrough, topic selection +
  default, back-compat (old partial event), and validation/negative cases. *(BL-329-200, -201)*
- **Validation / close-out:** `validate_deliverable.sh`, verification, retro, key-learnings, publication.
  *(BL-329-500, -501)*

---

## 6. Acceptance Criteria (sprint-level)

- A schedule whose `event.egress = { connector: 'twitch', destination: 'twitch', channel: '#x' }` is emitted
  by `executeSchedule` with that **exact** egress (no `system` overwrite) — proven by a test.
- A schedule with `topic: '<governed-topic>'` is published on that topic; a schedule with **no** `topic` is
  published on `internal.ingress.v1` — proven by asserting the publisher subject per schedule.
- A legacy `ScheduleDoc` (old partial `event`, no `topic`) still emits an `internal.ingress.v1` event with
  `egress: { destination: 'system', connector: 'system' }` (back-compat test).
- `create_schedule` rejects an event whose `type` / required fields are malformed and rejects an unknown
  `topic` (validation/negative tests).
- Server-owned fields (`correlationId`, `traceId`, `ingress.ingressAt`, `routing`) are always set by the
  scheduler regardless of author input.
- `architecture.yaml` scheduler `topics.publishes` matches what the scheduler can now emit; full Jest suite
  green; no regression in existing scheduler tests.

---

## 7. Testing Strategy (AGENTS.md §5, Jest)

- **Unit (schema):** Zod authoring schema accepts a full event (incl. egress/identity/candidates/qos),
  applies the `topic` default, and rejects malformed `type` / unknown `topic`.
- **Integration (`/tick`):** extend `tests/apps/scheduler-service.spec.ts`:
  - egress passthrough (Twitch) — assert `publishJson` event egress equals author input.
  - topic selection — assert `createMessagePublisher` is called with the schedule's topic; default path
    asserts `internal.ingress.v1`.
  - back-compat — a stored old-shape doc still yields `internal.ingress.v1` + `system` egress.
  - server-owned fields still populated (correlationId/ingress/routing).
- **Negative/edge:** unknown topic rejected at `create_schedule`; empty/omitted `event.egress` → `system`;
  multiple due schedules with different topics each publish to the right subject.
- **Mocks:** reuse the existing message-bus + Firestore mocks; no live infra.

---

## 8. Validation (AGENTS.md §2.6 — `validate_deliverable.sh`)

`planning/sprint-329-bf2d2b/validate_deliverable.sh` (real, idempotent, logically passable):
1. `npm ci` (fallback `npm install`, logged).
2. `npm run build` — production + test code compiles.
3. `npm test` — full suite incl. the new scheduler tests.
4. `npm run release:dry -- patch` — assert `architecture.yaml` / `package.json` / `package-lock.json`
   version agreement (no mutation).
5. Targeted `npx jest tests/apps/scheduler-service.spec.ts`. Exit non-zero on build/test failure.

---

## 9. Deployment Approach

No new runtime services. Changes are confined to `src/apps/scheduler-service.ts` (schema + execution),
type reuse from `src/types/events.ts`, and an **additive** `architecture.yaml` edit (scheduler
`topics.publishes`). Existing build (`Dockerfile.service`) and deploy targets are unaffected. Any
`architecture.yaml` touch is re-validated via `brat config validate`.

---

## 10. Dependencies

- Internal: `src/apps/scheduler-service.ts`, `src/types/events.ts` (`InternalEventV2`, `Egress`,
  `ConnectorType`, `Ingress`, `Identity`, `MessageV1`, `AnnotationV1`, `InternalEventType`),
  `src/services/message-bus/index.ts` (`createMessagePublisher(subject)`), `architecture.yaml` topic catalog.
- Tooling: `brat config validate` for the architecture.yaml change; existing Jest mocks.
- External: none new.

---

## 11. Risks & Mitigations

- **Over-permissive authoring (primary):** letting an author set arbitrary envelope fields could forge
  identity/trace. → Whitelist the author-settable subset; server always owns `correlationId`/`traceId`/
  `ingress.ingressAt`/`routing`.
- **Topic governance drift (Law #2):** emitting on undeclared topics violates the canonical catalog. →
  Validate `topic` against architecture.yaml; update scheduler `publishes`; re-validate (OD-1 / BL-329-100/101).
- **Back-compat break:** stored old-shape docs must keep working. → Authoring schema treats new fields as
  optional; defaults preserve today's behavior; dedicated back-compat test.
- **Twitch delivery assumptions:** the scheduler only *addresses* egress; actual delivery is ingress-egress's
  job. → No delivery changes; test asserts the emitted event, not end-to-end Twitch send.

---

## 12. Open Decisions (need owner input)

- **OD-1 — Topic allow-list scope.** Should `topic` be validatable against the **entire** governed topic
  catalog (architecture.yaml ~L88–177) and the scheduler declared as a broad producer, or restricted to a
  **curated subset** (e.g. `internal.ingress.v1`, `internal.egress.v1`, `internal.finalize.v1`)?
  **Plan of Record:** validate against the governed catalog and update scheduler `topics.publishes` to the
  curated subset actually needed (start narrow; widen with evidence). Owner may override.
- **OD-2 — Author-settable field whitelist.** Confirm which `InternalEventV2` fields are author-settable vs
  server-owned. **Plan of Record:** author-settable = `type, egress, payload, message, annotations, identity,
  candidates, qos, externalEvent, metadata` (and optional `ingress` overrides); server-owned =
  `v, correlationId, traceId, ingress.ingressAt/source/connector defaults, routing`.

---

## 13. Definition of Done (AGENTS.md §3)

- Project-wide DoD met: adheres to `architecture.yaml`; no TODOs/placeholders in prod paths; tests for all
  new behavior; `npm run build` + `npm test` pass; `CHANGELOG.md` updated; every change traces to a
  BL-329-NNN item + a `request-log.md` entry.
- `validate_deliverable.sh` present and logically passable.
- Verification, retro, key-learnings authored; branch pushed; PR attempted and recorded (Rules S12/S13).
- Owner says **"Sprint complete."** (or **"Force complete sprint."**) (Rule S2).

---

## 14. Planning Gate

This plan + `backlog.yaml` are the **input** to the sprint. **No implementation code is written until the
owner approves and says "Start sprint"** (Rule S1, AGENTS.md §2.4). Please confirm **OD-1** and **OD-2**.
