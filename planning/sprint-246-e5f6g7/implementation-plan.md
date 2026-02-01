# Implementation Plan – sprint-246-e5f6g7

## Objective
Update the `query-analyzer` service to skip analysis for very short messages (< 3 tokens) to save LLM costs.

## Scope
- Modify `src/apps/query-analyzer.ts` to include a token count check.
- Messages with < 3 tokens will bypass `analyzeWithLlm` and proceed directly via `this.next()`.

## Deliverables
- Code changes in `src/apps/query-analyzer.ts`.
- Updated test in `src/apps/query-analyzer.test.ts` to verify the short-circuit behavior.

## Acceptance Criteria
- Incoming events with message text like "Hi", "Hello!", "Yo" (less than 3 tokens) are NOT analyzed by the LLM.
- The service logs that it is skipping analysis due to short message length.
- The message is passed to the next service in the pipeline using `BaseServer.next()`.

## Testing Strategy
- Unit tests in `src/apps/query-analyzer.test.ts`.
- Add a test case for a 1-token message and a 2-token message.
- Verify that `analyzeWithLlm` is not called for these cases (using mocks).

## Implementation Details
We will add `js-tiktoken` as a dependency to accurately count tokens.
We will use the `gpt-4o` encoding (cl100k_base) for consistency with the models being used.

```typescript
import { encodingForModel } from "js-tiktoken";
const enc = encodingForModel("gpt-4o");
const tokens = enc.encode(text);
if (tokens.length < 3) {
  return this.next(msg, "OK");
}
```

## Definition of Done
- Code matches project style.
- Tests pass.
- `validate_deliverable.sh` succeeds.
- PR created.
