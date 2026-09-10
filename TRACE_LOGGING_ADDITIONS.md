# Trace Logging Additions for Composition Debugging

**Date**: 2026-09-10
**Sprint**: Sprint 50 (plus debugging enhancements)
**Purpose**: Aid in debugging composition execution issues by logging MCP tool requests/responses and path resolutions

---

## New Trace Log Events

### 1. MCP Tool Request Logging

**Event**: `mcp_tool_request`
**Level**: `trace`
**Location**: `src/common/composition/executor.ts:404-409`

Logs every MCP tool invocation with arguments before execution.

**Fields**:
- `stepId`: The composition step ID
- `toolId`: The MCP tool name (e.g., `mcp:get_state`, `mcp:generate_image`)
- `args`: Full JSON-serialized arguments passed to the tool
- `argsSize`: Size of serialized arguments in bytes

**Example**:
```json
{
  "event": "mcp_tool_request",
  "stepId": "retrieve_notes",
  "toolId": "mcp:get_state",
  "args": "{\"keys\":[\"user.fact.slack:UB1993GLB.notes\"]}",
  "argsSize": 51
}
```

---

### 2. MCP Tool Response Logging

**Event**: `mcp_tool_response`
**Level**: `trace`
**Location**: `src/common/composition/executor.ts:416-425`

Logs every MCP tool response after execution completes.

**Fields**:
- `stepId`: The composition step ID
- `toolId`: The MCP tool name
- `executionTime`: Tool execution duration in milliseconds
- `result`: Full JSON-serialized response from the tool
- `resultSize`: Size of serialized response in bytes
- `hasContent`: Boolean indicating if response has `content` array
- `contentLength`: Number of items in `content` array
- `isError`: Boolean indicating if response is an error

**Example**:
```json
{
  "event": "mcp_tool_response",
  "stepId": "retrieve_notes",
  "toolId": "mcp:get_state",
  "executionTime": 12,
  "result": "{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"user.fact.slack:UB1993GLB.notes\\\":{\\\"value\\\":\\\"...\\\"}}\"}]}",
  "resultSize": 234,
  "hasContent": true,
  "contentLength": 1,
  "isError": false
}
```

---

### 3. Path Resolution Logging (Standard)

**Event**: `reference_resolution_succeeded`
**Level**: `trace`
**Location**: `src/common/composition/executor.ts:636-642`

Logs every reference resolution using standard JSON Pointer.

**Fields**:
- `namespace`: Reference namespace (`input`, `context`, `steps`)
- `pointer`: JSON Pointer path (e.g., `/description`, `/retrieve_notes/text`)
- `hasValue`: Boolean indicating if value exists at path
- `valueType`: JavaScript type of resolved value
- `valuePreview`: Truncated preview of the value (max 100 chars for strings, 200 for objects)

**Example**:
```json
{
  "event": "reference_resolution_succeeded",
  "namespace": "input",
  "pointer": "/description",
  "hasValue": true,
  "valueType": "string",
  "valuePreview": "A beautiful sunset over mountains"
}
```

---

### 4. Path Resolution Logging (Shortcut)

**Event**: `shortcut_expansion_succeeded`
**Level**: `debug`
**Location**: `src/common/composition/executor.ts:607-615`

Logs successful MCP shortcut expansion (Sprint 50 feature).

**Fields**:
- `namespace`: Always `steps`
- `pointer`: Full pointer with shortcut (e.g., `/retrieve_notes/text/json/value`)
- `stepId`: The step being referenced
- `shortcut`: The shortcut name (`text`, `json`, `image`, etc.)
- `hasValue`: Boolean indicating if value exists
- `valueType`: JavaScript type of resolved value
- `valuePreview`: Truncated preview of the value

**Example**:
```json
{
  "event": "shortcut_expansion_succeeded",
  "namespace": "steps",
  "pointer": "/retrieve_notes/text/json/value",
  "stepId": "retrieve_notes",
  "shortcut": "text",
  "hasValue": true,
  "valueType": "string",
  "valuePreview": "These are my user notes"
}
```

---

## Value Preview Helper

**Method**: `getValuePreview(value: unknown): string`
**Location**: `src/common/composition/executor.ts:1403-1438`

Safely converts any value to a truncated string for logging.

**Behavior**:
- `null` → `"null"`
- `undefined` → `"undefined"`
- **Strings**: Returns as-is if ≤100 chars, otherwise truncates with length indicator
- **Numbers/Booleans**: Converts to string
- **Objects/Arrays**: JSON-stringifies, truncates at 200 chars with length indicator
- **Circular/Non-serializable**: Returns `"[Object: circular or non-serializable]"`

**Examples**:
```typescript
getValuePreview("short")
// → "short"

getValuePreview("A very long string that exceeds the 100 character limit and will be truncated to prevent log spam...")
// → "A very long string that exceeds the 100 character limit and will be truncated to prevent log spa... (truncated, length: 150)"

getValuePreview({ user: { name: "Alice", age: 30 } })
// → "{\"user\":{\"name\":\"Alice\",\"age\":30}}"

getValuePreview(largeObject)
// → "{\"key1\":\"value1\",\"key2\":\"value2\",\"key3\":\"value3\",\"key4\":\"value4\",\"key5\":\"value5\",\"key6\":\"value6\",\"key7\":\"value7\",\"key8\":\"value8\",\"key9\":\"value9\",\"key10\":\"value10\",\"key11\":\"value11\",\"... (truncated, length: 2456)"
```

---

## Usage for Debugging

### Enable Trace Logging

Set `LOG_LEVEL=trace` for tool-gateway in the environment:

```bash
# Local/Docker
LOG_LEVEL=trace npm run brat -- bit deploy tool-gateway

# Environment variable
export LOG_LEVEL=trace
```

### Debugging Workflow

1. **Enable trace logging** on tool-gateway
2. **Execute composition** (e.g., trigger grockle)
3. **Search logs** for specific events:

```bash
# Find all MCP tool requests/responses for a composition
grep "mcp_tool_request\|mcp_tool_response" tool-gateway.log

# Find specific path resolution
grep "reference_resolution_succeeded" tool-gateway.log | grep "/retrieve_notes/text/json/value"

# Trace full execution flow
grep "execution_started\|mcp_tool_\|reference_resolution\|execution_succeeded" tool-gateway.log
```

### Example Trace Output

```
15:10:36.340 [TRACE] execution_started composition="grockle" stepCount=3
15:10:36.341 [TRACE] mcp_tool_request stepId="retrieve_notes" toolId="mcp:get_state" args="{\"keys\":[\"user.fact.slack:UB1993GLB.notes\"]}"
15:10:36.352 [TRACE] mcp_tool_response stepId="retrieve_notes" toolId="mcp:get_state" result="{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"user.fact.slack:UB1993GLB.notes\\\":null}\"}]}"
15:10:36.353 [TRACE] reference_resolution_started namespace="steps" pointer="/retrieve_notes/text/json/value"
15:10:36.353 [TRACE] shortcut_expansion_attempted stepId="retrieve_notes" shortcut="text"
15:10:36.353 [TRACE] mcp_shortcut_json_parse_attempt remainingPath=["value"]
15:10:36.354 [DEBUG] mcp_shortcut_json_resolved hasResult=false
15:10:36.354 [DEBUG] shortcut_expansion_succeeded valueType="undefined" valuePreview="undefined"
```

---

## Files Modified

1. **src/common/composition/executor.ts**
   - Added `mcp_tool_request` logging (line 404)
   - Added `mcp_tool_response` logging (line 416)
   - Enhanced `shortcut_expansion_succeeded` with value preview (line 605)
   - Enhanced `reference_resolution_succeeded` with value preview (line 634)
   - Added `getValuePreview()` helper method (line 1403)

---

## Testing

All existing tests pass with the new logging:
```
PASS src/common/composition/executor.test.ts
  CompositionExecutor (71 tests)

Test Suites: 3 passed, 3 total
Tests:       121 passed, 121 total
```

---

## Performance Impact

- **Negligible**: Trace logging only activates when `LOG_LEVEL=trace`
- **String operations**: O(n) for value preview, but truncated to prevent large serializations
- **JSON serialization**: Deferred until log level check passes
- **Production**: Trace logs disabled by default (INFO or WARN level)

---

## Related Issues

This logging was added to debug the grockle composition failure in staging where:
1. MCP tool responses were in correct format
2. Path shortcuts were correctly implemented
3. BUT path pointed to wrong location in JSON structure

**Root cause discovered**: Grockle composition used `/text/json/value` but `get_state` returns `{"<key>": <value>}`, so correct path is `/text/json/<key>/value`.

---

## Future Enhancements

Potential improvements for even better debugging:

1. **Correlation ID threading**: Add correlationId to all trace logs
2. **Step timing**: Add per-step execution time in trace logs
3. **Memory usage**: Track object sizes in step state
4. **Path validation**: Warn when paths resolve to undefined
5. **Schema mismatches**: Log when resolved values don't match expected types
