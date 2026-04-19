# Implementation Plan – sprint-288-c4d5e6

## Objective
- Fix massive repetition in LLM prompts by ensuring that conversation history only contains the actual user query and assistant response, rather than the entire instruction set (Task/Prompt annotations).

## Scope
- `src/services/llm-bot/processor.ts`: Update memory append logic.
- `repro_repetition.ts`: Verify the fix.

## Deliverables
- Modified `src/services/llm-bot/processor.ts`.
- Passing reproduction test.

## Acceptance Criteria
- When a user sends a message, only that message (and the assistant's response) is added to the short-term memory (history).
- Subsequent prompts do not repeat the instructions from previous turns in the history section.
- If `evt.message.text` is missing, a fallback to `combinedPrompt` is acceptable for the first turn, but should be avoided if it leads to excessive repetition. (Actually, we'll prefer `evt.message.text` and fallback to `combinedPrompt` if absolutely necessary, but we will ensure it's not being double-counted).

## Testing Strategy
- Use the created `repro_repetition.ts` to verify that the second turn's history contains the first turn's actual message (`Hello`) instead of the first turn's instructions.

## Definition of Done
- Code quality: Adheres to project constraints.
- Testing: Reproduction script passes.
- Traceability: Changes logged in `request-log.md`.
