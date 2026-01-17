# Routing Rules — Firestore Example Document

This example shows a single routing rule document to be stored in Firestore at the collection path:

- Collection: configs/routingRules/rules
- Document ID: chat-command-bot

Schema reference: planning/sprint-100-e9a29d/technical-architecture.md and src/services/router/rule-loader.ts.

Notes:
- Only enabled, valid rules are cached and evaluated.
- Lower numeric priority values indicate higher priority. First match short-circuits.
- routingSlip entries should define intended processing steps. Do not include runtime fields like status or attempt; the RouterEngine will normalize these at runtime.
- If no rule matches, the router defaults to INTERNAL_ROUTER_DLQ_V1 (internal.router.dlq.v1).

Example Firestore document (configs/routingRules/rules/chat-command-bot):

```json
{
  "enabled": true,
  "priority": 10,
  "description": "Route chat commands starting with ! to LLM bot",
  "logic": {
    "and": [
      { "==": [ { "var": "type" }, "chat.command.v1" ] },
      { ">": [ { "var": "payload.text.length" }, 1 ] }
    ]
  },
  "routingSlip": [
    {
      "id": "router",
      "v": "1",
      "nextTopic": "internal.llmbot.v1",
      "maxAttempts": 3,
      "attributes": { "origin": "event-router" }
    }
  ],
  "metadata": {
    "createdAt": "2025-11-28T13:11:00.000Z",
    "updatedAt": "2025-11-28T13:11:00.000Z",
    "updatedBy": "example"
  }
}
```

Usage tips:
- Set BUS_PREFIX (e.g., "dev.") in your environment; the router will publish to `${BUS_PREFIX}internal.llmbot.v1` when this rule matches.
- Ensure your consumers subscribe to the correct subject names.

Migration note:
- Earlier drafts referenced the path "configs/routingRules" which is a document path (even number of segments) and will cause Firestore to error when used with collection(). The correct collection path is "configs/routingRules/rules" (odd number of segments). The runtime now normalizes even-segment paths by appending "/rules", but you should create your collection at the corrected path.
