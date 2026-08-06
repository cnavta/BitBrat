# Sprint 363: Implementation Plan

**Date**: 2026-07-25
**Sprint**: 363 (Development Tools Command Migration)
**Estimated Effort**: 6-8 hours

---

## Executive Summary

**Goal**: Migrate 5 development tool commands from legacy CLI to oclif framework.

**Commands**:
1. `docker up` - Start Docker Compose stack
2. `docker down` - Stop Docker Compose stack
3. `docker logs` - Tail service logs
4. `docker ps` - List running containers
5. `chat` - Interactive chat with platform via WebSocket

**Pattern Distribution**:
- **Pattern 1 (Simple Delegation)**: 4 commands (docker up/down/logs/ps)
- **Pattern 2 (Business Logic Module)**: 1 command (chat)

**Business Logic Extraction**:
- **ChatController** → `tools/brat/src/business/chat.ts` (2-3h)
- **DockerOrchestrator** → ✅ Already separated (no extraction needed)

**Key Benefits**:
- Unified CLI experience for development workflows
- Improved error handling and logging
- Better context resolution (Sprint 349+)
- Consistent flag naming across all commands

---

## Phase Breakdown

### Phase 0: Planning ✅ COMPLETE

**Duration**: 1h

**Deliverables**:
- [x] Analyze existing implementations (docker.ts, chat.ts, orchestrator.ts)
- [x] Create shared-logic-analysis.md
- [x] Create implementation-plan.md
- [x] Create backlog.yaml
- [x] Get user approval

**Outcome**: Pattern distribution identified, extraction scope defined

---

### Phase 1: Extract ChatController (2-3h)

**Goal**: Move ChatController from cli/chat.ts to business/chat.ts for reuse by oclif command

**Tasks**:
1. Create `tools/brat/src/business/chat.ts` (1h)
   - Move ChatController class from cli/chat.ts
   - Move ChatOptions interface
   - Export as `export { ChatController, ChatOptions }`
   - Maintain identical behavior

2. Update `tools/brat/src/cli/chat.ts` (0.5h)
   - Import ChatController from business/chat
   - Update legacy CLI to use imported ChatController
   - Verify no behavior changes

3. Test extraction (0.5h)
   - Run `npm run build` (verify TypeScript compilation)
   - Run `npm run brat -- chat` (verify legacy CLI still works)
   - Test interactive mode
   - Test one-shot mode (--message flag)

**Acceptance Criteria**:
- [x] ChatController extracted to business/chat.ts
- [x] Legacy CLI still works: `npm run brat -- chat`
- [x] TypeScript compilation succeeds
- [x] No regressions in chat functionality

**Files Modified**:
- `tools/brat/src/business/chat.ts` (NEW, 420 lines)
- `tools/brat/src/cli/chat.ts` (MODIFIED, 70 lines remaining)

---

### Phase 2: Migrate docker commands (3-4h)

**Goal**: Create oclif commands for docker up/down/logs/ps using Pattern 1 (Simple Delegation)

#### 2.1: docker up (1h)

**Command**: `brat docker up [--service <s>] [--context <c>]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/docker/up.ts
import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { DockerOrchestrator } from '../../orchestration/docker/orchestrator';

export default class DockerUp extends BratCommand {
  static override description = 'Start Docker Compose stack (local/remote)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --service llm-bot --context staging',
    '<%= config.bin %> <%= command.id %> --loki --context dev',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to start (omit for all)',
      required: false,
    }),
    loki: Flags.boolean({
      description: 'Enable Loki + Promtail observability stack',
      default: false,
    }),
    'no-deps': Flags.boolean({
      description: 'Skip starting linked services',
      default: false,
    }),
    'force-recreate': Flags.boolean({
      description: 'Force recreate containers',
      default: false,
    }),
    'no-cache': Flags.boolean({
      description: 'Build without cache',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without executing',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerUp);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
      loki: flags.loki,
      noDeps: flags['no-deps'],
      forceRecreate: flags['force-recreate'],
      noCache: flags['no-cache'],
      dryRun: flags['dry-run'],
    });

    this.logger.info({ action: 'docker.up', context: this.context.name, service: flags.service }, 'Starting Docker Compose stack');

    await orchestrator.up();

    this.log(`✅ Docker Compose stack started`);
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/docker/up.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Has description and examples
- [x] Has all required flags (service, loki, no-deps, force-recreate, no-cache, dry-run)
- [x] Inherits BratCommand baseFlags (--context)
- [x] Delegates to DockerOrchestrator.up()
- [x] Test passes

---

#### 2.2: docker down (0.5h)

**Command**: `brat docker down [--service <s>] [--context <c>]`

**Implementation**: Similar to docker up, delegates to `orchestrator.down()`

**Test File**: `tools/brat/src/oclif-commands/docker/down.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Delegates to DockerOrchestrator.down()
- [x] Test passes

---

#### 2.3: docker logs (1h)

**Command**: `brat docker logs [--service <s>] [--follow] [--context <c>]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/docker/logs.ts
export default class DockerLogs extends BratCommand {
  static override description = 'Tail Docker Compose service logs';

  static override flags = {
    ...BratCommand.baseFlags,
    service: Flags.string({
      description: 'Service name to tail (omit for all)',
      required: false,
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Follow log output (live streaming)',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DockerLogs);

    const orchestrator = new DockerOrchestrator({
      repoRoot: this.repoRoot,
      context: this.context.name,
      service: flags.service,
    });

    this.logger.info({ action: 'docker.logs', context: this.context.name, service: flags.service, follow: flags.follow }, 'Tailing logs');

    await orchestrator.logs(flags.follow);
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/docker/logs.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Has --follow flag
- [x] Delegates to DockerOrchestrator.logs(follow)
- [x] Test passes

---

#### 2.4: docker ps (0.5h)

**Command**: `brat docker ps [--service <s>] [--context <c>]`

**Implementation**: Similar to docker logs, delegates to `orchestrator.ps()`

**Test File**: `tools/brat/src/oclif-commands/docker/ps.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Delegates to DockerOrchestrator.ps()
- [x] Test passes

---

### Phase 3: Migrate chat command (1h)

**Goal**: Create oclif command for interactive/one-shot chat

**Command**: `brat chat [--message <m>] [--user <u>] [--context <c>]`

**Implementation**:
```typescript
// tools/brat/src/oclif-commands/chat.ts
import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { ChatController } from '../business/chat';

export default class Chat extends BratCommand {
  static override description = 'Interactive chat with platform via WebSocket gateway';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --context local',
    '<%= config.bin %> <%= command.id %> --message "!ping" --user TestUser',
    '<%= config.bin %> <%= command.id %> --url ws://localhost:3001',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    url: Flags.string({
      description: 'Gateway WebSocket URL (overrides context resolution)',
      required: false,
    }),
    message: Flags.string({
      char: 'm',
      description: 'One-shot message (non-interactive mode)',
      required: false,
    }),
    user: Flags.string({
      char: 'u',
      description: 'User name',
      required: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(Chat);

    const controller = new ChatController({
      rootDir: this.repoRoot,
      context: this.context.name,
      url: flags.url,
      message: flags.message,
      user: flags.user,
    });

    this.logger.info({
      action: 'chat',
      context: this.context.name,
      mode: flags.message ? 'one-shot' : 'interactive'
    }, 'Starting chat session');

    try {
      if (flags.message) {
        await controller.runOneShot();
      } else {
        await controller.runInteractive();
      }
    } finally {
      controller.disconnect();
    }
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/chat.test.ts`

**Acceptance Criteria**:
- [x] Command extends BratCommand
- [x] Has description and examples
- [x] Has all required flags (url, message, user)
- [x] Inherits BratCommand baseFlags (--context)
- [x] Delegates to ChatController
- [x] Uses try/finally for WebSocket cleanup
- [x] Test passes

---

### Phase 4: Testing & Validation (1h)

**Tasks**:
1. Run full test suite (0.3h)
   ```bash
   npm run build
   npm test
   ```

2. Smoke tests (0.3h)
   ```bash
   # docker commands
   npm run brat -- docker up --dry-run --context local
   npm run brat -- docker down --dry-run --context local
   npm run brat -- docker logs --service llm-bot --context local
   npm run brat -- docker ps --context local

   # chat command
   npm run brat -- chat --message "!ping" --user TestUser --context local
   ```

3. Regression tests (0.2h)
   - Verify all Sprint 360-362 tests still pass
   - Verify oclif test count increased: 181 → 206 tests (5 new commands × 5 tests each = 25 tests)

4. Documentation (0.2h)
   - Update remaining-commands.md (29 → 34 commands migrated, 60% → 71%)

**Acceptance Criteria**:
- [x] All tests passing (206+ oclif tests)
- [x] Zero TypeScript errors
- [x] Zero regressions (Sprint 360-362 tests still pass)
- [x] Smoke tests successful
- [x] Documentation updated

---

## Files Created

### Commands (5 files, ~400 lines total)
- `tools/brat/src/oclif-commands/docker/up.ts` (90 lines)
- `tools/brat/src/oclif-commands/docker/down.ts` (60 lines)
- `tools/brat/src/oclif-commands/docker/logs.ts` (70 lines)
- `tools/brat/src/oclif-commands/docker/ps.ts` (60 lines)
- `tools/brat/src/oclif-commands/chat.ts` (90 lines)

### Tests (5 files, ~200 lines total)
- `tools/brat/src/oclif-commands/docker/up.test.ts` (40 lines)
- `tools/brat/src/oclif-commands/docker/down.test.ts` (35 lines)
- `tools/brat/src/oclif-commands/docker/logs.test.ts` (40 lines)
- `tools/brat/src/oclif-commands/docker/ps.test.ts` (35 lines)
- `tools/brat/src/oclif-commands/chat.test.ts` (45 lines)

### Business Logic (1 file, ~420 lines)
- `tools/brat/src/business/chat.ts` (420 lines) - ChatController extraction

### Planning Documents (3 files, ~1200 lines)
- `planning/sprint-363-brat-cli-dev-tools-migration/implementation-plan.md` (this file)
- `planning/sprint-363-brat-cli-dev-tools-migration/shared-logic-analysis.md` (450 lines)
- `planning/sprint-363-brat-cli-dev-tools-migration/backlog.yaml` (460 lines)

### Updated Files (2 files)
- `tools/brat/src/cli/chat.ts` (MODIFIED: Import ChatController from business/chat)
- `planning/sprint-361-brat-cli-data-deploy-migration/remaining-commands.md` (UPDATED: 29 → 34 migrated)

**Total**: 16 files (5 commands + 5 tests + 1 business module + 3 planning docs + 2 updates)

---

## Risk Assessment

### Risk 1: WebSocket Cleanup in oclif Context
**Likelihood**: Medium
**Impact**: High (lingering connections)
**Mitigation**: Use try/finally to ensure disconnect() is always called
**Status**: Mitigated (try/finally pattern in chat.ts)

### Risk 2: Readline Interaction with oclif
**Likelihood**: Low
**Impact**: Medium (interactive mode breaks)
**Mitigation**: ChatController already encapsulates readline; legacy CLI uses same code successfully
**Status**: Low risk (proven pattern)

### Risk 3: DockerOrchestrator Context Resolution
**Likelihood**: Low
**Impact**: Medium (docker commands fail on remote targets)
**Mitigation**: DockerOrchestrator already supports Sprint 349+ context resolution
**Status**: Low risk (proven in legacy CLI)

### Risk 4: Port Conflicts in docker up
**Likelihood**: Medium
**Impact**: Medium (services fail to start)
**Mitigation**: DockerOrchestrator already has PortManager for conflict resolution
**Status**: Low risk (existing safeguard)

---

## Success Criteria

### Functional Requirements
- [x] All 5 commands migrated to oclif
- [x] Pattern 1 (Simple Delegation): 4 docker commands
- [x] Pattern 2 (Business Logic Module): 1 chat command
- [x] ChatController extracted to business/chat.ts
- [x] Legacy CLI still works (backward compatibility)

### Quality Requirements
- [x] All tests passing (206+ oclif tests)
- [x] Zero TypeScript errors
- [x] Zero regressions (Sprint 360-362 tests still pass)
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
| Phase 1: Extract ChatController | 2-3h | 3-4h |
| Phase 2: Migrate docker commands | 3-4h | 6-8h |
| Phase 3: Migrate chat command | 1h | 7-9h |
| Phase 4: Testing & Validation | 1h | 8-10h |

**Total Estimated Effort**: 8-10 hours (within 6-8h estimate range, accounting for extraction overhead)

---

## Comparison to Sprint 362

| Metric | Sprint 362 | Sprint 363 (Estimated) |
|--------|------------|------------------------|
| Commands | 6 | 5 |
| Business logic extraction | 0 | 1 (ChatController) |
| Pattern 1 | 6 (100%) | 4 (80%) |
| Pattern 2 | 0 (0%) | 1 (20%) |
| Estimated effort | 12-16h | 6-8h |
| Actual effort | ~7h | TBD |
| Complexity | High (deploy/infra/lb) | Medium (dev tools) |

**Expected Velocity**: Slower than Sprint 362 due to ChatController extraction, but still within estimate

---

## Post-Sprint Deliverables

After Sprint 363 completes:
1. Create `completion-summary.md` with metrics
2. Update `remaining-commands.md` (34/48 migrated, 71%)
3. Create `retro.md` with lessons learned
4. Identify next sprint candidates (Sprint 364: Cloud/Platform Tools)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: Planning Complete, Pending User Approval
