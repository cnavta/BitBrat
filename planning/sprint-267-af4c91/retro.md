# Sprint Retro – sprint-267-af4c91

## What Worked
- The separation of compact aggregates from immutable snapshots significantly simplified the persistence logic.
- Using a shared helper in `BaseServer` for snapshots ensured that all routing-boundary services adopted the new flow consistently.
- Moving sequence assignment to the persistence transaction solved potential race conditions from multiple publishers.

## What Didn't Work
- Initial inline snapshot logic in boundary services was redundant and error-prone; refactoring into a shared helper was necessary.
- Validation of large payloads (Firestore limits) requires strict enforcement at the publisher level to avoid silent drops.

## Future Improvements
- Consider an asynchronous 'cleanup' task to purge expired snapshots while retaining aggregates for longer periods.
- Add an 'audit' tool to reconstruct event history from snapshots for debugging complex routing failures.
