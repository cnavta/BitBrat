# EventSub Architecture Diagrams

> **Sprint:** 16
> **Date:** 2026-08-16
> **Purpose:** Visual reference for EventSub system architecture

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Twitch Platform                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  IRC     │  │ EventSub │  │ EventSub │  │ EventSub │  ...   │
│  │  Chat    │  │ Follow   │  │  Raid    │  │Subscribe │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
└───────┼─────────────┼─────────────┼─────────────┼───────────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ingress-egress Service                        │
│  ┌──────────────────┐         ┌──────────────────┐             │
│  │  IRC Client      │         │ EventSub Client  │             │
│  │  (Twurple)       │         │  (Twurple)       │             │
│  │                  │         │                  │             │
│  │ - Chat messages  │         │ - 22 event types │             │
│  │ - Commands       │         │ - YAML config    │             │
│  └────────┬─────────┘         └────────┬─────────┘             │
│           │                            │                        │
│           └──────────┬─────────────────┘                        │
│                      │                                          │
│           ┌──────────▼──────────┐                               │
│           │ TwitchConnectorAdapter│                             │
│           │                      │                               │
│           │ - Dual-client mgmt   │                               │
│           │ - EventSub methods   │                               │
│           │ - getSnapshot()      │                               │
│           └──────────┬───────────┘                               │
└──────────────────────┼──────────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │      InternalEventV2         │
        │  (NATS / Cloud Pub/Sub)      │
        └──────────────┬───────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
    ┌────────┐    ┌────────┐    ┌────────┐
    │  auth  │    │ llm-bot│    │ state  │
    │service │    │ service│    │ mgmt   │
    └────────┘    └────────┘    └────────┘
```

---

## EventSub Client Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     TwitchEventSubClient                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────┐       ┌──────────────────────────┐ │
│  │ YAML Configuration     │       │  Hardcoded Subscriptions │ │
│  │                        │       │  (Legacy - 4 events)     │ │
│  │ Feature Flag:          │       │                          │ │
│  │ ENABLE_EVENTSUB_YAML   │       │  - channel.follow        │ │
│  │ _CONFIG=true           │       │  - channel.update        │ │
│  │                        │       │  - stream.online         │ │
│  │ - 22 event types       │       │  - stream.offline        │ │
│  │ - Per-channel override │       │                          │ │
│  │ - Flexible config      │       │  Deprecated             │ │
│  └───────────┬────────────┘       └─────────────┬────────────┘ │
│              │                                   │              │
│              └──────────────┬────────────────────┘              │
│                             │                                   │
│                 ┌───────────▼──────────┐                        │
│                 │  SubscriptionManager │                        │
│                 ├──────────────────────┤                        │
│                 │                      │                        │
│                 │ - Load YAML config   │                        │
│                 │ - Apply overrides    │                        │
│                 │ - Validate scopes    │                        │
│                 │ - Subscribe events   │                        │
│                 │ - Track metrics      │                        │
│                 └───────────┬──────────┘                        │
│                             │                                   │
│                 ┌───────────▼──────────┐                        │
│                 │ EventBuilderRegistry │                        │
│                 ├──────────────────────┤                        │
│                 │                      │                        │
│                 │ - 22 event builders  │                        │
│                 │ - Builder lookup     │                        │
│                 │ - Validation         │                        │
│                 └───────────┬──────────┘                        │
│                             │                                   │
│                 ┌───────────▼──────────┐                        │
│                 │ EventSubEnvelopeBuilder │                     │
│                 ├──────────────────────┤                        │
│                 │                      │                        │
│                 │ - Twitch → Internal  │                        │
│                 │ - InternalEventV2    │                        │
│                 │ - ExternalEventV1    │                        │
│                 └──────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Event Flow (Single Event)

```
Twitch EventSub Notification
        │
        ▼
EventSubWsListener (Twurple)
        │
        ▼
SubscriptionManager
        │
        ├─> Get builder from EventBuilderRegistry
        │
        ├─> Call builder method
        │   (e.g., buildRaid, buildFollow)
        │
        ▼
EventSubEnvelopeBuilder
        │
        ├─> Build InternalEventV2
        │   - correlationId
        │   - traceId
        │   - ingress metadata
        │   - identity (user)
        │   - externalEvent (Twitch data)
        │   - routing slip
        │
        ▼
ITwitchIngressPublisher
        │
        ├─> Publish to NATS
        │   Topic: internal.ingress.v1 (or egress)
        │
        └─> (Optional) Publish mutation
            Topic: internal.mutations.v1
            (for stream.online/offline)
        │
        ▼
┌───────────────────────────┐
│  Message Bus (NATS)       │
│                           │
│  - internal.ingress.v1    │
│  - internal.mutations.v1  │
└───────────┬───────────────┘
            │
            ▼
    Downstream Services
    (auth, llm-bot, etc.)
```

---

## Configuration Hierarchy

```
subscriptions.yaml (Global Config)
        │
        ├─> channel.follow: enabled=true
        ├─> channel.raid: enabled=false
        ├─> channel.subscribe: enabled=false
        │   ...
        │
        ▼
Apply Channel Overrides
        │
        ├─> channelOverrides:
        │     bitbrat:
        │       channel.raid: enabled=true
        │
        ▼
Effective Configuration
        │
        ├─> bitbrat channel:
        │     - channel.follow: ENABLED
        │     - channel.raid: ENABLED  ← Override
        │     - channel.subscribe: DISABLED
        │
        ├─> otherchannel:
        │     - channel.follow: ENABLED
        │     - channel.raid: DISABLED  ← Global default
        │     - channel.subscribe: DISABLED
        │
        ▼
Subscribe to EventSub Events
```

---

## Dual-Client Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                   factory.ts (createTwitchConnector)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┐         ┌──────────────────────┐        │
│  │  IRC Client        │         │ EventSub Client      │        │
│  │  (TwitchIrcClient) │         │(TwitchEventSubClient)│        │
│  │                    │         │                      │        │
│  │ - Chat messages    │         │ - Platform events    │        │
│  │ - Commands         │         │ - YAML-driven        │        │
│  │ - Required         │         │ - Optional (flag)    │        │
│  └─────────┬──────────┘         └──────────┬───────────┘        │
│            │                               │                    │
│            └───────────┬───────────────────┘                    │
│                        │                                        │
│            ┌───────────▼──────────┐                             │
│            │ TwitchConnectorAdapter│                            │
│            ├───────────────────────┤                            │
│            │                       │                            │
│            │ constructor(          │                            │
│            │   ircClient,          │                            │
│            │   eventSubClient?  ← Optional                      │
│            │ )                     │                            │
│            │                       │                            │
│            │ Methods:              │                            │
│            │ - start()             │                            │
│            │ - stop()              │                            │
│            │ - getSnapshot()       │                            │
│            │ - listSubscriptions() │                            │
│            │ - getSubscriptionStatus() │                        │
│            │ - reloadSubscriptionConfig() │                     │
│            └───────────────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## MCP Tools & Observability

```
┌─────────────────────────────────────────────────────────────────┐
│                      Observability Layer                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │          MCP Tools (platform-only exposure)               │  │
│  │                                                           │  │
│  │  twitch.eventsub.subscriptions.list()                    │  │
│  │    ├─> Returns: YAML config structure                    │  │
│  │    └─> Use: Verify config loaded                         │  │
│  │                                                           │  │
│  │  twitch.eventsub.subscriptions.status({ channel? })      │  │
│  │    ├─> Returns: Runtime subscription health              │  │
│  │    └─> Use: Monitor event flow, detect issues            │  │
│  │                                                           │  │
│  │  twitch.eventsub.config.reload()                         │  │
│  │    ├─> Returns: Success/error                            │  │
│  │    └─> Use: Validate YAML before restart                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │          HTTP Health Endpoint                             │  │
│  │                                                           │  │
│  │  GET /_debug/twitch/eventsub                             │  │
│  │    ├─> Returns: subscription counts, event stats         │  │
│  │    └─> Use: Monitoring systems, quick health check       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │          Structured Logging                               │  │
│  │                                                           │  │
│  │  [INFO] twitch.eventsub.using_yaml_config                │  │
│  │  [INFO] subscription_manager.subscribed { eventType, ... }│  │
│  │  [WARN] subscription_manager.scope_missing { scope, ... } │  │
│  │  [ERROR] subscription_manager.subscribe_failed { ... }    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

```
┌─────────────────────────────────────────────────────────────────┐
│                     Phase 0: Validation                          │
│                                                                  │
│  ENABLE_EVENTSUB_YAML_CONFIG=false (default)                    │
│  Hardcoded subscriptions active (4 events)                      │
│  YAML config loaded but not used                                │
│  Verify: 4 subscriptions active                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                Phase 1: Enable YAML (Staging)                    │
│                                                                  │
│  ENABLE_EVENTSUB_YAML_CONFIG=true                               │
│  YAML config active (same 4 events)                             │
│  Monitor for 48-72 hours                                        │
│  Verify: event counts match baseline                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Phase 2: Enable New Events (Staging)                │
│                                                                  │
│  Enable 2-3 Tier 1 events (raid, subscribe, etc.)               │
│  Monitor for 48-72 hours                                        │
│  Verify: new events publishing correctly                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│           Phase 3: Production Rollout (Gradual)                  │
│                                                                  │
│  Step 1: Deploy config (flag OFF)                               │
│  Step 2: Enable for 1-2 channels (canary)                       │
│  Step 3: Expand to 50% of channels                              │
│  Step 4: Full production rollout                                │
│  Monitor at each step                                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Phase 4: Cleanup (Future Sprint)                    │
│                                                                  │
│  Remove hardcoded subscription code                              │
│  Make YAML config required                                      │
│  Update documentation                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [EventSub Config Guide](../../documentation/guides/twitch-eventsub-config.md)
- [Migration Guide](./migration-guide.md)
- [MCP Tools Reference](../../documentation/reference/mcp-tools-twitch.md)
- [Event Catalog](../../documentation/reference/twitch-eventsub-catalog.md)
- [Milestone 5 Review](./milestone-5-review.md)

---

**Last Updated:** Sprint 16
**Status:** Production-ready
