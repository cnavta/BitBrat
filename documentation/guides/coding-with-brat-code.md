# Coding with `brat code`

This guide covers everything you need to know about using `brat code` to explore and develop BitBrat with AI-powered coding assistance.

## Introduction

### What is `brat code`?

`brat code` is a unified CLI launcher that automatically detects installed coding agents on your system, configures them with full BitBrat project context, and launches them for AI-assisted codebase exploration and development.

Instead of manually configuring each coding agent with project-specific context files, model preferences, and MCP server connections, `brat code` does all of this automatically in a single command.

### Why use `brat code`?

**For new users:**
- **Zero configuration**: No setup files to create or edit
- **Guided introduction**: First run automatically explains BitBrat's architecture
- **Full context**: Agent has immediate access to CLAUDE.md, architecture.yaml, AGENTS.md, and README.md
- **MCP integration** (Claude Code): Automatic tool discovery and authentication

**For developers:**
- **Consistent experience**: Same workflow regardless of which agent you prefer
- **Preference memory**: Your choice is saved to `~/.bratrc` for future sessions
- **Multi-agent support**: Easily switch between Claude Code, Aider, Continue, or OpenHands
- **Pass-through flags**: Forward custom arguments to the underlying agent

### Comparison with other workflows

| Approach | Best For | Strengths | Limitations |
|----------|----------|-----------|-------------|
| **`brat code`** | Exploring codebase, understanding architecture, AI-assisted development | Full project context, MCP tool access, interactive exploration, zero config | Requires coding agent installed, agent-specific limitations |
| **`brat chat`** | Testing platform behavior, validating rules, end-to-end event flow | Tests real platform, validates routing, observes reactions | Requires platform running (Docker), focused on runtime behavior |
| **Direct IDE** | Traditional development, specific file edits, debugging | Full IDE features, debugger, git integration | No AI assistance, manual context gathering |

**Decision flowchart:**

```
Start
├─ Want to understand architecture? → brat code
├─ Want to test platform behavior? → brat chat
├─ Want to implement feature?
│  ├─ Need AI assistance? → brat code
│  └─ Know exactly what to do? → Direct IDE
└─ Want to debug runtime issue? → Direct IDE + brat chat
```

---

## Getting Started

### Installing Coding Agents

`brat code` supports four coding agents. You only need to install one:

#### Claude Code (Recommended)

Claude Code provides the best integration with BitBrat, including automatic MCP server configuration and tool discovery.

```bash
npm install -g @anthropic-ai/claude-code
```

**Requirements:**
- Node.js 24.x or higher
- `ANTHROPIC_API_KEY` environment variable (optional for first run, required for actual use)

**Verify installation:**
```bash
claude --version
```

#### Aider

Aider is a command-line coding assistant that works with multiple LLM providers.

```bash
pip install aider-chat
```

**Requirements:**
- Python 3.8 or higher
- API key for your chosen LLM provider (OpenAI, Anthropic, etc.)

**Verify installation:**
```bash
aider --version
```

#### Continue

Continue is a coding assistant with VSCode and JetBrains IDE integrations, plus a CLI mode.

```bash
npm install -g continue
```

**Requirements:**
- Node.js 24.x or higher

**Verify installation:**
```bash
continue --version
```

#### OpenHands

OpenHands is an open-source AI coding assistant.

```bash
pip install openhands
```

**Requirements:**
- Python 3.8 or higher

**Verify installation:**
```bash
openhands --version
```

### First Run Experience

When you run `brat code` for the first time:

1. **Agent Detection**: The tool scans your system for installed agents
2. **Interactive Selection**: If multiple agents are found, you'll be prompted to choose one
3. **Preference Saving**: Your choice is saved to `~/.bratrc` for future sessions
4. **Welcome Prompt**: The agent automatically receives the prompt: "Explain the BitBrat project to me"
5. **Interactive Tour**: You get a guided walkthrough of BitBrat's architecture with full codebase access

**Example first run:**

```bash
$ npm run brat -- code

Loading project context...
Preparing Claude Code configuration...
Launching Claude Code...

Welcome to BitBrat! Starting with an overview of the project...

[Agent launches and explains BitBrat architecture]
```

### Agent Selection UI

If you have multiple agents installed, you'll see an interactive selection menu:

```
? Which coding agent would you like to use?
❯ Claude Code (recommended) - Full MCP integration
  Aider - Multi-provider support
  Continue - IDE integration
  OpenHands - Open source

? Save this choice as your default? (Y/n)
```

Select your preferred agent using arrow keys and press Enter.

---

## Supported Agents

### Claude Code (Recommended)

Claude Code provides the deepest integration with BitBrat.

**Key Features:**
- **MCP Auto-Configuration**: Automatically discovers and configures MCP servers
- **Tool Discovery**: Enumerates all available MCP tools (bit.*, obs.*, image.*, story.*)
- **Authentication**: Manages MCP_AUTH_TOKEN automatically
- **stdio Proxy**: Configures proxy for tool-gateway communication

**Auto-Configuration Process:**

When you run `brat code` with Claude Code:

1. **Detect Environment**: Checks for running tool-gateway (Docker or direct)
2. **Generate Config**: Creates `.claude/config.json` with:
   - `mcpServers` block for BitBrat's tool-gateway
   - Authentication tokens
   - stdio proxy configuration
3. **Inject Context**: Adds BitBrat documentation files as `contextFiles`
4. **Launch**: Starts Claude Code with full context and tool access

**Generated Configuration Example:**

```json
{
  "model": "claude-sonnet-4.5",
  "maxTokens": 200000,
  "contextFiles": [
    "/path/to/BitBratPlatform/CLAUDE.md",
    "/path/to/BitBratPlatform/architecture.yaml",
    "/path/to/BitBratPlatform/AGENTS.md",
    "/path/to/BitBratPlatform/README.md"
  ],
  "mcpServers": {
    "bitbrat-tool-gateway": {
      "command": "node",
      "args": ["/path/to/mcp-stdio-proxy.js"],
      "env": {
        "MCP_AUTH_TOKEN": "auto-generated-token",
        "TOOL_GATEWAY_URL": "http://localhost:3010"
      }
    }
  }
}
```

### Aider

Aider is a terminal-based coding assistant that works with multiple LLM providers.

**Key Features:**
- **Context Injection**: Passes BitBrat docs via `--read` flags
- **Multi-Provider**: Supports OpenAI, Anthropic, OpenRouter, and more
- **Git Integration**: Automatic commit generation

**Configuration:**

Aider doesn't use a config file. Context is injected via CLI flags:

```bash
aider --read CLAUDE.md --read architecture.yaml --read AGENTS.md --read README.md
```

**Custom Flags:**

Pass custom flags through `brat code`:

```bash
npm run brat -- code --agent aider -- --model openrouter/anthropic/claude-3.5-sonnet
```

### Continue

Continue provides a CLI mode alongside IDE integrations.

**Key Features:**
- **Config Generation**: Creates `.continuerc.json` with BitBrat context
- **IDE Integration**: Can also be used in VSCode/JetBrains
- **Multiple Providers**: OpenAI, Anthropic, Ollama, and more

**Note:** Continue CLI support may vary. Check official documentation for latest status.

### OpenHands

OpenHands is an open-source AI coding assistant focused on autonomous task completion.

**Key Features:**
- **Environment-Based Config**: Uses environment variables for configuration
- **Open Source**: Fully transparent and customizable
- **Autonomous Execution**: Can complete tasks with minimal guidance

**Note:** OpenHands is under active development. Configuration may vary.

### Feature Comparison

| Feature | Claude Code | Aider | Continue | OpenHands |
|---------|-------------|-------|----------|-----------|
| **MCP Integration** | ✅ Full auto-config | ❌ | ❌ | ❌ |
| **Context Injection** | ✅ Auto | ✅ Manual flags | ✅ Config file | ✅ Env vars |
| **Multi-Provider** | ❌ Anthropic only | ✅ Many providers | ✅ Many providers | ✅ Multiple |
| **Git Integration** | ✅ | ✅ Auto-commit | ✅ | ✅ |
| **IDE Integration** | ❌ CLI only | ❌ CLI only | ✅ VSCode/JetBrains | ❌ CLI only |

---

## Features

### Auto-Detection

`brat code` automatically scans your system PATH for installed coding agents:

```bash
$ npm run brat -- code --list

Detected coding agents:
✓ Claude Code v1.0.0 at /usr/local/bin/claude
✓ Aider v0.42.0 at /usr/local/bin/aider

No agents detected for: continue, openhands
```

**Detection Process:**
1. Scan PATH for agent binaries (`claude`, `aider`, `continue`, `openhands`)
2. Execute `<agent> --version` to verify and extract version
3. Validate minimum version requirements (if any)
4. Return detection results

### Project Context Injection

All agents receive these BitBrat documentation files:

- **CLAUDE.md**: LLM-specific instructions and glossary
- **architecture.yaml**: Canonical system definition
- **AGENTS.md**: Collaboration protocol and sprint workflow
- **README.md**: Platform overview and quickstart

**How it works:**
- **Claude Code**: Added to `contextFiles` array in `.claude/config.json`
- **Aider**: Passed via `--read` flags
- **Continue**: Referenced in `.continuerc.json`
- **OpenHands**: Loaded via environment variables

### MCP Integration (Claude Code Only)

For Claude Code, `brat code` provides full MCP auto-configuration:

**1. Environment Detection:**
```typescript
// Checks for running tool-gateway
const toolGatewayRunning = await checkToolGatewayHealth();

// Checks for MCP servers in Docker
const mcpServers = await discoverMCPServers();
```

**2. Config Generation:**
```typescript
// Creates mcpServers block in .claude/config.json
{
  "mcpServers": {
    "bitbrat-tool-gateway": {
      "command": "node",
      "args": ["/path/to/mcp-stdio-proxy.js"],
      "env": {
        "MCP_AUTH_TOKEN": process.env.MCP_AUTH_TOKEN,
        "TOOL_GATEWAY_URL": "http://localhost:3010"
      }
    }
  }
}
```

**3. Tool Enumeration:**

Once connected, Claude Code can access all BitBrat MCP tools:
- `bit.info`, `bit.health`, `bit.config.get` (platform control plane)
- `obs.scene.list`, `obs.source.create` (OBS Studio control)
- `image.generate`, `image.variations` (DALL-E generation)
- `story.create`, `story.advance` (collaborative storytelling)

### Preference Persistence

Your agent choice is saved to `~/.bratrc`:

```yaml
version: 1
codingAgent:
  preferred: claude-code
  plugins:
    claude-code:
      model: claude-sonnet-4.5
    aider:
      model: openrouter/anthropic/claude-3.5-sonnet
```

**Subsequent runs:**

```bash
$ npm run brat -- code
# Automatically launches claude-code (your saved preference)
```

**Changing preferences:**

```bash
$ npm run brat -- code --agent aider
# Launches Aider and updates ~/.bratrc
```

### Flag Pass-Through

Forward arguments to the underlying agent:

```bash
# Pass --model opus to Claude Code
npm run brat -- code -- --model opus

# Pass multiple flags to Aider
npm run brat -- code --agent aider -- --model gpt-4 --no-git

# Note the double dash (--) before agent-specific flags
```

### First-Run Welcome

On first use (or when `~/.bitbrat-code-first-run` doesn't exist), `brat code` automatically provides a welcome prompt:

```
"Explain the BitBrat project to me"
```

This gives you an interactive introduction to:
- Platform architecture (perceive → plan → act → observe)
- Dual execution paths (Reflex deterministic vs LLM-based)
- MCP tool ecosystem
- Event-driven messaging
- Service organization (Platform vs Domain Bits)

**Disable welcome prompt:**

```bash
# Create marker file to skip welcome
touch ~/.bitbrat-code-first-run
```

---

## Configuration

### Preference File Format (~/.bratrc)

The preference file is YAML-formatted:

```yaml
version: 1

codingAgent:
  # Your preferred agent
  preferred: claude-code

  # Per-agent settings
  plugins:
    claude-code:
      model: claude-sonnet-4.5
      maxTokens: 200000

    aider:
      model: openrouter/anthropic/claude-3.5-sonnet
      auto_commits: true

    continue:
      provider: anthropic

    openhands:
      model: gpt-4
```

**Schema:**
- `version`: Config version (currently `1`)
- `codingAgent.preferred`: Default agent to launch
- `codingAgent.plugins.<agent>`: Agent-specific settings

**Editing:**

You can manually edit `~/.bratrc` to customize agent behavior. Changes take effect on next run.

**Resetting:**

```bash
rm ~/.bratrc
# Will be regenerated with defaults on next run
```

### Per-Agent Settings

#### Claude Code Settings

```yaml
plugins:
  claude-code:
    model: claude-sonnet-4.5    # or claude-opus-4.0
    maxTokens: 200000
    temperature: 0.7
```

#### Aider Settings

```yaml
plugins:
  aider:
    model: openrouter/anthropic/claude-3.5-sonnet
    auto_commits: true
    editor: vim
```

#### Continue Settings

```yaml
plugins:
  continue:
    provider: anthropic  # or openai, ollama, etc.
    model: claude-sonnet-4.5
```

#### OpenHands Settings

```yaml
plugins:
  openhands:
    model: gpt-4
    max_iterations: 50
```

### MCP Server Discovery

For Claude Code, `brat code` discovers MCP servers through:

**1. Docker Container Detection:**

```bash
# Lists MCP-enabled containers
docker ps --filter "label=mcp.enabled=true"
```

**2. tool-gateway Health Check:**

```bash
# Checks if tool-gateway is accessible
curl http://localhost:3010/health
```

**3. Environment Variables:**

```bash
# Looks for these variables
export TOOL_GATEWAY_URL=http://localhost:3010
export MCP_AUTH_TOKEN=your-token-here
```

**Manual Override:**

Set environment variables to force specific MCP configuration:

```bash
export TOOL_GATEWAY_URL=http://custom-host:3010
export MCP_AUTH_TOKEN=custom-token
npm run brat -- code
```

---

## Advanced Usage

### Switching Agents

Change agents anytime with the `--agent` flag:

```bash
# Currently using Claude Code (from ~/.bratrc)
npm run brat -- code

# Switch to Aider for this session
npm run brat -- code --agent aider

# Switch to Continue
npm run brat -- code --agent continue

# List available agents
npm run brat -- code --list
```

Your new choice will be saved to `~/.bratrc` and used for future sessions.

### Custom Flags

Each agent supports different flags. Use `--` to pass them through:

**Claude Code:**

```bash
# Use opus model
npm run brat -- code -- --model opus

# Use haiku for faster responses
npm run brat -- code -- --model haiku

# Custom max tokens
npm run brat -- code -- --max-tokens 100000
```

**Aider:**

```bash
# Use specific model
npm run brat -- code --agent aider -- --model gpt-4

# Disable auto-commits
npm run brat -- code --agent aider -- --no-auto-commits

# Use different editor
npm run brat -- code --agent aider -- --editor nvim
```

**Continue:**

```bash
# Use specific provider
npm run brat -- code --agent continue -- --provider ollama

# Use local model
npm run brat -- code --agent continue -- --model llama3
```

### Multiple Projects

Use `--project-root` to work with different BitBrat installations:

```bash
# Default: Uses current directory
npm run brat -- code

# Specific project
npm run brat -- code --project-root /path/to/BitBratPlatform

# Different BitBrat fork
npm run brat -- code --project-root ~/Projects/BitBrat-fork
```

**Use case:** Working on multiple BitBrat versions or forks simultaneously.

### Disabling MCP Auto-Configuration

If you want to manually configure MCP servers for Claude Code:

```bash
# Set environment variable
export BITBRAT_DISABLE_MCP_AUTO_CONFIG=true

# Launch without MCP auto-config
npm run brat -- code
```

Then manually edit `.claude/config.json` to add your own `mcpServers` configuration.

---

## Troubleshooting

### Agent Not Detected

**Symptoms:**
```
No coding agents detected on your system.

Please install one of the following:
  - Claude Code: https://docs.claude.com/claude-code
  - Aider: https://aider.chat
  ...
```

**Common Causes:**
1. Agent not installed
2. Agent not in PATH
3. Version too old (if minimum version required)

**Solutions:**

**Check Installation:**
```bash
# Claude Code
which claude
claude --version

# Aider
which aider
aider --version

# Continue
which continue
continue --version

# OpenHands
which openhands
openhands --version
```

**Add to PATH (macOS/Linux):**
```bash
# Find the agent
find ~ -name "claude" 2>/dev/null

# Add to PATH in ~/.zshrc or ~/.bashrc
export PATH="/path/to/agent/bin:$PATH"
source ~/.zshrc
```

**Reinstall:**
```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Aider
pip install --upgrade aider-chat
```

### MCP Connection Failed (Claude Code)

**Symptoms:**
```
Failed to connect to tool-gateway
MCP authentication failed
No MCP tools available
```

**Common Causes:**
1. tool-gateway not running
2. MCP_AUTH_TOKEN not set
3. Docker not running (for local development)

**Solutions:**

**1. Start tool-gateway:**
```bash
# Start full local stack
npm run local

# Verify tool-gateway is running
curl http://localhost:3010/health
```

**2. Check MCP_AUTH_TOKEN:**
```bash
# Check if set
echo $MCP_AUTH_TOKEN

# Set from .secure.local (after brat setup)
source .secure.local

# Or set manually
export MCP_AUTH_TOKEN=your-token-here
```

**3. Verify Docker:**
```bash
# Check Docker is running
docker ps

# If not running (macOS)
open -a Docker

# Wait for Docker to start, then:
npm run local
```

**4. Check tool-gateway logs:**
```bash
npm run local:logs | grep tool-gateway
```

### Preference File Errors

**Symptoms:**
```
Failed to load ~/.bratrc
Invalid YAML in preference file
Preference file corrupted
```

**Common Causes:**
1. Corrupted YAML syntax
2. Invalid agent name
3. Missing required fields

**Solutions:**

**Reset Preferences:**
```bash
# Delete corrupted file
rm ~/.bratrc

# Will be regenerated on next run
npm run brat -- code
```

**Validate YAML:**
```bash
# Check YAML syntax
python3 -c "import yaml; yaml.safe_load(open('~/.bratrc').read())"

# Or use online validator: https://www.yamllint.com/
```

**Manual Fix:**

Edit `~/.bratrc` and ensure it follows this structure:

```yaml
version: 1
codingAgent:
  preferred: claude-code  # Must be: claude-code, aider, continue, or openhands
  plugins:
    claude-code:
      model: claude-sonnet-4.5
```

### Agent-Specific Issues

#### Claude Code: API Key Missing

**Symptom:**
```
ANTHROPIC_API_KEY environment variable not set
```

**Solution:**
```bash
# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Or add to ~/.zshrc
echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.zshrc
source ~/.zshrc
```

#### Aider: Model Selection Errors

**Symptom:**
```
Unknown model: ...
API key not set for provider
```

**Solution:**
```bash
# Set provider API key (e.g., OpenRouter)
export OPENROUTER_API_KEY=sk-...

# Or use OpenAI
export OPENAI_API_KEY=sk-...

# Specify model explicitly
npm run brat -- code --agent aider -- --model openrouter/anthropic/claude-3.5-sonnet
```

#### Continue: CLI Not Available

**Symptom:**
```
continue: command not found
```

**Note:** Continue primarily integrates with IDEs. CLI mode may not be available in all versions.

**Solution:**
- Use Continue VSCode/JetBrains extension instead
- Or use Claude Code / Aider for CLI-based coding assistance

#### OpenHands: Installation Issues

**Symptom:**
```
openhands: command not found
pip install openhands fails
```

**Solution:**
- Check official OpenHands documentation for latest installation instructions
- May require specific Python version or system dependencies
- Consider using Docker-based OpenHands deployment

---

## Developer Guide

### Creating Custom Plugins

Want to add support for a new coding agent? See the [Coding Agent Plugins](./coding-agent-plugins.md) guide for:

- Plugin architecture overview
- `CodingAgentPlugin` interface reference
- Step-by-step plugin implementation
- Testing and registration
- Contributing your plugin to BitBrat

### Plugin API Summary

All plugins implement the `CodingAgentPlugin` interface:

```typescript
interface CodingAgentPlugin {
  id: string;                      // Unique identifier (e.g., "claude-code")
  name: string;                    // Display name (e.g., "Claude Code")

  detect(): Promise<AgentDetectionResult>;
  prepareConfig(context: ProjectContext): Promise<AgentConfig>;
  launch(config: AgentConfig, args: string[]): Promise<ChildProcess>;

  preflight?(): Promise<void>;    // Optional pre-launch checks
}
```

**Key Methods:**
- `detect()`: Check if agent is installed, return version info
- `prepareConfig()`: Generate agent configuration with BitBrat context
- `launch()`: Spawn agent process with prepared config
- `preflight()`: Optional - validate API keys, check dependencies, etc.

See the [plugin development guide](./coding-agent-plugins.md) for complete documentation.

---

## See Also

- [Coding Agent Plugins](./coding-agent-plugins.md) - Plugin development guide
- [brat CLI Reference](../tools/brat.md#brat-code) - Complete command reference
- [Quickstart Guide](../getting-started/quickstart.md) - Platform setup
- [CLAUDE.md](/CLAUDE.md) - LLM-specific instructions
- [AGENTS.md](/AGENTS.md) - Collaboration protocol

---

**Questions or Issues?**

- Check [Troubleshooting](#troubleshooting) section above
- Review [Sprint 339 verification report](../../planning/sprint-339-brat-code-command/verification-report.md) for known limitations
- File an issue on GitHub with `brat code` label
