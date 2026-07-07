# Reflex MCP Tools Reference

> **Status:** Implemented (sprint-332). This is the reference for the domain tools exposed by the Reflex bit
> (`reflex.*`). For the Reflex concept and deterministic execution model, see
> [Platform Flow Overview](../concepts/platform-flow.md).

The **Reflex bit** is a Platform Bit that provides deterministic, pattern-match event execution with <150ms
latency. It exposes domain tools via MCP (`mcp.exposure: platform+domain`) that allow administrators and LLM
agents to create, manage, and test reflexes programmatically.

## Overview

Reflexes are stored event handlers that:
- Match incoming events via pattern matching (exact, contains, prefix, suffix, regex)
- Optionally execute MCP tools with parameter interpolation
- Optionally generate candidate responses for egress
- Execute in <150ms with no LLM overhead

All reflex tools are exposed in the `reflex.*` namespace and are callable via the `tool-gateway` or directly
via Brat CLI.

## Tools

### `reflex.create`

Create a new reflex with pattern matching and optional MCP tool invocation.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable name for the reflex |
| `description` | string | No | Description of what this reflex does |
| `active` | boolean | No | Whether the reflex is active (default: true) |
| `priority` | number | No | Priority for execution (0-1000, lower = higher priority, default: 100) |
| `match` | object | Yes | Pattern matching configuration (see below) |
| `conditions` | object | No | Optional execution conditions (see below) |
| `action` | object | No | Optional MCP tool invocation (see below) |
| `candidateTemplate` | string \| string[] | No | Template(s) for generating response(s). Supports interpolation. |
| `tags` | string[] | No | Tags for organization and filtering |

**`match` object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | Yes | Pattern match type: `exact`, `contains`, `prefix`, `suffix`, `regex` |
| `pattern` | string | Yes | Pattern to match |
| `field` | string | Yes | Event field path to match against (e.g., `message.text`, `identity.user.displayName`) |
| `flags` | string | No | Regex flags (only for regex type, e.g., `i` for case-insensitive) |
| `caseSensitive` | boolean | No | Case-sensitive matching (for non-regex types) |

**`conditions` object:**

| Field | Type | Description |
|-------|------|-------------|
| `eventTypes` | string[] | Allowed event types (e.g., `["chat.message.v1", "chat.command.v1"]`). **Use internal types, NOT platform-specific** (e.g., NOT `twitch.chat.message`). |
| `channels` | string[] | Allowed channel IDs |
| `platforms` | string[] | Allowed platform IDs (e.g., `["twitch", "discord"]`) |
| `userRoles` | string[] | Required user roles |
| `minAuthLevel` | number | Minimum auth level (0=anonymous, 1=external, 2=matched user, 3=user with roles) |

**`action` object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool` | string | Yes | Sanitized MCP tool name as shown in tools list (e.g., `mcp_obs-set-scene-item-enabled`). **IMPORTANT:** Hyphens are preserved; only colons and dots become underscores. |
| `parameters` | object | Yes | Tool parameters template (supports `{{field.path}}` interpolation) |
| `timeout` | number | No | Tool execution timeout in milliseconds (1000-60000, default: 5000) |

**Returns:** Success message with reflex ID, name, priority, and active status.

**Example:**

```json
{
  "name": "Hide Chat Overlay",
  "description": "Hide chat overlay when user says !hide",
  "active": true,
  "priority": 50,
  "match": {
    "type": "contains",
    "pattern": "!hide",
    "field": "message.text",
    "caseSensitive": false
  },
  "conditions": {
    "eventTypes": ["chat.message.v1"],
    "platforms": ["twitch"]
  },
  "action": {
    "tool": "mcp_obs-set-scene-item-enabled",
    "parameters": {
      "sceneName": "Stream",
      "sceneItemId": 42,
      "sceneItemEnabled": false
    },
    "timeout": 5000
  },
  "candidateTemplate": "Chat overlay hidden, @{{identity.user.displayName}}!",
  "tags": ["obs", "chat-commands"]
}
```

---

### `reflex.list`

List all reflexes with optional filtering.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `active` | boolean | No | Filter by active status (omit for all) |
| `limit` | number | No | Maximum number of results (1-100, default: 50) |

**Returns:** List of reflexes with ID, name, active status, priority, match configuration, tool name, and
execution stats (success count, error count).

**Example:**

```json
{
  "active": true,
  "limit": 10
}
```

---

### `reflex.update`

Update an existing reflex.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Reflex ID to update |
| `name` | string | No | New name |
| `description` | string | No | New description |
| `active` | boolean | No | New active status |
| `priority` | number | No | New priority (0-1000) |
| `match` | object | No | Updated pattern matching configuration (same structure as create) |
| `conditions` | object | No | Updated conditions (same structure as create) |
| `action` | object | No | Updated action configuration (same structure as create) |
| `candidateTemplate` | string \| string[] | No | Updated candidate template(s) |
| `tags` | string[] | No | Updated tags |

**Returns:** Success message with updated reflex ID, name, priority, and active status.

**Example:**

```json
{
  "id": "abc123",
  "active": false,
  "priority": 200
}
```

---

### `reflex.delete`

Delete a reflex (soft delete by setting `active=false`).

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Reflex ID to delete |

**Returns:** Success message with deleted reflex ID, name, and new active status (false).

**Example:**

```json
{
  "id": "abc123"
}
```

---

### `reflex.test`

Test a reflex against a mock event to verify pattern matching and execution logic.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Reflex ID to test |
| `mockEvent` | object | Yes | Mock event object for testing (must include fields referenced by reflex) |

**Returns:** Success or failure message indicating whether the pattern matched. Does NOT execute the actual
tool (test mode only validates pattern matching).

**Example:**

```json
{
  "id": "abc123",
  "mockEvent": {
    "message": {
      "text": "!hide chat please"
    },
    "identity": {
      "user": {
        "id": "user123",
        "displayName": "TestUser"
      }
    }
  }
}
```

---

### `reflex.stats`

Get statistics for a reflex or overall cache stats.

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | No | Reflex ID (omit for overall cache stats) |

**Returns:**
- If ID provided: Reflex-specific stats (ID, name, active status, success count, error count, last executed
  timestamp)
- If ID omitted: Overall cache stats (size, hits, misses, updates, last sync, total successes, total errors)

**Example (specific reflex):**

```json
{
  "id": "abc123"
}
```

**Example (overall stats):**

```json
{}
```

---

## Usage Notes

### Tool Naming Convention

**CRITICAL:** Tool names in `action.tool` must match EXACTLY as shown in your available tools list. The
naming convention is:

- MCP server tools are prefixed with `mcp_`
- **Hyphens are preserved** from the original tool name
- Only colons (`:`) and dots (`.`) are replaced with underscores (`_`)

**Examples:**
- MCP tool `obs-set-scene-item-enabled` → `mcp_obs-set-scene-item-enabled` (hyphens preserved)
- MCP tool `image:generate` → `mcp_image_generate` (colon becomes underscore)
- MCP tool `state.get` → `mcp_state_get` (dot becomes underscore)

**Common mistakes:**
- ❌ `mcp_mcp_obs-set-scene-item-enabled` (double prefix)
- ❌ `obs-set-scene-item-enabled` (missing prefix)
- ❌ `mcp_obs_set_scene_item_enabled` (incorrectly replaced hyphens)

### Event Type Convention

When specifying `conditions.eventTypes`, use **internal event types** (normalized), NOT platform-specific
types:

**Correct:**
- `chat.message.v1`
- `chat.command.v1`
- `moderation.action.v1`
- `subscription.v1`

**Incorrect (will throw error):**
- `twitch.chat.message`
- `discord.message.create`
- `platform.chat.message`

The platform is already normalized by the time the event reaches Reflex.

### Parameter Interpolation

Both `action.parameters` and `candidateTemplate` support template interpolation:

**Event field interpolation:**
- `{{message.text}}` → value of `event.message.text`
- `{{identity.user.displayName}}` → value of `event.identity.user.displayName`
- `{{ingress.channel}}` → value of `event.ingress.channel`

**Result interpolation (candidateTemplate only):**
- `{{result.value}}` → value returned by tool execution
- `{{result.status}}` → execution status

**Example:**

```json
{
  "action": {
    "tool": "mcp_obs-set-source-text",
    "parameters": {
      "sourceName": "ChatDisplay",
      "text": "{{identity.user.displayName}}: {{message.text}}"
    }
  },
  "candidateTemplate": "Updated OBS source with message from @{{identity.user.displayName}}"
}
```

### Cache and Real-Time Sync

The Reflex bit maintains an in-memory cache of all active reflexes for <150ms pattern matching. The cache:
- Warms on startup by loading all active reflexes from Firestore
- Syncs in real-time via Firestore snapshot listeners
- Updates automatically when reflexes are created/updated/deleted
- Reports cache stats via `reflex.stats` (hits, misses, size, last sync)

You do NOT need to restart the service after creating/updating reflexes — changes are live immediately.

### Priority and Execution Order

Reflexes are matched in priority order (lower priority number = higher precedence). Currently, only the
**first matching reflex** is executed (Phase 1 behavior). Future phases may support multiple matches.

Default priority is `100`. Assign lower priorities (e.g., `10`, `50`) for high-precedence reflexes, and
higher priorities (e.g., `200`, `500`) for fallback behaviors.

---

## Related Reading

- [Platform Flow Overview](../concepts/platform-flow.md) — Dual execution paths and agent loop
- [Event Router & Rules](../concepts/event-router-rules.md) — How routing slips direct events to Reflex
- [Bit Control-Plane Reference](./bit-control-plane.md) — Universal `bit.*` tools (apply to Reflex too)
- [Choosing Platform vs Domain](../guides/choosing-platform-vs-domain.md) — Why Reflex is a Platform Bit
