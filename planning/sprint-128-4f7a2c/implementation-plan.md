Implementation Plan – sprint-128-4f7a2c

Objective
- Architect a modular, annotation-driven mechanism to inject dynamic personalities into the llm-bot system prompt, resolved from Firestore (/personalities) or inline text.

Scope
- In scope
  - Technical Architecture (this sprint’s first deliverable)
  - Planning artifacts and validation wrapper
  - Implementation in llm-bot: resolver, composer, config flags (post-approval)
  - Unit and integration tests for new behavior
  - Observability (logs/metrics) for personality pipeline
- Out of scope
  - Multi-provider LLM adapters beyond existing OpenAI
  - UI or authoring tooling for personalities
  - Cross-service changes except router attaching annotations (already supported by event types)

Deliverables
- Documentation
  - technical-architecture.md describing data model, flow, caching, error handling, observability, config
  - implementation-plan.md (this file)
- Code (post-approval)
  - PersonalityResolver module and PromptComposer updates in llm-bot
  - Feature flags and environment config defaults
  - Tests (unit + integration with mocks)
- CI/CD
  - No pipeline changes expected; existing validate_deliverable.sh leveraged
- Sprint Ops
  - request-log.md, verification-report.md, publication.yaml, retro.md, key-learnings.md

Acceptance Criteria
- Personality annotation payload {id?, text?} is supported; inline text overrides ID
- Only status=active personalities (from /personalities) are included
- Composition modes: append (default), prepend, replace
- Limits enforced: max annotations and max chars per personality; graceful degradation on overflow
- Feature can be disabled via PERSONALITY_ENABLED=false
- Observability: logs and basic metrics for resolution, cache, drops
- No behavior change when no personality annotations present

Testing Strategy
- Unit tests
  - Payload validation, malformed handling
  - Firestore fetch success/failure paths; inactive status ignored
  - Compose modes and deterministic ordering by createdAt
  - Clamping and drop-on-overflow logic
  - Cache hit/miss with TTL
- Integration tests
  - End-to-end event through llm-bot with mocked Firestore and LLM provider ensuring composed system prompt contains personalities
- Mocks
  - Firestore client, LLM client

Deployment Approach
- Default Cloud Run deployment via existing Dockerfile.llm-bot and cloudbuild.llm-bot.yaml
- No new infrastructure required; read-only access to /personalities enforced by rules/secret scoping

Dependencies
- Firestore access for /personalities
- Environment variables (PERSONALITY_*), with safe defaults
- Existing event types include 'personality' annotation (already present)

Definition of Done
- Aligns to architecture.yaml precedence and AGENTS.md DoD
- Documentation updated (TA + plan)
- Tests implemented and passing in CI
- validate_deliverable.sh logically passable
- PR opened with changes and linked in publication.yaml
