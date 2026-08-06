# Retro – sprint-308-f1e2d3

## What Worked
- The `PromptSpec` extension with `NamedContexts` provides a much cleaner semantic structure for enriched data.
- Structured mapping of `adventure_context` annotations significantly improved the readability of the prompt for LLMs, separating metadata from the scene and choices.
- The iterative truncation logic successfully handles complex multi-context scenarios.

## What Didn't
- Initial implementation had a bug where `contexts` was overwritten in the `workingSpec` due to a duplicate key in the object literal.
- `openaiAdapter` was initially missed, leading to dropped context sections in the final payload.
- The unit tests for truncation initially had a cap that was too low to keep even one context, causing unexpected "- None provided." results.

## Lessons Learned
- Always verify all adapters when adding a new top-level section to `AssembledPromptSections`.
- Be careful with object literal property names when merging/updating complex objects like `PromptSpec`.
- Use realistic character counts in truncation tests to avoid dropping all items if that's not the goal.
