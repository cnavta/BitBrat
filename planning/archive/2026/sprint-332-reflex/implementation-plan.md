# Implementation Plan – Sprint 332: Reflex Bit

**Role**: Lead Implementor
**Created**: 2026-07-04
**Status**: Ready for Implementation
**Technical Architecture**: `planning/sprint-332-reflex/technical-architecture.md`

---

## Overview

This implementation plan breaks down the Reflex bit development into concrete, actionable tasks following the approved technical architecture. The plan is organized into implementation phases with clear dependencies and testing requirements.

---

## Implementation Phases

### Phase 1: Core Foundation (Priority: Critical)
Foundation components required for all subsequent work.

#### Task Group 1.1: Data Model & Types
**Objective**: Define TypeScript interfaces and Firestore schema

**Tasks**:
1. **Define Reflex interface** (`src/types/reflex.ts`)
   - Create `Reflex` interface with all fields from architecture
   - Include `candidateTemplate?: string` field for response generation
   - Create `ReflexCondition` interface (eventTypes, channels, platforms, userRoles, minAuthLevel)
   - Create `PatternMatch` type union (exact | contains | regex | prefix | suffix)
   - Create `ToolInvocation` interface (tool, parameters with template support)
   - Add JSDoc comments with examples
   - Export all types

2. **Define execution event interfaces** (`src/types/reflex-events.ts`)
   - Create `ReflexExecutedEvent` interface (internal.reflex.executed.v1 schema)
   - Create `ReflexFailedEvent` interface (internal.reflex.failed.v1 schema)
   - Create `ReflexTriggeredBy` interface (shared context)
   - Add version literals ('1')
   - Export all types

3. **Create Firestore schema validator**
   - Add Firestore rules for `reflexes` collection
   - Validate required fields
   - Add indexes for `active` and `priority`
   - Document in `firestore.rules`

**Testing**:
- Unit test: Type definitions compile without errors
- Unit test: Schema validator accepts valid reflexes, rejects invalid

**Dependencies**: None

---

#### Task Group 1.2: Matching Engine
**Objective**: Implement fast, safe pattern matching with 5 match types

**Tasks**:
1. **Create pattern matcher** (`src/services/reflex/pattern-matcher.ts`)
   - Implement `matchPattern(value: string, pattern: string, type: PatternMatch): boolean`
   - Implement exact match (strict equality)
   - Implement contains match (substring)
   - Implement prefix match (startsWith)
   - Implement suffix match (endsWith)
   - Implement regex match with safe-regex validation
   - Add ReDoS protection using `safe-regex` library
   - Throw error on unsafe regex patterns
   - Add performance logging (<10ms target)

2. **Create field accessor** (`src/services/reflex/field-accessor.ts`)
   - Implement `getFieldValue(event: InternalEventV2, path: string): any`
   - Support JSONPath-like syntax (e.g., `message.text`, `identity.user.id`)
   - Handle nested object traversal
   - Handle undefined/null fields gracefully
   - Return undefined for missing paths
   - Add unit tests for edge cases

3. **Create condition evaluator** (`src/services/reflex/condition-evaluator.ts`)
   - Implement `evaluateConditions(event: InternalEventV2, conditions: ReflexCondition): boolean`
   - Check eventTypes array (if specified)
   - Check channels array (if specified)
   - Check platforms array (if specified)
   - Check userRoles array (if specified)
   - Check minAuthLevel (if specified)
   - Return true only if ALL conditions match (AND logic)
   - Return true if no conditions specified

4. **Create reflex matcher** (`src/services/reflex/reflex-matcher.ts`)
   - Implement `matchReflex(event: InternalEventV2, reflex: Reflex): boolean`
   - Evaluate conditions first (early exit if false)
   - Extract field value using field accessor
   - Apply pattern matcher
   - Log match attempts (debug level)
   - Return boolean result

5. **Create reflex selector** (`src/services/reflex/reflex-selector.ts`)
   - Implement `selectReflexes(event: InternalEventV2, reflexes: Reflex[]): Reflex[]`
   - Filter only active reflexes
   - Sort by priority (ascending - lower numbers = higher priority)
   - Apply matchReflex to each candidate
   - Return first match (Phase 1 behavior)
   - Log selection process
   - Return empty array if no matches

**Testing**:
- Unit test: Each match type with valid/invalid patterns
- Unit test: ReDoS protection rejects unsafe regex
- Unit test: Field accessor handles nested paths
- Unit test: Condition evaluator with all condition types
- Unit test: Reflex selector returns highest priority match
- Unit test: Matching performance <10ms p99 (benchmark with 100 rules)

**Dependencies**: Task Group 1.1 (types)

---

#### Task Group 1.3: Orchestration Engine
**Objective**: Template interpolation and MCP tool invocation

**Tasks**:
1. **Create template interpolator** (`src/services/reflex/template-interpolator.ts`)
   - Implement `interpolateTemplate(template: string, event: InternalEventV2): string`
   - Parse `{{field.path}}` syntax using regex
   - Replace each placeholder with field value
   - Handle missing fields (replace with empty string, log warning)
   - Handle non-string values (JSON.stringify for objects/arrays)
   - Support escaped braces `\{{` → `{{`
   - Return interpolated string

2. **Create parameter builder** (`src/services/reflex/parameter-builder.ts`)
   - Implement `buildParameters(toolInvocation: ToolInvocation, event: InternalEventV2): Record<string, any>`
   - Iterate over parameter template object
   - Interpolate each string value
   - Preserve non-string values as-is
   - Return final parameter object

3. **Create candidate builder** (`src/services/reflex/candidate-builder.ts`)
   - Implement `buildCandidate(template: string, event: InternalEventV2, toolResult: any): InternalCandidate`
   - Replace `{{event.path}}` placeholders with event field values
   - Replace `{{result.path}}` placeholders with tool result values
   - Use field accessor for both event and result traversal
   - Build InternalCandidate object (source: 'reflex', text, confidence: 1.0, metadata)
   - Handle missing fields gracefully (keep placeholder or empty string)
   - Return candidate object

4. **Create tool executor** (`src/services/reflex/tool-executor.ts`)
   - Implement `executeTool(tool: string, parameters: Record<string, any>, authToken: string): Promise<any>`
   - Get TOOL_GATEWAY_URL from environment
   - Build MCP tool invocation request
   - Add Authorization header with MCP_AUTH_TOKEN
   - POST to tool-gateway `/mcp/invoke`
   - Set timeout (default 5000ms from reflex or global config)
   - Parse response
   - Throw error on non-2xx status
   - Return tool result

5. **Create reflex executor** (`src/services/reflex/reflex-executor.ts`)
   - Implement `executeReflex(reflex: Reflex, event: InternalEventV2, authToken: string): Promise<ReflexExecutionResult>`
   - Build parameters using parameter builder
   - Execute tool using tool executor
   - Build candidate if candidateTemplate is defined (using candidate builder)
   - Include candidate in execution result
   - Track latency (start/end timestamps)
   - Update reflex statistics (increment successCount, update lastExecutedAt)
   - Return { success: true, result, candidate, latency } on success
   - Catch errors, update errorCount
   - Return { success: false, error, latency } on failure
   - Log execution at INFO level (include candidateGenerated flag)

**Testing**:
- Unit test: Template interpolation with various field paths
- Unit test: Template interpolation handles missing fields
- Unit test: Candidate builder interpolates {{event.field}} correctly
- Unit test: Candidate builder interpolates {{result.field}} correctly
- Unit test: Candidate builder handles missing fields
- Unit test: Parameter builder preserves types
- Unit test: Tool executor makes correct HTTP requests (mock tool-gateway)
- Unit test: Tool executor respects timeout
- Integration test: Execute real MCP tool via tool-gateway (e2e)
- Integration test: Candidate generated and added to event

**Dependencies**: Task Group 1.1 (types), Task Group 1.2 (matching)

---

### Phase 2: Storage & Caching (Priority: Critical)

#### Task Group 2.1: Firestore Integration
**Objective**: Real-time rule storage and cache synchronization

**Tasks**:
1. **Create Firestore repository** (`src/services/reflex/reflex-repository.ts`)
   - Implement `ReflexRepository` class
   - Method: `getAll(): Promise<Reflex[]>` - fetch all reflexes
   - Method: `getById(id: string): Promise<Reflex | null>` - fetch single reflex
   - Method: `create(reflex: Omit<Reflex, 'id'>): Promise<Reflex>` - create new reflex
   - Method: `update(id: string, updates: Partial<Reflex>): Promise<void>` - update existing
   - Method: `delete(id: string): Promise<void>` - soft delete (set active=false)
   - Method: `subscribe(callback: (reflexes: Reflex[]) => void): () => void` - onSnapshot listener
   - Handle Firestore timestamps (convert to ISO strings)
   - Add error handling for Firestore operations

2. **Create reflex cache** (`src/services/reflex/reflex-cache.ts`)
   - Implement `ReflexCache` class with in-memory Map
   - Method: `initialize(repository: ReflexRepository): Promise<void>` - load initial data
   - Method: `getAll(): Reflex[]` - return cached reflexes
   - Method: `getById(id: string): Reflex | undefined` - lookup by ID
   - Subscribe to repository changes
   - Update cache on Firestore changes (add/update/delete)
   - Log cache synchronization events
   - Thread-safe operations (use mutex if needed)

3. **Create cache warming** (`src/apps/reflex-service.ts`)
   - Initialize repository on service startup
   - Initialize cache with repository
   - Wait for initial cache load before accepting messages
   - Log cache status (count of loaded reflexes)
   - Handle cache initialization failures (retry logic)

**Testing**:
- Unit test: Repository CRUD operations (mock Firestore)
- Unit test: Cache synchronization on Firestore updates
- Integration test: Real Firestore read/write operations
- Integration test: Cache stays in sync with Firestore changes

**Dependencies**: Task Group 1.1 (types)

---

### Phase 3: Event Flow Integration (Priority: Critical)

#### Task Group 3.1: Message Handling
**Objective**: Subscribe to internal.reflex.v1, implement complete()/next() pattern

**Tasks**:
1. **Update reflex-service.ts message handler**
   - Subscribe to `internal.reflex.v1` topic
   - Implement `handleReflexMessage(event: InternalEventV2): Promise<void>`
   - Get reflexes from cache
   - Call `selectReflexes(event, reflexes)` to find matches
   - **No Match Path**:
     - Log "No reflex matched" (debug level)
     - Call `this.next(event)` to continue routing slip
     - Return early
   - **Match Path**:
     - Log "Reflex matched: {reflex.name}" (info level)
     - Call `executeReflex(reflex, event, authToken)`
     - Enrich event with reflex metadata (annotations)
     - Call `this.complete(enrichedEvent)` to skip remaining analysis
     - Publish execution event (success or failure)
   - **Error Path**:
     - Log error (error level)
     - Call `this.complete(event)` (degraded mode - never block)
     - Publish reflex failure event
   - Add structured logging at all decision points
   - Track end-to-end latency (<150ms target)

2. **Implement event enrichment**
   - Add `reflex` annotation to event
   - Include: reflexId, reflexName, matchedPattern, executionLatency
   - Preserve existing annotations
   - Add timestamp
   - Add candidate to event.candidates array if one was generated
   - Preserve existing candidates

3. **Implement execution event publishing**
   - Create `publishReflexExecuted(reflex, event, result, latency): Promise<void>`
   - Build ReflexExecutedEvent from schema
   - Publish to `internal.reflex.executed.v1`
   - Create `publishReflexFailed(reflex, event, error, latency): Promise<void>`
   - Build ReflexFailedEvent from schema
   - Publish to `internal.reflex.failed.v1`
   - Include triggeredBy context (correlationId, eventType, user, channel, platform)
   - Log publishing at debug level
   - Handle publishing errors gracefully (log but don't fail)

**Testing**:
- Unit test: No match calls next()
- Unit test: Match calls complete()
- Unit test: Error calls complete() (degraded mode)
- Unit test: Event enrichment adds correct annotations
- Unit test: Candidate added to event when template is defined
- Unit test: No candidate added when template is not defined
- Unit test: Execution events published with correct schemas
- Integration test: End-to-end event flow through Pub/Sub
- Integration test: Generated candidate appears in egress

**Dependencies**: Task Group 1.2 (matching), Task Group 1.3 (orchestration), Task Group 2.1 (cache)

---

#### Task Group 3.2: Topic Configuration
**Objective**: Update architecture.yaml and event-router configuration

**Tasks**:
1. **Update architecture.yaml**
   - Add `internal.reflex.v1` topic definition
     - Description: "Fast pattern-matching and deterministic orchestration"
     - Producers: [event-router]
     - Consumers: [reflex]
   - Add `internal.reflex.executed.v1` topic definition
     - Description: "Published when reflex successfully executes"
     - Producers: [reflex]
     - Consumers: [] # Phase 1: no consumers
   - Add `internal.reflex.failed.v1` topic definition
     - Description: "Published when reflex execution fails"
     - Producers: [reflex]
     - Consumers: [] # Phase 1: no consumers
   - Update reflex service `active: true` (enable in production)

2. **Update event-router routing slip**
   - Insert `internal.reflex.v1` step after `internal.auth.v1`
   - Update routing slip JSON in event-router configuration
   - Ensure routing slip includes reflex step for analysis stage
   - Test routing slip generation logic

3. **Update Terraform/infrastructure**
   - Create Pub/Sub topics in GCP:
     - `internal-reflex-v1`
     - `internal-reflex-executed-v1`
     - `internal-reflex-failed-v1`
   - Create subscriptions:
     - `reflex-service-reflex-v1-sub` (pull)
   - Set message retention (7 days)
   - Set ack deadline (60 seconds)
   - Apply infrastructure changes

**Testing**:
- Manual test: Verify topics created in GCP console
- Manual test: Verify subscriptions created
- Integration test: Event-router includes reflex in routing slip

**Dependencies**: Task Group 3.1 (message handling)

---

### Phase 4: MCP Management Tools (Priority: High)

#### Task Group 4.1: MCP Tool Implementation
**Objective**: Provide 5 MCP tools for reflex management

**Tasks**:
1. **Implement reflex.create tool**
   - Schema: name, description, pattern (field, matchType, value), conditions, toolInvocation
   - Validate all required fields
   - Validate regex patterns using safe-regex
   - Generate unique ID (Firestore auto-ID)
   - Set defaults: active=true, priority=100, createdAt=now, stats={0,0,0}
   - Save to Firestore via repository
   - Return created reflex object
   - Add comprehensive error messages

2. **Implement reflex.list tool**
   - Schema: active (optional boolean filter), limit (optional, default 50)
   - Fetch from cache (not Firestore - use cache for speed)
   - Apply active filter if specified
   - Sort by priority ascending
   - Apply limit
   - Return array of reflex objects
   - Include stats in response

3. **Implement reflex.update tool**
   - Schema: id (required), updates (partial Reflex object)
   - Validate id exists
   - Validate updates (e.g., regex patterns if changing)
   - Update updatedAt timestamp
   - Save to Firestore via repository
   - Return updated reflex object
   - Prevent updating id, createdAt, stats

4. **Implement reflex.delete tool**
   - Schema: id (required)
   - Validate id exists
   - Soft delete: set active=false, deletedAt=now
   - Save to Firestore via repository
   - Return success confirmation
   - Add hard delete option (admin only, future)

5. **Implement reflex.test tool**
   - Schema: pattern (field, matchType, value), testInput (object simulating event)
   - Create temporary reflex object (not saved)
   - Apply pattern matching logic
   - Return match result: { matched: boolean, extractedValue: string, explanation: string }
   - Useful for testing regex before creating reflex
   - No side effects (read-only)

6. **Register MCP tools in reflex-service.ts**
   - Use MCP SDK `server.tool()` registration
   - Add descriptions and schemas for each tool
   - Wire up to repository
   - Add authorization checks (future: admin-only for delete)

**Testing**:
- Unit test: Each tool with valid inputs
- Unit test: Each tool with invalid inputs (error handling)
- Integration test: Create → list → update → delete flow
- Integration test: Test tool with various patterns
- Manual test: Use MCP Inspector to test all tools

**Dependencies**: Task Group 2.1 (repository)

---

### Phase 5: Error Handling & Observability (Priority: High)

#### Task Group 5.1: Structured Logging
**Objective**: Comprehensive logging at every decision point

**Tasks**:
1. **Add structured logging to matcher**
   - Log: Reflex evaluation started (reflexId, reflexName)
   - Log: Condition evaluation result (each condition type)
   - Log: Pattern match attempt (field, pattern, matchType)
   - Log: Match result (boolean, latency)
   - Use debug level for details, info for matches

2. **Add structured logging to executor**
   - Log: Tool invocation started (tool, parameters)
   - Log: Tool invocation completed (result, latency)
   - Log: Tool invocation failed (error, latency)
   - Log: Statistics updated (successCount, errorCount)
   - Use info level for execution, error for failures

3. **Add structured logging to message handler**
   - Log: Message received (correlationId, eventType)
   - Log: Cache lookup (reflex count)
   - Log: Match decision (matched/no-match, reflexId)
   - Log: Routing decision (next/complete)
   - Log: Execution event published
   - Log: End-to-end latency
   - Use info level for key events

4. **Add correlation IDs**
   - Propagate correlationId from event to all logs
   - Include in tool invocations (headers)
   - Include in execution events

**Testing**:
- Manual test: Verify logs appear in console/Cloud Logging
- Manual test: Verify correlation IDs link related logs
- Integration test: Log volume doesn't exceed budget

**Dependencies**: All task groups (add logging throughout)

---

#### Task Group 5.2: Metrics & Monitoring
**Objective**: Expose performance and health metrics

**Tasks**:
1. **Add performance metrics**
   - Metric: `reflex.match.latency` (histogram, ms)
   - Metric: `reflex.execute.latency` (histogram, ms)
   - Metric: `reflex.end_to_end.latency` (histogram, ms)
   - Metric: `reflex.match.count` (counter, labels: matched/no-match)
   - Metric: `reflex.execute.count` (counter, labels: success/failure)
   - Use OpenTelemetry or Cloud Monitoring

2. **Add health metrics**
   - Metric: `reflex.cache.size` (gauge, reflex count)
   - Metric: `reflex.cache.sync.errors` (counter)
   - Metric: `reflex.message.errors` (counter)
   - Expose health endpoint `/health` (return cache status)

3. **Create monitoring dashboard**
   - Panel: p50/p95/p99 latency for matching
   - Panel: p50/p95/p99 latency for end-to-end
   - Panel: Match rate (matches/sec)
   - Panel: Success vs failure rate
   - Panel: Cache size over time
   - Alert: p99 latency >150ms
   - Alert: Error rate >5%

**Testing**:
- Manual test: Verify metrics in Cloud Monitoring
- Manual test: Trigger alert conditions
- Integration test: Health endpoint returns 200

**Dependencies**: Task Group 3.1 (message handling)

---

### Phase 6: Testing & Validation (Priority: Critical)

#### Task Group 6.1: Unit Tests
**Objective**: >80% code coverage

**Tasks**:
1. **Write pattern matcher tests** (`src/services/reflex/pattern-matcher.test.ts`)
   - Test all 5 match types with valid inputs
   - Test ReDoS protection (expect error on evil regex)
   - Test edge cases (empty strings, special characters)
   - Test performance (benchmark 10,000 matches)

2. **Write field accessor tests** (`src/services/reflex/field-accessor.test.ts`)
   - Test nested path access
   - Test missing paths (return undefined)
   - Test array access (future feature, placeholder)

3. **Write condition evaluator tests** (`src/services/reflex/condition-evaluator.test.ts`)
   - Test each condition type individually
   - Test combined conditions (AND logic)
   - Test empty conditions (match all)

4. **Write template interpolator tests** (`src/services/reflex/template-interpolator.test.ts`)
   - Test single placeholder
   - Test multiple placeholders
   - Test missing fields
   - Test escaped braces

5. **Write executor tests** (`src/services/reflex/reflex-executor.test.ts`)
   - Mock tool-gateway HTTP calls
   - Test successful execution
   - Test timeout handling
   - Test error handling

6. **Write repository tests** (`src/services/reflex/reflex-repository.test.ts`)
   - Mock Firestore
   - Test CRUD operations
   - Test subscription updates

7. **Write cache tests** (`src/services/reflex/reflex-cache.test.ts`)
   - Test initialization
   - Test synchronization on updates
   - Test concurrent access (if needed)

8. **Run test coverage report**
   - Execute: `npm run test:coverage`
   - Verify: >80% line coverage
   - Verify: >80% branch coverage
   - Fix: Add tests for uncovered code

**Testing**:
- All unit tests pass
- Coverage meets threshold

**Dependencies**: All implementation task groups

---

#### Task Group 6.2: Integration Tests
**Objective**: Verify end-to-end behavior

**Tasks**:
1. **Write event flow integration test**
   - Setup: Create test reflex in Firestore
   - Setup: Start reflex-service locally
   - Test: Publish event to `internal.reflex.v1` that matches reflex
   - Verify: Event enriched with reflex annotation
   - Verify: complete() called (event goes to egress, not query-analyzer)
   - Verify: Execution event published to `internal.reflex.executed.v1`
   - Teardown: Delete test reflex

2. **Write no-match integration test**
   - Setup: Create test reflex that won't match
   - Test: Publish event that doesn't match
   - Verify: next() called (event continues to query-analyzer)
   - Verify: No execution event published

3. **Write error handling integration test**
   - Setup: Create reflex that calls non-existent tool
   - Test: Publish matching event
   - Verify: complete() called (degraded mode)
   - Verify: Failure event published to `internal.reflex.failed.v1`
   - Verify: Event not blocked

4. **Write MCP tool integration test**
   - Setup: Start reflex-service MCP server
   - Test: Call reflex.create via MCP Inspector
   - Verify: Reflex created in Firestore
   - Test: Call reflex.list
   - Verify: New reflex in list
   - Test: Call reflex.update
   - Verify: Reflex updated in Firestore
   - Test: Call reflex.delete
   - Verify: Reflex marked inactive

5. **Write cache synchronization test**
   - Setup: Start reflex-service
   - Test: Create reflex via Firestore Admin SDK (not MCP)
   - Verify: Cache updated within 1 second
   - Test: Update reflex via Firestore
   - Verify: Cache reflects update

**Testing**:
- All integration tests pass
- Tests run in CI/CD pipeline

**Dependencies**: All implementation task groups

---

#### Task Group 6.3: Manual Testing
**Objective**: Validate reference use case and real-world scenarios

**Tasks**:
1. **Test reference use case: !fail → OBS toggle**
   - Create reflex:
     - Pattern: exact match on `message.text` = `!fail`
     - Condition: channel = `#test`
     - Tool: `obs.set_source_visibility`
     - Parameters: `{ "source": "FailOverlay", "visible": true }`
   - Test: Send `!fail` chat message in #test channel
   - Verify: OBS source visibility toggled
   - Verify: Response <150ms
   - Verify: No LLM call made (check logs)
   - Verify: Execution event published

2. **Test regex pattern: !timer <duration>**
   - Create reflex:
     - Pattern: regex match on `message.text` = `^!timer (\d+)$`
     - Tool: `scheduler.create_timer`
     - Parameters: `{ "duration": "{{message.text}}" }` (extract duration)
   - Test: Send `!timer 60` chat message
   - Verify: Timer created (check scheduler logs)
   - Verify: Pattern matched correctly

3. **Test authorization: Admin-only command**
   - Create reflex:
     - Pattern: exact match on `message.text` = `!restart`
     - Condition: minAuthLevel = "admin"
     - Tool: `system.restart`
   - Test: Send `!restart` as non-admin
   - Verify: No match (condition failed)
   - Test: Send `!restart` as admin
   - Verify: Match and execute

4. **Test performance with 100 reflexes**
   - Create 100 reflexes with varying priorities
   - Test: Send message that matches reflex #100 (lowest priority)
   - Verify: Still completes in <150ms
   - Verify: Correct reflex selected (highest priority wins)

5. **Test error scenarios**
   - Test: Tool-gateway timeout
   - Test: Invalid tool name
   - Test: Malformed parameters
   - Verify: All errors handled gracefully, event not blocked

**Testing**:
- Document all manual test results
- Create video/screenshots for reference use case

**Dependencies**: Task Group 6.1 (unit tests), Task Group 6.2 (integration tests)

---

### Phase 7: Documentation & Deployment (Priority: Medium)

#### Task Group 7.1: Documentation
**Objective**: Document usage, configuration, and troubleshooting

**Tasks**:
1. **Create user guide** (`docs/reflex-user-guide.md`)
   - Overview: What is Reflex, when to use it
   - Quick start: Create your first reflex
   - Pattern matching: Examples of all 5 types
   - Conditions: How to filter by channel, platform, role, etc.
   - Template interpolation: Extract and use event data
   - MCP tools: How to create/manage reflexes
   - Examples: 10+ real-world reflex recipes
   - Troubleshooting: Common issues and solutions

2. **Create developer guide** (`docs/reflex-developer-guide.md`)
   - Architecture overview (link to technical-architecture.md)
   - Code structure: Key files and responsibilities
   - Testing: How to run unit/integration tests
   - Local development: How to test reflexes locally
   - Adding new match types (extensibility)
   - Performance tuning: Optimization tips

3. **Update CHANGELOG.md**
   - Add version 0.7.5 section
   - Document new features:
     - Reflex bit activation
     - 5 pattern match types
     - MCP management tools
     - Execution event publishing
   - Document breaking changes (none for Phase 1)

4. **Update README.md** (if needed)
   - Add Reflex to service list
   - Link to user guide

**Testing**:
- Manual review: Documentation is clear and accurate
- Manual test: Follow quick start guide end-to-end

**Dependencies**: All implementation complete

---

#### Task Group 7.2: Deployment Preparation
**Objective**: Prepare for production deployment

**Tasks**:
1. **Update environment configurations**
   - Add to `env/staging/reflex.yaml`:
     - TOOL_GATEWAY_URL
     - MCP_AUTH_TOKEN (from Secret Manager)
     - LOG_LEVEL: debug
   - Add to `env/production/reflex.yaml`:
     - TOOL_GATEWAY_URL
     - MCP_AUTH_TOKEN
     - LOG_LEVEL: info

2. **Create deployment runbook** (`docs/reflex-deployment-runbook.md`)
   - Pre-deployment checklist
   - Deployment steps (Terraform, Cloud Run, etc.)
   - Verification steps (health check, test message)
   - Rollback procedure
   - Monitoring: What to watch after deployment

3. **Set up staging deployment**
   - Deploy to staging environment
   - Create test reflex
   - Send test message
   - Verify logs, metrics, execution events
   - Run integration tests against staging
   - Performance test: Load test with 1000 events/sec

4. **Create rollback plan**
   - Document: How to disable reflex (set active: false in architecture.yaml)
   - Document: How to drain message queue
   - Document: How to revert event-router routing slip

**Testing**:
- Staging deployment successful
- All integration tests pass in staging
- Performance meets targets in staging

**Dependencies**: Task Group 6.3 (manual testing)

---

#### Task Group 7.3: Production Deployment
**Objective**: Deploy to production with confidence

**Tasks**:
1. **Deploy infrastructure**
   - Apply Terraform changes (topics, subscriptions)
   - Verify resources created
   - Verify IAM permissions

2. **Deploy reflex service**
   - Build Docker image
   - Push to Container Registry
   - Deploy to Cloud Run
   - Verify service healthy
   - Verify cache initialized

3. **Update event-router**
   - Deploy updated routing slip
   - Verify reflex step included
   - Monitor event flow

4. **Enable reflex in production**
   - Update `architecture.yaml`: reflex active: true
   - Commit and push
   - Verify configuration applied

5. **Monitor deployment**
   - Watch logs for errors
   - Watch metrics for latency
   - Send test messages
   - Verify execution events published
   - Monitor for 24 hours

6. **Create production reflexes**
   - Create !fail reflex (reference use case)
   - Create 2-3 additional useful reflexes
   - Document in wiki or user guide

**Testing**:
- Production health check passes
- Reference use case works in production
- Metrics show <150ms p99 latency
- No errors in logs

**Dependencies**: Task Group 7.2 (staging deployment)

---

## Success Criteria

### Functional Requirements
- ✅ Reflex matches patterns using 5 match types
- ✅ Reflex evaluates conditions (eventTypes, channels, platforms, userRoles, minAuthLevel)
- ✅ Reflex executes single MCP tool with templated parameters
- ✅ Reflex calls complete() on match (skips LLM analysis)
- ✅ Reflex calls next() on no match (continues routing slip)
- ✅ Reflex publishes execution events (success and failure)
- ✅ MCP tools allow creating/listing/updating/deleting reflexes
- ✅ Reference use case (!fail → OBS toggle) works end-to-end

### Non-Functional Requirements
- ✅ Pattern matching <10ms p99
- ✅ End-to-end latency <150ms p99 (excluding tool execution time)
- ✅ Code coverage >80%
- ✅ Error handling: Never blocks events (degraded mode)
- ✅ Cache synchronization <1 second
- ✅ ReDoS protection prevents unsafe regex

### Operational Requirements
- ✅ Structured logging at all decision points
- ✅ Metrics for latency, match rate, success/error rate
- ✅ Health endpoint returns cache status
- ✅ Documentation (user guide, developer guide, runbook)
- ✅ Deployment to staging and production successful
- ✅ Monitoring dashboard configured with alerts

---

## Dependencies & Prerequisites

### External Dependencies
1. **Tool Gateway**: Must be deployed and accessible
2. **Event Router**: Must support routing slip updates
3. **Firestore**: Must be provisioned with proper IAM
4. **Pub/Sub**: Topics and subscriptions must be created
5. **Secret Manager**: MCP_AUTH_TOKEN must be stored

### Internal Dependencies
1. MCP SDK (already available)
2. InternalEventV2 type (already defined)
3. Pub/Sub client library (already in use)
4. Firestore client library (already in use)

### Required Approvals
- [x] Technical architecture approved
- [ ] Implementation plan approved (this document)
- [ ] Backlog prioritized and approved

---

## Risk Mitigation

### Risk: ReDoS attacks via malicious regex
**Mitigation**: Use safe-regex library to validate all regex patterns before compilation. Reject unsafe patterns at creation time.

### Risk: Tool-gateway timeout blocks event flow
**Mitigation**: Implement timeout in tool executor (default 5000ms). On timeout, call complete() in degraded mode and publish failure event.

### Risk: Cache out of sync with Firestore
**Mitigation**: Use onSnapshot listener for real-time sync. Add health check to verify cache freshness. Add metric for sync errors.

### Risk: Performance degradation with many reflexes
**Mitigation**: Benchmark with 100+ reflexes. Optimize matching algorithm. Consider indexing or pre-filtering by eventType if needed.

### Risk: Template injection security issue
**Mitigation**: Template interpolation is read-only (extracts from event, doesn't execute code). No eval() or code execution. Parameters passed directly to tool-gateway which validates inputs.

---

## Implementation Schedule (Estimated)

| Phase | Task Group | Estimated Time | Dependencies |
|-------|-----------|----------------|--------------|
| 1 | 1.1 Data Model | 2 hours | None |
| 1 | 1.2 Matching Engine | 6 hours | 1.1 |
| 1 | 1.3 Orchestration Engine | 6 hours | 1.1, 1.2 |
| 2 | 2.1 Firestore Integration | 4 hours | 1.1 |
| 3 | 3.1 Message Handling | 6 hours | 1.2, 1.3, 2.1 |
| 3 | 3.2 Topic Configuration | 2 hours | 3.1 |
| 4 | 4.1 MCP Tools | 6 hours | 2.1 |
| 5 | 5.1 Structured Logging | 3 hours | All |
| 5 | 5.2 Metrics & Monitoring | 4 hours | 3.1 |
| 6 | 6.1 Unit Tests | 8 hours | All implementation |
| 6 | 6.2 Integration Tests | 6 hours | All implementation |
| 6 | 6.3 Manual Testing | 4 hours | 6.1, 6.2 |
| 7 | 7.1 Documentation | 4 hours | All complete |
| 7 | 7.2 Deployment Prep | 4 hours | 6.3 |
| 7 | 7.3 Production Deployment | 3 hours | 7.2 |
| **Total** | | **68 hours** | **~8-9 work days** |

---

## Next Steps

1. **Review this implementation plan** with user for approval
2. **Create backlog.yaml** with prioritized, trackable tasks
3. **Begin Phase 1** (Core Foundation) upon approval
4. **Daily standups**: Report progress, blockers, next tasks
5. **Iterate**: Adjust plan based on learnings during implementation

---

**Status**: Ready for review and approval
**Awaiting**: User sign-off to proceed with implementation
