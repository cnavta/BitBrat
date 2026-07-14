# Coding Agent Plugins Development Guide

This guide covers how to create custom plugins for the `brat code` command, enabling support for new coding agents.

## Introduction

### Plugin Architecture Overview

The `brat code` command uses a plugin architecture to support multiple coding agents. Each plugin implements a standardized interface (`CodingAgentPlugin`) that handles:

1. **Detection**: Checking if the agent is installed on the system
2. **Configuration**: Generating agent-specific config with BitBrat context
3. **Launch**: Spawning the agent process with the prepared configuration
4. **Preflight** (optional): Pre-launch validation and checks

This architecture allows adding new agent support without modifying core `brat code` logic.

### When to Create a Custom Plugin

Create a custom plugin when:
- You want to use a coding agent not currently supported (Claude Code, Aider, Continue, OpenHands)
- You're developing a new coding agent and want BitBrat integration
- You need agent-specific customizations beyond what the default plugins provide
- You want to contribute new agent support to BitBrat

### Prerequisites

Before creating a plugin, ensure you have:
- **TypeScript knowledge**: Plugins are written in TypeScript
- **Node.js**: v24.x or higher
- **Target agent**: Installed and working on your system
- **BitBrat codebase**: Cloned and dependencies installed

---

## Plugin API Reference

### CodingAgentPlugin Interface

All plugins implement the `CodingAgentPlugin` interface:

```typescript
interface CodingAgentPlugin {
  /**
   * Unique identifier for this plugin.
   * Used for preference storage and agent selection.
   *
   * Examples: "claude-code", "aider", "continue", "openhands"
   */
  id: string;

  /**
   * Human-readable display name.
   * Shown in interactive agent selection UI.
   *
   * Examples: "Claude Code", "Aider", "Continue", "OpenHands"
   */
  name: string;

  /**
   * Detect if the agent is installed on the system.
   *
   * Returns detection result with:
   * - installed: boolean
   * - version: string (if detected)
   * - path: string (if detected)
   * - error: string (if detection failed)
   *
   * @returns Promise<AgentDetectionResult>
   */
  detect(): Promise<AgentDetectionResult>;

  /**
   * Prepare agent configuration with BitBrat project context.
   *
   * Receives ProjectContext with:
   * - projectRoot: string (absolute path to BitBrat)
   * - contextFiles: string[] (CLAUDE.md, architecture.yaml, etc.)
   * - mcpServers: MCPServerInfo[] (if MCP discovery enabled)
   *
   * Returns AgentConfig with agent-specific launch parameters.
   *
   * @param context - Project context information
   * @returns Promise<AgentConfig>
   */
  prepareConfig(context: ProjectContext): Promise<AgentConfig>;

  /**
   * Launch the agent with prepared configuration.
   *
   * Spawns the agent process and returns ChildProcess handle.
   * Should attach stdio to parent process for user interaction.
   *
   * @param config - Agent configuration from prepareConfig()
   * @param args - Additional arguments from user (via --)
   * @returns Promise<ChildProcess>
   */
  launch(config: AgentConfig, args: string[]): Promise<ChildProcess>;

  /**
   * Optional preflight checks before launch.
   *
   * Use for:
   * - Validating API keys
   * - Checking dependencies
   * - Verifying agent version compatibility
   * - Creating required directories
   *
   * Throw error if preflight fails to prevent launch.
   *
   * @returns Promise<void>
   */
  preflight?(): Promise<void>;
}
```

### Supporting Types

```typescript
interface AgentDetectionResult {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

interface ProjectContext {
  projectRoot: string;
  contextFiles: string[];
  mcpServers?: MCPServerInfo[];
}

interface AgentConfig {
  command: string;              // Agent executable path
  args: string[];               // Base arguments
  env?: Record<string, string>; // Environment variables
  cwd?: string;                 // Working directory
  configPath?: string;          // Generated config file path
}

interface MCPServerInfo {
  name: string;
  url: string;
  authToken?: string;
}
```

---

## Implementation Guide

### Step 1: Create Plugin File

Create a new file in `tools/brat/src/cli/code/plugins/`:

```typescript
// tools/brat/src/cli/code/plugins/my-agent-plugin.ts

import { CodingAgentPlugin, AgentDetectionResult, ProjectContext, AgentConfig } from '../types';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export class MyAgentPlugin implements CodingAgentPlugin {
  readonly id = 'my-agent';
  readonly name = 'My Agent';

  async detect(): Promise<AgentDetectionResult> {
    // Implementation in Step 2
  }

  async prepareConfig(context: ProjectContext): Promise<AgentConfig> {
    // Implementation in Step 3
  }

  async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
    // Implementation in Step 4
  }

  async preflight?(): Promise<void> {
    // Optional - Implementation in Step 5
  }
}
```

### Step 2: Implement Agent Detection

The `detect()` method checks if the agent is installed:

```typescript
async detect(): Promise<AgentDetectionResult> {
  try {
    // Strategy 1: Use 'which' to find agent in PATH
    const { stdout: whichOutput } = await execAsync('which my-agent');
    const agentPath = whichOutput.trim();

    if (!agentPath) {
      return { installed: false };
    }

    // Strategy 2: Get version
    try {
      const { stdout: versionOutput } = await execAsync('my-agent --version');
      const version = this.parseVersion(versionOutput);

      return {
        installed: true,
        version,
        path: agentPath
      };
    } catch (versionError) {
      // Agent exists but version check failed
      return {
        installed: true,
        path: agentPath,
        version: 'unknown'
      };
    }
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : 'Detection failed'
    };
  }
}

private parseVersion(output: string): string {
  // Example: "my-agent version 1.2.3" -> "1.2.3"
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : output.trim();
}
```

**Detection Strategies:**

1. **PATH lookup**: Use `which <agent>` (Unix) or `where <agent>` (Windows)
2. **Version check**: Execute `<agent> --version` to verify installation
3. **Version parsing**: Extract semantic version from output
4. **Fallback**: Return `installed: true` even if version unknown

**Best Practices:**
- Always handle errors gracefully
- Don't throw from `detect()` - return `{ installed: false, error: '...' }`
- Parse version flexibly (agents have inconsistent formats)
- Provide helpful error messages

### Step 3: Implement Configuration Preparation

The `prepareConfig()` method generates agent-specific configuration:

```typescript
async prepareConfig(context: ProjectContext): Promise<AgentConfig> {
  const { projectRoot, contextFiles } = context;

  // Example: Generate config file for agent
  const configPath = path.join(projectRoot, '.my-agent-config.json');
  const config = {
    projectRoot,
    contextFiles,
    model: 'default-model',
    // Add agent-specific settings
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  // Build command line arguments
  const args = [
    '--config', configPath,
    '--project', projectRoot,
  ];

  // Add context files as arguments (if agent supports it)
  for (const file of contextFiles) {
    args.push('--read', file);
  }

  return {
    command: 'my-agent',
    args,
    env: {
      // Optional environment variables
      MY_AGENT_PROJECT: projectRoot,
    },
    cwd: projectRoot,
    configPath,
  };
}
```

**Configuration Patterns:**

**Pattern 1: Config File Generation**
```typescript
// For agents that read config from JSON/YAML
const configPath = path.join(projectRoot, '.agent-config.json');
await fs.writeFile(configPath, JSON.stringify({
  contextFiles: context.contextFiles,
  model: 'default',
}));

return {
  command: 'agent',
  args: ['--config', configPath],
  configPath,
};
```

**Pattern 2: CLI Arguments**
```typescript
// For agents that accept context via flags
const args = ['--project', context.projectRoot];
for (const file of context.contextFiles) {
  args.push('--read', file);
}

return {
  command: 'agent',
  args,
};
```

**Pattern 3: Environment Variables**
```typescript
// For agents that read config from environment
return {
  command: 'agent',
  args: [],
  env: {
    AGENT_PROJECT_ROOT: context.projectRoot,
    AGENT_CONTEXT_FILES: context.contextFiles.join(':'),
  },
};
```

**Pattern 4: MCP Integration (Advanced)**
```typescript
// For agents that support MCP (like Claude Code)
if (context.mcpServers && context.mcpServers.length > 0) {
  const mcpConfig = this.generateMCPConfig(context.mcpServers);
  await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig));

  return {
    command: 'agent',
    args: ['--mcp-config', mcpConfigPath],
    env: {
      MCP_AUTH_TOKEN: context.mcpServers[0].authToken,
    },
  };
}
```

### Step 4: Implement Agent Launch

The `launch()` method spawns the agent process:

```typescript
async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
  // Merge user-provided args with config args
  const allArgs = [...config.args, ...args];

  // Spawn agent process
  const child = spawn(config.command, allArgs, {
    cwd: config.cwd || process.cwd(),
    env: {
      ...process.env,      // Inherit parent environment
      ...config.env,       // Add agent-specific env vars
    },
    stdio: 'inherit',      // Attach to parent stdio (interactive)
  });

  // Handle process events
  child.on('error', (error) => {
    console.error(`Failed to launch ${this.name}:`, error.message);
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${this.name} exited with code ${code}`);
    }
  });

  return child;
}
```

**Launch Patterns:**

**Pattern 1: Interactive (Inherit stdio)**
```typescript
// For agents that need user interaction
const child = spawn(command, args, {
  stdio: 'inherit',  // User can interact with agent
  cwd: projectRoot,
});
```

**Pattern 2: Piped (Capture output)**
```typescript
// For agents where you need to process output
const child = spawn(command, args, {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: projectRoot,
});

child.stdout?.on('data', (data) => {
  // Process agent output
  console.log(data.toString());
});
```

**Pattern 3: Detached (Background)**
```typescript
// For agents that should run in background
const child = spawn(command, args, {
  detached: true,
  stdio: 'ignore',
});

child.unref();  // Allow parent to exit
```

### Step 5: Implement Preflight Checks (Optional)

The `preflight()` method validates prerequisites before launch:

```typescript
async preflight(): Promise<void> {
  // Check 1: Validate API key
  if (!process.env.MY_AGENT_API_KEY) {
    throw new Error(
      'MY_AGENT_API_KEY environment variable is required.\n' +
      'Set it in your shell: export MY_AGENT_API_KEY=your-key-here'
    );
  }

  // Check 2: Verify agent version compatibility
  const result = await this.detect();
  if (result.version) {
    const minVersion = '1.0.0';
    if (this.compareVersions(result.version, minVersion) < 0) {
      throw new Error(
        `My Agent version ${result.version} is too old.\n` +
        `Minimum required: ${minVersion}\n` +
        'Upgrade: npm install -g my-agent@latest'
      );
    }
  }

  // Check 3: Create required directories
  const configDir = path.join(process.env.HOME!, '.my-agent');
  await fs.mkdir(configDir, { recursive: true });

  // Check 4: Verify dependencies
  try {
    await execAsync('which node');
  } catch {
    throw new Error('Node.js is required but not found in PATH');
  }
}

private compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) return aVal - bVal;
  }
  return 0;
}
```

**Preflight Checks Checklist:**
- ✅ API keys (if required)
- ✅ Version compatibility
- ✅ Required directories exist
- ✅ Dependencies available (node, python, etc.)
- ✅ Network connectivity (if needed)
- ✅ Config file permissions

---

## Complete Example: Custom Agent Plugin

Here's a complete plugin implementation:

```typescript
// tools/brat/src/cli/code/plugins/custom-ai-plugin.ts

import { CodingAgentPlugin, AgentDetectionResult, ProjectContext, AgentConfig } from '../types';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Plugin for Custom AI coding assistant.
 *
 * Features:
 * - Automatic context injection via config file
 * - Environment-based API key management
 * - Version validation
 */
export class CustomAIPlugin implements CodingAgentPlugin {
  readonly id = 'custom-ai';
  readonly name = 'Custom AI';

  async detect(): Promise<AgentDetectionResult> {
    try {
      const { stdout: whichOutput } = await execAsync('which custom-ai');
      const agentPath = whichOutput.trim();

      if (!agentPath) {
        return { installed: false };
      }

      try {
        const { stdout: versionOutput } = await execAsync('custom-ai --version');
        const version = this.parseVersion(versionOutput);

        return {
          installed: true,
          version,
          path: agentPath
        };
      } catch {
        return {
          installed: true,
          path: agentPath,
          version: 'unknown'
        };
      }
    } catch (error) {
      return {
        installed: false,
        error: error instanceof Error ? error.message : 'Detection failed'
      };
    }
  }

  async prepareConfig(context: ProjectContext): Promise<AgentConfig> {
    const { projectRoot, contextFiles } = context;

    // Generate config file
    const configDir = path.join(process.env.HOME!, '.custom-ai');
    await fs.mkdir(configDir, { recursive: true });

    const configPath = path.join(configDir, 'bitbrat-config.json');
    const config = {
      projectRoot,
      contextFiles,
      model: process.env.CUSTOM_AI_MODEL || 'default',
      systemPrompt: 'You are a helpful coding assistant for the BitBrat platform.',
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    return {
      command: 'custom-ai',
      args: ['--config', configPath, '--interactive'],
      env: {
        CUSTOM_AI_PROJECT: projectRoot,
      },
      cwd: projectRoot,
      configPath,
    };
  }

  async launch(config: AgentConfig, args: string[]): Promise<ChildProcess> {
    const allArgs = [...config.args, ...args];

    const child = spawn(config.command, allArgs, {
      cwd: config.cwd || process.cwd(),
      env: {
        ...process.env,
        ...config.env,
      },
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error(`Failed to launch ${this.name}:`, error.message);
    });

    return child;
  }

  async preflight(): Promise<void> {
    // Validate API key
    if (!process.env.CUSTOM_AI_API_KEY) {
      throw new Error(
        'CUSTOM_AI_API_KEY environment variable is required.\n' +
        'Get your API key from https://custom-ai.example.com/api-keys\n' +
        'Then set it: export CUSTOM_AI_API_KEY=your-key-here'
      );
    }

    // Check version compatibility
    const result = await this.detect();
    if (result.version && this.compareVersions(result.version, '2.0.0') < 0) {
      throw new Error(
        `Custom AI version ${result.version} is too old.\n` +
        'Minimum required: 2.0.0\n' +
        'Upgrade: pip install --upgrade custom-ai'
      );
    }
  }

  private parseVersion(output: string): string {
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.trim();
  }

  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) return aVal - bVal;
    }
    return 0;
  }
}
```

---

## Testing

### Unit Testing

Create test file: `tools/brat/src/cli/code/plugins/__tests__/my-agent-plugin.test.ts`

```typescript
import { MyAgentPlugin } from '../my-agent-plugin';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');

const execAsync = promisify(exec);

describe('MyAgentPlugin', () => {
  let plugin: MyAgentPlugin;

  beforeEach(() => {
    plugin = new MyAgentPlugin();
    jest.clearAllMocks();
  });

  describe('detect()', () => {
    it('should detect installed agent', async () => {
      (execAsync as jest.Mock)
        .mockResolvedValueOnce({ stdout: '/usr/local/bin/my-agent\n' })
        .mockResolvedValueOnce({ stdout: 'my-agent version 1.2.3\n' });

      const result = await plugin.detect();

      expect(result.installed).toBe(true);
      expect(result.version).toBe('1.2.3');
      expect(result.path).toBe('/usr/local/bin/my-agent');
    });

    it('should handle agent not installed', async () => {
      (execAsync as jest.Mock).mockRejectedValue(new Error('not found'));

      const result = await plugin.detect();

      expect(result.installed).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('prepareConfig()', () => {
    it('should generate valid config', async () => {
      const context = {
        projectRoot: '/path/to/BitBratPlatform',
        contextFiles: ['CLAUDE.md', 'README.md'],
      };

      const config = await plugin.prepareConfig(context);

      expect(config.command).toBe('my-agent');
      expect(config.args).toContain('--project');
      expect(config.cwd).toBe(context.projectRoot);
    });
  });

  describe('launch()', () => {
    it('should spawn agent process', async () => {
      const config = {
        command: 'my-agent',
        args: ['--interactive'],
        cwd: '/path/to/project',
      };

      const child = await plugin.launch(config, ['--extra-arg']);

      expect(child).toBeDefined();
      // Add more spawn assertions
    });
  });

  describe('preflight()', () => {
    it('should validate API key', async () => {
      delete process.env.MY_AGENT_API_KEY;

      await expect(plugin.preflight!()).rejects.toThrow('API_KEY');
    });

    it('should pass with valid environment', async () => {
      process.env.MY_AGENT_API_KEY = 'test-key';
      (execAsync as jest.Mock).mockResolvedValue({ stdout: '2.0.0' });

      await expect(plugin.preflight!()).resolves.not.toThrow();
    });
  });
});
```

### Integration Testing

Test your plugin end-to-end:

```bash
# 1. Build your plugin
npm run build

# 2. Register plugin (see Registration section)

# 3. Test detection
npm run brat -- code --list

# 4. Test launch
npm run brat -- code --agent my-agent

# 5. Test with custom flags
npm run brat -- code --agent my-agent -- --model advanced
```

### Manual Testing Checklist

- [ ] Agent detection works (`--list` shows your agent)
- [ ] Config generation creates valid files
- [ ] Agent launches successfully
- [ ] Context files are loaded by agent
- [ ] User can interact with agent
- [ ] Agent exits cleanly
- [ ] Preflight checks catch missing API keys
- [ ] Preflight checks catch version mismatches
- [ ] Preference persistence works (saved to ~/.bratrc)
- [ ] Custom flags pass through correctly

---

## Registration

### Add Plugin to Registry

Edit `tools/brat/src/cli/code/agent-registry.ts`:

```typescript
import { ClaudeCodePlugin } from './plugins/claude-code-plugin';
import { AiderPlugin } from './plugins/aider-plugin';
import { ContinuePlugin } from './plugins/continue-plugin';
import { OpenHandsPlugin } from './plugins/openhands-plugin';
import { MyAgentPlugin } from './plugins/my-agent-plugin';  // Add import

export class AgentRegistry {
  private plugins: Map<string, CodingAgentPlugin> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    this.register(new ClaudeCodePlugin());
    this.register(new AiderPlugin());
    this.register(new ContinuePlugin());
    this.register(new OpenHandsPlugin());
    this.register(new MyAgentPlugin());  // Register your plugin
  }

  register(plugin: CodingAgentPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  // ... rest of registry implementation
}
```

### Naming Conventions

**Plugin ID:**
- Lowercase, hyphen-separated
- Matches agent binary name when possible
- Examples: `claude-code`, `aider`, `my-agent`

**Plugin Class Name:**
- PascalCase, ends with `Plugin`
- Examples: `ClaudeCodePlugin`, `AiderPlugin`, `MyAgentPlugin`

**File Name:**
- Lowercase, hyphen-separated, ends with `-plugin.ts`
- Examples: `claude-code-plugin.ts`, `aider-plugin.ts`, `my-agent-plugin.ts`

---

## Contributing Your Plugin

### Submission Checklist

Before submitting a PR to add your plugin to BitBrat:

- [ ] Plugin implements full `CodingAgentPlugin` interface
- [ ] Detection works on macOS, Linux, and Windows
- [ ] Unit tests achieve >80% coverage
- [ ] Integration tests pass
- [ ] Documentation added to `coding-with-brat-code.md`
- [ ] Plugin follows naming conventions
- [ ] No hardcoded paths or credentials
- [ ] Graceful error handling
- [ ] Helpful error messages

### Pull Request Guidelines

1. **Branch naming**: `feature/add-<agent>-plugin`
2. **Commit message**: `feat(brat-code): Add <Agent> plugin support`
3. **PR description** should include:
   - Agent name and link to official site
   - Installation instructions
   - Unique features of this agent
   - Testing performed
   - Example usage

### Documentation Updates

When adding a plugin, update:

1. **README.md**: Add agent to Prerequisites section
2. **documentation/guides/coding-with-brat-code.md**:
   - Add to "Installing Coding Agents" section
   - Add to "Supported Agents" section
   - Add to feature comparison table
3. **CHANGELOG.md**: Add entry under `[Unreleased]`

---

## Advanced Topics

### MCP Integration

For agents that support MCP (Model Context Protocol):

```typescript
async prepareConfig(context: ProjectContext): Promise<AgentConfig> {
  if (context.mcpServers && context.mcpServers.length > 0) {
    // Generate MCP configuration
    const mcpConfig = {
      mcpServers: context.mcpServers.reduce((acc, server) => {
        acc[server.name] = {
          command: 'node',
          args: ['/path/to/stdio-proxy.js'],
          env: {
            MCP_SERVER_URL: server.url,
            MCP_AUTH_TOKEN: server.authToken,
          },
        };
        return acc;
      }, {} as Record<string, any>),
    };

    const mcpConfigPath = path.join(context.projectRoot, '.agent-mcp.json');
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    return {
      command: 'agent',
      args: ['--mcp-config', mcpConfigPath],
      env: {
        MCP_AUTH_TOKEN: context.mcpServers[0].authToken,
      },
    };
  }

  // Fallback for non-MCP configuration
  return this.prepareStandardConfig(context);
}
```

### Custom Preference Schema

Add agent-specific preferences to `~/.bratrc`:

```typescript
interface MyAgentPreferences {
  model?: string;
  temperature?: number;
  autoCommit?: boolean;
}

async prepareConfig(context: ProjectContext): Promise<AgentConfig> {
  // Load preferences
  const prefs = await this.loadPreferences();

  return {
    command: 'my-agent',
    args: [
      '--model', prefs.model || 'default',
      '--temperature', String(prefs.temperature || 0.7),
      prefs.autoCommit ? '--auto-commit' : '',
    ].filter(Boolean),
  };
}

private async loadPreferences(): Promise<MyAgentPreferences> {
  const bratrc = path.join(process.env.HOME!, '.bratrc');
  try {
    const content = await fs.readFile(bratrc, 'utf-8');
    const config = YAML.parse(content);
    return config.codingAgent?.plugins?.['my-agent'] || {};
  } catch {
    return {};
  }
}
```

### Platform-Specific Handling

Handle different operating systems:

```typescript
async detect(): Promise<AgentDetectionResult> {
  const command = process.platform === 'win32'
    ? 'where my-agent'      // Windows
    : 'which my-agent';     // macOS/Linux

  try {
    const { stdout } = await execAsync(command);
    const agentPath = stdout.trim().split('\n')[0];  // Windows may return multiple

    return {
      installed: true,
      path: agentPath,
    };
  } catch {
    return { installed: false };
  }
}
```

---

## Troubleshooting Plugin Development

### Common Issues

**Issue: Plugin not detected**
- Check registration in `agent-registry.ts`
- Verify plugin ID is unique
- Ensure `detect()` doesn't throw errors

**Issue: Config generation fails**
- Check file permissions
- Verify directory exists before writing
- Use `{ recursive: true }` when creating directories

**Issue: Agent doesn't receive context**
- Verify context files exist
- Check agent's method of reading context (config file, CLI args, env vars)
- Test agent outside of plugin to confirm expected format

**Issue: Preflight checks fail unexpectedly**
- Add detailed error messages
- Log environment state during development
- Test preflight independently

### Debugging Tips

**Enable verbose logging:**
```typescript
const DEBUG = process.env.DEBUG === 'true';

if (DEBUG) {
  console.log('[MyAgentPlugin] Detecting agent...');
  console.log('[MyAgentPlugin] Context:', context);
  console.log('[MyAgentPlugin] Config:', config);
}
```

**Test plugin in isolation:**
```typescript
// test-plugin.ts
import { MyAgentPlugin } from './my-agent-plugin';

async function test() {
  const plugin = new MyAgentPlugin();

  console.log('Testing detection...');
  const detection = await plugin.detect();
  console.log('Detection result:', detection);

  console.log('Testing config...');
  const config = await plugin.prepareConfig({
    projectRoot: process.cwd(),
    contextFiles: ['README.md'],
  });
  console.log('Config:', config);
}

test().catch(console.error);
```

**Check agent behavior:**
```bash
# Test agent directly with expected config
my-agent --config /tmp/test-config.json

# Check agent version format
my-agent --version

# Verify agent accepts flags
my-agent --help
```

---

## See Also

- [Coding with brat code](./coding-with-brat-code.md) - User guide
- [brat CLI Reference](../tools/brat.md#brat-code) - Command reference
- [Sprint 339 Technical Architecture](../../planning/sprint-339-brat-code-command/technical-architecture.md) - Plugin system design
- [CodingAgentPlugin Interface](../../tools/brat/src/cli/code/types.ts) - Full TypeScript interface

---

**Questions or Need Help?**

- Review existing plugins in `tools/brat/src/cli/code/plugins/` for reference
- Check [Sprint 339 execution plan](../../planning/sprint-339-brat-code-command/execution-plan.md) for design decisions
- File an issue on GitHub with `brat code` and `plugin` labels
