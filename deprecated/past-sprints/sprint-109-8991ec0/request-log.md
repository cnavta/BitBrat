- 2025-12-01T19:20:00-05:00 | Sprint Init |
  - Prompt: "Start sprint" (user confirmation)
  - Interpretation: Begin Sprint 109 to plan migration of event-router to InternalEventV2
  - cmd: git checkout -b feature/sprint-109-8991ec0-event-router-iev2
  - files:
    - planning/sprint-109-8991ec0/sprint-manifest.yaml (created)

- 2025-12-01T19:22:00-05:00 | Planning |
  - Prompt: "Create Trackable Backlog of items to convert the event router to fully use InternalEventV2."
  - Interpretation: Produce backlog per AGENTS.md with clear items, acceptance criteria, and dependencies
  - files:
    - planning/sprint-109-8991ec0/trackable-backlog.yaml (created)

- 2025-12-01T19:25:00-05:00 | Planning |
  - Action: Drafted implementation-plan.md for approval prior to coding
  - files:
    - planning/sprint-109-8991ec0/implementation-plan.md (created)

- 2025-12-01T19:26:00-05:00 | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: add implementation plan; planning artifacts updated"
  - result: committed planning artifacts

- 2025-12-02T01:45:30Z | Implementation |
  - Action: Implement V2-native event-router path and RouterEngine V2 compatibility
  - files:
    - src/apps/event-router-service.ts (updated)
    - src/services/routing/router-engine.ts (updated)
  - notes:
    - Ingress normalized to V2; legacy V1 up-converted once via toV2
    - RouterEngine accepts V2 by internally adapting to V1 for JsonLogic context
    - Publish remains V2 with busAttrsFromEvent

- 2025-12-02T01:46:00Z | QA |
  - cmd: npm test
  - result: 88 passed, 1 skipped (all suites passing)

- 2025-12-02T01:46:10Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: event-router V2-native path; RouterEngine V2 compat; publish V2"
  - result: committed implementation changes

- 2025-12-02T19:42:30Z | Incident Investigation |
  - Prompt: "Auth service is timing out when trying to publish messages. Investigate and remediate."
  - Findings:
    - Errors show driver=pubsub with DEADLINE_EXCEEDED and long DNS/name resolution delays
    - auth-service created a new publisher per message, causing repeated Pub/Sub client init and DNS lookups
    - Nacking on publish error led to redelivery storm (nack loops every ~288s)
  - files:
    - src/apps/auth-service.ts (to be updated)
    - src/services/message-bus/pubsub-driver.ts (to be updated)

- 2025-12-02T19:43:10Z | Implementation |
  - Action: Reuse a singleton publisher in auth-service; improve publish error handling
  - files:
    - src/apps/auth-service.ts (updated)
  - notes:
    - Publisher is created once per subject outside the handler and reused
    - On publish timeouts/network resolution errors, ack to prevent redelivery storms; JSON parse errors still ack; other errors nack

- 2025-12-02T19:43:40Z | Implementation |
  - Action: Add configurable publish timeout and error tagging in Pub/Sub driver
  - files:
    - src/services/message-bus/pubsub-driver.ts (updated)
  - notes:
    - New env PUBSUB_PUBLISH_TIMEOUT_MS to bound publish waits (0 disables)
    - withTimeout wraps publishMessage; local timeout tagged with code=4 (DEADLINE_EXCEEDED) for consistent handling

- 2025-12-02T19:44:05Z | QA |
  - cmd: npm test
  - result: 88 passed, 1 skipped (no regressions)

- 2025-12-02T19:44:20Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: auth-service publish timeout remediation; reuse publisher; configurable PUBSUB_PUBLISH_TIMEOUT_MS"
  - result: committed auth hotfix and driver enhancement

- 2025-12-02T20:05:10Z | Implementation |
  - Prompt: "Twitch IRC client is still using V1 as default. Update to fully support V2 format."
  - Action: Migrated Twitch ingress to build and publish InternalEventV2 natively
  - files:
    - src/services/ingress/twitch/envelope-builder.ts (updated to return V2; TwitchEnvelopeBuilder now constructs V2.message)
    - src/services/ingress/twitch/twitch-irc-client.ts (removed toV2; publishes builder-produced V2; injects egressDestination on V2)
    - src/services/ingress/twitch/envelope-builder.spec.ts (asserts V2 fields)
    - src/services/ingress/twitch/twitch-irc-client.spec.ts (tests updated for V2 shape)
    - src/services/ingress/twitch/__tests__/twurple-integration.spec.ts (integration test updated for V2)

- 2025-12-02T20:06:10Z | QA |
  - cmd: npm test
  - result: 88 passed, 1 skipped (all suites passing)

- 2025-12-02T20:06:20Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: Twitch IRC ingress now builds/publishes InternalEventV2 natively; updated tests"
  - result: committed Twitch V2 migration changes

- 2025-12-02T20:55:00Z | Incident Investigation |
  - Prompt: "The event router is now seeing the same timeout issues we saw in the auth service"
  - Interpretation: Event router likely creates a new publisher per message and nacks on publish errors, causing DEADLINE_EXCEEDED loops under Pub/Sub DNS/endpoint issues.
  - Plan: Reuse cached publishers per out-subject and adjust error policy to ack on publish timeout/name-resolution errors (code=4 or regex), mirroring auth fix.

- 2025-12-02T20:58:00Z | Implementation |
  - files:
    - src/apps/event-router-service.ts (updated)
  - changes:
    - Introduced publisher cache Map<string, MessagePublisher> at setup scope.
    - Switched to get-or-create publisher instead of per-message instantiation.
    - Enhanced catch policy: ack on JSON poison and known publish timeout/DNS errors; otherwise nack(true).

- 2025-12-02T21:00:00Z | QA |
  - cmd: npm test
  - result: All existing tests passing (no new tests required for this hotfix).

- 2025-12-02T21:01:00Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: event-router publish timeout remediation — cache publishers; ack on known publish timeouts to prevent redelivery storms"
  - result: committed router hotfix

- 2025-12-02T22:05:00Z | Test Failures – Remove V1 adapters |
  - Prompt: "We removed InternalEventV1 adapters; migrate remaining areas to V2-only. Tests failing across router engine, evaluator, auth enrichment, command-processor smoke, and egress selection."
  - Interpretation: Update code and tests to use InternalEventV2 exclusively where adapters were previously used.

- 2025-12-02T22:07:00Z | Implementation |
  - files:
    - tests/integration/command-processor-smoke.spec.ts (updated to V2 input)
    - src/services/routing/__tests__/router-engine.test.ts (updated to V2)
    - src/services/router/__tests__/jsonlogic-evaluator.test.ts (updated to V2)
    - src/services/auth/__tests__/enrichment.spec.ts (updated to V2 and flattened expectations)
    - src/apps/__tests__/command-processor-service.test.ts (updated first case to V2)
    - src/services/egress/selection.ts (added legacy root-payload fallback)
  - notes:
    - JsonLogic evaluator already builds context from V2; tests now reflect that
    - Egress text extraction prefers V2 candidates; falls back to rawPlatformPayload or legacy payload.text/chat.text

- 2025-12-02T22:10:00Z | QA |
  - cmd: npm test
  - result: 88 test suites passed, 1 skipped; 235 tests total, 234 passed, 1 skipped (all green)

- 2025-12-02T22:11:00Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: migrate remaining tests/services to InternalEventV2; adjust egress selection; all tests passing"
  - result: committed V2 migration changes

- 2025-12-02T21:14:00Z | Publication |
  - Action: Force complete sprint per user instruction; skipping PR creation
  - files:
    - planning/sprint-109-8991ec0/publication.yaml (created)
    - planning/sprint-109-8991ec0/retro.md (created)
    - planning/sprint-109-8991ec0/verification-report.md (exists)
    - planning/sprint-109-8991ec0/key-learnings.md (created)
  - notes:
    - publication.yaml status set to force-closed with reason

- 2025-12-02T21:14:10Z | VCS |
  - cmd: git add -A && git commit -m "sprint-109-8991ec0: force close sprint — add publication.yaml and key-learnings; finalize retro"
  - result: committed publication and closure artifacts
