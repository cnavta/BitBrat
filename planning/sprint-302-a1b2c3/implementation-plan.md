# Implementation Plan – sprint-302-a1b2c3

## Objective
- Resolve 'instruction' annotation issues, perform gap analysis, and design enrichment-based architecture for the Adventure system.

## Scope
- `src/types/events.ts`: Update `AnnotationKindV1`.
- `src/services/llm-bot/processor.ts`: Update `buildCombinedPrompt`.
- `planning/sprint-302-a1b2c3/gap-analysis.md`: Analyze Phase 1 discrepancies.
- `planning/sprint-302-a1b2c3/technical-architecture-story-enrichment.md`: Design enrichment flow.

## Deliverables
- Code changes for 'instruction' annotations.
- `gap-analysis.md`.
- `technical-architecture-story-enrichment.md`.

## Acceptance Criteria
- 'instruction' annotations are included in LLM prompts.
- Gap analysis is documented.
- Technical architecture document incorporates enrichment patterns to solve identified gaps.
- `validate_deliverable.sh` verifies existence of all docs.

## Testing Strategy
- Create a unit test for `buildCombinedPrompt` (or a higher-level integration test if easier) that adds an 'instruction' annotation and verifies it appears in the output.

## Definition of Done
- Code quality follows project standards.
- Tests pass.
- `validate_deliverable.sh` is logically passable.
- PR created.
- Retro and Key Learnings documented.
