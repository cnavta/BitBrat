# Sprint 351: Bootstrap Automation & Bug Remediation

**Sprint ID**: 351
**Parent Sprint**: 350 (agent-dev Context Bootstrap)
**Branch**: `feature/sprint-351-bootstrap-automation`
**Status**: PLANNING
**Priority**: HIGH
**Estimated Duration**: 2-3 days

---

## Executive Summary

Sprint 350 successfully bootstrapped the agent-dev context but uncovered 3 critical bugs and identified multiple manual processes that should be automated. This sprint focuses on remediating those bugs and automating the bootstrap process to ensure future context creation is smooth and reliable.

---

## Sprint Objectives

### Primary Objectives
1. **Fix Critical Bugs** - Remediate 3 bugs discovered in Sprint 350
2. **Automate NATS Stream Initialization** - Create idempotent stream initialization script
3. **Improve brat context create** - Auto-populate BUS_PREFIX and validate configuration
4. **Audit Service Compose Files** - Remove all GOOGLE_APPLICATION_CREDENTIALS references

### Secondary Objectives
5. **Create Bootstrap Validation** - Validate context configuration before deployment
6. **Improve Error Messages** - Provide actionable guidance in error messages
7. **Document Service Requirements** - Create configuration requirements matrix

---

## Sprint 350 Findings Analysis

### Critical Bugs (Must Fix)

#### Bug 1: GOOGLE_APPLICATION_CREDENTIALS Still Required
**Severity**: HIGH - Blocks all new context creation
**Impact**: api-gateway and event-router fail to start
**Root Cause**: Compose files not updated after PostgreSQL migration
**Files Known Affected**: api-gateway.compose.yaml, event-router.compose.yaml
**Files Potentially Affected**: 16 other service compose files

**Remediation Strategy**:
1. Audit ALL service compose files for GOOGLE_APPLICATION_CREDENTIALS
2. Remove environment variable and volume mount from affected files
3. Add postgres to depends_on where needed
4. Create automated CI check to prevent regression

#### Bug 2: BUS_PREFIX Not Auto-Populated
**Severity**: MEDIUM - Blocks event-router startup
**Impact**: event-router fails with missing env var error
**Root Cause**: `brat context create` doesn't populate BUS_PREFIX in global.yaml
**Pattern**: BUS_PREFIX should be `{context-name}.`

**Remediation Strategy**:
1. Update context create logic to auto-generate BUS_PREFIX
2. Add validation to ensure BUS_PREFIX matches context name
3. Update existing contexts to include BUS_PREFIX if missing

#### Bug 3: DATABASE_URL Password Initialization Order
**Severity**: LOW - Confusing but documented
**Impact**: Delayed tool-gateway startup, requires manual fix
**Root Cause**: PostgreSQL password persists from first initialization
**Workaround**: Document in bootstrap checklist

**Remediation Strategy**:
1. Document proper bootstrap order in `brat context create` help text
2. Add validation check for .env.brat existence before docker compose up
3. Provide clear error message if .env.brat missing during postgres init

### Automation Opportunities (Should Automate)

#### Automation 1: NATS Stream Initialization
**Current State**: Manual creation via nats-box container
**Desired State**: Automatic creation on NATS startup or via init script
**Streams Required**: 8 standard streams (internal-mcp, internal-ingress, internal-egress, etc.)

**Implementation Strategy**:
1. Create initialization script (tools/init-nats-streams.sh or TypeScript)
2. Make it idempotent (check existing streams, create missing)
3. Run automatically after NATS starts (compose depends_on + healthcheck)
4. Or: Add to `brat docker up` workflow

#### Automation 2: .env.brat Generation
**Current State**: Manual creation and copying to subdirectories
**Desired State**: Automatic generation after context create
**Locations**: Root, infrastructure/docker-compose, infrastructure/docker-compose/services

**Implementation Strategy**:
1. Add env file generation to `brat context create`
2. Automatically merge YAML configs + .secure.* files
3. Copy to all required subdirectories
4. Validate all required variables present

#### Automation 3: Bootstrap Validation
**Current State**: No validation before deployment
**Desired State**: Validate configuration completeness before starting services

**Validation Checks**:
- .secure.{context} file exists
- .env.brat exists and is populated
- .env.brat copied to subdirectories
- BUS_PREFIX matches context name
- Required secrets present (POSTGRES_PASSWORD, MCP_AUTH_TOKEN, etc.)
- DATABASE_URL format valid

**Implementation Strategy**:
1. Create `brat context validate {context}` command
2. Run validation automatically before `brat docker up`
3. Provide actionable error messages for each failure

---

## Execution Plan

### Phase 1: Critical Bug Fixes (Day 1, 4-6 hours)

**Objective**: Fix bugs that block context creation

#### Task 1.1: Audit and Fix GOOGLE_APPLICATION_CREDENTIALS
**Priority**: P0 (Critical)
**Estimate**: 2-3 hours
**Deliverables**:
- Audit report of all service compose files
- Fixed compose files (remove GOOGLE_APPLICATION_CREDENTIALS)
- Add postgres to depends_on where needed
- Validation script to detect future occurrences

**Acceptance Criteria**:
- All service compose files scanned
- GOOGLE_APPLICATION_CREDENTIALS removed from all files
- Services still start successfully without credentials
- CI check prevents regression

#### Task 1.2: Auto-Populate BUS_PREFIX in brat context create
**Priority**: P0 (Critical)
**Estimate**: 1-2 hours
**Deliverables**:
- Updated context create logic
- BUS_PREFIX auto-populated as `{context-name}.`
- Validation that BUS_PREFIX matches context name
- Tests for context creation

**Acceptance Criteria**:
- `brat context create test-context` creates BUS_PREFIX: "test-context."
- Validation fails if BUS_PREFIX doesn't match context name
- Existing contexts can be updated with correct BUS_PREFIX

#### Task 1.3: Document DATABASE_URL Password Order
**Priority**: P2 (Low)
**Estimate**: 30 minutes
**Deliverables**:
- Updated help text for `brat context create`
- Bootstrap checklist in documentation
- Error message improvement for missing .env.brat

**Acceptance Criteria**:
- Help text mentions .env.brat must exist before postgres init
- Error message guides user to create .env.brat first
- Documentation updated with proper bootstrap order

### Phase 2: NATS Stream Automation (Day 1-2, 3-4 hours)

**Objective**: Automate NATS stream initialization

#### Task 2.1: Create NATS Stream Initialization Script
**Priority**: P0 (Critical)
**Estimate**: 2-3 hours
**Deliverables**:
- Script to create all standard NATS streams
- Idempotent (detects existing streams)
- TypeScript or Bash implementation
- Configurable stream list (YAML or JSON)

**Acceptance Criteria**:
- Script creates 8 standard streams
- Running script multiple times is safe (idempotent)
- Script logs what it creates/skips
- Streams configuration matches Sprint 350 spec

**Standard Streams**:
```yaml
streams:
  - name: internal-mcp
    subjects: ["internal.mcp.>"]
  - name: internal-ingress
    subjects: ["internal.ingress.>"]
  - name: internal-egress
    subjects: ["internal.egress.>"]
  - name: internal-contextualization
    subjects: ["internal.contextualization.>"]
  - name: internal-analysis
    subjects: ["internal.analysis.>"]
  - name: internal-reaction
    subjects: ["internal.reaction.>"]
  - name: internal-api
    subjects: ["internal.api.>"]
```

#### Task 2.2: Integrate Stream Init into brat docker up
**Priority**: P1 (High)
**Estimate**: 1 hour
**Deliverables**:
- Add stream initialization to docker up workflow
- Run after NATS healthcheck passes
- Log output visible to user

**Acceptance Criteria**:
- `brat docker up --context agent-dev` automatically creates streams
- User sees confirmation of stream creation
- Streams created before services start
- Works for all contexts (local, staging, etc.)

### Phase 3: Bootstrap Validation (Day 2, 2-3 hours)

**Objective**: Validate context configuration before deployment

#### Task 3.1: Create brat context validate Command
**Priority**: P1 (High)
**Estimate**: 2 hours
**Deliverables**:
- New `brat context validate {context}` command
- Validation checks for configuration completeness
- Actionable error messages for each failure
- JSON output option for CI

**Validation Checks**:
- `.secure.{context}` file exists
- `.env.brat` exists and is populated
- `.env.brat` copied to all subdirectories
- `BUS_PREFIX` matches context name
- Required secrets present
- `DATABASE_URL` format valid
- YAML files valid

**Acceptance Criteria**:
- Command validates all checks
- Clear error messages guide user to fix issues
- Returns exit code 0 on success, non-zero on failure
- JSON output available for automation

#### Task 3.2: Auto-Validate Before docker up
**Priority**: P1 (High)
**Estimate**: 30 minutes
**Deliverables**:
- Add validation to `brat docker up` workflow
- Fail fast if validation fails
- Option to skip validation (--no-validate)

**Acceptance Criteria**:
- `brat docker up` runs validation first
- Fails with clear error if validation fails
- `--no-validate` flag skips validation

### Phase 4: .env.brat Automation (Day 2-3, 2-3 hours)

**Objective**: Automate .env.brat generation and distribution

#### Task 4.1: Auto-Generate .env.brat in brat context create
**Priority**: P1 (High)
**Estimate**: 1.5 hours
**Deliverables**:
- Add env file generation to `brat context create`
- Merge YAML configs + .secure.* files automatically
- Copy to all subdirectories

**Acceptance Criteria**:
- `brat context create test` generates .env.brat automatically
- .env.brat contains all merged variables
- .env.brat copied to root, docker-compose, services directories
- Validates all required variables present

#### Task 4.2: Create brat context refresh Command
**Priority**: P2 (Medium)
**Estimate**: 1 hour
**Deliverables**:
- New command to regenerate .env.brat from current configs
- Useful after updating YAML files or secrets
- Validates and copies to subdirectories

**Acceptance Criteria**:
- `brat context refresh agent-dev` regenerates .env.brat
- Picks up changes from YAML files and .secure.*
- Re-copies to all subdirectories
- Validates completeness

### Phase 5: Documentation & Testing (Day 3, 2-3 hours)

**Objective**: Document improvements and validate end-to-end

#### Task 5.1: Update Bootstrap Documentation
**Priority**: P1 (High)
**Estimate**: 1 hour
**Deliverables**:
- Updated bootstrap guide reflecting new automation
- Service configuration requirements matrix
- Troubleshooting guide with new error messages

**Acceptance Criteria**:
- Documentation reflects new `brat context create` behavior
- Clear guide for creating new contexts from scratch
- Troubleshooting covers common errors

#### Task 5.2: End-to-End Bootstrap Test
**Priority**: P0 (Critical)
**Estimate**: 1-2 hours
**Deliverables**:
- Create new test context from scratch using new tools
- Validate all automation works correctly
- Document any issues found
- Clean up test context after validation

**Acceptance Criteria**:
- Can create new context with minimal manual steps
- All streams auto-created
- All services start without errors
- Validation catches configuration issues

#### Task 5.3: Create Automated Tests
**Priority**: P2 (Medium)
**Estimate**: 1 hour
**Deliverables**:
- Unit tests for context create logic
- Integration tests for stream initialization
- Validation tests for context validate command

**Acceptance Criteria**:
- Tests cover critical paths
- Tests run in CI
- Tests prevent regression

---

## Success Criteria

### Must Have (Sprint Cannot Complete Without These)
- [ ] All GOOGLE_APPLICATION_CREDENTIALS references removed from service compose files
- [ ] BUS_PREFIX auto-populated in `brat context create`
- [ ] NATS stream initialization automated
- [ ] Bootstrap validation command (`brat context validate`) working
- [ ] End-to-end bootstrap test passes with new context

### Should Have (High Value, Complete If Time Allows)
- [ ] Auto-generate .env.brat in `brat context create`
- [ ] Auto-validate before `brat docker up`
- [ ] Documentation updated with new automation
- [ ] Service configuration requirements matrix created

### Nice to Have (Lower Priority, Defer If Needed)
- [ ] `brat context refresh` command for regenerating .env.brat
- [ ] Automated tests for new functionality
- [ ] CI check for GOOGLE_APPLICATION_CREDENTIALS
- [ ] Improved error messages for common failures

---

## Risk Assessment

### High Risk
1. **Breaking Existing Contexts** - Changes to context create might break local/staging/prod
   - **Mitigation**: Test on agent-dev first, validate existing contexts still work
   - **Fallback**: Keep old behavior available via flag

2. **NATS Stream Init Timing** - Streams might not exist when services start
   - **Mitigation**: Add retries to service NATS connections
   - **Fallback**: Document manual stream creation as workaround

### Medium Risk
3. **Incomplete Service Audit** - Might miss some services with GOOGLE_APPLICATION_CREDENTIALS
   - **Mitigation**: Automated grep/scan of all compose files
   - **Validation**: Try starting all services after changes

4. **Validation Too Strict** - Validation might fail for valid edge cases
   - **Mitigation**: Make validation warnings vs errors configurable
   - **Fallback**: Allow --no-validate flag

### Low Risk
5. **Documentation Out of Date** - Documentation might not match implementation
   - **Mitigation**: Update docs alongside code changes
   - **Validation**: Test procedures in docs during end-to-end test

---

## Dependencies

### Prerequisites
- Sprint 350 completion (DONE ✅)
- Access to all service compose files
- Understanding of NATS JetStream API
- brat CLI codebase familiarity

### Blocked By
- None

### Blocks
- Future context creation (agent-dev-2, test contexts, etc.)
- Production deployment of new contexts

---

## Timeline

### Day 1 (4-6 hours)
- **Morning**: Phase 1 - Critical bug fixes (GOOGLE_APPLICATION_CREDENTIALS, BUS_PREFIX)
- **Afternoon**: Phase 2 - NATS stream automation (init script)

### Day 2 (4-6 hours)
- **Morning**: Phase 2 complete (integrate into docker up), Phase 3 (validation command)
- **Afternoon**: Phase 4 - .env.brat automation

### Day 3 (2-4 hours)
- **Morning**: Phase 5 - Documentation and end-to-end testing
- **Afternoon**: Polish, bug fixes, sprint completion

**Total Estimated Effort**: 10-16 hours across 3 days

---

## Deliverables

### Code Changes
1. `tools/brat/src/cli/context.ts` - Updated context create with BUS_PREFIX and validation
2. `tools/init-nats-streams.ts` (new) - NATS stream initialization script
3. `tools/brat/src/cli/docker.ts` - Integration of stream init and validation
4. `tools/brat/src/cli/validate.ts` (new) - Context validation command
5. `infrastructure/docker-compose/services/*.compose.yaml` - Removed GOOGLE_APPLICATION_CREDENTIALS

### Documentation
1. `planning/sprint-351-bootstrap-automation/execution-plan.md` - This document
2. `planning/sprint-351-bootstrap-automation/backlog.yaml` - Prioritized task backlog
3. `planning/sprint-351-bootstrap-automation/service-audit-report.md` - Audit findings
4. `documentation/guides/bootstrap-new-context.md` - Updated bootstrap guide
5. `documentation/reference/service-config-requirements.md` (new) - Config matrix

### Tests
1. `tools/brat/src/cli/__tests__/context.test.ts` - Context create tests
2. `tools/__tests__/init-nats-streams.test.ts` - Stream init tests
3. `tools/brat/src/cli/__tests__/validate.test.ts` - Validation tests

---

## Next Steps After Sprint 351

1. **Sprint 352**: Multi-context isolation testing (run local + agent-dev simultaneously)
2. **Sprint 353**: Production context bootstrap (create prod context with new tools)
3. **Sprint 354**: Enhanced fleet management (improve brat fleet commands for host networking)
4. **Sprint 355**: Service configuration automation (auto-detect required env vars from source)

---

## Appendix: Sprint 350 Recommendations Mapping

| Recommendation from Sprint 350 | Sprint 351 Task | Priority |
|-------------------------------|-----------------|----------|
| Automate NATS stream initialization | Task 2.1, 2.2 | P0 |
| Fix brat context create to auto-populate BUS_PREFIX | Task 1.2 | P0 |
| Audit all compose files for GOOGLE_APPLICATION_CREDENTIALS | Task 1.1 | P0 |
| Create bootstrap validation script | Task 3.1, 3.2 | P1 |
| Improve brat fleet list host networking | Deferred to Sprint 354 | - |
| Document service configuration requirements | Task 5.1 | P1 |
| Create context clone command | Deferred to future sprint | - |
| Add context validation command | Task 3.1 | P1 |
| Create bootstrap automation | Partially addressed (Tasks 2.1, 4.1) | P1 |

**Coverage**: 7/10 recommendations addressed in Sprint 351 (70%)
**Deferred**: 3 recommendations to future sprints
