# Implementation Plan – sprint-158-e4f5g6

## Objective
- Exclude the current user message from the rendered conversation history in the LLM prompt.

## Scope
- LLM Bot processor (`src/services/llm-bot/processor.ts`)
- Conversation history rendering logic.

## Deliverables
- Code changes to `processor.ts` to filter out current `incoming` messages from `conversationState`.
- Unit tests verifying the history does not contain the current message.

## Acceptance Criteria
- Assembled prompts show previous exchanges in [Conversation State / History].
- Assembled prompts DO NOT show the current user message in [Conversation State / History].
- Current user message is still present in [Input].
- Current user message is still persisted to memory for future exchanges.

## Testing Strategy
- Create a reproduction test case in `tests/services/llm-bot/history-redundancy.test.ts`.
- Verify the test fails before the fix.
- Verify the test passes after the fix.

## Definition of Done
- Adheres to project-wide DoD.
- PR created.
