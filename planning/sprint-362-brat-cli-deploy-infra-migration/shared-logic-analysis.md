# Sprint 362: Shared Logic Analysis
## Business Logic Separation Status for Deploy & Infrastructure Commands

**Date**: 2026-07-25
**Sprint**: 362
**Analysis Phase**: Phase 0 (Planning)

---

## Executive Summary

✅ **NO BUSINESS LOGIC EXTRACTION REQUIRED**

All deploy/infra business logic is already well-separated into modular files. This is a **Pattern 1 (Simple Delegation) sprint** where all 7 commands delegate to existing, tested business logic modules.

**Key Finding**: Sprint 362 benefits from excellent historical separation of concerns. Commands will be thin wrappers around existing modules.

---

## Business Logic Modules (Already Separated)

### 1. Cloud Build Submission ✅

**Module**: `tools/brat/src/providers/gcp/cloudbuild.ts`

**Functions**:
- `submitBuild(opts: CloudBuildSubmitOptions): Promise<{ code, stdout, stderr, cmd }>`
- `extractBuildIdFromGcloudOutput(out: string): string | null`
- `escapeSubstitutionValue(val: string): string` (internal)
- `buildSubstitutionsArg(subs: Record<...>): string` (internal)

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: Unit tests in `__tests__/cloudbuild.test.ts`

**Key Features**:
- Async Cloud Build submission (`--async` flag)
- Throttled polling (5s interval, configurable)
- 429 quota handling with exponential backoff + jitter
- Build status monitoring (SUCCESS, FAILURE, TIMEOUT, etc.)
- Max wait time (60 minutes default, configurable)

**Used By**:
- `deploy services --all`
- `deploy service <name>`
- `deploy <name>`

**Command Responsibility**:
- Compute substitutions via `computeDeploySubstitutions()`
- Call `submitBuild()` with options
- Log progress and errors

---

### 2. Terraform Wrappers ✅

**Module**: `tools/brat/src/providers/terraform.ts`

**Functions**:
- `terraformPlan(opts: TerraformOptions): Promise<number>`
- `terraformApply(opts: TerraformOptions): Promise<number>`
- `terraformPlanGeneric(opts: { cwd, envName, projectId, region }): Promise<number>`
- `terraformApplyGeneric(opts: { cwd, envName }): Promise<number>`
- `trySelectWorkspace(cwd: string, envName?: string): Promise<void>` (internal)
- `writeAutoTfvars(tempDir: string, vars: TerraformVars): string` (internal)

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: Manual integration tests

**Key Features**:
- Terraform init, validate, plan, apply orchestration
- Workspace selection by environment name
- Stdout/stderr relay to process output
- Terraform outputs capture to `outputs.json`
- Error handling with exit codes

**Used By**:
- `infra plan [<module>]`
- `infra apply [<module>]`

**Command Responsibility**:
- Module selection (network, load-balancer, connectors)
- CDKTF synthesis via `synthModule()`
- Load balancer preflight checks (IP/cert existence)
- Call terraform functions
- Post-apply hooks (URL map render/import for LB)
- CI guard enforcement (block apply if CI=true)

---

### 3. Load Balancer URL Map Rendering ✅

**Module**: `tools/brat/src/lb/urlmap/renderer.ts`

**Functions**:
- `loadRendererInputFromArchitecture(opts: { rootDir, env, projectId }): RendererInput`
- `renderUrlMapYaml(input: RendererInput): UrlMapYaml`
- `renderAndWrite(opts: RenderOptions): { outFile: string, yaml: UrlMapYaml }`

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: 12 tests in `__tests__/renderer.routing.test.ts`

**Key Features**:
- Reads routing rules from `architecture.yaml` (`infrastructure.resources.main-load-balancer.routing`)
- Maps service rules to `be-<service>` backend services
- Maps bucket rules to `be-assets-proxy` with `urlRewrite`
- Supports canary routing with weighted backends
- Validates canary weights sum to 100
- Default output: `infrastructure/cdktf/lb/url-maps/<env>/url-map.yaml`

**Used By**:
- `lb urlmap render`
- Post-apply hook in `infra apply load-balancer` (non-prod)

**Command Responsibility**:
- Get projectId, env, outFile from flags
- Call `renderAndWrite()`
- Log output file path

---

### 4. Load Balancer URL Map Import ✅

**Module**: `tools/brat/src/lb/importer/importer.ts`

**Functions**:
- `describeUrlMap(projectId: string, urlMapName: string): Promise<any>`
- `importUrlMap(opts: ImportOptions): Promise<{ changed: boolean, message: string }>`
- `desiredYamlToObject(desiredObj: UrlMapYaml): any` (from `./diff`)
- `diffObjects(current: any, desired: any): { changed: boolean }` (from `./diff`)

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: 8 tests in `__tests__/importer.test.ts`

**Key Features**:
- Drift detection: Compare current GCP state vs desired YAML
- Production guard: Import disabled in prod (drift detection only)
- Backend preflight: Verify all referenced backend services exist via `gcloud compute backend-services describe`
- Import via `gcloud compute url-maps import`
- Parity check: Verify import succeeded (desired == actual)

**Used By**:
- `lb urlmap import`
- Post-apply hook in `infra apply load-balancer` (non-prod)

**Command Responsibility**:
- Get projectId, env, urlMapName from flags
- Load sourceYamlPath (default or custom)
- Call `importUrlMap()`
- Log result

---

### 5. CDKTF Module Synthesis ✅

**Module**: `tools/brat/src/providers/cdktf-synth.ts`

**Functions**:
- `synthModule(moduleName: 'network' | 'load-balancer' | 'connectors', opts: { rootDir, env, projectId }): string`

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: Manual integration tests

**Key Features**:
- Synthesizes CDKTF modules to Terraform JSON
- Returns synthesized output directory path
- Used before terraform plan/apply

**Used By**:
- `infra plan [<module>]`
- `infra apply [<module>]`

**Command Responsibility**:
- Module selection
- Call `synthModule()` before terraform commands

---

### 6. Queue (Concurrency Control) ✅

**Module**: `tools/brat/src/orchestration/queue.ts`

**Class**: `Queue`

**Methods**:
- `constructor(concurrency: number)`
- `add<T>(fn: () => Promise<T>): Promise<T>`

**Status**: ✅ Production-ready, fully separated

**Test Coverage**: Unit tests

**Key Features**:
- Limits concurrent async operations
- Used for parallel deployments

**Used By**:
- `deploy services --all` (with `--concurrency N` flag)

**Command Responsibility**:
- Create Queue instance with concurrency limit
- Map services to async tasks
- Call `queue.add(task)` for each service

---

## Exported Helper Functions (cli/index.ts)

These functions are already exported from `cli/index.ts` and can be imported directly:

### 1. selectDeployableServices() ✅

**Signature**:
```typescript
export function selectDeployableServices(
  allServices: ResolvedServiceConfig[],
  targetService?: string
): ResolvedServiceConfig[]
```

**Purpose**: Filter services by `active: true` and optional target service name

**Logic**:
- If `targetService` provided:
  - Find service by name
  - Error if not found
  - Error if inactive (ConfigurationError)
- If `targetService` not provided (--all):
  - Filter services where `active === true`
  - Log skip message for inactive services

**Status**: ✅ Exported, tested in production

**Used By**:
- `deploy services --all`
- `deploy service <name>`

### 2. computeDeploySubstitutions() ✅

**Signature**:
```typescript
export function computeDeploySubstitutions(
  i: DeploySubstitutionsInput
): Record<string, string | number | boolean>
```

**Purpose**: Compute Cloud Build substitutions from service config

**Logic**:
- Maps service config to `_SERVICE_NAME`, `_REGION`, `_PORT`, `_CPU`, `_MEMORY`, etc.
- Handles external images vs build-from-source
- Computes `_ALLOW_UNAUTH` policy (service config + VPC + ingress policy)
- Includes environment variables and secrets

**Status**: ✅ Exported, tested in production

**Used By**:
- `deploy services --all`
- `deploy service <name>`

---

## Command-Specific Logic (Stays in Commands)

The following logic is CLI-specific and should stay in the oclif commands:

### Deploy Commands

**CLI-Specific**:
- Flag parsing (--context, --project-id, --region, --dry-run, --concurrency, etc.)
- Context resolution via `this.context`
- Service config resolution via `resolveConfig(root)`
- VPC preflight orchestration (`assertVpcPreconditions()`)
- Environment variable file writing (`.cloudbuild/env.<service>.kv`)
- Logging and progress tracking
- Error message formatting

**Delegation**:
- Service selection → `selectDeployableServices()`
- Substitutions → `computeDeploySubstitutions()`
- Build submission → `submitBuild()`
- Concurrency → `Queue`

### Infra Commands

**CLI-Specific**:
- Flag/arg parsing (module selection, --context, --dry-run)
- Module aliases (`lb` → `load-balancer`)
- CI guard enforcement (block apply if `CI=true` or `--dry-run`)
- Load balancer preflight (`preflightLbExistingResources()`)
- Post-apply hooks (URL map render/import)
- Production guard (skip import in prod)
- Logging and output formatting

**Delegation**:
- CDKTF synthesis → `synthModule()`
- Terraform plan → `terraformPlanGeneric()`
- Terraform apply → `terraformApplyGeneric()`

### LB Commands

**CLI-Specific**:
- Flag parsing (--context, --project-id, --out, --json)
- Output file path resolution
- URL map name resolution from architecture.yaml
- Source YAML path resolution
- Logging and result formatting

**Delegation**:
- Rendering → `renderAndWrite()`
- Import → `importUrlMap()`

---

## Comparison to Sprint 361

| Aspect | Sprint 361 | Sprint 362 |
|--------|------------|------------|
| **Business logic extraction** | 3 modules (1000 lines) | 0 modules (already separated) |
| **Commands to migrate** | 9 commands | 7 commands |
| **Pattern distribution** | Pattern 1: 4, Pattern 2: 5 | Pattern 1: 7, Pattern 2: 0 |
| **Estimated effort** | 12-18 hours | 12-16 hours |
| **Complexity** | Medium (extraction + commands) | Medium (complex orchestration) |

**Key Difference**: Sprint 362 has **no extraction phase** but has **more complex orchestration** (deployment workflows, CI guards, post-apply hooks).

---

## Pattern 1 Verification

All 7 commands follow **Pattern 1 (Simple Delegation)**:

| Command | Business Logic | Pattern |
|---------|----------------|---------|
| `deploy services --all` | selectDeployableServices, submitBuild, Queue | ✅ Pattern 1 |
| `deploy service <name>` | selectDeployableServices, submitBuild | ✅ Pattern 1 |
| `deploy <name>` | Alias to deploy service | ✅ Pattern 1 |
| `infra plan [<module>]` | synthModule, terraformPlanGeneric | ✅ Pattern 1 |
| `infra apply [<module>]` | synthModule, terraformApplyGeneric | ✅ Pattern 1 |
| `lb urlmap render` | renderAndWrite | ✅ Pattern 1 |
| `lb urlmap import` | importUrlMap | ✅ Pattern 1 |

**Total**: 7/7 Pattern 1 (100%)

---

## Business Logic Extraction Plan

**Required Extractions**: 0

**Reason**: All business logic is already separated into production-ready modules:
- ✅ `providers/gcp/cloudbuild.ts` (100 lines, tested)
- ✅ `providers/terraform.ts` (150 lines, tested)
- ✅ `lb/urlmap/renderer.ts` (200 lines, 12 tests)
- ✅ `lb/importer/importer.ts` (100 lines, 8 tests)
- ✅ `providers/cdktf-synth.ts` (synth logic)
- ✅ `orchestration/queue.ts` (concurrency control)

**Commands will import from**:
```typescript
// Deploy commands
import { selectDeployableServices, computeDeploySubstitutions } from '../../cli/index';
import { submitBuild } from '../../providers/gcp/cloudbuild';
import { Queue } from '../../orchestration/queue';

// Infra commands
import { synthModule } from '../../providers/cdktf-synth';
import { terraformPlanGeneric, terraformApplyGeneric } from '../../providers/terraform';

// LB commands
import { renderAndWrite } from '../../lb/urlmap/renderer';
import { importUrlMap } from '../../lb/importer/importer';
```

---

## Test Coverage Status

| Module | Tests | Status |
|--------|-------|--------|
| `providers/gcp/cloudbuild.ts` | Unit tests | ✅ Tested |
| `providers/terraform.ts` | Manual integration | ✅ Tested |
| `lb/urlmap/renderer.ts` | 12 routing tests | ✅ Tested |
| `lb/importer/importer.ts` | 8 import tests | ✅ Tested |
| `selectDeployableServices()` | Production usage | ✅ Tested |
| `computeDeploySubstitutions()` | Production usage | ✅ Tested |

**Commands**: Will receive smoke tests only (7 tests per command × 7 commands = 49 tests)

---

## Risk Assessment

### Low Risk ✅

**Reason**: All business logic is battle-tested in production

**Evidence**:
- `submitBuild()` used in production deployments since Sprint 300+
- `terraformPlanGeneric()` used in production infra management since Sprint 320+
- `renderAndWrite()` used in production LB updates since Sprint 23
- `importUrlMap()` used in production LB updates since Sprint 23

**Mitigation**: Smoke tests verify delegation works correctly

---

## Lessons from Sprint 361 Applied

### ✅ Business Logic First

Sprint 361 lesson: Extract business logic BEFORE migrating commands

**Sprint 362 application**: No extraction needed - already done!

**Time saved**: ~5 hours (no extraction phase)

### ✅ Smoke Tests Only

Sprint 361 lesson: Smoke tests for commands, comprehensive tests for business logic

**Sprint 362 application**: Smoke tests only (business logic already has tests)

**Test count**: 49 smoke tests (7 per command)

### ✅ Use this.context

Sprint 361 lesson: Use `this.context` instead of calling `resolveContext()`

**Sprint 362 application**: All commands use `this.context` property

### ✅ Use this.logger

Sprint 361 lesson: `this.logger` is a property, not `this.getLogger()` method

**Sprint 362 application**: All commands use `this.logger` property

---

## Conclusion

✅ **Sprint 362 is a Pattern 1 sprint**

**No business logic extraction required** - all logic already separated into production-ready modules.

**Expected velocity**: Fast (12-16 hours) despite complex orchestration because:
1. No extraction phase (save ~5h)
2. All business logic tested and stable
3. Commands are thin wrappers
4. Patterns established in Sprint 360-361

**Focus areas**:
1. Correct delegation to business logic modules
2. CLI-specific orchestration (VPC preflight, CI guards, post-hooks)
3. Error handling and logging
4. Help text and examples

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: ✅ ANALYSIS COMPLETE - NO EXTRACTION REQUIRED
