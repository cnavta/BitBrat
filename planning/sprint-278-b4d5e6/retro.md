# Retro – sprint-278-b4d5e6

## What Worked
- The transition to `InternalEventV2` with explicit `connector` fields went smoothly.
- The use of a `targetChannel` abstraction in `processEgress` simplified the routing logic across different platforms.
- Mocking the different ingress/egress clients in tests made it easy to verify the routing logic.

## What Didn't Work
- Initial oversight of `TwitchIrcClient` missing the `connector` field led to a compilation error during testing.
- Heuristics were initially shadowing the explicit `egress.destination` in cross-connector scenarios, requiring a fix in `ingress-egress-service.ts`.

## Improvements for Next Time
- Ensure all types are updated and verified by the compiler (e.g., `npm run build`) before running targeted tests.
- Explicitly test cross-connector scenarios earlier in the development cycle.
