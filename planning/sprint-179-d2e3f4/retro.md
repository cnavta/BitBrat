# Sprint Retro – sprint-179-d2e3f4

## What worked
- Reusing patterns from Twitch and Discord made implementation straightforward.
- Twilio Conversations SDK WebSocket approach aligns well with the platform's real-time goals.

## What didn't work
- The hardcoded egress routing in `IngressEgressServer` is starting to feel cluttered. A future sprint should refactor this to be purely registry-driven via `ConnectorManager`.
- Git staging issues with deleted files from other sprints required manual correction.

## Key Learnings
- Twilio's JWT generation requires specific grants for Conversations.
- `messageAdded` on the client level is useful for global message capture across conversations.
