# Technical Architecture: `brat code` Command - Unified Coding Agent Launcher

**Sprint:** 339
**Status:** Planning / Design
**Author:** AI Architect
**Date:** 2026-07-13
**Related Documents:**
- `CLAUDE.md` (Project instructions for Claude Code)
- `AGENTS.md` (LLM collaboration protocol)
- `tools/brat/src/cli/` (Existing CLI infrastructure)

---

## 1. Executive Summary

This document specifies the technical architecture for the **`brat code` command**, a unified launcher for CLI-based coding agents that provides a frictionless developer experience when working on the BitBrat platform. The command automatically detects installed coding agents, applies BitBrat-specific configuration, and launches the preferred agent with full project context.

**Core Principle:** Developers should type `brat code` and immediately get a coding assistant that "knows" BitBrat — its architecture, conventions, tooling, and current state — without manual configuration.

**Design Goals:**
1. **Zero-config experience:** Works out-of-the-box with sensible defaults
2. **Multi-agent support:** Extensible plugin architecture for any CLI coding agent
3. **Project-aware:** Auto-configures agents with BitBrat context (CLAUDE.md, architecture.yaml, etc.)
4. **MCP-enabled:** Auto-connects agents to BitBrat's MCP tool ecosystem (fleet control, domain tools)
5. **Preference persistence:** Remembers user's agent choice across sessions
6. **Graceful fallback:** Guides users to install an agent if none are detected

---

## 2. Context & Problem Statement

### 2.1 Current State

Developers working on BitBrat currently:
1. Manually launch their preferred coding agent (e.g., `claude code`, `aider`, `continue`)
2. May need to configure project-specific context manually
3. Must manually configure MCP servers to access BitBrat's tool ecosystem
4. Must remember agent-specific CLI flags and options
5. Have no standardized way to share agent configurations across the team

### 2.2 The Problem

**Friction in developer onboarding:**
- New contributors must discover which coding agent works best for BitBrat
- Each agent requires different setup and configuration
- Project-specific instructions (CLAUDE.md, AGENTS.md) may not be automatically loaded
- MCP servers must be manually configured to access BitBrat tools (fleet control, domain tools)
- No visibility into which coding agents are available/installed

**Configuration drift:**
- Agent configurations live in different files (`.clauderc`, `.aiderconfig`, `continue/config.json`)
- Team members may have inconsistent setups
- Project context updates (new ADRs, architectural changes) require manual reconfiguration

### 2.3 Supported Coding Agents (Initial Scope)

| Agent | Installation | CLI Command | Config File(s) |
|-------|-------------|-------------|----------------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude code` | `~/.config/claude-code/config.json`, `.claude/` |
| **Aider** | `pip install aider-chat` | `aider` | `.aider.conf.yml`, `.aiderignore` |
| **Continue** | `npm install -g continue` | `continue` | `~/.continue/config.json` |
| **OpenHands** | `pip install openhands` | `openhands` | `.openhands/config.yml` |

**Future candidates:** Cursor CLI (if released), GPT Engineer, Cody CLI, GitHub Copilot Workspace CLI

---

## 3. Proposed Architecture

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Developer runs: brat code                                       │
└───────────┬─────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. Agent Discovery                                             │
│    - Check system PATH for installed agents (claude, aider, etc)│
│    - Check ~/.bratrc or .bitbrat.json for preferred agent      │
│    - If none found, show installation guide                    │
└───────────┬───────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Agent Selection                                             │
│    - Use saved preference if exists                            │
│    - Otherwise, prompt user to choose from detected agents     │
│    - Save choice to ~/.bratrc (optional --save flag)           │
└───────────┬───────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. Context Preparation                                         │
│    - Load BitBrat project metadata (architecture.yaml)        │
│    - Prepare agent-specific context injection                 │
│    - Apply agent-specific configuration templates             │
└───────────┬───────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. MCP Environment Detection                                   │
│    - Detect running BitBrat services (docker compose ps)      │
│    - Locate tool-gateway endpoint from architecture.yaml      │
│    - Verify MCP connectivity and authentication               │
│    - Discover available tools via fleet API                   │
└───────────┬───────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 5. MCP Auto-Configuration                                      │
│    - Generate MCP server blocks for agent config              │
│    - Configure authentication tokens                          │
│    - Set up tool-gateway or direct Bit connections            │
└───────────┬───────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│ 6. Agent Launch                                                │
│    - Invoke agent with pre-configured settings + MCP          │
│    - Pass BitBrat-specific CLI flags                          │
│    - Attach to agent's interactive session                    │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 Component Architecture

```
tools/brat/src/cli/code/
├── index.ts                    # Entry point: `brat code` handler
├── agent-registry.ts           # Plugin registry for supported agents
├── discovery/
│   ├── detector.ts             # Detect installed agents on system
│   ├── version-check.ts        # Verify agent versions meet minimum requirements
│   └── preference.ts           # Load/save user preferences
├── plugins/
│   ├── base-plugin.ts          # Abstract base class for agent plugins
│   ├── claude-code-plugin.ts   # Claude Code integration
│   ├── aider-plugin.ts         # Aider integration
│   ├── continue-plugin.ts      # Continue integration
│   └── openhands-plugin.ts     # OpenHands integration
├── context/
│   ├── project-context.ts      # Extract BitBrat project metadata
│   ├── template-renderer.ts    # Render agent-specific config templates
│   └── injection-strategy.ts  # Agent-specific context injection methods
├── mcp/
│   ├── environment-detector.ts # Detect running BitBrat services (Docker, ports)
│   ├── tool-discovery.ts       # Discover available MCP tools via fleet API
│   ├── config-generator.ts     # Generate MCP server blocks for agent configs
│   └── auth-manager.ts         # Manage MCP authentication tokens
└── launcher.ts                 # Agent process spawning and lifecycle management
```

### 3.3 Plugin Interface

Each coding agent is implemented as a plugin conforming to the `CodingAgentPlugin` interface:

```typescript
interface CodingAgentPlugin {
  /** Unique identifier for the agent */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Minimum supported version (semver) */
  readonly minVersion: string;

  /** Detect if agent is installed and return version */
  detect(): Promise<AgentDetectionResult>;

  /** Prepare agent-specific configuration */
  prepareConfig(projectContext: ProjectContext): Promise<AgentConfig>;

  /** Launch the agent with prepared config */
  launch(config: AgentConfig, args: string[]): Promise<ChildProcess>;

  /** Optional: Pre-flight checks (API keys, network, etc.) */
  preflight?(): Promise<PreflightResult>;
}

interface AgentDetectionResult {
  installed: boolean;
  version?: string;
  path?: string;
  issues?: string[];  // Warnings or errors
}

interface ProjectContext {
  root: string;
  arch: ArchitectureYaml;
  claudeMd?: string;  // Contents of CLAUDE.md if present
  agentsMd?: string;  // Contents of AGENTS.md if present
  gitBranch?: string;
  gitDirty?: boolean;
  mcp?: McpEnvironment;  // MCP environment detection results
}

interface McpEnvironment {
  available: boolean;  // Whether BitBrat services are running
  toolGatewayUrl?: string;  // Tool gateway endpoint (e.g., http://localhost:8081)
  authToken?: string;  // MCP authentication token
  discoveredTools?: string[];  // List of available tool names
  bits?: Array<{  // Running Bits detected
    name: string;
    url?: string;
    mcpExposure?: string;
  }>;
}

interface AgentConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  configFiles?: Array<{
    path: string;
    content: string;
    temporary: boolean;  // Delete after session?
  }>;
}
```

### 3.4 Configuration File Hierarchy

```
BitBratPlatform/
├── .bitbrat.json                 # Project-level overrides
│   └── codingAgent:
│         └── preferred: "claude-code"
│         └── plugins:
│               └── claude-code:
│                     └── model: "claude-sonnet-4.5"
│
├── .brat/
│   └── code-plugins/             # Custom agent plugin scripts
│       └── my-agent.js
│
└── ~/.bratrc                     # User-level preferences (global)
    └── codingAgent:
          └── preferred: "aider"
          └── plugins:
                └── aider:
                      └── model: "openrouter/anthropic/claude-3.5-sonnet"
```

**Precedence:** `.bitbrat.json` (project) > `~/.bratrc` (user) > defaults

---

## 4. Detailed Design

### 4.1 Agent Discovery Algorithm

```typescript
async function discoverAgents(): Promise<Map<string, AgentDetectionResult>> {
  const plugins = AgentRegistry.getAllPlugins();
  const results = new Map();

  for (const plugin of plugins) {
    try {
      const detection = await plugin.detect();
      if (detection.installed) {
        results.set(plugin.id, detection);
      }
    } catch (err) {
      // Log but continue discovery
      logger.debug(`Failed to detect ${plugin.name}: ${err.message}`);
    }
  }

  return results;
}
```

### 4.2 Context Injection Strategies

Different agents support different methods for providing project context and MCP connectivity:

| Agent | Context Method | MCP Configuration | Implementation |
|-------|---------------|-------------------|----------------|
| **Claude Code** | `.claude/config.json` contextFiles | `mcpServers` block in config.json | Generate config with contextFiles + mcpServers |
| **Aider** | `--read` flag for files | Environment variables (if supported) | Pass `--read CLAUDE.md --read architecture.yaml` + MCP env vars |
| **Continue** | `.continuerc.json` context paths | MCP server config (TBD) | Generate temp config with contextFiles + MCP |
| **OpenHands** | Environment variables + system prompt | Environment variables | Set `OPENHANDS_PROJECT_CONTEXT` + MCP env vars |

**MCP Configuration Priority:**
1. **If BitBrat services detected:** Auto-configure MCP connection to tool-gateway
2. **If no services running:** Skip MCP configuration (document-only mode)
3. **If MCP connection fails:** Warn but continue (graceful degradation)

### 4.3 MCP Environment Detection Algorithm

```typescript
async function detectMcpEnvironment(projectRoot: string): Promise<McpEnvironment> {
  const result: McpEnvironment = { available: false };

  try {
    // 1. Check if Docker Compose services are running
    const { stdout } = await execAsync('docker compose ps --format json', { cwd: projectRoot });
    const services = JSON.parse(stdout);
    const toolGateway = services.find((s: any) => s.Service === 'tool-gateway' && s.State === 'running');

    if (!toolGateway) {
      logger.debug('tool-gateway not running, skipping MCP configuration');
      return result;
    }

    // 2. Load architecture.yaml to get tool-gateway port
    const arch = await loadArchitectureYaml(projectRoot);
    const toolGatewayPort = arch.services['tool-gateway']?.port || 8081;
    result.toolGatewayUrl = `http://localhost:${toolGatewayPort}`;

    // 3. Verify connectivity via health check
    const healthResponse = await fetch(`${result.toolGatewayUrl}/health`, { timeout: 2000 });
    if (!healthResponse.ok) {
      logger.warn('tool-gateway health check failed, skipping MCP');
      return result;
    }

    // 4. Discover available tools via fleet list
    const fleetResponse = await fetch(`${result.toolGatewayUrl}/mcp/tools/list`, {
      headers: { 'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN || 'local-dev-token'}` },
      timeout: 2000
    });

    if (fleetResponse.ok) {
      const { tools } = await fleetResponse.json();
      result.discoveredTools = tools.map((t: any) => t.name);
      result.available = true;
      result.authToken = process.env.MCP_AUTH_TOKEN || 'local-dev-token';
    }

    logger.info('mcp_environment_detected', {
      toolGatewayUrl: result.toolGatewayUrl,
      toolCount: result.discoveredTools?.length || 0
    });

  } catch (error: any) {
    logger.debug('mcp_detection_failed', { error: error.message });
  }

  return result;
}
```

**Detection Steps:**
1. **Docker Compose Check:** Verify tool-gateway container is running
2. **Port Discovery:** Read `architecture.yaml` to find tool-gateway port
3. **Health Verification:** HTTP GET `/health` to confirm service availability
4. **Tool Discovery:** Call `/mcp/tools/list` to enumerate available tools
5. **Auth Token:** Use `MCP_AUTH_TOKEN` env var or default to `local-dev-token`

**Failure Handling:**
- All failures are non-fatal (log at debug level)
- Return `available: false` if any step fails
- Agent launches in document-only mode (no tools, just context)

### 4.4 Interactive Agent Selection

When multiple agents are detected and no preference is saved:

```
$ brat code

🔍 Detected coding agents:

  1. Claude Code (v1.2.3)
     Anthropic's official CLI coding agent

  2. Aider (v0.42.0)
     AI pair programming in your terminal

  3. Continue (v0.8.1)
     Open-source autopilot for software development

Which agent would you like to use? (1-3): 1

💾 Save this choice as default? (y/N): y

✓ Launching Claude Code with BitBrat context...
```

### 4.5 Configuration Template Example (Claude Code)

Generated `.claude/config.json` (with MCP auto-configuration):

```json
{
  "model": "claude-sonnet-4.5",
  "maxTokens": 200000,
  "systemPrompt": "You are working on the BitBrat platform. Review CLAUDE.md for project-specific instructions.",
  "tools": {
    "enabled": true,
    "timeout": 600000
  },
  "contextFiles": [
    "CLAUDE.md",
    "AGENTS.md",
    "architecture.yaml",
    "README.md"
  ],
  "mcpServers": {
    "bitbrat-platform": {
      "command": "node",
      "args": [
        "/path/to/BitBratPlatform/tools/brat/dist/mcp-proxy.js"
      ],
      "env": {
        "TOOL_GATEWAY_URL": "http://localhost:8081",
        "MCP_AUTH_TOKEN": "local-dev-token"
      }
    }
  }
}
```

**MCP Proxy Bridge:**
Since Claude Code expects MCP servers to be executables (stdio protocol), but BitBrat uses HTTP-based MCP, we provide a thin proxy (`mcp-proxy.js`) that:
1. Accepts MCP stdio protocol from Claude Code
2. Translates to HTTP requests to tool-gateway
3. Returns responses in MCP stdio format

**Alternative (Direct Connection):**
For agents that support HTTP-based MCP natively, skip the proxy and connect directly:
```json
{
  "mcpServers": {
    "bitbrat-platform": {
      "url": "http://localhost:8081/mcp",
      "auth": {
        "token": "local-dev-token"
      }
    }
  }
}
```

### 4.6 CLI Flags and Options

```bash
# Basic usage (interactive)
brat code

# Specify agent explicitly
brat code --agent=claude-code
brat code --agent=aider

# Pass through flags to the underlying agent
brat code -- --model claude-opus-4

# Show detected agents without launching
brat code --list

# Force re-detection and selection
brat code --select

# Generate config but don't launch (dry-run)
brat code --dry-run

# Use a custom plugin
brat code --plugin=/path/to/my-plugin.js
```

---

## 5. Implementation Plan

### 5.1 Phase 1: Core Infrastructure (P0)

**Deliverables:**
- [ ] `CodingAgentPlugin` interface and base class
- [ ] `AgentRegistry` for plugin management
- [ ] Agent detection logic (`detector.ts`)
- [ ] Preference persistence (`~/.bratrc` loading/saving)
- [ ] Basic CLI handler skeleton

**Acceptance Criteria:**
- `brat code --list` shows all detected agents
- User can select an agent interactively
- Selection is saved to `~/.bratrc`

### 5.2 Phase 2: Claude Code Plugin (P0)

**Deliverables:**
- [ ] `claude-code-plugin.ts` implementation
- [ ] Auto-detection of `claude` binary
- [ ] Version validation (require v1.0.0+)
- [ ] Config generation (`.claude/config.json`)
- [ ] Context injection (CLAUDE.md, architecture.yaml)

**Acceptance Criteria:**
- `brat code` launches Claude Code if installed
- Claude Code receives BitBrat project context automatically
- User can override default model via `--model` flag

### 5.3 Phase 3: Additional Agents (P1)

**Deliverables:**
- [ ] `aider-plugin.ts` (Aider support)
- [ ] `continue-plugin.ts` (Continue support)
- [ ] Plugin documentation template
- [ ] Third-party plugin loading mechanism

**Acceptance Criteria:**
- All three agents (Claude Code, Aider, Continue) work via `brat code`
- Context injection works correctly for each agent type
- User can switch between agents via `brat code --agent=<name>`

### 5.4 Phase 4: Advanced Features (P2)

**Deliverables:**
- [ ] `.bitbrat.json` project-level config support
- [ ] Custom plugin loading from `.brat/code-plugins/`
- [ ] Agent health checks and troubleshooting
- [ ] Usage telemetry (opt-in)

**Acceptance Criteria:**
- Project maintainers can enforce a preferred agent via `.bitbrat.json`
- Custom plugins can be loaded dynamically
- Helpful error messages when agents fail preflight checks

---

## 6. Security & Privacy Considerations

### 6.1 API Key Handling

- **Never store API keys in `.bitbrat.json` or project files**
- Rely on agent's native key management (e.g., `ANTHROPIC_API_KEY` env var)
- Document key setup in `brat code --help`

### 6.2 Telemetry (Opt-In)

If implemented:
- **Opt-in only** via `~/.bratrc` setting
- Collect: agent type, version, launch success/failure
- **Do NOT collect:** code, prompts, file contents, API keys

### 6.3 Temporary Files

- Config files marked `temporary: true` are deleted after agent exits
- Use `os.tmpdir()` for ephemeral configs
- Never commit generated configs to git

---

## 7. Migration & Rollout

### 7.1 Backwards Compatibility

- Existing workflows (`claude code`, `aider`, etc.) continue to work unchanged
- `brat code` is purely additive, not replacing anything

### 7.2 Rollout Plan

1. **Week 1:** Ship P0 with Claude Code support only (dogfood internally)
2. **Week 2:** Add Aider and Continue plugins
3. **Week 3:** Document in `README.md`, announce to team
4. **Week 4+:** Gather feedback, iterate on plugin API

### 7.3 Documentation Checklist

- [ ] Update `README.md` with `brat code` section
- [ ] Create `documentation/guides/coding-agents.md`
- [ ] Add `brat code --help` documentation
- [ ] Plugin development guide for third-party agents

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Mock agent detection (simulate installed/missing agents)
- Test plugin loading and registration
- Verify config template rendering
- Validate preference persistence

### 8.2 Integration Tests

- **Requires:** Agents actually installed in CI environment
- Test full flow: `brat code` → agent launch → graceful exit
- Verify context files are passed correctly
- Test flag pass-through (`brat code -- --model opus`)

### 8.3 Manual Testing

- Test on macOS, Linux, Windows (WSL)
- Verify with different terminal emulators
- Test with no agents installed (error handling)
- Test with multiple agents installed (selection UI)

---

## 9. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Developer adoption | 80% of active contributors use `brat code` | Survey / telemetry |
| Time to first code session | < 30 seconds from `git clone` | User testing |
| Agent detection accuracy | 100% for supported agents | Integration tests |
| Configuration errors | < 5% of launches fail due to config issues | Error logs |

---

## 10. Open Questions & Risks

### 10.1 Open Questions

1. **Q:** Should `brat code` automatically install a recommended agent if none are found?
   - **A:** Deferred to P2. For P0, show installation instructions only.

2. **Q:** How do we handle agent updates (e.g., Claude Code v2.0 breaking changes)?
   - **A:** Plugins specify `minVersion` and `maxVersion` (optional). Warn if version mismatch.

3. **Q:** Should we support web-based coding agents (e.g., GitHub Copilot Workspace)?
   - **A:** Out of scope for MVP. Focus on CLI-first agents.

### 10.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Agent API changes break plugins | Medium | High | Version pinning + active monitoring of agent releases |
| Poor agent detection on Windows | Low | Medium | CI testing on Windows runners |
| Plugin API too rigid, hard to extend | Low | High | Review with 3+ agent implementations before finalizing |
| Performance overhead from config generation | Low | Low | Benchmark and cache config templates |

---

## 11. Future Enhancements

### 11.1 Agent Marketplace

- Centralized registry of community-contributed agent plugins
- `brat code --install-plugin <name>` command
- Plugin versioning and updates

### 11.2 Multi-Agent Workflows

- `brat code --agents=claude,aider` — use multiple agents simultaneously
- Agent handoff: Claude for architecture, Aider for implementation

### 11.3 Workspace Presets

```bash
# Launch agent with specific workspace configuration
brat code --preset=bugfix     # Focus mode: recent errors, failing tests
brat code --preset=feature    # Full context: ADRs, architecture, sprint docs
```

### 11.4 Agent Performance Analytics

- Track: average session length, commands executed, files modified
- Help identify which agents are most effective for which tasks

---

## 12. References

- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Aider Documentation](https://aider.chat/docs/)
- [Continue Documentation](https://continue.dev/docs/)
- [OpenHands Documentation](https://docs.openhands.ai/)
- BitBrat `CLAUDE.md` (project instructions)
- BitBrat `AGENTS.md` (LLM collaboration protocol)
