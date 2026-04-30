# Implementation Plan – sprint-302-a1b2c3

## Objective
- Include 'instruction' annotations in the prompt assembly process and update the `AnnotationKind` type definition.

## Scope
- `src/types/events.ts`: Update `AnnotationKind` (if it exists) or `AnnotationV1`.
- `src/services/llm-bot/processor.ts`: Update `buildCombinedPrompt` to include 'instruction' annotations.
- `src/common/prompt-assembly/`: Check if updates are needed in types or assembly logic.

## Deliverables
- Code changes in `src/types/events.ts` and `src/services/llm-bot/processor.ts`.
- Tests verifying that 'instruction' annotations are correctly assembled into the prompt.

## Acceptance Criteria
- 'instruction' annotations added to an event are present in the final prompt sent to the LLM.
- The `AnnotationKind` type includes 'instruction'.
- `validate_deliverable.sh` passes.

## Testing Strategy
- Create a unit test for `buildCombinedPrompt` (or a higher-level integration test if easier) that adds an 'instruction' annotation and verifies it appears in the output.

## Definition of Done
- Code quality follows project standards.
- Tests pass.
- `validate_deliverable.sh` is logically passable.
- PR created.
- Retro and Key Learnings documented.
