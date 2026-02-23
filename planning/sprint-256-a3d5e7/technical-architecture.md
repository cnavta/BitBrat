# Technical Architecture: Event Router MCP Administration

## 1. Goal
Add Model Context Protocol (MCP) administrative tools to the `event-router` service. This allows LLM agents to manage routing rules programmatically via an MCP-compatible interface.

## 2. Service Inheritance
`EventRouterServer` will be refactored to extend `McpServer` (which already extends `BaseServer`). This provides the necessary infrastructure for registering MCP tools and serving them via SSE.

```typescript
// src/apps/event-router-service.ts
class EventRouterServer extends McpServer {
  // ...
}
```

## 3. Administrative Tools

The following tools will be registered with the MCP server:

### `list_rules`
- **Description**: List all active routing rules stored in Firestore.
- **Parameters**: None.
- **Return**: A list of rule metadata (ID, description, priority, enabled).

### `get_rule`
- **Description**: Retrieve the full details of a specific routing rule.
- **Parameters**: `id` (string).
- **Return**: The full `RuleDoc` object.

### `create_rule`
- **Description**: Create a new routing rule with a specific logic and routing slip.
- **Parameters**:
  - `logic` (string): A JsonLogic expression as a JSON string.
  - `services` (string[]): A list of service names (e.g., `llm-bot`, `auth`, `persistence`) to form the routing slip.
  - `description` (string, optional): A description for the rule.
  - `priority` (number, optional, default: 100): Rule priority.
  - `promptTemplate` (string, optional): A template for a `prompt` annotation to be added to matched events.
  - `responseTemplate` (string, optional): A template for a `text` candidate to be added to matched events.
  - `customAnnotation` (object, optional): A key-value pair (e.g., `{ key: "foo", value: "bar" }`) for a `custom` annotation.
- **Return**: Success/Failure message and the created rule ID.

## 4. Implementation Details

### Rule Creation Logic
The `create_rule` tool will:
1.  **Validate Logic**: Ensure the provided `logic` is a valid JsonLogic string.
2.  **Generate Routing Slip**:
    - Map each service name in `services` to a `RoutingStepRef`.
    - Topic mapping rules:
        - `llm-bot` -> `internal.llmbot.v1`
        - `auth` -> `internal.auth.v1`
        - `state-engine` -> `internal.state.mutation.v1`
        - `query-analyzer` -> `internal.query.analysis.v1`
        - `persistence` -> `internal.persistence.finalize.v1`
        - Default: `internal.{service}.v1` (sanitized)
3.  **Construct Enrichments**:
    - If `promptTemplate` is provided: Add an `AnnotationV1` of kind `prompt`.
    - If `responseTemplate` is provided: Add a `CandidateV1` of kind `text`.
    - If `customAnnotation` is provided: Add an `AnnotationV1` of kind `custom`.
4.  **Firestore Persistence**:
    - Save the rule to the `configs/routingRules/rules` collection.
    - Set `enabled: true` by default.

### Authentication
MCP routes will be protected by `MCP_AUTH_TOKEN` as per `McpServer` implementation.

## 5. Testing
- **Unit Tests**: Test the rule creation logic in isolation.
- **Integration Tests**: Verify the `EventRouterServer` MCP tools using an SSE client (or simulated requests).
