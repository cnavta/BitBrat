# Deliverable Verification – sprint-302-a1b2c3

## Completed
- [x] Added 'instruction' to `AnnotationKindV1` in `src/types/events.ts`.
- [x] Updated `buildCombinedPrompt` in `src/services/llm-bot/processor.ts` to include 'instruction' annotations.
- [x] Updated `extractPrompt` in `src/apps/llm-bot-service.ts` for consistency.
- [x] Created reproduction test `tests/services/llm-bot/instruction-annotation.spec.ts` and verified the fix.
- [x] Verified that existing processor tests still pass.

## Partial
- None

## Deferred
- None

## Alignment Notes
- The 'instruction' annotation was being injected in 'adventure' mode but was ignored by the prompt assembly; this is now resolved.
