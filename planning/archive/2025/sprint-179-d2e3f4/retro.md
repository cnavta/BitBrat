# Sprint Retro – sprint-179-d2e3f4

## What worked
- Reusing patterns from Twitch and Discord made implementation straightforward.
- Twilio Conversations SDK WebSocket approach aligns well with the platform's real-time goals.

## What didn't work
- Initial message receipt failed because SMS conversations often start with the bot in an "invited" state rather than "joined".
- Hardcoded egress routing in `IngressEgressServer` is cluttered.
- `INFO` logs were initially too sparse to diagnose connection lifecycle issues.

## Key Learnings
- Twilio conversations require active `join()` if the bot is auto-invited by a phone number mapping.
- `synchronized` is the key state in `@twilio/conversations` that signals readiness, not just a WebSocket `connected` event.
- Diagnostic endpoints like `/_debug/twilio` are essential when working with third-party WebSockets that are hard to observe from external platform logs.
