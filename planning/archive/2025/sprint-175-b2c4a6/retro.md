# Retro – sprint-175-b2c4a6

## What Worked
- Rapid identification of the bug through code inspection and reproduction test.
- The new `processor-tools.spec.ts` test provides a solid regression check for tool mapping.

## What Didn't Work
- Initial assumption that `maxSteps` was the issue led to a brief compilation failure. It's important to verify SDK version features when working across different sprints.
- The spread operator `...tool` in `processor.ts` was a "lazy" way to wrap the tool that introduced the field naming bug.

## Lessons Learned
- When wrapping or translating objects between different interfaces (e.g., `BitBratTool` to AI SDK `Tool`), always explicitly map fields instead of relying on property name overlap.
- Always check the `ai` SDK version behavior when changing core LLM calling logic.
