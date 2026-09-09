# Implementation Plan – Sprint 38

**Sprint**: sprint-38-wwlvmg
**Goal**: Fix JSON Schema validation errors preventing bitbrat-dev MCP tools from registering in Claude Code
**Owner**: christophernavta
**Status**: Complete

## Problem Statement

BitBrat's dev MCP server tools were failing to register in Claude Code due to JSON Schema validation errors. The issue stemmed from using `zod-to-json-schema` to convert Zod schemas to JSON Schema format for MCP tool registration.

**Root Cause**:
- Legacy conversion approach using `zodToJsonSchema()`
- Introduced unnecessary complexity and potential type mismatches
- Not leveraging native Zod v4 + MCP v2 compatibility

## Solution Architecture

### Native Schema Support (Zod v4 + MCP v2)

Zod v4+ implements **Standard Schema v1** natively via the `~standard` symbol property, which MCP v2 SDK accepts directly without any conversion layer.

**Technical Details**:
- Zod v4 exposes `~standard` symbol with JSON Schema representation
- MCP v2 `@modelcontextprotocol/server` accepts Zod schemas directly
- No `zod-to-json-schema` conversion needed
- Eliminates deep type instantiation errors

### Changes Required

1. **Remove conversion logic** in `tools/brat/src/dev-mcp/tool-router.ts`:
   - Remove `zodToJsonSchema` import
   - Pass Zod schemas directly to MCP `inputSchema` field
   - Remove `@ts-ignore` workaround comments

2. **Update package-lock.json**:
   - Clean up peer dependency flags
   - Ensure Zod v4 and MCP v2 compatibility

## Implementation Steps

### Step 1: Update ToolRouter.listTools()
**File**: `tools/brat/src/dev-mcp/tool-router.ts:48-58`

**Before**:
```typescript
import { zodToJsonSchema } from 'zod-to-json-schema';

listTools(): Tool[] {
  const tools: any[] = [];
  for (const def of this.tools.values()) {
    // @ts-ignore - zodToJsonSchema can cause deep type instantiation errors
    const schema = zodToJsonSchema(def.inputSchema);
    tools.push({
      name: def.name,
      description: def.description,
      inputSchema: schema,
    });
  }
  return tools as Tool[];
}
```

**After**:
```typescript
// No import needed

listTools(): Tool[] {
  const tools: any[] = [];
  for (const def of this.tools.values()) {
    tools.push({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema, // Zod schema passed directly
    });
  }
  return tools as Tool[];
}
```

### Step 2: Add Documentation
**File**: `tools/brat/src/dev-mcp/tool-router.ts:7-8, 45-46`

Added comments explaining:
- Why conversion was removed (Sprint 38 context)
- Native Standard Schema v1 support in Zod v4
- MCP v2 direct compatibility

### Step 3: Update Dependencies
**File**: `package-lock.json`

- Removed `"peer": true` flags from 19 dependencies
- Resolved peer dependency warnings

## Verification Plan

### Build Verification
```bash
npm run build
```
Expected: Clean TypeScript compilation without type errors

### Runtime Verification
```bash
npm run brat -- fleet list
```
Expected: All dev MCP tools registered and accessible

### Integration Verification
- Tools appear in Claude Code MCP server list
- Tool schemas validate correctly
- Tool invocations work as expected

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing tool definitions | Low | High | Zod schemas already used; no breaking changes |
| Type errors in tool registry | Low | Medium | TypeScript compilation catches type mismatches |
| Runtime schema validation failures | Low | High | Standard Schema v1 is stable spec |

## Rollback Plan

If issues arise:
1. Revert `tool-router.ts` to use `zodToJsonSchema()`
2. Restore `package-lock.json` peer flags
3. Rebuild and redeploy

**Rollback time**: < 5 minutes

## Success Criteria

- ✅ TypeScript compilation succeeds
- ✅ No runtime errors in dev MCP server startup
- ✅ All tools register correctly in Claude Code
- ✅ Tool schema validation passes
- ✅ Tool invocations work as expected

## References

- **Standard Schema v1**: https://github.com/standard-schema/standard-schema
- **Zod Standard Schema Support**: Zod v4+ changelog
- **MCP v2 SDK**: `@modelcontextprotocol/server` type definitions
- **Related**: Sprint 37 (Dev MCP Tools Registration Analysis)
