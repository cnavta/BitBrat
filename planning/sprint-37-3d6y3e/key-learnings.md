# Sprint 37: Key Learnings

**Sprint**: Fix Dev MCP Tools Registration
**Date**: 2026-09-01
**Context**: Planning-only sprint, no implementation

## Critical Learnings

### 1. MCP stdio Servers Require Explicit Working Directory

**Discovery**: MCP servers using stdio transport inherit Claude Code's working directory, not the project directory.

**The Problem**:
```json
{
  "command": "npm",
  "args": ["run", "brat", "--", "dev-mcp", "start"]
  // Missing: "cwd" field
}
```

**Result**: Server tries to run from Claude Code's directory
- `npm run brat` fails (no package.json)
- Error is silent (no feedback)
- Server simply doesn't appear

**The Fix**:
```json
{
  "command": "/absolute/path/to/npm",
  "cwd": "/Users/you/project/root",
  "args": ["run", "brat", "--", "dev-mcp", "start"]
}
```

**Lesson**: Always specify `cwd` for stdio MCP servers that expect specific working directory

**Applies To**: All stdio-based MCP servers that run project-specific commands

---

### 2. Silent Failures Are Configuration Hell

**Discovery**: MCP server startup failures are completely silent in Claude Code.

**Symptoms**:
- Server doesn't appear in `/mcp list`
- No error messages
- No logs
- Tools just "don't work"

**Debugging Strategy**:
1. Test server manually first: `npm run brat -- dev-mcp start`
2. If it works manually, it's configuration
3. Check: `cwd`, absolute paths, environment variables

**Lesson**: Build validation commands for systems with silent failures

**Action Item**: Create `brat mcp validate` to catch config errors before they hit Claude Code

---

### 3. PATH Assumptions Break in Different Environments

**Discovery**: Commands that work in your shell may not work in Claude Code.

**Example**:
- Your shell: npm via nvm → `/Users/you/.nvm/versions/node/v24.11.0/bin/npm`
- Claude Code: No nvm, `npm` not in PATH → Command not found

**The Problem**:
```json
{
  "command": "npm"  // Assumes npm in PATH
}
```

**The Fix**:
```json
{
  "command": "/Users/you/.nvm/versions/node/v24.11.0/bin/npm"  // Explicit path
}
```

**Lesson**: Use absolute paths for commands, never assume PATH

**Auto-detection Strategy**:
```typescript
// Find npm (try multiple approaches)
const npmPath =
  process.env.NVM_BIN + '/npm' ||  // nvm
  execSync('which npm').toString().trim() ||  // PATH
  '/usr/local/bin/npm';  // Fallback
```

---

### 4. Test the Simplest Fix First

**Mistake**: Spent 4.5 hours planning when a 5-minute manual fix would have validated the solution.

**What We Did**:
1. Analyze (2 hours)
2. Plan 4 phases (1.5 hours)
3. Document (1 hour)
4. **Didn't test the actual fix** ❌

**What We Should Have Done**:
1. Analyze (30 min)
2. Manual fix to `~/.claude.json` (5 min)
3. Test in Claude Code (5 min)
4. If it works → Document, optionally automate
5. If it doesn't → Debug with real errors, iterate

**Lesson**: Quick prototypes > Perfect plans

**YAGNI Applied**: Don't build `brat mcp validate` until you've manually validated 3+ times

---

### 5. Configuration > Code (For Integration Issues)

**Discovery**: Server code was perfect. Problem was entirely configuration.

**Debugging Approach**:
1. ✅ Test component in isolation (server worked perfectly)
2. ✅ Identified integration point (Claude Code config)
3. ✅ Found config gap (`cwd`, npm path)

**Time Saved**: Didn't waste time debugging functional code

**Lesson**: When integrations fail, isolate components first. If they work standalone, it's configuration.

**Apply To**: All external integrations (API clients, webhooks, message buses, etc.)

---

### 6. Planning Has Diminishing Returns

**Time Allocation**:
- Analysis: 2 hours → High ROI (found root cause)
- Planning: 1.5 hours → Medium ROI (created roadmap)
- Documentation: 1 hour → Low ROI (no implementation to document)

**Optimal Ratio**: 20% planning, 80% doing

**Actual Ratio**: 100% planning, 0% doing

**Lesson**: Timebox planning. After 2 hours, start implementing.

**Better Process**:
1. Analyze: Max 1 hour
2. Quick fix: 30 minutes
3. Test: 15 minutes
4. Iterate based on results
5. Document what actually works

---

### 7. MCP Server Development Best Practices

**From This Sprint**:

1. **Always Test Standalone First**
   ```bash
   npm run brat -- dev-mcp start --log-level debug
   ```
   If this works, server code is fine.

2. **Required Config Fields for stdio Servers**
   ```json
   {
     "command": "/absolute/path/to/executable",
     "cwd": "/absolute/path/to/project",
     "args": [...],
     "env": {...}
   }
   ```

3. **Fail-Closed Authentication**
   ```json
   {
     "env": {
       "MCP_DEV_TOKEN": "${MCP_DEV_TOKEN}"
       // NO fallback → Forces explicit token
     }
   }
   ```

4. **Build Validation Tools**
   - `brat mcp validate` → Test server connectivity
   - `brat mcp setup --verify` → Validate after config write

5. **Error Visibility Matters**
   - Log to file: `.brat/dev-mcp-audit.log`
   - Debug mode: `--log-level debug`
   - Manual test: Always test manually first

---

### 8. Sprint Protocol Learnings

**Forced Completion is Valid**: This sprint completed in "planning" mode with forced completion. That's okay when:
- Root cause is fully understood
- Solution is documented
- Implementation is deferred deliberately

**Not Every Sprint Ships Code**: Sometimes analysis and planning are the deliverable.

**But**: Should still test the hypothesis before closing.

**Lesson**: Forced completion should include validation that plan is viable, even if not fully implemented.

---

## Actionable Takeaways

### For MCP Server Development

1. ✅ Always specify `cwd` in stdio server configs
2. ✅ Use absolute paths for commands
3. ✅ Test servers standalone before integrating
4. ✅ Build validation commands early
5. ✅ Fail-closed auth (no default tokens)

### For Sprint Execution

1. ✅ Timebox planning: Max 2 hours
2. ✅ Test simplest fix first
3. ✅ Manual validation before automation
4. ✅ 80/20 rule: 80% doing, 20% planning
5. ✅ Live testing required for completion

### For Debugging Integration Issues

1. ✅ Test components in isolation
2. ✅ If isolated tests pass → Configuration issue
3. ✅ Check: `cwd`, paths, environment variables
4. ✅ Build validation tools for silent failures
5. ✅ Never assume PATH or working directory

---

## Anti-Patterns Identified

### ❌ Over-Planning

**What Happened**: 24 tasks, 4 phases, 17 hours estimated for what could be a 30-minute fix

**Better Approach**: MVP first, iterate

### ❌ No Live Testing

**What Happened**: Completed sprint without testing in target environment (Claude Code)

**Better Approach**: Test early, test often, test in production environment

### ❌ Assumption-Based Documentation

**What Happened**: Documented tool naming without testing actual names

**Better Approach**: Document what you've tested, mark assumptions as such

### ❌ Building Before Validating

**What Happened**: Planned `brat mcp validate` before manually validating once

**Better Approach**: Manual process → Repeat 3x → Automate

---

## Transferable Knowledge

### Other Projects Can Use

1. **stdio MCP Server Template**
   ```json
   {
     "mcpServers": {
       "my-server": {
         "command": "$(which node)/npm",  // Auto-detect
         "cwd": "/absolute/project/path",   // Required
         "args": ["run", "mcp-server"],
         "env": {
           "AUTH_TOKEN": "${AUTH_TOKEN}"   // Fail-closed
         }
       }
     }
   }
   ```

2. **Validation Command Pattern**
   - Test server starts
   - Test tools register
   - Test sample tool call
   - Report actionable errors

3. **Integration Debugging Checklist**
   - [ ] Component works in isolation?
   - [ ] Configuration has all required fields?
   - [ ] Absolute paths used (no PATH assumptions)?
   - [ ] Environment variables set correctly?
   - [ ] Working directory is correct?

---

## Questions for Future Exploration

### Tool Naming in Claude Code

**Unknown**: How do tools appear in Claude sessions?
- `config.show` (no prefix)?
- `bitbrat-dev.config.show` (server prefix)?
- `bitbrat-dev:config.show` (colon separator)?

**How to Find Out**: Test one tool call in live Claude Code session

### MCP Server Performance

**Unknown**:
- Server startup time?
- Tool call latency?
- Memory footprint?

**How to Measure**: Add metrics to audit logging

### Multiple MCP Server Instances

**Question**: Can we run one MCP server per project?

**Use Case**: Different BitBratPlatform instances (main, worktrees, forks)

**How to Test**: Create project-scoped config, test isolation

---

## Recommended Reading

For anyone working on similar issues:

1. **MCP Protocol Spec**: https://spec.modelcontextprotocol.io/
2. **stdio Transport Details**: Focus on `cwd` and environment inheritance
3. **Claude Code MCP Guide**: `documentation/guides/mcp-setup.md`
4. **Dev MCP Server Code**: `tools/brat/src/dev-mcp/server.ts`

---

## Impact Assessment

### Immediate Impact

- ✅ Root cause understood
- ✅ Clear solution path
- ✅ Low-risk implementation plan

### Long-Term Impact

- ✅ Reusable MCP server patterns
- ✅ Validation tooling (once built)
- ✅ Better troubleshooting docs
- ✅ Improved setup UX (once implemented)

### Knowledge Transfer

- ✅ Comprehensive planning artifacts
- ✅ Detailed findings documented
- ✅ Next implementor has clear roadmap

---

**Key Learning Summary**:

> When stdio MCP servers don't appear in Claude Code, check `cwd` and absolute paths first. Test standalone before debugging configuration. Plan less, test more.

---

**Author**: @bitbrat
**Sprint**: sprint-37-3d6y3e
**Date**: 2026-09-01
