# Concepts: Event Router & Rules

The **Event Router** is the heart of the BitBrat Platform's event orchestration. It is responsible for intercepting incoming events, evaluating them against a set of rules, and assigning "routing slips" that define how the event should be processed by other services.

## 1. Role of the Event Router

When an event (e.g., a Twitch chat message, a subscription, or a webhook) enters the platform via the `ingress-egress` service, it is published to the `internal.ingress.v1` topic.

The Event Router consumes these events and:
1.  **Matches**: Runs the event data through all enabled rules.
2.  **Enriches**: Adds metadata, annotations, or response candidates to the event.
3.  **Routes**: Assigns a `routingSlip`—a sequence of topics the event must visit (e.g., Reflex, LLM Bot, State Engine).

### Dual Execution Paths

The Event Router orchestrates two distinct execution paths in the Act stage:

- **Deterministic Path (Reflex)**: Routes to `internal.reflex.v1` for pattern-match execution (<150ms, no LLM overhead)
  - Use for repeated, predictable behaviors (chat commands, simple automations)
  - Reflex matches stored definitions and directly executes MCP tools

- **LLM-Based Path**: Routes to `internal.llmbot.v1` or `internal.query.analysis.v1` for AI reasoning (2-10s)
  - Use for novel situations, complex reasoning, creative responses
  - LLM selects and calls tools via full inference

Rules determine which path (or both) an event takes by specifying routing slip topics. See [Platform Flow Overview](./platform-flow.md) for details on dual paths.

## 2. Rule Format

Rules are stored in the database under `configs/routingRules/rules`. Each rule is a JSON document with the following structure:

### Core Fields
- **`enabled`** (boolean): Whether the rule is active.
- **`priority`** (number): Rules are evaluated in ascending order of priority (lower numbers run first).
- **`description`** (string): A human-readable description of the rule's purpose.

### Matching Logic (`logic`)
The `logic` field contains a [JsonLogic](https://jsonlogic.com/) expression that must evaluate to `true` for the rule to match. It is a best practice to filter by the current `routing.stage` to ensure rules only trigger at the appropriate point in the event lifecycle (e.g., `contextualization` or `reaction`).

Example: Match if message contains "!lurk" during the contextualization stage
```json
{
  "and": [
    { "===": [{ "var": "routing.stage" }, "contextualization"] },
    {
      "text_contains": [
        { "var": "message.text" },
        "!lurk",
        true
      ]
    }
  ]
}
```

### Enrichments (`enrichments`)
If a rule matches, these enrichments are applied to the event:
- **`message`** (string): A fixed response text.
- **`candidates`** (array): A list of potential response texts.
- **`randomCandidate`** (boolean): If true, one candidate is chosen at random.
- **`annotations`** (array): Structural metadata to add to the event.
- **`egress`** (object): Overrides the default egress target (e.g., send to a specific channel).

### Routing (`routing`)
Defines where the event goes next.
- **`stage`** (string): The current architectural stage (e.g., `enrichment`, `reaction`).
- **`slip`** (array): A sequence of `RoutingStep` objects.
  - **`nextTopic`**: The Pub/Sub topic to publish to next.
  - **`id`**: A unique ID for the step.

## 3. Example: The !lurk Rule

Here is a simplified version of the `!lurk` command rule:

```json
{
  "id": "lurk-command",
  "enabled": true,
  "priority": 50,
  "logic": "{\"and\": [{\"===\": [{\"var\": \"routing.stage\"}, \"contextualization\"]}, {\"text_contains\": [{\"var\": \"message.text\"}, \"!lurk \", true]}]}",
  "enrichments": {
    "candidates": [
      { "id": "c1", "kind": "text", "source": "event-router", "text": "@{{user.displayName}} is now lurking..." },
      { "id": "c2", "kind": "text", "source": "event-router", "text": "Enjoy your lurk, @{{user.displayName}}!" }
    ],
    "randomCandidate": true
  },
  "routing": {
    "stage": "reaction",
    "slip": []
  }
}
```

In this case:
1.  The Event Router detects "!lurk" during the `contextualization` stage.
2.  It picks a response candidate (but doesn't send it yet).
3.  The event moves to the `reaction` stage. Since the routing slip is empty, `BaseServer.next()` automatically routes it to egress to be sent to the chat.

*Note: In the standard platform flow, most command rules trigger in `contextualization`, where the event has already been enriched by the `auth` service, and then proceed to `reaction` for delivery.*

## 4. Execution Order

The Event Router processes all matching rules in priority order. If multiple rules match:
- Enrichments are merged (later rules can overwrite previous ones).
- Routing slips are appended or replaced depending on the rule configuration.

For a deep dive into the `brat` CLI commands used to manage these rules, see the [Brat CLI Deep Dive](../tools/brat.md).
