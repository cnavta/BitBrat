# Technical Architecture: Tool-Centric Platform Redesign

**Sprint**: 55 (sprint-55-h17jpp)
**Author**: Architect Role (Claude)
**Date**: 2026-11-07
**Status**: Draft v2 - Model-Based RBAC Revision

---

## Executive Summary

This document proposes a fundamental architectural shift in how BitBrat manages, secures, and delivers tooling to agents. The current **server-centric** approach treats MCP servers as first-class entities, with tools discovered and managed as server artifacts. The proposed **tool-centric** approach elevates individual tools to first-class platform resources, enabling granular RBAC, per-tool metrics, composition-aware security, and a foundation for future platform verbs.

### Key Changes

| Aspect | Current (Server-Centric) | Proposed (Tool-Centric) |
|--------|-------------------------|------------------------|
| **Primary Entity** | MCP Server | Individual Tool |
| **Discovery** | Server registration → tool enumeration | Tool import with server metadata |
| **RBAC** | Server-level + coarse tool-level | Dual-layer (User × Model) per-tool |
| **Metrics** | Server-level connection stats | Per-tool performance/reliability |
| **Composition** | Tool IDs resolved at runtime | RBAC-aware composition validation |
| **Addressing** | `server:tool` or sanitized names | Canonical tool IDs in registry |
| **Permission Model** | Agent-based constraints | **Model-based constraints** |

### Revolutionary RBAC Model

**Model-Based Permissions**: The LLM model (gpt-4, claude-sonnet, etc.) is the decision-making entity and determines tool access, not the orchestrating agent (llm-bot, query-analyzer). This enables:

- **Cost Control**: Restrict expensive tools to premium models
- **Security Tiers**: Different models have different multi-dimensional trust scores
- **Request Cascading**: Model permissions flow through entire request lifecycle
- **Granular Control**: Same agent can operate with different permissions based on model choice

---

## 1. Current State Analysis

### 1.1 Server-Centric Architecture

**Components:**
- **tool-gateway** (src/apps/tool-gateway.ts): Central gateway managing MCP servers and tool routing
- **McpClientManager** (src/common/mcp/client-manager.ts): Manages connections to external MCP servers
- **ToolRegistry** (src/services/llm-bot/tools/registry.ts): Simple Map-based tool storage
- **RbacEvaluator** (src/common/mcp/rbac.ts): RBAC enforcement
- **CompositionRegistry/Executor** (src/common/composition/): mcp-compose subsystem

**Data Flow:**
```
┌─────────────────┐
│  MCP Server A   │──┐
│ (image-gen-mcp) │  │
└─────────────────┘  │
                     │  Registration      ┌─────────────────┐
┌─────────────────┐  ├──(NATS message)──>│  tool-gateway   │
│  MCP Server B   │──┤                    │                 │
│ (state-mcp)     │  │                    │ • McpClient     │
└─────────────────┘  │                    │   Manager       │
                     │                    │ • McpServer     │
┌─────────────────┐  │                    │   Store         │
│    Bit (auth)   │──┘                    │ • ToolRegistry  │
│  (internal MCP) │                       │ • RbacEvaluator │
└─────────────────┘                       └────────┬────────┘
                                                   │
                                                   │ Tool Invocation
                                                   ▼
                                          ┌──────────────────┐
                                          │   llm-bot        │
                                          │ (MCP client)     │
                                          │ Uses: gpt-4      │
                                          └──────────────────┘
```

### 1.2 Current Tool Registration Flow

1. **MCP Server Startup**: Server publishes `INTERNAL_MCP_REGISTRATION_V1` message
2. **tool-gateway Receipt**: McpServerStore persists server config (DocumentStore)
3. **RegistryWatcher Trigger**: Detects new/updated server document
4. **McpClientManager Connect**: Establishes transport (HTTP/stdio) to server
5. **Tool Discovery**: Calls MCP `tools/list` RPC
6. **ToolRegistry Population**: Registers tools with server-prefixed IDs
7. **Tool Invocation**: Runtime lookup by tool ID, proxy to origin server

### 1.3 Current Tool Model

**BitBratTool Interface** (src/types/tools.ts):
```typescript
interface BitBratTool {
  id: string;                  // e.g., "mcp:obs.set_scene_item_enabled"
  source: ToolSource;          // 'internal' | 'mcp' | 'firestore' | 'composition'
  displayName?: string;
  description?: string;
  inputSchema: z.ZodType;
  execute?: (args, context) => Promise<Result>;
  requiredRoles?: string[];    // User RBAC (coarse-grained)
  agentAllowlist?: string[];   // Agent RBAC (coarse-grained, WRONG MODEL)
  originServer?: string;       // Server that provided this tool
  scopes?: string[];           // Contextual filtering (e.g., ['story'])
}
```

### 1.4 Current RBAC Model

**Two Levels** (both ad-hoc):
1. **Server-level RBAC**: `McpServerConfig.requiredRoles` - blocks entire server
2. **Tool-level RBAC**: `BitBratTool.requiredRoles` + `agentAllowlist` - blocks individual tools

**Current Enforcement**:
- RbacEvaluator checks `userRoles` against `requiredRoles`
- Agent restrictions via `agentAllowlist` (if present)
- **Critical Flaw**: Uses agent identity (llm-bot, query-analyzer) instead of model identity (gpt-4, claude-sonnet)
- **Limitation**: User roles can circumvent agent restrictions (no proper constraint logic)
- **Architectural Mismatch**: Agent is orchestrator, not decision-maker; model is the intelligence

### 1.5 Current Metrics

**Server-level only**:
- McpStatsCollector tracks connection status, reconnect attempts
- No per-tool performance metrics
- No reliability tracking (error rates, timeout frequency)

### 1.6 Current Composition System

**mcp-compose** (Sprint 41+):
- CompositionRegistry stores compositions in DocumentStore
- CompositionExecutor executes multi-tool workflows
- Compositions registered as tools in ToolRegistry
- **Limitation**: No RBAC-aware validation of composed tools at registration time

---

## 2. Problem Statement

### 2.1 Core Issues

| Problem | Impact | Severity |
|---------|--------|----------|
| **Server-centric management** | Cannot secure/monitor individual tools | High |
| **Agent-based RBAC (wrong model)** | Permissions tied to orchestrator, not intelligence | Critical |
| **Coarse-grained RBAC** | Users can override model restrictions | Critical |
| **No tool metrics** | Cannot detect failing tools | High |
| **No composition RBAC** | Compositions can violate model constraints | High |
| **Coupled registration** | Bit + Tool lifecycle entangled | Medium |

### 2.2 Why Model-Based RBAC?

**Fundamental Insight**: The **LLM model** is the decision-making entity, not the agent.

```
Agent (llm-bot):
- Orchestrates requests
- Routes events
- Manages context
- DOES NOT decide what tools to use

Model (gpt-4, claude-sonnet):
- Decides which tools to invoke
- Generates tool arguments
- Interprets results
- IS the intelligence
```

**Implications**:
1. **Same agent, different permissions**: llm-bot with gpt-3.5 has different tool access than llm-bot with gpt-4
2. **Model capabilities matter**: Advanced models can use complex/expensive tools, basic models cannot
3. **Cost control**: Restrict costly tools (image generation, video processing) to premium models
4. **Security tiers**: High-risk tools (admin operations) only for trusted models
5. **Request-scoped permissions**: Model choice cascades through entire request lifecycle

### 2.3 Motivating Scenarios

**Scenario 1: Cost Control**
> User with premium subscription can use gpt-4, which has access to `generate_image`. Same user using gpt-3.5-turbo (cost-saving mode) should NOT have image generation access. Current agent-based RBAC cannot express this.

**Scenario 2: Security Tiers**
> `admin.delete_user` should only be accessible to claude-opus-3.5 (most capable, trustworthy). gpt-3.5-turbo should never have admin access, regardless of user permissions.

**Scenario 3: Model Cascading**
> User asks llm-bot (using gpt-4) to "analyze image and summarize". Request flow:
> 1. llm-bot calls `analyze_image` tool (allowed for gpt-4)
> 2. analyze_image internally calls `ocr.extract_text` (should inherit gpt-4 permissions)
> 3. Current system loses model context in nested calls

**Scenario 4: Composition Security**
> Composition uses `expensive_analysis` + `generate_report`. Should only be available when gpt-4 is active, not gpt-3.5-turbo.

---

## 3. Proposed Architecture: Tool-Centric Design with Model-Based RBAC

### 3.1 Core Principles

1. **Tools are First-Class Entities**: Individual tools, not servers, are primary platform resources
2. **Import-First Model**: Tools must be explicitly imported before use (discovery ≠ availability)
3. **Model-Based RBAC**: LLM model determines permissions, not orchestrating agent
4. **Dual-Layer Permissions**: User permissions ∩ Model permissions = Effective permissions
5. **Request Cascading**: Model identity flows through entire request lifecycle
6. **Comprehensive Metrics**: Every tool tracks performance and reliability
7. **Composition Awareness**: Compositions validate RBAC of constituent tools against model permissions

### 3.2 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     TOOL-CENTRIC PLATFORM                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │             PLATFORM TOOL REGISTRY                       │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │  Tool Store │  │  Tool Metrics│  │  Tool RBAC   │  │   │
│  │  │(DocumentStore)│  (per-tool)  │  │ (User×Model) │  │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘  │   │
│  │                                                          │   │
│  │  Tool Registry API:                                     │   │
│  │  • importTool(source, config)                           │   │
│  │  • getTool(canonicalId)                                 │   │
│  │  • listTools(filters)                                   │   │
│  │  • updateToolConfig(id, config)                         │   │
│  │  • validateToolAccess(id, user, MODEL)                  │   │
│  │  • recordToolInvocation(id, metrics)                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              MODEL REGISTRY                              │   │
│  │                                                          │   │
│  │  Models as Security Principals:                          │   │
│  │  ┌───────────────┐  ┌───────────────┐                   │   │
│  │  │ gpt-4         │  │ claude-sonnet │                   │   │
│  │  │ roles: [...]  │  │ roles: [...]  │                   │   │
│  │  │ tier: premium │  │ tier: premium │                   │   │
│  │  └───────────────┘  └───────────────┘                   │   │
│  │                                                          │   │
│  │  ┌───────────────┐  ┌───────────────┐                   │   │
│  │  │ gpt-3.5-turbo │  │ ollama/llama  │                   │   │
│  │  │ roles: [...]  │  │ roles: [...]  │                   │   │
│  │  │ tier: basic   │  │ tier: local   │                   │   │
│  │  └───────────────┘  └───────────────┘                   │   │
│  │                                                          │   │
│  │  Model Registry API:                                     │   │
│  │  • registerModel(id, config)                             │   │
│  │  • getModelRoles(modelId)                                │   │
│  │  • getModelTier(modelId)                                 │   │
│  │  • listModels(filters)                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           TOOL IMPORT SUBSYSTEM                          │   │
│  │                                                          │   │
│  │  MCP Server Importers:                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐                     │   │
│  │  │ MCP HTTP     │  │  MCP stdio   │                     │   │
│  │  │ Importer     │  │  Importer    │                     │   │
│  │  └──────────────┘  └──────────────┘                     │   │
│  │                                                          │   │
│  │  Bit Importers:                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐                     │   │
│  │  │ Internal     │  │ Service      │                     │   │
│  │  │ Tool Import  │  │ Registry     │                     │   │
│  │  └──────────────┘  └──────────────┘                     │   │
│  │                                                          │   │
│  │  Import Pipeline:                                        │   │
│  │  Discover → Validate → Deduplicate → Register           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │         COMPOSITION RBAC SUBSYSTEM                       │   │
│  │                                                          │   │
│  │  • Validate tool access at registration time             │   │
│  │  • Inherit most restrictive RBAC of constituent tools    │   │
│  │  • Block registration if model lacks tool access         │   │
│  │  • Model permissions cascade through composition         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Data Model Evolution

**Current** (server-centric, agent-based):
```typescript
// McpServerStore
interface McpServerConfig {
  name: string;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  requiredRoles?: string[];  // Server-level RBAC
  timeoutMs?: number;
  // ...
}

// ToolRegistry (in-memory Map)
Map<string, BitBratTool>
```

**Proposed** (tool-centric, model-based):
```typescript
// PROPOSED: Multi-dimensional trust model for LLM models (NEW)
type ModelTrust = {
  scope: string;  // "general", "coding", "reasoning", "tool-use"

  scores: {
    reliability: number;   // 0-100: Produces correct, useful results
    fidelity: number;      // 0-100: Follows instructions and constraints
    integrity: number;     // 0-100: Respects boundaries; resists manipulation
    calibration: number;   // 0-100: Recognizes uncertainty and limitations
  };

  evidence: {
    source: "benchmark" | "observed" | "manual" | "mixed";
    samples: number;       // Number of observations
    updatedAt: string;     // ISO 8601 timestamp
  };
};

// Platform Tool Registry (DocumentStore)
interface ToolRegistryDocument {
  // Identity
  id: string;                      // Canonical tool ID (e.g., "get_state")
  canonicalName: string;           // Human-friendly name
  description: string;

  // Source
  source: ToolSource;              // 'internal' | 'mcp' | 'composition'
  sourceMetadata: {
    mcpServer?: {
      name: string;
      transport: 'http' | 'stdio';
      connectionConfig: {
        url?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      };
    };
    bit?: {
      name: string;
      profile: string;
    };
    composition?: {
      compositionId: string;
      version: number;
    };
  };

  // Schema
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;

  // RBAC (Dual-Layer: User × Model)
  rbac: {
    userRoles: {
      required: string[];          // Roles user MUST have
      denied: string[];            // Roles that block access
    };
    modelRoles: {
      required: string[];          // Roles MODEL must have
      denied: string[];            // Roles that block model
    };
    modelTiers: {
      allowed: string[];           // Which model tiers can use this tool
                                   // e.g., ['premium', 'enterprise']
      denied: string[];            // Which tiers are blocked
    };
    // Model restrictions ALWAYS constrain user permissions
    effectivePermission: 'user_intersect_model';
  };

  // Configuration
  config: {
    timeoutMs: number;             // Per-tool timeout
    retryPolicy: {
      maxAttempts: number;
      backoffMs: number;
    };
    rateLimiting?: {
      maxCallsPerMinute: number;
    };
    costTier?: 'free' | 'standard' | 'premium' | 'enterprise';
  };

  // Health Tracking (lightweight, updated from invocation events)
  health: {
    lastInvocationAt?: Date;       // Last time tool was invoked
    lastSuccessAt?: Date;          // Last successful invocation
    lastErrorAt?: Date;            // Last error timestamp
    status: 'healthy' | 'degraded' | 'unhealthy';  // Derived from Loki event stream
  };

  // Lifecycle
  status: 'active' | 'deprecated' | 'disabled';
  importedAt: Date;
  lastHealthCheckAt: Date;
  lastUpdatedAt: Date;

  // Note: Detailed metrics (invocations, error rates, latency percentiles, model usage)
  // are derived from ToolInvocationEvent log in Loki, not stored in registry

  // Relationships
  tags: string[];                  // e.g., ['state', 'persistence']
  category: string;                // e.g., 'state-management'
  relatedTools: string[];          // Canonical IDs of related tools
}

// Model Registry (NEW - replaces Agent allowlists)
interface ModelRegistryDocument {
  // Identity
  id: string;                      // e.g., "gpt-4", "claude-sonnet-3.5"
  provider: string;                // e.g., "openai", "anthropic", "ollama"
  displayName: string;
  description: string;

  // Security Profile
  roles: string[];                 // Roles this model possesses
                                   // e.g., ['model', 'premium', 'vision', 'function-calling']
  tier: string;                    // 'free' | 'basic' | 'premium' | 'enterprise'
  trust: ModelTrust[];             // Multi-dimensional trust scores per scope
                                   // e.g., [{ scope: 'tool-use', scores: { reliability: 95, ... }}]

  // Capabilities
  capabilities: {
    toolCalling: boolean;
    vision: boolean;
    streaming: boolean;
    maxContextTokens: number;
    maxOutputTokens: number;
  };

  // Cost Configuration
  cost: {
    inputTokenCost: number;        // USD per 1M tokens
    outputTokenCost: number;
    imageAnalysisCost?: number;
  };

  // Tool Access Policy
  toolPolicy: {
    allowedTools: string[];        // Explicit whitelist (if non-empty, ONLY these)
    deniedTools: string[];         // Explicit blacklist
    maxCostPerCall?: number;       // Max $ per single tool call
    maxConcurrentTools?: number;   // Max parallel tool invocations
  };

  // Lifecycle
  status: 'active' | 'deprecated' | 'disabled';
  registeredAt: Date;
  lastUsedAt: Date;

  // Metrics
  metrics: {
    totalRequests: number;
    totalTokensUsed: number;
    totalCostUSD: number;
    avgResponseTimeMs: number;
  };
}

// MCP Server Registry (still exists, but secondary)
interface McpServerRegistration {
  name: string;
  transport: 'http' | 'stdio';
  connectionConfig: object;
  status: 'active' | 'inactive';
  toolsImported: string[];        // List of tool IDs imported from this server
  lastDiscoveryAt: Date;
  // NO requiredRoles - moved to individual tools
  // NO agentAllowlist - replaced by model permissions
}
```

---

### 3.4 Proposed New Bit: tool-orchestrator

**Status**: PROPOSED - This section describes new architecture, not current implementation.

**Deployment Strategy**: Single unified Bit with internal module separation (not microservices).

**Rationale**:
- **Conceptual separation**: Maintain clear architectural boundaries between gateway, registries, and observer concerns
- **Code encapsulation**: Implement as separate classes/modules with well-defined interfaces
- **Single deployment**: Avoid MCP overhead and network latency for internal coordination
- **Future-proof**: Clean encapsulation allows extraction to separate services if scaling demands it

This architecture introduces **1 new platform Bit** that replaces tool-gateway:

| Service | Profile | Category | MCP Exposure | Deployment | Purpose |
|---------|---------|----------|--------------|------------|---------|
| **tool-orchestrator** | core | platform | platform-only | Single Bit | Unified tool orchestration with internal registry, model catalog, and observability modules |

**Architecture Diagram**:
```
Current Architecture (Sprint 55):
┌───────────────────────────────┐
│      tool-gateway             │
│                               │
│ • In-memory ToolRegistry      │
│   (Map<string, BitBratTool>)  │
│ • McpClientManager            │
│ • RbacEvaluator (agent-based) │
│                               │
└───────────────────────────────┘

Proposed Architecture (Single Unified Bit):
┌─────────────────────────────────────────────────────────────────┐
│                    tool-orchestrator (NEW Bit)                  │
│                      Replaces tool-gateway                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ToolGateway (Orchestration Module)                       │  │
│  │                                                           │  │
│  │ • executeTool(toolId, args, context)                     │  │
│  │ • validateToolAccess(toolId, userRoles, modelId)         │  │
│  │ • McpClientManager (MCP transport to external servers)   │  │
│  │ • Tool execution routing (MCP/internal/composition)      │  │
│  │ • Event logging (Loki)                                   │  │
│  │ • Result transformation                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ↓ ↑ (in-process method calls)       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ToolRegistry (Persistence Module)                        │  │
│  │                                                           │  │
│  │ • getTool(toolId): ToolRegistryDocument                  │  │
│  │ • queryTools(filters): ToolRegistryDocument[]            │  │
│  │ • registerTool(tool): void                               │  │
│  │ • updateTool(toolId, updates): void                      │  │
│  │ • Tool import pipeline (MCP schema → registry doc)       │  │
│  │ • Storage: DocumentStore → platform_tool_registry        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ↓ ↑                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ModelRegistry (Model Catalog Module)                     │  │
│  │                                                           │  │
│  │ • getModel(modelId): ModelRegistryDocument               │  │
│  │ • queryModels(filters): ModelRegistryDocument[]          │  │
│  │ • registerModel(model): void                             │  │
│  │ • updateModel(modelId, updates): void                    │  │
│  │ • Storage: DocumentStore → model_registry                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ↓ ↑                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ToolObserver (Observability Module)                      │  │
│  │                                                           │  │
│  │ • queryToolMetrics(toolId, timeRange): Metrics           │  │
│  │ • traceToolInvocation(correlationId): Event[]            │  │
│  │ • getToolHealth(toolId): HealthStatus                    │  │
│  │ • Loki client (LogQL queries)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ MCP Tools Exposed (platform-only)                        │  │
│  │                                                           │  │
│  │ Tool Execution:                                          │  │
│  │ • toolRegistry.executeTool(toolId, args, context)        │  │
│  │                                                           │  │
│  │ Tool Registry:                                           │  │
│  │ • toolRegistry.getTool(toolId)                           │  │
│  │ • toolRegistry.queryTools(filters)                       │  │
│  │ • toolRegistry.registerTool(tool) [admin only]           │  │
│  │ • toolRegistry.updateTool(toolId, updates) [admin only]  │  │
│  │                                                           │  │
│  │ Model Registry:                                          │  │
│  │ • modelRegistry.getModel(modelId)                        │  │
│  │ • modelRegistry.queryModels(filters)                     │  │
│  │ • modelRegistry.registerModel(model) [admin only]        │  │
│  │                                                           │  │
│  │ Observability:                                           │  │
│  │ • toolObserver.queryToolMetrics(toolId, timeRange)       │  │
│  │ • toolObserver.traceToolInvocation(correlationId)        │  │
│  │ • toolObserver.getToolHealth(toolId)                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  External Dependencies:                                        │
│  • DocumentStore (PostgreSQL) → platform_tool_registry         │
│  • DocumentStore (PostgreSQL) → model_registry                 │
│  • Loki (log aggregation)                                      │
│  • MCP Servers (external tools via stdio/SSE)                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.4.1 Internal Module Structure

The tool-orchestrator Bit is composed of four internal modules, each with clean encapsulation and well-defined interfaces:

```
src/apps/tool-orchestrator-service/
├── index.ts                        # Main Bit entry point
├── modules/
│   ├── gateway/
│   │   ├── tool-gateway.ts         # ToolGateway implementation
│   │   └── tool-gateway.interface.ts
│   ├── registry/
│   │   ├── tool-registry.ts        # ToolRegistry implementation
│   │   └── tool-registry.interface.ts
│   ├── models/
│   │   ├── model-registry.ts       # ModelRegistry implementation
│   │   └── model-registry.interface.ts
│   └── observer/
│       ├── tool-observer.ts        # ToolObserver implementation
│       └── tool-observer.interface.ts
└── types/
    ├── tool-registry-document.ts   # ToolRegistryDocument schema
    ├── model-registry-document.ts  # ModelRegistryDocument schema
    └── tool-metrics.ts             # ToolMetrics types
```

**Key Interfaces** (enable future extraction if needed):

```typescript
// modules/registry/tool-registry.interface.ts
export interface IToolRegistry {
  // Tool retrieval
  getTool(toolId: string): Promise<ToolRegistryDocument | null>;
  queryTools(filters: QueryFilter[]): Promise<ToolRegistryDocument[]>;

  // Tool management
  registerTool(tool: Partial<ToolRegistryDocument>): Promise<void>;
  updateToolConfig(toolId: string, config: Partial<ToolConfig>): Promise<void>;
  deprecateTool(toolId: string, reason: string): Promise<void>;
  disableTool(toolId: string): Promise<void>;

  // Import pipeline
  importFromMcpServer(serverId: string, tools: MCPToolSchema[]): Promise<void>;
  importFromBit(bitName: string, tools: BitBratTool[]): Promise<void>;
  importFromComposition(compId: string, composition: CompositionSchema): Promise<void>;

  // Deduplication & validation
  deduplicateTool(toolId: string): Promise<void>;
  validateToolSchema(tool: ToolRegistryDocument): Promise<ValidationResult>;
}

// modules/models/model-registry.interface.ts
export interface IModelRegistry {
  // Model retrieval
  getModel(modelId: string): Promise<ModelRegistryDocument | null>;
  queryModels(filters: QueryFilter[]): Promise<ModelRegistryDocument[]>;

  // Model management
  registerModel(model: Partial<ModelRegistryDocument>): Promise<void>;
  updateModel(modelId: string, updates: Partial<ModelRegistryDocument>): Promise<void>;

  // RBAC queries
  getModelPermissions(modelId: string): Promise<ModelPermissions>;
  validateModelToolAccess(modelId: string, toolId: string): Promise<boolean>;
}

// modules/observer/tool-observer.interface.ts
export interface IToolObserver {
  // Metrics queries (Loki/LogQL)
  queryToolMetrics(toolId: string, timeRange: TimeRange): Promise<ToolMetrics>;
  queryModelMetrics(modelId: string, timeRange: TimeRange): Promise<ModelMetrics>;

  // Trace queries
  traceToolInvocation(correlationId: string): Promise<InvocationEvent[]>;

  // Health monitoring
  getToolHealth(toolId: string): Promise<ToolHealthStatus>;
  detectAnomalies(toolId: string, timeRange: TimeRange): Promise<Anomaly[]>;
}

// modules/gateway/tool-gateway.interface.ts
export interface IToolGateway {
  // Tool execution
  execute(
    toolId: string,
    args: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  // RBAC validation
  validateToolAccess(
    toolId: string,
    userId: string,
    modelId: string,
    userRoles: string[]
  ): Promise<RBACValidationResult>;

  // MCP client management
  ensureMcpClient(serverId: string): Promise<void>;
  disconnectMcpClient(serverId: string): Promise<void>;
}
```

**Communication Pattern**: All modules communicate via **in-process method calls** (no MCP, no network overhead). This provides:
- **Zero network latency**: <1µs in-process vs 10-50ms MCP
- **Transactional consistency**: Single process boundary
- **Simpler debugging**: Single call stack, no distributed tracing needed
- **Atomic operations**: Tool registration + RBAC update in single transaction

---

#### 3.4.2 Module Responsibilities

**ToolRegistry Module** (src/apps/tool-orchestrator-service/modules/registry/):
- **Primary Function**: Manage `platform_tool_registry` DocumentStore collection (PostgreSQL)
- **Tool Import Pipeline**: Import from MCP servers, Bits, compositions
- **Tool CRUD**: Create, read, update, disable, deprecate operations
- **Schema Validation**: Validate tool input/output schemas (Zod)
- **Deduplication**: Prevent duplicate tool registration (by canonical ID)
- **Dependencies**: IDocumentStore, PostgreSQL

**ModelRegistry Module** (src/apps/tool-orchestrator-service/modules/models/):
- **Primary Function**: Manage `model_registry` DocumentStore collection (PostgreSQL)
- **Model Catalog**: Security profiles (roles, tier, trust scores)
- **Capability Tracking**: tool-calling, vision, streaming, function-calling
- **Cost Configuration**: Token pricing per model
- **Tool Access Policies**: Allowlist/denylist per model
- **Dependencies**: IDocumentStore, PostgreSQL

**ToolObserver Module** (src/apps/tool-orchestrator-service/modules/observer/):
- **Primary Function**: Query Loki for tool invocation events (LogQL)
- **Metrics Aggregation**: Invocations, error rates, latencies, RBAC denials
- **Trace Queries**: Request tracing by correlationId
- **Health Monitoring**: Derive health status from event stream (healthy/degraded/unhealthy)
- **Anomaly Detection**: Alert on error spikes, RBAC denials, timeouts
- **Dependencies**: Loki (read-only queries)

**ToolGateway Module** (src/apps/tool-orchestrator-service/modules/gateway/):
- **Primary Function**: Tool execution orchestration
- **RBAC Enforcement**: Dual-layer validation (User roles × Model permissions)
- **MCP Client Management**: Connect to external MCP servers
- **Event Logging**: Log all invocations to Loki
- **Execution Routing**: Route to MCP servers, internal handlers, or compositions
- **Dependencies**: ToolRegistry, ModelRegistry, ToolObserver, MCP Client Manager

---

#### 3.4.3 MCP Tools Exposed

The tool-orchestrator Bit exposes all MCP tools at the Bit level (no internal MCP communication). Tools are registered during `setup()` and delegate to internal modules:

**Tool Management Tools** (delegates to ToolRegistry):
- `tool.import` - Import tool from source (MCP server, Bit, composition)
- `tool.update_config` - Update tool RBAC, visibility, config
- `tool.deprecate` - Mark tool as deprecated (soft delete)
- `tool.disable` - Disable tool (prevent new invocations)
- `tool.list` - List all tools (filterable by source, status, RBAC)
- `tool.get` - Get single tool details (full schema + metadata)
- `tool.search` - Search tools by description/tags
- `tool.get_schema` - Get tool input/output JSON schemas

**Model Management Tools** (delegates to ModelRegistry):
- `model.register` - Register new model with trust scores
- `model.update` - Update model config (tier, costs, tool access)
- `model.get` - Get model details (full profile + trust scores)
- `model.list` - List models (filterable by tier, provider)

**Observability Tools** (delegates to ToolObserver):
- `tool.get_metrics` - Query tool metrics from Loki (invocations, errors, latency)
- `tool.trace_request` - Trace request by correlationId (full event timeline)
- `tool.get_health` - Get tool health status (derived from Loki events)
- `tool.query_events` - Query raw events (advanced - LogQL passthrough)
- `model.get_metrics` - Model usage metrics (queries Loki)

**Tool Execution Tools** (delegates to ToolGateway):
- `tool.execute` - Execute tool with RBAC validation
- `tool.validate_access` - Validate RBAC without execution

**Implementation Example**:
```typescript
// src/apps/tool-orchestrator-service/index.ts
async setup(): Promise<void> {
  // Register MCP tool that delegates to ToolRegistry module
  this.registerTool(
    'tool.import',
    'Import tool from external source',
    z.object({
      source: z.enum(['mcp-server', 'bit', 'composition']),
      serverId: z.string().optional(),
      toolId: z.string()
    }),
    async (args) => {
      // Delegate to ToolRegistry module (in-process call)
      if (args.source === 'mcp-server') {
        await this.toolRegistry.importFromMcpServer(args.serverId!, [args.toolId]);
      } else if (args.source === 'bit') {
        await this.toolRegistry.importFromBit(args.serverId!, []);
      }
      return { success: true };
    }
  );
}
```

---

#### 3.4.4 Configuration and Deployment

**Service Configuration** (architecture.yaml):
```yaml
tool-orchestrator:
  profile: core
  category: platform
  kind: pipeline-service
  mcp:
    exposure: platform-only
  env:
    - SERVICE_NAME=tool-orchestrator
    - SERVICE_PORT=3015
    - DATABASE_URL=${DATABASE_URL}
    - LOKI_URL=${LOKI_URL}
    - NATS_URL=${NATS_URL}
  secrets:
    - DATABASE_URL
    - LOKI_URL
  topics:
    consumes: []  # Phase 1: No NATS consumption
    produces: []
```

**Deployment**:
- **Docker**: Single container (standard Dockerfile.service)
- **Scaling**: 1 instance (singleton for Phase 1)
- **Dependencies**: PostgreSQL (required), Loki (required), NATS (optional Phase 2)
- **Ports**: 3015 (HTTP API for MCP)

**Collections/Tables Created**:
- `platform_tool_registry` (DocumentStore - PostgreSQL)
- `model_registry` (DocumentStore - PostgreSQL)
- `mcp_server_registrations` (PostgreSQL - secondary metadata)

**Modified Bits** (behavior changes in existing services):

1. **llm-bot** (Section 6.4)
   - **Change**: Adds `modelId` to ToolExecutionContext (enables model-based RBAC)
   - **Change**: Calls `tool-orchestrator.validateToolAccess()` before tool execution (in-process via MCP)
   - **Unchanged**: LLM inference, tool execution routing, response generation

2. **reflex** (Section 6.5)
   - **Change**: Composition templates include `modelId` in execution context
   - **Change**: RBAC validation for composition tools (calls tool-orchestrator)
   - **Unchanged**: Template compilation, JsonLogic execution

3. **CompositionRegistry** (Section 8.2)
   - **Change**: Validates composition RBAC against model permissions (calls tool-orchestrator)
   - **Unchanged**: Composition compilation, execution, caching

**Unmodified Bits**:
- **ingress-egress**: No changes (continues ingress/egress handling)
- **event-router**: No changes (continues event routing)
- **auth**: No changes (continues user authentication)
- **persistence**: No changes (continues event persistence)
- All other Bits continue unchanged

**External Dependencies Added**:
- **Loki** (log aggregation - ToolObserver module queries only)
- **Promtail** (log shipping - all Bits for event-based observability)

**Migration from Current tool-gateway**:
- Phase 1: Deploy tool-orchestrator alongside existing tool-gateway
- Phase 2: Migrate llm-bot to call tool-orchestrator (feature flag)
- Phase 3: Migrate reflex to call tool-orchestrator
- Phase 4: Deprecate tool-gateway (after validation)
- See Section 9 for detailed migration strategy

---

### 3.5 tool-orchestrator Replaces tool-gateway

**CRITICAL**: This section documents the complete replacement of tool-gateway with tool-orchestrator to prevent conceptual overlap and incorrect implementations.

#### 3.5.1 Current State (tool-gateway - Before This Sprint)

tool-gateway currently owns ALL tool-related responsibilities:

| Responsibility | Current Implementation | Location |
|----------------|------------------------|----------|
| **Tool Registration** | In-memory ToolRegistry (Map<string, BitBratTool>) | src/services/llm-bot/tools/registry.ts |
| **Tool Storage** | Ephemeral (lost on restart) | In-memory only |
| **Tool Discovery** | Direct MCP server queries on registration | McpClientManager |
| **Tool Import** | Automatic on MCP server registration | tool-gateway onMessage handler |
| **Tool RBAC** | Agent-based (agentAllowlist) | RbacEvaluator |
| **Tool Execution** | MCP client invocation | McpClientManager.callTool() |
| **Model Registry** | None (hardcoded in llm-bot) | N/A |
| **Model RBAC** | None (agents only) | N/A |
| **Observability** | Basic error logging only | No structured events |
| **Metrics** | None | N/A |
| **MCP Server Registry** | DocumentStore (mcp_servers collection) | src/common/mcp/server-store.ts |

**Problems**:
1. tool-gateway is a **monolith** handling persistence, orchestration, RBAC, and execution
2. In-memory storage lost on restart
3. No model-based RBAC (only agent-based)
4. No structured observability or metrics

#### 3.5.2 New State (tool-orchestrator - Final State)

tool-orchestrator is a **unified Bit** with four internal modules, each handling a specific concern:

| Concern | Module | Implementation | Storage |
|---------|--------|----------------|---------|
| **Tool Metadata** | ToolRegistry | Manages platform_tool_registry collection | PostgreSQL (DocumentStore) |
| **Tool Import** | ToolRegistry | Parses MCP schemas, normalizes metadata | PostgreSQL (DocumentStore) |
| **Tool CRUD** | ToolRegistry | Create, update, deprecate, disable | PostgreSQL (DocumentStore) |
| **Model Catalog** | ModelRegistry | Manages model_registry collection | PostgreSQL (DocumentStore) |
| **Model RBAC** | ModelRegistry | Security profiles, tool access policies | PostgreSQL (DocumentStore) |
| **Tool Execution** | ToolGateway | Orchestrates execution (MCP/internal/composition) | None (stateless) |
| **RBAC Validation** | ToolGateway | Dual-layer validation (User × Model) | None (queries registries) |
| **Observability** | ToolObserver | Queries Loki for metrics/traces | None (read-only Loki) |
| **Health Monitoring** | ToolObserver | Derives health from event stream | None (read-only Loki) |

**KEY PRINCIPLES**:
1. **Conceptual Separation**: Clear module boundaries (ToolRegistry, ModelRegistry, ToolObserver, ToolGateway)
2. **Code Encapsulation**: Each module has well-defined interface (IToolRegistry, IModelRegistry, etc.)
3. **Single Deployment**: All modules in one Bit (zero network latency, <1µs in-process calls)
4. **Future-Proof**: Clean interfaces allow extraction to separate services if needed

#### 3.5.3 Comparison: tool-gateway vs tool-orchestrator

| Aspect | tool-gateway (OLD) | tool-orchestrator (NEW) |
|--------|-------------------|------------------------|
| **Architecture** | Monolith (all logic in one class) | Modular (4 internal modules) |
| **Tool Storage** | In-memory Map (ephemeral) | PostgreSQL DocumentStore (persistent) |
| **Model Registry** | None (hardcoded in llm-bot) | ModelRegistry module (PostgreSQL) |
| **RBAC** | Agent-based only | Dual-layer (User × Model) |
| **Observability** | Basic error logs | Structured events + Loki queries |
| **Metrics** | None | ToolObserver module (LogQL) |
| **Communication** | Internal method calls | Internal method calls (same, but now between modules) |
| **Deployment** | Single Bit | Single Bit (4 modules) |
| **Latency** | <1ms (in-process) | <1ms (in-process, no change) |
| **MCP Exposure** | platform-only | platform-only |
| **MCP Client Mgmt** | McpClientManager | ToolGateway module (McpClientManager) |
| **Tool Import** | Auto on MCP registration | ToolRegistry module (import pipeline) |
| **Caching** | None | LRU cache in ToolGateway (5min TTL) |

**Key Differences**:
1. **Persistent Storage**: tool-orchestrator persists tools/models (tool-gateway doesn't)
2. **Model-Based RBAC**: tool-orchestrator validates model permissions (tool-gateway doesn't)
3. **Structured Observability**: tool-orchestrator queries Loki (tool-gateway only logs errors)
4. **Modular Code**: tool-orchestrator separates concerns via modules (tool-gateway is monolithic)

#### 3.5.4 tool-orchestrator Architecture (Final State)

```
┌────────────────────────────────────────────────────────────────────┐
│ tool-orchestrator (Unified Bit - Single Deployment)               │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ MCP Tools (platform-only exposure)                           │  │
│  │                                                              │  │
│  │ Tool Management:                                             │  │
│  │ • tool.import, tool.update_config, tool.deprecate, tool.disable │
│  │ • tool.list, tool.get, tool.search, tool.get_schema         │  │
│  │                                                              │  │
│  │ Model Management:                                            │  │
│  │ • model.register, model.update, model.get, model.list       │  │
│  │                                                              │  │
│  │ Observability:                                               │  │
│  │ • tool.get_metrics, tool.trace_request, tool.get_health     │  │
│  │ • model.get_metrics, tool.query_events                       │  │
│  │                                                              │  │
│  │ Tool Execution:                                              │  │
│  │ • tool.execute, tool.validate_access                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Internal Modules (In-Process Communication)                  │  │
│  │                                                              │  │
│  │ ┌────────────────────────────────────────────────────────┐   │  │
│  │ │ ToolRegistry Module                                    │   │  │
│  │ │ • Manages platform_tool_registry (PostgreSQL)          │   │  │
│  │ │ • Tool import pipeline (MCP/Bit/composition)           │   │  │
│  │ │ • Tool CRUD operations                                 │   │  │
│  │ │ • Schema validation (Zod)                              │   │  │
│  │ │ • Deduplication logic                                  │   │  │
│  │ └────────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │ ┌────────────────────────────────────────────────────────┐   │  │
│  │ │ ModelRegistry Module                                   │   │  │
│  │ │ • Manages model_registry (PostgreSQL)                  │   │  │
│  │ │ • Model security profiles (roles, tier, trust)         │   │  │
│  │ │ • Capability tracking (tool-calling, vision, etc.)     │   │  │
│  │ │ • Cost configuration (token pricing)                   │   │  │
│  │ │ • Tool access policies (allowlist/denylist)            │   │  │
│  │ └────────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │ ┌────────────────────────────────────────────────────────┐   │  │
│  │ │ ToolObserver Module                                    │   │  │
│  │ │ • Queries Loki for tool invocation events (LogQL)      │   │  │
│  │ │ • Aggregates metrics (invocations, errors, latencies)  │   │  │
│  │ │ • Trace queries (by correlationId)                     │   │  │
│  │ │ • Health monitoring (from event stream)                │   │  │
│  │ │ • Anomaly detection (error spikes, RBAC denials)       │   │  │
│  │ └────────────────────────────────────────────────────────┘   │  │
│  │                                                              │  │
│  │ ┌────────────────────────────────────────────────────────┐   │  │
│  │ │ ToolGateway Module                                     │   │  │
│  │ │ • Tool execution orchestration                         │   │  │
│  │ │ • RBAC validation (calls ToolRegistry + ModelRegistry) │   │  │
│  │ │ • McpClientManager (MCP transport)                     │   │  │
│  │ │ • Execution routing (MCP/internal/composition)         │   │  │
│  │ │ • Event logging to Loki                                │   │  │
│  │ │ • LRU cache (tool/model metadata, 5min TTL)            │   │  │
│  │ │ • Timeout enforcement                                  │   │  │
│  │ └────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Module Communication (In-Process, <1µs latency)              │  │
│  │                                                              │  │
│  │ ToolGateway calls:                                           │  │
│  │ • this.toolRegistry.getTool(toolId)       // Direct method  │  │
│  │ • this.modelRegistry.getModel(modelId)    // Direct method  │  │
│  │ • this.toolObserver.queryToolMetrics()    // Direct method  │  │
│  │                                                              │  │
│  │ MCP Tools delegate:                                          │  │
│  │ • tool.import → this.toolRegistry.importFromMcpServer()      │  │
│  │ • model.register → this.modelRegistry.registerModel()        │  │
│  │ • tool.get_metrics → this.toolObserver.queryToolMetrics()    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ External Dependencies                                        │  │
│  │                                                              │  │
│  │ → PostgreSQL (required):                                     │  │
│  │   • platform_tool_registry (DocumentStore)                   │  │
│  │   • model_registry (DocumentStore)                           │  │
│  │   • mcp_server_registrations (metadata)                      │  │
│  │                                                              │  │
│  │ → Loki (required):                                           │  │
│  │   • tool_invocation_events (read-only queries)               │  │
│  │   • RBAC denial events                                       │  │
│  │                                                              │  │
│  │ → MCP Servers (external tools via stdio/SSE)                 │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

#### 3.5.5 Request Flow Through tool-orchestrator (Final State)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. llm-bot/reflex calls tool-orchestrator (via MCP)             │
│    tool-orchestrator.executeTool(toolId, args, context)         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. ToolGateway module checks cache                              │
│    this.toolCache.get(toolId) → HIT or MISS                     │
└─────────────────────────────────────────────────────────────────┘
  ↓ (if MISS)
┌─────────────────────────────────────────────────────────────────┐
│ 3. ToolGateway → ToolRegistry (IN-PROCESS, <1µs)                │
│    const tool = await this.toolRegistry.getTool(toolId);        │
│    → Returns ToolRegistryDocument (metadata + RBAC)             │
│    this.toolCache.set(toolId, tool);  // Cache for 5 minutes    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. ToolGateway module checks model cache                        │
│    this.modelCache.get(context.modelId) → HIT or MISS           │
└─────────────────────────────────────────────────────────────────┘
  ↓ (if MISS)
┌─────────────────────────────────────────────────────────────────┐
│ 5. ToolGateway → ModelRegistry (IN-PROCESS, <1µs)               │
│    const model = await this.modelRegistry.getModel(modelId);    │
│    → Returns ModelRegistryDocument (roles, tier, trust)         │
│    this.modelCache.set(modelId, model);  // Cache for 5 minutes │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. ToolGateway validates RBAC (in-memory, <1ms)                 │
│    const result = this.validateToolAccess(                      │
│      tool, context.userRoles, model                             │
│    );                                                           │
│    → Checks user roles, model roles, tier, trust scores        │
│    → Returns { allowed: true } or { allowed: false, reason }    │
└─────────────────────────────────────────────────────────────────┘
  ↓ (if denied)
┌─────────────────────────────────────────────────────────────────┐
│ 7a. ToolGateway logs denial event (async)                       │
│     this.logger.warn({ toolId, modelId, rbacDecision: 'denied' })│
│     return { isError: true, content: 'Access denied' }          │
└─────────────────────────────────────────────────────────────────┘
  ↓ (if allowed)
┌─────────────────────────────────────────────────────────────────┐
│ 7b. ToolGateway routes to execution handler                     │
│     if (tool.source === 'mcp'):                                 │
│       → this.mcpClientManager.callTool(server, tool, args)      │
│     else if (tool.source === 'internal'):                       │
│       → this.internalToolHandler.execute(tool, args)            │
│     else if (tool.source === 'firestore'):                      │
│       → this.firestoreToolHandler.execute(tool, args)           │
│     else if (tool.source === 'composition'):                    │
│       → this.compositionExecutor.execute(tool, args, context)   │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. ToolGateway logs invocation event (async, fire-and-forget)   │
│    this.logger.info({                                           │
│      eventId, correlationId, toolId, modelId,                   │
│      rbacDecision: 'allowed', executionTimeMs, status           │
│    }, 'tool.invocation.success')                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 9. ToolGateway returns result to llm-bot/reflex                 │
│    { isError: false, content: [...] }                           │
└─────────────────────────────────────────────────────────────────┘

**Key Differences from tool-gateway**:
• Steps 3 & 5: IN-PROCESS method calls (<1µs) instead of MCP calls (10-50ms)
• No network serialization/deserialization overhead
• Single call stack for debugging (no distributed tracing needed)
• Transactional consistency (all operations in same process)
```

#### 3.5.6 What tool-orchestrator Does NOT Do (Anti-Patterns)

**NEVER implement these in tool-orchestrator** (common mistakes to avoid):

| Anti-Pattern | Why It's Wrong | Correct Approach |
|--------------|----------------|------------------|
| ❌ **Cache tool metadata indefinitely** | Stale data, no invalidation | Use TTL-based cache (5min) in ToolGateway module |
| ❌ **Implement model selection logic** | Business logic belongs in llm-bot | llm-bot selects model, tool-orchestrator validates RBAC |
| ❌ **Store user/model mappings** | Session state doesn't belong in tool layer | Context provided by caller (llm-bot) |
| ❌ **Implement custom tool execution handlers in Bit** | Violates single responsibility | Create dedicated Bit for custom tool types, register via MCP |
| ❌ **Mix module concerns (ToolRegistry calling ToolObserver)** | Violates module boundaries | Only ToolGateway coordinates between modules |
| ❌ **Bypass RBAC validation** | Security risk | Always validate via ToolGateway.validateToolAccess() |
| ❌ **Store metrics in PostgreSQL** | Wrong data model, expensive queries | Log events to Loki, query via ToolObserver module |
| ❌ **Implement synchronous tool import** | Blocks MCP tool calls | Use async import pipeline in ToolRegistry |
| ❌ **Expose internal modules via MCP** | Breaks encapsulation | Only expose Bit-level tools, delegate to modules internally |
| ❌ **Implement MCP communication between modules** | Unnecessary overhead | Use in-process method calls between modules |

**Critical Rule**: ToolGateway is the ONLY module that coordinates with other modules. ToolRegistry, ModelRegistry, and ToolObserver are standalone modules that never call each other.

#### 3.5.7 Migration Path (tool-gateway → tool-orchestrator)

**Phase 1: Deploy tool-orchestrator (Non-Breaking)**
- Deploy tool-orchestrator Bit alongside existing tool-gateway
- Seed PostgreSQL with initial tool/model metadata from tool-gateway
- Validate tool-orchestrator via MCP tools (tool.list, model.list)
- No changes to llm-bot or reflex (continue using tool-gateway)

**Phase 2: Migrate llm-bot (Feature Flag)**
```typescript
// llm-bot: Add feature flag to switch tool providers
async setup(): Promise<void> {
  if (this.config.ENABLE_TOOL_ORCHESTRATOR) {
    // NEW: Call tool-orchestrator via MCP
    this.toolProvider = this.mcpClientManager.getClient('tool-orchestrator');
  } else {
    // LEGACY: Call tool-gateway via MCP
    this.toolProvider = this.mcpClientManager.getClient('tool-gateway');
  }
}

async executeTool(toolId: string, args: unknown): Promise<ToolResult> {
  // Same interface, different backend
  return await this.toolProvider.callTool('tool.execute', {
    toolId,
    args,
    context: {
      userRoles: this.userRoles,
      modelId: this.selectedModel,  // NEW: Include modelId
      correlationId: this.correlationId
    }
  });
}
```

**Phase 3: Migrate reflex (Feature Flag)**
```typescript
// reflex: Update composition templates to include modelId
async executeComposition(template: CompositionTemplate): Promise<void> {
  const context = {
    userRoles: event.identity.user?.roles || [],
    modelId: template.config.modelId || 'gpt-4',  // NEW
    correlationId: event.correlationId
  };

  // Call tool-orchestrator instead of tool-gateway
  await this.toolOrchestrator.execute(toolId, args, context);
}
```

**Phase 4: Deprecate tool-gateway**
```bash
# After validation:
# 1. Set ENABLE_TOOL_ORCHESTRATOR=true in all environments
# 2. Monitor logs/metrics for 1 week
# 3. Remove tool-gateway from architecture.yaml
# 4. Remove tool-gateway code from src/apps/
```

#### 3.5.8 Module Responsibility Matrix (Final State)

| Concern | ToolGateway | ToolRegistry | ModelRegistry | ToolObserver |
|---------|-------------|--------------|---------------|--------------|
| Tool Execution | ✅ Orchestrates | ❌ | ❌ | ❌ |
| Tool Metadata Storage | ❌ | ✅ Owns (PostgreSQL) | ❌ | ❌ |
| Tool CRUD Operations | ❌ | ✅ Implements | ❌ | ❌ |
| Tool Import Pipeline | ❌ | ✅ Implements | ❌ | ❌ |
| Tool RBAC Validation | ✅ Enforces | ✅ Provides data | ✅ Provides data | ❌ |
| Model Metadata Storage | ❌ | ❌ | ✅ Owns (PostgreSQL) | ❌ |
| Model CRUD Operations | ❌ | ❌ | ✅ Implements | ❌ |
| Tool Invocation Logging | ✅ Emits to Loki | ❌ | ❌ | ❌ |
| Tool Metrics Queries | ❌ | ❌ | ❌ | ✅ Queries Loki |
| Tool Health Queries | ❌ | ✅ Stores status | ❌ | ✅ Queries Loki |
| MCP Client Management | ✅ Owns transport | ❌ | ❌ | ❌ |
| MCP Server Registry | ❌ | ✅ Owns metadata | ❌ | ❌ |
| Caching (LRU) | ✅ L1 (5min TTL) | ❌ | ❌ | ❌ |
| Module Coordination | ✅ ONLY this module | ❌ Never | ❌ Never | ❌ Never |

**Summary**: tool-orchestrator is a **unified Bit** with four internal modules. ToolGateway is the ONLY module that coordinates with others. All other modules are standalone and communicate only with ToolGateway.

**Communication Pattern**:
- ToolGateway → ToolRegistry: `this.toolRegistry.getTool()` (in-process)
- ToolGateway → ModelRegistry: `this.modelRegistry.getModel()` (in-process)
- ToolGateway → ToolObserver: `this.toolObserver.queryToolMetrics()` (in-process)
- ToolRegistry ↔ ModelRegistry: ❌ NEVER (violates encapsulation)
- ToolRegistry ↔ ToolObserver: ❌ NEVER (violates encapsulation)
- ModelRegistry ↔ ToolObserver: ❌ NEVER (violates encapsulation)

---

## 4. Tool Registry Design (PROPOSED)

**Status**: PROPOSED - This section describes new architecture, not current implementation.

See Section 3.4 for full tool-orchestrator details.

### 4.1 Platform Tool Registry Module

**Location**: ToolRegistry module within **tool-orchestrator** Bit (see Section 3.4.1)

**Responsibilities**:
1. **Tool Storage**: DocumentStore-backed registry (collection: `platform_tool_registry`)
2. **Tool CRUD**: Import, update, deprecate, disable tools
3. **RBAC Data**: Provides tool RBAC configuration to ToolGateway module
4. **Schema Validation**: Validates tool input/output schemas (Zod)
5. **Health Tracking**: Tool availability status
6. **Deduplication**: Handle multiple sources providing same tool

### 4.2 Tool Registry API

**MCP Tools** (exposed by **tool-orchestrator** Bit, delegated to ToolRegistry module):

```typescript
// Administrative Tools (platform-only)
'tool.import'           // Import tool from source (MCP server or Bit)
'tool.update_config'    // Update tool configuration (timeout, RBAC, etc.)
'tool.deprecate'        // Mark tool as deprecated
'tool.disable'          // Disable tool (block invocations)
'tool.get_metrics'      // Get tool performance metrics
'tool.list'             // List all tools (filterable)
'tool.get'              // Get single tool details

// User Tools (platform+domain)
'tool.search'           // Search tools by description/tags
'tool.get_schema'       // Get tool input/output schemas
```

**REST API** (for programmatic access):

```
GET    /v1/tools                  # List tools
GET    /v1/tools/:id              # Get tool details
POST   /v1/tools/import           # Import tool
PATCH  /v1/tools/:id/config       # Update config
DELETE /v1/tools/:id              # Disable tool
GET    /v1/tools/:id/metrics      # Get metrics
POST   /v1/tools/:id/health-check # Trigger health check
```

### 4.3 Tool Registry Schema

**TypeScript Interface**:

```typescript
interface ToolRegistryDocument {
  // Identity
  id: string;                      // Canonical tool ID
  canonicalName: string;           // Human-readable name
  description: string;

  // Source
  source: 'internal' | 'mcp' | 'composition';
  sourceMetadata: {
    serverName?: string;           // For MCP tools
    bitName?: string;              // For internal tools
    compositionId?: string;        // For compositions
    version?: string;
    transportType?: 'stdio' | 'sse';
  };

  // Schema
  inputSchema: Record<string, any>;  // Zod schema as JSON
  outputSchema?: Record<string, any>;

  // RBAC (User × Model)
  rbac: {
    userRoles: {
      required: string[];          // User must have ALL these roles
      denied: string[];            // User must have NONE of these roles
    };
    modelRoles: {
      required: string[];          // Model must have ALL these roles
      denied: string[];            // Model must have NONE of these roles
    };
    modelTiers: {
      allowed: string[];           // Model tier must be in this list (if non-empty)
      denied: string[];            // Model tier must NOT be in this list
    };
    minTrustThresholds?: {         // Optional: Minimum trust scores required
      scope?: string;              // Default: 'tool-use'
      reliability?: number;        // 0-100: Minimum reliability score
      fidelity?: number;           // 0-100: Minimum fidelity score
      integrity?: number;          // 0-100: Minimum integrity score
      calibration?: number;        // 0-100: Minimum calibration score
    };
  };

  // Configuration
  config: {
    timeoutMs: number;             // Default: 60000
    maxRetryAttempts: number;      // Default: 3
    retryBackoffMs: number;        // Default: 1000
    rateLimitPerMinute?: number;
    costTier: 'free' | 'standard' | 'premium' | 'enterprise';
  };

  // Health Tracking (lightweight, for quick status checks)
  health: {
    lastInvocationAt?: string;     // ISO 8601 timestamp
    lastSuccessAt?: string;        // Last successful invocation
    lastErrorAt?: string;          // Last error timestamp
    status: 'healthy' | 'degraded' | 'unhealthy';  // Derived from recent invocation events
  };

  // Lifecycle
  status: 'active' | 'deprecated' | 'disabled';
  importedAt: string;              // ISO 8601
  lastHealthCheckAt?: string;
  lastUpdatedAt: string;

  // Note: Detailed metrics derived from invocation event log (Loki), not stored in registry

  // Metadata
  tags: string[];
  category?: string;
  relatedTools: string[];
}
```

**DocumentStore Implementation**:

```typescript
import { IDocumentStore } from '../common/persistence/interfaces';

class ToolRegistry {
  constructor(
    private readonly store: IDocumentStore,
    private readonly collection: string = 'platform_tool_registry'
  ) {}

  async importTool(tool: ToolRegistryDocument): Promise<void> {
    // Check for duplicates
    const existing = await this.store.get<ToolRegistryDocument>(this.collection, tool.id);
    if (existing) {
      throw new Error(`Tool ${tool.id} already exists`);
    }

    await this.store.set(this.collection, tool.id, tool);
  }

  async getTool(toolId: string): Promise<ToolRegistryDocument | null> {
    return await this.store.get<ToolRegistryDocument>(this.collection, toolId);
  }

  async queryTools(options: QueryOptions): Promise<ToolRegistryDocument[]> {
    return await this.store.query<ToolRegistryDocument>(this.collection, options);
  }

  // Note: Detailed metrics queried from Loki (Section 7), not stored in registry
  // Only health timestamps are stored for lightweight status checks
  async updateHealth(toolId: string, health: Partial<ToolRegistryDocument['health']>): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error(`Tool ${toolId} not found`);

    tool.health = { ...tool.health, ...health };
    tool.lastUpdatedAt = new Date().toISOString();
    await this.store.set(this.collection, toolId, tool, true); // merge mode
  }

  async updateConfig(toolId: string, config: Partial<ToolRegistryDocument['config']>): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error(`Tool ${toolId} not found`);

    tool.config = { ...tool.config, ...config };
    tool.lastUpdatedAt = new Date().toISOString();
    await this.store.set(this.collection, toolId, tool, true);
  }

  async disableTool(toolId: string): Promise<void> {
    const tool = await this.getTool(toolId);
    if (!tool) throw new Error(`Tool ${toolId} not found`);

    tool.status = 'disabled';
    tool.lastUpdatedAt = new Date().toISOString();
    await this.store.set(this.collection, toolId, tool, true);
  }

  // Watch for tool registry changes (useful for cache invalidation)
  watchTools(callback: (tools: ToolRegistryDocument[]) => void): () => void {
    return this.store.watch<ToolRegistryDocument>(this.collection, callback);
  }
}
```

**Queryable Fields** (via DocumentStore query interface):
- `source` - Filter by tool source
- `status` - Filter active/deprecated/disabled
- `category` - Filter by category
- `tags` - Array-contains queries for tag matching
- `config.costTier` - Filter by cost tier
- `rbac.modelTiers.allowed` - Array-contains queries for tier matching

### 4.4 In-Memory Cache

**Design**: ToolRegistryCache (wraps DocumentStore)
- Read-through cache for `getTool(id)`
- Write-through cache for metrics updates
- Invalidation on configuration changes
- TTL: 5 minutes for tool metadata, 1 minute for metrics

**Benefits**:
- Sub-millisecond tool lookup (critical for llm-bot latency)
- Reduced database load for high-frequency operations
- Eventually consistent metrics (acceptable for observability)

---

## 5. Tool Import/Discovery Process

### 5.1 Import Pipeline

```
┌──────────────┐
│  Discovery   │  Enumerate available tools from source
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Validation  │  Validate schema, metadata, dependencies
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Deduplication│  Check if tool already exists (by canonical ID)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Registration │  Insert into platform_tool_registry
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Notification │  Broadcast tool availability to clients
└──────────────┘
```

### 5.2 MCP Server Tool Import

**Process**:
1. Admin calls `tool.import` with MCP server connection config
2. Import subsystem establishes connection (HTTP/stdio)
3. Call MCP `tools/list` RPC
4. For each tool:
   - Validate schema (JSON Schema → Zod conversion if needed)
   - Generate canonical ID (strip server prefix, normalize)
   - Check for duplicates (by canonical ID + sourceMetadata)
   - Merge or skip if duplicate
   - Insert into registry with default RBAC/config
5. Store server metadata in `mcp_server_registrations` table
6. Broadcast tool availability notification

**Example**:
```typescript
// User calls tool.import
await toolRegistry.importTool({
  type: 'mcp',
  connection: {
    transport: 'http',
    url: 'http://image-gen-mcp:3000/mcp'
  },
  defaultConfig: {
    userRoles: { required: ['user'] },
    modelRoles: { required: ['premium'] },  // Only premium models
    modelTiers: { allowed: ['premium', 'enterprise'] },
    timeoutMs: 120000,  // Image generation needs longer timeout
    costTier: 'premium'
  }
});

// Result:
[
  { id: 'generate_image', status: 'imported', conflict: false },
  { id: 'moderate_image', status: 'imported', conflict: false }
]
```

### 5.3 Bit Tool Import

**Process** (PROPOSED):
1. Bit publishes `INTERNAL_MCP_REGISTRATION_V1` (existing flow)
2. tool-orchestrator receives registration message (via MCP subscription)
3. **PROPOSED**: tool-orchestrator **will delegate** to **ToolRegistry module** (internal - see Section 3.4.1):
   - ToolRegistry **will extract** tool metadata from registration message
   - **Will call** import pipeline for each tool (in-process)
   - **Will apply** Bit-specific defaults (RBAC, config)
   - **Will deduplicate** with existing tools
4. ToolRegistry **will store** Bit metadata separately (no longer in McpServerStore)
5. Tools **will be** addressable by canonical ID, not Bit name

**Deduplication Strategy**:
- If canonical ID exists with same source: Update metadata
- If canonical ID exists with different source: Log conflict, prefer internal>composition>mcp
- If new canonical ID: Register

### 5.4 Composition Tool Import

**Process**:
1. Composition registered via `composition.register` (existing flow)
2. **NEW**: CompositionRegistry calls tool import pipeline:
   - Validate RBAC of constituent tools against MODEL permissions (see §7.4)
   - Generate canonical ID from composition name
   - Inherit most restrictive RBAC from constituent tools
   - Insert into registry with source='composition'
3. Composition now appears in tool listings alongside primitive tools

---

## 6. Model-Based RBAC System (PROPOSED)

**Status**: PROPOSED - This section describes new architecture, not current implementation.

See Section 3.4.2 for ModelRegistry module details.

### 6.1 Design Principles

**Core Rule**: **Model restrictions always constrain user permissions**

```
Effective Permission = User Permissions ∩ Model Permissions
```

- If user has role `admin` but model lacks role `admin-capable`, access is DENIED
- If user lacks role `admin` but model has role `admin-capable`, access is DENIED
- Both user AND model must satisfy RBAC requirements

**Why Model-Based?**

| Entity | Role | Rationale |
|--------|------|-----------|
| **User** | Permission holder | What the human is allowed to do |
| **Model** | Decision maker | What intelligence is making the decision |
| **Agent** | Orchestrator | Just routes requests (not security principal) |

**Model as Security Principal**:
- Models have different capabilities (vision, function-calling)
- Models have different trust scores across dimensions (gpt-4 > gpt-3.5-turbo)
- Models have different cost profiles (expensive vs. cheap)
- **Models make tool decisions**, so they must have permissions

### 6.2 Model Registry Design

**Owned by**: **ModelRegistry module** within tool-orchestrator Bit (Section 3.4.2)

**Purpose**: Catalog of available LLM models with their security profiles

**Current State**:
- No dedicated model registry exists in the codebase
- Model configuration hardcoded in llm-bot service
- No persistent model metadata storage
- No model-level RBAC (only agent-based)

**PROPOSED Ownership** (Sprint 55):
- **ModelRegistry module** (NEW - see Section 3.4.2) owns `model_registry` collection
- **tool-orchestrator** exposes CRUD operations via MCP tools (platform-only exposure), delegated to ModelRegistry
- ToolGateway module queries ModelRegistry for model catalog (in-process, <1µs)
- llm-bot queries tool-orchestrator for model capabilities/trust scores (via MCP)

**Schema** (PROPOSED):
```typescript
// PROPOSED: ModelRegistryDocument interface (NEW)
// Multi-dimensional trust model for LLM models
type ModelTrust = {
  scope: string;  // "general", "coding", "reasoning", "tool-use"

  scores: {
    reliability: number;   // 0-100: Produces correct, useful results
    fidelity: number;      // 0-100: Follows instructions and constraints
    integrity: number;     // 0-100: Respects boundaries; resists manipulation
    calibration: number;   // 0-100: Recognizes uncertainty and limitations
  };

  evidence: {
    source: "benchmark" | "observed" | "manual" | "mixed";
    samples: number;       // Number of observations
    updatedAt: string;     // ISO 8601 timestamp
  };
};

interface ModelRegistryDocument {
  // Identity
  id: string;                      // e.g., "gpt-4", "claude-sonnet-3.5"
  provider: string;                // "openai", "anthropic", "ollama"
  displayName: string;             // "GPT-4 (OpenAI)"
  description: string;

  // Security Profile
  roles: string[];                 // ['model', 'premium', 'vision', 'function-calling']
  tier: string;                    // 'free' | 'basic' | 'premium' | 'enterprise'
  trust: ModelTrust[];             // Multi-dimensional trust scores per scope

  // Capabilities
  capabilities: {
    toolCalling: boolean;
    vision: boolean;
    streaming: boolean;
    maxContextTokens: number;
    maxOutputTokens: number;
  };

  // Cost
  cost: {
    inputTokenCost: number;        // USD per 1M tokens
    outputTokenCost: number;
  };

  // Tool Access Policy
  toolPolicy: {
    allowedTools: string[];        // Explicit whitelist
    deniedTools: string[];         // Explicit blacklist
    maxCostPerCall?: number;       // Max $ per tool call
    maxConcurrentTools?: number;
  };

  // Metrics
  metrics: {
    totalRequests: number;
    totalTokensUsed: number;
    totalCostUSD: number;
  };
}
```

**DocumentStore Schema** (`model_registry` collection):

Documents in the `model_registry` collection follow the `ModelRegistryDocument` interface above. The platform's DocumentStore abstraction (IDocumentStore) handles persistence, supporting both PostgreSQL (with JSONB) and Firestore backends.

**Storage Implementation**:
```typescript
import { IDocumentStore } from '../common/persistence/interfaces';

class ModelRegistry {
  constructor(
    private readonly store: IDocumentStore,
    private readonly collection: string = 'model_registry'
  ) {}

  async registerModel(model: ModelRegistryDocument): Promise<void> {
    await this.store.set(this.collection, model.id, model);
  }

  async getModel(modelId: string): Promise<ModelRegistryDocument | null> {
    return await this.store.get<ModelRegistryDocument>(this.collection, modelId);
  }

  async queryModels(options: QueryOptions): Promise<ModelRegistryDocument[]> {
    return await this.store.query<ModelRegistryDocument>(this.collection, options);
  }

  async updateMetrics(modelId: string, metrics: Partial<ModelRegistryDocument['metrics']>): Promise<void> {
    const model = await this.getModel(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    model.metrics = { ...model.metrics, ...metrics };
    await this.store.set(this.collection, modelId, model, true); // merge mode
  }

  // Watch for model registry changes (useful for cache invalidation)
  watchModels(callback: (models: ModelRegistryDocument[]) => void): () => void {
    return this.store.watch<ModelRegistryDocument>(this.collection, callback);
  }
}
```

**Queryable Fields** (via DocumentStore query interface):
- `provider` - Filter by model provider
- `tier` - Filter by tier (free, basic, premium, enterprise)
- `roles` - Array-contains queries for role matching
- `status` - Filter active/inactive models
- `trust[].scope` - Filter by trust scope
- `trust[].scores.*` - Filter by trust dimension scores

### 6.3 RBAC Evaluation Algorithm (PROPOSED)

**Current State** (src/common/mcp/rbac.ts):
- Current implementation: `RbacEvaluator.isAllowedTool()` method
- Agent-based RBAC only (checks `agentAllowlist` in tool metadata)
- No model-level permissions
- Binary allow/deny logic (no dual-layer intersection)

**PROPOSED Changes** (Sprint 55):

This replaces `RbacEvaluator.isAllowedTool()` with dual-layer RBAC (User × Model):

```typescript
function validateToolAccess(
  toolId: string,
  userRoles: string[],
  modelId: string
): { allowed: boolean; reason?: string } {
  const tool = toolRegistry.getTool(toolId);
  if (!tool) return { allowed: false, reason: 'tool_not_found' };

  const model = modelRegistry.getModel(modelId);
  if (!model) return { allowed: false, reason: 'model_not_found' };

  const rbac = tool.rbac;

  // 1. Check user required roles
  const userHasRequiredRoles = rbac.userRoles.required.every(role =>
    userRoles.includes(role)
  );
  if (!userHasRequiredRoles) {
    return { allowed: false, reason: 'user_missing_required_roles' };
  }

  // 2. Check user denied roles
  const userHasDeniedRole = rbac.userRoles.denied.some(role =>
    userRoles.includes(role)
  );
  if (userHasDeniedRole) {
    return { allowed: false, reason: 'user_has_denied_role' };
  }

  // 3. Check model required roles
  const modelHasRequiredRoles = rbac.modelRoles.required.every(role =>
    model.roles.includes(role)
  );
  if (!modelHasRequiredRoles) {
    return {
      allowed: false,
      reason: 'model_missing_required_roles',
      details: `Model ${modelId} lacks required roles: ${rbac.modelRoles.required.join(', ')}`
    };
  }

  // 4. Check model denied roles
  const modelHasDeniedRole = rbac.modelRoles.denied.some(role =>
    model.roles.includes(role)
  );
  if (modelHasDeniedRole) {
    return {
      allowed: false,
      reason: 'model_has_denied_role',
      details: `Model ${modelId} is explicitly denied`
    };
  }

  // 5. Check model tier restrictions
  if (rbac.modelTiers.allowed.length > 0) {
    if (!rbac.modelTiers.allowed.includes(model.tier)) {
      return {
        allowed: false,
        reason: 'model_tier_not_allowed',
        details: `Tool requires model tier: ${rbac.modelTiers.allowed.join(' or ')}, but ${modelId} is tier ${model.tier}`
      };
    }
  }

  if (rbac.modelTiers.denied.includes(model.tier)) {
    return {
      allowed: false,
      reason: 'model_tier_denied',
      details: `Tool explicitly denies model tier: ${model.tier}`
    };
  }

  // 6. Check model's tool policy (allowlist/denylist)
  if (model.toolPolicy.deniedTools.includes(toolId)) {
    return {
      allowed: false,
      reason: 'model_policy_denies_tool',
      details: `Model ${modelId} policy denies tool ${toolId}`
    };
  }

  if (model.toolPolicy.allowedTools.length > 0) {
    if (!model.toolPolicy.allowedTools.includes(toolId)) {
      return {
        allowed: false,
        reason: 'model_policy_allows_only_specific_tools',
        details: `Model ${modelId} only allows specific tools, ${toolId} not included`
      };
    }
  }

  // 7. Check model trust thresholds (if tool requires minimum trust)
  if (tool.rbac.minTrustThresholds) {
    const scope = tool.rbac.minTrustThresholds.scope || 'tool-use';
    const modelTrust = model.trust.find(t => t.scope === scope);

    if (!modelTrust) {
      return {
        allowed: false,
        reason: 'model_trust_scope_not_found',
        details: `Model ${modelId} has no trust profile for scope: ${scope}`
      };
    }

    // Check each trust dimension threshold
    const thresholds = tool.rbac.minTrustThresholds;
    for (const [dimension, minScore] of Object.entries(thresholds)) {
      if (dimension === 'scope') continue; // Skip scope field

      const actualScore = modelTrust.scores[dimension as keyof typeof modelTrust.scores];
      if (actualScore < minScore) {
        return {
          allowed: false,
          reason: 'model_trust_insufficient',
          details: `Tool requires ${dimension} >= ${minScore}, but ${modelId} has ${actualScore} (scope: ${scope})`
        };
      }
    }
  }

  return { allowed: true };
}
```

### 6.4 Request Context Propagation

**Critical**: Model identity must flow through entire request lifecycle

**Current State** (src/types/tools.ts:9-22):
```typescript
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  agentName?: string;           // Current agent-based RBAC (being removed)
  correlationId?: string;
  signal?: AbortSignal;
  sessionId?: string;
  // modelId does NOT exist - being added in this sprint
}
```

**PROPOSED Changes** (Sprint 55):
```typescript
interface ToolExecutionContext {
  userRoles: string[];
  userId?: string;
  modelId: string;              // NEW: Model making the decision
  correlationId?: string;
  signal?: AbortSignal;         // Preserved from current
  sessionId?: string;
  // Removed: agentName (no longer security principal)
}
```

**Invocation Flow**:
```
User Request → llm-bot
  ↓
llm-bot selects model (gpt-4)
  ↓
Context created: { userRoles: ['user'], modelId: 'gpt-4' }
  ↓
LLM decides to call tool: generate_image
  ↓
RBAC Check: validateToolAccess('generate_image', ['user'], 'gpt-4')
  ↓
Tool invocation with context: { modelId: 'gpt-4', ... }
  ↓
If tool calls another tool (nested), SAME context propagates
  ↓
All operations inherit gpt-4 permissions
```

### 6.5 Model Registration

**Default Models** (seeded on platform init):

```yaml
# Premium Models
- id: gpt-4
  provider: openai
  roles: [model, premium, vision, function-calling, admin-capable]
  tier: premium
  trust:
    - scope: general
      scores:
        reliability: 95
        fidelity: 95
        integrity: 90
        calibration: 85
      evidence:
        source: benchmark
        samples: 10000
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 95
        fidelity: 95
        integrity: 95
        calibration: 90
      evidence:
        source: mixed
        samples: 5000
        updatedAt: "2025-01-15T00:00:00Z"

- id: claude-opus-3.5
  provider: anthropic
  roles: [model, premium, vision, function-calling, admin-capable]
  tier: premium
  trust:
    - scope: general
      scores:
        reliability: 95
        fidelity: 95
        integrity: 95
        calibration: 90
      evidence:
        source: benchmark
        samples: 8000
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 95
        fidelity: 95
        integrity: 95
        calibration: 90
      evidence:
        source: mixed
        samples: 4500
        updatedAt: "2025-01-15T00:00:00Z"

# Standard Models
- id: gpt-4-turbo
  provider: openai
  roles: [model, premium, vision, function-calling]
  tier: premium
  trust:
    - scope: general
      scores:
        reliability: 90
        fidelity: 90
        integrity: 85
        calibration: 80
      evidence:
        source: benchmark
        samples: 7000
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 90
        fidelity: 90
        integrity: 90
        calibration: 85
      evidence:
        source: mixed
        samples: 3500
        updatedAt: "2025-01-15T00:00:00Z"

- id: claude-sonnet-3.5
  provider: anthropic
  roles: [model, premium, function-calling]
  tier: premium
  trust:
    - scope: general
      scores:
        reliability: 90
        fidelity: 90
        integrity: 90
        calibration: 85
      evidence:
        source: benchmark
        samples: 6500
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 90
        fidelity: 90
        integrity: 90
        calibration: 85
      evidence:
        source: mixed
        samples: 3200
        updatedAt: "2025-01-15T00:00:00Z"

# Basic Models
- id: gpt-3.5-turbo
  provider: openai
  roles: [model, basic, function-calling]
  tier: basic
  trust:
    - scope: general
      scores:
        reliability: 70
        fidelity: 75
        integrity: 65
        calibration: 60
      evidence:
        source: benchmark
        samples: 5000
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 70
        fidelity: 70
        integrity: 70
        calibration: 65
      evidence:
        source: mixed
        samples: 2000
        updatedAt: "2025-01-15T00:00:00Z"
  toolPolicy:
    deniedTools: [generate_image, generate_video, admin.*]
    maxCostPerCall: 0.10

# Local Models
- id: ollama/llama-3.1
  provider: ollama
  roles: [model, local]
  tier: free
  trust:
    - scope: general
      scores:
        reliability: 50
        fidelity: 55
        integrity: 60
        calibration: 50
      evidence:
        source: observed
        samples: 500
        updatedAt: "2025-01-15T00:00:00Z"
    - scope: tool-use
      scores:
        reliability: 45
        fidelity: 50
        integrity: 55
        calibration: 45
      evidence:
        source: observed
        samples: 200
        updatedAt: "2025-01-15T00:00:00Z"
  toolPolicy:
    allowedTools: [get_time, get_weather, search_web]
    deniedTools: [admin.*, state.set, generate_*]
```

**MCP Admin Tools** (exposed by **tool-orchestrator**, delegated to ModelRegistry module):
```typescript
'model.register'      // Register new model
'model.update'        // Update model config
'model.get'           // Get model details
'model.list'          // List models
'model.get_metrics'   // Model usage metrics (delegated to ToolObserver module)
```

### 6.6 RBAC Configuration Examples

**Example 1: Premium-only tool**
```yaml
tool: generate_image
rbac:
  userRoles:
    required: [user]
  modelRoles:
    required: [premium]
  modelTiers:
    allowed: [premium, enterprise]
```
Result: Regular users can invoke, BUT ONLY when using premium models (gpt-4, claude-opus)

**Example 2: Admin tool with model role requirements**
```yaml
tool: admin.delete_user
rbac:
  userRoles:
    required: [admin]
  modelRoles:
    required: [admin-capable]
  modelTiers:
    allowed: [premium]
```
Result: Only admin users AND premium models with admin-capable role

**Example 3: Cost-controlled tool**
```yaml
tool: analyze_video
rbac:
  userRoles:
    required: [user]
  modelRoles:
    required: []  # No specific model role
  modelTiers:
    denied: [free, basic]  # Too expensive for cheap models
config:
  costTier: premium
```
Result: Any user, but model must be premium/enterprise tier

**Example 4: Local-only restriction**
```yaml
tool: admin.export_database
rbac:
  userRoles:
    required: [admin]
  modelRoles:
    denied: [external]  # No cloud models
  modelTiers:
    allowed: [local]
```
Result: Only local models (ollama) can execute sensitive operations

**Example 5: Trust-based restrictions (Financial operations)**
```yaml
tool: financial.execute_transaction
rbac:
  userRoles:
    required: [finance]
  modelTiers:
    allowed: [premium, enterprise]
  minTrustThresholds:
    scope: tool-use
    reliability: 90  # Must produce correct results 90%+ of time
    fidelity: 90     # Must follow instructions precisely
    integrity: 95    # Must resist manipulation attempts
    calibration: 80  # Must recognize when uncertain
```
**Evaluation**:
- User with role `finance` + gpt-4 (reliability: 95, fidelity: 95, integrity: 95, calibration: 90) → **ALLOWED** ✅
- User with role `finance` + gpt-3.5-turbo (reliability: 70, fidelity: 70, integrity: 70, calibration: 65) → **DENIED** ❌ (fails all trust thresholds)
- User with role `finance` + claude-sonnet-3.5 (reliability: 90, fidelity: 90, integrity: 90, calibration: 85) → **ALLOWED** ✅

**Example 6: Trust-based restrictions (Code execution)**
```yaml
tool: system.execute_code
rbac:
  userRoles:
    required: [developer]
  modelTiers:
    allowed: [premium]
  minTrustThresholds:
    scope: coding
    reliability: 85
    integrity: 90   # Critical: must not execute malicious code
    calibration: 75 # Must recognize when code is unsafe
```
**Result**: Only models with strong coding integrity can execute code, even if user is authorized

**Example 7: Composite trust requirements (Medical diagnosis)**
```yaml
tool: medical.generate_diagnosis
rbac:
  userRoles:
    required: [medical-professional]
  modelTiers:
    allowed: [enterprise]  # Highest tier only
  minTrustThresholds:
    scope: reasoning
    reliability: 95  # Lives depend on correct results
    calibration: 95  # MUST recognize uncertainty and defer to humans
    fidelity: 90     # Must follow medical protocols precisely
```
**Result**: Only enterprise-tier models with exceptional reasoning trust scores can assist with medical diagnosis

---

## 7. Request Flow and Tool Execution Lifecycle (PROPOSED)

This section details how tool-using Bits (llm-bot, reflex) interact with the new tool-centric architecture.

### 7.1 High-Level Request Flow

```
User Request (Discord/Twitch/API)
  ↓
ingress-egress → internal.ingress.v1
  ↓
auth → internal.user.enriched.v1 (adds user identity/roles)
  ↓
event-router → internal.analysis.v1 (routes to llm-bot)
  ↓
┌────────────────────────────────────────────────────────────────┐
│ llm-bot (Tool Consumer)                                        │
│                                                                │
│ 1. Select model (gpt-4) based on request complexity           │
│ 2. Query tool-orchestrator for model capabilities (via MCP)   │
│ 3. Create ToolExecutionContext { userRoles, modelId }         │
│ 4. Call LLM with available tools                              │
│ 5. LLM decides to invoke tool: generate_image                 │
│ 6. Call tool-orchestrator.execute(toolId, args, context)      │
└────────────────────────────────────────────────────────────────┘
  ↓
┌────────────────────────────────────────────────────────────────┐
│ tool-orchestrator (Unified Bit - Internal Modules)            │
│                                                                │
│ 1. ToolGateway receives execute('generate_image', args, ctx)  │
│ 2. ToolGateway → ToolRegistry.getTool() (IN-PROCESS, <1µs)    │
│ 3. ToolGateway → ModelRegistry.getModel() (IN-PROCESS, <1µs)  │
│ 4. ToolGateway validates RBAC (in-memory):                    │
│    ├─ Check user required/denied roles                        │
│    ├─ Check model required/denied roles                       │
│    ├─ Check model tier restrictions                           │
│    └─ Check trust score thresholds                            │
│ 5. ToolGateway executes tool via appropriate handler:         │
│    ├─ MCP tool: Call external MCP server                      │
│    ├─ Internal tool: Call local implementation                │
│    ├─ Firestore tool: Query Firestore                         │
│    └─ Composition tool: Execute composition graph             │
│ 6. ToolGateway logs invocation event to Loki                  │
│ 7. ToolGateway returns result to llm-bot (via MCP)            │
└────────────────────────────────────────────────────────────────┘
  ↓
llm-bot processes result → formats response → internal.egress.v1
  ↓
ingress-egress delivers response to user

**Key Architecture Note**: Steps 2-3 use in-process method calls between modules
(<1µs latency) instead of MCP/network calls (10-50ms latency).
```

### 7.2 llm-bot Tool Invocation Sequence

**Scenario**: User asks "Generate an image of a sunset"

```typescript
// SEQUENCE DIAGRAM (PROPOSED)

User → ingress-egress: "Generate an image of a sunset"
ingress-egress → auth: Enrich user identity
auth → llm-bot: Event with userRoles=['user'], userId='user-123'

╔═══════════════════════════════════════════════════════════════╗
║ llm-bot: Model Selection and Tool Invocation                  ║
╚═══════════════════════════════════════════════════════════════╝

llm-bot → llm-bot: Analyze request complexity
llm-bot → llm-bot: Select model: gpt-4 (vision + function-calling)

// Query model capabilities from tool-orchestrator
llm-bot → tool-orchestrator (MCP): model.get('gpt-4')
  // INTERNALLY (tool-orchestrator):
  // ToolGateway → ModelRegistry.getModel('gpt-4') (IN-PROCESS, <1µs)
tool-orchestrator → llm-bot: {
  id: 'gpt-4',
  capabilities: { toolCalling: true, vision: true },
  tier: 'premium',
  roles: ['model', 'premium', 'function-calling', 'vision'],
  trust: [{ scope: 'general', scores: { reliability: 95, ... }}]
}

// Create execution context
llm-bot → llm-bot: Create ToolExecutionContext {
  userRoles: ['user'],
  userId: 'user-123',
  modelId: 'gpt-4',
  correlationId: 'abc-123',
  sessionId: 'session-456'
}

// Query available tools from tool-orchestrator
llm-bot → tool-orchestrator (MCP): tool.list({ modelId: 'gpt-4' })
  // INTERNALLY (tool-orchestrator):
  // ToolGateway → ToolRegistry.queryTools() (IN-PROCESS, <1µs)
  // ToolGateway → ModelRegistry.getModel() (IN-PROCESS, <1µs)
  // ToolGateway filters by RBAC (pre-filter for performance)
tool-orchestrator → llm-bot: Available tools (RBAC-filtered for gpt-4)

// Call LLM with tools
llm-bot → OpenAI API: generateText({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Generate image of sunset' }],
  tools: [generate_image, ...],
  maxSteps: 5
})

// LLM decides to call tool
OpenAI API → llm-bot: {
  toolCalls: [{
    toolName: 'generate_image',
    args: { prompt: 'beautiful sunset over ocean', size: '1024x1024' }
  }]
}

╔═══════════════════════════════════════════════════════════════╗
║ tool-orchestrator: RBAC Validation and Execution              ║
╚═══════════════════════════════════════════════════════════════╝

// Execute tool via tool-orchestrator
llm-bot → tool-orchestrator (MCP): tool.execute({
  toolId: 'generate_image',
  args: { prompt: '...', size: '1024x1024' },
  context: { userRoles: ['user'], modelId: 'gpt-4', correlationId: '...' }
})

// INTERNALLY (tool-orchestrator):
// ToolGateway fetches tool metadata (in-process)
ToolGateway → ToolRegistry.getTool('generate_image') (IN-PROCESS, <1µs)
ToolRegistry → ToolGateway: {
  id: 'generate_image',
  source: 'mcp',
  originServer: 'image-gen-mcp',
  rbac: {
    userRoles: { required: [], denied: ['banned'] },
    modelRoles: { required: ['function-calling'], denied: [] },
    modelTiers: { allowed: ['premium', 'enterprise'], denied: [] },
    trustThresholds: [{ scope: 'general', min: { reliability: 80 }}]
  },
  config: { estimatedCostUSD: 0.02, maxExecutionMs: 30000 }
}

// ToolGateway fetches model metadata (in-process, or from LRU cache)
ToolGateway → ModelRegistry.getModel('gpt-4') (IN-PROCESS, <1µs or CACHED)
ModelRegistry → ToolGateway: { (model metadata from above) }

// ToolGateway validates RBAC (in-memory)
ToolGateway → ToolGateway: validateToolAccess(
  tool='generate_image',
  userRoles=['user'],
  modelId='gpt-4'
) {
  // 1. User role check: ✓ (no required roles, user not banned)
  // 2. Model role check: ✓ (gpt-4 has 'function-calling')
  // 3. Model tier check: ✓ (gpt-4 is 'premium')
  // 4. Trust threshold check: ✓ (reliability: 95 >= 80)
  return { allowed: true };
}

// ToolGateway executes tool via MCP (external MCP server)
ToolGateway → image-gen-mcp (MCP): generate_image({ prompt: '...', size: '...' })
image-gen-mcp → OpenAI API: images.generate({ model: 'dall-e-3', prompt: '...' })
OpenAI API → image-gen-mcp: { url: 'https://...' }
image-gen-mcp → ToolGateway: { content: [{ type: 'text', text: 'https://...' }] }

// ToolGateway logs invocation event to Loki
ToolGateway → ToolGateway: logger.info({
  eventId: 'evt-789',
  correlationId: 'abc-123',
  toolId: 'generate_image',
  toolSource: 'mcp',
  modelId: 'gpt-4',
  modelTier: 'premium',
  userRoles: ['user'],
  rbacDecision: 'allowed',
  executionTimeMs: 28500,
  estimatedCostUSD: 0.02
}, 'tool.invocation.success')

// Return result to llm-bot
tool-orchestrator → llm-bot: {
  isError: false,
  content: [{ type: 'text', text: 'https://...' }]
}

╔═══════════════════════════════════════════════════════════════╗
║ llm-bot: Response Formatting                                  ║
╚═══════════════════════════════════════════════════════════════╝

// llm-bot processes tool result
llm-bot → OpenAI API: Continue generation with tool result
OpenAI API → llm-bot: "I've generated an image of a beautiful sunset..."

// Format response and publish to egress
llm-bot → llm-bot: Create response event with candidate
llm-bot → NATS: Publish to internal.egress.v1
ingress-egress → User: "I've generated an image... https://..."
```

### 7.3 reflex Tool Invocation Sequence

**Scenario**: Reflex service reacts to Twitch raid event

The reflex service pattern differs from llm-bot:
- **llm-bot**: LLM decides which tools to call (dynamic)
- **reflex**: Predetermined tool calls based on event type (static)

```typescript
// SEQUENCE DIAGRAM (PROPOSED)

Twitch EventSub → ingress-egress: channel.raid event
ingress-egress → auth: Enrich user identity
auth → event-router: Event with routing slip
event-router → reflex: Event on internal.reaction.v1

╔═══════════════════════════════════════════════════════════════╗
║ reflex: Programmatic Tool Invocation                          ║
╚═══════════════════════════════════════════════════════════════╝

reflex → reflex: Detect raid event
reflex → reflex: Load reaction template for 'channel.raid'

// Template defines predetermined tool calls
reflex → reflex: Template: {
  tools: [
    { id: 'twitch.send_chat_message', args: { message: 'Thanks for raid!' }},
    { id: 'twitch.create_clip', args: {} },
    { id: 'discord.notify_webhook', args: { text: 'Raid from ${raider}' }}
  ],
  modelId: 'gpt-3.5-turbo' // Reflex uses basic model for template expansion
}

// Create execution context (reflex uses basic model)
reflex → reflex: Create ToolExecutionContext {
  userRoles: ['system'],  // Reflex operates as system
  modelId: 'gpt-3.5-turbo',
  correlationId: 'raid-123',
  sessionId: undefined
}

╔═══════════════════════════════════════════════════════════════╗
║ tool-orchestrator: Multi-Tool Execution                       ║
╚═══════════════════════════════════════════════════════════════╝

// Execute Tool 1: Send chat message
reflex → tool-orchestrator (MCP): tool.execute({
  toolId: 'twitch.send_chat_message',
  args: { message: 'Thanks @raider for the raid!' },
  context: { userRoles: ['system'], modelId: 'gpt-3.5-turbo', ... }
})

// INTERNALLY (tool-orchestrator):
// ToolGateway → ToolRegistry.getTool() (IN-PROCESS, <1µs)
// ToolGateway → ModelRegistry.getModel('gpt-3.5-turbo') (IN-PROCESS, <1µs)
ToolGateway → ToolGateway: validateToolAccess(...) {
  // System role has elevated privileges
  // gpt-3.5-turbo is 'basic' tier, allowed for chat operations
  return { allowed: true };
}
// ToolGateway executes tool via external MCP server
ToolGateway → twitch-mcp (MCP): send_chat_message({ message: '...' })
twitch-mcp → Twitch API: POST /chat/messages
Twitch API → twitch-mcp: { success: true }
twitch-mcp → ToolGateway: { content: [{ type: 'text', text: 'Message sent' }] }
tool-orchestrator → reflex: { isError: false, ... }

// Execute Tool 2: Create clip
reflex → tool-orchestrator (MCP): tool.execute({
  toolId: 'twitch.create_clip',
  args: {},
  context: { userRoles: ['system'], modelId: 'gpt-3.5-turbo', ... }
})

// INTERNALLY (tool-orchestrator):
// ToolGateway → ToolRegistry.getTool() (IN-PROCESS, <1µs)
ToolGateway → ToolGateway: validateToolAccess(...) {
  // Check: Does gpt-3.5-turbo have permission for create_clip?
  // Tool requires: modelRoles: ['function-calling']
  // gpt-3.5-turbo has: ['model', 'basic', 'function-calling']
  return { allowed: true };
}
ToolGateway → twitch-mcp (MCP): create_clip({})
twitch-mcp → Twitch API: POST /clips
Twitch API → twitch-mcp: { clip_id: 'clip-456', edit_url: '...' }
twitch-mcp → ToolGateway: { content: [{ type: 'text', text: '...' }] }
tool-orchestrator → reflex: { isError: false, ... }

// Execute Tool 3: Discord webhook
reflex → tool-orchestrator (MCP): tool.execute({
  toolId: 'discord.notify_webhook',
  args: { text: 'Raid from raider_name!' },
  context: { userRoles: ['system'], modelId: 'gpt-3.5-turbo', ... }
})

// INTERNALLY (tool-orchestrator):
// ToolGateway → ToolRegistry.getTool() (IN-PROCESS, <1µs)
ToolGateway → ToolGateway: validateToolAccess(...) {
  return { allowed: true };
}
ToolGateway → discord-mcp (MCP): notify_webhook({ text: '...' })
discord-mcp → Discord Webhook API: POST webhook
Discord Webhook API → discord-mcp: { success: true }
discord-mcp → ToolGateway: { content: [{ type: 'text', text: 'Sent' }] }
tool-orchestrator → reflex: { isError: false, ... }

// Reflex completes reaction
reflex → reflex: All tools executed successfully
reflex → NATS: Publish completion to internal.egress.v1 (optional)
```

### 7.4 RBAC Validation Flow Details

The dual-layer RBAC check happens synchronously before tool execution (all in-process):

```
┌─────────────────────────────────────────────────────────────────┐
│ ToolGateway.validateToolAccess(toolId, userRoles, modelId)     │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 1. Fetch Tool Metadata (IN-PROCESS, <1µs)                      │
│    ToolGateway → ToolRegistry.getTool(toolId)                   │
│    → Returns tool.rbac configuration                            │
│    (or from LRU cache if recently fetched)                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Fetch Model Metadata (IN-PROCESS, <1µs)                     │
│    ToolGateway → ModelRegistry.getModel(modelId)                │
│    → Returns model.roles, model.tier, model.trust               │
│    (or from LRU cache if recently fetched)                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. User Role Layer (First Gate)                                 │
│                                                                  │
│ IF userRoles missing ANY required role:                         │
│   → DENY (reason: 'user_missing_required_roles')                │
│                                                                  │
│ IF userRoles contains ANY denied role:                          │
│   → DENY (reason: 'user_has_denied_role')                       │
│                                                                  │
│ ELSE:                                                            │
│   → PASS to Model Layer                                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Model Role Layer (Second Gate)                               │
│                                                                  │
│ IF model.roles missing ANY required role:                       │
│   → DENY (reason: 'model_missing_required_roles')               │
│                                                                  │
│ IF model.roles contains ANY denied role:                        │
│   → DENY (reason: 'model_has_denied_role')                      │
│                                                                  │
│ ELSE:                                                            │
│   → PASS to Tier Check                                          │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Model Tier Check (Cost Control)                              │
│                                                                  │
│ IF tool.rbac.modelTiers.allowed NOT empty:                      │
│   IF model.tier NOT IN allowed:                                 │
│     → DENY (reason: 'model_tier_not_allowed')                   │
│                                                                  │
│ IF model.tier IN tool.rbac.modelTiers.denied:                   │
│   → DENY (reason: 'model_tier_denied')                          │
│                                                                  │
│ ELSE:                                                            │
│   → PASS to Trust Check                                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Trust Score Thresholds (Quality Gate)                        │
│                                                                  │
│ FOR EACH threshold in tool.rbac.trustThresholds:                │
│   Find model.trust entry matching threshold.scope               │
│                                                                  │
│   FOR EACH dimension in threshold.min:                          │
│     IF model.trust[scope].scores[dimension] < threshold.min:    │
│       → DENY (reason: 'model_trust_below_threshold')            │
│                                                                  │
│ ELSE:                                                            │
│   → ALLOW                                                        │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Result: { allowed: true } OR { allowed: false, reason: '...' }  │
└─────────────────────────────────────────────────────────────────┘
```

**Caching Strategy**:
- Tool metadata cached in tool-gateway (invalidate on tool updates)
- Model metadata cached in tool-gateway (invalidate on model updates)
- Cache TTL: 5 minutes (configurable)
- Cache key: `tool:${toolId}`, `model:${modelId}`

### 7.5 Error Handling Flows

#### 7.5.1 RBAC Denial Flow

```
llm-bot → tool-gateway: executeTool('generate_image', args, context)
tool-gateway → tool-gateway: validateToolAccess(...) {
  // User has role 'banned'
  return { allowed: false, reason: 'user_has_denied_role' };
}

tool-gateway → tool-gateway: Log denial event
tool-gateway → tool-gateway: logger.warn({
  eventId: 'evt-123',
  toolId: 'generate_image',
  modelId: 'gpt-4',
  userRoles: ['user', 'banned'],
  rbacDecision: 'denied',
  denialReason: 'user_has_denied_role'
}, 'tool.invocation.denied')

tool-gateway → llm-bot: {
  isError: true,
  content: [{
    type: 'text',
    text: 'Tool access denied: user_has_denied_role'
  }]
}

llm-bot → llm-bot: Handle tool error gracefully
llm-bot → OpenAI API: Continue with tool error message
OpenAI API → llm-bot: "I'm unable to generate that image..."
llm-bot → NATS: Publish error response to egress
```

#### 7.5.2 Tool Execution Failure Flow

```
tool-gateway → image-gen-mcp: generate_image({ prompt: '...', size: '...' })
image-gen-mcp → OpenAI API: images.generate(...)
OpenAI API → image-gen-mcp: Error: "Content policy violation"

image-gen-mcp → tool-gateway: {
  isError: true,
  content: [{ type: 'text', text: 'Content policy violation' }]
}

tool-gateway → tool-gateway: Log failure event
tool-gateway → tool-gateway: logger.error({
  eventId: 'evt-456',
  toolId: 'generate_image',
  modelId: 'gpt-4',
  executionStatus: 'failed',
  errorMessage: 'Content policy violation',
  executionTimeMs: 1200
}, 'tool.invocation.failed')

tool-gateway → llm-bot: {
  isError: true,
  content: [{ type: 'text', text: 'Content policy violation' }]
}

llm-bot → OpenAI API: Continue with error context
OpenAI API → llm-bot: "I can't generate that image due to content policies..."
```

#### 7.5.3 Model Not Found Flow

```
llm-bot → tool-orchestrator: model.get('gpt-5')  // Typo or invalid model
  // INTERNALLY: ToolGateway → ModelRegistry.getModel('gpt-5') (IN-PROCESS)
tool-orchestrator → llm-bot: null  // Model not found

llm-bot → llm-bot: Fallback to default model
llm-bot → llm-bot: logger.warn({
  requestedModel: 'gpt-5',
  fallbackModel: 'gpt-4',
  reason: 'model_not_found'
}, 'llm.model.fallback')

llm-bot → tool-orchestrator: model.get('gpt-4')  // Fallback
  // INTERNALLY: ToolGateway → ModelRegistry.getModel('gpt-4') (IN-PROCESS, <1µs)
tool-orchestrator → llm-bot: { id: 'gpt-4', ... }

// Continue with fallback model
```

### 7.6 Performance Considerations

**Latency Budget** (target: <50ms overhead for RBAC + registry lookups):

| Operation | Target Latency | Mitigation |
|-----------|----------------|------------|
| ToolRegistry.getTool() (in-process) | <1µs (cached) / <5ms (DB) | LRU cache (5min TTL), PostgreSQL indexes |
| ModelRegistry.getModel() (in-process) | <1µs (cached) / <5ms (DB) | LRU cache (5min TTL), small dataset (~100 models) |
| ToolGateway.validateToolAccess() | <1ms | Pure computation, no I/O, in-memory |
| MCP tool invocation | Variable (tool-dependent) | Async logging, timeout enforcement |
| Event logging (Loki) | <5ms | Fire-and-forget, async |

**Caching Strategy**:
```typescript
// ToolGateway module implements 2-tier cache
class ToolGateway {
  private toolCache = new LRUCache<string, ToolRegistryDocument>({ max: 1000, ttl: 300_000 });
  private modelCache = new LRUCache<string, ModelRegistryDocument>({ max: 100, ttl: 300_000 });

  constructor(
    private toolRegistry: IToolRegistry,
    private modelRegistry: IModelRegistry
  ) {}

  async getTool(toolId: string): Promise<ToolRegistryDocument | null> {
    // Check L1 cache
    if (this.toolCache.has(toolId)) {
      return this.toolCache.get(toolId);
    }

    // Query ToolRegistry module (IN-PROCESS, <1µs or <5ms if DB query)
    const tool = await this.toolRegistry.getTool(toolId);
    if (tool) {
      this.toolCache.set(toolId, tool);
    }
    return tool;
  }
}
```

**Optimization Opportunities**:
1. **Batch RBAC pre-filtering**: When llm-bot requests tools, ToolGateway pre-filters by model capabilities (reduces LLM context size)
2. **Tool metadata bundling**: ToolRegistry returns tool + RBAC config in single query (already in-process)
3. **Model metadata warmup**: Cache top 20 models on tool-orchestrator startup
4. **Parallel queries**: Fetch tool + model metadata concurrently (already fast with in-process calls)

---

## 8. Tool Invocation Event Log & Observability

### 8.1 Event-Based Observability Architecture

**Philosophy**: Instead of aggregating metrics in the database, we log every tool invocation as a structured event. This provides:

- **Full traceability**: Trace any request's complete tool call chain via correlationId
- **Flexible analysis**: Calculate any metric on-demand from raw events
- **Cost efficiency**: No database writes for metrics (async event logging only)
- **Historical analysis**: Query patterns across time, tools, models, users
- **Incident investigation**: Reconstruct exact sequence of events for debugging

**Infrastructure**: Leverages platform's existing **Loki/Promtail** stack
- **Promtail**: Ships structured logs from all Bits to Loki
- **Loki**: Time-series log aggregation with label indexing
- **LogQL**: Query language for filtering and aggregating events

### 8.2 Tool Invocation Event Schema (PROPOSED - NEW)

```typescript
// PROPOSED: ToolInvocationEvent interface (NEW)
interface ToolInvocationEvent {
  // Event Identity
  eventId: string;                 // Unique event ID (UUID)
  correlationId: string;           // Request correlation ID (traces full flow)
  parentEventId?: string;          // For nested tool calls

  // Tool Context
  toolId: string;                  // Canonical tool ID
  toolName: string;                // Human-readable name
  toolSource: 'internal' | 'mcp' | 'composition';

  // Execution Context
  userId?: string;
  userRoles: string[];
  modelId: string;                 // Model that invoked the tool
  modelTier: string;               // free | basic | premium | enterprise
  sessionId?: string;
  sourceService: string;           // Bit that invoked the tool (e.g., 'llm-bot')

  // Timing
  startedAt: string;               // ISO 8601 timestamp
  completedAt?: string;            // ISO 8601 timestamp (if completed)
  durationMs?: number;             // Calculated: completedAt - startedAt

  // Result
  status: 'success' | 'error' | 'timeout' | 'rbac_denied';
  errorType?: string;              // e.g., 'TimeoutError', 'ValidationError'
  errorMessage?: string;           // First 500 chars of error
  errorCode?: string;              // Error code from tool

  // RBAC Result (if denied)
  rbacDenialReason?: string;       // e.g., 'user_missing_required_roles'

  // Optional Debug Data (truncated for log size)
  inputPreview?: string;           // First 200 chars of input
  outputPreview?: string;          // First 200 chars of output

  // Metadata
  retryAttempt?: number;           // 0 for first attempt, 1+ for retries
  costEstimate?: number;           // Estimated cost in USD (if applicable)
}
```

**Loki Labels** (indexed for fast filtering):
```typescript
{
  tool: toolId,                    // e.g., 'generate_image'
  model: modelId,                  // e.g., 'gpt-4'
  status: 'success' | 'error' | 'timeout' | 'rbac_denied',
  tier: modelTier,                 // 'premium', 'basic', etc.
  source: toolSource,              // 'internal', 'mcp', 'composition'
  service: sourceService,          // 'llm-bot', 'tool-gateway'
  correlation_id: correlationId    // For request tracing
}
```

### 8.3 Event Logging Flow

```
┌──────────────────┐
│  Tool Invoked    │
│ (tool-gateway or │
│  internal Bit)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  RBAC Check      │  If denied: Log event with status='rbac_denied'
└────────┬─────────┘
         │ (allowed)
         ▼
┌──────────────────┐
│  Execute Tool    │  Create event: { eventId, correlationId, startedAt, ... }
│                  │  Log: "tool.invocation.started"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Tool Returns    │  Update event: { completedAt, status, durationMs }
│  or Times Out    │  Log: "tool.invocation.completed"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Promtail Ships  │  Structured JSON log → Loki
│  to Loki         │  Labels extracted automatically
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Loki Stores     │  Event indexed by labels
│  Event           │  Queryable via LogQL
└──────────────────┘
```

**Logging Pattern** (in tool executor):
```typescript
async function executeToolWithLogging(
  toolId: string,
  args: any,
  context: ToolExecutionContext
): Promise<any> {
  const event: ToolInvocationEvent = {
    eventId: randomUUID(),
    correlationId: context.correlationId,
    toolId,
    toolName: tool.canonicalName,
    toolSource: tool.source,
    userId: context.userId,
    userRoles: context.userRoles,
    modelId: context.modelId,
    modelTier: getModelTier(context.modelId),
    sessionId: context.sessionId,
    sourceService: process.env.SERVICE_NAME || 'unknown',
    startedAt: new Date().toISOString(),
    status: 'success',
    inputPreview: JSON.stringify(args).slice(0, 200),
  };

  // Log invocation start
  logger.info('tool.invocation.started', event);

  try {
    const startTime = Date.now();
    const result = await tool.execute(args, context);
    const durationMs = Date.now() - startTime;

    // Log invocation completion
    logger.info('tool.invocation.completed', {
      ...event,
      completedAt: new Date().toISOString(),
      durationMs,
      status: 'success',
      outputPreview: JSON.stringify(result).slice(0, 200),
    });

    // Update tool health (lightweight)
    await updateToolHealth(toolId, { lastSuccessAt: new Date().toISOString() });

    return result;
  } catch (error) {
    const durationMs = Date.now() - Date.parse(event.startedAt);
    const status = error instanceof TimeoutError ? 'timeout' : 'error';

    // Log invocation error
    logger.error('tool.invocation.completed', {
      ...event,
      completedAt: new Date().toISOString(),
      durationMs,
      status,
      errorType: error.constructor.name,
      errorMessage: error.message?.slice(0, 500),
    });

    // Update tool health (lightweight)
    await updateToolHealth(toolId, {
      lastErrorAt: new Date().toISOString(),
      status: deriveHealthStatus(toolId), // Check recent error rate
    });

    throw error;
  }
}
```

### 8.4 Querying Invocation Events with LogQL

**Query Examples**:

**1. Total invocations for a tool (last 24 hours)**:
```logql
count_over_time(
  {tool="generate_image"}
  | json
  | __error__=""
  [24h]
)
```

**2. Error rate for a tool**:
```logql
(
  count_over_time({tool="generate_image", status="error"}[24h])
  /
  count_over_time({tool="generate_image"}[24h])
) * 100
```

**3. P95 latency for a tool** (calculated from events):
```logql
quantile_over_time(0.95,
  {tool="generate_image", status="success"}
  | json
  | unwrap durationMs
  [24h]
)
```

**4. Invocations by model** (breakdown):
```logql
sum by (model) (
  count_over_time({tool="generate_image"}[24h])
)
```

**5. Trace full tool chain for a request** (via correlationId):
```logql
{correlation_id="abc123"}
| json
| line_format "{{.startedAt}} [{{.toolId}}] {{.status}} ({{.durationMs}}ms)"
```

**6. Find slow invocations** (>10 seconds):
```logql
{tool="generate_image"}
| json
| durationMs > 10000
| line_format "{{.startedAt}} {{.modelId}} took {{.durationMs}}ms"
```

**7. RBAC denials** (security monitoring):
```logql
{status="rbac_denied"}
| json
| line_format "{{.modelId}} denied access to {{.toolId}}: {{.rbacDenialReason}}"
```

**8. Tool usage by user**:
```logql
sum by (userId) (
  count_over_time({tool="generate_image"}[7d])
)
```

**9. Error types breakdown**:
```logql
sum by (errorType) (
  count_over_time({tool="generate_image", status="error"}[24h])
)
```

**10. Cost tracking** (if costEstimate populated):
```logql
sum(
  sum_over_time(
    {tool="generate_image"}
    | json
    | unwrap costEstimate
    [30d]
  )
)
```

### 8.5 MCP Tools for Observability

**Admin Tools** (exposed by **tool-orchestrator**, delegated to ToolObserver module, platform-only):

```typescript
// Get tool metrics (queries Loki, returns aggregated results)
'tool.get_metrics'({
  toolId: 'generate_image',
  timeRange: '24h' | '7d' | '30d'
})
// Returns: { invocations, errorRate, p50/p95/p99 latency, modelBreakdown }

// Trace request by correlationId
'tool.trace_request'({
  correlationId: 'abc123'
})
// Returns: Array of ToolInvocationEvents in chronological order

// Get tool health status
'tool.get_health'({
  toolId: 'generate_image'
})
// Returns: { status, lastSuccess, lastError, recentErrorRate }

// Query raw events (advanced)
'tool.query_events'({
  logql: '{tool="generate_image", status="error"}[1h]',
  limit: 100
})
// Returns: Array of ToolInvocationEvents matching query
```

### 8.6 Alerting & Monitoring

**Prometheus Metrics Export** (derived from Loki):
- Use Loki recording rules to create Prometheus metrics
- Export to Grafana for dashboards

**Alert Rules**:
```yaml
# High error rate
- alert: ToolHighErrorRate
  expr: |
    (
      sum(rate({status="error"}[5m])) by (tool)
      /
      sum(rate({__name__=~".+"}[5m])) by (tool)
    ) > 0.10
  labels:
    severity: warning
  annotations:
    summary: "Tool {{$labels.tool}} error rate above 10%"

# RBAC denials spike
- alert: UnauthorizedToolAccess
  expr: |
    sum(rate({status="rbac_denied"}[5m])) by (tool, model) > 5
  labels:
    severity: warning
  annotations:
    summary: "Model {{$labels.model}} repeatedly denied access to {{$labels.tool}}"

# Slow tool performance
- alert: ToolSlowPerformance
  expr: |
    quantile_over_time(0.95,
      {status="success"} | json | unwrap durationMs [5m]
    ) by (tool) > 30000
  labels:
    severity: warning
  annotations:
    summary: "Tool {{$labels.tool}} P95 latency above 30s"

# Tool not invoked recently (health check)
- alert: ToolNotInvoked
  expr: |
    time() - max(timestamp({tool=~".+"}) by (tool)) > 3600
  labels:
    severity: info
  annotations:
    summary: "Tool {{$labels.tool}} has not been invoked in 1 hour"
```

### 8.7 Retention & Performance

**Loki Retention Policies**:
- **Detailed events**: 30 days (full event data)
- **Aggregated metrics**: 1 year (via recording rules)
- **Trace data** (by correlationId): 7 days (for debugging recent issues)

**Performance Considerations**:
- Event logging is async (non-blocking on tool execution)
- Promtail batches logs before shipping (reduces network overhead)
- Loki indexes only labels (not full event JSON)
- Query performance: <1s for 24h queries, <5s for 30d queries
- Cardinality limits: ~100 unique tools, ~20 unique models, ~10 unique services

---

## 9. mcp-compose Integration

### 9.1 Current State

- Compositions registered via `composition.register` MCP tool
- Compositions stored in DocumentStore (`compositions` collection)
- Compositions executed via CompositionExecutor
- Executor resolves tool IDs at runtime
- **No RBAC validation of constituent tools at registration time**

### 9.2 Proposed Model-Based RBAC for Compositions

**Validation at Registration**:
```typescript
async function registerComposition(
  definition: CompositionDefinition,
  registeringModelId: string,  // Model ID of the registering context
  userRoles: string[]
): Promise<void> {
  // 1. Extract all tool IDs from composition steps
  const toolIds = extractToolIds(definition.spec.steps);

  // 2. Validate MODEL has access to ALL constituent tools
  for (const toolId of toolIds) {
    const access = validateToolAccess(
      toolId,
      userRoles,
      registeringModelId  // Check against MODEL permissions
    );

    if (!access.allowed) {
      throw new Error(
        `Model ${registeringModelId} lacks access to tool ${toolId}. ` +
        `Reason: ${access.reason}. ${access.details || ''}` +
        `Cannot register composition that uses restricted tools.`
      );
    }
  }

  // 3. Derive composition RBAC from constituent tools
  const compositionRbac = deriveCompositionRbac(toolIds);

  // 4. Register composition with derived RBAC
  await toolRegistry.importTool({
    id: definition.metadata.name,
    source: 'composition',
    rbac: compositionRbac,
    sourceMetadata: {
      composition: {
        compositionId: definition.metadata.name,
        version: definition.metadata.version || 1,
        registeredByModel: registeringModelId,  // Track which model registered it
      }
    }
  });
}
```

**RBAC Derivation**:
```typescript
function deriveCompositionRbac(toolIds: string[]): ToolRbac {
  const tools = toolIds.map(id => toolRegistry.getTool(id));

  // Most restrictive policy:
  // - Composition requires union of all constituent tool required roles
  // - Composition inherits all denied roles from constituents

  return {
    userRoles: {
      required: union(tools.map(t => t.rbac.userRoles.required)),
      denied: union(tools.map(t => t.rbac.userRoles.denied))
    },
    modelRoles: {
      required: union(tools.map(t => t.rbac.modelRoles.required)),
      denied: union(tools.map(t => t.rbac.modelRoles.denied))
    },
    modelTiers: {
      allowed: intersection(tools.map(t => t.rbac.modelTiers.allowed)),  // Most restrictive
      denied: union(tools.map(t => t.rbac.modelTiers.denied))
    }
  };
}
```

**Example**:
```yaml
# Composition using premium tools
composition:
  name: analyze_and_generate_image
  steps:
    - call: analyze_image
      with: { image_url: $input.url }
    - call: generate_image
      with:
        prompt:
          template: "Create variation of: {{description}}"
          description: { $ref: { namespace: steps, pointer: /analyze_image/text } }

# Tool RBAC:
analyze_image:
  modelTiers: { allowed: [premium] }
generate_image:
  modelTiers: { allowed: [premium, enterprise] }

# Derived Composition RBAC:
analyze_and_generate_image:
  modelTiers:
    allowed: [premium]  # Intersection: only premium (not enterprise)
  modelRoles:
    required: [premium, vision]  # Union of required roles
```

**Result**: Composition can only be invoked by premium models with vision capability

### 9.3 Runtime Model Context Propagation

**Critical**: When composition executes, model context must propagate to all steps

```typescript
async function executeComposition(
  compositionId: string,
  input: unknown,
  context: ToolExecutionContext  // Includes modelId
): Promise<ExecutionResult> {
  const composition = await compositionRegistry.get(compositionId);

  // Validate model access to composition itself
  const access = validateToolAccess(compositionId, context.userRoles, context.modelId);
  if (!access.allowed) {
    throw new RbacError(access.reason, access.details);
  }

  // Execute steps with MODEL context
  for (const step of composition.spec.steps) {
    if (isCallStep(step)) {
      // Model context flows through to nested tool call
      const result = await executeTool(step.call, stepArgs, {
        ...context,
        modelId: context.modelId  // SAME model for all steps
      });
      stepState[step.id] = result;
    }
  }

  return result;
}
```

**Guarantees**:
1. Model permissions enforced at composition registration
2. Model permissions enforced at composition invocation
3. Model permissions enforced for each constituent tool call
4. No permission escalation through composition

---

## 10. Bit Registration Decoupling

### 10.1 Current State

- Bits publish `INTERNAL_MCP_REGISTRATION_V1` on startup
- tool-gateway stores in `mcp_servers` collection (DocumentStore)
- RegistryWatcher monitors for changes
- McpClientManager connects and discovers tools
- Tools registered with Bit-specific prefixes

**Problem**: Bit lifecycle (start/stop) is tightly coupled to tool availability

### 10.2 Proposed Decoupling

**Separate Concerns**:

| Concern | Current | Proposed |
|---------|---------|----------|
| Bit Registration | `INTERNAL_MCP_REGISTRATION_V1` | `INTERNAL_BIT_REGISTRATION_V1` (new) |
| Tool Registration | Coupled to Bit registration | Independent tool import |
| Bit Lifecycle | Bit stop → tools unavailable | Bit stop → tools remain registered |
| Service Discovery | McpServerStore | BitRegistry (new) |

**Benefits**:
- Tools persist across Bit restarts
- Bit metadata (health, version, capabilities) separated from tooling
- Enable future service mesh integration
- Clearer separation of concerns

### 10.3 BitRegistry Design (PROPOSED)

**Purpose**: Track Bit metadata separate from tooling

**Current State** (src/types/events.ts:358):
- Bits currently register via `INTERNAL_MCP_REGISTRATION_V1` event (coupling Bit lifecycle to MCP server registration)
- No dedicated `BitRegistration` interface or `bit_registry` collection exists
- Bit metadata stored in `McpServerStore` (tightly coupled to MCP tooling)
- When Bit stops, tools immediately become unavailable
- No separate service discovery mechanism for Bits

**PROPOSED Schema** (Sprint 55 - NEW):
```typescript
// PROPOSED: BitRegistration interface (NEW)
interface BitRegistration {
  name: string;
  profile: string;              // 'core' | 'gateway' | 'llm' | 'mcp-server'
  category: string;             // 'platform' | 'domain'
  mcpExposure: string;          // 'platform-only' | 'platform+domain' | 'none'

  // Service Discovery
  host: string;
  port: number;
  healthEndpoint: string;

  // Capabilities
  providesTools: string[];      // List of tool IDs this Bit provides
  consumesTopics: string[];
  producesTopics: string[];

  // Lifecycle
  status: 'running' | 'stopped' | 'degraded';
  startedAt: Date;
  lastHeartbeatAt: Date;

  // Metrics
  uptime: number;
  restartCount: number;
}
```

**Registration Flow** (PROPOSED):
1. Bit starts, publishes **NEW** event: `INTERNAL_BIT_REGISTRATION_V1` (to be created)
2. tool-orchestrator receives message and stores Bit metadata in `bit_registry` table
3. tool-orchestrator **will delegate** to **ToolRegistry module** (in-process - see Section 3.4.1)
4. **ToolRegistry module will import** tools from Bit (if Bit provides MCP tools)
5. Bit can stop/restart without affecting tool availability

---

## 11. Migration Strategy

### 11.1 Phased Rollout

**Phase 1: Tool Registry Foundation** (Sprint 1-2)
- Create DocumentStore collections for `platform_tool_registry` and `model_registry`
- Initialize DocumentStore with proper indexes (PostgreSQL: GIN indexes for arrays, Firestore: composite indexes)
- Implement ToolRegistryService with basic CRUD
- Implement ModelRegistryService with basic CRUD
- Seed default models (gpt-4, claude, etc.)
- Migrate existing ToolRegistry data to DocumentStore
- No behavioral changes (read from new store, write to both)

**Phase 2: Tool Import Pipeline** (Sprint 3-4)
- Build MCP server tool importer
- Build Bit tool importer
- Implement deduplication logic
- Create admin MCP tools for manual import

**Phase 3: Model-Based RBAC** (Sprint 5-6)
- Update tool invocation flow to include modelId in context
- Implement RBAC evaluation algorithm with model checks
- Update llm-bot to propagate modelId through requests
- Migrate existing RBAC configs (agent allowlists → model roles)
- Shadow mode: New RBAC evaluated but not enforced (logging only)

**Phase 4: RBAC Enforcement** (Sprint 7-8)
- Enable RBAC enforcement per-tool with feature flag
- Monitor RBAC denial metrics
- Fix misconfigurations
- Full rollout

**Phase 5: Event Logging & Observability** (Sprint 9-10)
- Implement ToolInvocationEvent logging in tool execution flow
- Configure Promtail to ship logs to Loki with proper labels
- Create Loki recording rules for aggregated metrics
- Build MCP tools for querying events (tool.get_metrics, tool.trace_request)
- Configure alert rules for error rates, RBAC denials, slow performance
- Add Grafana dashboards for tool usage visualization

**Phase 6: Composition RBAC** (Sprint 11-12)
- Add model-based RBAC validation to composition registration
- Implement RBAC derivation logic
- Migrate existing compositions to new model
- Test model context propagation through compositions

**Phase 7: Bit Decoupling** (Sprint 13-14) - OPTIONAL
- Create BitRegistry
- Implement `INTERNAL_BIT_REGISTRATION_V1` handler
- Decouple Bit lifecycle from tool availability
- Deprecate old registration flow

### 11.2 Backwards Compatibility

**Compatibility Guarantees**:
- Existing tool IDs remain valid (aliasing layer)
- Existing compositions continue to execute
- Existing RBAC configurations migrated automatically
- No breaking changes to MCP client protocol
- Gradual migration: old agentAllowlist → model roles

**Migration Path**:
1. Tool Registry runs in dual-write mode (old + new stores)
2. Gradual migration of tools via import pipeline
3. Model registry seeded with default models
4. Shadow mode: New RBAC evaluated but not enforced (logging only)
5. Per-tool enforcement enabled with feature flag
6. Old ToolRegistry deprecated after full migration

**Agent → Model Migration**:
```typescript
// Old: Agent allowlist
tool: {
  agentAllowlist: ['llm-bot']
}

// New: Model roles (auto-migrated)
tool: {
  rbac: {
    modelRoles: {
      required: ['model']  // All models that can do tool calling
    }
  }
}

// Manual refinement (admin tools):
tool: {
  rbac: {
    modelRoles: {
      required: ['admin-capable']  // Only premium, trusted models
    },
    modelTiers: {
      allowed: ['premium', 'enterprise']
    }
  }
}
```

---

## 12. Implementation Considerations

### 12.1 Performance

**Latency Budget**:
- Tool lookup: < 1ms (in-memory cache)
- Model lookup: < 1ms (in-memory cache)
- RBAC evaluation: < 5ms (cached model roles)
- Event logging: < 1ms (async, non-blocking structured logging)
- Tool import: < 5s (rare operation)
- Loki query (24h metrics): < 1s
- Loki query (30d metrics): < 5s

**Scalability**:
- DocumentStore handles 10K+ tools, 100+ models (PostgreSQL backend scales to millions)
- In-memory cache handles 1M+ lookups/sec
- Loki handles 1M+ events/day with proper retention policies
- Event log cardinality: ~100 tools × ~20 models × ~10 services = 20K label combinations

### 12.2 Security

**Threat Model**:
| Threat | Mitigation |
|--------|------------|
| Privilege escalation via compositions | RBAC derivation from constituent tools |
| Cheap model using expensive tools | Model tier + cost restrictions |
| Tool ID spoofing | Canonical ID validation + source verification |
| Event log tampering | Loki immutable log storage with access controls |
| Model impersonation | Model registry with verification |
| Permission bypass via model switching | All tool calls re-validate against current model |
| RBAC denial hiding | All RBAC denials logged to Loki (status=rbac_denied) |

**Model Trust Profiles**:
- Premium cloud models (gpt-4, claude-opus): Multi-dimensional trust scores 90-95 across all dimensions
- Standard cloud models (gpt-4-turbo, claude-sonnet): Trust scores 85-90 across dimensions
- Basic models (gpt-3.5-turbo): Trust scores 60-75 across dimensions
- Local models (ollama): Trust scores 45-60 across dimensions
- Trust scores used for admin operations, sensitive tools, and high-risk operations
- Trust thresholds configurable per-tool and per-scope (general, coding, reasoning, tool-use)

### 12.3 Operational Concerns

**Monitoring**:
- Tool registry health checks (via DocumentStore)
- Model registry health checks (via DocumentStore)
- Loki event ingestion rate (alert if < expected baseline)
- Tool error rate trends (via LogQL queries)
- Model usage patterns and cost tracking (via Loki aggregations)
- RBAC denial rate by model (alert on spikes - potential misconfiguration)
- Tool invocation latency (P95/P99 via Loki quantiles)
- Promtail shipping lag (alert if > 30s)

**Disaster Recovery**:
- DocumentStore backups (daily via platform persistence layer)
- Tool registry snapshot export
- Model registry snapshot export
- Loki log backups (via S3/GCS compatible storage)
- Event log replay capability (reconstruct metrics from archived events)
- Automated re-import from source on recovery

---

## 13. Future Considerations

### 13.1 Platform Verbs

**Vision**: Base toolbox of mcp-compose compositions

```
Platform Verbs (compositions):
- get_data(source, query)
- transform_data(data, schema)
- store_data(data, destination)
- analyze_data(data, method)
- notify(recipient, message)
```

**RBAC Benefit**: Verbs inherit RBAC from implementation tools, enabling safe abstraction
**Model Benefit**: Verbs can be restricted to capable models only

### 13.2 Dynamic Model Pricing

**Future**: Real-time cost optimization
- Auto-select cheapest model that satisfies RBAC
- Suggest model downgrades when appropriate
- Budget tracking per model

### 13.3 Model Capability Evolution

**Future**: Models gain new capabilities over time
- Auto-detect model capabilities via feature detection
- Update model registry when new capabilities released
- Notify admins of new tool opportunities

### 13.4 Tool Marketplace

**Future**: Public/private tool catalogs
- Community-contributed tools
- Verified tool publishers
- Model compatibility ratings
- Automated security scanning

### 13.5 Advanced Metrics

**Future Enhancements**:
- Tool dependency graphs (which tools call others)
- Cost tracking per model per tool
- Anomaly detection (unusual call patterns by model)
- Predictive health scoring
- Model A/B testing for tool performance

---

## 14. Architecture Decisions

**Note**: Platform is not yet live, so backward compatibility and automatic data migration are not constraints.

### 14.1 Service Architecture

**Decision**: New **tool-orchestrator** Bit replaces tool-gateway, not modifications to existing services.

**Rationale**:
- Clean separation of concerns via internal modules
- Single deployment eliminates MCP overhead (<1µs in-process calls)
- Modular code with well-defined interfaces
- Future-proof: Can extract modules to separate services if needed
- Easier to reason about and maintain

**New Unified Bit**:
- **tool-orchestrator**: Single Bit with 4 internal modules:
  - **ToolRegistry module**: Manages platform_tool_registry and tool import pipeline
  - **ModelRegistry module**: Manages model_registry and model metadata
  - **ToolObserver module**: Queries Loki for metrics, health checks, and observability
  - **ToolGateway module**: Orchestrates execution, RBAC validation, MCP client management

### 14.2 Model Registry Seeding

**Decision**: Auto-register well-established models on platform init, **including local models**.

**Models to Seed**:
- Cloud premium: gpt-4, claude-opus-3.5
- Cloud standard: gpt-4-turbo, claude-sonnet-3.5
- Cloud basic: gpt-3.5-turbo
- Local: ollama/llama-3.1, ollama/mistral, ollama/codellama

**Rationale**: Developers need immediate access to common models without manual configuration.

### 14.3 Tool Import Strategy

**Decision**: **Automatic** import on MCP server registration (for now).

**Behavior**: When MCP server registers, automatically import all tools with default RBAC.

**Future**: Add admin approval workflow if needed for production deployments.

### 14.4 Default RBAC for Imported Tools

**Decision**: Use the proposed defaults.

```typescript
{
  userRoles: {
    required: ['user'],
    denied: []
  },
  modelRoles: {
    required: ['model'],
    denied: []
  },
  modelTiers: {
    allowed: [],  // Empty = all tiers allowed
    denied: []
  }
}
```

**Rationale**: Permissive by default, admin tightens as needed.

### 14.5 Model Tier Strategy

**Decision**: Keep it **simple** for now.

**Tiers**: `free`, `basic`, `premium`, `enterprise`

**Rationale**: Four tiers cover most use cases. Can add granular capabilities later if needed.

### 14.6 Metrics Granularity

**Decision**: Track **per-tool + per-model** initially.

**Implementation**: Loki labels include both `tool` and `model`, enabling queries like:
- Tool metrics: `{tool="generate_image"}`
- Model usage: `{model="gpt-4"}`
- Combined: `{tool="generate_image", model="gpt-4"}`

**Future**: Add per-user tracking if needed (add `userId` label).

### 14.7 Composition Validation Strategy

**Decision**: **Hard fail** if model lacks access to constituent tools.

**Behavior**: `composition.register()` throws error if registering model doesn't have access to all tools in composition.

**Rationale**: Security over convenience. Prevents accidental privilege escalation.

### 14.8 Migration Strategy

**Decision**: **No need for backward compatibility** or dual-mode operation.

**Approach**: Clean-slate implementation since platform is not live.

**Migration**: Manual re-import of tools from sources (if any exist from development).

### 13.9 Tool Naming Conventions

**Decision**: **Yes**, enforce canonical naming conventions.

**Rules**:
- Format: `snake_case`
- Max length: 64 characters
- Allowed characters: `[a-z0-9_]`
- Must start with letter
- Namespace prefix optional: `domain.tool_name` (e.g., `obs.set_scene_item_enabled`)

**Validation**: Enforced at tool import time.

### 13.10 Model Context Propagation

**Decision**: Use the proposed approach - **always inherit original model context**.

**Behavior**: Nested tool calls (tool A → tool B) inherit the original `modelId` from the request. No mid-request model switching.

**Rationale**: Security and auditability. Prevents permission escalation through tool chaining.

### 13.11 Cost Controls

**Decision**: **Defer to later** (post-Phase 1).

**Rationale**: Focus on core registry and RBAC infrastructure first. Cost controls can be added once observability is in place.

---

## 15. Recommendation

**Proceed with tool-centric architecture redesign with MODEL-BASED RBAC** via phased rollout over 14 sprints (~7 months).

**Critical Path**:
1. Tool Registry + Model Registry Foundation (enables all future work)
2. Tool Import Pipeline (decouples tool lifecycle)
3. Model-Based RBAC (fixes architectural flaw, enables cost control)
4. RBAC Enforcement (actual security improvement)
5. Composition RBAC (enables safe abstraction)

**Defer**:
- Bit decoupling (can be done later without blocking other work)
- Advanced metrics (percentiles, anomaly detection)
- Tool marketplace features
- Dynamic model pricing

**Key Innovation**: **Model-Based RBAC fundamentally changes how platform manages permissions**:
- Security principal shifts from agent → model
- Enables cost control (restrict expensive tools to premium models)
- Enables security tiers (different models have different trust)
- Enables flexible permission management (same agent, different capabilities based on model)

**Next Steps**:
1. User review and feedback on this architecture
2. Clarify open questions
3. Refine based on feedback
4. Create detailed implementation plan for Phase 1
5. Begin Sprint 1: Tool Registry + Model Registry Foundation

---

**End of Document**

---

## Appendix A: PostgreSQL Database Schemas

### A.1 platform_tool_registry Table

```sql
-- Platform Tool Registry (DocumentStore collection)
-- Stores all tools imported from MCP servers, Bits, and compositions

CREATE TABLE platform_tool_registry (
  -- Primary Key
  id VARCHAR(255) PRIMARY KEY,  -- Canonical tool ID (e.g., 'mcp:obs.set_scene_item_enabled')

  -- Identity
  canonical_name VARCHAR(500) NOT NULL,
  description TEXT,

  -- Source Metadata
  source VARCHAR(50) NOT NULL CHECK (source IN ('internal', 'mcp', 'composition')),
  source_metadata JSONB NOT NULL DEFAULT '{}',  -- {serverName?, bitName?, compositionId?, version?, transportType?}

  -- Schema (JSON storage for Zod schemas)
  input_schema JSONB NOT NULL,
  output_schema JSONB,

  -- RBAC (User × Model dual-layer)
  rbac JSONB NOT NULL DEFAULT '{
    "userRoles": {"required": [], "denied": []},
    "modelRoles": {"required": [], "denied": []},
    "modelTiers": {"allowed": [], "denied": []},
    "minTrustThresholds": null
  }',

  -- Configuration
  config JSONB NOT NULL DEFAULT '{
    "timeoutMs": 60000,
    "maxRetryAttempts": 3,
    "retryBackoffMs": 1000,
    "rateLimitPerMinute": null,
    "costTier": "standard"
  }',

  -- Health Tracking (lightweight)
  health JSONB NOT NULL DEFAULT '{
    "lastInvocationAt": null,
    "lastSuccessAt": null,
    "lastErrorAt": null,
    "status": "healthy"
  }',

  -- Lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'disabled')),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_health_check_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  category VARCHAR(255),
  related_tools TEXT[] DEFAULT '{}'
);

-- Indexes for common queries
CREATE INDEX idx_tool_registry_source ON platform_tool_registry(source);
CREATE INDEX idx_tool_registry_status ON platform_tool_registry(status);
CREATE INDEX idx_tool_registry_category ON platform_tool_registry(category);

-- GIN indexes for array and JSONB queries
CREATE INDEX idx_tool_registry_tags ON platform_tool_registry USING GIN(tags);
CREATE INDEX idx_tool_registry_rbac ON platform_tool_registry USING GIN(rbac);
CREATE INDEX idx_tool_registry_source_metadata ON platform_tool_registry USING GIN(source_metadata);

-- Index for cost tier filtering
CREATE INDEX idx_tool_registry_cost_tier ON platform_tool_registry((config->>'costTier'));

-- Index for health status
CREATE INDEX idx_tool_registry_health_status ON platform_tool_registry((health->>'status'));

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_tool_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tool_registry_updated_at
  BEFORE UPDATE ON platform_tool_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_tool_registry_updated_at();
```

---

### A.2 model_registry Table

```sql
-- Model Registry (DocumentStore collection)
-- Stores LLM model catalog with security profiles and trust scores

CREATE TABLE model_registry (
  -- Primary Key
  id VARCHAR(255) PRIMARY KEY,  -- Model ID (e.g., 'gpt-4', 'claude-sonnet-4-5')

  -- Identity
  name VARCHAR(500) NOT NULL,
  provider VARCHAR(255) NOT NULL,  -- 'openai', 'anthropic', 'google', etc.
  description TEXT,

  -- Security Profile
  tier VARCHAR(50) NOT NULL CHECK (tier IN ('free', 'basic', 'premium', 'enterprise')),
  required_roles TEXT[] DEFAULT '{}',

  -- Capabilities
  capabilities JSONB NOT NULL DEFAULT '{
    "toolCalling": false,
    "vision": false,
    "streaming": false,
    "functionCalling": false,
    "maxTokens": null
  }',

  -- Cost Configuration
  costs JSONB NOT NULL DEFAULT '{
    "inputTokenCostUSD": 0,
    "outputTokenCostUSD": 0,
    "requestCostUSD": 0
  }',

  -- Multi-Dimensional Trust Scores (array of trust profiles by scope)
  trust JSONB NOT NULL DEFAULT '[]',  -- Array of {scope, scores: {reliability, fidelity, integrity, calibration}, evidence}

  -- Tool Access Policies
  tool_access JSONB NOT NULL DEFAULT '{
    "allowlist": [],
    "denylist": []
  }',

  -- Lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'experimental')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  api_version VARCHAR(50),
  context_window_tokens INTEGER
);

-- Indexes for common queries
CREATE INDEX idx_model_registry_provider ON model_registry(provider);
CREATE INDEX idx_model_registry_tier ON model_registry(tier);
CREATE INDEX idx_model_registry_status ON model_registry(status);

-- GIN indexes for array and JSONB queries
CREATE INDEX idx_model_registry_required_roles ON model_registry USING GIN(required_roles);
CREATE INDEX idx_model_registry_tags ON model_registry USING GIN(tags);
CREATE INDEX idx_model_registry_capabilities ON model_registry USING GIN(capabilities);
CREATE INDEX idx_model_registry_trust ON model_registry USING GIN(trust);
CREATE INDEX idx_model_registry_tool_access ON model_registry USING GIN(tool_access);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_model_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_registry_updated_at
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_model_registry_updated_at();
```

---

### A.3 mcp_server_registrations Table

```sql
-- MCP Server Registry (secondary metadata)
-- Tracks MCP server connection details separately from tools

CREATE TABLE mcp_server_registrations (
  -- Primary Key
  name VARCHAR(255) PRIMARY KEY,  -- MCP server name

  -- Connection Details
  transport VARCHAR(50) NOT NULL CHECK (transport IN ('stdio', 'http', 'sse', 'inactive')),
  connection_config JSONB NOT NULL,  -- {url?, command?, args?, env?}

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),

  -- Tool Tracking
  tools_imported TEXT[] DEFAULT '{}',  -- List of tool IDs imported from this server

  -- Discovery
  last_discovery_at TIMESTAMPTZ,
  last_connection_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,

  -- Lifecycle
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mcp_server_status ON mcp_server_registrations(status);
CREATE INDEX idx_mcp_server_transport ON mcp_server_registrations(transport);
CREATE INDEX idx_mcp_server_tools_imported ON mcp_server_registrations USING GIN(tools_imported);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_mcp_server_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mcp_server_updated_at
  BEFORE UPDATE ON mcp_server_registrations
  FOR EACH ROW
  EXECUTE FUNCTION update_mcp_server_updated_at();
```

---

### A.4 bit_registry Table (PROPOSED)

```sql
-- Bit Registry (PROPOSED - Section 10)
-- Tracks Bit metadata separate from tooling

CREATE TABLE bit_registry (
  -- Primary Key
  name VARCHAR(255) PRIMARY KEY,  -- Bit name

  -- Classification
  profile VARCHAR(50) NOT NULL CHECK (profile IN ('core', 'gateway', 'llm', 'mcp-server')),
  category VARCHAR(50) NOT NULL CHECK (category IN ('platform', 'domain')),
  mcp_exposure VARCHAR(50) NOT NULL CHECK (mcp_exposure IN ('platform-only', 'platform+domain', 'none')),

  -- Service Discovery
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL,
  health_endpoint VARCHAR(500),

  -- Capabilities
  provides_tools TEXT[] DEFAULT '{}',
  consumes_topics TEXT[] DEFAULT '{}',
  produces_topics TEXT[] DEFAULT '{}',

  -- Lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'stopped', 'degraded')),
  started_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ,

  -- Metrics
  uptime_seconds INTEGER DEFAULT 0,
  restart_count INTEGER DEFAULT 0,

  -- Timestamps
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bit_registry_profile ON bit_registry(profile);
CREATE INDEX idx_bit_registry_category ON bit_registry(category);
CREATE INDEX idx_bit_registry_status ON bit_registry(status);
CREATE INDEX idx_bit_registry_provides_tools ON bit_registry USING GIN(provides_tools);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_bit_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bit_registry_updated_at
  BEFORE UPDATE ON bit_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_bit_registry_updated_at();
```

---

### B.5 Migration Notes

**Firestore to PostgreSQL Migration**:
1. Use `IDocumentStore` abstraction - no code changes required
2. PostgreSQL driver maps DocumentStore methods to SQL queries
3. JSONB columns for flexible schemas (rbac, config, capabilities, trust)
4. GIN indexes for array and JSONB queries (essential for RBAC filtering)
5. Triggers for automatic `last_updated_at` maintenance

**Index Strategy**:
- **B-tree indexes**: Scalar fields (source, status, tier, provider)
- **GIN indexes**: Arrays (tags, required_roles), JSONB (rbac, capabilities, trust)
- **Partial indexes** (future): Filter active-only records for hot path queries

**Performance**:
- Tool registry: ~10-20k tools expected
- Model registry: ~100-500 models expected
- Query latency target: <10ms for single tool lookup, <50ms for filtered queries
- Connection pooling: 10-20 connections per service

---

## Appendix B: Loki/Promtail Configuration

### B.1 Promtail Configuration

**Purpose**: Ship structured JSON logs from all Bits to Loki with label extraction.

```yaml
# /etc/promtail/config.yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # Scrape Docker container logs for all BitBrat services
  - job_name: bitbrat
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s

    relabel_configs:
      # Only scrape containers with BitBrat label
      - source_labels: ['__meta_docker_container_label_com_bitbrat_service']
        action: keep
        regex: 'true'

      # Extract service name from container label
      - source_labels: ['__meta_docker_container_label_com_bitbrat_service_name']
        target_label: 'service'

      # Extract container name
      - source_labels: ['__meta_docker_container_name']
        target_label: 'container'

      # Extract execution context (local, staging, prod)
      - source_labels: ['__meta_docker_container_label_com_bitbrat_context']
        target_label: 'context'

    pipeline_stages:
      # Parse JSON logs (Pino format)
      - json:
          expressions:
            level: level
            msg: msg
            time: time
            correlationId: correlationId
            toolId: toolId
            modelId: modelId
            status: status
            service: service

      # Extract labels from JSON fields
      - labels:
          level:
          correlationId:
          toolId:
          modelId:
          status:
          service:

      # Add timestamp from log entry
      - timestamp:
          source: time
          format: RFC3339
```

---

### B.2 Loki Configuration

```yaml
# /etc/loki/config.yaml
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  lifecycler:
    address: 127.0.0.1
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1
    final_sleep: 0s
  chunk_idle_period: 5m
  chunk_retain_period: 30s

schema_config:
  configs:
    - from: 2024-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    cache_location: /loki/cache
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h  # 7 days

  # Label limits (prevent cardinality explosion)
  max_label_name_length: 1024
  max_label_value_length: 2048
  max_label_names_per_series: 30

  # Query limits
  max_entries_limit_per_query: 10000
  max_query_series: 500

chunk_store_config:
  max_look_back_period: 168h  # 7 days retention

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h  # 7 days
```

---

### B.3 Docker Compose Integration

```yaml
# infrastructure/docker-compose/observability.compose.yaml
version: '3.8'

services:
  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yaml:/etc/loki/config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/config.yaml
    networks:
      - bitbrat

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - ./promtail-config.yaml:/etc/promtail/config.yaml
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: -config.file=/etc/promtail/config.yaml
    networks:
      - bitbrat
    depends_on:
      - loki

  grafana:
    image: grafana/grafana:10.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_AUTH_ANONYMOUS_ENABLED=true
      - GF_AUTH_ANONYMOUS_ORG_ROLE=Admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana-datasources.yaml:/etc/grafana/provisioning/datasources/datasources.yaml
    networks:
      - bitbrat
    depends_on:
      - loki

volumes:
  loki-data:
  grafana-data:

networks:
  bitbrat:
    external: true
```

---

### B.4 Bit Logger Configuration

All Bits must log tool invocation events in structured JSON format:

```typescript
// src/apps/llm-bot-service.ts (example)
import { Bit } from '../common/base-server';

export class LlmBotService extends Bit {
  async executeTool(toolId: string, args: any, context: ToolExecutionContext) {
    const startedAt = new Date().toISOString();
    const eventId = randomUUID();

    try {
      const result = await this.toolExecutor.execute(toolId, args, context);

      // Log success event (Promtail → Loki)
      this.logger.info({
        eventId,
        correlationId: context.correlationId,
        toolId,
        toolName: tool.canonicalName,
        toolSource: tool.source,
        modelId: context.modelId,
        modelTier: modelTier,
        userId: context.userId,
        userRoles: context.userRoles,
        service: this.name,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
        status: 'success',
        inputPreview: JSON.stringify(args).substring(0, 200),
        outputPreview: JSON.stringify(result).substring(0, 200),
      }, 'tool.invocation.success');

      return result;
    } catch (err) {
      // Log error event
      this.logger.error({
        eventId,
        correlationId: context.correlationId,
        toolId,
        modelId: context.modelId,
        service: this.name,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(startedAt).getTime(),
        status: 'error',
        errorType: err.constructor.name,
        errorMessage: err.message?.substring(0, 500),
        errorCode: (err as any).code,
      }, 'tool.invocation.error');

      throw err;
    }
  }
}
```

**Critical Fields for Loki Labels** (indexed):
- `service` - Which Bit invoked the tool
- `toolId` - Canonical tool ID
- `modelId` - Which model invoked the tool
- `status` - success | error | timeout | rbac_denied
- `correlationId` - Request tracing
- `level` - Log level (info, warn, error)

---

### B.5 LogQL Query Examples

**Tool invocation rate by model**:
```logql
rate({service="llm-bot", toolId=~".+"} | json | __error__="" [5m]) by (modelId, toolId)
```

**Error rate for specific tool**:
```logql
rate({toolId="mcp:obs.set_scene_item_enabled", status="error"}[5m])
```

**Trace full request by correlationId**:
```logql
{correlationId="abc-123-def"} | json | line_format "{{.time}} [{{.service}}] {{.msg}}"
```

**RBAC denials by model**:
```logql
count_over_time({status="rbac_denied"} | json [1h]) by (modelId, toolId)
```

**P95 latency for premium models**:
```logql
quantile_over_time(0.95,
  {service="llm-bot", status="success"}
  | json
  | modelId =~ "gpt-4.*"
  | unwrap durationMs [5m]
)
```

---

## Appendix C: Model-Based vs Agent-Based RBAC Comparison

| Aspect | Agent-Based (Old) | Model-Based (New) |
|--------|------------------|-------------------|
| **Security Principal** | llm-bot, query-analyzer | gpt-4, claude-sonnet |
| **Permission Scope** | All requests from agent | Per-request based on model |
| **Cost Control** | Not possible | Restrict tools by model cost |
| **Security Tiers** | Coarse (agent level) | Fine-grained (model level) |
| **Same Agent Flexibility** | Fixed permissions | Different permissions per model |
| **Context Propagation** | Agent name in context | Model ID in context |
| **Composition RBAC** | Agent-based validation | Model-based validation |
| **Real-World Mapping** | Orchestrator ≠ decision-maker | Model = decision-maker ✓ |
| **Future-Proof** | No (agents don't evolve) | Yes (models evolve capabilities) |

**Example Scenario**:

```yaml
# User: alice (roles: [user, analyst])
# Request: "Generate image from this data"

# Agent-Based:
Agent: llm-bot
Permission: llm-bot.agentAllowlist includes generate_image? → YES
Result: ALLOWED (regardless of model used)

# Model-Based:
Model: gpt-3.5-turbo (tier: basic, cost-conscious mode)
Permission Check:
  - User has role 'user'? → YES
  - Model tier in [premium]? → NO (basic tier)
Result: DENIED - "generate_image requires premium model tier"

# Same user, different model:
Model: gpt-4 (tier: premium)
Permission Check:
  - User has role 'user'? → YES
  - Model tier in [premium]? → YES
Result: ALLOWED
```

**Conclusion**: Model-based RBAC aligns security with intelligence, enabling precise control over who (user) can do what (tool) with which intelligence (model).

---

### Appendix C.1: Important Clarification - Services NOT Affected by Model-Based RBAC

**Critical Distinction**: The Model-Based RBAC architecture affects **tool invocation flows**, not **direct LLM usage**.

#### Services Affected by Model-Based RBAC (Tool Invocation Flow)

These services invoke tools via tool-orchestrator and ARE affected by the architectural changes:

| Service | How It Invokes Tools | Impact of Model-Based RBAC |
|---------|---------------------|----------------------------|
| **llm-bot** | Calls tool-orchestrator via MCP to execute tools requested by LLM | ✅ Must pass `modelId` in ToolExecutionContext; tool access controlled by model permissions |
| **reflex** | Calls tool-orchestrator via MCP to execute reflexive actions | ✅ Must pass `modelId` if using model-driven reflexes; tool access controlled by model permissions |
| **Compositions** | Executed by tool-orchestrator, may invoke other tools | ✅ Composed tools validated against model permissions at execution time |

**Flow Example (llm-bot)**:
```
User message → llm-bot → LLM (gpt-4) suggests tool → llm-bot → tool-orchestrator (MCP) →
  ToolGateway validates model RBAC → Execute tool → Return result → llm-bot
```

#### Services NOT Affected by Model-Based RBAC (Direct LLM Usage)

These services use LLMs **directly** (not via tool invocation) and are NOT affected by tool-orchestrator changes:

| Service | How It Uses LLMs | Why NOT Affected |
|---------|------------------|------------------|
| **query-analyzer** | Calls `getLlmProvider()` directly via AI SDK (`analyzeWithLlm`, `generateEmbedding`) | ❌ No tool invocation; direct LLM API calls; no RBAC layer |
| **disposition-service** | Uses LLMs for behavior analysis (if configured) | ❌ Direct LLM calls for analysis, not tool execution |
| **story-engine-mcp** | May use LLMs for narrative generation | ❌ Direct LLM calls, not tool invocation (though it exposes tools via MCP) |

**Flow Example (query-analyzer)**:
```
Event → query-analyzer → getLlmProvider('ollama', 'llama3') → AI SDK generateObject() →
  LLM analysis → Add annotations → Publish enriched event
```

#### Why query-analyzer is Mentioned in the Comparison Table

The comparison table (Appendix A) lists **query-analyzer** as an example of the OLD "agent-based" security principal:

> **Security Principal** | llm-bot, query-analyzer | gpt-4, claude-sonnet

**This reference is intentionally illustrative**, not literal:
- **Illustrative**: Shows that in the OLD agent-based thinking, we might have considered restricting tools based on whether they're invoked by "llm-bot" vs "query-analyzer"
- **Not Literal**: query-analyzer doesn't actually invoke tools, so it was never subject to agent-based tool RBAC
- **Teaching Point**: Emphasizes that the OLD model conflated orchestrator identity (which service is running) with decision-maker identity (which model is thinking)

#### Cascading Effects Summary

**Services Affected** (must be updated):
- ✅ llm-bot: Update ToolExecutionContext to include `modelId`
- ✅ reflex: Update context passing if using model-driven reflexes
- ✅ tool-orchestrator: Implement dual-layer RBAC validation
- ✅ Compositions: Validate composed tools against model permissions

**Services NOT Affected** (no changes required):
- ❌ query-analyzer: Direct LLM usage unchanged
- ❌ disposition-service: Direct LLM usage unchanged
- ❌ story-engine-mcp: Direct LLM usage unchanged (tool exposure unaffected)

**Architectural Insight**: The Model-Based RBAC shift is a **tool security paradigm**, not an LLM usage paradigm. Services that use LLMs to analyze, generate, or enrich data (without invoking external tools) remain architecturally independent from tool-orchestrator.
