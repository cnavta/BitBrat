Sprint Execution Plan — Ingress-Egress: Twitch IRC Ingestion

llm_prompt: "Lead Implementor; produce an actionable execution plan aligned with architecture.yaml and the technical architecture"

Sprint: sprint-99-c7d1a9
Owner: chris@ix-n.com
Related docs:
- ./technical-architecture-ingress-egress.md
- ../../architecture.yaml
- ../../planning/platform-overview.md

1. Objective & Scope
- Build the first ingress capability: connect to Twitch IRC using Twurple, normalize messages into the Envelope, publish to internal.ingress.v1.
- Deliver operational health endpoints and a debug endpoint exposing Twitch connection status.
- Out of scope: EventSub, non-chat events, egress workflows beyond setting finalizationDestination.

2. Execution Milestones and Timeline
- M1: Module scaffolding and config parsing complete (Day 1)
- M2: EnvelopeBuilder implemented with unit tests (Day 2)
- M3: MessagePublisher wired with retry/backoff and unit tests (Day 3)
- M4: Twurple-based TwitchIrcClient emitting normalized events and publishing (Day 4)
- M5: Health and debug endpoints + operational tests (Day 4)
- M6: Integration test with mocked Twurple + local NATS JetStream (Day 5)
- M7: Dry-run deployment scripts verified in validate_deliverable.sh (Day 5)

3. Workstreams → Backlog Mapping
- Ingress/Twitch module: INEG-01, INEG-02, INEG-03
- Message publishing: INEG-04, INEG-05
- HTTP server ops: INEG-06
- Testing: INEG-07, INEG-08, INEG-09
- Deployment/validation: INEG-10

4. Acceptance Criteria
- Ingestion: Service connects to configured Twitch channels and receives chat messages.
- Normalization: Each message is transformed into Envelope v=1 with type external.chat.message.v1 and required fields.
- Publishing: Envelopes are published to ${BUS_PREFIX}internal.ingress.v1 via message-bus abstraction with retry/backoff.
- Operations: /healthz, /readyz, /livez reflect service/connection status; /_debug/twitch exposes connection/debug state.
- Tests: Unit tests for EnvelopeBuilder and retry logic; integration test for message → publish path.
- Docs: Code is commented; configuration documented in README section within the app or service header.

5. Testing Strategy
- Unit: EnvelopeBuilder mapping; publisher backoff.
- Integration: Mock Twurple Chat client; local NATS JetStream publish verification (guarded by env flag).
- Operational: Simulate disconnect/reconnect to verify readiness and debug data.

6. Deployment Approach
- Containerize using existing Dockerfile.ingress-egress (confirm/adjust if needed).
- Cloud Build YAML: reuse patterns (install, build, test, containerize, deploy to Cloud Run). Dry-run allowed via npm run deploy:cloud -- --dry-run.
- Scaling: min=1, max=1 per architecture.yaml.

7. Dependencies
- Twurple packages, Firestore credentials (from oauth-flow), message-bus abstraction, environment variables/secrets listed in architecture.yaml.

8. Risks & Mitigations
- Token refresh failures → backoff/retry; degraded status surfaced in debug endpoint.
- Bus backpressure → bounded retries; log context; metrics counters.
- Duplicate connections → scale to 1 instance; join specific channels from TWITCH_CHANNELS.

9. Definition of Done (DoD)
- All acceptance criteria above met.
- Jest tests pass locally; coverage for EnvelopeBuilder and publisher logic present.
- validate_deliverable.sh at root and sprint both pass without SKIP.
- Dry-run deployment successful.

10. Traceability
- Backlog items maintained in ./backlog.yaml and referenced by commits/PR descriptions.

status: draft
version: 0.1.0
alignment: architecture.yaml v0.1.0
