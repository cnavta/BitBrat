# Tutorial: Creating a Reflex

In this tutorial, you will learn how to create a **reflex** — a deterministic, pattern-matched event handler that executes in <150ms with no LLM overhead. Reflexes are perfect for repeated, predictable commands that need fast responses.

## What You'll Build

We'll create a `!lurk` command reflex that:
- Matches when users type "!lurk" in chat
- Responds in <150ms with a personalized message
- Uses pattern matching instead of LLM reasoning

## Prerequisites

- Platform is running locally (see [Quickstart](../getting-started/quickstart.md))
- Basic understanding of [Platform Flow Overview](../concepts/platform-flow.md)
- Familiarity with the [Reflex MCP Tools Reference](../reference/reflex-mcp-tools.md) (optional but helpful)

## Understanding Reflexes vs Event Router Rules

Before we begin, let's understand when to use reflexes:

| Feature | Event Router Rules | Reflexes |
|---------|-------------------|----------|
| **Latency** | 2-10 seconds | <150ms |
| **Reasoning** | LLM-based, creative | Deterministic, pattern-match |
| **Use cases** | Novel situations, complex logic | Repeated commands, fast responses |
| **Cost** | Higher (LLM inference) | Lower (no LLM) |
| **Flexibility** | Multi-step routing, analysis | Direct execution |

**Use reflexes when:**
- Command patterns are predictable (e.g., `!lurk`, `!hide`, `!volume 50`)
- Speed matters (<150ms response time)
- You want to minimize LLM costs
- Behavior is deterministic (no creativity needed)

**Use Event Router rules when:**
- You need LLM reasoning or creativity
- Multi-step analysis is required
- Complex routing orchestration is needed

## Step 1: Understand Reflex Anatomy

A reflex has four key components:

```typescript
{
  name: "lurk-command",           // Human-readable name
  match: {                        // Pattern matching
    type: "contains",             // exact | contains | prefix | suffix | regex
    pattern: "!lurk",             // What to match
    field: "message.text"         // Where to match (event field path)
  },
  conditions: {                   // Optional execution filters
    eventTypes: ["chat.message.v1"],
    platforms: ["twitch"]
  },
  candidateTemplate: "..."        // Response template with interpolation
}
```

## Step 2: Create Your First Reflex

We'll use the `reflex.create` MCP tool to create our lurk command reflex. You can call this tool via:
- The Brat CLI (coming soon)
- Any MCP client connected to the Reflex bit
- An LLM agent with access to the tool-gateway

For this tutorial, we'll show the direct tool invocation format:

### Reflex Definition

```json
{
  "name": "lurk-command",
  "description": "Respond when users type !lurk in chat",
  "active": true,
  "priority": 100,
  "match": {
    "type": "contains",
    "pattern": "!lurk",
    "field": "message.text",
    "caseSensitive": false
  },
  "conditions": {
    "eventTypes": ["chat.message.v1"],
    "platforms": ["twitch"]
  },
  "candidateTemplate": "Enjoy your lurk, @{{identity.user.displayName}}! 👀",
  "tags": ["chat-commands", "social"]
}
```

### What's Happening Here?

**Match configuration:**
- `type: "contains"` — matches if pattern appears anywhere in field
- `pattern: "!lurk"` — the command we're looking for
- `field: "message.text"` — where to search (the chat message text)
- `caseSensitive: false` — match "!LURK", "!Lurk", etc.

**Conditions (optional filters):**
- `eventTypes: ["chat.message.v1"]` — only match chat messages (internal event type)
- `platforms: ["twitch"]` — only match Twitch events

**Candidate template:**
- Uses `{{identity.user.displayName}}` for personalization
- The reflex enriches the event with this candidate
- Event Router picks up the enriched event and routes to egress

**Priority:**
- Lower number = higher priority (executes first)
- Default is 100
- Use lower priorities (10-50) for high-precedence reflexes

## Step 3: Load the Reflex

### Option A: Via Firestore (Development)

Save the reflex definition to `my-lurk-reflex.json`, then load it directly into Firestore:

```bash
npm run firestore:upsert -- reflexes @my-lurk-reflex.json
```

The reflex cache syncs in real-time, so your reflex is live immediately (no service restart needed).

### Option B: Via MCP Tool (Production)

Call the `reflex.create` tool with the parameters above. This is the preferred method for production as it validates inputs and maintains audit trails.

## Step 4: Test Your Reflex

### Using Brat Chat

1. Start a chat session:
   ```bash
   npm run brat -- chat
   ```

2. Type `!lurk` and press Enter

3. You should see your personalized response appear in <150ms!

### Verify Execution

Check the Reflex metrics endpoint to see your reflex in action:

```bash
curl http://localhost:3000/metrics  # Adjust port if reflex is on different port
```

Look for:
- `reflex_match_count{matched="true"}` — increments when pattern matches
- `reflex_execute_count{status="success"}` — increments on successful execution
- `reflex_end_to_end_latency_p95` — should be <150ms

## Step 5: Add Multiple Response Variations

Want to add variety to your responses? Use an array of templates:

```json
{
  "candidateTemplate": [
    "Enjoy your lurk, @{{identity.user.displayName}}! 👀",
    "@{{identity.user.displayName}} has entered the shadows... 🌙",
    "Lurk mode activated for @{{identity.user.displayName}}! 🥷"
  ]
}
```

The reflex will randomly select one variation each time it executes.

## Step 6: Add Tool Execution (Optional)

Reflexes can also execute MCP tools! Let's say you want to update an OBS source when someone lurks:

```json
{
  "name": "lurk-command-with-obs",
  "match": {
    "type": "contains",
    "pattern": "!lurk",
    "field": "message.text"
  },
  "action": {
    "tool": "mcp_obs-set-source-text",
    "parameters": {
      "sourceName": "CurrentLurker",
      "text": "{{identity.user.displayName}} is lurking!"
    },
    "timeout": 5000
  },
  "candidateTemplate": "Lurk mode activated, @{{identity.user.displayName}}! 👀"
}
```

**Important:** Tool names must match EXACTLY as shown in your available tools list. See [Reflex MCP Tools Reference](../reference/reflex-mcp-tools.md#tool-naming-convention) for naming rules.

## Step 7: Advanced Pattern Matching

### Regex Patterns

For more complex matching, use regex:

```json
{
  "match": {
    "type": "regex",
    "pattern": "!lurk\\s*(.*)",
    "field": "message.text",
    "flags": "i"
  }
}
```

This matches `!lurk` optionally followed by additional text (captured for interpolation).

### Field Path Matching

You can match against any event field:

```json
{
  "match": {
    "type": "exact",
    "pattern": "moderator",
    "field": "identity.user.roles[0]"
  }
}
```

This only matches if the user's first role is "moderator".

## Step 8: Managing Reflexes

### List All Reflexes

```bash
# Via MCP tool (coming soon: brat CLI wrapper)
# reflex.list { "active": true, "limit": 50 }
```

### Update a Reflex

```bash
# Via MCP tool
# reflex.update { "id": "abc123", "active": false }
```

### Delete a Reflex (Soft Delete)

```bash
# Via MCP tool
# reflex.delete { "id": "abc123" }
```

### View Statistics

```bash
# Via MCP tool
# reflex.stats { "id": "abc123" }  # Specific reflex
# reflex.stats {}                   # Overall cache stats
```

Or check the `/health` endpoint:

```bash
curl http://localhost:3000/health  # Adjust port for your reflex service
```

## Troubleshooting

### Reflex Not Matching

1. **Check pattern type**: Is "contains" the right match type? Try "exact" or "regex"
2. **Verify field path**: Does `message.text` exist in your events? Check event structure
3. **Test pattern**: Use `reflex.test` tool with a mock event:
   ```json
   {
     "id": "your-reflex-id",
     "mockEvent": {
       "message": { "text": "!lurk please" },
       "identity": { "user": { "displayName": "TestUser" } }
     }
   }
   ```
4. **Check conditions**: Are `eventTypes` or `platforms` filters too restrictive?

### Reflex Matches But Doesn't Execute

1. **Check active status**: Is `active: true`?
2. **Check priority**: Is another reflex matching first with higher priority (lower number)?
3. **Check tool name**: If using `action`, is the tool name exactly correct (hyphens preserved)?
4. **Check logs**: Look for `reflex.event.execution_failed` in service logs

### Slow Execution (>150ms)

1. **Check tool timeout**: Is the MCP tool taking too long?
2. **Check cache**: Is the cache warmed? Check `/health` endpoint `cache.initialized: true`
3. **Check metrics**: Look at `reflex_execute_latency_p95` — is the tool the bottleneck?

## Best Practices

1. **Use specific patterns**: Prefer "exact" or "prefix" over "contains" when possible (faster matching)
2. **Set appropriate priorities**: Group related reflexes by priority ranges (e.g., 10-20 for high-priority admin commands, 80-100 for user commands)
3. **Keep actions fast**: MCP tools should complete in <5s (default timeout is 5000ms)
4. **Use conditions to filter early**: Add `eventTypes`, `platforms`, `channels` to reduce unnecessary pattern matching
5. **Test with mock events**: Use `reflex.test` before deploying to production
6. **Monitor metrics**: Watch `/metrics` and `/health` to ensure <150ms execution
7. **Use tags for organization**: Tag reflexes by category (`["admin", "moderation"]`) for filtering

## Summary

You've created a reflex that responds to `!lurk` in <150ms! Reflexes are powerful for deterministic commands and significantly reduce latency and cost compared to LLM-based routing.

**Key takeaways:**
- Reflexes provide <150ms deterministic execution
- Pattern matching (exact, contains, prefix, suffix, regex) against any event field
- Optional conditions (eventTypes, platforms, channels, userRoles) for filtering
- Optional tool execution via MCP with parameter interpolation
- Real-time cache sync (no service restart needed)
- Comprehensive metrics and health monitoring

## Next Steps

1. **Add tool execution**: Learn about available MCP tools in [Reflex MCP Tools Reference](../reference/reflex-mcp-tools.md)
2. **Create more commands**: Try creating `!highlight`, `!volume`, `!scene` reflexes
3. **Compare approaches**: Read [Platform Flow Overview](../concepts/platform-flow.md) to understand when to use reflexes vs Event Router rules
4. **Create a Domain MCP Server**: Learn how to build custom tools in [Creating a Domain MCP Server](./creating-a-domain-mcp-server.md)

---

**See Also:**
- [Reflex MCP Tools Reference](../reference/reflex-mcp-tools.md) — Complete tool parameter reference
- [Platform Flow Overview](../concepts/platform-flow.md) — Dual execution paths explained
- [Event Router & Rules](../concepts/event-router-rules.md) — Alternative LLM-based routing
- [Creating the !lurk Command (Event Router)](./lurk-command.md) — The LLM-based approach
