# Retro – sprint-165-b4e5f6

## What worked
- The JsonLogic custom operators (`has_role`, `ci_eq`) made the routing logic very expressive and easy to implement.
- Integration tests for the routing engine allowed for immediate verification of the new rule document.

## What didn't
- Identifying the correct tag for "first message of the stream" required searching through previous sprint documentation and code, but `FIRST_SESSION_MESSAGE` was eventually found.
