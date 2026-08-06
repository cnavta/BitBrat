# Implementation Plan – sprint-308-f1e2d3

## Objective
- Improve prompt generation by allowing one or more named contexts to be added to the `PromptSpec`, keeping it semantically separate from the rest of the prompt and replacing ad-hoc serialized JSON.

## Scope
- `src/common/prompt-assembly/types.ts`: Update types to include `NamedContext` and update `PromptSpec`.
- `src/common/prompt-assembly/assemble.ts`: Implement rendering logic for `contexts`.
- `src/services/llm-bot/processor.ts`: Integrate named contexts for Story Engine enriched data.
- `tests/prompt-assembly/`: Add comprehensive tests.

## Execution Plan
1. **Phase 1: Type Definition** [x]
   - [x] Update `src/common/prompt-assembly/types.ts` to include `NamedContext` interface.
   - [x] Extend `PromptSpec` with `contexts?: NamedContext[]`.
   - [x] Add `contexts` to `AssembledPromptSections`.

2. **Phase 2: Assembler implementation** [x]
   - [x] Implement `renderContexts` in `src/common/prompt-assembly/assemble.ts`.
   - [x] Update `assemble` function to include the `contexts` section in the canonical v3 order.
   - [x] Implement priority sorting and truncation logic for the new section.

3. **Phase 3: Story Engine Integration** [x]
   - [x] Identify where Story Engine enriched data is currently added to the prompt in `src/services/llm-bot/processor.ts`.
   - [x] Update `PromptSpec` construction to use `NamedContexts` for this data.
   - [x] Ensure the data is semantically labeled (e.g., "Story Context" or "World State").

4. **Phase 4: Testing & Validation** [x]
   - [x] Create unit tests in `tests/prompt-assembly/assemble.spec.ts` to verify the new rendering and truncation behaviors.
   - [x] Verify Story Engine data integration in `processor.ts` via integration tests or manual check.
   - [x] Run `validate_deliverable.sh` to ensure no regressions.

5. **Phase 5: Publication** [x]
   - [x] Push changes to the feature branch.
   - [x] Create a Pull Request.

## Deliverables
- Updated `PromptSpec` types.
- Enhanced `assemble` function with `contexts` support.
- Unit tests for new functionality.

## Acceptance Criteria
- `PromptSpec` supports an optional array of `NamedContext` objects.
- `assemble()` renders a new `[Contexts]` section in the correct order (after `Conversation State`, before `Constraints`).
- Each context is rendered with its name and content (fenced if multiline or object).
- Contexts are sorted by priority.
- Contexts are subject to truncation/dropping if `maxTotalChars` is exceeded (lower priority dropped first).
- Story Engine enriched data in `processor.ts` uses the new `NamedContexts` instead of being serialized into `input.context` or `systemPrompt`.

## Testing Strategy
- Unit tests for `assemble()` in `assemble.spec.ts`.
- Mocking different combinations of named contexts and truncation scenarios.

## Definition of Done
- Code implemented and passes linting.
- All new and existing tests pass.
- `validate_deliverable.sh` passes.
- PR created.
