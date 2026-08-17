# Implementation Plan – sprint-159-f6g7h8

## Objective
- Exclude the current user message from rendered conversation history in LLM prompts to eliminate redundancy.

## Scope
- LLM Bot processor prompt rendering logic.

## Deliverables
- `src/services/llm-bot/processor.ts`: Fixed rendering flow.
- `tests/services/llm-bot/history-redundancy.test.ts`: Regression test.

## Acceptance Criteria
- Current user message appears in `[Input]` but NOT in `[Conversation State / History]`.
- History summary accurately reflects prior exchanges count.
- Current message is still persisted to memory for future turns.

## Testing Strategy
- Automated unit tests via Jest.
- Full validation via `validate_deliverable.sh`.

## Definition of Done
- Adheres to project-wide DoD.
