# Sprint 342: Implementation Plan
## Ingress-Egress Framework Foundation

**Duration**: 10 working days
**Team Size**: 2-3 engineers
**Status**: In Progress

---

## Phase 1.1: Core Abstractions (Days 1-3)

### IEF-001: Create WebhookHandler ⏳ IN PROGRESS
**Owner**: lead-developer
**Effort**: M (1.5 days)
**Priority**: P0

**Tasks**:
1. Create `src/services/ingress/core/webhook-handler.ts`
2. Implement `handle(req, res)` method
3. Signature verification flow
4. Async processing with `setImmediate()`
5. Error handling and DLQ integration
6. JSDoc comments

**Acceptance Criteria**:
- [ ] Responds < 100ms (before async processing)
- [ ] Signature verification delegated to WebhookConnector
- [ ] Async processing uses `setImmediate()`
- [ ] Errors dead-lettered with full context
- [ ] TypeScript strict mode compliant
- [ ] JSDoc on all public methods

**Files**:
- `src/services/ingress/core/webhook-handler.ts`

---

### IEF-002: Enhance core interfaces
**Owner**: lead-developer
**Effort**: S (0.5 day)
**Priority**: P0
**Depends**: None

**Tasks**:
1. Add `WebhookConnector` interface to `interfaces.ts`
2. Add `ConnectorMetadata` interface
3. Add `ConnectorCapabilities` interface
4. Add `WebhookRequest` / `WebhookResponse` types
5. Update `core/index.ts` exports

**Acceptance Criteria**:
- [ ] WebhookConnector extends IngressConnector
- [ ] ConnectorMetadata includes platform, version, capabilities, authMethod
- [ ] ConnectorCapabilities defines ingress/egress/moderation features
- [ ] All interfaces exported from core/index.ts

**Files**:
- `src/services/ingress/core/interfaces.ts`
- `src/services/ingress/core/index.ts`

---

### IEF-003: Unit tests for WebhookHandler
**Owner**: lead-developer
**Effort**: M (1 day)
**Priority**: P0
**Depends**: IEF-001, IEF-002

**Tasks**:
1. Test signature verification success/failure
2. Test 3-second SLA with mock timers
3. Test async processing with spy
4. Test error handling (missing headers, invalid body)
5. Test DLQ integration
6. Achieve > 90% coverage

**Acceptance Criteria**:
- [ ] Signature verification tested (valid and invalid)
- [ ] 3-second SLA tested
- [ ] Async processing verified
- [ ] Error scenarios covered
- [ ] DLQ integration tested
- [ ] Coverage > 90%

**Files**:
- `src/services/ingress/core/__tests__/webhook-handler.test.ts`

---

## Phase 1.2: Express Integration (Days 4-5)

### IEF-004: Add raw body middleware
**Owner**: backend-developer
**Effort**: S (0.5 day)
**Priority**: P0
**Depends**: IEF-002

**Tasks**:
1. Add Express middleware to preserve `req.rawBody`
2. Ensure compatibility with `express.json()`
3. Test rawBody availability in webhook routes

**Acceptance Criteria**:
- [ ] req.rawBody preserved for all webhook routes
- [ ] Existing routes unaffected
- [ ] Compatible with express.json()
- [ ] Buffer encoding preserved (UTF-8)
- [ ] Integration test verifies rawBody

**Files**:
- `src/apps/ingress-egress-service.ts`
- `src/apps/__tests__/ingress-egress-rawbody.test.ts`

---

### IEF-005: Generic webhook routing
**Owner**: backend-developer
**Effort**: S (0.5 day)
**Priority**: P0
**Depends**: IEF-003, IEF-004

**Tasks**:
1. Add `POST /webhooks/:platform` route
2. Lookup connector via `ConnectorManager.getConnectorByPlatform()`
3. Return 404 if platform not found
4. Delegate to `WebhookHandler.handle()`
5. Add logging and metrics

**Acceptance Criteria**:
- [ ] Route pattern: POST /webhooks/:platform
- [ ] Returns 404 if platform not found
- [ ] Delegates to WebhookHandler
- [ ] Request/response logging with correlationId
- [ ] Metrics: webhook_latency_ms, webhook_success_rate

**Files**:
- `src/apps/ingress-egress-service.ts`

---

### IEF-006: Integration tests for routing
**Owner**: backend-developer
**Effort**: M (1 day)
**Priority**: P1
**Depends**: IEF-005

**Tasks**:
1. Test routing to correct connector (mock Twilio)
2. Test 404 for unknown platform
3. Test concurrent processing (10 simultaneous)
4. Test request validation
5. Test metrics collection

**Acceptance Criteria**:
- [ ] Routing tested (mock Twilio)
- [ ] 404 tested
- [ ] Concurrent processing (10 requests)
- [ ] Request validation tested
- [ ] Metrics collected
- [ ] Tests run in CI

**Files**:
- `src/apps/__tests__/ingress-egress-webhooks.test.ts`

---

## Phase 1.3: Twilio Migration (Days 6-8)

### IEF-007: Refactor TwilioIngressClient
**Owner**: backend-developer
**Effort**: M (1.5 days)
**Priority**: P0
**Depends**: IEF-002

**Tasks**:
1. Implement `WebhookConnector` interface
2. Move signature verification to `verifySignature()`
3. Move event processing to `handleWebhook()`
4. Add `getMetadata()` implementation
5. Preserve bot auto-join logic
6. Update tests

**Acceptance Criteria**:
- [ ] Implements WebhookConnector
- [ ] verifySignature() uses existing validation logic
- [ ] handleWebhook() processes events
- [ ] getMetadata() returns Twilio capabilities
- [ ] Bot auto-join preserved
- [ ] No breaking changes
- [ ] All tests pass

**Files**:
- `src/services/ingress/twilio/twilio-ingress-client.ts`
- `src/services/ingress/twilio/connector-adapter.ts`

---

### IEF-008: Update Twilio webhook route
**Owner**: backend-developer
**Effort**: S (0.5 day)
**Priority**: P0
**Depends**: IEF-005, IEF-007

**Tasks**:
1. Change route to use generic `/webhooks/twilio`
2. Remove inline signature verification
3. Remove event processing from route
4. Keep both routes active temporarily
5. Mark old route deprecated

**Acceptance Criteria**:
- [ ] Uses generic handler
- [ ] Signature verification removed from route
- [ ] Event processing delegated
- [ ] Both routes active (zero-downtime)
- [ ] Old route marked deprecated

**Files**:
- `src/apps/ingress-egress-service.ts`

---

### IEF-009: Regression testing for Twilio
**Owner**: backend-developer
**Effort**: M (1 day)
**Priority**: P0
**Depends**: IEF-008

**Tasks**:
1. Test webhook signature validation
2. Test event publishing to bus
3. Test bot auto-join
4. Load test (50 req/s for 60s)
5. Verify P99 latency < 3s

**Acceptance Criteria**:
- [ ] Signature validation tested (valid/invalid)
- [ ] Events published correctly
- [ ] Bot auto-join works
- [ ] Load test: 50 req/s, 0 failures
- [ ] P99 latency < 3 seconds
- [ ] All integration tests pass

**Files**:
- `tests/apps/ingress-egress-twilio-webhooks.test.ts`

---

## Phase 1.4: Documentation & Validation (Days 9-10)

### IEF-010: Architecture validation script
**Owner**: devops-engineer
**Effort**: M (1 day)
**Priority**: P1
**Depends**: IEF-002

**Tasks**:
1. Create `tools/validate-ingress-architecture.ts`
2. Validate WebhookConnector implementations
3. Validate ConnectorMetadata completeness
4. Detect deprecated patterns
5. Integrate with Husky pre-commit

**Acceptance Criteria**:
- [ ] Validates WebhookConnector methods
- [ ] Validates ConnectorMetadata fields
- [ ] Detects inline signature verification
- [ ] Runs as pre-commit hook
- [ ] Non-zero exit on failure
- [ ] Clear error messages

**Files**:
- `tools/validate-ingress-architecture.ts`
- `.husky/pre-commit`

---

### IEF-011: Update documentation
**Owner**: devops-engineer
**Effort**: S (0.5 day)
**Priority**: P1
**Depends**: IEF-009

**Tasks**:
1. Update CLAUDE.md with webhook pattern
2. Create `documentation/guides/adding-ingress-platform.md`
3. Update architecture diagram
4. Add JSDoc examples

**Acceptance Criteria**:
- [ ] CLAUDE.md updated
- [ ] Platform integration guide created
- [ ] Architecture diagram updated
- [ ] JSDoc examples added
- [ ] Runnable code examples included
- [ ] Links to Slack integration (Sprint 343)

**Files**:
- `CLAUDE.md`
- `documentation/guides/adding-ingress-platform.md`
- `documentation/diagrams/ingress-webhook-flow.md`

---

### IEF-012: Sprint retro and handoff
**Owner**: lead-developer
**Effort**: S (0.5 day)
**Priority**: P1
**Depends**: IEF-010, IEF-011

**Tasks**:
1. Hold retro meeting
2. Document learnings
3. Update CHANGELOG.md
4. Tag release (v0.14.0-framework)
5. Deploy to staging
6. Brief team on Sprint 343

**Acceptance Criteria**:
- [ ] Retro meeting held
- [ ] Learnings in `planning/sprint-342/retro.md`
- [ ] CHANGELOG.md updated
- [ ] Release tagged
- [ ] Deployed to staging and validated
- [ ] Sprint 343 kickoff deck prepared

**Files**:
- `CHANGELOG.md`
- `planning/sprint-342/retro.md`

---

## Daily Standup Format

**What I did yesterday**:
- [Completed tasks with IEF-XXX references]

**What I'm doing today**:
- [In-progress tasks with IEF-XXX references]

**Blockers**:
- [Any blockers with proposed solutions]

---

## Definition of Done

A task is "Done" when:
- [x] Code implemented and passes linter
- [x] Unit tests written (> 80% coverage)
- [x] Integration tests pass
- [x] Peer reviewed and approved
- [x] Documentation updated
- [x] Deployed to staging and validated
- [x] Acceptance criteria met
- [x] No critical/high bugs
- [x] Metrics/logging in place
- [x] Runbook updated (if needed)

---

## Backlog Status Tracking

Update `backlog.yaml` status as work progresses:
- `todo` → `in_progress` → `done`

Log all status changes in `request-log.md` with timestamp and reason.

---

**Plan Version**: 1.0
**Last Updated**: 2026-07-14
