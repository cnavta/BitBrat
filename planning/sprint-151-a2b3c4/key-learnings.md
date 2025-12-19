# Key Learnings – sprint-151-a2b3c4

- Twitch IRC tags are a reliable source for real-time moderator and subscriber status without additional API calls.
- Discord role-based status requires server-specific configuration (Role IDs) to be truly accurate, but can be approximated by role names initially.
- The `InternalEventV2` structure is well-positioned to support this enrichment as it already carries `rawPlatformPayload`.
