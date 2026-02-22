# State Engine Rule Examples

## Introduction
The State Engine uses [JSON-Logic](https://jsonlogic.com/) to define reactive rules. Rules are evaluated after a state key is successfully updated.

## Rule Structure
A rule consists of three main parts:
1.  `id`: A unique identifier for the rule.
2.  `when`: A JSON-Logic expression that returns a boolean. It has access to `{ key, value }`.
3.  `actions`: An array of actions to execute if the condition matches.

### Supported Actions
- `publishEgress`: Publishes an event to the `internal.egress.v1` topic.

---

## Examples

### 1. Triggering an event when a stream starts
This rule listens for updates to the `stream.state` key and triggers an egress event when the value is set to `"on"`.

```yaml
id: "on_stream_start"
when:
  and:
    - "==": [{ var: "key" }, "stream.state"]
    - "==": [{ var: "value" }, "on"]
actions:
  - type: "publishEgress"
    payload:
      type: "system.stream.online"
      message: "Stream detected online"
      annotations:
        - id: "state-engine"
          kind: "intent"
          label: "stream.online"
          source: "state-engine"
```

### 2. Monitoring OBS scene changes
This rule detects when the OBS scene is changed and triggers a notification.

```yaml
id: "on_scene_change"
when:
  "==": [{ var: "key" }, "obs.scene"]
actions:
  - type: "publishEgress"
    payload:
      type: "obs.scene.changed"
      message: "OBS scene changed to something new"
```

### 3. Detecting a specific category change
Triggers only when the stream category is updated to "Science & Technology".

```yaml
id: "on_tech_category"
when:
  and:
    - "==": [{ var: "key" }, "stream.category"]
    - "==": [{ var: "value" }, "Science & Technology"]
actions:
  - type: "publishEgress"
    payload:
      type: "notification.alert"
      message: "Tech stream alert"
```

---

## JSON-Logic Syntax Tips
-   **`{ var: "key" }`**: Accesses the name of the state key being updated.
-   **`{ var: "value" }`**: Accesses the new value of the state key.
-   **`and` / `or` / `not`**: Logical operators.
-   **`in`**: Checks if a value is in an array.
-   **`if`**: Conditional logic (rarely needed for the root of a rule).

## Testing Rules
To test a rule without redeploying the service:
1.  **Manual Verification**: Use the JSON-Logic online playground (jsonlogic.com) with the data set to `{ "key": "your_key", "value": "your_value" }`.
2.  **Unit Tests**: Add a test case to `src/apps/state-engine.test.ts` to verify your rule logic.

---

## Best Practices
-   **Keep Rules Simple**: Rules should be easy to read and maintain. If the logic is too complex, consider splitting it into multiple rules or moving it to a dedicated service.
-   **Use Descriptive IDs**: Rule IDs should clearly describe what the rule does.
-   **Be Specific with `when`**: Always check the `key` first in your `when` condition to avoid evaluating logic on unrelated state changes.
