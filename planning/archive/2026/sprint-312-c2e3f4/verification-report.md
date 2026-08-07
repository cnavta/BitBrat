# Deliverable Verification – sprint-312-c2e3f4

## Completed
- [x] Audit `tools/brat/src/cli/setup.ts` and confirm removal of all `routingSlip` references in favor of `routing`.
- [x] Extract `getInitialRoutingRules` for testability.
- [x] Add mandatory `enrichments: {}` to all initial routing rules to strictly follow the `RuleDoc` schema.
- [x] Remove redundant `status: "PENDING"` from `RoutingStepRef` objects.
- [x] Add unit test in `tools/brat/src/cli/setup.test.ts` verifying the exact structure of generated rules.

## Partial
- None.

## Deferred
- None.

## Alignment Notes
- The rules now strictly match the `RuleDoc` interface defined in `src/services/router/rule-loader.ts`.
- The `routing.stage` property is correctly set to 'initial' or 'analysis' as intended by the platform architecture.
