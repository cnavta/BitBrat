# Technical Architecture: Hierarchical Tool Namespacing for Tool-Orchestrator

**Author**: Claude Code (Architect Role)
**Date**: 2026-11-27
**Status**: Proposed
**Sprint Scope**: TBD

---

## Executive Summary

**Problem**: Tool-orchestrator manages ~505 tools with no semantic organization, causing noise and breaching MCP transmission limits (MCP_MAX_TOOLS_LIST=200, Sprint 66). Tools need flexible, multi-dimensional categorization for different consumption contexts (administration, domain work, specialized workflows) without hardcoded assumptions.

**Solution**: Implement **Hierarchical Namespace System** where:
- **Any tool can exist in multiple namespaces** (many-to-many relationship)
- **Namespaces form virtual hierarchies** (e.g., `/mcp/platform/admin/config`, `/mcp/plants/trees/pine`)
- **Flat registry underneath** (no data duplication, simple queries)
- **Namespace metadata** (description, owner, tags, icons)
- **Dynamic namespace assignment** (auto-discovery + explicit + admin tools)
- **Path-based MCP endpoints** (e.g., `/mcp/platform` serves all tools in platform.* namespaces)

**Impact**:
- ✅ **Flexible organization**: Tools self-organize into semantic hierarchies
- ✅ **Multi-context exposure**: Same tool accessible in multiple namespaces (e.g., `bit.config.get` in both `/mcp/platform/admin` and `/mcp/platform/config`)
- ✅ **Prevents limit issues**: Each namespace view stays under transmission limits
- ✅ **Zero architectural disruption**: Single flat registry, path-prefix filtering
- ✅ **Simple & scalable**: Namespaces are just string arrays, no complex graph traversal
- ✅ **Future-proof**: Compatible with adaptive ontology (namespaces from semantic tags)
- ✅ **Configuration-driven**: Clients specify which namespaces to load (`MCP_TOOL_NAMESPACES=platform,domain/analytics`)

**Implementation Status**: 0% implemented, ~75-80% infrastructure reuse (leverages existing tags/filtering, PostgreSQL arrays, GIN indexes; adds namespace metadata and many-to-many relationships)

---

## 1. Current State Analysis

### 1.1 Tool Distribution (Sprint 66 State)

```
Total Tools: ~505
├─ Platform Tools (~220+)
│  ├─ bit.* tools: ~220 (11 tools × ~20 active Bits)
│  │  ├─ bit.info, bit.health, bit.readiness
│  │  ├─ bit.config.get, bit.config.describe
│  │  ├─ bit.flags.get, bit.flags.set
│  │  ├─ bit.log.level
│  │  └─ bit.drain, bit.shutdown, bit.restart
│  ├─ tool.* tools: ~8 (tool-orchestrator admin)
│  │  ├─ tool.list, tool.get, tool.import
│  │  ├─ tool.update_config, tool.get_metrics
│  │  ├─ tool.get_health, tool.refresh_health
│  │  └─ tool.trace_request
│  ├─ model.* tools: ~3 (model registry admin)
│  │  ├─ model.list, model.get
│  │  └─ model.register
│  └─ composition.* tools: ~6 (composition admin)
│     ├─ composition.register, composition.list
│     ├─ composition.get, composition.delete
│     ├─ composition.stats
│     └─ composition.list_tools
└─ Domain Tools (~280)
   ├─ MCP server tools (image-gen-mcp, story-engine-mcp, etc.)
   ├─ Composition tools (registered from mcp-compose definitions)
   └─ Specialized domain services
```

**Key Issue**: Sprint 66 added `MCP_MAX_TOOLS_LIST=200` with prioritization (admin → platform → domain) to prevent SSE write buffer overflow. This hard limit forces exclusion of domain tools when total count exceeds 200.

### 1.2 Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    tool-orchestrator                         │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  PostgreSQL Tool Registry                          │     │
│  │  - 505 tools                                       │     │
│  │  - category field (optional, unused)               │     │
│  │  - tags field (optional, underutilized)            │     │
│  │  - source: 'internal' | 'mcp' | 'composition'      │     │
│  └────────────────────────────────────────────────────┘     │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │  getMcpServer() - Single MCP Endpoint              │     │
│  │  - Serves /mcp                                     │     │
│  │  - Prioritization: admin → platform → domain       │     │
│  │  - Limit: MCP_MAX_TOOLS_LIST=200                   │     │
│  │  - Result: Domain tools truncated                  │     │
│  └────────────────────────────────────────────────────┘     │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  LLMs/Agents │
                    │  - See all   │
                    │    tools OR  │
                    │  - Truncated │
                    │    (>200)    │
                    └──────────────┘
```

**Problems**:
1. **Noise**: Platform tools dominate the tool list (~44% of total)
2. **Limit breach**: Total tools exceed safe MCP transmission limit (200)
3. **Prioritization lossy**: Domain tools truncated to fit limit
4. **No segmentation**: Single namespace for all tool types

### 1.3 Existing Infrastructure (Fully Reusable - No Namespace Implementation Yet)

✅ **Category field**: `ToolRegistryDocument.category?: string` (line 86)
✅ **Tags field**: `ToolRegistryDocument.tags: string[]` (line 85)
✅ **Query filtering**: `ToolQueryFilters.category`, `ToolQueryFilters.tags`
✅ **Source filtering**: `ToolQueryFilters.source`
✅ **Prioritization logic**: Already implemented in `getMcpServer()` (lines 1452-1475)

**Current State**: No namespace-related code exists in production. The infrastructure listed above can be reused for namespace implementation without modification.

---

## 2. External Research: MCP Patterns

### 2.1 MCP Tool Naming Standard (SEP-986)

**Specification**: Tool names may use hierarchical organization via "/" and "." separators.

**Allowed characters**: `a-z`, `A-Z`, `0-9`, `_`, `-`, `.`, `/`

**Examples**:
- `getUser` - Simple name
- `user-profile/update` - Hierarchical with slash
- `DATA_EXPORT_v2` - Version suffix
- `admin.tools.list` - Dot-separated namespace

**Namespace uniqueness**: Tool names "SHOULD be unique" within their namespace.

### 2.2 Gateway Pattern (Production MCP Systems)

**Pattern**: Compose multiple MCP servers using namespaced tool names.

**Format**: `server__tool_name` or `server/tool_name`

**Benefits**:
- Single entry point for agents
- Prevents tool name collisions
- Maintains server attribution
- Supports dynamic discovery

### 2.3 Tool Registry Pattern

**Pattern**: Centralized registry with dynamic discovery and health filtering.

**Features**:
- `Map<string, ToolDefinition>` for tool storage
- Health checks exclude unhealthy tools from `ListTools`
- Versioning enables gradual migrations
- Filtering based on metadata (source, category, tags)

**Scalability**: Supports hundreds of tools with query-based filtering

### 2.4 Context Window Budget Management

**Pattern**: Truncate oversized results to prevent context exhaustion.

**Implementation**:
- Track token budgets (total, reserved, used)
- Truncate tool results with indicators: `[TRUNCATED: 5000 tokens → 1024 tokens]`
- Prevents agents from exceeding context mid-conversation

**Relevance**: MCP_MAX_TOOLS_LIST=200 is BitBrat's implementation of this pattern

### 2.5 Implementation Status vs. Current State

**Current Implementation**: NONE (0%)
- ❌ No `namespaces` column in `platform_tool_registry` table
- ❌ No wildcard `/mcp/*` routing in tool-orchestrator
- ❌ No `MCP_TOOL_NAMESPACES` env var support in mcp-client-profile
- ❌ No namespace metadata table (`platform_tool_namespaces`)
- ❌ No namespace query methods (`queryToolsByNamespaces`, `queryToolsByNamespacePrefix`)
- ❌ No namespace admin tools (`namespace.assign`, `namespace.list_tools`, etc.)

**Infrastructure Readiness**: HIGH (75-80%)
- ✅ PostgreSQL array operations already used (`tags TEXT[]` with GIN indexes)
- ✅ GIN indexes proven performant for array contains queries
- ✅ Query filtering patterns established (`ToolQueryFilters`)
- ✅ MCP client connection logic modular and extensible
- ✅ Dynamic MCP server creation pattern exists (`getMcpServer()` override)
- ✅ Tool registration/update patterns mature
- ✅ Category/tag infrastructure reusable

**Migration Complexity**: LOW
- Single schema migration adds `namespaces TEXT[]` column
- Backward compatible (existing tools continue working)
- Incremental rollout possible (opt-in via `MCP_TOOL_NAMESPACES`)

---

## 3. Proposed Solution: Hierarchical Namespace System

### 3.1 Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           tool-orchestrator                                 │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  PostgreSQL Tool Registry (Flat, Many-to-Many Namespaces)          │    │
│  │                                                                     │    │
│  │  Tool: bit.config.get                                              │    │
│  │  └─ namespaces: ['platform/admin', 'platform/config', 'admin']    │    │
│  │                                                                     │    │
│  │  Tool: image.generate                                              │    │
│  │  └─ namespaces: ['domain/creative', 'domain', 'creative/image']   │    │
│  │                                                                     │    │
│  │  Tool: obs.scene.switch                                            │    │
│  │  └─ namespaces: ['domain/streaming', 'platforms/twitch']          │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                     │                                       │
│                 Path-Based Query: WHERE 'platform/admin' = ANY(namespaces) │
│                                     │                                       │
│           ┌─────────────────────────┼──────────────────────┐               │
│           ▼                         ▼                      ▼               │
│  ┌────────────────┐   ┌──────────────────────┐   ┌──────────────────┐     │
│  │ /mcp/platform  │   │ /mcp/domain/creative │   │ /mcp/admin       │     │
│  │ Prefix: plat*  │   │ Prefix: domain/cre*  │   │ Exact: admin     │     │
│  │ Tools: 150     │   │ Tools: 45            │   │ Tools: 85        │     │
│  └────────────────┘   └──────────────────────┘   └──────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
         ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
         │  llm-bot     │    │ Creative Bot │    │ Admin Agent  │
         │ Namespaces:  │    │ Namespaces:  │    │ Namespaces:  │
         │ platform,    │    │ domain/cre*, │    │ admin,       │
         │ domain       │    │ creative     │    │ platform     │
         └──────────────┘    └──────────────┘    └──────────────┘
```

### 3.2 Core Concepts

#### 3.2.1 Namespace Paths

**Format**: Slash-separated hierarchical paths (like filesystem directories)

**Examples**:
- `platform/admin/config` - Three-level hierarchy
- `domain/creative/image` - Semantic categorization
- `platforms/twitch/chat` - Platform-specific grouping
- `admin` - Single-level namespace

**Rules**:
- **Case-sensitive**: `Platform` ≠ `platform`
- **No leading/trailing slashes**: `platform/admin` (not `/platform/admin/`)
- **Allowed characters**: `a-z`, `A-Z`, `0-9`, `_`, `-`, `/`
- **No empty segments**: `platform//admin` invalid
- **Max depth**: Recommended 5 levels (no hard limit)

#### 3.2.2 Many-to-Many Relationships

**Key principle**: A tool can exist in **multiple namespaces simultaneously**

**Example** - `bit.config.get`:
```typescript
{
  id: 'bit.config.get',
  namespaces: [
    'platform/admin',      // Visible in /mcp/platform/admin
    'platform/config',     // Visible in /mcp/platform/config
    'admin',               // Visible in /mcp/admin
    'configuration'        // Visible in /mcp/configuration
  ]
}
```

**Benefits**:
- Same tool discoverable in multiple contexts
- No data duplication (single tool, multiple views)
- Flexible categorization without forced hierarchy

#### 3.2.3 Path-Based Queries

**Query strategy**: PostgreSQL array contains check with prefix matching

**Exact match** (single namespace):
```sql
SELECT * FROM platform_tool_registry
WHERE 'platform/admin' = ANY(namespaces);
```

**Prefix match** (all sub-namespaces):
```sql
SELECT * FROM platform_tool_registry
WHERE EXISTS (
  SELECT 1 FROM unnest(namespaces) AS ns
  WHERE ns LIKE 'platform/admin%'
);
```

**Multiple namespaces** (union):
```sql
SELECT * FROM platform_tool_registry
WHERE namespaces && ARRAY['platform/admin', 'domain/creative'];
```

### 3.3 Schema Changes

#### 3.3.1 Tool Registry Document

```typescript
export interface ToolRegistryDocument {
  // ... existing fields (id, canonicalName, description, etc.)

  // ✨ NEW: Many-to-many namespace assignments
  namespaces: string[];  // e.g., ['platform/admin', 'domain/creative', 'admin']

  // DEPRECATED: Single category field (kept for backward compat)
  category?: string;  // Auto-populated from namespaces[0] if needed

  // ... existing fields (tags, source, rbac, health, etc.)
}
```

#### 3.3.2 Namespace Metadata

**New collection/table**: `platform_tool_namespaces`

```typescript
export interface NamespaceMetadata {
  /** Unique namespace path (e.g., 'platform/admin/config') */
  path: string;

  /** Human-readable display name */
  displayName: string;

  /** Rich description for discovery */
  description?: string;

  /** Icon/emoji for UI rendering */
  icon?: string;

  /** Owner service or team */
  owner?: string;

  /** Semantic tags for search/discovery */
  tags?: string[];

  /** Parent namespace path (derived from path) */
  parent?: string;

  /** Auto-discovery rules (optional) */
  autoAssignRules?: {
    toolNamePrefix?: string;  // e.g., 'bit.' → 'platform/admin'
    sourceService?: string;    // e.g., 'llm-bot' → 'domain/llm'
  };

  /** Statistics (computed) */
  toolCount?: number;        // Number of tools in this namespace
  lastToolAddedAt?: Date;

  /** Timestamps */
  createdAt: Date;
  lastUpdatedAt: Date;
}
```

**Example**:
```json
{
  "path": "platform/admin/config",
  "displayName": "Platform Configuration Tools",
  "description": "Tools for reading and modifying platform configuration",
  "icon": "⚙️",
  "owner": "platform-team",
  "tags": ["admin", "config", "platform"],
  "parent": "platform/admin",
  "autoAssignRules": {
    "toolNamePrefix": "bit.config."
  },
  "toolCount": 8,
  "createdAt": "2026-11-27T00:00:00Z",
  "lastUpdatedAt": "2026-11-27T00:00:00Z"
}
```

### 3.4 Namespace Assignment Strategies

#### 3.4.1 Auto-Discovery (Initial Implementation)

**Rule-based assignment** during tool registration:

```typescript
function assignNamespaces(tool: ToolRegistryDocument): string[] {
  const namespaces: string[] = [];
  const name = tool.canonicalName;

  // Platform tools (from naming conventions)
  if (name.startsWith('bit.')) {
    namespaces.push('platform/admin');
    if (name.startsWith('bit.config.')) namespaces.push('platform/config');
    if (name.startsWith('bit.flags.')) namespaces.push('platform/flags');
    if (name.startsWith('bit.log.')) namespaces.push('platform/logging');
  }

  if (name.startsWith('tool.')) namespaces.push('platform/tools');
  if (name.startsWith('model.')) namespaces.push('platform/models');
  if (name.startsWith('composition.')) namespaces.push('platform/compositions');

  // Domain tools (from source metadata)
  if (tool.source === 'mcp' || tool.source === 'composition') {
    namespaces.push('domain');

    // Semantic categorization from tool name
    if (name.includes('image') || name.includes('generate')) {
      namespaces.push('domain/creative');
    }
    if (name.includes('obs') || name.includes('scene')) {
      namespaces.push('domain/streaming');
    }
  }

  // Fallback: If no namespaces assigned, put in 'uncategorized'
  return namespaces.length > 0 ? namespaces : ['uncategorized'];
}
```

#### 3.4.2 Explicit Metadata (Future)

**Tool registration** with namespace hints:

```typescript
await toolRegistry.registerTool({
  id: 'custom.workflow.execute',
  canonicalName: 'custom.workflow.execute',
  namespaces: ['domain/automation', 'workflows', 'custom'],  // Explicit
  // ... other fields
});
```

#### 3.4.3 Admin Tools (Dynamic Assignment)

**MCP admin tools** for runtime namespace management:

```typescript
// Add tool to namespace(s)
tool_orchestrator.namespace.assign({
  toolId: 'bit.config.get',
  namespaces: ['platform/admin', 'configuration']
});

// Remove tool from namespace
tool_orchestrator.namespace.unassign({
  toolId: 'bit.config.get',
  namespace: 'admin'
});

// List namespaces for tool
tool_orchestrator.namespace.list_for_tool({
  toolId: 'bit.config.get'
});

// List all tools in namespace
tool_orchestrator.namespace.list_tools({
  namespace: 'platform/admin',
  includeSubnamespaces: true  // Include platform/admin/*
});
```

### 3.5 Implementation Changes

**Core changes** to tool-orchestrator:

#### Change 1: Schema Migration (PostgreSQL)

```sql
-- Add namespaces array column to tool registry
ALTER TABLE platform_tool_registry
ADD COLUMN IF NOT EXISTS namespaces TEXT[] DEFAULT '{}';

-- Create index for array contains queries (performance)
CREATE INDEX IF NOT EXISTS idx_tool_registry_namespaces
ON platform_tool_registry USING GIN (namespaces);

-- Create namespace metadata table
CREATE TABLE IF NOT EXISTS platform_tool_namespaces (
  path TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  owner TEXT,
  tags TEXT[],
  parent TEXT,
  auto_assign_rules JSONB,
  tool_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for parent lookup (hierarchy traversal)
CREATE INDEX IF NOT EXISTS idx_namespace_parent
ON platform_tool_namespaces (parent);
```

#### Change 2: Auto-namespace assignment in tool registration

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts
async registerTool(tool: ToolRegistryDocument): Promise<void> {
  // Auto-assign namespaces if not explicitly provided
  if (!tool.namespaces || tool.namespaces.length === 0) {
    tool.namespaces = await this.assignNamespaces(tool);
  }

  // Update namespace metadata (tool counts)
  for (const ns of tool.namespaces) {
    await this.updateNamespaceToolCount(ns);
  }

  // Insert/update tool in registry
  await this.db.query(
    `INSERT INTO platform_tool_registry (id, canonical_name, namespaces, ...)
     VALUES ($1, $2, $3, ...)
     ON CONFLICT (id) DO UPDATE SET namespaces = $3, ...`,
    [tool.id, tool.canonicalName, tool.namespaces, ...]
  );
}
```

#### Change 3: Dynamic MCP endpoint routing

```typescript
// src/apps/tool-orchestrator-service.ts (setup method)

// Wildcard route for namespace-based MCP endpoints
this.onHTTPRequest({ path: '/mcp/*', method: 'POST' }, async (req, res) => {
  // Extract namespace from path: /mcp/platform/admin → 'platform/admin'
  const namespacePath = req.path.replace(/^\/mcp\/?/, '');

  if (!namespacePath) {
    // Default /mcp endpoint (all tools, legacy behavior)
    const server = this.getMcpServerForNamespaces([]); // Empty = all
    return this.handleMcpRequest(server, req, res);
  }

  // Create MCP server filtered by namespace
  const server = this.getMcpServerForNamespaces([namespacePath]);
  return this.handleMcpRequest(server, req, res);
});
```

#### Change 4: Namespace-filtered MCP server creation

```typescript
// src/apps/tool-orchestrator-service.ts (new method)
protected async getMcpServerForNamespaces(
  namespaces: string[],
  options?: { includeSubnamespaces?: boolean }
): Promise<McpServer> {
  const logger = this.getLogger();

  // Query tools by namespace(s)
  let tools: ToolRegistryDocument[];

  if (namespaces.length === 0) {
    // No namespaces = all tools (legacy /mcp endpoint)
    tools = await this.toolRegistry.queryTools({});

    // Apply MCP_MAX_TOOLS_LIST limit for legacy endpoint only
    const maxTools = parseInt(process.env.MCP_MAX_TOOLS_LIST || '200', 10);
    if (tools.length > maxTools) {
      logger.warn('mcp_server.tools_truncated', {
        total: tools.length,
        limit: maxTools
      });
      tools = this.prioritizeTools(tools).slice(0, maxTools);
    }
  } else if (options?.includeSubnamespaces) {
    // Prefix matching (include sub-namespaces)
    tools = await this.toolRegistry.queryToolsByNamespacePrefix(namespaces);
  } else {
    // Exact matching (specific namespaces only)
    tools = await this.toolRegistry.queryToolsByNamespaces(namespaces);
  }

  logger.info('mcp_server.namespace_filter', {
    namespaces,
    toolCount: tools.length,
    includeSubnamespaces: options?.includeSubnamespaces || false,
  });

  // Create MCP server with filtered tools
  const server = new McpServer(
    { name: `tool-orchestrator-${namespaces.join(',')}`, version: '1.0.0' },
    { capabilities: { tools: tools.length > 0 ? {} : undefined } }
  );

  // Register filtered tools
  for (const tool of tools) {
    server.registerTool(tool.id, {
      description: tool.description || 'No description',
      inputSchema: tool.inputSchema,
    }, async (args: any, ctx: ServerContext) => {
      return await this.executeToolById(tool.id, args, ctx);
    });
  }

  return server;
}
```

#### Change 5: Namespace query methods in ToolRegistry

```typescript
// src/apps/tool-orchestrator-service/modules/registry/tool-registry.ts

/** Query tools that exist in ANY of the specified namespaces (exact match) */
async queryToolsByNamespaces(namespaces: string[]): Promise<ToolRegistryDocument[]> {
  const result = await this.db.query(
    `SELECT * FROM platform_tool_registry
     WHERE namespaces && $1
     ORDER BY canonical_name`,
    [namespaces]  // PostgreSQL array overlap operator &&
  );
  return result.rows;
}

/** Query tools in namespaces matching prefix (includes sub-namespaces) */
async queryToolsByNamespacePrefix(prefixes: string[]): Promise<ToolRegistryDocument[]> {
  // Build LIKE conditions for each prefix
  const conditions = prefixes.map((_, i) =>
    `EXISTS (
      SELECT 1 FROM unnest(namespaces) AS ns
      WHERE ns LIKE $${i + 1} || '%'
    )`
  ).join(' OR ');

  const result = await this.db.query(
    `SELECT * FROM platform_tool_registry
     WHERE ${conditions}
     ORDER BY canonical_name`,
    prefixes
  );
  return result.rows;
}
```

### 3.6 MCP Client Configuration

**Configuration-driven namespace selection** (architecture.yaml):

```yaml
# Example 1: llm-bot (needs platform + domain tools)
llm-bot:
  env:
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000
    - MCP_TOOL_NAMESPACES=platform,domain  # Loads both top-level namespaces
    - ENABLE_TOOL_ORCHESTRATOR=true

# Example 2: Creative bot (domain/creative + domain/image tools)
creative-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/creative,domain/image

# Example 3: Admin bot (all platform sub-namespaces)
admin-bot:
  env:
    - MCP_TOOL_NAMESPACES=platform/admin,platform/config

# Example 4: Specialized streaming bot
streaming-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch
```

**Client implementation** (mcp-client-profile.ts):

```typescript
// src/common/profiles/mcp-client-profile.ts
const connect = async (): Promise<void> => {
  const baseUrl = process.env.TOOL_ORCHESTRATOR_URL?.replace(/\/mcp.*$/, '')
    || 'http://tool-orchestrator:3000';

  const namespacesConfig = process.env.MCP_TOOL_NAMESPACES || '';

  if (namespacesConfig) {
    // Multiple namespace connections
    const namespaces = namespacesConfig.split(',').map(ns => ns.trim());

    for (const namespace of namespaces) {
      await manager.connectServer({
        name: `tool-orchestrator-${namespace.replace(/\//g, '-')}`,
        transport: 'sse',
        url: `${baseUrl}/mcp/${namespace}`,  // e.g., /mcp/platform/admin
      });
    }
  } else {
    // Legacy: Connect to /mcp (all tools)
    await manager.connectServer({
      name: 'tool-orchestrator',
      transport: 'sse',
      url: `${baseUrl}/mcp`,
    });
  }
};
```

---

## 4. Downstream Impact Analysis

### 4.1 Services Affected

**Two primary consumers** of tool-orchestrator with different integration patterns:

| Service | Integration Type | Current Endpoint | Recommended Namespaces | Config Change | Priority |
|---------|-----------------|------------------|----------------------|---------------|----------|
| **llm-bot** | MCP Client (SSE) | `/mcp` (all tools) | `platform,domain` or custom hierarchies | Add `MCP_TOOL_NAMESPACES=<ns1,ns2,...>` | **HIGH** |
| **reflex** | REST API | `/v1/tools/:tool` | N/A (tool execution is namespace-agnostic) | None | **NONE** |
| **tool-gateway** | N/A (deprecated) | N/A | N/A | N/A | **N/A** |

**Key Insight**: Namespace system is **completely flexible**. Services can subscribe to ANY combination of namespaces based on their needs:
- General agents: `platform,domain` (all tools)
- Specialized bots: `domain/creative,domain/streaming` (focused subsets)
- Admin tools: `platform/admin,platform/config` (administration only)
- Custom hierarchies: `plants/trees/pine,plants/flowers` (domain-specific organization)

### 4.2 LLM-Bot Service (MCP Client)

**Profile**: Uses `McpClientProfile` for MCP tool discovery and execution via SSE transport

**Current Behavior** (src/common/profiles/mcp-client-profile.ts:67-80):
```typescript
// Connects to tool-orchestrator via MCP when ENABLE_TOOL_ORCHESTRATOR=true
const gatewayUrl = process.env.TOOL_ORCHESTRATOR_URL ||
                   bit.getConfig<string>('TOOL_ORCHESTRATOR_URL', { required: false }) ||
                   'http://tool-orchestrator:3000/mcp';

const cfg: McpServerConfig = {
  name: 'tool-orchestrator',
  transport: 'sse',
  url: gatewayUrl,  // Currently connects to /mcp (all tools)
};
```

**Problem**:
- Receives **all 505 tools** (200-tool limit with prioritization)
- **Platform tools create noise** in tool selection (~220 platform tools)
- **Domain tools may be truncated** when total exceeds 200
- **Needs BOTH platform AND domain tools** for full functionality

**Solution - Configuration-Driven Namespace Selection**:

**New env var**: `MCP_TOOL_NAMESPACES` (comma-separated list of namespaces to connect to)

```typescript
// src/common/profiles/mcp-client-profile.ts (updated connect() method)
const connect = async (): Promise<void> => {
  const baseUrl = process.env.TOOL_ORCHESTRATOR_URL?.replace(/\/mcp.*$/, '')
    || bit.getConfig<string>('TOOL_ORCHESTRATOR_URL', { required: false })?.replace(/\/mcp.*$/, '')
    || 'http://tool-orchestrator:3000';

  // Parse namespace configuration (defaults to empty = legacy /mcp)
  const namespacesConfig = process.env.MCP_TOOL_NAMESPACES
    || bit.getConfig<string>('MCP_TOOL_NAMESPACES', { required: false })
    || '';

  if (namespacesConfig) {
    // Multiple namespace connections (new behavior)
    const namespaces = namespacesConfig.split(',').map(ns => ns.trim()).filter(Boolean);

    for (const namespace of namespaces) {
      const cfg: McpServerConfig = {
        name: `tool-orchestrator-${namespace}`,
        transport: 'sse',
        url: `${baseUrl}/mcp/${namespace}`,
      };

      await manager.connectServer(cfg);
      bit.getLogger().info('bit.mcp_client.namespace_connected', { namespace });
    }
  } else {
    // Legacy single connection to /mcp (backward compatible)
    const cfg: McpServerConfig = {
      name: 'tool-orchestrator',
      transport: 'sse',
      url: `${baseUrl}/mcp`,
    };

    await manager.connectServer(cfg);
  }
};
```

**Configuration Changes** (architecture.yaml):
```yaml
llm-bot:
  env:
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000  # Base URL (no /mcp suffix)
    - MCP_TOOL_NAMESPACES=platform,domain  # ✨ NEW: Connect to both namespaces
    - ENABLE_TOOL_ORCHESTRATOR=true  # Unchanged
```

**How It Works**:
1. **Parse config**: Split `MCP_TOOL_NAMESPACES` on commas → `['platform', 'domain']`
2. **Create dual connections**:
   - `tool-orchestrator-platform` → `http://tool-orchestrator:3000/mcp/platform` (~230 tools)
   - `tool-orchestrator-domain` → `http://tool-orchestrator:3000/mcp/domain` (~280 tools)
3. **McpClientManager merges tools** from both connections into single registry
4. **LLM sees all 510 tools** without hitting 200-tool limit per connection

**Impact**:
- ✅ **Full tool access**: Gets ALL platform + domain tools (510 total)
- ✅ **No truncation**: Each namespace under 300 tools (well under SSE buffer limits)
- ✅ **Configuration-driven**: No code changes needed to adjust namespaces
- ✅ **Reusable pattern**: Other Bits can use same `MCP_TOOL_NAMESPACES` env var
- ✅ **Backward compatible**: Empty config → legacy `/mcp` behavior
- ✅ **Flexible**: Can add `platform` only, `domain` only, or both

**Code Changes Required**: **1 file**
- `src/common/profiles/mcp-client-profile.ts` (lines 57-150)
  - Add `MCP_TOOL_NAMESPACES` parsing logic
  - Add loop to create multiple connections
  - Preserve backward compatibility for undefined config

**Configuration Examples** (architecture.yaml):

```yaml
# Example 1: General-purpose agent (all tools via top-level namespaces)
llm-bot:
  env:
    - MCP_TOOL_NAMESPACES=platform,domain

# Example 2: Creative assistant (specialized domain tools)
creative-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/creative,domain/image,domain/video

# Example 3: Streaming bot (deep hierarchy, platform-specific)
streaming-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch,platforms/obs

# Example 4: Admin bot (platform administration only)
admin-bot:
  env:
    - MCP_TOOL_NAMESPACES=platform/admin,platform/config,platform/logging

# Example 5: Hypothetical plant taxonomy bot (custom domain)
plant-bot:
  env:
    - MCP_TOOL_NAMESPACES=plants/trees,plants/flowers,plants/shrubs

# Example 6: Legacy behavior (all tools, 200-tool limit)
legacy-bot:
  env:
    # MCP_TOOL_NAMESPACES not set → connects to /mcp
```

**Testing Requirements**:
1. **Multi-namespace connection**: Verify dual connections created for `platform,domain`
2. **Tool count verification**: Confirm ~510 total tools (230 platform + 280 domain)
3. **Tool registry merge**: Verify no duplicate tools between namespaces
4. **Tool execution**: Test both platform tools (bit.config.get) and domain tools (image.generate)
5. **Backward compatibility**: Test with empty `MCP_TOOL_NAMESPACES` → should use `/mcp`
6. **Agent behavior**: Verify no regressions in LLM tool selection

**Risk**: **LOW** - Opt-in via config, backward compatible, fail-open design

### 4.3 Reflex Service (REST API)

**Profile**: Uses direct HTTP POST to `/v1/tools/:tool` endpoint (src/services/reflex/tool-executor.ts)

**Current Behavior** (src/services/reflex/tool-executor.ts:92-131):
```typescript
// Builds REST URL based on feature flag
const useToolOrchestrator = process.env.ENABLE_TOOL_ORCHESTRATOR === 'true';
const defaultGatewayUrl = useToolOrchestrator
  ? (process.env.TOOL_ORCHESTRATOR_URL || 'http://tool-orchestrator:3000')
  : (process.env.MCP_GATEWAY_URL || 'http://tool-gateway:3000');

// Makes POST request to /v1/tools/{tool}
const baseUrl = gatewayUrl.replace(/\/sse\/?$/, '').replace(/\/$/, '');
const url = `${baseUrl}/v1/tools/${encodeURIComponent(tool)}`;
```

**Problem**:
- **REST API is namespace-agnostic** - executes tools by ID directly
- Reflex doesn't use `tools/list` endpoint, so **not affected by namespace segmentation**
- **No impact from virtual namespacing**

**Solution**:
- ✅ **NO CHANGES REQUIRED**
- REST API endpoint `/v1/tools/:tool` works identically across all namespaces
- Tool execution doesn't depend on tool discovery (reflex uses rule-based tool selection)

**Impact**:
- ✅ **Zero impact**: REST API unchanged
- ✅ **No configuration changes needed**
- ✅ **No code changes needed**
- ✅ **No testing required** (beyond existing integration tests)

**Why No Changes**:
- Reflex uses **rule-based tool selection** (not LLM tool discovery)
- Rules specify exact tool IDs to execute
- `/v1/tools/:tool` endpoint executes tools regardless of category
- Virtual namespacing only affects MCP `tools/list` responses

**Risk**: **NONE** - REST API consumers unaffected

### 4.4 Tool-Gateway Service (Deprecated)

**Status**: DEPRECATED as of Sprint 66 (architecture.yaml:900-904)

**Current State**:
```yaml
tool-gateway:
  active: false
  deprecated: true
  deprecatedAt: "2026-11-24"
  deprecationReason: "Replaced by tool-orchestrator (Sprint 61)"
  replacementService: "tool-orchestrator"
```

**Impact**:
- ✅ **NO CHANGES REQUIRED** - Service deprecated and inactive
- ✅ **No migration needed** - Already replaced by tool-orchestrator

**Risk**: **NONE** - Service inactive

### 4.5 Other Potential Consumers

**Future MCP Clients** (new Bit services):
- Any service using `McpClientProfile` automatically inherits namespace support
- **Pattern**: Add `MCP_TOOL_NAMESPACES` env var with desired namespace paths
- **Flexibility**: Choose ANY combination of namespaces based on service needs
- **Examples**:
  - Analytics bot: `domain/analytics,domain/data`
  - Moderation bot: `platforms/twitch/chat,platforms/discord/moderation`
  - Config manager: `platform/admin,platform/config,platform/secrets`

**External Agents** (Claude Code, Continue, Aider):
- Can connect to tool-orchestrator MCP endpoint directly
- **Recommendations by use case**:
  - General coding: `domain` (all domain tools)
  - Creative work: `domain/creative,domain/image,domain/video`
  - Platform admin: `platform/admin,platform/config`
  - Specialized workflows: Custom namespace combinations
- **Discovery**: Query `/mcp/all-namespaces` endpoint (future) to list available namespaces

**brat CLI** (hypothetical future MCP integration):
- Could use `platform` namespace for fleet management tools
- Or `platform/admin` for administrative subset only
- Example: `export MCP_TOOL_NAMESPACES=platform && brat fleet info --all`

### 4.6 Migration Path Summary

| Service | Changes Required | Config Change | Code Change | Priority | Risk | Effort |
|---------|-----------------|---------------|-------------|----------|------|--------|
| **llm-bot** | Add `MCP_TOOL_NAMESPACES` env var | `MCP_TOOL_NAMESPACES=<ns1,ns2,...>` (custom) | 1 file (~50 lines in mcp-client-profile.ts) | HIGH | LOW | Small |
| **reflex** | None | None | None | N/A | NONE | 0 |
| **tool-gateway** | None (deprecated) | N/A | N/A | N/A | NONE | 0 |
| **Future MCP clients** | Add `MCP_TOOL_NAMESPACES` env var | Per service needs (fully custom) | Reuses mcp-client-profile.ts | MEDIUM | LOW | Config only |

**Total Impact**: **Minimal** - 1 profile update (reused by all MCP clients), infinite configuration flexibility per-service

**Migration Flexibility**:

| Use Case | Configuration | Tools Loaded | Migration Phase |
|----------|--------------|--------------|-----------------|
| **Pre-migration (Legacy)** | `MCP_TOOL_NAMESPACES` unset | All tools via `/mcp` (200-tool limit) | Current state |
| **General agent** | `platform,domain` | All tools (510+) via dual connection | Phase 2 (recommended) |
| **Creative specialist** | `domain/creative,domain/image` | Subset (~80 tools) | Phase 2+ (opt-in) |
| **Admin specialist** | `platform/admin,platform/config` | Subset (~50 tools) | Phase 2+ (opt-in) |
| **Custom taxonomy** | `plants/trees,plants/flowers` | Custom domain (~30 tools) | Phase 3+ (future) |
| **Deep hierarchy** | `platforms/twitch/chat/commands` | Highly specific (~10 tools) | Phase 3+ (future) |

---

## 5. Benefits & Trade-offs

### 5.1 Benefits

✅ **Infinite Flexibility**: Tools can exist in unlimited namespaces simultaneously
✅ **Semantic Organization**: Hierarchical paths mirror domain structure (`plants/trees/pine`)
✅ **Noise Reduction**: Clients load only relevant tool subsets (not all 505 tools)
✅ **Limit Compliance**: Each namespace view stays under MCP transmission limits
✅ **Multi-Context Exposure**: Same tool discoverable in multiple contexts (e.g., `bit.config.get` in both `platform/admin` and `configuration`)
✅ **Backward Compatibility**: `/mcp` endpoint unchanged (legacy behavior preserved)
✅ **Zero Architectural Disruption**: Single flat registry, path-prefix queries
✅ **Configuration-Driven**: Clients specify namespaces via env var (no code changes)
✅ **Simple Implementation**: ~200 lines of code, leverages existing PostgreSQL arrays
✅ **Scalable**: Array contains queries support thousands of tools with GIN indexes
✅ **Future-Proof**: Compatible with adaptive ontology (auto-namespace from semantic tags)
✅ **Admin Tooling**: Runtime namespace management via MCP admin tools
✅ **Namespace Metadata**: Rich descriptions, icons, ownership, auto-discovery rules

### 5.2 Trade-offs

⚠️ **Schema Migration**: One-time PostgreSQL migration (add `namespaces` array column + GIN index)
⚠️ **Namespace Metadata Table**: New `platform_tool_namespaces` table (minimal overhead)
⚠️ **Backfill Required**: One-time auto-categorization of existing 505 tools
⚠️ **Client Updates**: Services need `MCP_TOOL_NAMESPACES` config (opt-in, backward compatible)
⚠️ **Namespace Design**: Requires thoughtful namespace hierarchy design (mitigated by auto-discovery)
⚠️ **Query Complexity**: Array overlap/prefix queries (mitigated by GIN indexes for performance)

### 5.3 Comparison to Alternatives

| Approach | Complexity | Scalability | Backward Compat | Future-Proof |
|----------|-----------|-------------|-----------------|--------------|
| **Virtual Namespacing (Proposed)** | Low | High | ✅ Full | ✅ Yes |
| Physical Server Split | High | Medium | ❌ Breaking | ⚠️ Limited |
| Client-Side Filtering | Low | Low | ✅ Full | ❌ No |
| Adaptive Ontology (Future) | Very High | Very High | ⚠️ Gradual | ✅ Yes |

---

## 6. Implementation Plan

### 6.1 Phase 1: Schema Migration & Namespace Metadata (1 Sprint)

**Tasks**:
1. **PostgreSQL schema migration**:
   - Add `namespaces TEXT[]` column to `platform_tool_registry`
   - Create GIN index on `namespaces` for array contains queries
   - Create `platform_tool_namespaces` metadata table
   - Create parent lookup index for hierarchy traversal
2. **Namespace assignment logic**:
   - Implement `assignNamespaces()` function (auto-discovery rules)
   - Update tool registration to populate `namespaces` array
   - Create migration script to backfill existing 505 tools
3. **Testing**:
   - Unit tests for namespace assignment rules
   - Integration tests for array queries (exact + prefix matching)

**Validation**:
- Run migration script in local environment
- Verify `namespaces` array populated for all 505 tools
- Confirm platform tools → `['platform/admin', 'platform/config', ...]`
- Confirm domain tools → `['domain', 'domain/creative', ...]`
- Query performance: Array contains queries < 50ms (with GIN index)

**Risk**: Low (additive schema change, backward compatible via `category` fallback)

### 6.2 Phase 2: Dynamic MCP Endpoint Routing (1 Sprint)

**Tasks**:
1. **Wildcard MCP routing**:
   - Implement `/mcp/*` wildcard route handler
   - Parse namespace path from URL (e.g., `/mcp/platform/admin` → `platform/admin`)
   - Create `getMcpServerForNamespaces()` method (replaces `getMcpServerForCategory()`)
2. **Namespace query methods**:
   - Implement `queryToolsByNamespaces()` (exact match, array overlap)
   - Implement `queryToolsByNamespacePrefix()` (prefix match, LIKE queries)
3. **Legacy endpoint preservation**:
   - Ensure `/mcp` (no namespace) maintains existing behavior
   - Apply MCP_MAX_TOOLS_LIST limit only to `/mcp` endpoint
4. **Integration tests**:
   - Test `/mcp/platform` returns tools in `platform*` namespaces
   - Test `/mcp/domain/creative` returns tools in `domain/creative` namespace
   - Test `/mcp` returns all tools (200-tool limit)
   - Test hierarchical queries (prefix matching)

**Validation**:
- `/mcp/platform` returns ~230 tools (all platform namespaces)
- `/mcp/domain` returns ~280 tools (all domain namespaces)
- `/mcp/domain/creative` returns ~80 tools (creative subset)
- `/mcp` returns 200 tools (prioritized, legacy behavior)
- Verify no tool name collisions within namespaces
- Performance: MCP tools/list response < 500ms for all namespaces

**Risk**: Low (existing getMcpServer() logic reused, additive changes only)

### 6.3 Phase 3: Client Migration & Configuration (1 Sprint)

**Tasks**:
1. **Update mcp-client-profile.ts** (~50 lines):
   - Add `MCP_TOOL_NAMESPACES` parsing logic (comma-separated paths)
   - Add loop to create multiple namespace connections
   - Sanitize namespace paths (replace `/` with `-` for connection names)
   - Preserve backward compatibility (empty config → `/mcp`)
2. **Update architecture.yaml** for llm-bot:
   - Add `MCP_TOOL_NAMESPACES=platform,domain` (or custom namespaces)
   - Remove `/mcp` suffix from `TOOL_ORCHESTRATOR_URL` (use base URL only)
3. **Document namespace system**:
   - Create `documentation/guides/tool-orchestrator-namespaces.md`
   - Update `CLAUDE.md` with namespace configuration pattern
   - Add configuration examples for different use cases
   - Document namespace path format and rules
   - Troubleshooting guide (common namespace errors)

**Code Changes**:
- **1 file modified**: `src/common/profiles/mcp-client-profile.ts` (lines 57-150)
- **1 file updated**: `architecture.yaml` (llm-bot + examples)
- **2 files created**: `documentation/guides/tool-orchestrator-namespaces.md`, update `CLAUDE.md`

**Validation**:
- **Multi-namespace connection**: llm-bot creates N connections (1 per namespace)
- **Tool count verification**: llm-bot sees correct tool count per namespace
- **Tool registry merge**: No duplicate tools between namespace connections
- **Tool execution**: Both platform (`bit.config.get`) and domain (`image.generate`) tools work
- **Hierarchical namespaces**: Test deep paths like `domain/creative/image`
- **Backward compatibility**: Empty `MCP_TOOL_NAMESPACES` → uses `/mcp` (200-tool limit)
- **Agent behavior**: LLM tool selection improves (access to all relevant tools, reduced noise)

**Risk**: Low (opt-in via config, backward compatible, fail-open design)

**Migration Strategy**:
1. **Week 1**: Deploy mcp-client-profile.ts update (backward compatible, no config changes)
2. **Week 2**: Update llm-bot config to use `MCP_TOOL_NAMESPACES=platform,domain`
3. **Week 3**: Monitor metrics, verify tool execution distribution
4. **Week 4**: Document pattern, enable for other services (opt-in)

### 6.4 Phase 4: Admin Tools & Namespace Management (1 Sprint)

**Tasks**:
1. **MCP admin tools** for namespace management:
   - `tool_orchestrator.namespace.assign(toolId, namespaces)` - Add tool to namespace(s)
   - `tool_orchestrator.namespace.unassign(toolId, namespace)` - Remove tool from namespace
   - `tool_orchestrator.namespace.list_for_tool(toolId)` - List tool's namespaces
   - `tool_orchestrator.namespace.list_tools(namespace, includeSubnamespaces)` - List tools in namespace
   - `tool_orchestrator.namespace.create(path, metadata)` - Create namespace metadata
   - `tool_orchestrator.namespace.list_all()` - List all namespaces with metadata
2. **Namespace metadata management**:
   - Create/update namespace metadata (display name, icon, description, owner)
   - Update tool counts automatically on tool registration
   - Parent namespace derivation from path
3. **Testing**:
   - Integration tests for all admin tools
   - Test many-to-many relationships (tool in multiple namespaces)
   - Test metadata updates propagate correctly

**Validation**:
- Admin tools work via MCP (test with Claude Code or llm-bot)
- Tool can be added to multiple namespaces dynamically
- Namespace metadata persists and displays correctly
- Tool counts update automatically
- Hierarchical namespace browsing works (parent/child relationships)

**Risk**: Low (admin-only MCP tools, no impact on existing functionality)

### 6.5 Phase 5: Monitoring & Optimization (Ongoing)

**Tasks**:
1. **Metrics & observability**:
   - Add endpoint usage metrics (`/mcp/<namespace>`)
   - Track tool execution distribution across namespaces
   - Monitor namespace assignment accuracy
   - Dashboard for namespace health (tool counts, usage)
2. **Tuning & refinement**:
   - Tune auto-assignment rules based on real-world usage
   - Optimize GIN index performance
   - Add caching for namespace metadata
3. **Documentation**:
   - Document namespace design patterns
   - Create namespace taxonomy guide
   - Add examples for common use cases

**Validation**:
- Dashboard shows namespace usage split
- Performance metrics stable (< 500ms for tools/list)
- Zero namespace assignment errors reported
- Developer feedback positive (reduced tool fatigue)

**Risk**: Very Low (observability and optimization only)

---

## 7. Future Enhancements

### 7.1 Semantic Auto-Namespace (Adaptive Ontology Integration)

**When**: After adaptive ontology system available (future sprints)

**Pattern**: ML-based namespace assignment from tool descriptions/schemas

**Example**:
```typescript
// Tool description: "Generates creative images using DALL-E"
// Auto-assigned namespaces: ['domain/creative', 'domain/image', 'ai/generation']
```

**Benefit**: Automatic semantic categorization without manual rules

### 7.2 Namespace Discovery API

**When**: After Phase 4 (admin tools complete)

**Pattern**: MCP endpoints for namespace browsing

**Example endpoints**:
- `/mcp/all-namespaces` - List all namespace metadata (descriptions, icons, tool counts)
- `/mcp/namespace-hierarchy` - Hierarchical tree view of namespaces
- `/mcp/search-namespaces?q=creative` - Search namespaces by keyword

**Benefit**: Agents can discover available namespaces dynamically

### 7.3 Context-Aware Namespace Selection

**When**: Context system mature (future sprints)

**Pattern**: Auto-select namespaces based on conversation context

**Example**:
```typescript
// User message: "Help me stream on Twitch"
// Auto-select namespaces: ['platforms/twitch', 'domain/streaming', 'domain/video']
```

**Benefit**: Zero-configuration namespace selection for specialized workflows

### 7.4 Namespace Composition (Tool Bundles)

**When**: After namespace metadata mature (Phase 5+)

**Pattern**: Pre-defined namespace bundles for common use cases

**Example**:
```yaml
# architecture.yaml
namespaces:
  bundles:
    creative-suite: ['domain/creative', 'domain/image', 'domain/video', 'domain/audio']
    admin-full: ['platform/admin', 'platform/config', 'platform/logging', 'platform/secrets']
    streaming-stack: ['platforms/twitch', 'platforms/obs', 'domain/streaming']

# Service configuration
creative-bot:
  env:
    - MCP_NAMESPACE_BUNDLE=creative-suite  # Expands to multiple namespaces
```

**Benefit**: Simplified configuration for common workflows

### 7.5 Namespace-Based RBAC

**When**: After RBAC maturity (future sprints)

**Pattern**: Permission enforcement at namespace level

**Example**:
```typescript
// User with role 'developer' can access domain/* but not platform/admin
{
  role: 'developer',
  allowedNamespaces: ['domain/*'],
  deniedNamespaces: ['platform/admin', 'platform/secrets']
}
```

**Benefit**: Coarse-grained access control without per-tool permissions

### 7.6 Cross-Namespace Tool Dependencies

**When**: Tool count exceeds 1000+, complex workflows emerge

**Pattern**: Tools declare namespace dependencies

**Example**:
```typescript
// Tool: image.generate
// Namespaces: ['domain/creative', 'domain/image']
// Dependencies: ['domain/storage'] (for saving generated images)
```

**Benefit**: Automatic namespace loading for dependent tool workflows

---

## 8. Success Metrics

### 8.1 Quantitative Metrics

**Tool distribution across namespaces** (Phase 2 completion):
- `/mcp` (legacy): ≤200 tools (existing limit, prioritization)
- `/mcp/platform`: ~230 tools (all platform namespaces)
- `/mcp/domain`: ~280 tools (all domain namespaces)
- `/mcp/domain/creative`: ~80 tools (creative subset)
- `/mcp/platform/admin`: ~120 tools (admin subset)
- **Custom namespaces**: Variable (user-defined hierarchies)

**Client namespace adoption** (Phase 3 completion):
- llm-bot: `platform,domain` (510 total tools, zero truncation)
- Specialized bots: Custom namespaces (20-150 tools, targeted subsets)
- External agents: Namespace discovery >50% adoption rate

**Performance** (Phase 2-5):
- MCP tools/list response: <500ms for any namespace (GIN index optimized)
- Tool execution latency: Unchanged (namespace queries add <10ms overhead)
- Database query time: <50ms for array contains queries (with GIN index)

**Namespace system health** (Phase 4+):
- Namespace metadata coverage: 100% of active namespaces
- Tool count accuracy: Auto-updated, zero manual corrections
- Many-to-many relationships: Tools avg 2-3 namespaces (expected distribution)

### 8.2 Qualitative Metrics

**Developer Experience**:
- **Reduced tool fatigue**: Developers report seeing only relevant tools when browsing (survey)
- **Faster tool discovery**: Time to find relevant tool reduced by >50%
- **Configuration simplicity**: One env var (`MCP_TOOL_NAMESPACES`) for complete customization

**Agent Performance**:
- **Improved tool selection**: LLMs choose more relevant tools (measured via tool execution logs)
- **Reduced noise**: Fewer irrelevant `bit.*` calls in domain workflows (<10% vs ~44% pre-namespace)
- **Domain specialization**: Creative bots use 80%+ creative tools (not platform tools)

**Administration**:
- **Fleet management**: Admins can connect to `platform` namespace only (230 tools vs 505)
- **Runtime flexibility**: Namespace assignments changeable via MCP admin tools (zero downtime)
- **Semantic organization**: Tools self-organize into hierarchies matching domain structure

### 8.3 Success Criteria

**Phase 2** (MVP):
- ✅ Dynamic namespace routing works (`/mcp/<any-path>` → filtered tools)
- ✅ GIN index performance: Array queries <50ms
- ✅ Zero regressions in existing `/mcp` endpoint

**Phase 3** (Client adoption):
- ✅ llm-bot successfully loads `platform,domain` namespaces
- ✅ Tool count matches expected (510 total tools)
- ✅ Backward compatibility: Services without `MCP_TOOL_NAMESPACES` still work

**Phase 4** (Admin tools):
- ✅ MCP admin tools work via Claude Code/llm-bot
- ✅ Namespace metadata persists and displays correctly
- ✅ Dynamic tool-to-namespace assignment works

**Phase 5** (Maturity):
- ✅ Dashboard shows namespace usage metrics
- ✅ Zero namespace assignment errors
- ✅ Developer satisfaction survey: >80% positive feedback

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Namespace assignment errors** | Low | Medium | Auto-assignment rules + comprehensive tests + manual review tools |
| **Client breakage during migration** | Very Low | Medium | Opt-in migration, full backward compat (`/mcp` fallback) |
| **Performance degradation** | Very Low | Low | GIN indexes for array queries, caching for metadata, <50ms query time |
| **Namespace design complexity** | Medium | Low | Auto-discovery handles 90%+ cases, admin tools for edge cases |
| **Many-to-many relationship confusion** | Low | Low | Clear documentation, namespace metadata with descriptions/icons |
| **Deep hierarchy maintenance** | Low | Low | Parent derivation automatic, namespace metadata tracks relationships |
| **Naming convention drift** | Medium | Low | Auto-assignment catches 95%+, MCP admin tools for manual override |
| **PostgreSQL array query complexity** | Very Low | Low | GIN indexes proven performant, existing pattern in BitBrat |

---

## 10. Decision Record

### 10.1 Why Hierarchical Namespaces vs Binary Categories?

**Decision**: Hierarchical many-to-many namespaces (not binary platform/domain categories)

**Rationale**:
- **Infinite flexibility**: Tools can exist in unlimited namespaces (e.g., `bit.config.get` in `platform/admin`, `platform/config`, `admin`, `configuration`)
- **Semantic organization**: Hierarchical paths mirror domain structure (`plants/trees/pine`, `platforms/twitch/chat`)
- **Future-proof**: Supports unbounded growth and adaptive ontology integration
- **No forced hierarchy**: Many-to-many allows tools to belong to multiple contexts simultaneously

**Rejected Alternative**: Binary categorization (`platform` OR `domain` per tool)
- **Reason**: Too rigid, doesn't support multi-context exposure, doesn't scale to complex domains

### 10.2 Why Flat Registry + Path Queries vs Nested Data Structure?

**Decision**: Flat PostgreSQL registry with `namespaces TEXT[]` column + GIN indexes

**Rationale**:
- **Simple queries**: `WHERE 'namespace' = ANY(namespaces)` or `WHERE namespaces && ARRAY['ns1','ns2']`
- **No data duplication**: Single tool record, multiple namespace memberships via array
- **Performance**: GIN indexes make array contains queries <50ms
- **Proven pattern**: PostgreSQL array operations already used in BitBrat

**Rejected Alternative**: Nested/graph database (separate tool-namespace junction table)
- **Reason**: Over-engineering, PostgreSQL arrays sufficient, unnecessary complexity

### 10.3 Why Wildcard MCP Routing vs Fixed Endpoints?

**Decision**: Single wildcard route `/mcp/*` parsing namespace from path

**Rationale**:
- **Unlimited namespaces**: Any path works (e.g., `/mcp/plants/trees/pine`)
- **Zero configuration**: No code changes to add new namespaces
- **Dynamic discovery**: Clients can explore namespaces without predefined list
- **Simple implementation**: ~20 lines of routing code

**Rejected Alternative**: Fixed endpoints (`/mcp/platform`, `/mcp/domain` only)
- **Reason**: Requires code changes for new namespaces, doesn't support hierarchies

### 10.4 Why Configuration-Driven Client Selection vs Hardcoded Namespaces?

**Decision**: `MCP_TOOL_NAMESPACES` env var (comma-separated paths)

**Rationale**:
- **Per-service customization**: Each service chooses relevant namespaces
- **Zero code changes**: Configuration-only adjustments
- **Backward compatible**: Empty config → legacy `/mcp` behavior
- **Flexible**: Supports `platform,domain` (general) or `domain/creative,domain/image` (specialized)

**Rejected Alternative**: Hardcode namespace selections in mcp-client-profile.ts
- **Reason**: Not reusable, requires code changes per use case

### 10.5 Why Auto-Assignment + Admin Tools vs Manual Only?

**Decision**: Auto-assignment by naming conventions + MCP admin tools for override

**Rationale**:
- **90%+ automated**: Naming conventions (`bit.*`, `domain/*`) handle most cases
- **Manual override**: Admin tools for edge cases (`tool_orchestrator.namespace.assign()`)
- **Scalable**: Zero manual work for standard tools
- **Future-proof**: Auto-assignment can integrate adaptive ontology later

**Rejected Alternative**: Manual namespace assignment only (no auto-discovery)
- **Reason**: High maintenance burden, doesn't scale to 500+ tools

---

## 11. References

### 11.1 External Standards

- **MCP SEP-986**: Tool Naming Format Specification
  - URL: https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names
  - Relevance: Hierarchical namespacing with "/" and "."

- **MCP Production Patterns (2026)**:
  - URL: https://dev.to/dohkoai/9-mcp-production-patterns-that-actually-scale-multi-agent-systems-2026-3o5j
  - Relevance: Gateway pattern, tool registry, context budgeting

### 11.2 Internal Documentation

- `architecture.yaml`: Service definitions and tool-orchestrator config
- `documentation/concepts/bit-model.md`: Bit control plane (bit.* tools)
- `documentation/guides/tool-orchestrator.md`: Tool registry guide (create if needed)
- `src/apps/tool-orchestrator-service.ts`: Current implementation
- `src/apps/tool-orchestrator-service/modules/types/tool-registry-document.ts`: Schema

### 11.3 Related Sprints

- **Sprint 66**: MCP_MAX_TOOLS_LIST limit added to prevent SSE buffer overflow
- **Sprint 65**: MCP SDK v2 migration and tool-orchestrator foundation
- **Sprint 61**: Tool-gateway aggregation and getMcpServer() override pattern
- **Future Sprints**: Adaptive ontology for semantic tool categorization

---

## 12. Appendices

### 12.1 Namespace Assignment Examples

**Many-to-Many Hierarchical Namespaces:**

```typescript
// Platform admin tools (multi-namespace exposure)
bit.config.get → namespaces: [
  'platform/admin',      // Admin operations
  'platform/config',     // Configuration management
  'admin',               // General admin
  'configuration'        // Cross-domain config
]

bit.flags.set → namespaces: [
  'platform/admin',
  'platform/flags',
  'feature-flags'
]

tool.list → namespaces: [
  'platform/tools',
  'platform/admin',
  'tooling'
]

// Domain creative tools (semantic categorization)
image.generate → namespaces: [
  'domain',              // Top-level domain
  'domain/creative',     // Creative operations
  'domain/image',        // Image-specific
  'creative/image',      // Alternative path
  'ai/generation'        // AI-powered tools
]

// Platform-specific tools (deep hierarchies)
obs.scene.switch → namespaces: [
  'domain/streaming',
  'platforms/obs',
  'platforms/twitch',    // Also relevant to Twitch streaming
  'video/production'
]

// Hypothetical plant taxonomy tool (custom domain)
plant.identify → namespaces: [
  'plants',
  'plants/identification',
  'ai/classification'
]

plant.tree.pine.info → namespaces: [
  'plants/trees',
  'plants/trees/pine',
  'plants/conifers',
  'taxonomy/flora'
]
```

**Namespace Path Rules:**
- **Slash-separated**: `platform/admin/config`
- **Case-sensitive**: `Platform` ≠ `platform`
- **No trailing slashes**: `platform/admin` (not `platform/admin/`)
- **Allowed characters**: `a-z`, `A-Z`, `0-9`, `_`, `-`, `/`

### 12.2 Sample Client Configuration

**Configuration-Driven Namespace Selection** (architecture.yaml):

```yaml
# Example 1: General-purpose agent (all tools via top-level namespaces)
llm-bot:
  env:
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000
    - MCP_TOOL_NAMESPACES=platform,domain
    - ENABLE_TOOL_ORCHESTRATOR=true

# Example 2: Creative assistant (specialized deep hierarchies)
creative-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/creative,domain/image,domain/video,ai/generation

# Example 3: Streaming bot (platform-specific + domain)
streaming-bot:
  env:
    - MCP_TOOL_NAMESPACES=domain/streaming,platforms/twitch,platforms/obs,video/production

# Example 4: Admin bot (platform administration only)
admin-bot:
  env:
    - MCP_TOOL_NAMESPACES=platform/admin,platform/config,platform/logging

# Example 5: Plant taxonomy bot (custom domain hierarchy)
plant-bot:
  env:
    - MCP_TOOL_NAMESPACES=plants/trees,plants/flowers,plants/shrubs,taxonomy/flora

# Example 6: Config management specialist (cross-namespace)
config-manager:
  env:
    - MCP_TOOL_NAMESPACES=platform/config,configuration,platform/secrets

# Example 7: Legacy behavior (all tools, 200-tool limit)
legacy-bot:
  env:
    - TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000/mcp
    # MCP_TOOL_NAMESPACES not set → uses legacy /mcp endpoint
```

**Implementation in mcp-client-profile.ts**:

```typescript
// src/common/profiles/mcp-client-profile.ts (updated connect() method)
const connect = async (): Promise<void> => {
  const baseUrl = process.env.TOOL_ORCHESTRATOR_URL?.replace(/\/mcp.*$/, '')
    || bit.getConfig<string>('TOOL_ORCHESTRATOR_URL', { required: false })?.replace(/\/mcp.*$/, '')
    || 'http://tool-orchestrator:3000';

  // Parse namespace configuration (defaults to empty = legacy /mcp)
  const namespacesConfig = process.env.MCP_TOOL_NAMESPACES
    || bit.getConfig<string>('MCP_TOOL_NAMESPACES', { required: false })
    || '';

  if (namespacesConfig) {
    // Multiple namespace connections (new behavior)
    const namespaces = namespacesConfig.split(',').map(ns => ns.trim()).filter(Boolean);

    for (const namespace of namespaces) {
      const cfg: McpServerConfig = {
        name: `tool-orchestrator-${namespace}`,
        transport: 'sse',
        url: `${baseUrl}/mcp/${namespace}`,
      };

      await manager.connectServer(cfg);
      bit.getLogger().info('bit.mcp_client.namespace_connected', { namespace });
    }
  } else {
    // Legacy single connection to /mcp (backward compatible)
    const cfg: McpServerConfig = {
      name: 'tool-orchestrator',
      transport: 'sse',
      url: `${baseUrl}/mcp`,
    };

    await manager.connectServer(cfg);
  }
};
```

**External MCP Client Example** (Claude Code, Continue, Aider):

```bash
# .env or MCP settings
TOOL_ORCHESTRATOR_URL=http://tool-orchestrator:3000
MCP_TOOL_NAMESPACES=domain  # Connect to domain tools only for coding tasks
```

**brat CLI connecting to platform tools** (hypothetical future brat MCP integration):

```bash
# Platform administration via brat
export MCP_TOOL_NAMESPACES=platform
brat fleet info --all
```

### 12.3 Migration SQL

**Schema Migration:**

```sql
-- Step 1: Add namespaces array column
ALTER TABLE platform_tool_registry
ADD COLUMN IF NOT EXISTS namespaces TEXT[] DEFAULT '{}';

-- Step 2: Create GIN index for array contains queries
CREATE INDEX IF NOT EXISTS idx_tool_registry_namespaces
ON platform_tool_registry USING GIN (namespaces);

-- Step 3: Create namespace metadata table
CREATE TABLE IF NOT EXISTS platform_tool_namespaces (
  path TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  owner TEXT,
  tags TEXT[],
  parent TEXT,
  auto_assign_rules JSONB,
  tool_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Create parent lookup index
CREATE INDEX IF NOT EXISTS idx_namespace_parent
ON platform_tool_namespaces (parent);
```

**Backfill Existing Tools:**

```sql
-- Backfill namespaces array for existing tools
-- Run once during deployment

-- Platform admin tools
UPDATE platform_tool_registry
SET namespaces = ARRAY['platform/admin', 'admin', 'platform']
WHERE canonical_name LIKE 'bit.%';

-- Platform config tools (subset of admin)
UPDATE platform_tool_registry
SET namespaces = array_append(namespaces, 'platform/config')
WHERE canonical_name LIKE 'bit.config.%';

-- Platform flags tools
UPDATE platform_tool_registry
SET namespaces = array_append(namespaces, 'platform/flags')
WHERE canonical_name LIKE 'bit.flags.%';

-- Platform logging tools
UPDATE platform_tool_registry
SET namespaces = array_append(namespaces, 'platform/logging')
WHERE canonical_name LIKE 'bit.log.%';

-- Tool registry admin
UPDATE platform_tool_registry
SET namespaces = ARRAY['platform/tools', 'platform/admin', 'tooling']
WHERE canonical_name LIKE 'tool.%';

-- Model registry admin
UPDATE platform_tool_registry
SET namespaces = ARRAY['platform/models', 'platform/admin']
WHERE canonical_name LIKE 'model.%';

-- Composition admin
UPDATE platform_tool_registry
SET namespaces = ARRAY['platform/compositions', 'platform/admin']
WHERE canonical_name LIKE 'composition.%';

-- Domain tools (default namespace + semantic categorization)
UPDATE platform_tool_registry
SET namespaces = ARRAY['domain']
WHERE canonical_name NOT LIKE 'bit.%'
  AND canonical_name NOT LIKE 'tool.%'
  AND canonical_name NOT LIKE 'model.%'
  AND canonical_name NOT LIKE 'composition.%'
  AND namespaces = '{}';

-- Creative tools (image, video, etc.)
UPDATE platform_tool_registry
SET namespaces = array_append(namespaces, 'domain/creative')
WHERE (canonical_name LIKE '%image%' OR canonical_name LIKE '%generate%')
  AND 'domain' = ANY(namespaces);

-- Streaming tools (OBS, scene management)
UPDATE platform_tool_registry
SET namespaces = array_append(namespaces, 'domain/streaming')
WHERE (canonical_name LIKE '%obs%' OR canonical_name LIKE '%scene%')
  AND 'domain' = ANY(namespaces);
```

**Verification Queries:**

```sql
-- Verify namespace distribution
SELECT unnest(namespaces) as namespace, COUNT(*) as tool_count
FROM platform_tool_registry
GROUP BY namespace
ORDER BY tool_count DESC;

-- Expected output (top namespaces):
-- namespace       | tool_count
-- ----------------|-----------
-- domain          | ~280
-- platform/admin  | ~230
-- platform        | ~230
-- admin           | ~230
-- domain/creative | ~80
-- platform/config | ~60

-- Verify many-to-many relationships
SELECT
  canonical_name,
  array_length(namespaces, 1) as namespace_count,
  namespaces
FROM platform_tool_registry
ORDER BY namespace_count DESC
LIMIT 10;

-- Verify GIN index usage
EXPLAIN ANALYZE
SELECT * FROM platform_tool_registry
WHERE 'platform/admin' = ANY(namespaces);
```

---

## 13. Approval & Sign-off

**Reviewed By**: TBD
**Approved By**: TBD
**Implementation Sprint**: TBD
**Target Completion**: TBD

---

**End of Technical Architecture Document**
