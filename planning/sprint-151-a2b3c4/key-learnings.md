# Key Learnings – sprint-151-a2b3c4

- **Cross-Platform Identity**: Mapping users across platforms (Twitch, Discord) requires careful merging of roles and metadata. Using a `rolesMeta` object to store raw platform data alongside normalized `roles` is an effective strategy.
- **Role Normalization**: Discord's lack of a standard "moderator" flag necessitates configurable role mapping. Environment variables like `DISCORD_MOD_ROLES` provide a flexible first step.
- **Ingress Metadata**: The quality of enrichment is bounded by the metadata captured at the ingress stage. Proactively capturing server owner status and raw roles at ingress simplifies downstream logic.
- **Repository Idempotency**: `ensureUserOnMessage` must be idempotent and handle merging rather than overwriting to support multi-platform user journeys.
