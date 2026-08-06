# Sprint 372: Unified Bit Deployment - Execution Plan

**Role:** Lead Implementor
**Created:** 2026-07-28
**Sprint Duration:** 2 weeks (10 working days)
**Team Size:** 1 developer (full-time)

---

## Sprint Goals

### Primary Goal
Implement `brat bit deploy` command with strategy-based deployment that automatically selects deployment mechanism based on execution context, replacing all legacy deployment commands.

### Success Criteria
- ✅ `brat bit deploy <service>` works for docker-compose contexts
- ✅ `brat bit deploy <service>` works for cloud-run contexts
- ✅ `brat bit deploy --all` deploys all active services
- ✅ Legacy `brat deploy` and `brat docker up` commands removed
- ✅ 90%+ test coverage on new code
- ✅ Clean migration with no deprecated code paths

---

## Implementation Phases

### Phase 1: Foundation (Days 1-5)
**Goal:** Build deployment strategy framework

**Deliverables:**
1. Base strategy interface and types
2. Docker Compose strategy implementation
3. Cloud Run strategy implementation
4. Strategy factory
5. Comprehensive unit tests

### Phase 2: Integration (Days 6-8)
**Goal:** Implement unified `brat bit deploy` command and remove legacy commands

**Deliverables:**
1. `brat bit deploy` oclif command
2. Remove legacy deployment commands
3. Integration tests
4. Documentation updates
5. E2E smoke tests

---

## Daily Breakdown

### Day 1: Strategy Interface & Types
**Goal:** Define core abstractions

**Tasks:**
- [ ] Create `orchestration/deployment/strategy.ts`
- [ ] Define `DeploymentStrategy` interface
- [ ] Define `DeploymentPlan` type
- [ ] Define `DeploymentResult` type
- [ ] Define `ValidationResult` type
- [ ] Define `DeployOptions` type
- [ ] Write unit tests for type validation
- [ ] Create strategy factory skeleton

**Deliverable:** Core types and interfaces with tests
**Time Estimate:** 6-8 hours
**Risk:** Low

### Day 2: Docker Compose Strategy (Part 1)
**Goal:** Implement Docker Compose deployment strategy

**Tasks:**
- [ ] Create `orchestration/deployment/docker-compose-strategy.ts`
- [ ] Implement `prepare()` method
- [ ] Implement `validate()` method
- [ ] Extract compose file logic from `DockerOrchestrator`
- [ ] Write unit tests for prepare/validate

**Deliverable:** Docker Compose strategy (prepare & validate)
**Time Estimate:** 6-8 hours
**Risk:** Medium (refactoring existing orchestrator)

### Day 3: Docker Compose Strategy (Part 2)
**Goal:** Complete Docker Compose strategy implementation

**Tasks:**
- [ ] Implement `execute()` method
- [ ] Integrate with existing `DockerOrchestrator`
- [ ] Handle remote vs local deployment
- [ ] Write unit tests for execute
- [ ] Integration test with local context

**Deliverable:** Complete Docker Compose strategy with tests
**Time Estimate:** 6-8 hours
**Risk:** Medium (integration with orchestrator)

### Day 4: Cloud Run Strategy (Part 1)
**Goal:** Implement Cloud Run deployment strategy

**Tasks:**
- [ ] Create `orchestration/deployment/cloud-run-strategy.ts`
- [ ] Implement `prepare()` method
  - [ ] Environment variable loading
  - [ ] Secret resolution
  - [ ] Dockerfile detection
  - [ ] Image tag computation
- [ ] Implement `validate()` method
  - [ ] VPC preflight check
  - [ ] Dockerfile existence
  - [ ] Required env keys
- [ ] Write unit tests

**Deliverable:** Cloud Run strategy (prepare & validate)
**Time Estimate:** 6-8 hours
**Risk:** Low (reusing existing code)

### Day 5: Cloud Run Strategy (Part 2) + Factory
**Goal:** Complete Cloud Run strategy and strategy factory

**Tasks:**
- [ ] Implement `execute()` method
  - [ ] Cloud Build submission
  - [ ] Substitution computation
  - [ ] Error handling
- [ ] Complete `StrategyFactory`
  - [ ] Strategy selection logic
  - [ ] Error handling for unknown types
- [ ] Write unit tests for execute
- [ ] Write unit tests for factory
- [ ] Integration test with cloud-run context (dry-run)

**Deliverable:** Complete Cloud Run strategy + factory with tests
**Time Estimate:** 6-8 hours
**Risk:** Low

### Day 6: `brat bit deploy` Command (Part 1)
**Goal:** Implement core command structure

**Tasks:**
- [ ] Create `oclif-commands/bit/deploy.ts`
- [ ] Define command args (service name)
- [ ] Define command flags (--all, --dry-run, etc.)
- [ ] Implement service selection logic
- [ ] Implement context resolution
- [ ] Implement strategy selection
- [ ] Write command unit tests

**Deliverable:** Command skeleton with arg/flag parsing
**Time Estimate:** 6-8 hours
**Risk:** Low

### Day 7: `brat bit deploy` Command (Part 2)
**Goal:** Complete command implementation

**Tasks:**
- [ ] Implement single service deployment
- [ ] Implement --all deployment with concurrency
- [ ] Implement result reporting
- [ ] Implement error handling
- [ ] Add progress indicators
- [ ] Write command integration tests

**Deliverable:** Functional `brat bit deploy` command
**Time Estimate:** 6-8 hours
**Risk:** Medium (concurrency handling)

### Day 8: Remove Legacy Commands & Integration Testing
**Goal:** Remove old deployment commands and comprehensive testing

**Tasks:**
- [ ] Delete `tools/brat/src/oclif-commands/deploy/` directory
- [ ] Remove docker-compose commands (if separate)
- [ ] Update any internal references to old commands
- [ ] E2E: Deploy single service to local context
- [ ] E2E: Deploy all services to local context
- [ ] E2E: Deploy single service to staging context (dry-run)
- [ ] E2E: Deploy with --dry-run flag
- [ ] E2E: Test concurrency with multiple services
- [ ] E2E: Test error scenarios (missing dockerfile, invalid context)

**Deliverable:** Legacy commands removed, full test suite passing
**Time Estimate:** 6-8 hours
**Risk:** Low

### Day 9: Documentation & Polish
**Goal:** Documentation, examples, and final polish

**Tasks:**
- [ ] Update CLAUDE.md with `brat bit deploy` examples
- [ ] Remove references to old commands from all docs
- [ ] Update command help text and examples
- [ ] Add JSDoc comments to new code
- [ ] Code cleanup and refactoring
- [ ] Final test run
- [ ] Create demo/walkthrough

**Deliverable:** Production-ready feature with documentation
**Time Estimate:** 6-8 hours
**Risk:** Low

---

## Task Dependencies

```
Day 1: Strategy Interface & Types
  └─> Day 2: Docker Compose Strategy (Part 1)
      └─> Day 3: Docker Compose Strategy (Part 2)
  └─> Day 4: Cloud Run Strategy (Part 1)
      └─> Day 5: Cloud Run Strategy (Part 2) + Factory

Days 3 & 5: Strategies Complete
  └─> Day 6: brat bit deploy (Part 1)
      └─> Day 7: brat bit deploy (Part 2)
          └─> Day 8: Remove Legacy & Integration Testing
              └─> Day 9: Documentation & Polish
```

---

## Critical Path

**Longest dependency chain:** Days 1 → 2 → 3 → 6 → 7 → 8 → 9 = 9 days

**Parallel work opportunities:**
- Days 2-3 (Docker Compose) can partially overlap with Days 4-5 (Cloud Run)
- Testing within Day 8 can be parallelized across contexts

**Sprint Duration:** 9 working days (reduced from 10 with removal of backward compat)

---

## Risk Management

### High-Risk Areas

1. **Docker Compose Strategy Integration**
   - **Risk:** Refactoring `DockerOrchestrator` logic may have edge cases
   - **Mitigation:** Extract logic incrementally, comprehensive tests, verify with local deployment
   - **Contingency:** Fallback to delegation pattern (strategy wraps orchestrator)

2. **Concurrency Handling**
   - **Risk:** Queue implementation for --all may have edge cases
   - **Mitigation:** Reuse existing Queue from `deploy/services.ts`, test with varying concurrency
   - **Contingency:** Start with concurrency=1, optimize later

3. **Cloud Run VPC Preflight**
   - **Risk:** VPC checks may fail in unexpected environments
   - **Mitigation:** Reuse existing `assertVpcPreconditions`, add --allow-no-vpc flag
   - **Contingency:** Make VPC checks optional with warning

### Medium-Risk Areas

1. **Strategy Factory Edge Cases**
   - **Risk:** Unknown deployment types may not have clear error messages
   - **Mitigation:** Explicit validation with helpful error messages
   - **Contingency:** Graceful degradation to manual deployment instructions

2. **Environment Variable Handling**
   - **Risk:** Different strategies handle env vars differently (KV string vs object)
   - **Mitigation:** Normalize in `prepare()` method, consistent interface
   - **Contingency:** Strategy-specific env var handling with documentation

### Mitigation Strategy

- **Daily standup checkpoint:** Review progress, adjust estimates
- **Code review after each phase:** Catch issues early
- **Incremental commits:** Small, testable changes
- **Feature flags:** Disable new command if critical issues found

---

## Testing Strategy

### Unit Tests (Target: 90% coverage)

**Strategy Tests:**
- `docker-compose-strategy.test.ts` (60 LOC)
  - Test `prepare()` with local vs remote context
  - Test `validate()` with missing dockerfile
  - Test `execute()` success and failure paths
  - Mock `DockerOrchestrator`

- `cloud-run-strategy.test.ts` (80 LOC)
  - Test `prepare()` with/without secrets
  - Test `validate()` VPC preflight
  - Test `execute()` Cloud Build submission
  - Mock `submitBuild` and `assertVpcPreconditions`

- `strategy.test.ts` (40 LOC)
  - Test `StrategyFactory.create()`
  - Test unknown deployment type error

**Command Tests:**
- `bit/deploy.test.ts` (100 LOC)
  - Test arg/flag parsing
  - Test service selection (single vs --all)
  - Test context resolution
  - Test strategy selection
  - Test result reporting
  - Mock strategies

### Integration Tests

**Local Context:**
```bash
brat bit deploy llm-bot --context local --dry-run
brat bit deploy --all --context local --dry-run
```

**Staging Context:**
```bash
brat bit deploy api-gateway --context staging --dry-run
brat bit deploy --all --context staging --dry-run --concurrency 2
```

**Cloud Run Context (if available):**
```bash
brat bit deploy llm-bot --context prod --dry-run
```

### E2E Tests

**Smoke Tests (run against local):**
1. Deploy single service → Verify container running
2. Deploy all services → Verify all containers running
3. Deploy with --force-recreate → Verify containers recreated

**Error Scenarios:**
1. Missing dockerfile → Clear error message
2. Invalid context → Helpful error message
3. Missing required env vars → Validation failure
4. VPC preflight failure → Clear remediation steps

---

## Code Quality Standards

### TypeScript

- ✅ Strict mode enabled
- ✅ No `any` types (use `unknown` or proper types)
- ✅ Exhaustive switch cases for deployment types
- ✅ Error types extend `Error` with proper stack traces

### Documentation

- ✅ JSDoc comments on all public methods
- ✅ Inline comments for complex logic
- ✅ README updates for new commands
- ✅ Migration guide for deprecated commands

### Testing

- ✅ 90% code coverage minimum
- ✅ Tests run in CI (GitHub Actions)
- ✅ No flaky tests
- ✅ Integration tests use --dry-run when possible

### Git Hygiene

- ✅ Atomic commits (one logical change per commit)
- ✅ Descriptive commit messages
- ✅ Feature branch: `feat/unified-bit-deploy`
- ✅ Squash merge to main

---

## Rollout Plan

### Sprint 372 (This Sprint)
- ✅ Implement `brat bit deploy` command with strategy pattern
- ✅ Remove legacy deployment commands (`brat deploy`, `brat docker up`)
- ✅ Update all documentation to reference new command
- ✅ Merge to main (feature complete)

### Sprint 373 (Next Sprint)
- ✅ Monitor for issues in production usage
- ✅ Update CI/CD pipelines to use new command
- ✅ Gather user feedback
- ✅ Fix any edge cases discovered

---

## Success Metrics

### Functional Metrics
- [ ] `brat bit deploy <service>` works for docker-compose contexts
- [ ] `brat bit deploy <service>` works for cloud-run contexts
- [ ] `brat bit deploy --all` deploys all active services
- [ ] All flags work consistently across deployment types
- [ ] Dry-run mode works for all strategies
- [ ] Legacy deployment commands removed cleanly

### Quality Metrics
- [ ] 90%+ test coverage
- [ ] All CI tests passing
- [ ] Code review approved
- [ ] Documentation complete (no references to old commands)

### Performance Metrics
- [ ] Docker Compose deployment time ≤ `brat docker up` baseline
- [ ] Cloud Run deployment time ≤ `brat deploy service` baseline
- [ ] Concurrency respected (max N simultaneous deploys)

---

## Blockers & Dependencies

### External Dependencies
- ✅ None (all required code exists in platform)

### Internal Dependencies
- ✅ BEC framework (Sprint 349 - already complete)
- ✅ `DockerOrchestrator` (existing)
- ✅ `submitBuild` GCP provider (existing)
- ✅ `Queue` concurrency manager (existing)

### Potential Blockers
- ❌ None identified

---

## Acceptance Criteria

### Must Have (P0)
- [ ] `brat bit deploy <service>` command exists
- [ ] Command automatically selects strategy based on context
- [ ] Docker Compose strategy works for local/staging
- [ ] Cloud Run strategy works for cloud deployments
- [ ] --all flag deploys all active services
- [ ] Legacy deployment commands removed
- [ ] 90% test coverage
- [ ] All documentation updated

### Should Have (P1)
- [ ] --dry-run flag works for all strategies
- [ ] --concurrency flag respected
- [ ] Progress indicators for multi-service deploys
- [ ] Clear error messages with remediation steps

### Nice to Have (P2)
- [ ] Deployment duration metrics
- [ ] Post-deployment health checks
- [ ] Rollback on failure
- [ ] Colored terminal output

---

## Next Steps After Sprint 372

### Sprint 373: Polish & Adoption
1. Monitor production usage
2. Update CI/CD pipelines
3. Create video walkthrough
4. Gather user feedback
5. Fix edge cases

### Sprint 374: Deprecation Cleanup
1. Remove deprecated commands
2. Update all examples and docs
3. Announce removal in release notes

### Future Enhancements
1. Kubernetes strategy implementation
2. AWS ECS strategy implementation
3. Multi-region deployments
4. Blue/green deployment support
5. Deployment hooks (pre/post scripts)

---

**End of Execution Plan**

Generated: 2026-07-28
Sprint: 372
Document Version: 1.1 (Updated: No backward compatibility - clean removal of legacy commands)
