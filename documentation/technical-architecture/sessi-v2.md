### Technical Architecture: Event Stream Content Summarization & Inspection (SESSI) v2

#### 1. Abstract
The BitBrat Platform handles high volumes of heterogeneous event data. This document evolves the **"Stream Observer"** pattern to support both scheduled analysis and on-demand, interactive summarization via the Model Context Protocol (MCP). The `stream-analyst-service` provides a unified engine for automated content summarization and inspection.

#### 2. Core Concepts
- **Stream**: A filtered, time-bound collection of events retrieved from the `PersistenceStore` (Firestore).
- **Observer**: A declarative configuration defining *what* to watch, *when* to analyze, and *how* to report results.
- **MCP Summary Request**: An on-demand request initiated via an MCP client (e.g., Junie or a user-facing bot) to summarize a specific window of a stream.
- **Inspection**: Specialized analysis producing structured `Annotations` (scores, flags, metadata).

#### 3. Architecture Components

##### 3.1 `stream-analyst-service`
The orchestrator for the summarization lifecycle.
- **Source**: Firestore (`events`, `prompt_logs`).
- **Trigger**: 
  - Scheduled: `system.timer.v1` (via `scheduler-service`).
  - Event-driven: `internal.summarization.request.v1` (via Chat command or other services).
  - **Tool-driven (New)**: Direct invocation via MCP tool calls from `tool-gateway`.
- **Egress**: Dispatches reports to `internal.egress.v1`.

##### 3.2 MCP Integration (New)
To satisfy the requirement "Summarize the last 10 minutes of chat for me," the `tool-gateway` will expose a `summarize_stream` tool.
- **Tool Name**: `summarize_stream`
- **Parameters**:
  - `stream_type`: (e.g., "chat", "logs", "errors")
  - `window_minutes`: integer (e.g., 10)
  - `filters`: optional object (e.g., `channel: "#bitbrat"`)
- **Workflow**:
  1. MCP Client calls `summarize_stream`.
  2. `tool-gateway` forwards the request to `stream-analyst-service`.
  3. `stream-analyst-service` executes the "Read-Analyze-Report" loop immediately.
  4. Result is returned synchronously to the tool caller AND optionally dispatched to egress.

#### 4. Data Flow & Orchestration
1. **Trigger Phase**: A trigger (scheduled, event, or tool call) hits `stream-analyst-service`.
2. **Extraction Phase**: Queries Firestore for events within the specified `window` and matching `filters`.
3. **Normalization Phase**: Standardizes events into text: `[Timestamp] [User] [Message]`. Uses `StreamBuffer` for truncation and PII redaction.
4. **Analysis Phase (LLM)**:
   - Constructs a prompt using the `Prompt Assembly Framework`.
   - Sends the normalized stream and task instructions to the LLM.
5. **Reporting Phase**:
   - Returns the summary to the caller (if tool-triggered).
   - Publishes `internal.summarization.report.v1`.

#### 5. Updated `StreamObserver` Schema (Firestore)
Added `mcpEnabled` flag to allow/deny tool-based access to specific stream configurations.
```yaml
id: "twitch-chat-summary"
active: true
mcpEnabled: true # Allow MCP tools to trigger this observer
source:
  collection: "events"
  filters:
    channel: "#bitbrat"
    type: "chat.message.v1"
trigger:
  type: "hybrid" # Supports both cron and on-demand
  expression: "0 * * * *"
analysis:
  promptId: "standard-chat-summary-v1"
delivery:
  egressTopic: "internal.egress.v1"
```

#### 6. Implementation Strategy (Updated)
- **Phase 1**: `stream-analyst-service` core (Firestore source, LLM integration).
- **Phase 2**: MCP Tool implementation in `tool-gateway` and service connector.
- **Phase 3**: Inspection & Annotations (JSON parsing).
- **Phase 4**: Scheduler integration.
