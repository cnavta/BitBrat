# Technical Architecture – Enhanced Egress Routing

## Status
**Proposed**

## Context
Currently, the platform uses a simple `egressDestination` string property in `EnvelopeV1` to identify the reply topic for external responses. This assumes the responding service (usually `ingress-egress`) knows how to deliver the message based on the source or annotations. We want to decouple this by introducing an `egress` object that specifies both the `destination` (topic) and the `type` (discriminator), allowing for cross-platform routing (e.g., event comes in from Twitch, but out via Discord).

## Proposed Changes

### 1. Types & Contracts
The `src/types/events.ts` has been updated to replace `egressDestination: string` with `egress?: EgressV1`.

```typescript
export type EgressV1Type = 'twitch:irc' | 'discord';

export interface EgressV1 {
  destination: string; // Egress destination for external responses (topic)
  type: EgressV1Type;  // Type of egress destination being requested.
}
```

### 2. Event Router Enhancements
The `RuleDoc` in `src/services/router/rule-loader.ts` now includes an optional `egress?: EgressV1`.
The `RouterEngine` will be updated to:
- Detect `egress` in a matching rule.
- If present, overwrite or set the `egress` property on the outgoing event.
- This allows a rule to say "for this specific event, regardless of where it came from, send the response to this Discord channel/topic".

### 3. Ingress Clients Refactoring
Ingress clients (`TwitchIrcClient`, `TwitchEventSubClient`, `DiscordIngressClient`) will be updated to set the initial `egress` object instead of a raw `egressDestination` string.

- **Twitch**: `{ destination: "internal.egress.v1.<instance>", type: "twitch:irc" }`
- **Discord**: `{ destination: "internal.egress.v1.<instance>", type: "discord" }`

### 4. Ingress-Egress Service Routing
The `ingress-egress-service.ts` currently uses a naive "if source contains discord" check. It will be refactored to:
- Check `evt.egress.type`.
- Route to `discordClient` if `type === 'discord'`.
- Route to `twitchClient` if `type === 'twitch:irc'`.
- Maintain a fallback to Twitch for backward compatibility if `egress` is missing but `egressDestination` (legacy) was present (though we are refactoring it away).

### 5. Data Migration & Compatibility
- Update `adapters.ts` to handle the conversion between V1/V2 with the new `egress` property.
- Since we are in a controlled environment, we will perform a hard cutover of the property name, but ensure the `ingress-egress` service can handle the transition.

## Detailed Component Impacts

### Ingress-Egress Service
- Subscription remains on the same per-instance egress topic.
- Delivery logic switches from string matching on `source` to using `egress.type`.

### Event Router
- `RouterEngine.route` logic:
  ```typescript
  if (rule.egress) {
    evtOut.egress = rule.egress;
  }
  ```

### Adapters
- `toV1` and `toV2` in `src/common/events/adapters.ts` must map `egress` property.

## Verification Plan
- **Unit Tests**: Update tests for `RouterEngine`, `EnvelopeBuilders`, and `Adapters`.
- **Integration Tests**: Verify that an event with a Discord egress type is correctly routed to the Discord client even if it originated from Twitch.
- **Manual Verification**: Use `event-router-debug` or similar tools to inject events with specific egress overrides.
