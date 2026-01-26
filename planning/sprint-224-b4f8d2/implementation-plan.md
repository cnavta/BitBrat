# Implementation Plan — sprint-224-b4f8d2

## Objective
Add Mustache-style variable interpolation to `event-router` enrichments and include `BaseServer.config` in the `RuleDoc.logic` execution context.

## Scope
- `event-router` service (`RouterEngine`, `JsonLogicEvaluator`).
- Enrichment fields: `message`, `annotations[].value`, `annotations[].label`, `candidates[].text`, `candidates[].reason`.
- Logic execution context: add `config` field.

## Deliverables
- `package.json` updates (adding `mustache`).
- `src/services/routing/router-engine.ts` updates.
- `src/services/router/jsonlogic-evaluator.ts` updates.
- `src/apps/event-router-service.ts` updates.
- `src/services/routing/__tests__/router-engine-interpolation.spec.ts` (updated with config test).

## Acceptance Criteria
- [ ] Mustache variables in `message` are correctly interpolated.
- [ ] Mustache variables in `annotations` (`label`, `value`) are correctly interpolated.
- [ ] Mustache variables in `candidates` (`text`, `reason`) are correctly interpolated.
- [ ] Context includes event data, `now` (ISO), `ts` (epoch), and `RuleDoc.metadata`.
- [ ] Event data correctly overrides `RuleDoc.metadata` in the context.
- [ ] `BaseServer.config` is accessible in `RuleDoc.logic` (JsonLogic) via the `config` key.
- [ ] Standard project tests pass.

## Testing Strategy
- Unit tests for `RouterEngine` using a mock evaluator and rules with enrichment templates.
- Test cases:
    - Simple variable replacement.
    - Nested property access (e.g., `{{user.displayName}}`).
    - Overriding metadata with event data.
    - Using `now` and `ts`.
    - Edge case: undefined/missing variables (expect empty string).
    - Edge case: null/undefined templates (expect no change).

## Deployment Approach
- Standard Cloud Run deployment via Cloud Build (no changes to deployment scripts required).

## Dependencies
- `mustache` (^4.2.2)
- `@types/mustache` (^4.2.5)

## Definition of Done
- Adheres to project and `architecture.yaml` constraints.
- `npm test` passes.
- All code changes trace back to sprint 224-b4f8d2.
- GitHub PR created.
