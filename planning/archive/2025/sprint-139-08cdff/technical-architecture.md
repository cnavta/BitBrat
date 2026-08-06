# Technical Architecture – Modular Ingress/Egress with Discord (discord.js)

## Overview
The ingress-egress service currently integrates Twitch IRC for inbound messages and consumes a per-instance internal egress topic to deliver outbound messages back to Twitch. We will generalize this pattern into a modular connector model that supports multiple external chat systems (initially Twitch and Discord) without changing the core architecture or internal message schema (InternalEventV2).

Goals:
- Preserve architecture.yaml contract: ingress-egress remains the single bridge between external chat systems and internal topics.
- Introduce Connector abstractions for Ingress and Egress that encapsulate lifecycle, normalization, and delivery.
- Add a Discord ingress connector using discord.js, limited to a single guild with a configured set of target channels.
- Maintain per-instance egress routing so replies can be directed back via the correct connector when applicable.

Non-goals:
- Multi-guild Discord orchestration, permission workflows, or advanced moderation.
- Rich embeds/attachments beyond basic text normalization.
- Changes to InternalEventV2 structure; we will add source metadata under annotations/payload as needed.

## Current State (Twitch)
- Ingress: TwitchIrcClient builds InternalEventV2 via TwitchEnvelopeBuilder and publishes to internal.ingress.v1 using a PublisherResource created from config.
- Egress: ingress-egress subscribes to internal.egress.v1.{instanceId}, selects best candidate, extracts text, and calls twitchClient.sendText(text).
- Instance scoping: instanceId resolved from K_REVISION | EGRESS_INSTANCE_ID | SERVICE_INSTANCE_ID | HOSTNAME | generated.

## Target Architecture
We introduce a Connector layer within the ingress-egress service:

- IngressConnector (interface):
  - start(): Promise<void>
  - stop(): Promise<void>
  - getSnapshot(): SnapshotPayload

- IngressPublisher (interface):
  - publish(evt: InternalEventV2): Promise<void>

- EnvelopeBuilder<TSourceMeta> (interface):
  - build(meta: TSourceMeta): InternalEventV2

- EgressConnector (interface, optional per source):
  - sendText(text: string, channelOrTarget?: string): Promise<void>

- ConnectorManager:
  - Loads connectors based on config (e.g., twitchEnabled, discordEnabled)
  - Provides shared resources (PublisherResource, Firestore, logger, busPrefix)
  - Manages per-instance egress subscription and dispatch to appropriate EgressConnector

### Message Flow
- External → IngressConnector.receive → EnvelopeBuilder.build → IngressPublisher.publish → internal.ingress.v1
- internal.egress.v1.{instanceId} → selection → extract text → EgressConnector.sendText

### Identity and Routing
- Maintain egressDestination in InternalEventV2 on ingress (as done with Twitch) so downstream services can respond to the correct per-instance topic.
- For multi-connector environments, we tag source in annotations (e.g., source: twitch|discord) to aid routing/observability.

## Discord Connector Design
We will add a Discord connector using discord.js (v14+):

- Configuration (env + config):
  - DISCORD_BOT_TOKEN (secret)
  - DISCORD_GUILD_ID (single guild)
  - DISCORD_CHANNELS (comma-separated channel IDs to listen in)
  - DISCORD_ENABLED=true/false

- DiscordIngressClient:
  - Lifecycle: login(token) → ready → cache channels → event handlers.
  - onMessageCreate(msg):
    - Filter to configured guild and channels
    - Ignore bot messages and non-text content
    - Build meta: guildId, channelId, messageId, authorId, authorName, roles, mentions, timestamp
    - EnvelopeBuilder.build(meta) → InternalEventV2
    - publisher.publish(evt)
  - getSnapshot(): connection state, guild, channels, counters, lastError

- DiscordEnvelopeBuilder:
  - Maps Discord message meta to InternalEventV2 fields:
    - source: "discord"
    - ingress: { guildId, channelId, messageId, authorId, authorName }
    - text: msg.content
    - annotations: include roles/mentions if needed
    - egressDestination: set to this instance's topic at ingress time (mirrors Twitch behavior)

- DiscordIngressPublisher:
  - Thin wrapper over PublisherResource to publish to internal.ingress.v1

- DiscordEgress (Phase 2/optional):
  - sendText(text, channelId?): resolves a default target channel (first configured) if not provided and posts a message via discord.js Channel.send().
  - For this sprint, egress may remain Twitch-only unless a Discord egress use-case is required; the architecture will allow adding it with minimal code.

## Internal Types and Schema
- Reuse InternalEventV2 as-is. Add source annotations and ingress metadata under evt.annotations / evt.payload to maintain traceability without schema changes.
- Ensure egressDestination is set for all ingress events to keep reply routing stable.

## Configuration Model
- Extend existing buildConfig/ENV to include Discord settings. Suggested keys:
  - discordEnabled: boolean
  - discordBotToken: string (secret)
  - discordGuildId: string
  - discordChannels: string[] (IDs)
- Add corresponding entries in env/{local,dev,prod}/ingress-egress.yaml and .cloudbuild/env.ingress-egress.kv for secrets.

## Observability
- Log connector lifecycle and message counts with source context: ingress-egress.discord.* and ingress-egress.twitch.*
- Extend /_debug endpoints per connector, e.g., /_debug/discord with snapshot payload (no secrets).

## Failure Modes & Resilience
- Start connectors independently; one connector failing to start must not take down the process.
- Guard network I/O in tests (DISCORD_ENABLED=false in CI). Provide no-op behavior when disabled.
- Rate limits: discord.js has built-in handling; respect it and avoid spamming on egress.

## Security
- Store DISCORD_BOT_TOKEN in secrets; do not log tokens. Mask sensitive fields in snapshots.
- Validate guild and channel IDs from config.

## Testing Strategy
- Unit: EnvelopeBuilder mapping, filters, and publisher interactions (mock discord.js Client).
- Integration: connector start-up (disabled mode), message normalization, and publication onto internal bus (mock PublisherResource).
- E2E (optional/local): with a test guild and channel, behind a feature flag.

## Rollout Plan
- Phase 1: Implement connector abstractions and Discord ingress (disabled by default). Add config and debug endpoint. Tests green.
- Phase 2: Optional Discord egress adapter if required by use-cases. Wire selection/extraction to call Discord egress when source=discord or routing indicates Discord.
- Phase 3: Documentation and operational runbook.

## Risks & Mitigations
- Risk: Discord permissions misconfig → Mitigation: clear error logs and /_debug snapshot.
- Risk: Message schema drift → Mitigation: keep InternalEventV2 unchanged; annotate only.
- Risk: Increased complexity in egress routing → Mitigation: per-instance egress remains; dispatch only when connector enabled with a simple mapping.

## Alternatives Considered
- Split Discord into a separate service: increases deployment complexity and cost; current service is designed as a bridge and can host multiple connectors safely.
- Introduce a generic webhook gateway: viable for HTTP sources, but Discord requires a persistent gateway connection; the connector model covers both persistent and stateless sources.

## Acceptance Criteria Recap
- Design aligns with architecture.yaml, introduces no breaking changes.
- Discord ingress designed with clear config and limited scope (single guild, channel whitelist).
- Tests and validation strategy defined.
