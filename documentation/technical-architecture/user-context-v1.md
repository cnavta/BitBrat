# Technical Architecture — User Context for LLM Bot (v1)

## 1. Objective
Provide the LLM Bot with richer per-user context at inference time:
- Username
- Role-derived prompt descriptors (configured in Firestore at /configs/bot/roles)
- Optional free-text user description stored in /users/{userId}

This context is composed into prompt annotations for the LLM Bot with caching, safety, and observability.

## 2. Firestore Data Model

### 2.1 Roles Configuration
Path: /configs/bot/roles — Collection under a configuration document
- Collection: configs
- Document: bot
- Subcollection: roles

Example paths:
- /configs/bot — config container document
- /configs/bot/roles/{roleId} — one doc per role (e.g., "vip", "moderator", "broadcaster")

Role document schema (v1):
```json
{
  "roleId": "vip",
  "displayName": "VIP",
  "enabled": true,
  "priority": 50,
  "prompt": "They are a VIP.",
  "aliases": ["founder"],
  "metadata": { "tone": "friendly" },
  "updatedAt": "2025-01-01T00:00:00Z",
  "updatedBy": "system"
}
```
Indexing: Query by enabled == true; no composite index required. Reads are bounded (small static set).

Operational notes:
- The roles set is global and small; changes are rare. Cache aggressively with TTL.
- Use document IDs as canonical role keys (e.g., "vip", "moderator", "broadcaster").

### 2.2 User Profile Extension
Path: /users/{userId}

Schema (additions shown):
```json
{
  "profile": {
    "username": "theViewer",
    "description": "Loves JRPGs.",
    "updatedAt": "2025-01-01T00:00:00Z"
  },
  "roles": ["vip", "subscriber"],
  "rolesMeta": {
    "twitch": ["VIP", "Subscriber"],
    "kick": []
  }
}
```

Sourcing:
- roles[] should be derived from platform entitlements (e.g., Twitch VIP/Mod/Broadcaster) and/or manual assignments by admins.
- profile.username should reflect the user’s current preferred display name (platform-derived or overridden).

## 3. LLM Bot Integration & Data Flow

### 3.1 Event Flow
- auth service publishes internal.user.enriched.v1 with userId, platform metadata, and basic profile info when available.
- event-router determines routing and emits internal.llmbot.v1 events with annotations including prompt intents.
- llm-bot consumes internal.llmbot.v1, composes user context, and injects it into prompt annotations prior to model call.

### 3.2 Composition Strategy
- Resolve the user record (/users/{userId}) if userId is present; otherwise, best-effort from event payload username.
- Load global roles from /configs/bot/roles, filter to enabled and intersect with user.roles.
- Compose a compact descriptor string using priority ordering:
  - username: e.g., "Username: theViewer"
  - roles: e.g., "Roles: VIP, Subscriber"
  - role prompts: concatenate configured prompt text, ordered by priority (lowest first)
  - optional description: appended if present and size budget allows

Injection modes (configurable):
- append (default): append to the end of the user prompt as a context block
- prefix: preface the prompt with a persona/context preamble
- annotation: create or update a dedicated annotation with kind = "personality" or "prompt"

Resulting annotation example:
```json
{
  "id": "ctx-<correlationId>",
  "kind": "personality",
  "source": "llm-bot.user-context",
  "createdAt": "<ISO8601>",
  "label": "user-context-v1",
  "payload": {
    "username": "theViewer",
    "roles": ["vip", "subscriber"],
    "rolePrompts": ["They are a VIP."],
    "description": "Loves JRPGs.",
    "mode": "append" 
  },
  "value": "Username: theViewer\nRoles: VIP, Subscriber\nThey are a VIP.\nDescription: Loves JRPGs."
}
```

### 3.3 Limits & Budgets
- LLM_BOT_MEMORY_MAX_CHARS limits final prompt size (defined in service config).
- PERSONALITY_MAX_CHARS further constrains the user context block (default 4000).
- Truncation policy: description truncated first, then role prompts by lowest priority, then role list, preserving username.

## 4. Caching & Invalidation

### 4.1 Caches
- Roles cache: in-memory per process; TTL default 300 seconds (PERSONALITY_CACHE_TTL_MS or USER_CONTEXT_CACHE_TTL_MS).
- User cache: optional in-memory cache keyed by userId with TTL 60–300 seconds (to minimize Firestore reads under burst).

### 4.2 Invalidation
- Time-based TTL expiry.
- Manual bust: set configs.bot.cacheVersion in /configs/bot; service watches this on roles fetch and resets cache when incremented.
- Safe fallback: if roles unavailable, proceed with username and any available user.description; mark annotation with degraded:true in payload.

## 5. Security, Permissions, and Privacy

- Access: Services use server-side Firebase Admin SDK with IAM; Firestore rules restrict client access (rules not relied upon by Admin SDK but should remain least-privilege for any client paths).
- Data minimization: description is optional; obtain user/admin consent in UI flows. Do not log description content; log only presence and lengths.
- Redaction: when logging composed context, redact description contents and truncate long fields (e.g., 160 chars preview max).
- PII handling: username considered public display; description may contain PII—treat as sensitive.
- Configurable opt-out: allow USER_CONTEXT_DESCRIPTION_ENABLED=false to skip injecting descriptions.

## 6. Migration & Backfill

- Seed roles: create baseline docs under /configs/bot/roles with enabled prompts for broadcaster, moderator, vip, subscriber.
- Map platform roles: extend auth/enrichment to populate users/{id}.roles based on platform entitlements.
- Backfill usernames: ensure users/{id}.profile.username is set from platform display name.
- Optional description: provide admin UI or script to set profile.description.
- Verification: sampling query to ensure roles[] contains only configured role IDs; report unknowns.

## 7. Observability

- Logs (structured):
  - llm_bot.user_ctx.compose.start/end with correlationId, userId, rolesCount, hasDescription, bytesBefore/After, degraded flag
  - llm_bot.user_ctx.cache.{hit,miss,refresh}
- Metrics (counters/gauges):
  - user_context_composed_total
  - user_context_degraded_total
  - roles_cache_hits_total / misses_total
  - user_fetch_latency_ms (histogram)
- Traces: span around compose phase (process-llm-request child span), tagging cache outcomes and sizes.

## 8. Configuration Flags (llm-bot)

- USER_CONTEXT_ENABLED=true
- USER_CONTEXT_INJECTION_MODE=append|prefix|annotation (default: append)
- USER_CONTEXT_CACHE_TTL_MS=300000
- USER_CONTEXT_ROLES_PATH=/configs/bot/roles
- USER_CONTEXT_DESCRIPTION_ENABLED=true
- PERSONALITY_LOG_PREVIEW_CHARS=160 (existing)

## 9. Acceptance Criteria Mapping
- Firestore schema for /configs/bot/roles with role-to-prompt mapping and enable/disable flags — Section 2.1
- User document extensions in /users/{userId} for username, roles, and optional description — Section 2.2
- Data flow and integration for llm-bot to enrich prompts with user context — Section 3
- Caching and invalidation strategy — Section 4
- Security, permissions, and privacy — Section 5
- Migration/backfill and operational playbook — Section 6
- Observability: logs and metrics — Section 7

## 10. Future Work (Phase 2+)
- Multi-platform role normalization library
- Per-channel overrides (e.g., different prompts by channel)
- Feature-flag controlled A/B tests for injection mode and content
- Persist composed context snapshot in event document annotations for audit
