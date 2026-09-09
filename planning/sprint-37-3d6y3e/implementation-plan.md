# Sprint 37: Fix Dev MCP Tools Registration - Implementation Plan

## Executive Summary

The BitBrat Dev MCP server code is **functional and working** (15 tools register successfully), but **Claude Code cannot connect to it** due to configuration issues in `~/.claude.json`. This sprint will fix the MCP server configuration, add validation tooling, and ensure tools are discoverable in Claude Code sessions.

## Problem Analysis

### Root Cause Identification

**MCP Server Status**: ✅ Working (manually tested, registers 15 tools)
**Claude Code Integration**: ❌ Broken (tools not appearing in Claude sessions)

### Issues Identified

1. **Missing Working Directory** (CRITICAL)
   - Current config: `command: "npm"` with no `cwd` field
   - Issue: `npm run brat` executes from Claude Code's working directory, not BitBratPlatform
   - Impact: Server fails to start because `package.json` not found
   - Evidence: Server starts successfully when run from correct directory

2. **npm Environment** (HIGH)
   - npm location: `/Users/christophernavta/.nvm/versions/node/v24.11.0/bin/npm`
   - Issue: Claude Code may not have nvm environment variables
   - Impact: `npm` command not found in PATH
   - Mitigation: Use absolute path to npm

3. **No Error Visibility** (HIGH)
   - Issue: MCP server startup failures are silent
   - Impact: Cannot debug connection issues
   - Need: Logging mechanism for Claude Code MCP failures

4. **Hardcoded Context** (MEDIUM)
   - Current: `--context staging` hardcoded
   - Issue: Not flexible for different use cases
   - Better: Use `local` as default, allow runtime override

5. **Tool Namespace Unknown** (LOW)
   - Tools register as: `config.show`, `fleet.list`, `agent_dev.provision`
   - Unknown: How Claude Code exposes these (with/without `bitbrat-dev` prefix?)
   - Need: Verification of actual tool names in Claude sessions

6. **Auth Token Management** (LOW)
   - Current: `${MCP_DEV_TOKEN:-test-token-123}`
   - Issue: Default token may not be secure
   - Better: Require explicit token, fail-closed

## Remediation Strategy

### Phase 1: Fix Core Configuration (P0 - CRITICAL)

**Goal**: Make MCP server discoverable and connectable

**Tasks**:
1. Add `cwd` field to MCP server config pointing to BitBratPlatform root
2. Use absolute npm path from nvm
3. Change context from `staging` to `local`
4. Test server appears in Claude Code `/mcp` command

**Validation**:
```bash
# Server appears in MCP list
/mcp list  # Should show bitbrat-dev

# Tools are callable
agent_dev.provision({ name: "test" })  # Should succeed or error clearly
```

### Phase 2: Add Validation & Debugging (P1 - HIGH)

**Goal**: Make MCP failures visible and debuggable

**Tasks**:
1. Create `brat mcp validate` command to test server connectivity
2. Add `--debug` flag to `brat mcp setup` for verbose logging
3. Document MCP server troubleshooting in guide
4. Create test harness for MCP tool calls

**Deliverables**:
- `npm run brat -- mcp validate` - Tests server can start, lists tools
- Updated `documentation/guides/mcp-setup.md` with troubleshooting section
- Test script: `tools/brat/src/dev-mcp/__tests__/mcp-client-test.ts`

### Phase 3: Improve Setup UX (P2 - MEDIUM)

**Goal**: Make setup foolproof and self-diagnosing

**Tasks**:
1. Auto-detect npm path in `brat mcp setup`
2. Auto-detect BitBratPlatform root
3. Validate configuration after writing
4. Add `--verify` flag to test connection immediately

**Enhancements**:
```bash
npm run brat -- mcp setup --verify
# Output:
# ✅ Configuration written to ~/.claude.json
# ✅ MCP server starts successfully
# ✅ 15 tools registered
# ✅ Test tool call succeeded
#
# Ready to use! Try: /mcp list
```

### Phase 4: Documentation & Best Practices (P3 - LOW)

**Goal**: Prevent future configuration issues

**Tasks**:
1. Document correct tool names (with namespace if needed)
2. Add example workflows using dev MCP tools
3. Create troubleshooting decision tree
4. Add MCP server health check to `brat doctor`

**Documentation**:
- Tool naming convention (e.g., `bitbrat-dev.agent_dev.provision` vs `agent_dev.provision`)
- Common failure modes and fixes
- Integration with Claude Code workflows
- Security best practices (token management)

## Technical Architecture

### MCP Server Configuration (Fixed)

```json
{
  "mcpServers": {
    "bitbrat-dev": {
      "type": "stdio",
      "command": "/Users/christophernavta/.nvm/versions/node/v24.11.0/bin/npm",
      "args": [
        "run",
        "brat",
        "--",
        "dev-mcp",
        "start",
        "--context",
        "local",
        "--log-level",
        "info"
      ],
      "cwd": "/Users/christophernavta/IdeaProjects/BitBratPlatform",
      "env": {
        "MCP_DEV_TOKEN": "${MCP_DEV_TOKEN}"
      }
    }
  }
}
```

**Key Changes**:
1. `cwd` added → ensures `package.json` found
2. Absolute npm path → works without nvm in PATH
3. `context: local` → safer default
4. Removed default token fallback → fail-closed security

### Validation Command Architecture

```typescript
// tools/brat/src/oclif-commands/mcp/validate.ts
export default class McpValidate extends BratCommand {
  async run(): Promise<void> {
    // 1. Read ~/.claude.json
    // 2. Find bitbrat-dev server config
    // 3. Simulate MCP handshake (start server, send initialize)
    // 4. Call tools/list to verify tool registration
    // 5. Optionally test a tool call
    // 6. Report results with actionable errors
  }
}
```

**Output Format**:
```
Validating MCP server 'bitbrat-dev'...

✅ Configuration found: ~/.claude.json
✅ Working directory exists: /Users/christophernavta/IdeaProjects/BitBratPlatform
✅ Command executable: /Users/christophernavta/.nvm/versions/node/v24.11.0/bin/npm
✅ Server starts successfully
✅ MCP handshake completed
✅ Tools registered: 15
   - config.show, config.validate, config.doctor, schema.read
   - db.collections, db.get, db.query
   - fleet.list, fleet.info, fleet.logs, fleet.trace
   - agent_dev.provision, agent_dev.start, agent_dev.stop, agent_dev.destroy

Status: HEALTHY ✅

Next steps:
- Start Claude Code session
- Run: /mcp list
- Verify bitbrat-dev appears
- Test a tool: agent_dev.provision({ name: "test" })
```

## Implementation Sequence

### Day 1: Core Fix (Phase 1)
- [ ] Modify `brat mcp setup` to include `cwd` and absolute npm path
- [ ] Update `~/.claude.json` with fixed configuration
- [ ] Test in Claude Code session
- [ ] Verify tools appear and are callable

### Day 2: Validation (Phase 2)
- [ ] Implement `brat mcp validate` command
- [ ] Add MCP client test harness
- [ ] Update troubleshooting documentation
- [ ] Test failure scenarios

### Day 3: UX Improvements (Phase 3)
- [ ] Auto-detect npm path
- [ ] Auto-detect project root
- [ ] Add `--verify` flag
- [ ] Test on clean installation

### Day 4: Documentation (Phase 4)
- [ ] Document tool naming
- [ ] Add example workflows
- [ ] Create troubleshooting guide
- [ ] Add to `brat doctor`

## Success Criteria

### Must Have (Sprint Complete)
✅ MCP server appears in Claude Code `/mcp list`
✅ All 15 tools are callable from Claude sessions
✅ `brat mcp setup` creates working configuration
✅ `brat mcp validate` catches configuration errors

### Should Have (Quality)
✅ Zero-config setup (auto-detect paths)
✅ Clear error messages for all failure modes
✅ Comprehensive troubleshooting docs
✅ Test coverage for MCP integration

### Nice to Have (Future)
- MCP server auto-restart on code changes
- Per-project MCP server instances
- MCP tool usage analytics
- Integration with `brat doctor` health checks

## Risk Assessment

### Low Risk
- Changes are configuration-only initially
- Existing server code works correctly
- Fail-closed auth prevents security issues

### Mitigation
- Test configuration in isolated Claude session
- Keep backup of working `~/.claude.json`
- Document rollback procedure
- Add validation before applying changes

## Dependencies

### External
- Claude Code (installed, working)
- Node.js/npm via nvm
- BitBratPlatform repository accessible

### Internal
- `tools/brat/src/dev-mcp/server.ts` (working)
- `tools/brat/src/cli/mcp-setup.ts` (needs updates)
- `documentation/guides/mcp-setup.md` (needs updates)

## Testing Strategy

### Manual Testing
1. Fresh Claude Code session
2. Run `/mcp list` - verify bitbrat-dev appears
3. Call each tool category (config, db, fleet, agent_dev)
4. Verify audit logging works
5. Test error conditions (missing token, wrong context)

### Automated Testing
1. Unit tests for `cmdMcpSetup` with cwd/npm path logic
2. Integration test: spawn MCP server, verify handshake
3. Tool registration test: verify all 15 tools present
4. Configuration validation test: detect common errors

### Regression Testing
1. Existing dev-mcp tests still pass
2. Server starts in all contexts (local, staging, prod)
3. Tool calls work with/without auth
4. Audit logging captures all calls

## Rollback Plan

If MCP server breaks after changes:

1. **Immediate**: Restore `~/.claude.json` from backup
2. **Verify**: Test with `brat mcp validate`
3. **Diagnose**: Check logs in `.brat/dev-mcp-audit.log`
4. **Escalate**: Document issue in sprint retro

## Key Learnings

### What We Know
- MCP server code is functional
- Problem is configuration, not implementation
- Claude Code uses `~/.claude.json` for global servers
- stdio transport requires correct working directory

### What We Need to Learn
- Exact tool naming in Claude Code (namespace prefix?)
- How Claude Code handles server startup failures
- Best practices for MCP server development
- Performance characteristics (startup time, tool latency)

## Next Steps After Plan Approval

1. Get user approval for plan
2. Update sprint status to `in-progress`
3. Start with Phase 1 (core fix)
4. Create validation script
5. Test in live Claude session
6. Iterate based on results

---

**Author**: @bitbrat (Lead Implementor)
**Sprint**: 37-3d6y3e
**Status**: Planning
**Created**: 2026-09-01
