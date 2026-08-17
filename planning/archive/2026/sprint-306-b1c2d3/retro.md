# Sprint Retro – sprint-306-b1c2d3

## What Worked
- **Fast Reproduction**: Creating a unit test in the prompt assembler proved the omission quickly.
- **Traceable Fix**: The fix in `assemble.ts` was localized and easily verified across both the assembler and the processor.

## What Didn't
- **Assumption of Field Presence**: We assumed that because `userId` was in the `PARequestingUser` interface, it was being rendered. In reality, the rendering logic was trailing behind the type definitions.

## Improvements for Next Sprint
- Always check both the data model AND the rendering/serialization logic when adding new context fields.
