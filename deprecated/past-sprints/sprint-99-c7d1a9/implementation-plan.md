Implementation Plan — Ingress-Egress Twitch IRC Ingestion

Status: draft (awaiting approval before coding)
Sprint: sprint-99-c7d1a9
Related: ./technical-architecture-ingress-egress.md

Objective
- Implement Twitch IRC ingestion in ingress-egress: connect via Twurple using Firestore-stored OAuth credentials; normalize to Envelope; publish to internal.ingress.v1.

Deliverables
- Technical Architecture document (this sprint)
- EnvelopeBuilder for chat messages (next sprint)
- Publisher wiring to message-bus abstraction (next sprint)
- Health/debug endpoints for IRC status (next sprint)
- Unit tests for EnvelopeBuilder and Publisher (next sprint)

Acceptance Criteria
- Technical Architecture document exists and aligns with architecture.yaml and platform-overview
- Clear mapping from IRC message to Envelope defined
- Publishing path to internal.ingress.v1 defined via message-bus abstraction
- Operational endpoints and observability called out

Dependencies
- architecture.yaml service definition: ingress-egress
- src/services/message-bus (existing abstractions)
- Firestore OAuth credential documents created by oauth-flow
- Twurple libraries available in package.json

High-Level Tasks
1. Create ingress/twitch module scaffolding
   - credentials-provider.ts
   - twitch-irc-client.ts
   - envelope-builder.ts
2. Wire message publisher using src/services/message-bus
3. Add Express routes: /_debug/twitch (plus defaults /healthz, /readyz, /livez)
4. Configuration parsing: env vars, channel list, backoff params
5. Tests
   - EnvelopeBuilder unit tests
   - Publisher retry logic tests
   - Mock Twurple integration test for message to publish

Testing Strategy
- Jest unit tests alongside code
- Local NATS JetStream for integration publish tests (guarded/optional)

Definition of Done
- Plan approved
- Code compiles and tests pass locally
- validate_deliverable.sh passes

Risks and Mitigations
- Token refresh failures: retry with backoff and surface degraded status
- Multi-channel scaling: start with single instance (min=1, max=1) per architecture.yaml
- Bus backpressure: bounded retries and visibility via logs and metrics
