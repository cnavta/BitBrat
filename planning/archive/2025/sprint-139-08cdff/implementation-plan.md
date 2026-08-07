# Implementation Plan – sprint-139-08cdff

## Objective
- Establish a modular ingress/egress connector architecture to support multiple external chat systems.
- Add Discord (discord.js) as the first alternative chat input alongside existing Twitch IRC.
- Ensure all new ingress events flow through InternalEventV2 to existing downstream services.

## Scope
- In scope:
  - Define connector abstractions and lifecycle (init → connect → receive → normalize → publish → disconnect).
  - Document message normalization to InternalEventV2 with source-specific metadata.
  - Plan Discord ingress using discord.js, single guild, configured channel whitelist.
  - Plan egress routing so responses for a given ingress instance are mapped to the correct connector (maintain per-instance topic behavior).
- Out of scope (this sprint):
  - Multi-guild Discord deployment and permission management beyond a single guild.
  - Advanced moderation, command parsing, or rich embeds.
  - Breaking changes to architecture.yaml (we will align to it and propose additive changes only if necessary).

## Deliverables
- Technical Architecture document (this task).
- Sprint planning artifacts and validation scaffolding.
- Implementation PRs will follow in subsequent tasks of this sprint after approval of the design.

## Acceptance Criteria
- Technical Architecture approved by stakeholders.
- Connector model aligns with architecture.yaml and does not regress Twitch behavior.
- Clear plan for environment/config, secrets, and testing strategy.

## Testing Strategy
- Unit tests for connector interfaces and Discord adapter normalization.
- Integration tests for ingress → internal bus publication and egress routing to the correct adapter.
- Mocks for discord.js client to avoid network I/O in CI.

## Deployment Approach
- No new service; extend existing ingress-egress service with modular connectors.
- Environment-driven enablement for each connector.
- Cloud Run deployment remains unchanged; env/ secrets added for Discord.

## Dependencies
- discord.js library and Discord bot credentials (token, client ID).
- Existing message bus (NATS/PubSub via PublisherResource), InternalEventV2 types.

## Definition of Done
- Technical Architecture and plan approved.
- Code implementation PRs created per plan with passing tests and validation script updates.
