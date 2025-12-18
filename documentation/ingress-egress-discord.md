# Ingress-Egress: Discord Integration (Phase 1 – Ingress Only)

This document describes how to configure and operate the Discord ingress connector in the ingress-egress service. The design follows the modular connector architecture and preserves the InternalEventV2 schema.

## Scope
- Single Discord guild (server)
- Channel allowlist by ID
- Ingress only in this sprint (egress adapter provided as a stub)

## Configuration
Set the following environment variables for the ingress-egress service:

- DISCORD_ENABLED: "true" to enable Discord connector (default: "false")
- DISCORD_BOT_TOKEN: Discord bot token (secret)
- DISCORD_GUILD_ID: Target guild ID
- DISCORD_CHANNELS: Comma-separated list of channel IDs to listen to

Examples can be found in:
- env/local/ingress-egress.yaml (disabled by default)
- env/dev/ingress-egress.yaml (disabled by default)
- env/prod/ingress-egress.yaml (disabled by default)
- .cloudbuild/env.ingress-egress.kv (DISCORD_BOT_TOKEN placeholder)

Tokens and secrets are never logged. safeConfig() redacts DISCORD_BOT_TOKEN.

## Enabling the Connector
1. Create a Discord application and bot; invite it to your guild with message read permission.
2. Store DISCORD_BOT_TOKEN in your secret manager and wire it into deployment.
3. Set DISCORD_ENABLED="true", DISCORD_GUILD_ID, and DISCORD_CHANNELS (IDs).
4. Deploy ingress-egress.

## Observability
- Logs use the ingress-egress.discord.* namespace for lifecycle and message handling.
- Use the debug endpoint to inspect connector state without exposing secrets:
  - GET /_debug/discord → returns { snapshot, egressTopic }
  - Snapshot includes: state, guildId, channelIds, counters {received, published, failed, filtered}, lastError (sanitized)

## Message Normalization
The DiscordEnvelopeBuilder maps Discord message metadata to InternalEventV2:
- source: "ingress.discord"
- type: chat.message.v1
- message.text: content
- annotations include source and selected metadata
- egressDestination is set to this instance’s topic for reply routing

## Egress (Stub)
A stub DiscordEgressConnector exists and is disabled unless DISCORD_ENABLED=true. It resolves a default channel from DISCORD_CHANNELS and no-ops (no network I/O) in this phase.

## Troubleshooting
- Ensure DISCORD_ENABLED is true, GUILD_ID and CHANNELS are set.
- Check /_debug/discord for state and counters.
- Verify that the bot has permissions to read target channels.

## Safety & CI
- CI and validate_deliverable.sh run with Discord disabled; tests must not perform network I/O.