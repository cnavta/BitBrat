# Sprint 362: Execution Plan - Deploy & Infrastructure Command Migration
## Deployment, Terraform, and Load Balancer Commands

**Sprint**: 362
**Lead Implementor**: AI Agent (Sprint Protocol v3)
**Duration**: 1 sprint (~2-4 days)
**Start Date**: 2026-07-25
**Target Completion**: 2026-07-29

---

## Executive Summary

Sprint 362 continues the oclif migration by focusing on **Deploy & Infrastructure commands** - the critical commands for production deployment workflows. This sprint migrates **7 commands** organized into three families:

1. **Deploy Commands** (3 commands) - Cloud service deployment orchestration
2. **Infrastructure Commands** (2 commands) - Terraform infrastructure management
3. **Load Balancer Commands** (2 commands) - URL map rendering and import

**Key Insight**: This sprint is predominantly **Pattern 1 (Simple Delegation)** - most business logic is already well-separated in modular files:
- ✅ `providers/gcp/cloudbuild.ts` - Cloud Build submission logic
- ✅ `providers/terraform.ts` - Terraform plan/apply wrappers
- ✅ `lb/urlmap/renderer.ts` - URL map rendering
- ✅ `lb/importer/importer.ts` - URL map import

**Success Criteria**: All 7 commands migrated, tests passing, zero regressions, consistent patterns with Sprint 360/361.

**Foundation**: Sprints 360-361 successfully established:
- ✅ BratCommand base class with full context integration
- ✅ FleetCommand base class for MCP-based operations
- ✅ 26 commands migrated across 5 families
- ✅ Business logic extraction patterns validated
- ✅ Comprehensive testing framework (342 tests passing)

---

## Sprint Objectives

### Primary Objectives (P0 - Must Complete)

| ID | Objective | Success Metric | Acceptance Criteria |
|----|-----------|----------------|---------------------|
| OBJ-1 | Deploy family complete | 3/3 deploy commands migrated | All deploy commands pass tests |
| OBJ-2 | Infra family complete | 2/2 infra commands migrated | Terraform plan/apply commands work |
| OBJ-3 | LB family complete | 2/2 lb commands migrated | URL map render/import commands work |
| OBJ-4 | Zero regressions | All existing tests pass | npm test shows 100% pass rate (342+ tests) |
| OBJ-5 | Help text polished | All commands have examples | Every command has --help with usage examples |

### Secondary Objectives (P1 - Should Complete)

| ID | Objective | Success Metric | Acceptance Criteria |
|----|-----------|----------------|---------------------|
| OBJ-6 | Test coverage maintained | ≥80% on new code | Jest coverage report shows adequate coverage |
| OBJ-7 | Performance validated | No regression vs Sprint 361 | Startup time < 200ms, help < 50ms |
| OBJ-8 | Documentation updated | Migration patterns documented | Sprint completion report created |

---

## Command Inventory & Migration Status

### Completed (26 commands - Sprints 360-361)
- [x] Context family (8 commands) - Sprint 360
- [x] Fleet family (7 commands) - Sprint 360
- [x] Backup family (3 commands) - Sprint 361
- [x] PostgreSQL family (2 commands) - Sprint 361
- [x] Database family (4 commands) - Sprint 361
- [x] Platform commands (2 commands) - Sprints 360-361 (config validate, release)

### Sprint 362: Target (7 commands)

#### Deploy Family (3 commands) - Priority 1
- [ ] `deploy services --all` - Deploy all active services
- [ ] `deploy service <name>` - Deploy single service
- [ ] `deploy <name>` - Deploy service (shorthand alias)

**Rationale**: Deployment commands are the highest-value production workflow automation. Critical for CI/CD pipelines and manual releases.

**Business Logic Status**: ✅ **Already separated**
- `providers/gcp/cloudbuild.ts` - Cloud Build submission with polling and quota handling
- `cli/index.ts:selectDeployableServices()` - Service selection logic (exported function)
- `cli/index.ts:computeDeploySubstitutions()` - Substitutions computation (exported function)

**Pattern**: Pattern 1 (Simple Delegation) - Commands delegate to existing modules

#### Infrastructure Family (2 commands) - Priority 2
- [ ] `infra plan [<module>]` - Terraform plan (network, load-balancer, connectors)
- [ ] `infra apply [<module>]` - Terraform apply with CI guards

**Rationale**: Infrastructure commands manage cloud resources (VPC, load balancers, connectors). Essential for environment provisioning.

**Business Logic Status**: ✅ **Already separated**
- `providers/terraform.ts` - `terraformPlan()`, `terraformApply()`, `terraformPlanGeneric()`, `terraformApplyGeneric()`
- `providers/cdktf-synth.ts` - `synthModule()` for CDKTF synthesis

**Pattern**: Pattern 1 (Simple Delegation) - Commands delegate to existing modules

#### Load Balancer Family (2 commands) - Priority 3
- [ ] `lb urlmap render` - Generate load balancer URL map YAML
- [ ] `lb urlmap import` - Import URL map to GCP

**Rationale**: Load balancer commands manage routing configuration. Used in deployment automation and infrastructure updates.

**Business Logic Status**: ✅ **Already separated**
- `lb/urlmap/renderer.ts` - `loadRendererInputFromArchitecture()`, `renderUrlMapYaml()`, `renderAndWrite()`
- `lb/importer/importer.ts` - `describeUrlMap()`, `importUrlMap()` with drift detection

**Pattern**: Pattern 1 (Simple Delegation) - Commands delegate to existing modules

---

## Phase Breakdown

### Phase 0: Planning & Analysis (1-2 hours) ✅ COMPLETE

**Objective**: Analyze command complexity, confirm business logic separation, create detailed backlog

**Tasks**:
1. ✅ Read all source implementations for 7 commands (cli/index.ts)
2. ✅ Verify business logic is already separated:
   - ✅ Cloud Build: `providers/gcp/cloudbuild.ts`
   - ✅ Terraform: `providers/terraform.ts`
   - ✅ URL map: `lb/urlmap/renderer.ts`, `lb/importer/importer.ts`
3. ✅ Confirm Pattern 1 (Simple Delegation) for all 7 commands
4. ✅ Review Sprint 360-361 lessons learned

**Deliverables**:
- ✅ `implementation-plan.md` - This document
- [ ] `backlog.yaml` - Prioritized task list with time estimates
- [ ] `shared-logic-analysis.md` - Business logic status verification

**Dependencies**: Sprint 361 complete (342 tests passing)

**Validation**:
```bash
# All Sprint 360-361 commands still work
npm run brat -- context list
npm run brat -- fleet list
npm run brat -- backup list
npm run brat -- seed --help

# Build succeeds
npm run build

# Tests pass
npm test
```

---

### Phase 1: Deploy Commands (4-6 hours)

**Objective**: Migrate all 3 deployment commands

#### 1.1: deploy services --all (2 hours)

**Current**: `cli/index.ts` - `cmdDeployServices(flags)`

**Target**: `src/oclif-commands/deploy/services.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Delegates to:
- `selectDeployableServices()` (already exported from cli/index.ts)
- `computeDeploySubstitutions()` (already exported from cli/index.ts)
- `submitBuild()` from providers/gcp/cloudbuild.ts
- `Queue` from orchestration/queue.ts

**Flags**:
- `--context <name>` - Execution context (inherited from BratCommand.baseFlags)
- `--project-id <id>` - GCP project ID (default: from architecture.yaml)
- `--region <r>` - GCP region (default: from service config)
- `--dry-run` - Preview without deploying
- `--concurrency N` - Max concurrent deployments (default: 1)
- `--allow-no-vpc` - Skip VPC preflight (default: auto in dev/staging)
- `--image-tag <t>` - Docker image tag (default: git-derived)
- `--repo <name>` - Artifact Registry repo (default: bitbrat-services)

**Acceptance Criteria**:
- ✅ `brat deploy services --all --context staging` deploys all active services
- ✅ `brat deploy services --all --dry-run` shows what would be deployed
- ✅ `brat deploy services --all --concurrency 3` deploys 3 services in parallel
- ✅ Inactive services (active:false) are skipped with log message
- ✅ VPC preflight runs unless --allow-no-vpc or dev/staging env
- ✅ Progress tracking shows per-service build status
- ✅ Handles Cloud Build failures gracefully

**Validation**:
```bash
./bin/run deploy services --all --dry-run --context staging
./bin/run deploy services --all --context local --dry-run --concurrency 2
```

#### 1.2: deploy service <name> (1.5 hours)

**Current**: `cli/index.ts` - `cmdDeployServices(flags, serviceName)`

**Target**: `src/oclif-commands/deploy/service.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Same logic as deploy services --all, but with single service target

**Args**:
- `<name>` - Service name (required)

**Flags**: Same as `deploy services --all`

**Acceptance Criteria**:
- ✅ `brat deploy service api-gateway --context staging` deploys single service
- ✅ `brat deploy service nonexistent` fails with ConfigurationError
- ✅ `brat deploy service inactive-service` fails if service has active:false
- ✅ Progress tracking shows build steps

**Validation**:
```bash
./bin/run deploy service api-gateway --dry-run --context staging
./bin/run deploy service llm-bot --dry-run
```

#### 1.3: deploy <name> (1 hour)

**Current**: `cli/index.ts` - Alias pattern (deploy <name> → deploy service <name>)

**Target**: `src/oclif-commands/deploy/index.ts` OR implement as default command

**Pattern**: Pattern 1 (Alias) - Redirect to deploy service command

**Note**: oclif supports default commands and aliases. Options:
1. Make `deploy/service.ts` the default command for `deploy` topic
2. Create `deploy/index.ts` that delegates to service.ts

**Acceptance Criteria**:
- ✅ `brat deploy api-gateway` works identically to `brat deploy service api-gateway`
- ✅ Flags work correctly

**Validation**:
```bash
./bin/run deploy api-gateway --dry-run --context staging
```

---

### Phase 2: Infrastructure Commands (3-4 hours)

**Objective**: Migrate terraform infrastructure management commands

#### 2.1: infra plan [<module>] (1.5 hours)

**Current**: `cli/index.ts` - `infra plan` handler with module selection

**Target**: `src/oclif-commands/infra/plan.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Delegates to:
- `synthModule()` from providers/cdktf-synth.ts
- `terraformPlanGeneric()` from providers/terraform.ts
- Load balancer preflight checks (for lb module)

**Args**:
- `[module]` - Infrastructure module (network, load-balancer, connectors) (optional)

**Flags**:
- `--context <name>` - Execution context (inherited)
- `--project-id <id>` - GCP project ID
- `--region <r>` - GCP region
- `--module <m>` - Module name (alternative to positional arg)
- `--dry-run` - Always true for plan

**Acceptance Criteria**:
- ✅ `brat infra plan network --context staging` runs terraform plan for network module
- ✅ `brat infra plan load-balancer` runs plan for LB module with IP/cert preflight
- ✅ `brat infra plan` without module uses legacy fallback (env dir)
- ✅ Module aliases work: `lb` → `load-balancer`
- ✅ CDKTF synthesis runs before terraform plan
- ✅ Workspace selection by environment name

**Validation**:
```bash
./bin/run infra plan network --context staging --dry-run
./bin/run infra plan lb --context dev
```

#### 2.2: infra apply [<module>] (2 hours)

**Current**: `cli/index.ts` - `infra apply` handler with CI guards

**Target**: `src/oclif-commands/infra/apply.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Delegates to:
- `synthModule()` from providers/cdktf-synth.ts
- `terraformApplyGeneric()` from providers/terraform.ts
- Post-apply hooks (URL map render/import for LB module in non-prod)

**Args**:
- `[module]` - Infrastructure module (network, load-balancer, connectors) (optional)

**Flags**: Same as `infra plan`

**Acceptance Criteria**:
- ✅ `brat infra apply network --context staging` runs terraform apply
- ✅ CI guard: Fails if CI=true or --dry-run (apply blocked in CI)
- ✅ Load balancer post-apply hook: render + import URL map in dev/staging
- ✅ Production guard: URL map import disabled in prod (plan-only)
- ✅ Terraform outputs captured to outputs.json
- ✅ Workspace selection by environment name

**Validation**:
```bash
# These should fail with CI guard
CI=true ./bin/run infra apply network --context staging

# Dry-run mode
./bin/run infra apply lb --context dev --dry-run
```

---

### Phase 3: Load Balancer Commands (2-3 hours)

**Objective**: Migrate load balancer URL map management commands

#### 3.1: lb urlmap render (1 hour)

**Current**: `cli/index.ts` - `lb urlmap render` handler

**Target**: `src/oclif-commands/lb/urlmap/render.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Delegates to:
- `renderAndWrite()` from lb/urlmap/renderer.ts

**Flags**:
- `--context <name>` - Execution context (inherited)
- `--project-id <id>` - GCP project ID
- `--out <path>` - Output file path (optional)
- `--json` - JSON output format

**Acceptance Criteria**:
- ✅ `brat lb urlmap render --context staging` generates URL map YAML
- ✅ `brat lb urlmap render --out custom.yaml` uses custom output path
- ✅ Default output: `infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml`
- ✅ Reads routing rules from architecture.yaml
- ✅ Generates backend service links (be-<service>, be-assets-proxy)
- ✅ Handles bucket rules with urlRewrite

**Validation**:
```bash
./bin/run lb urlmap render --context dev --json
./bin/run lb urlmap render --out /tmp/test-urlmap.yaml
```

#### 3.2: lb urlmap import (1.5 hours)

**Current**: `cli/index.ts` - `lb urlmap import` handler

**Target**: `src/oclif-commands/lb/urlmap/import.ts`

**Pattern**: Pattern 1 (Simple Delegation) - Delegates to:
- `importUrlMap()` from lb/importer/importer.ts
- `describeUrlMap()` for drift detection

**Flags**:
- `--context <name>` - Execution context (inherited)
- `--project-id <id>` - GCP project ID
- `--dry-run` - Preview without importing

**Acceptance Criteria**:
- ✅ `brat lb urlmap import --context staging` imports URL map if drift detected
- ✅ `brat lb urlmap import --dry-run` shows drift without importing
- ✅ Production guard: Import disabled in prod (drift detection only)
- ✅ Backend preflight: Verifies all referenced backend services exist
- ✅ Parity check: Verifies import succeeded
- ✅ No-op if no drift detected

**Validation**:
```bash
./bin/run lb urlmap import --dry-run --context staging
./bin/run lb urlmap import --context dev --dry-run
```

---

## Phase 4: Testing & Validation (2-3 hours)

**Objective**: Comprehensive test suite and regression validation

### 4.1: Unit Tests (1 hour)

**Smoke Tests** (1 test file per command, 7 total):

Standard smoke test pattern from Sprint 360-361:
- Command extends BratCommand
- Description exists
- Examples exist
- Flags defined
- Args defined (where applicable)
- baseFlags inherited
- oclif can instantiate

**Files**:
- `src/oclif-commands/deploy/services.test.ts`
- `src/oclif-commands/deploy/service.test.ts`
- `src/oclif-commands/deploy/index.test.ts`
- `src/oclif-commands/infra/plan.test.ts`
- `src/oclif-commands/infra/apply.test.ts`
- `src/oclif-commands/lb/urlmap/render.test.ts`
- `src/oclif-commands/lb/urlmap/import.test.ts`

**Expected**: ~49 smoke tests (7 commands × 7 checks per command)

### 4.2: Integration Tests (1 hour)

**Focus**: Verify delegation to business logic modules

Test strategy:
- Mock `submitBuild()`, `terraformPlanGeneric()`, `renderAndWrite()`, etc.
- Verify correct arguments passed to business logic
- Verify error handling
- Verify dry-run mode
- Verify context resolution

**Defer comprehensive tests**: Business logic modules already have comprehensive tests

### 4.3: Regression Validation (1 hour)

**Checklist**:
```bash
# All Sprint 360-361 tests still pass
npm test

# Build succeeds
npm run build

# Help text works
./bin/run --help
./bin/run deploy --help
./bin/run infra --help
./bin/run lb --help

# Commands instantiate
./bin/run deploy services --help
./bin/run deploy service api-gateway --help
./bin/run infra plan network --help
./bin/run lb urlmap render --help
```

**Acceptance Criteria**:
- ✅ All 342+ tests passing (Sprint 360-361 + Sprint 362)
- ✅ Zero TypeScript errors
- ✅ Zero runtime errors during help invocation
- ✅ All examples in help text are syntactically correct

---

## Phase 5: Documentation & Completion (1-2 hours)

**Objective**: Sprint artifacts and knowledge capture

### 5.1: Sprint Artifacts

**Completion Summary** (`completion-summary.md`):
- Executive summary
- Deliverables completed (7 commands, tests, metrics)
- Test results (total tests passing)
- Code metrics (lines added, patterns used)
- Quality metrics (coverage, TypeScript errors)
- Technical achievements
- Files created
- Sprint timeline
- Success criteria verification
- Lessons learned
- Next steps

**Validation Script** (`validate_deliverable.sh`):
```bash
#!/bin/bash
set -e

echo "=== Sprint 362 Validation ==="

echo "1. Build"
npm run build

echo "2. Tests"
npm test

echo "3. Deploy commands"
./bin/run deploy services --help
./bin/run deploy service api-gateway --help
./bin/run deploy api-gateway --help

echo "4. Infra commands"
./bin/run infra plan --help
./bin/run infra apply --help

echo "5. LB commands"
./bin/run lb urlmap render --help
./bin/run lb urlmap import --help

echo "✅ All validations passed"
```

### 5.2: Updated Migration Status

Update `remaining-commands.md`:
- Mark Sprint 362 complete (7 commands)
- Update progress: 33/48 commands (69%)
- Remaining: 15 commands across 3 priority groups
- Next sprint: Sprint 363 (Development Tools)

---

## Dependencies & Risks

### Dependencies

| Dependency | Status | Impact if Blocked | Mitigation |
|------------|--------|-------------------|------------|
| Sprint 361 complete | ✅ Complete | HIGH - Cannot start | N/A - already complete |
| Business logic separation | ✅ Complete | MEDIUM - More work needed | N/A - already separated |
| Context resolution working | ✅ Complete | HIGH - Commands need context | N/A - tested in Sprint 360-361 |

### Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cloud Build API quota limits | LOW | MEDIUM | Already handled in cloudbuild.ts (polling throttle, 429 backoff) |
| Terraform state lock contention | LOW | LOW | Documented in help text, use -lock=false for plan |
| LB backend preflight failures | LOW | MEDIUM | Graceful degradation, skip import if backends missing |
| CI guard blocks local testing | LOW | LOW | Document unset CI, provide --dry-run examples |

---

## Success Metrics

### Quantitative Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Commands migrated | 7/7 (100%) | Count of completed command files |
| Tests passing | 100% | `npm test` exit code 0 |
| Test count | 342 + 49 = 391 | Jest test suite count |
| TypeScript errors | 0 | `npm run build` exit code 0 |
| Code coverage | ≥80% | Jest coverage report |
| Help text completeness | 7/7 with examples | Manual verification |

### Qualitative Metrics

| Metric | Assessment Method |
|--------|-------------------|
| Pattern consistency | All commands follow Pattern 1 |
| Documentation quality | Completion summary is comprehensive |
| Error messages | Clear, actionable error messages |
| User experience | Help text is clear and examples work |

---

## Timeline & Estimates

**Total Estimated Effort**: 12-16 hours (1.5-2 sprint days)

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| Phase 0: Planning | 1-2h | ✅ implementation-plan.md, backlog.yaml, analysis |
| Phase 1: Deploy commands | 4-6h | 3 deploy commands, tests |
| Phase 2: Infra commands | 3-4h | 2 infra commands, tests |
| Phase 3: LB commands | 2-3h | 2 lb commands, tests |
| Phase 4: Testing | 2-3h | Smoke tests, regression validation |
| Phase 5: Documentation | 1-2h | completion-summary.md, validate script |

**Comparison to Sprint 361**:
- Sprint 361: 9 commands, ~8 hours (business logic extraction)
- Sprint 362: 7 commands, 12-16 hours (more complex orchestration)
- Sprint 362 complexity: Higher (deployment orchestration, terraform wrappers, CI guards)

---

## Lessons from Sprint 360-361

### What Worked Well ✅

1. **Business logic first approach**: Saves time when logic is already separated (Sprint 362 benefits from this!)
2. **Pattern consistency**: Simple Delegation pattern is well-established
3. **Smoke tests**: Fast, effective validation without over-testing
4. **BratCommand base class**: Context resolution works flawlessly

### Applied to Sprint 362 ✅

1. **Verify separation first**: ✅ All business logic already separated
2. **Pattern 1 sprint**: All 7 commands use Simple Delegation
3. **Smoke tests only**: Defer comprehensive command tests, rely on business logic tests
4. **Use this.context**: No need to resolve context manually

### New Patterns for Sprint 362

1. **Dangerous operation pattern**: `infra apply` has CI guards (new safety pattern)
2. **Post-operation hooks**: LB module has post-apply URL map render/import
3. **Alias commands**: `deploy <name>` as shorthand for `deploy service <name>`
4. **Module selection**: Positional vs flag-based module selection for infra commands

---

## Next Steps After Sprint 362

### Sprint 363: Development Tools (Recommended)

**Scope**: 5 commands (6-8 hours)
- `docker up [--service <s>]`
- `docker down [--service <s>]`
- `docker logs [--service <s>]`
- `docker ps [--service <s>]`
- `chat`

**Rationale**: Low complexity (mostly delegation to existing docker module)

### Sprint 364: Cloud/Platform Tools

**Scope**: 6 commands (8-10 hours)
- `cloud-run shutdown`
- `trigger create/update/delete`
- `apis enable`
- `bit create`

### Sprint 365: MCP/Agent Tools

**Scope**: 3 commands (4-6 hours)
- `code [--agent <a>]`
- `mcp setup`
- `dev-mcp` (internal)

---

## Appendix: Business Logic Module Reference

### Already Separated ✅

| Module | Functions | Tests | Status |
|--------|-----------|-------|--------|
| `providers/gcp/cloudbuild.ts` | `submitBuild()`, `extractBuildIdFromGcloudOutput()` | Unit tests | ✅ Production-ready |
| `providers/terraform.ts` | `terraformPlan()`, `terraformApply()`, `terraformPlanGeneric()`, `terraformApplyGeneric()` | Unit tests | ✅ Production-ready |
| `lb/urlmap/renderer.ts` | `loadRendererInputFromArchitecture()`, `renderUrlMapYaml()`, `renderAndWrite()` | 12 tests | ✅ Production-ready |
| `lb/importer/importer.ts` | `describeUrlMap()`, `importUrlMap()`, `diffObjects()` | 8 tests | ✅ Production-ready |
| `providers/cdktf-synth.ts` | `synthModule()` | Manual tests | ✅ Production-ready |
| `orchestration/queue.ts` | `Queue` class for concurrency | Unit tests | ✅ Production-ready |

### Exported Helper Functions (cli/index.ts)

| Function | Purpose | Lines | Status |
|----------|---------|-------|--------|
| `selectDeployableServices()` | Service selection with active filter | 24 | ✅ Exported, tested |
| `computeDeploySubstitutions()` | Cloud Build substitutions computation | 28 | ✅ Exported, tested |

**No business logic extraction needed** - all logic already modular!

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: 🔵 PLANNING PHASE COMPLETE - READY FOR USER APPROVAL

