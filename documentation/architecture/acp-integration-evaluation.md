88# Agent Communication Protocol (ACP) Integration Evaluation

**Document Type:** Architectural Evaluation
**Status:** Proposal
**Author:** Platform Architect
**Date:** 2026-07-08
**Related:** Sprint 333 (Dev MCP Server), Bit Model, Event-Driven Architecture

---

## Executive Summary

This document evaluates the integration of the **Agent Communication Protocol (ACP)** into the BitBrat platform architecture. ACP is an emerging standard for agent-to-agent communication that complements the existing Model Context Protocol (MCP), which focuses on agent-to-tool communication.

**Key Findings:**
- ✅ **High Alignment**: ACP's message-passing paradigm aligns naturally with BitBrat's event-driven architecture
- ✅ **Complementary to MCP**: ACP handles agent coordination while MCP handles tool access
- ⚡ **Strategic Opportunity**: Position BitBrat as an ACP-native orchestration platform
- ⚠️ **Integration Complexity**: Requires careful mapping between ACP semantics and BitBrat's routing slip model
- 📊 **ROI**: High - Enables multi-agent workflows, distributed reasoning, and agent mesh topologies

**Recommendation:** **Proceed with ACP integration** as a Phase 2 enhancement (post-Sprint 334), targeting 0.10.0 release.

---

## Table of Contents

1. [ACP Overview](#acp-overview)
2. [BitBrat Architecture Recap](#bitbrat-architecture-recap)
3. [Integration Points](#integration-points)
4. [Proposed Architecture](#proposed-architecture)
5. [Use Cases](#use-cases)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Risks & Mitigations](#risks--mitigations)
8. [Alternatives Considered](#alternatives-considered)
9. [Decision Framework](#decision-framework)

---

## ACP Overview

### What is ACP?

The **Agent Communication Protocol (ACP)** is a specification for structured communication between autonomous agents. Unlike MCP (agent-to-tool), ACP defines agent-to-agent interactions.

**Core Concepts:**

1. **Message Types**
   - `task` - Request another agent to perform work
   - `query` - Ask another agent for information
   - `inform` - Notify another agent of state changes
   - `propose` - Suggest collaboration or negotiation
   - `accept/reject` - Response to proposals

2. **Agent Discovery**
   - Agents advertise capabilities
   - Discovery via registry or broadcast
   - Capability matching for task delegation

3. **Conversation Management**
   - Thread-based conversations (conversation ID)
   - Request-response correlation
   - Multi-turn interactions

4. **Protocol Semantics**
   - Asynchronous message passing
   - At-least-once delivery (matches BitBrat)
   - Optional acknowledgment and confirmation

### ACP vs MCP

| Aspect | MCP | ACP |
|--------|-----|-----|
| **Purpose** | Agent-to-tool communication | Agent-to-agent communication |
| **Direction** | Agent calls tools | Agent requests other agents |
| **Interaction** | Synchronous (mostly) | Asynchronous (mostly) |
| **Discovery** | Tool listing | Agent registry + capabilities |
| **State** | Stateless tools | Stateful agents |
| **Examples** | `db.query`, `fleet.info` | `analyze.sentiment`, `classify.image` |

**Complementary Relationship:**
- **MCP**: Agent uses `db.query` tool to fetch data
- **ACP**: Agent sends `analyze` task to specialist agent, which uses MCP tools internally

---

## BitBrat Architecture Recap

### Current Event-Driven Model

BitBrat decomposes the classic agent loop into independent message-passing services:

```
┌─────────────────────────────────────────────────────────────┐
│                    BitBrat Agent Loop                       │
├─────────────────────────────────────────────────────────────┤
│  Perceive → Plan → Act → Observe                            │
│     ↓        ↓      ↓       ↓                               │
│  Ingress  Router  LLM/   Persistence                        │
│           +Rules  Reflex  +Egress                           │
└─────────────────────────────────────────────────────────────┘
```

**Key Components:**

1. **Envelope v1** - Universal message wrapper
   - `correlationId` - Message identity
   - `routingSlip` - Orchestration instructions
   - `payload` - Event data
   - `replyTo` - Response routing

2. **Event Router** - Rule-based message routing
   - JsonLogic rules match events
   - Routing slips orchestrate processing steps
   - Each step = topic + service

3. **Bits** - Autonomous service units
   - Platform Bits: Core orchestration (10 services)
   - Domain Bits: Optional extensions (6 services)
   - Each Bit exposes MCP control plane (`bit.*`)

4. **Message Bus**
   - Local: NATS JetStream
   - Production: Google Cloud Pub/Sub
   - At-least-once delivery, idempotent consumers

---

## Integration Points

### 1. ACP as Event Types

**Concept:** Map ACP message types to BitBrat event types.

**Current Event Types:**
```typescript
type InternalEventV2 = {
  type: 'chat' | 'command' | 'subscription' | 'timeout' | ...
  payload: { ... }
  routingSlip?: RoutingSlip
}
```

**With ACP:**
```typescript
type InternalEventV2 = {
  type: 'chat' | 'command' | 'acp.task' | 'acp.query' | 'acp.inform' | ...
  payload: ACPMessage | ...
  routingSlip?: RoutingSlip
}

type ACPMessage = {
  messageType: 'task' | 'query' | 'inform' | 'propose' | 'accept' | 'reject'
  conversationId: string
  fromAgent: string
  toAgent: string
  content: {
    action?: string        // e.g., "analyze.sentiment"
    data?: unknown
    capabilities?: string[]
  }
  replyTo?: string
  inReplyTo?: string
}
```

**Integration:**
- ACP messages arrive via `internal.acp.v1` topic
- Event Router routes based on `toAgent` and `action`
- Response routed back via `replyTo` or `conversationId`

---

### 2. Bits as ACP Agents

**Concept:** Every Bit can act as an ACP agent with advertised capabilities.

**Current Bit Metadata:**
```yaml
services:
  llm-bot:
    profile: llm
    mcp:
      exposure: platform-only
```

**With ACP:**
```yaml
services:
  llm-bot:
    profile: llm
    mcp:
      exposure: platform-only
    acp:
      enabled: true
      capabilities:
        - action: "generate.response"
          input: { type: "chat_message" }
          output: { type: "text" }
        - action: "analyze.intent"
          input: { type: "user_query" }
          output: { type: "intent_classification" }
      discovery:
        registry: true
        broadcast: false
```

**Bit Control Plane Extension:**
- `bit.acp.capabilities` - List agent's ACP capabilities
- `bit.acp.send` - Send ACP message to another agent
- `bit.acp.subscribe` - Subscribe to ACP message types

**Discovery:**
- Bits register capabilities in database `agent_registry` collection/table
- `acp-registry` service acts as capability matcher
- Agents query registry to find suitable collaborators

---

### 3. Routing Slip + ACP Conversations

**Concept:** Extend routing slip to handle multi-agent conversations.

**Current Routing Slip:**
```typescript
type RoutingSlip = {
  steps: Array<{
    topic: string
    description: string
    timeout?: number
  }>
  currentStepIndex: number
  completed: boolean
}
```

**With ACP Conversations:**
```typescript
type RoutingSlip = {
  steps: Array<{
    topic: string
    description: string
    timeout?: number
    acpConversation?: {
      conversationId: string
      toAgent: string
      action: string
      awaitResponse: boolean
    }
  }>
  currentStepIndex: number
  completed: boolean
  conversations?: Map<string, ACPConversationState>
}

type ACPConversationState = {
  conversationId: string
  participants: string[]
  messages: ACPMessage[]
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}
```

**Flow:**
1. Event Router encounters ACP step
2. Creates ACP message with `conversationId`
3. Publishes to `internal.acp.v1.{toAgent}`
4. Target agent processes, publishes response to `internal.acp.response.v1`
5. Event Router resumes routing slip with response

---

### 4. ACP Gateway Service

**Concept:** New Platform Bit to manage ACP protocol translation.

**Service Definition:**
```yaml
services:
  acp-gateway:
    active: true
    category: platform
    profile: gateway
    kind: gateway
    entry: src/apps/acp-gateway.ts
    port: 3020
    mcp:
      exposure: platform+domain
    acp:
      enabled: true
      role: gateway
    topics:
      consumes:
        - internal.acp.v1
        - internal.acp.response.v1
      publishes:
        - internal.enriched.v1
        - internal.acp.*.v1
```

**Responsibilities:**
1. **Protocol Translation**
   - ACP messages → BitBrat Envelope v1
   - BitBrat events → ACP messages (for external agents)

2. **Conversation Management**
   - Track active conversations
   - Handle timeouts and retries
   - Correlate request-response pairs

3. **Agent Discovery**
   - Maintain agent registry (Firestore)
   - Handle capability matching
   - Provide discovery API

4. **External ACP Bridge**
   - Accept ACP messages from external agents (HTTP/WebSocket)
   - Authenticate and validate
   - Route to appropriate BitBrat services

---

## Proposed Architecture

### Hybrid ACP + BitBrat Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     External Environment                        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ External ACP │    │ External ACP │    │   Claude /   │      │
│  │  Agent A     │    │  Agent B     │    │   ChatGPT    │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
└─────────┼────────────────────┼────────────────────┼─────────────┘
          │ ACP/HTTP           │ ACP/HTTP           │ MCP/stdio
          ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BitBrat Platform                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    ACP Gateway                           │  │
│  │  - Protocol translation (ACP ↔ Envelope v1)             │  │
│  │  - Conversation management                              │  │
│  │  - Agent registry & discovery                           │  │
│  │  - External agent authentication                        │  │
│  └─────────────┬───────────────────────────┬────────────────┘  │
│                │                           │                    │
│                ▼                           ▼                    │
│  ┌──────────────────────┐   ┌──────────────────────────────┐  │
│  │   Event Router       │   │   MCP Tool Gateway           │  │
│  │  - JsonLogic rules   │   │  - Tool proxy & security     │  │
│  │  - Routing slips     │   │  - MCP protocol handling     │  │
│  │  - ACP step handling │   │                              │  │
│  └──────────┬───────────┘   └──────────────┬───────────────┘  │
│             │                               │                  │
│             ├───────────────┬───────────────┤                  │
│             ▼               ▼               ▼                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │   LLM Bot    │ │  Query       │ │   Reflex     │          │
│  │ (ACP Agent)  │ │  Analyzer    │ │ (Fast Agent) │          │
│  │              │ │ (ACP Agent)  │ │ (ACP Agent)  │          │
│  │ Capabilities:│ │              │ │              │          │
│  │ - generate   │ │ Capabilities:│ │ Capabilities:│          │
│  │ - classify   │ │ - analyze    │ │ - execute    │          │
│  │ - summarize  │ │ - classify   │ │ - trigger    │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                                 │
│  Message Bus (NATS / Pub/Sub)                                  │
│  Topics:                                                        │
│  - internal.acp.v1 (incoming ACP messages)                     │
│  - internal.acp.response.v1 (ACP responses)                    │
│  - internal.acp.discovery.v1 (capability queries)              │
│  - internal.enriched.v1 (existing enrichment topic)            │
└─────────────────────────────────────────────────────────────────┘
```

### Message Flow Example: Multi-Agent Sentiment Analysis

```typescript
// 1. User sends chat message
{
  type: 'chat',
  payload: { message: "I'm so frustrated with this!" },
  routingSlip: {
    steps: [
      { topic: 'internal.query.analysis.v1', description: 'Fast pre-analysis' },
      {
        topic: 'internal.acp.v1',
        description: 'Delegate sentiment analysis to specialist',
        acpConversation: {
          toAgent: 'sentiment-analyzer',
          action: 'analyze.sentiment',
          awaitResponse: true
        }
      },
      { topic: 'internal.llmbot.v1', description: 'Generate empathetic response' },
      { topic: 'internal.egress.v1', description: 'Deliver response' }
    ]
  }
}

// 2. Event Router publishes ACP task
{
  messageType: 'task',
  conversationId: 'conv-abc123',
  fromAgent: 'event-router',
  toAgent: 'sentiment-analyzer',
  content: {
    action: 'analyze.sentiment',
    data: { text: "I'm so frustrated with this!" }
  },
  replyTo: 'internal.acp.response.v1'
}

// 3. Sentiment Analyzer (specialist ACP agent) responds
{
  messageType: 'inform',
  conversationId: 'conv-abc123',
  fromAgent: 'sentiment-analyzer',
  toAgent: 'event-router',
  content: {
    result: {
      sentiment: 'negative',
      emotion: 'frustration',
      intensity: 0.85,
      confidence: 0.92
    }
  },
  inReplyTo: 'msg-xyz789'
}

// 4. Event Router enriches event and continues routing slip
{
  type: 'chat',
  payload: {
    message: "I'm so frustrated with this!",
    analysis: {
      sentiment: 'negative',
      emotion: 'frustration',
      intensity: 0.85
    }
  },
  routingSlip: {
    steps: [...],
    currentStepIndex: 2  // Now on LLM bot step
  }
}

// 5. LLM Bot generates empathetic response using sentiment context
{
  type: 'response',
  payload: {
    message: "I understand this is frustrating. Let me help you with that...",
    tone: 'empathetic'
  }
}
```

---

## Use Cases

### Use Case 1: Distributed Reasoning Chain

**Scenario:** Complex user query requires multiple specialized agents.

**Flow:**
1. **User**: "Analyze my stream performance and suggest improvements"
2. **Query Analyzer** (ACP Agent): Classifies as multi-step analysis
3. **Event Router**: Creates ACP routing slip with delegation:
   - `stream-analyst` → Analyze metrics
   - `engagement-analyzer` → Analyze chat patterns
   - `recommendation-engine` → Generate suggestions
4. **Agents collaborate** via ACP task/inform messages
5. **LLM Bot**: Synthesizes results into coherent response
6. **Egress**: Delivers to user

**Benefits:**
- Specialized agents handle domain expertise
- Parallel execution where possible
- Composable reasoning pipeline

---

### Use Case 2: Agent Mesh Topology

**Scenario:** Multiple agents self-organize to solve complex problems.

**Flow:**
1. **Coordinator Agent** receives high-level goal
2. Broadcasts ACP `propose` to capable agents
3. Agents respond with `accept/reject` based on capabilities
4. Coordinator orchestrates via ACP `task` messages
5. Agents publish `inform` messages with partial results
6. Coordinator synthesizes final result

**Example:**
- **Goal**: "Create a highlight reel from my stream"
- **Agents**:
  - `video-analyzer` → Identifies exciting moments
  - `chat-analyzer` → Finds high-engagement chat
  - `audio-analyzer` → Detects music/sound highlights
  - `video-editor` → Compiles clips
  - `upload-service` → Publishes to YouTube

**Benefits:**
- Dynamic agent composition
- Fault tolerance (agent can reject if overloaded)
- Scalable to complex workflows

---

### Use Case 3: External Agent Integration

**Scenario:** BitBrat collaborates with external ACP-compatible agents.

**Flow:**
1. **External Image Generation Agent** registers with BitBrat ACP Gateway
2. **User**: "Generate a logo for my channel"
3. **Event Router**: Queries ACP registry for `generate.image` capability
4. **ACP Gateway**: Finds external agent, sends ACP task
5. **External Agent**: Generates image, responds via ACP
6. **BitBrat**: Stores image in GCS, delivers URL to user

**Benefits:**
- Extends BitBrat capabilities without deploying new services
- Leverages external specialized agents (image gen, video editing, etc.)
- Standards-based integration (no custom protocols)

---

### Use Case 4: Multi-Turn Agent Conversations

**Scenario:** Agent needs clarification or iterative refinement.

**Flow:**
1. **User**: "Summarize my last stream"
2. **Summarizer Agent** (ACP): Sends ACP `query` to `stream-metadata` agent
   - "What was the stream duration and game played?"
3. **Stream Metadata Agent**: Responds with ACP `inform`
4. **Summarizer Agent**: Sends ACP `task` to `highlight-detector`
   - "Find top 5 moments from stream XYZ"
5. **Highlight Detector**: Returns highlights via ACP `inform`
6. **Summarizer Agent**: Generates summary, publishes to routing slip

**Benefits:**
- Multi-turn interactions without blocking main flow
- Agents request exactly what they need
- Conversation state tracked via `conversationId`

---

## Implementation Roadmap

### Phase 1: Foundation (Sprint 334-335, ~2 weeks)

**Deliverables:**
1. **ACP Gateway Service**
   - Basic ACP message handling (task, query, inform)
   - Conversation management (in-memory)
   - Internal ACP topic routing

2. **Envelope v1 Extensions**
   - Add `acpConversation` to routing slip steps
   - Add `conversationId` to Envelope metadata

3. **Agent Registry**
   - Database collection/table: `agent_registry`
   - Schema: `{ agentId, capabilities[], status, lastSeen }`
   - Basic discovery API

4. **Proof of Concept**
   - Convert 1-2 existing Bits to ACP agents (e.g., query-analyzer)
   - Demonstrate internal ACP task delegation
   - Tests: Unit + integration

**Acceptance Criteria:**
- ✅ ACP Gateway processes task/query/inform messages
- ✅ Event Router routes ACP steps correctly
- ✅ At least 2 Bits communicate via ACP internally
- ✅ Agent registry stores and retrieves capabilities

---

### Phase 2: External Integration (Sprint 336-337, ~2 weeks)

**Deliverables:**
1. **External ACP Bridge**
   - HTTP/WebSocket endpoint for external ACP agents
   - Authentication (bearer token, API key)
   - Rate limiting and quota enforcement

2. **Protocol Translation**
   - External ACP → BitBrat Envelope v1
   - BitBrat events → External ACP (for responses)

3. **Conversation Persistence**
   - Database collection/table: `acp_conversations`
   - State: pending, in_progress, completed, failed
   - Timeout handling

4. **MCP + ACP Integration**
   - MCP tools for ACP operations:
     - `acp.send` - Send ACP message to agent
     - `acp.capabilities` - Query agent capabilities
     - `acp.conversations` - List active conversations

**Acceptance Criteria:**
- ✅ External agents can send ACP messages to BitBrat
- ✅ BitBrat routes to internal agents and returns responses
- ✅ Conversations persisted with TTL
- ✅ MCP tools expose ACP functionality

---

### Phase 3: Advanced Features (Sprint 338-340, ~3 weeks)

**Deliverables:**
1. **Proposal/Negotiation**
   - Support for `propose`, `accept`, `reject` message types
   - Agent selection based on capabilities + availability

2. **Agent Mesh Orchestration**
   - Coordinator agent pattern
   - Fan-out/fan-in aggregation
   - Partial failure tolerance

3. **Enhanced Discovery**
   - Capability matching with filters
   - Agent health monitoring
   - Load-based routing

4. **Observability**
   - ACP conversation tracing
   - Agent performance metrics
   - Conversation analytics

**Acceptance Criteria:**
- ✅ Agents negotiate task delegation via propose/accept
- ✅ Coordinator orchestrates multi-agent workflows
- ✅ Discovery includes health and load metrics
- ✅ Conversation traces visible in observability tools

---

### Phase 4: Production Hardening (Sprint 341-342, ~2 weeks)

**Deliverables:**
1. **Reliability**
   - Retry logic with exponential backoff
   - Circuit breakers for unhealthy agents
   - Dead-letter queue for failed conversations

2. **Security**
   - Agent authentication (mutual TLS, JWT)
   - Authorization (RBAC for ACP operations)
   - Input validation and sanitization

3. **Performance**
   - Conversation state caching (Redis)
   - Agent discovery caching
   - Horizontal scaling of ACP Gateway

4. **Documentation**
   - ACP integration guide
   - Agent development tutorial
   - Conversation patterns cookbook

**Acceptance Criteria:**
- ✅ 99.9% ACP message delivery success
- ✅ All external ACP endpoints secured
- ✅ ACP Gateway scales to 1000+ conversations/sec
- ✅ Comprehensive documentation published

---

## Risks & Mitigations

### Risk 1: ACP Specification Stability

**Risk:** ACP is an emerging standard; specification may change.

**Probability:** Medium
**Impact:** High (breaking changes require rework)

**Mitigation:**
1. Version ACP messages (e.g., `acp.v1`, `acp.v2`)
2. Isolate ACP logic in ACP Gateway (single point of change)
3. Monitor ACP specification discussions
4. Participate in ACP standards community

---

### Risk 2: Conversation State Explosion

**Risk:** Long-running conversations consume excessive memory/storage.

**Probability:** Medium
**Impact:** Medium (performance degradation)

**Mitigation:**
1. Enforce conversation TTLs (default: 1 hour)
2. Limit max messages per conversation (default: 100)
3. Archive completed conversations to cold storage
4. Monitor conversation metrics (count, duration, size)

---

### Risk 3: External Agent Trust

**Risk:** Malicious or buggy external agents disrupt platform.

**Probability:** Low
**Impact:** High (DoS, data corruption)

**Mitigation:**
1. Strict authentication (mutual TLS + API keys)
2. Rate limiting per agent (1000 req/min)
3. Input validation and sanitization
4. Agent reputation system (track success/failure rates)
5. Circuit breakers for unhealthy agents
6. Sandbox external agent responses

---

### Risk 4: Deadlock in Agent Mesh

**Risk:** Circular dependencies cause conversation deadlocks.

**Probability:** Low
**Impact:** Medium (stuck conversations)

**Mitigation:**
1. Detect cycles in agent dependency graphs
2. Timeout all agent-to-agent calls (default: 30s)
3. Dead-letter failed conversations
4. Coordinator pattern prevents cycles
5. Monitor conversation depth (max: 10 levels)

---

### Risk 5: Migration Complexity

**Risk:** Existing Bits require significant changes to become ACP agents.

**Probability:** Medium
**Impact:** Medium (slow adoption)

**Mitigation:**
1. Gradual migration: start with new Bits
2. Adapter pattern: wrap non-ACP Bits
3. Provide scaffolding via `brat bit create --acp`
4. Document migration patterns
5. Pilot with 2-3 Bits before broad rollout

---

## Alternatives Considered

### Alternative 1: Custom Agent Protocol

**Description:** Design BitBrat-specific agent-to-agent protocol.

**Pros:**
- Full control over semantics
- Optimized for BitBrat architecture
- No external dependencies

**Cons:**
- No ecosystem interoperability
- Reinventing the wheel
- Fragmentation (one more protocol)

**Decision:** ❌ **Rejected** - ACP provides standardization and ecosystem

---

### Alternative 2: Direct Service-to-Service Calls

**Description:** Bits call each other directly via HTTP/gRPC.

**Pros:**
- Simple to implement
- Low latency (synchronous)
- Familiar pattern

**Cons:**
- Tight coupling between Bits
- Doesn't scale to external agents
- No conversation management
- Breaks event-driven model

**Decision:** ❌ **Rejected** - Violates BitBrat's message-passing architecture

---

### Alternative 3: Extend Routing Slip Only

**Description:** Add agent delegation to routing slip without ACP.

**Pros:**
- Minimal changes to existing architecture
- No new protocol to learn
- Reuses routing slip semantics

**Cons:**
- No external agent support
- No standard discovery mechanism
- Limited to BitBrat ecosystem

**Decision:** ⚠️ **Partial Adoption** - Routing slip extensions are useful, but need ACP for external agents

---

### Alternative 4: MCP-Based Agent Communication

**Description:** Repurpose MCP for agent-to-agent communication.

**Pros:**
- Already integrated (Sprint 333)
- Familiar to developers
- Single protocol

**Cons:**
- MCP designed for agent-to-tool, not agent-to-agent
- Semantic mismatch (stateless tools vs stateful agents)
- Conversation management not in MCP spec

**Decision:** ❌ **Rejected** - MCP and ACP are complementary, not substitutes

---

## Decision Framework

### Strategic Alignment Assessment

| Criterion | Score (1-5) | Rationale |
|-----------|-------------|-----------|
| **Aligns with event-driven architecture** | 5 | ACP is message-passing; perfect fit |
| **Enables external integrations** | 5 | ACP is standard; enables ecosystem |
| **Complements MCP** | 5 | MCP = tools, ACP = agents; no overlap |
| **Scales to complex workflows** | 4 | Agent mesh enables sophisticated orchestration |
| **Developer experience** | 4 | Standard protocol reduces learning curve |
| **Time to value** | 3 | Requires 8-10 weeks for full implementation |
| **Risk level** | 3 | Emerging standard; some uncertainty |

**Overall Score:** 4.1/5 - **Strong strategic fit**

---

### Go/No-Go Decision Criteria

| Criterion | Threshold | Status |
|-----------|-----------|--------|
| Strategic alignment score | ≥3.5 | ✅ 4.1 |
| Time to MVP | ≤4 weeks | ✅ Phase 1: 2 weeks |
| Breaking changes to existing Bits | ≤10% | ✅ 0% (additive) |
| External dependencies | ≤2 | ✅ 1 (ACP spec) |
| Team bandwidth | Available | ⚠️ Requires prioritization |

**Decision:** ✅ **GO** - Proceed with ACP integration

---

## Recommendations

### Immediate Actions (Next 2 Weeks)

1. **Spike**: Prototype ACP Gateway with simple task/inform handling
2. **Standards Participation**: Join ACP working group discussions
3. **Team Training**: Study ACP specification and reference implementations
4. **Architecture Review**: Present this evaluation to stakeholders

### Short-Term (Sprint 334-335)

1. **Implement Phase 1**: ACP Gateway + basic agent registry
2. **Pilot Bits**: Convert query-analyzer and sentiment-analyzer to ACP agents
3. **Documentation**: Write ACP integration guide for Bit developers
4. **Metrics**: Define success criteria and observability

### Medium-Term (Sprint 336-340)

1. **Implement Phases 2-3**: External bridge, advanced features
2. **Ecosystem Building**: Encourage domain Bit developers to adopt ACP
3. **Case Studies**: Document successful multi-agent workflows
4. **Performance Tuning**: Optimize conversation management

### Long-Term (Post-0.10.0)

1. **ACP Marketplace**: Registry of external ACP-compatible agents
2. **Agent Marketplace**: Allow third-party agents to register
3. **Multi-Tenant**: Support multiple ACP namespaces
4. **Standards Leadership**: Contribute improvements to ACP spec

---

## Conclusion

**ACP integration represents a strategic opportunity** to position BitBrat as an ACP-native orchestration platform. The protocol aligns naturally with BitBrat's event-driven architecture and complements the existing MCP integration (Sprint 333).

**Key Benefits:**
1. **Multi-Agent Workflows**: Enable sophisticated agent collaboration
2. **External Ecosystem**: Integrate with ACP-compatible agents
3. **Standards Compliance**: Leverage emerging industry standard
4. **Scalability**: Agent mesh topologies for complex orchestration

**Recommended Approach:**
- ✅ **Proceed** with phased implementation
- ✅ **Prioritize** internal ACP first (Phases 1-2)
- ✅ **Validate** with pilot Bits before broad adoption
- ✅ **Monitor** ACP specification evolution

**Next Step:** **Approve Phase 1 implementation** targeting Sprint 334 (post-Dev MCP Server release).

---

**Document Status:** Ready for Review
**Target Audience:** Platform Architects, Engineering Leadership
**Related Documents:**
- Bit Model Technical Architecture
- Event Router Rules Specification
- Dev MCP Server Integration (Sprint 333)
- Platform Flow Documentation

**Approval Required:** Engineering Lead, Product Owner
**Target Decision Date:** 2026-07-15
