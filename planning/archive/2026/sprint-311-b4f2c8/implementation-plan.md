# Implementation Plan – sprint-311-b4f2c8

## Objective
- Fix the `brat setup` command to correctly serialize the `logic` property of routing rules as JSON strings.
- Align the routing rule structure with the `RuleDoc` interface expected by `RuleLoader`.

## Scope
- `tools/brat/src/cli/setup.ts`

## Deliverables
- Corrected `tools/brat/src/cli/setup.ts`.
- Updated tests (if applicable).

## Acceptance Criteria
- Routing rules in Firestore have `logic` as a string.
- Routing rules follow the structure: `{ enabled: boolean, priority: number, logic: string, routing: { stage: string, slip: [...] } }`.

## Testing Strategy
- Update unit tests in `tools/brat/src/cli/setup.test.ts` to verify the serialization and structure.
- Execute `validate_deliverable.sh`.

## Definition of Done
- Code changes implemented.
- Tests pass.
- PR created.
- Sprint artifacts (verification report, retro) completed.
