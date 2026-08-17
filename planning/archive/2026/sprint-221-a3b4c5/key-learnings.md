# Key Learnings – sprint-221-a3b4c5

- **Twitch Helix Whispers**: The Helix API for whispers requires both `from_user_id` and `to_user_id`. It is more reliable than IRC whispers for bots.
- **Scope Requirements**: `user:manage:whispers` scope is mandatory for the sender account.
- **Egress Routing**: The `egress.type` property in `EnvelopeV1` provides a flexible way to support multiple delivery modes (chat, DM, etc.) without cluttering the main event payload.
- **Backward Compatibility**: Defaulting `egress.type` to `chat` ensures that existing flows continue to work without modification.
