# Deliverable Verification – sprint-143-e2f4a1

## Completed
- [x] Added `discordOauthPermissions` to `IConfig` in `src/types/index.ts`.
- [x] Updated `ConfigSchema` and `buildConfig` in `src/common/config.ts` to parse `DISCORD_OAUTH_PERMISSIONS`.
- [x] Updated `DiscordAdapter` in `src/services/oauth/providers/discord-adapter.ts` to include `permissions` parameter in OAuth URL.
- [x] Set default permissions to `379968` (View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Add Reactions, Use External Emojis).
- [x] Set default scopes to `['bot', 'applications.commands']`.
- [x] Updated `architecture.yaml` and `.cloudbuild/env.oauth-flow.kv` with the new configuration.
- [x] Created unit tests for `DiscordAdapter` and configuration parsing.
- [x] Verified all relevant tests pass.

## Partial
- None

## Deferred
- None

## Alignment Notes
- The default permissions bitmask (379968) covers the requirements of "joining channels and chatting" and adds common bot capabilities like embedding links and adding reactions.
- Added `applications.commands` scope to defaults to support modern Discord bot features.
