# Execution Plan – sprint-263-60adf2

## Objective
- Implement the Technical Architecture recommendation so `query-analyzer` `intent`, `tone`, and `risk` annotations influence `llm-bot` prompting, tool use, response gating, routing, and downstream observability without breaking `InternalEventV2`.

## Scope
### In Scope
- Add a behavioral control layer in `llm-bot` that derives a normalized `BehaviorProfile` from event annotations.
- Feed behavioral guidance into prompt assembly, response-mode selection, candidate metadata, and prompt logging.
- Add risk-aware gating, safe refusal handling, decision annotations, and behavioral tool filtering in `llm-bot`.
- Align `query-analyzer` annotation payloads and preserve its existing spam/high-risk short-circuit behavior.
- Add router rule/config support for annotation-aware branching using existing `has_annotation(...)` support.
- Add tests, validation updates, and documentation/config coverage for the new behavior.
- Remediate the local Docker Compose shared-network configuration so `bitbrat-network` is treated consistently as the pre-created external network and local support containers attach to it without warnings.

### Out of Scope
- Breaking changes to `InternalEventV2` or topic contracts.
- New moderation or escalation microservices beyond annotations/routing decisions.
- Phase 4 policy externalization (Firestore-backed policy packs, versioned safety docs, dynamic policy loading) unless the sprint finishes phases 1-3 early and approval is updated.
- Provider/model migrations unrelated to behavioral controls.

## Deliverables
- `llm-bot` behavioral normalization module (new `behavior-profile` helper plus associated unit tests).
- `llm-bot` processor updates for behavioral prompt constraints, response strategy, gating, tool filtering, metadata enrichment, and decision annotations.
- `query-analyzer` alignment changes and tests for stable annotation payloads and short-circuit compatibility.
- Router rule/config/example updates demonstrating annotation-based branching where beneficial.
- Observability/config updates covering structured logs, prompt-log enrichment, and rollout flags.
- Validation updates (`validate_deliverable.sh`, relevant Jest coverage, and sprint verification artifacts).
- Local Docker Compose base-file remediation plus regression coverage for external shared-network ownership.

## Acceptance Criteria
- `BehaviorProfile` is derived once per event from annotations, with defensive defaults for missing or malformed payloads.
- `risk` precedence over `intent`, `tone`, and personality overlays is enforced and covered by tests.
- Prompt assembly includes explicit behavioral guidance without dumping raw annotation JSON into the model prompt.
- Medium/high-risk handling gates generation and tool use according to the approved policy matrix; high-risk traffic never enters the normal generation path.
- `llm-bot` emits decision annotations and candidate metadata that preserve response mode and safety decisions for downstream inspection.
- Router behavior can branch on `intent`/`risk` via `has_annotation(...)` without event-schema changes.
- Feature flags support phased rollout and safe fallback behavior.
- Relevant tests pass and the sprint validation script remains logically passable.
- Local Docker Compose config no longer emits the pre-existing shared-network ownership warning during normal local startup.

## Testing Strategy
- Unit tests for annotation extraction, defaulting, tone bucketing, response-mode selection, and policy precedence.
- `llm-bot` processor tests for prompt constraints, gating outcomes, safe refusal paths, behavioral tool filtering, metadata enrichment, and prompt-log payloads.
- `query-analyzer` tests for standardized behavioral annotations and preserved short-circuit behavior.
- Router tests for annotation-aware rule evaluation/mapping/loading using representative `spam`, `high-risk`, and `meta` routes.
- Integration/regression fixtures covering: ordinary question, critique with hostile tone, meta request, spam, medium-risk harassment, medium-risk self-harm, and high-risk block.
- Final validation via updated sprint validator plus all relevant Jest suites for modified services/modules.
- Static regression coverage for `docker-compose.local.yaml` shared-network ownership and base-service attachment.

## Deployment Approach
- Gate rollout behind configuration flags:
  - `LLM_BOT_BEHAVIORAL_GUIDANCE_ENABLED`
  - `LLM_BOT_BEHAVIORAL_TOOL_FILTER_ENABLED`
  - `LLM_BOT_BEHAVIORAL_GATING_ENABLED`
  - `LLM_BOT_RISK_RESPONSE_MODE`
  - `LLM_BOT_TONE_STYLE_ENABLED`
- Sequence release work as: annotation contract alignment → `llm-bot` behavioral guidance → `llm-bot` safety/tool controls → router rule enablement.
- Reuse existing topics and `InternalEventV2.annotations`; no schema migration is expected.

## Dependencies
- Explicit user approval of this plan/backlog before coding starts.
- Existing `llm-bot`, `query-analyzer`, and router test harnesses/fixtures.
- Current Firestore prompt logging and configuration loading patterns.
- Architecture boundaries defined in `architecture.yaml`.

## Definition of Done
- Project-wide DoD is satisfied.
- No behavior-control change allows tone or intent to weaken `risk`-driven safety outcomes.
- No production code path contains placeholder refusal logic or TODOs.
- Relevant unit/service/router tests pass.
- `validate_deliverable.sh` is updated to cover build/test/verification for the touched services.
- Verification/publication artifacts document the delivered scope and any explicitly accepted exceptions.

## Phased Execution Order
1. Contract and rollout-flag baseline.
2. `llm-bot` prompt-aware behavioral integration.
3. `llm-bot` safety gating and behavioral tool filtering.
4. `query-analyzer` alignment and router optimization.
5. Observability, validation, documentation, and sprint closeout.