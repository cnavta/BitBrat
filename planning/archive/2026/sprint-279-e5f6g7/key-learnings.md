# Key Learnings – sprint-279-e5f6g7

- **Generic Metadata**: Using `metadata` for `accountType` is a flexible way to support custom egress needs without complicating the top-level `Egress` type further.
- **Identity Multiplicity**: As the platform grows, micro-identity (bot, broadcaster, moderator, etc.) needs become more common. Structuring `ConnectorManager` to handle these identities explicitly is beneficial.
- **Discord Constraints**: Discord bot/broadcaster identity is less standard than Twitch but still relevant for certain platform features.
- **Mock Robustness**: Lifecycle methods in mocks are critical even if the test focuses on another area (e.g. `processEgress`).
