# Deliverable Verification – sprint-266-db047e

## Completed
- [x] Migrated rule loading and rule creation/mapping to the wrapped `RuleDoc.routing` contract.
- [x] Updated shared routing execution/helpers (`RouterEngine`, `slip`, `dlq`, `BaseServer`) to use `InternalEventV2.routing` consistently.
- [x] Updated affected service entrypoints/helpers (`event-router`, `llm-bot`) and downstream fixtures/tests to the wrapped routing shape.
- [x] Preserved prior-slip ordering when query-analyzer promotes a pending staged route by appending finalized slip history into `routing.history`.
- [x] Validated the deliverable with `planning/sprint-266-db047e/validate_deliverable.sh`, covering install, build, lint, and the wrapped-routing/query-analyzer regression suites.
- [x] Published the sprint branch and created PR `#180` (`https://github.com/cnavta/BitBrat/pull/180`).

## Partial
- [ ] None.

## Deferred
- [ ] None.

## Alignment Notes
- Added `stage` support to the `create_rule` admin tool so new rule documents can be created in the required wrapped routing shape.
- No backward-compatibility path was added for legacy top-level `stage` / `routingSlip` rule data; validation now expects the wrapped routing contract.
- The sprint-specific validation script intentionally skips local runtime startup and cloud dry-run deployment unless the environment supplies the prerequisites needed to make those steps meaningful (`PROJECT_ID`, local infra tooling), because this sprint changed routing/runtime logic only and introduced no infrastructure changes.