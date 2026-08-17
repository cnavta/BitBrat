# Execution Plan – sprint-264-08104f

## Objective
- Implement the TA recommendation to add a dedicated `disposition-engine` that turns recent `query-analyzer` message annotations into ephemeral per-user disposition snapshots, publishes those snapshots through shared state, and lets `llm-bot` consume them as short-lived behavioral context without permanently labeling users.

## Scope
### In Scope
- Add the `disposition-engine` service, its event/state contracts, and the required `architecture.yaml`/config/deployment updates.
- Emit `internal.user.disposition.observation.v1` from `query-analyzer` when analysis exists and a usable `userKey` can be derived.
- Persist short-lived analyzer observations in Firestore with idempotent document IDs, TTL support, and explicit event-time filtering.
- Recompute rolling disposition indicators (`supportivenessIndex`, `frictionIndex`, `agitationIndex`, `spamIndex`, `safetyConcernIndex`, `confidence`) over the TA-defined dual-bounded window and publish `user.disposition.<userKey>` snapshots through `internal.state.mutation.v1`.
- Optionally emit `internal.user.disposition.updated.v1` behind configuration/feature flags for moderation or dashboard consumers.
- Extend `llm-bot` to load or receive disposition context, add a `disposition` annotation/profile input, and apply de-escalation, humor suppression, and tool-caution behavior without overriding message-level risk handling.
- Add tests, validation updates, and documentation/config coverage for the new service and all touched integrations.

### Out of Scope
- Permanent reputation scoring, `toxic` labels, or any writes that merge transient disposition into canonical user records.
- Automated bans, shadow bans, or irreversible moderation actions based only on rolling disposition.
- New operator/dashboard UI implementation beyond the service contracts/events needed to support future consumers.
- Storage of raw message text in disposition collections unless later explicitly approved and justified.
- Phase-4 automation from the TA document unless the sprint scope is formally amended and approved.

## Deliverables
- `disposition-engine` application entrypoint, aggregation/scoring modules, persistence access layer, and automated tests.
- Shared TypeScript contracts/config for disposition observation events, snapshot payloads, update events, state keys, and rollout flags.
- `query-analyzer` changes for non-blocking observation emission and deterministic `userKey` derivation.
- `llm-bot` integration for disposition-aware response shaping, behavior flags, and regression coverage.
- `architecture.yaml` delta plus deployment/runtime artifacts for the new service (for example the service Dockerfile and Cloud Build configuration if required by existing patterns).
- Validation/documentation updates, including `validate_deliverable.sh` coverage for the touched services and sprint verification traceability.

## Acceptance Criteria
- `architecture.yaml` defines `disposition-engine` as a Cloud Run Node 24.x service that consumes `internal.user.disposition.observation.v1` and publishes `internal.state.mutation.v1` plus the optional update topic.
- `query-analyzer` publishes a disposition observation event only after successful analysis and only when a valid `userKey` can be resolved; emission failures are logged and do not block the main routing path.
- Firestore observation persistence uses an idempotent document key (user + correlation), stores only the approved behavioral fields/metadata, applies TTL via `expireAt`, and still filters active observations by `observedAt >= cutoff`.
- The recomputed snapshot includes the TA-defined band, indicators, flags, message-count window metadata, confidence, and expiry semantics, and naturally resets to `insufficient-signal`/`neutral` once recent signal expires.
- Shared state writes land under `user.disposition.<userKey>` through `internal.state.mutation.v1`; optional update events are gated by config.
- `llm-bot` uses disposition context as a lower-priority behavioral signal than current-message risk/intent/tone and never lets disposition weaken current-message safety decisions.
- No permanent `toxic` flag, no mutation of the canonical user profile with transient disposition state, and no reliance on deprecated code paths.
- Relevant automated tests pass and `validate_deliverable.sh` remains logically passable for the delivered scope.

## Testing Strategy
- Unit tests for `userKey` derivation precedence, observation payload normalization, window trimming, score clamping, band classification priority, flag generation, and low-signal/late-event handling.
- `query-analyzer` tests covering successful emission, missing-identity skip behavior, and non-blocking failure logging alongside preserved short-circuit logic.
- `disposition-engine` service tests covering dedupe/idempotency, Firestore TTL field persistence, active-window querying, recompute failure handling, snapshot mutation publication, and optional update-topic publication.
- `llm-bot` tests covering disposition annotation ingestion, prompt/behavioral guidance changes, humor suppression, tool restriction, and risk-precedence over disposition.
- Integration/regression checks for the end-to-end flow: analyzed event → observation store → snapshot mutation → `llm-bot` consumption (with mocks or emulator-backed resources as appropriate for the repo).
- Final validation via the updated `validate_deliverable.sh` and all relevant Jest suites for modified services/modules.

## Deployment Approach
- Update `architecture.yaml` first so implementation tracks the canonical service contract.
- Roll out behind TA-aligned configuration flags such as `DISPOSITION_ENABLED`, `DISPOSITION_WINDOW_MS`, `DISPOSITION_MAX_EVENTS`, `DISPOSITION_MIN_EVENTS`, `DISPOSITION_SNAPSHOT_TTL_MS`, `DISPOSITION_PROMPT_INJECTION_ENABLED`, and `DISPOSITION_MODERATION_ASSIST_ENABLED`.
- Sequence delivery as: contracts/config baseline → `query-analyzer` emission → `disposition-engine` persistence/aggregation/state publication → `llm-bot` consumption → optional advisory update events/observability → validation and closeout.
- Keep moderation-assist and operator-facing surfaces disabled by default until the passive capture and response-shaping slices are validated.

## Dependencies
- Explicit user approval of this execution plan and backlog before any production code changes begin.
- Existing BaseServer messaging/resource patterns for Pub/Sub/NATS, Firestore, and logging.
- Current auth enrichment behavior for stable `identity.user.id` / external platform identity resolution.
- Existing `state-engine` mutation contract in `src/types/state.ts` and `src/apps/state-engine.ts`.
- Firestore TTL support (or documented emulator/test fallback) for the new observation collection.
- Architecture boundaries defined in `architecture.yaml` and the attached 2026-04-01 TA document.

## Definition of Done
- Project-wide DoD is satisfied.
- The delivered implementation follows the TA requirement that disposition remains ephemeral, contextual, and separate from permanent user profile data.
- No production code path contains placeholder scoring, TODOs, or fake moderation outcomes.
- Relevant tests for `query-analyzer`, `disposition-engine`, shared contracts/state mutation, and `llm-bot` pass.
- `validate_deliverable.sh` is updated so the new service and integrations are verifiable from the repository workflow.
- Verification/publication artifacts clearly describe completed scope, any explicitly accepted gaps, and traceability back to sprint backlog items.

## Phased Execution Order
1. Approval gate and canonical architecture/config contract alignment.
2. Upstream observation-event emission from `query-analyzer`.
3. `disposition-engine` persistence, windowed scoring, and shared-state publication.
4. Downstream `llm-bot` disposition consumption and response-shaping integration.
5. Optional advisory update events, observability, validation, and sprint closeout artifacts.
