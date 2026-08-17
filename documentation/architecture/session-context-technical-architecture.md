# Session Context System – Technical Architecture

- **Date:** 2026-08-16
- **Status:** DRAFT – Architectural Exploration
- **Author:** Platform Architecture Team
- **Source of Truth:** `architecture.yaml` + existing event/state systems
- **Related Systems:** State Engine, Disposition Service, Event Router, LLM Bot

---

## 1. Executive Summary

This document explores architectural approaches for implementing **dynamic, named, scoped contexts** (colloquially "sessions") in the BitBrat platform. The goal is to enable:

1. **Session-scoped events** – e.g., "user's first message of this stream", "Nth turn in this session"
2. **Session-scoped constraints** – e.g., "X tool invocations per user per session"
3. **Cross-bit visibility** – Any bit can reference and query session state
4. **Platform-agnostic naming** – "Session" terminology decouples from "streaming" even though Twitch streams are a primary use case

The document presents **three architectural approaches** with trade-offs, then recommends a hybrid path forward.

---

## 2. Problem Statement

### 2.1 Current State

BitBrat currently has **event-scoped** and **user-scoped** state primitives:

| Primitive | Scope | Storage | TTL | Example |
|-----------|-------|---------|-----|---------|
| `correlationId` | Single event | Envelope metadata | N/A | Trace a single user message through the pipeline |
| `traceId` | Related event chain | Envelope metadata | N/A | Group correlated events (optional) |
| `DispositionSnapshot` | User + time window | Firestore/Postgres (`disposition_observations`) | 15-20 min | User's recent behavioral tone |
| `StateSnapshot` | Arbitrary key | Firestore/Postgres (`state`) | Configurable | Persistent platform state (e.g., `stream.state`, `user.points.{userId}`) |
| LLM memory | User + conversation | In-memory (llm-bot) | Process lifetime | Recent chat history for continuity |

### 2.2 Missing Capabilities

**Session-scoped primitives** are absent. Examples of what we cannot easily express today:

1. **"First message of this stream"** – Requires knowing when a stream session began and if the user has sent any messages *in this session*
2. **"Turn counter"** – Cannot track "this is your 3rd question in this stream session"
3. **"Tool invocation quota per session"** – Cannot enforce "max 5 image generations per stream" without manual correlation
4. **"Session boundary detection"** – No canonical way to know when a session started/ended
5. **"Cross-bit session queries"** – Reflex/LLM-bot/Event-router cannot easily ask "what's the current session ID for this user/stream?"

### 2.3 Requirements

1. **Dynamic naming** – Sessions can be defined at runtime, not just hardcoded types
2. **Multi-dimensional scoping** – Sessions may be scoped by `user`, `stream`, `platform`, `channel`, or combinations
3. **TTL-bounded** – Sessions expire (e.g., when stream ends + grace period)
4. **Event derivation** – Bits can emit/consume session lifecycle events (`session.started.v1`, `session.heartbeat.v1`, `session.ended.v1`)
5. **Constraint enforcement** – Platform can enforce session-scoped rate limits, quotas, or feature flags
6. **Platform-agnostic** – Not tied to "Twitch streams"; works for Discord voice channels, API sessions, scheduled task runs, etc.
7. **Cross-bit visibility** – Any bit (not just ingress) can query "what session(s) is this event part of?"

---

## 3. Architectural Approaches

### 3.1 Approach A: Sessions as State Keys (Minimal Extension)

**Concept:** Treat sessions as a naming convention on top of the existing **State Engine** (`MutationProposal` + `StateSnapshot`).

#### Design

```typescript
// Session identified by composite key
const sessionKey = `session:${scope}:${id}`;
// Example: "session:stream:twitch:channel_123:20260816_1430"

interface SessionStateValue {
  id: string;                    // Unique session ID
  scope: SessionScope;           // { type: 'stream', platform: 'twitch', channel: '...' }
  startedAt: string;             // ISO8601
  lastHeartbeat: string;         // ISO8601
  status: 'active' | 'ended';
  metadata: {
    turnCount?: number;
    invocationCounts?: Record<string, number>;
    firstMessageSeen?: boolean;
    [key: string]: any;
  };
}
```

#### How It Works

1. **Session creation** – When ingress-egress detects "stream.online" (or API gateway sees first WebSocket connection), publish `MutationProposal` to create `session:stream:twitch:channel_123:20260816_1430`
2. **Session reads** – Bits query State Engine for active sessions via `state-engine` MCP tool or direct Firestore/Postgres read
3. **Session updates** – Bits publish `MutationProposal` to increment `turnCount`, update `invocationCounts`, etc.
4. **Session expiration** – State Engine TTL handles cleanup (e.g., `ttl: 3600` = 1 hour after last heartbeat)
5. **Session events** – Bits emit custom events like `system.session.user_first_message.v1` by checking `metadata.firstMessageSeen`

#### Pros

- **Minimal new infrastructure** – Reuses State Engine, which already has Firestore/Postgres backends, TTL, mutation log, versioning
- **Immediate availability** – No new services to build
- **Transactional consistency** – `MutationProposal` supports optimistic concurrency (`expectedVersion`)
- **Auditability** – Mutation log provides full session history

#### Cons

- **No first-class session API** – Sessions are just state keys; no session-specific queries beyond key lookups
- **Manual event derivation** – Bits must manually emit session lifecycle events
- **No session registry** – Cannot easily enumerate "all active sessions" without full table scan
- **Coupling to State Engine schema** – Session metadata lives in generic `value: any` field

#### Example: "First Message of Stream"

```typescript
// In event-router or LLM-bot enrichment step:
const sessionKey = `session:stream:twitch:${channelId}:${sessionId}`;
const sessionState = await stateEngine.get(sessionKey);

if (!sessionState?.metadata?.users?.[userId]?.firstMessageSeen) {
  // Emit first-message event
  await publish({
    type: 'system.user.first_session_message',
    sessionId,
    userId,
    correlationId: event.correlationId,
  });

  // Mark as seen
  await stateEngine.mutate({
    op: 'set',
    key: sessionKey,
    value: {
      ...sessionState,
      metadata: {
        ...sessionState.metadata,
        users: {
          ...sessionState.metadata.users,
          [userId]: { firstMessageSeen: true },
        },
      },
    },
  });
}
```

---

### 3.2 Approach B: Dedicated Session Service (New Platform Bit)

**Concept:** Introduce a new **session-service** platform bit that owns session lifecycle, storage, and event emission.

#### Design

```typescript
// New session domain types (src/types/session.ts)
export interface SessionScope {
  type: 'stream' | 'conversation' | 'api' | 'task' | string;
  dimensions: Record<string, string>; // { platform: 'twitch', channel: '...' }
}

export interface Session {
  id: string;                    // UUID or composite key
  scope: SessionScope;
  status: 'starting' | 'active' | 'ending' | 'ended';
  startedAt: string;
  lastHeartbeat: string;
  endedAt?: string;
  ttl: number;                   // Seconds
  counters: Record<string, number>;    // e.g., { turns: 5, toolCalls: 3 }
  participants: Record<string, SessionParticipant>;
  metadata: Record<string, any>;
}

export interface SessionParticipant {
  userId: string;
  joinedAt: string;
  firstMessageAt?: string;
  messageCount: number;
}

// Session lifecycle events (message bus topics)
export const SESSION_STARTED_V1 = 'internal.session.started.v1';
export const SESSION_HEARTBEAT_V1 = 'internal.session.heartbeat.v1';
export const SESSION_ENDED_V1 = 'internal.session.ended.v1';
export const SESSION_PARTICIPANT_JOINED_V1 = 'internal.session.participant.joined.v1';
export const SESSION_FIRST_MESSAGE_V1 = 'internal.session.first_message.v1';
```

#### Service Responsibilities

1. **Session lifecycle management**
   - Create sessions on `internal.ingress.v1` events (stream online, API connect)
   - Update heartbeat on activity
   - End sessions on explicit signals (stream offline) or TTL expiration

2. **Counter tracking**
   - Increment `turns`, `toolCalls`, etc. on relevant events
   - Enforce quotas (reject events if `toolCalls >= maxToolCallsPerSession`)

3. **Event emission**
   - Publish `SESSION_STARTED_V1` when session begins
   - Publish `SESSION_FIRST_MESSAGE_V1` when participant's first message arrives
   - Publish `SESSION_ENDED_V1` when session expires

4. **Query API (via MCP)**
   - `session.get({ sessionId })` → Session
   - `session.list({ scope, status })` → Session[]
   - `session.increment({ sessionId, counter, amount })`
   - `session.checkQuota({ sessionId, counter, limit })` → boolean

#### Data Model

**Storage:** New Firestore collection `sessions` or Postgres table `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_dimensions JSONB NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  last_heartbeat TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  ttl_sec INTEGER NOT NULL,
  counters JSONB DEFAULT '{}',
  participants JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_scope ON sessions((scope_dimensions->>'platform'), (scope_dimensions->>'channel'));
CREATE INDEX idx_sessions_heartbeat ON sessions(last_heartbeat) WHERE status = 'active';
```

#### Message Bus Integration

**Topics consumed:**
- `internal.ingress.v1` – Detect session start (stream online, first API message)
- `internal.enriched.v1` – Track participant activity (turns, messages)
- `internal.reflex.executed.v1` – Track tool invocations

**Topics published:**
- `internal.session.started.v1`
- `internal.session.heartbeat.v1` (optional, for observability)
- `internal.session.ended.v1`
- `internal.session.first_message.v1`

#### Pros

- **First-class sessions** – Dedicated schema, query API, lifecycle events
- **Centralized enforcement** – Quota checks happen in one place
- **Event-driven** – Other bits can subscribe to session lifecycle events
- **Queryable registry** – Can list all active sessions, filter by scope
- **Strong typing** – Session domain types are explicit, not buried in generic state

#### Cons

- **New service overhead** – Adds another platform bit to maintain
- **Storage duplication** – Session data might overlap with State Engine or Disposition
- **Coordination cost** – Bits must publish session-relevant events (turns, tool calls) to session-service
- **Migration effort** – Existing session-like patterns (disposition windows, LLM memory) may need refactoring

#### Example: "First Message of Stream"

```typescript
// In session-service, subscribe to internal.ingress.v1
async function handleIngressEvent(event: InternalEventV2) {
  const sessionId = deriveSessionId(event); // e.g., from stream online event
  const userId = event.identity.external.id;

  const session = await sessionStore.get(sessionId);
  if (!session) {
    // Create new session
    await sessionStore.create({
      id: sessionId,
      scope: { type: 'stream', dimensions: { platform: 'twitch', channel: event.ingress.channel } },
      status: 'active',
      startedAt: event.ingress.ingressAt,
      lastHeartbeat: event.ingress.ingressAt,
      ttl: 7200, // 2 hours
      counters: {},
      participants: {},
    });
    await publish(SESSION_STARTED_V1, { sessionId, scope: session.scope });
  }

  const participant = session.participants[userId];
  if (!participant) {
    // First message from this user
    await sessionStore.update(sessionId, {
      participants: {
        ...session.participants,
        [userId]: { userId, joinedAt: event.ingress.ingressAt, messageCount: 1 },
      },
    });
    await publish(SESSION_FIRST_MESSAGE_V1, { sessionId, userId, correlationId: event.correlationId });
  } else {
    // Increment message count
    await sessionStore.update(sessionId, {
      participants: {
        ...session.participants,
        [userId]: { ...participant, messageCount: participant.messageCount + 1 },
      },
    });
  }
}
```

---

### 3.3 Approach C: Session Contexts as Envelope Extensions (Metadata Pattern)

**Concept:** Encode session information directly in the **Envelope v1** (or upgrade to Envelope v2 with explicit `contexts` field).

#### Design

```typescript
// Extend InternalEventV2 with session contexts
export interface SessionContext {
  id: string;                    // Session ID
  scope: SessionScope;
  role: 'primary' | 'secondary'; // Event may participate in multiple sessions
  joinedAt: string;              // When this event stream entered the session
  position?: number;             // Turn number or sequence within session
  metadata?: Record<string, any>;
}

export interface InternalEventV2 {
  // ... existing fields
  contexts?: SessionContext[];   // NEW: Sessions this event participates in
}
```

#### How It Works

1. **Session attachment (ingress)** – When ingress-egress creates an envelope, it queries State Engine or Session Service to determine active session(s) and attaches `contexts`
2. **Session propagation** – All downstream bits see session contexts in the envelope
3. **Session-scoped rules** – Event-router can route based on `contexts[0].position` (e.g., "if first turn, route to onboarding flow")
4. **Session counters** – Bits increment session counters by publishing `MutationProposal` to session state keys
5. **Session derivation** – Bits emit session events by inspecting `contexts` (e.g., "if position === 1, emit first-message event")

#### Pros

- **Zero latency queries** – Session info travels with the event; no need to query external store
- **Routing-friendly** – Event-router can make session-aware decisions without external calls
- **Backward compatible** – `contexts` is optional; existing events unchanged
- **Multi-session support** – Event can belong to multiple sessions (e.g., user session + stream session)

#### Cons

- **Ingress complexity** – Every ingress point must correctly attach session contexts
- **Stale data risk** – Session counters in envelope may be outdated (eventual consistency)
- **Envelope bloat** – Large session metadata increases message size
- **No centralized session queries** – Cannot easily "list all active sessions" without external registry

#### Example: "First Message of Stream"

```typescript
// In ingress-egress, when building envelope:
const sessionId = await sessionRegistry.getCurrentStreamSession(channelId);
const session = await sessionRegistry.get(sessionId);
const userParticipant = session.participants[userId];

const contexts: SessionContext[] = [
  {
    id: sessionId,
    scope: { type: 'stream', dimensions: { platform: 'twitch', channel: channelId } },
    role: 'primary',
    joinedAt: userParticipant?.joinedAt || nowIso,
    position: (userParticipant?.messageCount || 0) + 1,
  },
];

const envelope: InternalEventV2 = {
  // ... standard fields
  contexts, // Attached here
};

// In event-router or llm-bot:
if (event.contexts?.[0]?.position === 1) {
  // This is the user's first message in this session
  await publish({
    type: 'system.user.first_session_message',
    sessionId: event.contexts[0].id,
    userId: event.identity.external.id,
    correlationId: event.correlationId,
  });
}
```

---

## 4. Comparison Matrix

| Dimension | Approach A: State Keys | Approach B: Session Service | Approach C: Envelope Contexts |
|-----------|------------------------|-----------------------------|-----------------------------|
| **Implementation Effort** | Low (reuse State Engine) | High (new service + schema) | Medium (extend envelope + ingress) |
| **Session Query Latency** | Medium (external lookup) | Medium (external lookup) | Zero (in envelope) |
| **Session Registry** | Manual (state key scan) | Native (queryable table) | Manual (external store) |
| **Event Derivation** | Manual (bit logic) | Automatic (service emits) | Manual (bit logic) |
| **Quota Enforcement** | Distributed (each bit checks) | Centralized (service checks) | Distributed (each bit checks) |
| **Multi-session Support** | Complex (multiple keys) | Native (query by scope) | Native (contexts array) |
| **Storage Overhead** | Existing (state table) | New (sessions table) | Hybrid (envelope + state) |
| **Backward Compatibility** | Full (no envelope changes) | Full (new topics, opt-in) | Requires envelope migration |
| **Cross-bit Visibility** | High (via State Engine MCP) | High (via Session Service MCP) | Highest (in every event) |
| **Observability** | Manual (state mutation log) | Native (session lifecycle events) | Hybrid (events + envelope) |

---

## 5. Recommended Approach: Hybrid (B + C)

**Recommendation:** Implement **Approach B (Session Service)** for authoritative session management, with **Approach C (Envelope Contexts)** as an optional optimization for high-throughput paths.

### 5.1 Rationale

1. **Approach B provides strong foundations**
   - First-class session schema, lifecycle events, query API
   - Centralized quota enforcement
   - Auditable session history

2. **Approach C optimizes hot paths**
   - Attach session contexts in ingress for zero-latency routing decisions
   - Reduce external lookups in event-router and LLM-bot
   - Support multi-session scenarios (user + stream + task)

3. **Approach A remains valid for simple cases**
   - Ad-hoc session-like state (e.g., "last API call timestamp") can still use State Engine directly
   - No need to force everything through Session Service

### 5.2 Hybrid Design

#### Phase 1: Session Service (Core)

1. **New platform bit:** `session-service` (profile: `core`)
2. **Storage:** Postgres table `sessions` (or Firestore collection `sessions`)
3. **Topics:**
   - Consumes: `internal.ingress.v1`, `internal.enriched.v1`, `internal.reflex.executed.v1`
   - Publishes: `internal.session.started.v1`, `internal.session.ended.v1`, `internal.session.first_message.v1`
4. **MCP tools:** `session.get`, `session.list`, `session.increment`, `session.checkQuota`
5. **Lifecycle:**
   - Auto-create sessions on stream online / API first message
   - Auto-end sessions on stream offline + TTL
   - Heartbeat tracking for TTL refresh

#### Phase 2: Envelope Contexts (Optimization)

1. **Extend `InternalEventV2`:**
   ```typescript
   contexts?: SessionContext[]; // Optional, added by ingress
   ```
2. **Ingress enrichment:**
   - `ingress-egress` queries session-service to attach active session(s)
   - `api-gateway` attaches WebSocket session context
3. **Router optimization:**
   - Event-router reads `contexts[0].position` for first-turn routing
   - No external session lookup needed for common cases
4. **Fallback:**
   - If `contexts` missing, bits query session-service MCP tool

#### Phase 3: Event Derivation (Automation)

1. **Session-service emits canonical events:**
   - `SESSION_STARTED_V1` → Can trigger onboarding flows
   - `SESSION_FIRST_MESSAGE_V1` → Can trigger welcome messages
   - `SESSION_ENDED_V1` → Can trigger summary/analytics
2. **Event-router routing slip integration:**
   - Add routing steps triggered by session lifecycle events
   - Example: "When `SESSION_FIRST_MESSAGE_V1`, add `onboarding` step to slip"

---

## 6. Implementation Phases

### Phase 1: Core Session Service (Sprint N)

**Deliverables:**
- [ ] New service `session-service` scaffolding
- [ ] Postgres schema migration for `sessions` table
- [ ] Session lifecycle handlers (create, update, end)
- [ ] MCP tools: `session.get`, `session.list`
- [ ] Tests: Session creation, heartbeat, expiration

**Effort:** ~3-5 days

### Phase 2: Session Event Emission (Sprint N+1)

**Deliverables:**
- [ ] Publish `SESSION_STARTED_V1` on stream online / API connect
- [ ] Publish `SESSION_FIRST_MESSAGE_V1` on participant first message
- [ ] Publish `SESSION_ENDED_V1` on TTL expiration / explicit end
- [ ] Event-router routing rules for session events
- [ ] Tests: Session event emission, routing slip integration

**Effort:** ~2-3 days

### Phase 3: Envelope Context Enrichment (Sprint N+2)

**Deliverables:**
- [ ] Extend `InternalEventV2` with `contexts?: SessionContext[]`
- [ ] Update `ingress-egress` to attach stream session contexts
- [ ] Update `api-gateway` to attach WebSocket session contexts
- [ ] Event-router optimization (read contexts before external lookup)
- [ ] Tests: Context propagation, multi-session scenarios

**Effort:** ~3-4 days

### Phase 4: Quota Enforcement (Sprint N+3)

**Deliverables:**
- [ ] Session counters: `turns`, `toolCalls`, `imageGenerations`
- [ ] MCP tool: `session.checkQuota({ sessionId, counter, limit })`
- [ ] Reflex/LLM-bot integration: Check quota before expensive operations
- [ ] Event-router rule: Reject events if quota exceeded
- [ ] Tests: Quota enforcement, overflow handling

**Effort:** ~2-3 days

---

## 7. Session Scope Examples

### Example 1: Twitch Stream Session

```typescript
{
  id: "session:stream:twitch:channel_123:20260816_1430",
  scope: {
    type: "stream",
    dimensions: {
      platform: "twitch",
      channel: "channel_123",
      startedAt: "2026-08-16T14:30:00Z"
    }
  },
  status: "active",
  ttl: 7200, // 2 hours after stream ends
  counters: {
    turns: 42,
    toolCalls: 7,
    imageGenerations: 3
  },
  participants: {
    "user_alice": { joinedAt: "...", messageCount: 15 },
    "user_bob": { joinedAt: "...", messageCount: 27 }
  }
}
```

### Example 2: API WebSocket Session

```typescript
{
  id: "session:api:websocket:conn_xyz789",
  scope: {
    type: "api",
    dimensions: {
      protocol: "websocket",
      connectionId: "conn_xyz789",
      userId: "user_charlie"
    }
  },
  status: "active",
  ttl: 3600, // 1 hour idle timeout
  counters: {
    turns: 8,
    toolCalls: 2
  }
}
```

### Example 3: Scheduled Task Session

```typescript
{
  id: "session:task:daily_summary:20260816",
  scope: {
    type: "task",
    dimensions: {
      taskType: "daily_summary",
      scheduledFor: "2026-08-16T00:00:00Z"
    }
  },
  status: "active",
  ttl: 86400, // 24 hours
  counters: {
    eventsProcessed: 1547,
    summariesGenerated: 12
  }
}
```

---

## 8. Integration with Existing Systems

### 8.1 State Engine

- **Relationship:** Session Service **complements** State Engine (not replaces)
- **Use State Engine for:** Long-lived, user-scoped state (points, preferences)
- **Use Session Service for:** Bounded, time-limited interaction contexts
- **Bridge:** Sessions can publish `MutationProposal` to update long-term state (e.g., increment total points)

### 8.2 Disposition Service

- **Relationship:** Disposition windows (~15 min) are **shorter** than typical sessions (hours)
- **Use Disposition for:** Real-time behavioral scoring (tone, risk)
- **Use Sessions for:** Interaction boundaries and quotas
- **Bridge:** Disposition observations can reference `sessionId` for cross-correlation

### 8.3 Event Router

- **Relationship:** Router consumes session lifecycle events
- **Routing rules:** Can match on `event.contexts[0].position` or `event.type === 'internal.session.started.v1'`
- **Example:** "If first message in stream session, add `welcome-message` routing step"

### 8.4 LLM Bot

- **Relationship:** LLM memory (~8 messages) is **narrower** than session scope
- **Use LLM memory for:** Immediate conversational context
- **Use Sessions for:** Cross-turn quotas (e.g., "max 5 tool calls per stream")
- **Bridge:** LLM bot reads `event.contexts[0].id` to scope memory keys

### 8.5 Reflex Service

- **Relationship:** Reflexes can be session-scoped (e.g., "welcome message on first turn")
- **Use Sessions for:** Trigger conditions (if `SESSION_FIRST_MESSAGE_V1`, execute reflex)
- **Bridge:** Reflex cache keys include `sessionId` for session-specific state

---

## 9. Open Questions & Decisions Needed

| Question | Options | Recommendation |
|----------|---------|----------------|
| **Session ID format** | UUID, composite key (platform:channel:timestamp), hash | **Composite key** – human-readable, deterministic |
| **Session auto-creation** | On stream online, on first message, explicit API call | **On stream online + first message** – hybrid approach |
| **Session heartbeat frequency** | Every message, every 5 minutes, on significant events | **Every message** – simple, accurate |
| **Session TTL default** | 1 hour, 2 hours, configurable per scope | **2 hours** – reasonable for stream sessions |
| **Quota overflow behavior** | Reject event, queue for next session, warn user | **Reject + warn user** – clear boundary |
| **Multi-session priority** | First context is primary, explicit role field | **Explicit `role: 'primary' | 'secondary'`** |
| **Session end trigger** | Stream offline, manual API call, TTL expiration | **All three** – layered safety |
| **Postgres vs Firestore** | Align with persistence backend choice | **Postgres** – matches Sprint 344 migration |

---

## 10. Success Metrics

### 10.1 Functional Metrics

- [ ] Can detect "user's first message in stream session" with <100ms latency
- [ ] Can enforce "max N tool calls per session" with 100% accuracy
- [ ] Can list all active sessions for a given platform/channel
- [ ] Can emit session lifecycle events on all major boundaries

### 10.2 Performance Metrics

- [ ] Session lookup latency: p50 < 10ms, p99 < 50ms
- [ ] Session creation throughput: >1000 sessions/sec
- [ ] Envelope size increase: <500 bytes per event (with contexts)
- [ ] Event-router latency impact: <5ms additional (with context optimization)

### 10.3 Operational Metrics

- [ ] Session TTL cleanup: 100% of expired sessions removed within 1 minute
- [ ] Session heartbeat reliability: >99.9% of active sessions have fresh heartbeat
- [ ] Session event emission reliability: >99.99% (same as other platform events)

---

## 11. Migration Path

### 11.1 Backward Compatibility

- **Envelope v2 with contexts is optional** – Bits can ignore `contexts` field
- **Session Service MCP tools are additive** – Existing bits unchanged
- **Session lifecycle events are new topics** – No impact on existing subscriptions

### 11.2 Deprecation Timeline

No deprecations required. This is a net-new capability.

### 11.3 Rollout Strategy

1. **Phase 1 (Sprint N):** Deploy session-service to staging, test with Twitch stream sessions only
2. **Phase 2 (Sprint N+1):** Enable session lifecycle events, monitor event volume
3. **Phase 3 (Sprint N+2):** Attach contexts to ingress envelopes, validate routing optimizations
4. **Phase 4 (Sprint N+3):** Enable quota enforcement in reflex/llm-bot, measure rejection rates
5. **Production:** Gradual rollout with feature flags (`SESSION_SERVICE_ENABLED`)

---

## 12. References

### 12.1 Existing Architecture

- `architecture.yaml` – Platform infrastructure, services, topics
- `documentation/schemas/envelope.v1.json` – Current envelope schema
- `documentation/schemas/routing-slip.v1.json` – Routing slip schema
- `src/types/state.ts` – State Engine mutation/snapshot types
- `src/types/disposition.ts` – Disposition service types
- `src/types/events.ts` – Internal event types (InternalEventV2)

### 12.2 Related Systems

- **State Engine** (`src/apps/state-engine.ts`) – Generic state mutation service
- **Disposition Service** (`src/apps/disposition-service.ts`) – User behavioral scoring
- **Event Router** (`src/apps/event-router-service.ts`) – Routing slip orchestration
- **LLM Bot** (`src/apps/llm-bot-service.ts`) – Conversational memory

### 12.3 External Patterns

- **CQRS Session Management** – Command/Query separation for session state
- **Event Sourcing** – Session lifecycle as event stream
- **Context Propagation** – Distributed tracing patterns (OpenTelemetry context)

---

## 13. Appendix: Session Service API Sketch

### 13.1 MCP Tools

```typescript
// Get session by ID
session.get({
  sessionId: string
}) → Session | null

// List sessions by scope/status
session.list({
  scope?: Partial<SessionScope>,
  status?: 'active' | 'ended',
  limit?: number
}) → Session[]

// Increment session counter
session.increment({
  sessionId: string,
  counter: string,
  amount?: number // default 1
}) → { success: boolean, newValue: number }

// Check quota (does not mutate)
session.checkQuota({
  sessionId: string,
  counter: string,
  limit: number
}) → { allowed: boolean, current: number, limit: number }

// Create session (usually automatic, but available for manual creation)
session.create({
  scope: SessionScope,
  ttl?: number,
  metadata?: Record<string, any>
}) → Session

// End session (before TTL expiration)
session.end({
  sessionId: string,
  reason?: string
}) → { success: boolean }
```

### 13.2 Event Schemas

```typescript
// internal.session.started.v1
{
  v: '1',
  sessionId: string,
  scope: SessionScope,
  startedAt: string, // ISO8601
  correlationId: string
}

// internal.session.ended.v1
{
  v: '1',
  sessionId: string,
  scope: SessionScope,
  startedAt: string,
  endedAt: string,
  duration: number, // milliseconds
  counters: Record<string, number>,
  participantCount: number,
  correlationId: string
}

// internal.session.first_message.v1
{
  v: '1',
  sessionId: string,
  userId: string,
  timestamp: string, // ISO8601
  correlationId: string
}

// internal.session.quota_exceeded.v1
{
  v: '1',
  sessionId: string,
  userId: string,
  counter: string,
  limit: number,
  current: number,
  correlationId: string
}
```

---

## 14. Conclusion

The **Session Context System** addresses a critical gap in BitBrat's event orchestration model: **bounded, time-limited interaction scopes** that enable session-aware event derivation, quota enforcement, and routing decisions.

**Recommended approach:** Hybrid model (Session Service + Envelope Contexts)
- **Short-term (Sprint N):** Implement core Session Service with lifecycle events
- **Medium-term (Sprint N+1-2):** Add envelope context enrichment for routing optimization
- **Long-term (Sprint N+3+):** Extend quotas, analytics, multi-session scenarios

This design:
- ✅ Provides first-class session primitives
- ✅ Maintains backward compatibility
- ✅ Integrates cleanly with State Engine, Disposition, Event Router
- ✅ Supports Twitch streams, API sessions, scheduled tasks, and future platforms
- ✅ Enables "first message", "turn counter", and "quota per session" use cases

**Next steps:**
1. Validate approach with product/engineering stakeholders
2. Refine session scope taxonomy (stream, conversation, task, ...)
3. Create implementation plan for Phase 1 (Session Service core)
4. Define quota policies (e.g., "max 5 image generations per stream session")

---

**Document Status:** DRAFT – Ready for architectural review
**Reviewers:** Platform Team, LLM Bot Team, Product
**Approval Gate:** Phase 1 implementation plan requires explicit approval before sprint start
