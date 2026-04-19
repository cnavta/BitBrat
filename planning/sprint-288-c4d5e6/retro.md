# Retro – sprint-288-c4d5e6

## What Worked
- Reproduction script quickly identified the root cause: `combinedPrompt` (instructions) was being saved as the human message in history.
- Existing tests provided a good safety net.
- Sprint protocol ensured clear documentation of the issue and fix.

## What Didn't
- Initial attempt to run the reproduction script failed due to complex types in `BaseServer`, resolved by using a simpler mock.

## Improvements
- Consider adding more granular tests for automated events where `evt.message.text` is missing.
