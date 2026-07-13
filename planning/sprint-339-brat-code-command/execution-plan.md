# Execution Plan: Sprint 339 - `brat code` Command

**Sprint ID:** 339
**Sprint Goal:** Deliver a unified CLI launcher (`brat code`) that auto-detects and configures popular coding agents with BitBrat project context
**Status:** Planning
**Lead Implementor:** AI
**Created:** 2026-07-13

---

## Objective

Implement the `brat code` command as a zero-config launcher for CLI coding agents that automatically:
- Detects installed coding agents on the developer's system
- Applies BitBrat-specific configuration and context
- Launches the preferred agent with full project awareness
- Supports multiple popular agents through a plugin architecture

**Success Criteria:**
- Developers can type `brat code` and get a coding assistant that "knows" BitBrat
- 80%+ of active contributors adopt `brat code` within 4 weeks
- Agent detection works 100% for supported agents
- < 30 seconds from `git clone` to first code session

---

## Problem Statement / Why

### Current Pain Points

1. **High onboarding friction:** New contributors must:
   - Discover which coding agent works best for BitBrat
   - Manually configure project-specific context (CLAUDE.md, architecture.yaml)
   - Learn agent-specific CLI flags and configuration files

2. **Configuration drift:**
   - Each agent has different config files (`.clauderc`, `.aiderconfig`, `continue/config.json`)
   - Team members have inconsistent setups
   - Project context updates require manual reconfiguration

3. **No standardization:**
   - No team-wide convention for which agent to use
   - No automated way to ensure agents receive BitBrat context
   - Project instructions (CLAUDE.md, AGENTS.md) may not be automatically loaded

### Desired Outcome

A single command (`brat code`) that:
- Works out-of-the-box with sensible defaults
- Automatically configures any detected coding agent with BitBrat context
- Remembers user preferences across sessions
- Provides a consistent developer experience regardless of agent choice

---

## Grounding / Verified Baseline Facts

### Existing Infrastructure

1. **CLI Framework:**
   - `tools/brat/src/cli/` contains Commander.js-based CLI infrastructure
   - Commands are registered in `tools/brat/src/cli/index.ts`
   - Standard pattern: create handler in `cli/<command>/` directory

2. **Project Context Sources:**
   - `CLAUDE.md` - Project-specific instructions for Claude Code
   - `AGENTS.md` - LLM collaboration protocol
   - `architecture.yaml` - Canonical system definition
   - `README.md` - Platform overview

3. **User Preferences:**
   - No existing mechanism for storing user preferences
   - Need to introduce `~/.bratrc` (user-level) and `.bitbrat.json` (project-level)

### Supported Coding Agents (Initial Scope)

| Agent | Installation | CLI Command | Config Method | Verification |
|-------|--------------|-------------|---------------|--------------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | `claude code` | `.claude/config.json` | ✓ Tested locally |
| **Aider** | `pip install aider-chat` | `aider` | CLI flags (`--read`) | ✓ Documented |
| **Continue** | `npm install -g continue` | `continue` | `.continuerc.json` | ⚠️ Needs verification |
| **OpenHands** | `pip install openhands` | `openhands` | Env vars | ⚠️ Needs verification |

### Technical Constraints

1. **Agent Detection:** Use `which` / `where` commands to detect installed binaries
2. **Version Validation:** Call `<agent> --version` to verify minimum requirements
3. **Context Injection:** Different strategies per agent (see technical-architecture.md §4.2)
4. **Process Management:** Use Node.js `child_process.spawn()` for agent launching

---

## Scope

### In Scope (MVP)

**Phase 1 (P0) - Core Infrastructure:**
- ✅ Plugin interface and base class (`CodingAgentPlugin`)
- ✅ Agent registry for plugin management
- ✅ Agent detection logic (scan system PATH)
- ✅ User preference persistence (`~/.bratrc`)
- ✅ Interactive agent selection UI
- ✅ Basic CLI handler (`brat code --list`, `brat code --select`)
- ✅ MCP environment detection (Docker, tool-gateway, connectivity)
- ✅ MCP stdio proxy for Claude Code integration

**Phase 2 (P0) - Claude Code Plugin + MCP:**
- ✅ Full Claude Code integration
- ✅ Auto-detection of `claude` binary
- ✅ Version validation (require v1.0.0+)
- ✅ Config generation (`.claude/config.json`)
- ✅ Context injection (CLAUDE.md, architecture.yaml, AGENTS.md, README.md)
- ✅ **MCP auto-configuration (mcpServers block in config)**
- ✅ **MCP tool discovery and enumeration**
- ✅ **MCP authentication token management**
- ✅ Flag pass-through support (`brat code -- --model opus`)

**Phase 3 (P1) - Additional Agents:**
- ✅ Aider plugin implementation
- ✅ Continue plugin implementation (if CLI command verified)
- ✅ Plugin documentation template

**Phase 4 (P2) - Advanced Features:**
- ⚠️ Project-level config (`.bitbrat.json` overrides)
- ⚠️ Custom plugin loading (`.brat/code-plugins/`)
- ⚠️ Agent health checks and troubleshooting
- ⚠️ Usage telemetry (opt-in)

### Out of Scope

- ❌ Automatic agent installation (deferred to future)
- ❌ Web-based coding agents (GitHub Copilot Workspace)
- ❌ Multi-agent workflows (simultaneous agents)
- ❌ Workspace presets (`--preset=bugfix`, `--preset=feature`)
- ❌ Agent performance analytics
- ❌ Agent marketplace / centralized plugin registry

### Non-Goals

- Not replacing existing agent CLIs (they continue to work independently)
- Not enforcing a single agent for the team
- Not modifying agent source code or internals
- Not storing API keys in project files

---

## Implementation Phases

### Week 1: Core Infrastructure + Claude Code Plugin (P0)

**Days 1-2: Core Infrastructure (BL-339-001 to BL-339-010)**

1. **BL-339-001:** Create plugin interface (`CodingAgentPlugin`)
   - Define TypeScript interface with `detect()`, `prepareConfig()`, `launch()`, `preflight?()`
   - Create supporting types: `AgentDetectionResult`, `ProjectContext`, `AgentConfig`
   - Location: `tools/brat/src/cli/code/plugins/base-plugin.ts`

2. **BL-339-002:** Implement AgentRegistry
   - Singleton pattern for plugin registration and retrieval
   - Methods: `register()`, `getPlugin()`, `getAllPlugins()`, `getByName()`
   - Location: `tools/brat/src/cli/code/agent-registry.ts`

3. **BL-339-003:** Implement agent detector
   - Scan system PATH for known agent binaries
   - Execute `--version` commands to verify installations
   - Return map of detected agents with versions
   - Location: `tools/brat/src/cli/code/discovery/detector.ts`

4. **BL-339-004:** Implement preference persistence
   - Load/save `~/.bratrc` YAML file
   - Methods: `loadPreference()`, `savePreference()`, `clearPreference()`
   - Location: `tools/brat/src/cli/code/discovery/preference.ts`

5. **BL-339-005:** Create project context extractor
   - Load `architecture.yaml`, `CLAUDE.md`, `AGENTS.md`, `README.md`
   - Extract git branch and dirty status
   - Return `ProjectContext` object
   - Location: `tools/brat/src/cli/code/context/project-context.ts`

6. **BL-339-006:** Implement interactive agent selection UI
   - Use `inquirer` or similar for CLI prompts
   - Display detected agents with descriptions
   - Prompt to save choice as default
   - Location: `tools/brat/src/cli/code/discovery/selector.ts`

7. **BL-339-007:** Create agent launcher
   - Spawn child process with prepared config
   - Attach stdin/stdout/stderr to current terminal
   - Handle process lifecycle (SIGTERM, SIGINT)
   - Location: `tools/brat/src/cli/code/launcher.ts`

8. **BL-339-008:** Create main CLI handler
   - Register `brat code` command with Commander.js
   - Implement flow: discover → select → prepare → launch
   - Support flags: `--list`, `--select`, `--agent=<name>`, `--dry-run`
   - Location: `tools/brat/src/cli/code/index.ts`

9. **BL-339-009:** Write unit tests for core components
   - Test: AgentRegistry, detector (mocked), preference persistence
   - Test: ProjectContext extraction
   - Coverage target: 80%+

10. **BL-339-010:** Update brat CLI registration
    - Add `code` command to `tools/brat/src/cli/index.ts`
    - Update help text and documentation

**Days 3-4: Claude Code Plugin (BL-339-011 to BL-339-020)**

11. **BL-339-011:** Implement Claude Code detection
    - Check for `claude` binary in PATH
    - Execute `claude --version` and parse output
    - Validate version >= 1.0.0
    - Location: `tools/brat/src/cli/code/plugins/claude-code-plugin.ts`

12. **BL-339-012:** Implement Claude Code config generation
    - Template `.claude/config.json` with BitBrat defaults
    - Set model to `claude-sonnet-4.5`
    - Set maxTokens to 200000
    - Add systemPrompt referencing CLAUDE.md

13. **BL-339-013:** Implement Claude Code context injection
    - Add `contextFiles` array to config: `CLAUDE.md`, `AGENTS.md`, `architecture.yaml`, `README.md`
    - Ensure `.claude/` directory exists or create temporary config

14. **BL-339-014:** Implement Claude Code launch
    - Execute `claude code` with prepared config
    - Support flag pass-through (`-- --model opus`)
    - Attach to interactive session

15. **BL-339-015:** Implement preflight checks
    - Verify `ANTHROPIC_API_KEY` environment variable exists
    - Warn if not set (non-fatal)

16. **BL-339-016:** Write unit tests for Claude Code plugin
    - Test: detection (mocked `which` and `--version`)
    - Test: config generation with various ProjectContext inputs
    - Test: launch arguments construction

17. **BL-339-017:** Integration test: Full flow with Claude Code
    - Requires: Claude Code actually installed in test environment
    - Test: `brat code --agent=claude-code --dry-run`
    - Verify: Config file generated correctly

18. **BL-339-018:** Manual testing on macOS
    - Test: Fresh environment (no ~/.bratrc)
    - Test: Agent selection UI
    - Test: Preference persistence
    - Test: Successful Claude Code launch

19. **BL-339-019:** Update documentation
    - Add `brat code` section to README.md
    - Create `documentation/guides/coding-agents.md`
    - Document Claude Code plugin

20. **BL-339-020:** Code review and refinement
    - Review all Phase 1+2 code
    - Address feedback
    - Ensure consistent error handling

**Day 5: Testing and Documentation**

- Complete all unit and integration tests
- Manual testing across different scenarios
- Documentation updates
- Prepare demo for team

### Week 2: Additional Agent Plugins (P1)

**Days 6-8: Aider Plugin (BL-339-021 to BL-339-030)**

21. **BL-339-021:** Verify Aider CLI installation and behavior
    - Install Aider locally: `pip install aider-chat`
    - Test context injection via `--read` flags
    - Document findings

22. **BL-339-022:** Implement Aider detection
    - Check for `aider` binary in PATH
    - Execute `aider --version` and parse output
    - Location: `tools/brat/src/cli/code/plugins/aider-plugin.ts`

23. **BL-339-023:** Implement Aider config preparation
    - No config file needed (CLI flags only)
    - Prepare `--read` flags for context files

24. **BL-339-024:** Implement Aider context injection
    - Pass `--read CLAUDE.md --read architecture.yaml --read AGENTS.md --read README.md`
    - Support model override via `--model`

25. **BL-339-025:** Implement Aider launch
    - Execute `aider` with prepared flags
    - Support pass-through flags

26. **BL-339-026:** Implement preflight checks
    - Verify API key for selected model (OpenAI, Anthropic, etc.)
    - Warn if not set

27. **BL-339-027:** Write unit tests for Aider plugin
    - Test: detection, config preparation, launch arguments

28. **BL-339-028:** Integration test: Full flow with Aider
    - Requires: Aider installed in test environment
    - Test: `brat code --agent=aider --dry-run`

29. **BL-339-029:** Manual testing with Aider
    - Test: Agent selection with both Claude Code and Aider available
    - Test: Successful Aider launch and context loading

30. **BL-339-030:** Update documentation for Aider

**Days 9-10: Continue Plugin (BL-339-031 to BL-339-040)**

31. **BL-339-031:** Verify Continue CLI exists and behavior
    - Research Continue CLI (may not have standalone CLI)
    - If no CLI, defer plugin and document in backlog
    - If CLI exists, proceed with implementation

32-40. **BL-339-032 to BL-339-040:** Continue plugin implementation (conditional)
    - Follow same pattern as Aider plugin
    - Detection, config, context injection, launch, tests, docs

### Week 3: Polish, Documentation, Rollout (P1)

**Days 11-12: Plugin System Refinement (BL-339-041 to BL-339-050)**

41. **BL-339-041:** Create plugin development guide
    - Document how to create a custom plugin
    - Provide template plugin implementation
    - Location: `documentation/guides/code-plugin-development.md`

42. **BL-339-042:** Add `--help` documentation
    - Comprehensive help text for `brat code`
    - Examples for all flags and use cases

43. **BL-339-043:** Error handling improvements
    - Graceful handling when no agents detected
    - Helpful installation guide messages
    - Clear error messages for version mismatches

44. **BL-339-044:** Add logging and diagnostics
    - Debug logs for detection process
    - Config generation logs (dry-run mode)
    - Launcher lifecycle logs

45. **BL-339-045:** Performance optimization
    - Cache detection results (avoid redundant PATH scans)
    - Lazy-load plugins (don't load all on every invocation)

46. **BL-339-046:** Cross-platform testing
    - Test on macOS ✓
    - Test on Linux (WSL or CI)
    - Test on Windows (if feasible)

47. **BL-339-047:** Create installation troubleshooting guide
    - Common issues: agent not detected, API keys missing
    - Platform-specific PATH issues
    - Version compatibility matrix

48. **BL-339-048:** Add to CI pipeline
    - Lint and test coverage for code plugin system
    - Integration tests (with Claude Code available)

49. **BL-339-049:** Team demo and feedback
    - Internal demo of `brat code` functionality
    - Gather feedback from 3+ developers
    - Create backlog items for feedback

50. **BL-339-050:** README.md updates
    - Add prominent `brat code` section to main README
    - Update quickstart guide to mention `brat code`

**Days 13-15: Rollout and Monitoring (BL-339-051 to BL-339-055)**

51. **BL-339-051:** Soft launch to team
    - Announce `brat code` availability in team chat
    - Provide quick-start guide
    - Monitor for issues

52. **BL-339-052:** Gather adoption metrics
    - Track: Number of developers using `brat code`
    - Track: Which agents are most popular
    - Track: Success rate (launches vs failures)

53. **BL-339-053:** Address early feedback
    - Fix critical bugs within 24 hours
    - Create backlog items for enhancements

54. **BL-339-054:** Create video tutorial (optional)
    - Screen recording of `brat code` usage
    - Show agent selection, preference saving, launch

55. **BL-339-055:** Prepare sprint retrospective
    - Document what went well
    - Document challenges
    - Identify future enhancements (P2 scope)

### Week 4+: Advanced Features (P2 - Future Sprints)

**Phase 4 items deferred to future sprints:**

- `.bitbrat.json` project-level config overrides
- Custom plugin loading from `.brat/code-plugins/`
- Agent health checks and diagnostics
- Usage telemetry (opt-in)
- Automatic agent installation
- Multi-agent workflows
- Workspace presets

---

## Testing Approach

### Unit Testing

**Coverage Target:** 80%+

**Test Files:**
- `tools/brat/src/cli/code/plugins/base-plugin.test.ts`
- `tools/brat/src/cli/code/agent-registry.test.ts`
- `tools/brat/src/cli/code/discovery/detector.test.ts`
- `tools/brat/src/cli/code/discovery/preference.test.ts`
- `tools/brat/src/cli/code/context/project-context.test.ts`
- `tools/brat/src/cli/code/plugins/claude-code-plugin.test.ts`
- `tools/brat/src/cli/code/plugins/aider-plugin.test.ts`

**Mocking Strategy:**
- Mock `child_process.spawn` for agent detection and launch
- Mock filesystem operations for config file generation
- Mock `which` / `where` commands for agent detection

### Integration Testing

**Test Scenarios:**
1. **No agents installed:** Show helpful installation guide
2. **Single agent installed:** Auto-select without prompting
3. **Multiple agents installed:** Interactive selection UI
4. **Saved preference:** Launch directly without prompting
5. **Invalid preference:** Detect and prompt for re-selection
6. **Flag pass-through:** `brat code -- --model opus` correctly passes to agent
7. **Dry-run mode:** Generate config but don't launch

**CI Requirements:**
- Claude Code installed in CI environment (via npm)
- Test full flow: `brat code --agent=claude-code --dry-run`

### Manual Testing

**Platforms:**
- ✅ macOS (primary development environment)
- ⚠️ Linux (Ubuntu 22.04 or similar)
- ⚠️ Windows WSL (if feasible)

**Scenarios:**
- Fresh developer onboarding (no ~/.bratrc)
- Switching between agents
- Config file conflicts (existing `.claude/config.json`)
- Various terminal emulators (iTerm2, Terminal.app, Alacritty)

---

## Rollout Plan

### Phase 1: Internal Dogfooding (Week 1-2)

**Audience:** Core BitBrat contributors (3-5 developers)

**Activities:**
1. Deploy `brat code` to development branch
2. Slack announcement with quick-start guide
3. Request daily feedback via dedicated thread
4. Fix critical bugs within 24 hours

**Success Metrics:**
- 3+ developers successfully launch an agent via `brat code`
- 0 critical bugs reported
- Average time to first session < 60 seconds

### Phase 2: Team Rollout (Week 3)

**Audience:** All BitBrat contributors

**Activities:**
1. Merge to `main` branch
2. Publish release notes (changelog)
3. Update onboarding documentation
4. Host optional demo session (15 minutes)

**Success Metrics:**
- 50%+ of active contributors try `brat code` within first week
- < 10% failure rate on first launch
- Positive sentiment in feedback

### Phase 3: Optimization (Week 4+)

**Activities:**
1. Analyze adoption metrics
2. Identify most common issues
3. Prioritize P2 enhancements based on feedback
4. Plan next sprint for advanced features

---

## Risk Mitigation

### Risk 1: Agent CLI changes break plugins

**Likelihood:** Medium
**Impact:** High

**Mitigation:**
- Version pinning: Plugins specify `minVersion` and optional `maxVersion`
- Monitor agent release notes via GitHub subscriptions
- Test against multiple agent versions in CI

### Risk 2: Poor agent detection on Windows

**Likelihood:** Low
**Impact:** Medium

**Mitigation:**
- CI testing on Windows runners
- Document Windows-specific PATH configuration
- Provide manual override: `brat code --agent-path=/custom/path/claude`

### Risk 3: Plugin API too rigid

**Likelihood:** Low
**Impact:** High

**Mitigation:**
- Review plugin interface with 3+ agent implementations before finalizing
- Provide optional methods (`preflight?`) for flexibility
- Version the plugin interface (allow future breaking changes)

### Risk 4: Context injection doesn't work for an agent

**Likelihood:** Medium
**Impact:** Medium

**Mitigation:**
- Thoroughly test each agent's context loading mechanism
- Provide escape hatch: manual config file editing
- Document limitations in plugin-specific docs

### Risk 5: User has conflicting existing configs

**Likelihood:** Medium
**Impact:** Low

**Mitigation:**
- Detect existing config files before generation
- Prompt: "Existing .claude/config.json found. Overwrite? (y/N)"
- Provide `--force` flag to skip prompts

---

## Dependencies

### External Dependencies

1. **Node.js packages:**
   - `commander` (already used by brat CLI)
   - `inquirer` or `prompts` (for interactive selection)
   - `js-yaml` (for ~/.bratrc persistence)
   - `which` (for cross-platform binary detection)

2. **Coding agents (optional runtime dependencies):**
   - Claude Code: `npm install -g @anthropic-ai/claude-code`
   - Aider: `pip install aider-chat`
   - Continue: TBD (needs verification)

### Internal Dependencies

1. **Existing brat CLI infrastructure:**
   - `tools/brat/src/cli/index.ts` (command registration)
   - `tools/brat/src/utils/` (shared utilities)

2. **Project metadata files:**
   - `CLAUDE.md`
   - `AGENTS.md`
   - `architecture.yaml`
   - `README.md`

---

## Acceptance Criteria (MVP)

### Functional Requirements

- ✅ `brat code` detects at least one installed agent (Claude Code) and launches it
- ✅ Agent receives BitBrat project context (CLAUDE.md, architecture.yaml, etc.)
- ✅ User preference is saved to `~/.bratrc` and persists across sessions
- ✅ `brat code --list` shows all detected agents with versions
- ✅ `brat code --agent=claude-code` launches specific agent
- ✅ `brat code -- --model opus` passes flags through to agent
- ✅ `brat code --dry-run` shows what would happen without launching

### Non-Functional Requirements

- ✅ Detection completes in < 2 seconds
- ✅ Launch completes in < 5 seconds
- ✅ Error messages are clear and actionable
- ✅ Unit test coverage >= 80%
- ✅ Works on macOS and Linux
- ✅ Documentation is complete and accurate

### User Experience Requirements

- ✅ No manual configuration required for basic usage
- ✅ Interactive prompts are clear and concise
- ✅ Process integrates seamlessly with terminal (stdin/stdout/stderr)
- ✅ Graceful handling of missing agents (helpful installation guide)

---

## Post-Sprint Activities

### Documentation

- [ ] Update CHANGELOG.md with sprint deliverables
- [ ] Create blog post / announcement (optional)
- [ ] Update BitBrat onboarding guide to feature `brat code`

### Monitoring

- [ ] Set up adoption tracking (opt-in telemetry or manual survey)
- [ ] Monitor GitHub issues for bug reports
- [ ] Weekly review of feedback for 4 weeks post-launch

### Future Enhancements (Backlog)

- [ ] BL-339-XXX: Project-level config (`.bitbrat.json`)
- [ ] BL-339-XXX: Custom plugin loading
- [ ] BL-339-XXX: Agent health checks
- [ ] BL-339-XXX: Automatic agent installation
- [ ] BL-339-XXX: Multi-agent workflows
- [ ] BL-339-XXX: Workspace presets

---

## Appendix: Implementation Notes

### Preference File Format (~/.bratrc)

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

### Project Override Format (.bitbrat.json)

```json
{
  "codingAgent": {
    "preferred": "aider",
    "plugins": {
      "aider": {
        "model": "gpt-4"
      }
    }
  }
}
```

### Agent Detection Algorithm (Pseudocode)

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
      logger.debug(`Failed to detect ${plugin.name}: ${err.message}`);
    }
  }

  return results;
}
```

---

**End of Execution Plan**
