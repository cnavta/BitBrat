# Sprint 363: Shared Logic Analysis

**Date**: 2026-07-25
**Sprint**: 363 (Development Tools Command Migration)

---

## Executive Summary

**Scope**: 5 commands (docker up/down/logs/ps, chat)

**Business Logic Status**:
- **Docker commands (4)**: ✅ Fully separated in `DockerOrchestrator` class
- **Chat command (1)**: ⚠️ Requires extraction to business module

**Pattern Distribution**:
- Pattern 1 (Simple Delegation): 4 commands (docker up/down/logs/ps)
- Pattern 2 (Business Logic Module): 1 command (chat - extract ChatController)

**Extraction Effort**: ~2-3 hours (single ChatController extraction)

---

## Analysis by Command

### 1. docker up / docker down / docker logs / docker ps

**Pattern**: Pattern 1 (Simple Delegation) ✅

**Legacy Implementation**: `tools/brat/src/cli/docker.ts` (77 lines)

**Business Logic Location**: `tools/brat/src/orchestration/docker/orchestrator.ts` (611 lines)

**Shared Logic**:
- ✅ **DockerOrchestrator class** - Fully separated orchestration module
  - `up()`: Start Docker Compose stack with remote sync support
  - `down()`: Stop Docker Compose stack
  - `logs(follow: boolean)`: Tail service logs
  - `ps()`: List running containers
  - Environment resolution via `EnvironmentResolver`
  - Compose file generation via `ComposeFactory`
  - Port management via `PortManager`
  - Remote SSH execution for remote targets
  - File syncing (rsync/scp) to remote hosts
  - GCP ADC credentials syncing
  - Sprint 349+ context resolution support

**Dependencies**:
```typescript
import { execCmd } from '../exec';
import { EnvironmentResolver } from './environment-resolver';
import { ComposeFactory } from './compose-factory';
import { PortManager } from './port-manager';
import { loadArchitecture, resolveServices } from '../../config/loader';
import { ContextResolver } from '../../context/context-resolver';
```

**Options Type**:
```typescript
export interface DockerOrchestratorOptions {
  repoRoot: string;
  target?: string;        // Legacy: deployment target name
  env?: string;           // Legacy: environment name
  context?: string;       // Sprint 349+: execution context name
  service?: string;       // Filter to specific service
  dryRun?: boolean;       // Preview mode
  loki?: boolean;         // Enable Loki observability stack
  noDeps?: boolean;       // --no-deps flag (skip dependencies)
  forceRecreate?: boolean; // --force-recreate flag
  noCache?: boolean;      // --no-cache flag
}
```

**Legacy CLI Usage** (docker.ts:67-77):
```typescript
export async function cmdDocker(action: string, flags: any) {
  const root = flags.root || process.cwd();

  // Sprint 349+: context support
  const contextName = flags.context || process.env.BITBRAT_CONTEXT;

  const orchestrator = new DockerOrchestrator({
    repoRoot: root,
    context: contextName,
    target: flags.target,
    env: flags.env,
    service: flags.service,
    dryRun: flags.dryRun,
  });

  if (action === 'up') await orchestrator.up();
  else if (action === 'down') await orchestrator.down();
  else if (action === 'logs') await orchestrator.logs(flags.follow);
  else if (action === 'ps') await orchestrator.ps();
}
```

**Migration Strategy**: Direct delegation to existing `DockerOrchestrator` methods

**No Extraction Required**: ✅ All business logic already separated

---

### 2. chat

**Pattern**: Pattern 2 (Business Logic Module) ⚠️

**Legacy Implementation**: `tools/brat/src/cli/chat.ts` (461 lines)

**Current State**: ChatController class embedded directly in chat.ts

**Extraction Required**: ✅ Extract ChatController to `tools/brat/src/business/chat.ts`

**Business Logic**:
- ChatController class (390 lines)
  - WebSocket connection management
  - Gateway URL resolution via ContextResolver
  - Interactive mode (readline interface)
  - One-shot mode (--message flag)
  - Heartbeat and reconnection logic
  - Message sending and receiving
  - Authentication (optional --user flag)

**Key Methods**:
```typescript
class ChatController {
  constructor(private readonly options: ChatOptions);

  private async resolveUrl(): Promise<string>;
  private async connectWs(): Promise<void>;
  private setupHeartbeat(): void;
  private async handleMessage(data: string): Promise<void>;
  public async runInteractive(): Promise<void>;
  public async runOneShot(): Promise<void>;
  public disconnect(): void;
}
```

**ChatOptions Type**:
```typescript
interface ChatOptions {
  rootDir: string;
  context?: string;    // Sprint 349+: execution context name
  url?: string;        // Override gateway URL
  message?: string;    // One-shot message
  user?: string;       // User name
  dryRun?: boolean;    // Preview mode
}
```

**Dependencies**:
```typescript
import WebSocket from 'ws';
import * as readline from 'readline';
import { ContextResolver } from '../context/context-resolver';
```

**Gateway URL Resolution** (chat.ts:94-125):
```typescript
private async resolveUrl(): Promise<string> {
  if (this.options.url) {
    return this.options.url;
  }

  let url: string | undefined;
  let contextName = this.options.context;

  // Priority: --context flag > BITBRAT_CONTEXT env > ~/.bratrc current
  if (!contextName) {
    contextName = process.env.BITBRAT_CONTEXT;
  }

  if (!contextName) {
    const bratrcPath = path.join(os.homedir(), '.bratrc');
    if (fs.existsSync(bratrcPath)) {
      const bratrc = JSON.parse(fs.readFileSync(bratrcPath, 'utf8'));
      contextName = bratrc.currentContext;
    }
  }

  contextName = contextName || 'local';

  const resolver = new ContextResolver(this.options.rootDir);
  const context = await resolver.resolve(contextName);

  url = context.runtime.gateway.url;

  if (!url) {
    throw new Error(
      `No gateway URL found for context '${contextName}'. ` +
      `Check runtime.gateway.url in architecture.yaml executionContexts.`
    );
  }

  return url;
}
```

**Migration Strategy**:
1. Extract ChatController to `tools/brat/src/business/chat.ts`
2. Create oclif command `tools/brat/src/oclif-commands/chat.ts` that delegates to ChatController
3. Maintain identical behavior (interactive + one-shot modes)

**Extraction Effort**: ~2-3 hours
- 1h: Extract ChatController to business/chat.ts
- 1h: Create oclif command
- 1h: Create tests

---

## Shared Dependencies

### ContextResolver (Sprint 349+)

**Location**: `tools/brat/src/context/context-resolver.ts`

**Purpose**: Resolve execution context configuration from architecture.yaml

**Key Methods**:
```typescript
class ContextResolver {
  async resolve(contextName: string): Promise<ResolvedContext>;
  async getRawContext(name: string): Promise<ExecutionContext | null>;
}
```

**Used By**:
- docker commands (via DockerOrchestrator.prepare())
- chat command (via ChatController.resolveUrl())

**Status**: ✅ Already well-separated and reusable

---

### EnvironmentResolver

**Location**: `tools/brat/src/orchestration/docker/environment-resolver.ts`

**Purpose**: Load and merge environment variables from env/<context>/ directory

**Key Methods**:
```typescript
class EnvironmentResolver {
  resolve(envName: string, securePath?: string): Record<string, string | number | boolean>;
  static flattenToDotEnv(env: Record<string, any>): string;
}
```

**Used By**: DockerOrchestrator

**Status**: ✅ Already well-separated

---

### ComposeFactory

**Location**: `tools/brat/src/orchestration/docker/compose-factory.ts`

**Purpose**: Generate Docker Compose file lists and arguments

**Key Methods**:
```typescript
class ComposeFactory {
  getComposeFiles(service?: string, inactiveServices?: string[], loki?: boolean): ComposeFileSet;
  buildComposeArgs(fileSet: ComposeFileSet, envFiles: string[], projectName: string): string[];
  getBuildableBaseServices(): string[];
}
```

**Used By**: DockerOrchestrator

**Status**: ✅ Already well-separated

---

### PortManager

**Location**: `tools/brat/src/orchestration/docker/port-manager.ts`

**Purpose**: Resolve and manage port assignments for services

**Key Methods**:
```typescript
class PortManager {
  async resolvePorts(serviceFiles: string[], env: Record<string, any>, targetConfig: any): Promise<PortAssignment[]>;
  getEnvOverrides(assignments: PortAssignment[]): Record<string, number>;
}
```

**Used By**: DockerOrchestrator

**Status**: ✅ Already well-separated

---

## Extraction Plan

### Phase 1: Extract ChatController (2-3h)

**Goal**: Move ChatController from cli/chat.ts to business/chat.ts

**Steps**:
1. Create `tools/brat/src/business/chat.ts`
2. Move ChatController class and ChatOptions interface
3. Export as default: `export { ChatController }`
4. Update imports in cli/chat.ts (for regression testing)
5. Verify legacy CLI still works: `npm run brat -- chat`

**File Structure**:
```
tools/brat/src/
  business/
    chat.ts              # NEW: ChatController class
  cli/
    chat.ts              # UPDATED: Import ChatController from business/chat
  oclif-commands/
    chat.ts              # NEW: oclif command delegating to ChatController
```

**ChatController API**:
```typescript
// tools/brat/src/business/chat.ts
import WebSocket from 'ws';
import * as readline from 'readline';
import { ContextResolver } from '../context/context-resolver';

export interface ChatOptions {
  rootDir: string;
  context?: string;
  url?: string;
  message?: string;
  user?: string;
  dryRun?: boolean;
}

export class ChatController {
  constructor(private readonly options: ChatOptions);

  public async runInteractive(): Promise<void>;
  public async runOneShot(): Promise<void>;
  public disconnect(): void;
}
```

**oclif Command Signature**:
```typescript
// tools/brat/src/oclif-commands/chat.ts
import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { ChatController } from '../business/chat';

export default class Chat extends BratCommand {
  static override description = 'Interactive chat with platform via WebSocket gateway';

  static override flags = {
    ...BratCommand.baseFlags,
    url: Flags.string({ description: 'Gateway WebSocket URL', required: false }),
    message: Flags.string({ char: 'm', description: 'One-shot message (non-interactive)', required: false }),
    user: Flags.string({ char: 'u', description: 'User name', required: false }),
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

    if (flags.message) {
      await controller.runOneShot();
    } else {
      await controller.runInteractive();
    }
  }
}
```

---

## Summary Table

| Command | Pattern | Business Logic Location | Status | Extraction Required |
|---------|---------|-------------------------|--------|---------------------|
| docker up | Pattern 1 | orchestration/docker/orchestrator.ts | ✅ Ready | No |
| docker down | Pattern 1 | orchestration/docker/orchestrator.ts | ✅ Ready | No |
| docker logs | Pattern 1 | orchestration/docker/orchestrator.ts | ✅ Ready | No |
| docker ps | Pattern 1 | orchestration/docker/orchestrator.ts | ✅ Ready | No |
| chat | Pattern 2 | cli/chat.ts → business/chat.ts | ⚠️ Needs extraction | Yes (2-3h) |

---

## Implementation Order

### Phase 1: Extract ChatController (2-3h)
- Create business/chat.ts
- Move ChatController class
- Update cli/chat.ts imports
- Test legacy CLI

### Phase 2: Migrate docker commands (3-4h)
- docker up (1h)
- docker down (0.5h)
- docker logs (0.5h)
- docker ps (0.5h)
- Tests (1h)

### Phase 3: Migrate chat command (1h)
- Create oclif-commands/chat.ts
- Delegate to ChatController
- Tests (included in Phase 1)

### Phase 4: Testing & Validation (1h)
- All oclif tests passing
- Regression tests (legacy CLI)
- Smoke tests

---

## Risks & Mitigations

### Risk 1: WebSocket Lifecycle Management
**Risk**: WebSocket connection cleanup may not work correctly in oclif context
**Mitigation**: Use try/finally to ensure disconnect() is called
**Code Pattern**:
```typescript
const controller = new ChatController(options);
try {
  if (flags.message) {
    await controller.runOneShot();
  } else {
    await controller.runInteractive();
  }
} finally {
  controller.disconnect();
}
```

### Risk 2: Readline Interaction in oclif
**Risk**: Readline interface may conflict with oclif's CLI framework
**Mitigation**: ChatController already encapsulates readline logic; no changes needed
**Evidence**: Legacy CLI uses same ChatController implementation successfully

### Risk 3: Context Resolution
**Risk**: ContextResolver may not work correctly with BratCommand.context
**Mitigation**: BratCommand.context already resolves context via ContextResolver in init()
**Evidence**: All Sprint 362 commands successfully use this.context.name

---

## Success Criteria

1. ✅ ChatController extracted to business/chat.ts
2. ✅ Legacy CLI still works: `npm run brat -- chat`
3. ✅ All 5 oclif commands created
4. ✅ All oclif tests passing (206+ tests)
5. ✅ Zero regressions (Sprint 360-362 tests still pass)
6. ✅ Pattern consistency (4× Pattern 1, 1× Pattern 2)

---

**Document Version**: 1.0
**Last Updated**: 2026-07-25
**Status**: Planning Complete
