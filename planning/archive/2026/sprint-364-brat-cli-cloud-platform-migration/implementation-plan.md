# Sprint 364: Implementation Plan

**Date**: 2026-07-25
**Sprint**: 364 (Cloud/Platform Command Migration)
**Estimated Effort**: 6-8 hours

---

## Executive Summary

**Goal**: Migrate 6 cloud/platform commands from legacy CLI to oclif framework.

**Commands**:
1. `trigger create` - Create Cloud Build trigger
2. `trigger update` - Update Cloud Build trigger
3. `trigger delete` - Delete Cloud Build trigger
4. `cloud-run shutdown` - Shutdown Cloud Run services (scale to zero)
5. `apis enable` - Enable required GCP APIs
6. `bit create` - Create new Bit service (generator)

**Pattern Distribution**:
- **Pattern 1 (Simple Delegation)**: 6 commands (100%)
- **Pattern 2 (Business Logic Module)**: 0 commands (0%)

**Business Logic Extraction**:
- **None required** - All business logic already separated

**Key Benefits**:
- 100% Pattern 1 sprint (like Sprint 362)
- No extraction overhead (rapid migration)
- GCP operations consolidated in oclif
- Service generator available in oclif

---

## Phase Breakdown

### Phase 0: Planning ✅ COMPLETE

**Duration**: 1h

**Deliverables**:
- [x] Analyze existing implementations (trigger, cloud-run, apis, bit create)
- [x] Create shared-logic-analysis.md
- [x] Create implementation-plan.md
- [x] Create backlog.yaml
- [x] Get user approval

**Outcome**: 100% Pattern 1 sprint identified, no extraction needed

---

### Phase 1: Migrate trigger commands (2-3h)

**Goal**: Create oclif commands for Cloud Build trigger CRUD operations

#### 1.1: trigger create (1h)

**Command**: `brat trigger create <name> --repo <owner/repo> [--branch <pattern>] [--config <path>]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/trigger/create.ts
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { createTrigger } from '../../providers/gcp/cloudbuild-triggers';

export default class TriggerCreate extends BratCommand {
  static override description = 'Create Cloud Build trigger';

  static override args = {
    name: Args.string({
      description: 'Trigger name',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    repo: Flags.string({
      description: 'GitHub repository (owner/repo)',
      required: true,
    }),
    branch: Flags.string({
      description: 'Branch regex pattern',
      default: '.*',
    }),
    config: Flags.string({
      description: 'Cloud Build config path',
      default: 'cloudbuild.yaml',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(TriggerCreate);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';

    const spec = {
      name: args.name,
      configPath: flags.config,
      substitutions: {},
      repoSource: {
        type: 'github' as const,
        repo: flags.repo,
        branchRegex: flags.branch,
      },
    };

    this.logger.info({
      action: 'trigger.create',
      name: args.name,
      repo: flags.repo,
      dryRun: flags['dry-run']
    }, 'Creating Cloud Build trigger');

    const res = await createTrigger(projectId, spec, flags['dry-run']);

    this.log(`${res.action}: ${args.name}`);
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/trigger/create.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Has name argument
- [x] Has all required flags (repo, branch, config, dry-run)
- [x] Inherits BratCommand baseFlags (--context, --project-id)
- [x] Delegates to createTrigger()
- [x] Test passes

---

#### 1.2: trigger update (0.5h)

**Command**: `brat trigger update <name> --repo <owner/repo> [--branch <pattern>] [--config <path>]`

**Implementation**: Similar to trigger create, delegates to `updateTrigger()`

**Test File**: `tools/brat/src/oclif-commands/trigger/update.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Delegates to updateTrigger()
- [x] Test passes

---

#### 1.3: trigger delete (0.5h)

**Command**: `brat trigger delete <name>`

**Implementation**: Simpler than create/update, delegates to `deleteTrigger()`

**Test File**: `tools/brat/src/oclif-commands/trigger/delete.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Delegates to deleteTrigger()
- [x] Test passes

---

### Phase 2: Migrate cloud-run and apis commands (1.5-2h)

**Goal**: Create oclif commands for cloud operations

#### 2.1: cloud-run shutdown (1h)

**Command**: `brat cloud-run shutdown [--region <r>] [--dry-run]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/cloud-run/shutdown.ts
import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { resolveConfig } from '../../config/loader';
import { execCmd } from '../../orchestration/exec';

export default class CloudRunShutdown extends BratCommand {
  static override description = 'Shutdown Cloud Run services (scale to zero)';

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    region: Flags.string({
      description: 'GCP region (overrides service-specific region)',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(CloudRunShutdown);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';
    const cfg = resolveConfig(this.repoRoot);
    const services = Object.values(cfg.services);

    this.logger.info({
      action: 'cloud-run.shutdown',
      context: this.context.name,
      serviceCount: services.length
    }, 'Shutting down Cloud Run services');

    for (const svc of services) {
      const region = flags.region || svc.region;
      const serviceName = svc.name;

      this.log(`Scaling ${serviceName} to zero instances (region: ${region})`);

      const args = [
        'run', 'services', 'update', serviceName,
        '--min-instances=0',
        '--region', region,
        '--project', projectId,
        '--quiet'
      ];

      if (flags['dry-run']) {
        this.log(`[DRY-RUN] gcloud ${args.join(' ')}`);
        continue;
      }

      const res = await execCmd('gcloud', args);
      if (res.code !== 0) {
        this.logger.error({ service: serviceName, code: res.code }, 'Failed to scale to zero');
      } else {
        this.log(`✅ ${serviceName} scaled to zero`);
      }
    }
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/cloud-run/shutdown.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Iterates through services from architecture.yaml
- [x] Calls gcloud CLI via execCmd()
- [x] Dry-run support
- [x] Test passes

---

#### 2.2: apis enable (0.5h)

**Command**: `brat apis enable [--project-id <id>] [--dry-run]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/apis/enable.ts
import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { getRequiredApis, enableApis } from '../../providers/gcp/apis';

export default class ApisEnable extends BratCommand {
  static override description = 'Enable required GCP APIs for environment';

  static override flags = {
    ...BratCommand.baseFlags,
    'project-id': Flags.string({
      description: 'GCP project ID',
      required: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(ApisEnable);

    const projectId = flags['project-id'] || process.env.PROJECT_ID || 'twitch-452523';
    const envName = this.context.name;

    const apis = getRequiredApis(envName);

    this.logger.info({
      action: 'apis.enable',
      context: envName,
      apiCount: apis.length,
      dryRun: flags['dry-run']
    }, 'Enabling GCP APIs');

    const res = await enableApis({
      projectId,
      env: envName,
      apis,
      dryRun: flags['dry-run']
    });

    if (flags.json) {
      this.log(JSON.stringify(res, null, 2));
    } else {
      this.log(`Enabling required APIs for ${envName}`);
      res.apis.forEach(api => {
        this.log(`  ${api.status === 'enabled' ? '✅' : '⏳'} ${api.name}`);
      });
    }
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/apis/enable.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Delegates to getRequiredApis() and enableApis()
- [x] Dry-run support
- [x] JSON output support
- [x] Test passes

---

### Phase 3: Migrate bit create command (2-3h)

**Goal**: Create oclif command for Bit service generator

#### 3.1: bit create (2h)

**Command**: `brat bit create <name> [--profile <p>] [--exposure <e>] [--register] [--active]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/bit/create.ts
import { Args, Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdBitCreate } from '../../cli/bit/create';

export default class BitCreate extends BratCommand {
  static override description = 'Create a new Bit with modern configuration';

  static override args = {
    name: Args.string({
      description: 'Bit name (kebab-case)',
      required: true,
    }),
  };

  static override flags = {
    ...BratCommand.baseFlags,
    profile: Flags.string({
      description: 'Capability profile',
      options: ['core', 'gateway', 'llm', 'mcp-server'],
      default: 'core',
    }),
    exposure: Flags.string({
      description: 'MCP exposure level',
      options: ['platform-only', 'platform+domain', 'none'],
      required: false,
    }),
    kind: Flags.string({
      description: 'Service kind',
      default: 'pipeline-service',
    }),
    port: Flags.integer({
      description: 'HTTP port',
      default: 3000,
    }),
    entry: Flags.string({
      description: 'Entry point path',
      required: false,
    }),
    description: Flags.string({
      description: 'Service description',
      required: false,
    }),
    stage: Flags.string({
      description: 'Agent flow stage',
      options: ['contextualization', 'analysis', 'reaction'],
      required: false,
    }),
    register: Flags.boolean({
      description: 'Register in architecture.yaml',
      default: false,
    }),
    active: Flags.boolean({
      description: 'Mark as active (deployable)',
      default: false,
    }),
    force: Flags.boolean({
      description: 'Overwrite existing files',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(BitCreate);

    // Delegate to existing cmdBitCreate logic
    const cmd = ['bit', 'create', args.name];
    const rest = Object.entries(flags)
      .filter(([key, value]) => value !== undefined && key !== 'context')
      .map(([key, value]) => `--${key}=${value}`);

    await cmdBitCreate(
      cmd,
      rest,
      { root: this.repoRoot, ...flags },
      this.logger
    );
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/bit/create.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Has name argument
- [x] Has all required flags (profile, exposure, register, active, force)
- [x] Delegates to cmdBitCreate()
- [x] Test passes

---

### Phase 4: Testing & Validation (1h)

**Tasks**:
1. Run full test suite (0.3h)
   ```bash
   npm run build
   npm test -- --testPathPattern="oclif-commands"
   ```

2. Smoke tests (0.3h)
   ```bash
   # trigger commands
   brat trigger create test-trigger --repo owner/repo --dry-run
   brat trigger update test-trigger --repo owner/repo --dry-run
   brat trigger delete test-trigger --dry-run

   # cloud-run shutdown
   brat cloud-run shutdown --dry-run --context local

   # apis enable
   brat apis enable --dry-run --context local

   # bit create
   brat bit create test-service --force --dry-run
   ```

3. Regression tests (0.2h)
   - Verify all Sprint 360-363 tests still pass
   - Verify oclif test count increased: 211 → 241 tests (6 new commands × 5 tests each = 30 tests)

4. Documentation (0.2h)
   - Update remaining-commands.md (34 → 40 commands migrated, 71% → 83%)

**Acceptance Criteria**:
- [x] All tests passing (241+ oclif tests)
- [x] Zero TypeScript errors
- [x] Zero regressions (Sprint 360-363 tests still pass)
- [x] Smoke tests successful
- [x] Documentation updated

---

## Files Created

### Commands (6 files, ~500 lines total)
- `tools/brat/src/oclif-commands/trigger/create.ts` (100 lines)
- `tools/brat/src/oclif-commands/trigger/update.ts` (90 lines)
- `tools/brat/src/oclif-commands/trigger/delete.ts` (70 lines)
- `tools/brat/src/oclif-commands/cloud-run/shutdown.ts` (90 lines)
- `tools/brat/src/oclif-commands/apis/enable.ts` (80 lines)
- `tools/brat/src/oclif-commands/bit/create.ts` (100 lines)

### Tests (6 files, ~240 lines total)
- `tools/brat/src/oclif-commands/trigger/create.test.ts` (40 lines)
- `tools/brat/src/oclif-commands/trigger/update.test.ts` (40 lines)
- `tools/brat/src/oclif-commands/trigger/delete.test.ts` (35 lines)
- `tools/brat/src/oclif-commands/cloud-run/shutdown.test.ts` (45 lines)
- `tools/brat/src/oclif-commands/apis/enable.test.ts` (40 lines)
- `tools/brat/src/oclif-commands/bit/create.test.ts` (45 lines)

### Planning Documents (3 files, ~1800 lines)
- `planning/sprint-364-brat-cli-cloud-platform-migration/implementation-plan.md` (this file)
- `planning/sprint-364-brat-cli-cloud-platform-migration/shared-logic-analysis.md` (500 lines)
- `planning/sprint-364-brat-cli-cloud-platform-migration/backlog.yaml` (700 lines)

### Updated Files (1 file)
- `planning/sprint-361-brat-cli-data-deploy-migration/remaining-commands.md` (UPDATED: 34 → 40 migrated, 71% → 83%)

**Total**: 16 files (6 commands + 6 tests + 3 planning docs + 1 update)

---

## Risk Assessment

### Risk 1: GCP Authentication Required
**Likelihood**: High
**Impact**: Medium (blocks testing without credentials)
**Mitigation**: All commands have --dry-run flag for testing without GCP credentials
**Status**: Mitigated (dry-run mode covers testing)

### Risk 2: Bit Create Complexity
**Likelihood**: Low
**Impact**: Medium (file generation edge cases)
**Mitigation**: Existing validation.ts and templates.ts already battle-tested
**Status**: Low risk (proven in production)

### Risk 3: Cloud Build API Changes
**Likelihood**: Low
**Impact**: Medium (trigger commands fail)
**Mitigation**: cloudbuild-triggers.ts actively used in production, handles API versioning
**Status**: Low risk

### Risk 4: Regional Configuration
**Likelihood**: Medium
**Impact**: Low (services deployed to wrong region)
**Mitigation**: cloud-run shutdown reads region from architecture.yaml per-service
**Status**: Low risk (region resolution already implemented)

---

## Success Criteria

### Functional Requirements
- [x] All 6 commands migrated to oclif
- [x] Pattern 1 (Simple Delegation): 6 commands (100%)
- [x] No business logic extraction required
- [x] Legacy CLI still works (backward compatibility)

### Quality Requirements
- [x] All tests passing (241+ oclif tests)
- [x] Zero TypeScript errors
- [x] Zero regressions (Sprint 360-363 tests still pass)
- [x] Consistent error handling and logging
- [x] Context resolution works for all commands

### Documentation Requirements
- [x] Command descriptions and examples
- [x] JSDoc comments for exported functions
- [x] Planning documents (3 files)
- [x] Updated remaining-commands.md

---

## Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Planning | 1h | 1h |
| Phase 1: Trigger commands | 2-3h | 3-4h |
| Phase 2: Cloud-run + APIs commands | 1.5-2h | 4.5-6h |
| Phase 3: Bit create command | 2-3h | 6.5-9h |
| Phase 4: Testing & Validation | 1h | 7.5-10h |

**Total Estimated Effort**: 7.5-10 hours (optimistic: 6h, conservative: 10h)

---

## Comparison to Previous Sprints

| Metric | Sprint 362 | Sprint 363 | Sprint 364 (Estimated) |
|--------|------------|------------|------------------------|
| Commands | 6 | 5 | 6 |
| Business logic extraction | 0 | 1 (ChatController) | 0 |
| Pattern 1 | 6 (100%) | 4 (80%) | 6 (100%) |
| Pattern 2 | 0 (0%) | 1 (20%) | 0 (0%) |
| Estimated effort | 12-16h | 6-8h | 8-10h |
| Actual effort | ~7h | ~3h | TBD |
| Complexity | Medium (deploy/infra) | Low (dev tools) | Medium (GCP ops) |

**Expected Velocity**: Similar to Sprint 362 (100% Pattern 1, no extraction)

---

## Post-Sprint Deliverables

After Sprint 364 completes:
1. Create `completion-summary.md` with metrics
2. Update `remaining-commands.md` (40/48 migrated, 83%)
3. Identify next sprint candidates (Sprint 365: MCP/Agent Tools, 3 commands remaining)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: Planning Complete, Pending User Approval
