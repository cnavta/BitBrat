# Key Learnings - sprint-291-b4f2a7

- **Twitch IRC**: Multiline messages must be split into multiple `PRIVMSG` calls for proper rendering on the client side.
- **Egress Skip Logic**: Returning `IGNORED` from an egress handler is the correct way to signify an intentional skip (no candidates) without triggering failure alerts or DLQs.
- **Legacy Fallbacks**: When evolving to a candidate-based system (V2), it's important to guard legacy fallbacks so they don't accidentally leak original messages as responses.
