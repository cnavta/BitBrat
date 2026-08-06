# Retro – sprint-302-a1b2c3

## What Worked
- The investigation was straightforward once the missing filter in `buildCombinedPrompt` was identified.
- Reproduction test clearly demonstrated the failure and verified the fix.
- Type update in `AnnotationKindV1` ensures better developer experience and type safety.

## What Didn't Work
- Initial reproduction test failed with an unrelated error due to missing mocks for `resolvePersonalityParts`, which was a distraction but quickly fixed.

## Lessons Learned
- Always check that all annotation kinds used in the logic are also handled in the prompt assembly stage.
- Mocking complex service dependencies (like `personality-resolver`) requires careful initialization in tests.
