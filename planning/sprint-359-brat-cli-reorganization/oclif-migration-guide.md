# oclif Migration Guide: Architectural Patterns & Implementation Reference

**Sprint**: 359
**Author**: Architect
**Audience**: AI agents and developers implementing the brat → oclif migration
**Date**: 2026-07-24

---

## Purpose

This document provides comprehensive architectural guidance for migrating the BitBrat CLI (`brat`) from its current custom implementation to oclif. Any agent (AI or human) implementing this migration MUST read and reference this document throughout the implementation.

**Key Goals**:
1. **Preserve all existing functionality** - Zero behavior changes except where explicitly documented
2. **Maintain backward compatibility** - Old command paths must work with deprecation warnings
3. **Improve maintainability** - Leverage oclif patterns for better code organization
4. **Enable future extensibility** - Plugin system, testing framework, auto-help

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [oclif Core Concepts](#oclif-core-concepts)
3. [Migration Patterns by Command Type](#migration-patterns-by-command-type)
4. [Critical Patterns to Preserve](#critical-patterns-to-preserve)
5. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
6. [Testing Strategy](#testing-strategy)
7. [Phase-by-Phase Implementation](#phase-by-phase-implementation)
8. [Reference Examples](#reference-examples)

---

## Current Architecture Analysis

### File Structure (Current)

```
tools/brat/
├── src/
│   ├── cli/
│   │   ├── index.ts              # 1,234-line monolithic router
│   │   ├── fleet.ts              # Fleet commands + logic
│   │   ├── docker.ts             # Docker delegation
│   │   ├── setup.ts              # Setup command logic
│   │   ├── seed.ts               # Seed command logic
│   │   └── ...                   # 15+ command files
│   ├── commands/
│   │   ├── context/
│   │   │   ├── list.ts           # executeContextList()
│   │   │   ├── show.ts           # executeContextShow()
│   │   │   └── create.ts         # executeContextCreate()
│   │   └── ...
│   ├── orchestration/
│   │   ├── logger.ts             # Pino logger factory
│   │   ├── errors.ts             # Custom error types
│   │   └── ...
│   ├── context/
│   │   ├── context-resolver.ts   # Execution context resolution
│   │   └── ...
│   ├── fleet/
│   │   ├── index.ts              # Fleet client/transport
│   │   └── ...
│   └── config/
│       └── loader.ts             # architecture.yaml loading
└── package.json
```

### Key Architecture Patterns (Current)

#### 1. Command Routing Pattern

```typescript
// tools/brat/src/cli/index.ts
async function main() {
  const { cmd, flags, rest } = parseArgs(process.argv);
  const [c1, c2, c3] = cmd;

  if (c1 === 'fleet') {
    const { cmdFleet } = require('./fleet');
    await cmdFleet(cmd, rest, flags);
    return;
  }

  if (c1 === 'context') {
    if (c2 === 'list') {
      const { executeContextList } = require('../commands/context/list');
      await executeContextList({ format: flags.json ? 'json' : 'table' });
      return;
    }
  }

  // ... 1,200 more lines
}
```

**Issues**:
- Deeply nested if/else chains (up to 5 levels)
- Mixed concerns (routing + parsing + validation)
- No type safety for command arguments
- Hard to test in isolation

#### 2. Manual Argument Parsing Pattern

```typescript
// tools/brat/src/cli/fleet.ts
export function parseFleetArgs(cmd: string[], rest: string[], flags: any): FleetArgs {
  const m: Record<string, string> = {};
  for (const r of rest) {
    if (!r.startsWith('-')) continue;
    const [k, v] = r.split('=');
    const key = k.replace(/^--?/, '');
    m[key] = v !== undefined ? v : 'true';
  }
  return {
    sub: cmd[1] || '',
    positionals: cmd.slice(2),
    all: rest.includes('--all') || m['all'] === 'true',
    confirm: rest.includes('--confirm'),
    json: !!flags?.json,
    // ... 20+ more manual parsing rules
  };
}
```

**Issues**:
- No type validation
- Typos silently ignored
- Inconsistent boolean/string handling
- No default values enforcement

#### 3. Manual Help Text Pattern

```typescript
// tools/brat/src/cli/fleet.ts
const FLEET_HELP = `brat fleet — drive the universal bit.* control plane

Usage:
  brat fleet list
  brat fleet info [<bit> | --all]

... (50+ lines of manual text)
`;

// In command handler
if (args.sub === '' || args.sub === 'help') {
  console.log(FLEET_HELP);
  process.exit(0);
}
```

**Issues**:
- Gets out of sync with actual flags
- No auto-generation from code
- Inconsistent formatting across commands
- Hard to maintain

#### 4. Dependency Injection Pattern (Fleet Commands)

```typescript
// tools/brat/src/cli/fleet.ts
export interface FleetDeps {
  resolveIdentityFn?: (...) => FleetIdentity;
  gatewayTransportFactory?: (...) => FleetTransport;
  registryFactory?: (...) => RegistryReader;
  out?: (line: string) => void;
}

export async function cmdFleet(
  cmd: string[],
  rest: string[],
  flags: any,
  deps: FleetDeps = {}
) {
  const identity = (deps.resolveIdentityFn || resolveIdentity)(...);
  const transport = (deps.gatewayTransportFactory || GatewayTransport)(...);
  // ... testable business logic
}
```

**Strengths**:
- ✅ Testable without network/Firestore
- ✅ Clear separation of concerns
- ✅ Well-documented dependencies

**Must Preserve**: This pattern is excellent and should be maintained in oclif migration.

#### 5. Execution Context Pattern

```typescript
// commands/context/list.ts
export async function executeContextList(options: ContextListOptions = {}) {
  const repoRoot = process.cwd();
  const resolver = new ContextResolver(repoRoot);

  const contexts = await resolver.listContexts();
  const currentContext = getCurrentContext() || 'local';

  // Business logic...
}
```

**Strengths**:
- ✅ Clean separation: CLI interface vs business logic
- ✅ Testable (pure function with options)
- ✅ Reusable (could be called from API)

**Must Preserve**: Keep `execute*` functions as business logic layer.

#### 6. Logging Pattern

```typescript
// orchestration/logger.ts
export function createLogger(opts: LoggerOptions = {}) {
  const level = opts.level || process.env.LOG_LEVEL || 'info';
  const pretty = opts.pretty ?? (process.env.NODE_ENV !== 'production');
  return pino({ level, base: opts.base, transport: ... });
}

// Usage in commands
const log = createLogger({ base: { runId: RUN_ID, component: 'brat' } });
log.info({ service: 'fleet' }, 'Listing services');
```

**Strengths**:
- ✅ Structured logging with pino
- ✅ Pretty printing in development
- ✅ Contextual metadata (runId, component)

**Must Preserve**: Continue using pino, integrate with oclif logger.

---

## oclif Core Concepts

### 1. Command Class Structure

Every oclif command is a TypeScript class extending `Command`:

```typescript
import {Command, Flags} from '@oclif/core';

export default class FleetList extends Command {
  // Metadata (auto-generates help)
  static description = 'List all active Bits in the fleet';

  static examples = [
    '$ brat fleet list',
    '$ brat fleet list --json',
  ];

  // Flag definitions (with validation)
  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  // Args (positional parameters)
  static args = {};

  // Execution method
  async run() {
    const {flags} = await this.parse(FleetList);

    // Business logic
    await executeFleetList({ json: flags.json });
  }
}
```

**Key Benefits**:
- ✅ Help auto-generated from metadata
- ✅ Flags auto-validated by type
- ✅ TypeScript type safety throughout
- ✅ Clear separation: metadata vs logic

### 2. File → Command Mapping

oclif auto-discovers commands from file structure:

```
src/commands/
├── fleet/
│   ├── list.ts          → brat fleet list
│   ├── info.ts          → brat fleet info
│   └── config.ts        → brat fleet config
├── deploy/
│   ├── service.ts       → brat deploy service
│   └── docker/
│       └── up.ts        → brat deploy docker up
└── setup.ts             → brat setup
```

**File = Command**: No routing table needed, structure IS the API.

### 3. Flag Types & Validation

```typescript
static flags = {
  // String flag (required)
  context: Flags.string({
    description: 'Execution context name',
    required: true,
  }),

  // String with choices (enum)
  level: Flags.string({
    description: 'Log level',
    options: ['error', 'warn', 'info', 'debug'],
    default: 'info',
  }),

  // Boolean flag
  'dry-run': Flags.boolean({
    description: 'Preview without executing',
    default: false,
  }),

  // Custom parser
  port: Flags.custom({
    parse: async (input) => {
      const num = parseInt(input, 10);
      if (isNaN(num) || num < 1024 || num > 65535) {
        throw new Error('Port must be between 1024-65535');
      }
      return num;
    },
  })(),
};
```

**Validation**: Happens before `run()`, so business logic receives clean data.

### 4. Base Command Pattern

Create a custom base class for shared behavior:

```typescript
// src/base-command.ts
import {Command} from '@oclif/core';
import {createLogger, Logger} from './orchestration/logger';

export default abstract class BratCommand extends Command {
  protected logger!: Logger;

  async init() {
    await super.init();

    // Initialize logger with runId context
    this.logger = createLogger({
      base: {
        runId: this.config.runId,
        component: 'brat',
        command: this.id,
      },
    });
  }

  // Helper: Get current execution context
  protected getCurrentContext(): string {
    const {getCurrentContext} = require('./config/bratrc');
    return getCurrentContext() || 'local';
  }

  // Helper: Resolve context
  protected getContextResolver() {
    const {ContextResolver} = require('./context/context-resolver');
    return new ContextResolver(process.cwd());
  }

  // Error handling
  catch(error: Error) {
    this.logger.error({err: error}, 'Command failed');
    throw error;
  }
}
```

**Usage**:
```typescript
import BratCommand from '../../base-command';

export default class FleetList extends BratCommand {
  async run() {
    this.logger.info('Listing fleet services');
    // this.logger available
    // this.getCurrentContext() available
  }
}
```

### 5. Hooks Pattern

oclif hooks run before/after commands:

```typescript
// src/hooks/deprecation.ts
import {Hook} from '@oclif/core';

export const hook: Hook<'prerun'> = async function (opts) {
  // Deprecation warnings for old command paths
  const aliases: Record<string, string> = {
    'apis': 'infra gcp apis',
    'trigger': 'infra gcp trigger',
  };

  const oldCommand = opts.Command.id;
  if (aliases[oldCommand]) {
    this.warn(`DEPRECATED: 'brat ${oldCommand}' is deprecated.`);
    this.warn(`Use: 'brat ${aliases[oldCommand]}' instead.`);
    this.warn('This alias will be removed in Sprint 365.\n');
  }
};
```

**Hook Types**:
- `init`: Before oclif initialization
- `prerun`: Before command runs (perfect for deprecation warnings)
- `postrun`: After successful command execution
- `command_not_found`: When command doesn't exist (perfect for helpful errors)

### 6. Plugin System

oclif supports plugins for extensibility:

```typescript
// Future: Allow community extensions
$ brat plugin install @bitbrat/slack-connector
$ brat slack send --channel #alerts --message "Deploy complete"
```

**Not needed for Sprint 359**, but architecture must support it.

---

## Migration Patterns by Command Type

### Pattern 1: Simple Standalone Command

**Example**: `brat setup`, `brat doctor`, `brat release`

**Current**:
```typescript
// cli/setup.ts
export async function cmdSetup(flags: any) {
  const projectId = await promptProjectId();
  const openaiKey = await promptOpenAIKey();
  // ... business logic
}

// cli/index.ts
if (c1 === 'setup') {
  await cmdSetup(flags);
  return;
}
```

**oclif Migration**:
```typescript
// src/commands/setup.ts
import {Command, Flags} from '@oclif/core';
import BratCommand from '../base-command';
import {executeSetup, SetupOptions} from '../business/setup';

export default class Setup extends BratCommand {
  static description = 'Interactive platform setup (first-time configuration)';

  static examples = [
    '$ brat setup',
    '$ brat setup --project-id my-project --openai-key sk-xxx',
  ];

  static flags = {
    'project-id': Flags.string({
      description: 'GCP project ID',
    }),
    'openai-key': Flags.string({
      description: 'OpenAI API key',
    }),
    'bot-name': Flags.string({
      description: 'Bot display name',
      default: 'BitBrat',
    }),
  };

  async run() {
    const {flags} = await this.parse(Setup);

    this.logger.info('Starting platform setup');

    // Delegate to business logic (preserve existing function!)
    await executeSetup({
      projectId: flags['project-id'],
      openaiKey: flags['openai-key'],
      botName: flags['bot-name'],
    });
  }
}

// src/business/setup.ts (refactored from cli/setup.ts)
export interface SetupOptions {
  projectId?: string;
  openaiKey?: string;
  botName?: string;
}

export async function executeSetup(options: SetupOptions) {
  // ALL existing setup logic moves here unchanged
  // This remains testable, reusable business logic
}
```

**Migration Steps**:
1. Create `src/commands/setup.ts` with Command class
2. Extract business logic to `src/business/setup.ts` as `executeSetup()`
3. Define flags in Command class (replaces manual parsing)
4. Call business logic from `run()` method
5. Test both CLI and business logic independently

---

### Pattern 2: Multi-Subcommand with Shared Logic

**Example**: `brat fleet list|info|health|config|...`

**Current**:
```typescript
// cli/fleet.ts
export async function cmdFleet(cmd: string[], rest: string[], flags: any, deps: FleetDeps = {}) {
  const args = parseFleetArgs(cmd, rest, flags);

  if (args.sub === 'list') {
    // list logic
  } else if (args.sub === 'info') {
    // info logic
  } else if (args.sub === 'config') {
    // config logic
  }
  // ... 500+ lines
}
```

**oclif Migration**:

**Option A: Separate Command Files (Recommended)**
```typescript
// src/commands/fleet/list.ts
import {Command, Flags} from '@oclif/core';
import BratCommand from '../../base-command';
import {FleetClient} from '../../fleet';

export default class FleetList extends BratCommand {
  static description = 'List all active Bits in the fleet';

  static flags = {
    json: Flags.boolean({description: 'Output as JSON'}),
  };

  async run() {
    const {flags} = await this.parse(FleetList);

    // Use shared business logic
    const client = this.getFleetClient();
    const bits = await client.list();

    if (flags.json) {
      this.log(JSON.stringify(bits, null, 2));
    } else {
      this.printTable(bits);
    }
  }

  private printTable(bits: any[]) {
    // Table formatting logic
  }
}

// src/commands/fleet/info.ts
export default class FleetInfo extends BratCommand {
  static description = 'Get bit.info for specific Bit(s)';

  static flags = {
    all: Flags.boolean({description: 'Query all Bits'}),
    json: Flags.boolean({description: 'Output as JSON'}),
  };

  static args = {
    bit: Args.string({description: 'Bit name (required unless --all)'}),
  };

  async run() {
    const {args, flags} = await this.parse(FleetInfo);

    const client = this.getFleetClient();
    const result = flags.all
      ? await client.infoAll()
      : await client.info(args.bit!);

    this.log(flags.json ? JSON.stringify(result, null, 2) : this.formatInfo(result));
  }
}
```

**Shared Business Logic**:
```typescript
// src/base-command.ts
export default abstract class BratCommand extends Command {
  protected getFleetClient(deps?: FleetDeps): FleetClient {
    // Preserve dependency injection pattern!
    const {FleetClient, GatewayTransport} = require('./fleet');
    const {resolveIdentity} = require('./fleet/identity');

    return new FleetClient({
      transport: deps?.gatewayTransportFactory || new GatewayTransport(...),
      identity: deps?.resolveIdentityFn || resolveIdentity(...),
      logger: this.logger,
    });
  }
}
```

**Option B: Topic Command with Subcommands (Alternative)**
```typescript
// src/commands/fleet/index.ts
import {Command} from '@oclif/core';

export default class Fleet extends Command {
  static description = 'Fleet control plane operations';

  async run() {
    // Show help if no subcommand
    this._help();
  }
}

// Subcommands still in separate files
// src/commands/fleet/list.ts
// src/commands/fleet/info.ts
```

**Recommendation**: Use **Option A** (separate files). Cleaner, more testable, better help.

---

### Pattern 3: Commands with Complex Argument Parsing

**Example**: `brat fleet flags <bit> get|set --key --value`

**Current**:
```typescript
// Brittle manual parsing
const args = parseFleetArgs(cmd, rest, flags);
if (args.sub === 'flags') {
  const operation = args.positionals[1]; // 'get' or 'set'
  const bit = args.positionals[0];
  if (operation === 'set' && !args.value) {
    console.error('--value required for set');
    process.exit(1);
  }
}
```

**oclif Migration**:
```typescript
// src/commands/fleet/flags/get.ts
import {Command, Flags, Args} from '@oclif/core';

export default class FleetFlagsGet extends BratCommand {
  static description = 'Get feature flags for a Bit';

  static flags = {
    key: Flags.string({
      description: 'Specific flag key (omit to list all)',
    }),
    json: Flags.boolean({description: 'Output as JSON'}),
  };

  static args = {
    bit: Args.string({
      description: 'Bit name',
      required: true,
    }),
  };

  async run() {
    const {args, flags} = await this.parse(FleetFlagsGet);

    const client = this.getFleetClient();
    const result = flags.key
      ? await client.getFlag(args.bit, flags.key)
      : await client.getFlags(args.bit);

    this.log(flags.json ? JSON.stringify(result, null, 2) : this.formatFlags(result));
  }
}

// src/commands/fleet/flags/set.ts
export default class FleetFlagsSet extends BratCommand {
  static description = 'Set feature flag for a Bit (requires bit:operate)';

  static flags = {
    key: Flags.string({
      description: 'Flag key',
      required: true,
    }),
    value: Flags.string({
      description: 'Flag value',
      required: true,
    }),
  };

  static args = {
    bit: Args.string({
      description: 'Bit name',
      required: true,
    }),
  };

  async run() {
    const {args, flags} = await this.parse(FleetFlagsSet);

    const client = this.getFleetClient();
    await client.setFlag(args.bit, flags.key!, flags.value!);

    this.log(`Flag ${flags.key} set to ${flags.value} on ${args.bit}`);
  }
}
```

**Command Paths**:
- `brat fleet flags get <bit> [--key K]` → `src/commands/fleet/flags/get.ts`
- `brat fleet flags set <bit> --key K --value V` → `src/commands/fleet/flags/set.ts`

**Benefits**:
- ✅ Type-safe required flags
- ✅ Clear validation errors
- ✅ Auto-generated help per operation
- ✅ Each operation independently testable

---

### Pattern 4: Commands with Execution Context

**Example**: `brat context list|show|create|validate`

**Current**:
```typescript
// commands/context/list.ts
export async function executeContextList(options: ContextListOptions = {}) {
  const resolver = new ContextResolver(process.cwd());
  const contexts = await resolver.listContexts();
  // ... formatting logic
}
```

**oclif Migration**:
```typescript
// src/commands/context/list.ts
import {Command, Flags} from '@oclif/core';
import BratCommand from '../../base-command';
import {executeContextList, ContextListOptions} from '../../business/context/list';

export default class ContextList extends BratCommand {
  static description = 'List all execution contexts';

  static examples = [
    '$ brat context list',
    '$ brat context list --json',
  ];

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Show full details',
      default: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(ContextList);

    // Preserve existing business logic function!
    await executeContextList({
      format: flags.json ? 'json' : 'table',
      verbose: flags.verbose,
    });
  }
}

// src/business/context/list.ts (moved from commands/context/list.ts)
export interface ContextListOptions {
  format?: 'table' | 'json';
  verbose?: boolean;
}

export async function executeContextList(options: ContextListOptions = {}) {
  // EXACT same code as before
  // No changes to business logic!
}
```

**Key Principle**: CLI layer (Command class) is thin adapter. Business logic (`execute*` functions) is preserved unchanged.

---

### Pattern 5: Commands with Interactive Prompts

**Example**: `brat setup` (uses inquirer), `brat context create` (interactive wizard)

**Current**:
```typescript
// cli/setup.ts
import inquirer from 'inquirer';

export async function cmdSetup(flags: any) {
  if (!flags.projectId) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'projectId',
        message: 'GCP Project ID:',
      },
    ]);
    flags.projectId = answers.projectId;
  }
  // ... use flags.projectId
}
```

**oclif Migration**:
```typescript
// src/commands/setup.ts
import {Command, Flags} from '@oclif/core';
import BratCommand from '../base-command';
import inquirer from 'inquirer';

export default class Setup extends BratCommand {
  static flags = {
    'project-id': Flags.string({description: 'GCP project ID'}),
    'non-interactive': Flags.boolean({
      description: 'Skip prompts (requires all flags)',
      default: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(Setup);

    let projectId = flags['project-id'];

    // Interactive mode: prompt for missing values
    if (!projectId && !flags['non-interactive']) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectId',
          message: 'GCP Project ID:',
          validate: (input) => input.length > 0 || 'Project ID required',
        },
      ]);
      projectId = answers.projectId;
    }

    // Non-interactive mode: require all flags
    if (!projectId) {
      this.error('--project-id required in non-interactive mode');
    }

    // Execute setup with validated inputs
    await executeSetup({ projectId });
  }
}
```

**Pattern**: Interactive prompts in `run()`, business logic in `execute*()`.

---

### Pattern 6: Commands with Custom Help

**Example**: `brat fleet` (complex multi-subcommand help)

**Current**:
```typescript
const FLEET_HELP = `brat fleet — drive the universal bit.* control plane

Usage:
  brat fleet list
  brat fleet info [<bit> | --all]

... (manual 50-line help text)
`;
```

**oclif Migration**:

oclif auto-generates help, but you can customize:

```typescript
// src/commands/fleet/index.ts
import {Command} from '@oclif/core';

export default class Fleet extends Command {
  static description = 'Fleet control plane operations via universal bit.* tools';

  static examples = [
    {
      description: 'List all active Bits',
      command: '<%= config.bin %> <%= command.id %> list',
    },
    {
      description: 'Get info for specific Bit',
      command: '<%= config.bin %> <%= command.id %> info tool-gateway',
    },
    {
      description: 'Fan out info across all Bits',
      command: '<%= config.bin %> <%= command.id %> info --all',
    },
  ];

  async run() {
    // Just show help if no subcommand
    this._help();
  }
}
```

**Help Output** (auto-generated):
```
USAGE
  $ brat fleet

DESCRIPTION
  Fleet control plane operations via universal bit.* tools

EXAMPLES
  List all active Bits
    $ brat fleet list

  Get info for specific Bit
    $ brat fleet info tool-gateway

  Fan out info across all Bits
    $ brat fleet info --all
```

**For even more customization**:
```typescript
// src/commands/fleet/index.ts
static help = `
BRAT FLEET — Universal Bit Control Plane

The fleet command group drives the universal bit.* MCP tools across all Bits.
Default path is the tool-gateway fabric (ADR-003). Use --direct <bit> for
emergency break-glass access to a single Bit (audited).

AVAILABLE COMMANDS
  list              Enumerate live Bits
  info              Get bit.info (health snapshot)
  health            Get bit.health (diagnostic metrics)
  config            Get bit.config (effective configuration, redacted)
  flags             Feature flag management (get/set)
  log               Runtime log level control (requires bit:operate)
  drain             Graceful drain (requires bit:operate)
  shutdown          Shutdown Bit (requires bit:operate)

RBAC
  Read operations require bit:read
  Mutating operations require bit:operate
  Server-authoritative RBAC (brat never self-authorizes)

For detailed help on a subcommand:
  $ brat fleet <command> --help
`;
```

---

## Critical Patterns to Preserve

### 1. Dependency Injection for Testing

**Current Pattern** (fleet commands):
```typescript
export interface FleetDeps {
  resolveIdentityFn?: (...) => FleetIdentity;
  gatewayTransportFactory?: (...) => FleetTransport;
  out?: (line: string) => void;
}

export async function cmdFleet(cmd, rest, flags, deps: FleetDeps = {}) {
  const identity = (deps.resolveIdentityFn || resolveIdentity)(...);
  // ... testable with mocks
}
```

**oclif Migration**:
```typescript
// src/base-command.ts
export default abstract class BratCommand extends Command {
  protected deps: FleetDeps = {};

  // Injectable for testing
  protected getFleetClient(overrides?: FleetDeps): FleetClient {
    const deps = {...this.deps, ...overrides};
    return new FleetClient({
      transport: deps.gatewayTransportFactory || this.createGatewayTransport(),
      identity: deps.resolveIdentityFn || this.resolveIdentity(),
      logger: this.logger,
    });
  }
}

// In tests
import {Config} from '@oclif/core';
import FleetList from './fleet/list';

describe('fleet list', () => {
  it('calls gateway transport', async () => {
    const mockTransport = jest.fn();
    const command = new FleetList([], {} as Config);

    // Inject dependencies
    command.deps = {
      gatewayTransportFactory: () => mockTransport,
    };

    await command.run();

    expect(mockTransport).toHaveBeenCalled();
  });
});
```

**CRITICAL**: Do NOT lose testability during migration!

---

### 2. Pino Structured Logging

**Current Pattern**:
```typescript
const log = createLogger({ base: { runId: RUN_ID, component: 'brat' } });
log.info({ service: 'fleet', operation: 'list' }, 'Listing services');
```

**oclif Migration**:
```typescript
// src/base-command.ts
import {createLogger, Logger} from './orchestration/logger';

export default abstract class BratCommand extends Command {
  protected logger!: Logger;

  async init() {
    await super.init();

    // Initialize pino logger with context
    this.logger = createLogger({
      base: {
        runId: this.config.runId,
        component: 'brat',
        command: this.id, // 'fleet:list', 'context:show', etc.
      },
    });
  }
}

// Usage in commands
export default class FleetList extends BratCommand {
  async run() {
    this.logger.info({ operation: 'list' }, 'Listing fleet services');
    // ... business logic
  }
}
```

**CRITICAL**: Continue using pino, not oclif's built-in logger (which is just console.log wrapper).

---

### 3. Execution Context Resolution

**Current Pattern**:
```typescript
import { getCurrentContext } from './config/bratrc';
import { ContextResolver } from './context/context-resolver';

const currentContext = getCurrentContext() || 'local';
const resolver = new ContextResolver(process.cwd());
const resolved = await resolver.resolve(currentContext);
```

**oclif Migration**:
```typescript
// src/base-command.ts
export default abstract class BratCommand extends Command {
  protected getCurrentContext(): string {
    const {getCurrentContext} = require('./config/bratrc');
    return getCurrentContext() || 'local';
  }

  protected getContextResolver() {
    const {ContextResolver} = require('./context/context-resolver');
    return new ContextResolver(this.config.root);
  }

  protected async resolveContext(contextName?: string) {
    const name = contextName || this.getCurrentContext();
    const resolver = this.getContextResolver();
    return await resolver.resolve(name);
  }
}

// Usage in commands
export default class ContextShow extends BratCommand {
  static args = {
    context: Args.string({description: 'Context name'}),
  };

  async run() {
    const {args} = await this.parse(ContextShow);

    // Use helper from base class
    const resolved = await this.resolveContext(args.context);

    this.log(JSON.stringify(resolved, null, 2));
  }
}
```

**CRITICAL**: Preserve context resolution system unchanged.

---

### 4. Error Handling & Custom Errors

**Current Pattern**:
```typescript
// orchestration/errors.ts
export class ConfigurationError extends Error {
  name = 'ConfigurationError';
  exitCode = 2;
}

export class PermissionError extends Error {
  name = 'PermissionError';
  exitCode = 3;
}

// Usage
if (!hasPermission) {
  throw new PermissionError('Insufficient permissions for bit:operate');
}
```

**oclif Migration**:

oclif has built-in error handling, but preserve custom errors:

```typescript
// src/base-command.ts
import {ConfigurationError, PermissionError} from './orchestration/errors';

export default abstract class BratCommand extends Command {
  async catch(error: Error) {
    // Log error
    this.logger.error({err: error}, 'Command failed');

    // Handle custom error types
    if (error instanceof ConfigurationError) {
      this.error(error.message, {exit: 2});
    }

    if (error instanceof PermissionError) {
      this.error(error.message, {exit: 3});
    }

    // Re-throw for oclif's default handling
    throw error;
  }
}
```

**CRITICAL**: Preserve exit codes for CI/CD scripts that depend on them.

---

### 5. Global Flags (--context, --json, --dry-run)

**Current Pattern**:
```typescript
interface GlobalFlags {
  context?: string;
  json?: boolean;
  dryRun?: boolean;
  projectId?: string;
}
```

**oclif Migration**:

Define global flags in base class:

```typescript
// src/base-command.ts
export default abstract class BratCommand extends Command {
  static globalFlags = {
    context: Flags.string({
      description: 'Execution context (local, staging, prod)',
      env: 'BITBRAT_CONTEXT',
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

  // Merge global flags into command flags
  static baseFlags: any = BratCommand.globalFlags;
}

// Usage in commands
export default class Deploy extends BratCommand {
  static flags = {
    ...BratCommand.baseFlags, // Inherit global flags
    service: Flags.string({description: 'Service name'}),
  };

  async run() {
    const {flags} = await this.parse(Deploy);

    // Access global + local flags
    const context = flags.context;
    const dryRun = flags['dry-run'];
    const service = flags.service;
  }
}
```

**CRITICAL**: All commands must inherit global flags.

---

## Common Pitfalls & Solutions

### Pitfall 1: Breaking Backward Compatibility

**Problem**: Users have scripts calling `brat apis enable`, new command is `brat infra gcp apis enable`.

**Solution**: Alias system via hooks

```typescript
// src/hooks/aliases.ts
import {Hook} from '@oclif/core';

const aliases: Record<string, string> = {
  'apis': 'infra gcp apis',
  'trigger': 'infra gcp trigger',
  'pg:backup': 'data backup',
  'db:validate': 'data validate',
};

export const hook: Hook<'command_not_found'> = async function (opts) {
  const attempted = opts.id;
  const newCommand = aliases[attempted];

  if (newCommand) {
    this.warn(`DEPRECATED: 'brat ${attempted}' has moved.`);
    this.warn(`Use: 'brat ${newCommand}' instead.`);
    this.warn('');
    this.warn('Running new command for you this time...');
    this.warn('This alias will be removed in Sprint 365 (~2 months).\n');

    // Run new command
    await this.config.runCommand(newCommand, opts.argv);
    return;
  }

  // No alias found - let oclif show error
  throw opts.error;
};
```

**Register hook**:
```json
// package.json
{
  "oclif": {
    "hooks": {
      "command_not_found": "./dist/hooks/aliases"
    }
  }
}
```

---

### Pitfall 2: Losing Output Formatting

**Problem**: Current commands have custom table formatting. Don't want to rewrite.

**Solution**: Extract formatting to utilities, reuse from commands

```typescript
// src/utils/table.ts
export function formatTable(
  data: any[],
  columns: {key: string; header: string; width: number}[]
): string {
  // Preserve existing table formatting logic
  const header = columns.map(c => c.header.padEnd(c.width)).join(' ');
  const separator = '='.repeat(header.length);

  const rows = data.map(row =>
    columns.map(c => String(row[c.key] || '-').padEnd(c.width)).join(' ')
  );

  return [header, separator, ...rows].join('\n');
}

// Usage in oclif command
export default class FleetList extends BratCommand {
  async run() {
    const bits = await this.getFleetClient().list();

    const table = formatTable(bits, [
      {key: 'name', header: 'NAME', width: 20},
      {key: 'profile', header: 'PROFILE', width: 15},
      {key: 'exposure', header: 'EXPOSURE', width: 20},
    ]);

    this.log(table);
  }
}
```

**Alternative**: Use oclif's built-in table utility (cli-ux):

```typescript
import {CliUx} from '@oclif/core';

export default class FleetList extends BratCommand {
  async run() {
    const bits = await this.getFleetClient().list();

    CliUx.ux.table(bits, {
      name: {header: 'NAME'},
      profile: {header: 'PROFILE'},
      exposure: {header: 'EXPOSURE'},
    });
  }
}
```

---

### Pitfall 3: Test Suite Breaks

**Problem**: Existing tests call `cmdFleet(...)` directly. oclif commands are classes.

**Solution**: Preserve business logic layer, test that instead

**Before** (current):
```typescript
// fleet.test.ts
import {cmdFleet} from './fleet';

describe('fleet commands', () => {
  it('lists services', async () => {
    const mockOut = jest.fn();
    await cmdFleet(['fleet', 'list'], [], {}, {out: mockOut});
    expect(mockOut).toHaveBeenCalledWith(expect.stringContaining('tool-gateway'));
  });
});
```

**After** (oclif):
```typescript
// fleet/list.test.ts
import {Config} from '@oclif/core';
import FleetList from './list';

describe('fleet list', () => {
  it('lists services', async () => {
    const command = new FleetList([], {} as Config);

    // Inject mocked dependencies
    const mockTransport = {
      list: jest.fn().mockResolvedValue([{name: 'tool-gateway', profile: 'gateway'}]),
    };
    command.deps = {
      gatewayTransportFactory: () => mockTransport,
    };

    // Capture output
    const logs: string[] = [];
    command.log = (msg: string) => logs.push(msg);

    await command.run();

    expect(logs.join('\n')).toContain('tool-gateway');
  });
});
```

**OR** (better): Test business logic layer
```typescript
// business/fleet/list.test.ts
import {executeFleetList} from './list';

describe('executeFleetList', () => {
  it('formats service list', async () => {
    const output: string[] = [];
    await executeFleetList({
      json: false,
      transport: mockTransport,
      out: (line) => output.push(line),
    });

    expect(output.join('\n')).toContain('tool-gateway');
  });
});
```

**CRITICAL**: Don't test oclif mechanics (parsing, validation). Test business logic.

---

### Pitfall 4: Long-Running Commands Timeout

**Problem**: Commands like `brat docker up` run for minutes. oclif might timeout.

**Solution**: No timeout by default in oclif, but handle signals properly

```typescript
// src/commands/deploy/docker/up.ts
export default class DockerUp extends BratCommand {
  async run() {
    const {flags} = await this.parse(DockerUp);

    // Long-running operation
    const orchestrator = new DockerOrchestrator(flags);

    // Handle SIGINT gracefully
    process.on('SIGINT', async () => {
      this.log('\nShutting down gracefully...');
      await orchestrator.stop();
      process.exit(0);
    });

    await orchestrator.up();
  }
}
```

---

### Pitfall 5: Environment Variables Not Loading

**Problem**: Current code loads `.env` files automatically. oclif doesn't.

**Solution**: Load in base command init

```typescript
// src/base-command.ts
import * as dotenv from 'dotenv';
import * as path from 'path';

export default abstract class BratCommand extends Command {
  async init() {
    await super.init();

    // Load .env file from project root
    const envPath = path.join(this.config.root, '.env');
    dotenv.config({path: envPath});

    // Load .secure.local if exists
    const securePath = path.join(this.config.root, '.secure.local');
    dotenv.config({path: securePath});

    // Initialize logger AFTER env loaded
    this.logger = createLogger({...});
  }
}
```

---

## Testing Strategy

### Unit Testing Commands

```typescript
// tests/commands/fleet/list.test.ts
import {expect, test} from '@oclif/test';
import FleetList from '../../../src/commands/fleet/list';

describe('fleet:list', () => {
  test
    .stdout()
    .command(['fleet:list'])
    .it('lists services', ctx => {
      expect(ctx.stdout).to.contain('tool-gateway');
    });

  test
    .stdout()
    .command(['fleet:list', '--json'])
    .it('outputs JSON', ctx => {
      const output = JSON.parse(ctx.stdout);
      expect(output).to.be.an('array');
    });

  test
    .stderr()
    .command(['fleet:list', '--invalid-flag'])
    .catch(err => expect(err.message).to.contain('Unexpected argument'))
    .it('rejects invalid flags');
});
```

### Integration Testing Business Logic

```typescript
// tests/business/fleet/list.test.ts
import {executeFleetList} from '../../../src/business/fleet/list';

describe('executeFleetList', () => {
  it('formats table correctly', async () => {
    const output: string[] = [];

    await executeFleetList({
      json: false,
      transport: mockTransport,
      out: (line) => output.push(line),
    });

    expect(output.join('\n')).toMatchSnapshot();
  });

  it('outputs valid JSON', async () => {
    const output: string[] = [];

    await executeFleetList({
      json: true,
      transport: mockTransport,
      out: (line) => output.push(line),
    });

    const parsed = JSON.parse(output.join('\n'));
    expect(parsed).toHaveLength(3);
  });
});
```

---

## Phase-by-Phase Implementation

### Phase 0: Preparation (Before Sprint 359)

**Tasks**:
1. ✅ Install oclif dependencies
2. ✅ Setup bin/run entry point
3. ✅ Configure package.json for oclif
4. ✅ Create BratCommand base class
5. ✅ Document migration patterns (this document)

### Phase 1: Proof of Concept (Sprint 359 Week 1)

**Migrate 5 commands**:
1. `brat setup` → `src/commands/setup.ts`
2. `brat doctor` → `src/commands/doctor.ts`
3. `brat fleet list` → `src/commands/fleet/list.ts`
4. `brat config show` → `src/commands/config/show.ts`
5. `brat release` → `src/commands/release.ts`

**Success Criteria**:
- All 5 commands work identically to current
- Help auto-generates from metadata
- Tests pass for all 5
- Team comfortable with oclif patterns

### Phase 2: Bulk Migration (Sprint 360)

**Migrate remaining commands** in this order:

**Week 1: Infrastructure Domain**
- `infra plan/apply` → `src/commands/infra/{plan,apply}.ts`
- `cloud-run shutdown` → `src/commands/infra/gcp/cloud-run.ts`
- `trigger create/update/delete` → `src/commands/infra/gcp/trigger/{create,update,delete}.ts`
- `lb urlmap render/import` → `src/commands/infra/gcp/lb/urlmap/{render,import}.ts`
- `apis enable` → `src/commands/infra/gcp/apis.ts`

**Week 2: Data & Fleet Domains**
- `backup list/export/import` → `src/commands/data/backup/{list,export,import}.ts`
- `seed` → `src/commands/data/seed.ts`
- `migrate collection/all` → `src/commands/data/migrate/{collection,all}.ts`
- `db:validate` → `src/commands/data/validate.ts`
- Fleet remaining subcommands → `src/commands/fleet/{info,health,config,flags,log,drain,shutdown}.ts`

**Week 3: Dev & Deployment Domains**
- `chat` → `src/commands/dev/chat.ts`
- `code` → `src/commands/dev/code.ts`
- `mcp setup` + `dev-mcp start` → `src/commands/dev/mcp/{setup,start}.ts`
- `context list/show/create/validate` → `src/commands/dev/context/{list,show,create,validate}.ts`
- `use` → `src/commands/dev/context/use.ts`
- `current` → `src/commands/dev/context/current.ts`
- `docker up/down/logs/ps` → `src/commands/deploy/docker/{up,down,logs,ps}.ts`

### Phase 3: Polish (Sprint 361)

**Tasks**:
1. Deprecation hooks (command_not_found for aliases)
2. Comprehensive help text for all commands
3. Auto-completion (bash/zsh)
4. Performance optimization
5. Documentation updates

---

## Reference Examples

### Complete Example: fleet list

**Before** (current):
```typescript
// cli/fleet.ts (excerpt)
export async function cmdFleet(cmd: string[], rest: string[], flags: any, deps: FleetDeps = {}) {
  const args = parseFleetArgs(cmd, rest, flags);

  if (args.sub === 'list') {
    const log = createLogger({base: {component: 'fleet'}});
    const client = new FleetClient({...});
    const bits = await client.list();

    if (args.json) {
      console.log(JSON.stringify(bits, null, 2));
    } else {
      // Table formatting...
      console.log('NAME'.padEnd(20) + 'PROFILE'.padEnd(15));
      bits.forEach(bit => {
        console.log(bit.name.padEnd(20) + bit.profile.padEnd(15));
      });
    }
  }
}
```

**After** (oclif):
```typescript
// src/commands/fleet/list.ts
import {Command, Flags} from '@oclif/core';
import BratCommand from '../../base-command';
import {formatTable} from '../../utils/table';

export default class FleetList extends BratCommand {
  static description = 'List all active Bits in the fleet';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    ...BratCommand.baseFlags,
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async run() {
    const {flags} = await this.parse(FleetList);

    this.logger.info('Listing fleet services');

    try {
      const client = this.getFleetClient();
      const bits = await client.list();

      if (flags.json) {
        this.log(JSON.stringify(bits, null, 2));
      } else {
        const table = formatTable(bits, [
          {key: 'name', header: 'NAME', width: 20},
          {key: 'profile', header: 'PROFILE', width: 15},
          {key: 'exposure', header: 'EXPOSURE', width: 20},
        ]);
        this.log(table);
      }
    } catch (error) {
      this.logger.error({err: error}, 'Failed to list services');
      throw error;
    }
  }
}

// src/base-command.ts
export default abstract class BratCommand extends Command {
  protected logger!: Logger;
  protected deps: FleetDeps = {};

  static baseFlags = {
    context: Flags.string({
      description: 'Execution context',
      env: 'BITBRAT_CONTEXT',
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  async init() {
    await super.init();
    this.logger = createLogger({
      base: {
        runId: this.config.runId,
        component: 'brat',
        command: this.id,
      },
    });
  }

  protected getFleetClient(overrides?: FleetDeps): FleetClient {
    const deps = {...this.deps, ...overrides};
    const {FleetClient, GatewayTransport, resolveIdentity} = require('../fleet');

    return new FleetClient({
      transport: deps.gatewayTransportFactory || new GatewayTransport({
        baseUrl: process.env.TOOL_GATEWAY_URL || 'http://localhost:3000',
        identity: deps.resolveIdentityFn || resolveIdentity(),
        logger: this.logger,
      }),
      logger: this.logger,
    });
  }

  async catch(error: Error) {
    this.logger.error({err: error}, 'Command failed');
    throw error;
  }
}
```

**Test**:
```typescript
// tests/commands/fleet/list.test.ts
import {expect, test} from '@oclif/test';

describe('fleet:list', () => {
  test
    .stdout()
    .command(['fleet:list'])
    .it('lists services in table format', ctx => {
      expect(ctx.stdout).to.contain('NAME');
      expect(ctx.stdout).to.contain('PROFILE');
    });

  test
    .stdout()
    .command(['fleet:list', '--json'])
    .it('outputs JSON', ctx => {
      const output = JSON.parse(ctx.stdout);
      expect(output).to.be.an('array');
    });
});
```

---

## Checklist for Each Command Migration

Use this checklist when migrating each command:

- [ ] Create oclif Command class in correct directory
- [ ] Define static description, examples, flags, args
- [ ] Extract business logic to `src/business/` or preserve `execute*()` functions
- [ ] Implement `run()` method as thin adapter calling business logic
- [ ] Preserve dependency injection pattern if present
- [ ] Preserve pino logging (not oclif logger)
- [ ] Handle --json flag (inherit from baseFlags)
- [ ] Handle --context flag (inherit from baseFlags)
- [ ] Preserve error handling & exit codes
- [ ] Write/update unit tests for Command class
- [ ] Write/update tests for business logic
- [ ] Update any documentation referencing the command
- [ ] Test backward compatibility if command path changed
- [ ] Add deprecation warning if command path changed

---

## Conclusion

This guide provides the architectural foundation for migrating brat to oclif. Key principles:

1. **Preserve business logic** - Move, don't rewrite
2. **Maintain testability** - Dependency injection stays
3. **Keep structured logging** - Pino, not console.log
4. **Backward compatibility** - Aliases + deprecation warnings
5. **Incremental migration** - Proof of concept → bulk → polish

Any agent implementing this migration should refer to this document throughout implementation and raise questions if patterns are unclear.

---

**Next Steps**: Review this guide, then proceed to create Sprint 359 implementation plan.
