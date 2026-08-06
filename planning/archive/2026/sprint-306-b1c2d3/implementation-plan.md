# Implementation Plan – sprint-306-b1c2d3

## Objective
- Ensure tools are called with the BitBrat Platform User ID instead of the streaming platform username.

## Scope
- `src/common/prompt-assembly/assemble.ts`: Update `renderRequestingUser` to include `userId`.
- `tests/prompt-assembly/`: Add validation tests.

## Deliverables
- Code fix in prompt assembly.
- Unit tests for prompt rendering.
- Updated documentation (Sprint artifacts).

## Acceptance Criteria
- [Requesting User] section in the assembled prompt contains a "User ID" field when `userId` is provided in the `PromptSpec`.
- Tool calls from the LLM use the value provided in the "User ID" field for `userId` arguments.

## Testing Strategy
- Unit test in `tests/prompt-assembly/userId-rendering.spec.ts` to verify that `userId` is rendered correctly in the prompt.
- End-to-end verification (if possible) or logic verification in `processor.spec.ts`.

## Definition of Done
- `validate_deliverable.sh` passes.
- PR created and linked.
- Sprint artifacts (manifest, plan, log, report, retro) completed.
