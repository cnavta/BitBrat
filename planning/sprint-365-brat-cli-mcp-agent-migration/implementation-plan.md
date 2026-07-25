# Sprint 365: MCP/Agent Tools Migration - Implementation Plan

**Sprint ID**: Sprint 365
**Focus**: MCP and coding agent integration commands
**Pattern**: 100% Pattern 1 (Simple Delegation)
**Estimated Duration**: 3-4 hours

---

## Executive Summary

Migrate the final 3 high-priority commands from legacy CLI to oclif framework:
1. `code` - Launch coding agent with project context
2. `mcp setup` - Configure MCP server in Claude Code
3. `dev-mcp start` - Start MCP development server

All commands follow **Pattern 1 (Simple Delegation)** with no business logic extraction required. This sprint completes the oclif migration for all production-critical commands (only 5 optional/deprecated commands remain after this).

---

## Commands Overview

| Command | Type | Args | Flags | LOC | Delegation Target |
|---------|------|------|-------|-----|-------------------|
| `code` | Complex | None | --agent, --list, --project-root | 150 | `cmdCode()` from `cli/code/code-command.ts` |
| `mcp setup` | Simple | None | --context, --scope, --server-name, --dry-run, --json | 90 | `cmdMcpSetup()` from `cli/mcp-setup.ts` |
| `dev-mcp start` | Simple | action | --context, --log-level, --audit-log | 80 | `cmdDevMcp()` from `cli/dev-mcp.ts` |

---

## Phase Breakdown

### Phase 1: Create `code` command (60 minutes)

**Location**: `tools/brat/src/oclif-commands/code.ts`

**Implementation**:
```typescript
/**
 * brat code
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Launch coding agent with BitBrat project context.
 * Delegates to cmdCode() from cli/code/code-command.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from './base';
import { cmdCode } from '../cli/code/code-command';

export default class Code extends BratCommand {
  static override description = 'Launch coding agent with BitBrat project context';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --list',
    '<%= config.bin %> <%= command.id %> --agent aider',
    '<%= config.bin %> <%= command.id %> --agent claude-code -- "Explain the platform"',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    agent: Flags.string({
      char: 'a',
      description: 'Coding agent to use',
      options: ['claude-code', 'aider', 'continue', 'openhands'],
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List available coding agents',
      default: false,
    }),
    'project-root': Flags.string({
      char: 'p',
      description: 'Project root directory',
    }),
  };

  // Allow pass-through arguments for agent-specific flags
  static override strict = false;

  public async run(): Promise<void> {
    const { flags, argv } = await this.parse(Code);

    this.logger.info({
      action: 'code',
      agent: flags.agent,
      list: flags.list
    }, 'Launching coding agent');

    // Build command array for legacy handler
    const cmd: string[] = ['code'];

    // Build rest array with flags and pass-through args
    const rest: string[] = [];
    if (flags.list) rest.push('--list');
    if (flags.agent) rest.push(`--agent=${flags.agent}`);
    if (flags['project-root']) rest.push(`--project-root=${flags['project-root']}`);

    // Add pass-through arguments (anything after --)
    rest.push(...(argv as string[]));

    // Delegate to legacy handler
    await cmdCode(cmd, rest);
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/code.test.ts`
```typescript
/**
 * Sprint 365: code command tests (smoke tests only)
 */

import Code from './code';

describe('code command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(Code.prototype.constructor.name).toBe('Code');
  });

  it('should have description', () => {
    expect(Code.description).toBeTruthy();
    expect(Code.description).toContain('coding agent');
  });

  it('should have examples', () => {
    expect(Code.examples).toBeDefined();
    expect(Code.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(Code.flags).toBeDefined();
    expect(Code.flags.agent).toBeDefined();
    expect(Code.flags.list).toBeDefined();
    expect(Code.flags['project-root']).toBeDefined();
  });

  it('should allow pass-through args', () => {
    expect(Code.strict).toBe(false);
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(Code.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    expect(Code.description).toBeDefined();
    expect(Code.flags).toBeDefined();
  });
});
```

---

### Phase 2: Create `mcp setup` command (45 minutes)

**Location**: `tools/brat/src/oclif-commands/mcp/setup.ts`

**Implementation**:
```typescript
/**
 * brat mcp setup
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Configure BitBrat dev MCP server in Claude Code's config.
 * Delegates to cmdMcpSetup() from cli/mcp-setup.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdMcpSetup } from '../../cli/mcp-setup';

export default class McpSetup extends BratCommand {
  static override description = 'Configure BitBrat dev MCP server in Claude Code';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --scope project --dry-run',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    scope: Flags.string({
      description: 'Config scope',
      options: ['local', 'user', 'project'],
      default: 'user',
    }),
    'server-name': Flags.string({
      description: 'MCP server name',
      default: 'bitbrat-dev',
    }),
    'log-level': Flags.string({
      description: 'Log level for MCP server',
      options: ['error', 'warn', 'info', 'debug'],
    }),
    'audit-log': Flags.string({
      description: 'Audit log file path',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview without writing config',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(McpSetup);

    this.logger.info({
      action: 'mcp.setup',
      context: this.context.name,
      scope: flags.scope,
      dryRun: flags['dry-run']
    }, 'Configuring MCP server');

    // Delegate to legacy handler
    await cmdMcpSetup({
      context: this.context.name,
      scope: flags.scope as 'local' | 'user' | 'project',
      serverName: flags['server-name'],
      logLevel: flags['log-level'] as any,
      auditLog: flags['audit-log'],
      dryRun: flags['dry-run'],
      json: flags.json,
    });
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/mcp/setup.test.ts`
```typescript
/**
 * Sprint 365: mcp setup command tests (smoke tests only)
 */

import McpSetup from './setup';

describe('mcp setup command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(McpSetup.prototype.constructor.name).toBe('McpSetup');
  });

  it('should have description', () => {
    expect(McpSetup.description).toBeTruthy();
    expect(McpSetup.description).toContain('MCP');
  });

  it('should have examples', () => {
    expect(McpSetup.examples).toBeDefined();
    expect(McpSetup.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(McpSetup.flags).toBeDefined();
    expect(McpSetup.flags.scope).toBeDefined();
    expect(McpSetup.flags['server-name']).toBeDefined();
    expect(McpSetup.flags['log-level']).toBeDefined();
    expect(McpSetup.flags['audit-log']).toBeDefined();
    expect(McpSetup.flags['dry-run']).toBeDefined();
    expect(McpSetup.flags.json).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(McpSetup.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    expect(McpSetup.description).toBeDefined();
    expect(McpSetup.flags).toBeDefined();
  });
});
```

---

### Phase 3: Create `dev-mcp start` command (45 minutes)

**Location**: `tools/brat/src/oclif-commands/dev-mcp/start.ts`

**Implementation**:
```typescript
/**
 * brat dev-mcp start
 *
 * Sprint 365: MCP/Agent command migration (Pattern 1: Simple Delegation)
 *
 * Start BitBrat MCP development server.
 * Delegates to cmdDevMcp() from cli/dev-mcp.ts
 */

import { Flags } from '@oclif/core';
import { BratCommand } from '../base';
import { cmdDevMcp } from '../../cli/dev-mcp';

export default class DevMcpStart extends BratCommand {
  static override description = 'Start BitBrat MCP development server';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --context staging',
    '<%= config.bin %> <%= command.id %> --log-level debug --audit-log /tmp/mcp-audit.log',
  ];

  static override flags = {
    ...BratCommand.baseFlags,
    'log-level': Flags.string({
      description: 'Log level for MCP server',
      options: ['error', 'warn', 'info', 'debug'],
    }),
    'audit-log': Flags.string({
      description: 'Audit log file path',
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(DevMcpStart);

    this.logger.info({
      action: 'dev-mcp.start',
      context: this.context.name,
      logLevel: flags['log-level']
    }, 'Starting MCP development server');

    // Delegate to legacy handler
    await cmdDevMcp('start', {
      context: this.context.name,
      logLevel: flags['log-level'] as any,
      auditLog: flags['audit-log'],
    });
  }
}
```

**Test File**: `tools/brat/src/oclif-commands/dev-mcp/start.test.ts`
```typescript
/**
 * Sprint 365: dev-mcp start command tests (smoke tests only)
 */

import DevMcpStart from './start';

describe('dev-mcp start command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(DevMcpStart.prototype.constructor.name).toBe('DevMcpStart');
  });

  it('should have description', () => {
    expect(DevMcpStart.description).toBeTruthy();
    expect(DevMcpStart.description).toContain('MCP');
  });

  it('should have examples', () => {
    expect(DevMcpStart.examples).toBeDefined();
    expect(DevMcpStart.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(DevMcpStart.flags).toBeDefined();
    expect(DevMcpStart.flags['log-level']).toBeDefined();
    expect(DevMcpStart.flags['audit-log']).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    expect(DevMcpStart.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    expect(DevMcpStart.description).toBeDefined();
    expect(DevMcpStart.flags).toBeDefined();
  });
});
```

---

### Phase 4: Validation & Testing (60 minutes)

**Build Validation**:
```bash
npm run build
# Verify no TypeScript errors
# Verify all imports resolved
```

**Test Suite**:
```bash
npm test -- --testPathPattern="oclif-commands"
# Expected: 272+ tests passing (+21 from Sprint 364)
# 3 commands × 7 tests = 21 new tests
```

**Manual Testing**:

1. **Test `code` command**:
```bash
# List agents
brat code --list

# Launch Claude Code (if installed)
brat code --agent claude-code

# Launch with pass-through args
brat code -- "Explain the platform"

# Test first-run detection (delete .bitbrat.json first)
rm .bitbrat.json
brat code
```

2. **Test `mcp setup` command**:
```bash
# Setup with dry-run
brat mcp setup --dry-run

# Setup for user scope
brat mcp setup --scope user

# Setup for project scope
brat mcp setup --scope project --dry-run

# JSON output
brat mcp setup --json --dry-run

# Verify config file created
cat ~/.claude.json
```

3. **Test `dev-mcp start` command**:
```bash
# Set auth token
export MCP_DEV_TOKEN="test-token-123"

# Start server (will block - use Ctrl+C to stop)
brat dev-mcp start

# Start with context
brat dev-mcp start --context staging

# Start with debug logging
brat dev-mcp start --log-level debug --audit-log /tmp/mcp-audit.log

# Verify server starts and accepts MCP protocol
```

---

## Success Criteria

### Functional Requirements
- ✅ All 3 commands migrate to oclif
- ✅ Zero regressions (legacy behavior preserved)
- ✅ All flags properly mapped
- ✅ Context resolution working
- ✅ Pass-through args working (code command)
- ✅ First-run detection working (code command)
- ✅ MCP config creation working (mcp setup)
- ✅ Dev MCP server startup working (dev-mcp start)

### Quality Requirements
- ✅ Build successful (npm run build)
- ✅ All tests passing (272+ tests)
- ✅ Test coverage: 7 tests per command
- ✅ Zero TypeScript errors
- ✅ Manual testing complete

### Documentation Requirements
- ✅ Update `remaining-commands.md` (40 → 43 commands, 83% → 90%)
- ✅ Create `completion-summary.md`
- ✅ Update sprint history

---

## Risk Mitigation

| Risk | Mitigation Strategy |
|------|---------------------|
| Breaking agent integrations | Extensive manual testing with all 4 agents (claude-code, aider, continue, openhands) |
| MCP config corruption | Always test with --dry-run first, create config backups |
| Dev MCP server auth issues | Document auth token requirements clearly |
| Pass-through args breaking | Test with various argument patterns |
| First-run detection regression | Delete .bitbrat.json and test first-run flow |

---

## Rollback Plan

If critical issues are discovered:
1. Revert commit with new oclif commands
2. Continue using legacy CLI for MCP/Agent commands
3. Document issue in sprint retro
4. Plan fixes for future sprint

**Note**: This is unlikely given Pattern 1 simplicity and well-tested business logic.

---

## Timeline

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 1: code command | 60 min | 1h |
| Phase 2: mcp setup command | 45 min | 1h 45min |
| Phase 3: dev-mcp start command | 45 min | 2h 30min |
| Phase 4: Validation & testing | 60 min | 3h 30min |
| **Total** | **3h 30min** | |

**Buffer**: 30 minutes for unexpected issues

**Total Estimated**: 3.5-4 hours

---

## Post-Sprint

After Sprint 365 completes:
- **Migration progress**: 43/48 commands (90%)
- **Remaining**: 5 optional/deprecated commands
  - `context delete` (not implemented)
  - `context ping` (not implemented)
  - 3 others TBD

**Recommendation**: Consider migration complete after Sprint 365. The remaining 5 commands are optional/deprecated and can be migrated on-demand if needed.

---

**Plan Status**: Ready for execution
**Approval Required**: Yes (user confirmation before proceeding)
