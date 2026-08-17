# Sprint 364: Shared Logic Analysis

**Date**: 2026-07-25
**Sprint**: 364 (Cloud/Platform Command Migration)

---

## Executive Summary

**Scope**: 6 commands (cloud-run shutdown, trigger create/update/delete, apis enable, bit create)

**Business Logic Status**:
- **cloud-run shutdown**: ✅ Simple gcloud CLI wrapper (no extraction needed)
- **trigger commands (3)**: ✅ Fully separated in `providers/gcp/cloudbuild-triggers.ts`
- **apis enable**: ✅ Fully separated in `providers/gcp/apis.ts`
- **bit create**: ✅ Fully separated in `cli/bit/` modules

**Pattern Distribution**:
- Pattern 1 (Simple Delegation): 6 commands (100%)
- Pattern 2 (Business Logic Module): 0 commands (0%)

**Extraction Effort**: 0 hours (no extraction required - all logic already separated)

**Key Finding**: This is a 100% Pattern 1 sprint, similar to Sprint 362!

---

## Analysis by Command

### 1. cloud-run shutdown

**Pattern**: Pattern 1 (Simple Delegation) ✅

**Legacy Implementation**: `tools/brat/src/cli/index.ts:671-715` (cmdCloudRunShutdown)

**Business Logic Location**: Inline in cmdCloudRunShutdown (45 lines)

**Shared Logic**:
- ✅ Iterates through services from architecture.yaml
- ✅ Calls `gcloud run services update <name> --min-instances=0` for each service
- ✅ Uses `execCmd()` helper from orchestration/exec.ts
- ✅ Dry-run support
- ✅ Logger integration

**Dependencies**:
```typescript
import { resolveConfig } from '../../config/loader';
import { execCmd } from '../../orchestration/exec';
```

**Migration Strategy**: Direct delegation (inline logic is simple enough - no extraction needed)

**No Extraction Required**: ✅ Logic is trivial (just calling gcloud CLI)

---

### 2. trigger create / trigger update / trigger delete

**Pattern**: Pattern 1 (Simple Delegation) ✅

**Legacy Implementation**: `tools/brat/src/cli/index.ts:332-364` (cmdTrigger)

**Business Logic Location**: `tools/brat/src/providers/gcp/cloudbuild-triggers.ts`

**Shared Logic**:
- ✅ **createTrigger()** - Create Cloud Build trigger via GCP API
- ✅ **updateTrigger()** - Update existing trigger via GCP API
- ✅ **deleteTrigger()** - Delete trigger via GCP API
- ✅ All functions handle dry-run mode
- ✅ All functions return structured results

**Dependencies**:
```typescript
import { createTrigger, updateTrigger, deleteTrigger } from '../../providers/gcp/cloudbuild-triggers';
```

**cloudbuild-triggers.ts API**:
```typescript
export async function createTrigger(
  projectId: string,
  spec: TriggerSpec,
  dryRun: boolean
): Promise<TriggerResult>;

export async function updateTrigger(
  projectId: string,
  spec: TriggerSpec,
  dryRun: boolean
): Promise<TriggerResult>;

export async function deleteTrigger(
  projectId: string,
  name: string,
  dryRun: boolean
): Promise<TriggerResult>;
```

**TriggerSpec Type**:
```typescript
interface TriggerSpec {
  name: string;
  configPath: string;  // e.g., 'cloudbuild.yaml'
  substitutions: Record<string, string>;
  repoSource: {
    type: 'github';
    repo: string;        // e.g., 'owner/repo'
    branchRegex: string; // e.g., '.*' or 'main'
  };
}
```

**Migration Strategy**: Direct delegation to existing cloudbuild-triggers.ts functions

**No Extraction Required**: ✅ All business logic already separated

---

### 3. apis enable

**Pattern**: Pattern 1 (Simple Delegation) ✅

**Legacy Implementation**: `tools/brat/src/cli/index.ts:828-847` (inline in main router)

**Business Logic Location**: `tools/brat/src/providers/gcp/apis.ts`

**Shared Logic**:
- ✅ **getRequiredApis(env)** - Returns list of required GCP APIs for environment
- ✅ **enableApis()** - Enables GCP APIs via gcloud CLI
- ✅ Dry-run support
- ✅ JSON output support

**Dependencies**:
```typescript
import { getRequiredApis, enableApis } from '../../providers/gcp/apis';
```

**apis.ts API**:
```typescript
export function getRequiredApis(env: string): string[];

export async function enableApis(opts: {
  projectId: string;
  env: string;
  apis: string[];
  dryRun: boolean;
}): Promise<{
  projectId: string;
  env: string;
  apis: { name: string; status: string }[];
}>;
```

**Migration Strategy**: Direct delegation to existing apis.ts functions

**No Extraction Required**: ✅ All business logic already separated

---

### 4. bit create

**Pattern**: Pattern 1 (Simple Delegation) ✅

**Legacy Implementation**: `tools/brat/src/cli/bit/create.ts` (190 lines)

**Business Logic Location**: Well-separated into multiple modules:
- `cli/bit/create.ts` - Main command handler (190 lines)
- `cli/bit/templates.ts` - Template generation (400+ lines)
- `cli/bit/validation.ts` - Input validation (150+ lines)
- `cli/bit/registry.ts` - Architecture.yaml registration (100+ lines)

**Shared Logic**:
- ✅ **Validation Module** (`bit/validation.ts`):
  - `validateBitName()` - Validate Bit name (kebab-case, length, reserved names)
  - `validateProfileExposure()` - Validate profile/exposure combination
  - `validateBitDoesNotExist()` - Check uniqueness in architecture.yaml

- ✅ **Templates Module** (`bit/templates.ts`):
  - `generateAppSource()` - Generate service TypeScript file
  - `generateTest()` - Generate test file
  - `generateDockerfile()` - Generate Dockerfile
  - `generateCompose()` - Generate docker-compose service file

- ✅ **Registry Module** (`bit/registry.ts`):
  - `registerBitInArchitecture()` - Add service to architecture.yaml

**Dependencies**:
```typescript
import { validateBitName, validateProfileExposure, validateBitDoesNotExist } from './bit/validation';
import { generateAppSource, generateTest, generateDockerfile, generateCompose } from './bit/templates';
import { registerBitInArchitecture } from './bit/registry';
```

**Migration Strategy**: Direct delegation to existing bit/create.ts and supporting modules

**No Extraction Required**: ✅ All business logic already well-separated

---

## Shared Dependencies

### GCP Cloud Build Triggers

**Location**: `tools/brat/src/providers/gcp/cloudbuild-triggers.ts`

**Purpose**: CRUD operations for Cloud Build triggers via GCP API

**Key Functions**:
```typescript
export async function createTrigger(projectId, spec, dryRun): Promise<TriggerResult>;
export async function updateTrigger(projectId, spec, dryRun): Promise<TriggerResult>;
export async function deleteTrigger(projectId, name, dryRun): Promise<TriggerResult>;
```

**Used By**: trigger create/update/delete commands

**Status**: ✅ Already well-separated and reusable

---

### GCP APIs

**Location**: `tools/brat/src/providers/gcp/apis.ts`

**Purpose**: Enable required GCP APIs for environment

**Key Functions**:
```typescript
export function getRequiredApis(env: string): string[];
export async function enableApis(opts): Promise<ApiResult>;
```

**Used By**: apis enable command

**Status**: ✅ Already well-separated and reusable

---

### Bit Templates & Validation

**Location**: `tools/brat/src/cli/bit/` (templates.ts, validation.ts, registry.ts)

**Purpose**: Generate Bit service scaffolding and validate inputs

**Key Functions**:
```typescript
// validation.ts
export function validateBitName(name): ValidationResult;
export function validateProfileExposure(profile, exposure): ValidationResult;
export function validateBitDoesNotExist(name, arch): ValidationResult;

// templates.ts
export function generateAppSource(opts): string;
export function generateTest(opts): string;
export function generateDockerfile(opts): string;
export function generateCompose(opts): string;

// registry.ts
export function registerBitInArchitecture(opts): void;
```

**Used By**: bit create command

**Status**: ✅ Already well-separated and reusable

---

### execCmd Helper

**Location**: `tools/brat/src/orchestration/exec.ts`

**Purpose**: Execute shell commands with stdout/stderr capture

**Key Function**:
```typescript
export async function execCmd(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string>; stdio?: string }
): Promise<{ code: number; stdout: string; stderr: string }>;
```

**Used By**: cloud-run shutdown, apis enable (via gcloud CLI)

**Status**: ✅ Already well-separated and reusable

---

## Summary Table

| Command | Pattern | Business Logic Location | Status | Extraction Required |
|---------|---------|-------------------------|--------|---------------------|
| cloud-run shutdown | Pattern 1 | Inline (gcloud wrapper) | ✅ Ready | No |
| trigger create | Pattern 1 | providers/gcp/cloudbuild-triggers.ts | ✅ Ready | No |
| trigger update | Pattern 1 | providers/gcp/cloudbuild-triggers.ts | ✅ Ready | No |
| trigger delete | Pattern 1 | providers/gcp/cloudbuild-triggers.ts | ✅ Ready | No |
| apis enable | Pattern 1 | providers/gcp/apis.ts | ✅ Ready | No |
| bit create | Pattern 1 | cli/bit/ (create.ts, templates.ts, validation.ts, registry.ts) | ✅ Ready | No |

---

## Implementation Order

### Phase 1: Migrate trigger commands (2h)
- trigger create (0.7h)
- trigger update (0.5h)
- trigger delete (0.5h)
- Tests (0.3h)

### Phase 2: Migrate cloud-run and apis commands (1.5h)
- cloud-run shutdown (0.7h)
- apis enable (0.5h)
- Tests (0.3h)

### Phase 3: Migrate bit create command (2h)
- bit create (1h)
- Tests (1h - more complex due to file generation)

### Phase 4: Testing & Validation (1h)
- All oclif tests passing
- Regression tests (legacy CLI)
- Smoke tests

---

## Risks & Mitigations

### Risk 1: GCP API Credentials Required
**Risk**: Commands require GCP authentication (gcloud CLI or service account)
**Mitigation**: All commands have dry-run support for testing without credentials
**Code Pattern**:
```typescript
if (flags.dryRun) {
  this.log(`[DRY-RUN] Would execute: ${command}`);
  return;
}
```

### Risk 2: Bit Create File Generation
**Risk**: Complex file generation logic may have edge cases
**Mitigation**:
- Existing validation.ts prevents invalid inputs
- Templates.ts already battle-tested in production
- Comprehensive test coverage

### Risk 3: Cloud Build Trigger API Changes
**Risk**: GCP Cloud Build API may have changed since implementation
**Mitigation**:
- cloudbuild-triggers.ts already handles API versioning
- Dry-run mode for testing without API calls
**Evidence**: Module actively used in production

---

## Success Criteria

1. ✅ All 6 commands migrated to oclif
2. ✅ Pattern 1 (Simple Delegation): 6 commands (100%)
3. ✅ All business logic already separated (no extraction)
4. ✅ All oclif tests passing (217+ tests)
5. ✅ Zero regressions (Sprint 360-363 tests still pass)
6. ✅ Pattern consistency (100% Pattern 1, like Sprint 362)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: Analysis Complete
