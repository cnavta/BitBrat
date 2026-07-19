# Tutorial: Creating the !lurk Command

In this tutorial, you will learn how to create a custom command that allows users in your chat to "lurk" (letting everyone know they are watching but not interacting).

## Prerequisites

- Platform is running locally (see [Quickstart](../getting-started/quickstart.md)).
- You have a basic understanding of [Event Router Rules](../concepts/event-router-rules.md).

## Step 1: Define the Rule Logic

We want the platform to respond whenever a user types `!lurk` in the chat. Using JsonLogic, we can define this as checking if the message text contains our command.

Create a file named `my-lurk-rule.json`:

```json
{
  "id": "tutorial-lurk",
  "enabled": true,
  "priority": 100,
  "description": "Tutorial Lurk Command",
  "logic": "{\"and\": [{\"===\": [{\"var\": \"routing.stage\"}, \"contextualization\"]}, {\"text_contains\": [{\"var\": \"message.text\"}, \"!lurk \", true]}]}",
  "enrichments": {
    "candidates": [
      { "id": "c1", "kind": "text", "source": "event-router", "text": "Enjoy your lurk, @{{user.displayName}}!" },
      { "id": "c2", "kind": "text", "source": "event-router", "text": "@{{user.displayName}} has entered the shadows..." }
    ],
    "randomCandidate": true
  },
  "routing": {
    "stage": "reaction",
    "slip": []
  }
}
```

### What's happening here?
- **`logic`**: Watches for `!lurk ` but only during the `contextualization` stage.
- **`enrichments`**: Provides two possible responses. `{{user.displayName}}` is a placeholder for the sender's name.
- **`routing`**:
    1.  Sets the next stage to `reaction`.
    2.  Uses an empty routing slip. In the `contextualization` phase, the event has already been processed by the platform's `auth` service, so `user.displayName` is already available.
    3.  Because the slip is empty, the platform's default routing will send the event to the egress service after the `reaction` stage is set.

## Step 2: Load the Rule

Load your new rule into the database.

**PostgreSQL (Default)**:
```bash
# Using SQL
psql $DATABASE_URL -c "INSERT INTO routing_rules (id, enabled, priority, description, logic, enrichments, routing) VALUES ('tutorial-lurk', true, 100, 'Tutorial Lurk Command', ...)"

# Or create a migration file
# See: documentation/guides/seed-data.md
```

**Firestore (Legacy)**:
```bash
npm run firestore:upsert -- configs/routingRules/rules @my-lurk-rule.json
```

## Step 3: Verify with Brat Chat

The easiest way to test your new command is using the `brat chat` CLI.

1.  Start a chat session:
    ```bash
    npm run brat -- chat
    ```
2.  Type `!lurk` and press Enter.
3.  You should see one of your defined responses appear in the chat!

## Troubleshooting

- **No response?** Run `npm run brat -- doctor` to ensure the services are healthy and connected to the database.
- **Check logs**: Use `npm run local:logs` to see if the Event Router is matching your rule. Look for `rule_loader.snapshot_applied`.
- **Logic issues?** Ensure the `logic` field is a valid JSON string containing the JsonLogic object.

## Summary

Congratulations! You've just created and deployed your first custom command to the BitBrat Platform using Event Router rules. You can now experiment with more complex enrichments or even add analysis steps to your routing slip.

## Alternative: The Reflex Approach

This tutorial showed you how to create a command using **Event Router rules** — the traditional, flexible approach that routes through the full event pipeline. However, for repeated, predictable commands like `!lurk`, there's a **faster alternative**: **Reflexes**.

**Reflexes** provide deterministic pattern-match execution with <150ms latency (vs 2-10s for LLM-based routing). They:
- Match patterns directly against events (exact, contains, prefix, suffix, regex)
- Skip the LLM/analysis overhead entirely
- Optionally execute MCP tools with parameter interpolation
- Generate candidates just like Event Router rules

**When to use which:**
- **Event Router Rules** (this tutorial): Flexible routing, multi-step analysis, LLM reasoning, complex orchestration
- **Reflexes**: Fast, repeated commands with predictable responses (<150ms execution)

See the [Creating a Reflex tutorial](./creating-a-reflex.md) to learn how to implement `!lurk` as a reflex for sub-150ms responses.

## Next Steps

1. **Add LLM reasoning**: Continue with [Part 2: Routing to the LLM Bot, Prompts & Personalities](./lurk-command-part-2.md), where you replace the static responses with LLM-generated replies and give your command a distinct personality.

2. **Make it faster**: Learn how to implement this as a reflex in [Creating a Reflex](./creating-a-reflex.md) for <150ms execution.

3. **Understand the architecture**: Read [Platform Flow Overview](../concepts/platform-flow.md) to understand the dual execution paths (Event Router rules vs Reflexes).
