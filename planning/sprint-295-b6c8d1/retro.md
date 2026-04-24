# Retro – sprint-295-b6c8d1

## What Worked
- Clear hierarchical strategy from the TA doc made implementation straightforward.
- Propagating `AbortSignal` allowed for clear distinction between tool-level and app-level timeouts.
- Unit testing with `AbortController` worked well to verify "Caller Abort" logic.

## What Didn't Work
- Some existing tests were sensitive to the exact Error message format, requiring small updates.
- Realizing that `event-router` logic for QoS is complex and might need its own focus to avoid regressions in other services.

## Key Learnings
- Coordinated timeouts are critical for preventing "zombie" tool calls.
- `AbortSignal` is a powerful tool for propagating cancellations through multiple layers of abstractions.
- Always check if existing tests depend on specific error strings when refactoring resilience logic.
