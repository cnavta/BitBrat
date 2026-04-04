# Execution Plan – sprint-266-db047e

## Objective
- Analyze, implement, and validate the migration from top-level `routingSlip` / rule `stage` fields to the wrapped `Routing` model so matched routing rules fully replace an event's stage and slip through `InternalEventV2.routing` and `RuleDoc.routing`.

## Scope
### In Scope
- Audit and update shared routing contracts, helpers, and service code that still reference `event.routingSlip`, `rule.routingSlip`, or top-level `rule.stage`.
- Add or update regression tests that reproduce the current breakage and cover the intended replacement semantics for both routing stage and routing slip.
- Update router rule loading/mapping, router-engine matching, BaseServer routing progression, DLQ generation, and impacted service entrypoints/utilities to the wrapped routing contract.
- Update sprint tracking artifacts to reflect the migration plan, execution progress, and verification outcome.

### Out of Scope
- Firestore data migration or compatibility adapters for legacy rule documents; the user will update stored documents manually.
- New staged-routing behavior beyond introducing the wrapper shape and preserving the new stage/slip replacement semantics.
- Unrelated router, llm-bot, or infrastructure refactors not directly required by this contract migration.
- Sprint publication/closure steps before implementation, validation, and explicit user approval of this plan.

## Deliverables
- Root-cause analysis captured in sprint artifacts and reflected in the implementation order.
- Updated TypeScript code that consistently uses `InternalEventV2.routing` and `RuleDoc.routing` across routing flows.
- Regression coverage for the new rule/event routing wrapper semantics, including negative and edge scenarios.
- A trackable prioritized YAML backlog for execution and follow-through once implementation is approved.

## Acceptance Criteria
- A matched routing rule supplies `routing.stage` and `routing.slip`, and the router applies both to the outgoing event, replacing any prior routing values.
- Shared routing helpers and service/runtime code no longer depend on top-level `event.routingSlip` or top-level rule `stage` / `routingSlip` fields.
- No backward-compatibility path is introduced for legacy Firestore documents or legacy event routing shapes.
- Relevant routing and downstream service tests fail against the current broken state, then pass after the migration.
- The implementation preserves existing event enrichment behavior while moving routing data to the wrapped contract.

## Testing Strategy
- Add or update a reproducer around rule loading / router-engine behavior to prove the wrapped `routing` rule contract is required and correctly applied.
- Update shared routing helper tests (`slip`, DLQ/base-server behavior where applicable) to assert use of `event.routing.slip` and stage replacement semantics.
- Run all relevant Jest suites covering modified modules, including router rule loading/mapping, router-engine behavior, routing helpers, and any downstream service tests exercising the modified shared code.
- Re-run the reproducer after the fix to confirm both stage and slip replacement semantics hold with no legacy fallbacks.

## Deployment Approach
- Keep the change within the existing Node/TypeScript services and shared routing modules; no infrastructure changes are expected.
- Preserve `architecture.yaml` service boundaries, message-bus topics, and Cloud Run service roles while updating only the routing contract usage.
- Sequence execution as: reproduce current failures → migrate shared contract access → update router rule ingestion/mapping → update downstream services/helpers/tests → validate.

## Dependencies
- Explicit user approval of this execution plan before production code changes begin.
- Current routing contract updates already present in `src/types/events.ts` and partially in `src/services/router/rule-loader.ts`.
- Existing router/routing Jest coverage under `src/services/router/__tests__` and `src/services/routing/__tests__`, plus downstream tests in affected services.
- Repository constraints from `architecture.yaml` and sprint workflow requirements from `AGENTS.md`.

## Definition of Done
- Project-wide DoD is satisfied for the routing-wrapper migration.
- Shared code and impacted services compile against the new wrapped routing contract.
- Regression tests cover the rule/event routing replacement semantics and pass.
- Sprint artifacts clearly document what changed, how it was validated, and any accepted deviations.
- Implementation does not begin until this plan is explicitly approved.

## Proposed Execution Order
1. Reproduce and codify the current contract breakage in targeted automated tests.
2. Migrate shared routing access patterns (`RuleDoc`, `RouterEngine`, `slip`, `BaseServer`, `DLQ`) to the wrapped contracts.
3. Update affected app/service entrypoints and downstream tests to use `event.routing` consistently.
4. Run targeted and related regression suites, then continue with sprint validation/verification artifacts.
