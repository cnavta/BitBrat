# Gap Analysis: SESSI Implementation (Stream Content Summarization & Inspection)

This document identifies incomplete or missing features in the current implementation of the Event Stream Content Summarization & Inspection (SESSI) system, based on a comparison between the Technical Architecture (v1/v2) and the codebase in `sprint-298-e7a8b9`.

## 1. Executive Summary
While the core engine for extraction, normalization, and analysis is functional, the system currently lacks the "Observer" lifecycle management (scheduled triggering), robustness features (idempotency, retries), and full integration with the platform's egress and data enrichment pipelines.

---

## 2. Identified Gaps

### 2.1 Missing Scheduled Triggering (Observer Lifecycle)
*   **Requirement (TA 3.1 & 4)**: The `stream-analyst-service` should respond to `system.timer.v1` events or run a background task to identify active `StreamObservers` due for execution based on their cron expressions.
*   **Current State**: The service is purely reactive. It only processes summarizations when it receives an explicit `internal.summarization.request.v1` Pub/Sub event, an HTTP request, or an MCP tool call. There is no logic to scan the `stream_observers` collection and trigger them autonomously.

### 2.2 Lack of Idempotency Control
*   **Requirement (TA 7)**: "Use `idempotencyKey` (based on Observer ID and Trigger Window) to prevent duplicate reports."
*   **Current State**: No idempotency logic is implemented in `StreamAnalystServer` or `StreamAnalystEngine`. Repeated requests for the same observer/window will trigger redundant LLM calls and duplicate reports.

### 2.3 Incomplete Egress Integration
*   **Requirement (TA 3.1 & 4)**: Dispatches reports to `internal.egress.v1` for delivery to Twitch, Discord, or Email based on the `delivery.destination` configuration.
*   **Current State**: The service publishes to `internal.summarization.report.v1`. It does not populate the `Egress` metadata or route the resulting summary to the `internal.egress.v1` topic, meaning summaries are generated but not actually delivered to the end platforms (e.g., Twitch chat).

### 2.4 Limited Data Source Support (`prompt_logs`)
*   **Requirement (TA 3.1)**: "Source: Primarily queries PersistenceStore (Firestore) and prompt_logs (for LLM evaluation)."
*   **Current State**: `StreamAnalystEngine.queryEvents` is hardcoded to query the `events` collection. It does not support querying the `prompt_logs` collection (or its service-specific sub-collections), even though the `StreamSource` interface defines it.

### 2.5 No Annotation Enrichment
*   **Requirement (TA 3.2.5)**: "Inspection: Generates AnnotationV1 objects... and optionally publishes them back to the event bus or enriches original event records."
*   **Current State**: `AnnotationV1` objects are correctly parsed from the LLM response and included in the report, but they are not used to enrich the original event documents in Firestore.

### 2.6 MCP Tool Independence
*   **Requirement (TA v2, 5)**: Added `mcpEnabled` flag to `StreamObserver` to control tool-based access.
*   **Current State**: The `summarize_stream` tool takes raw parameters (window, type, filters) and calls the engine directly. It does not look up or validate against any `StreamObserver` configurations, bypassing the `mcpEnabled` security gate and ignoring predefined `promptId` or `inspectionEnabled` settings.

### 2.7 Missing Fail-Soft / Retry Logic
*   **Requirement (TA 7)**: "If an LLM call fails, the service should log the error and retry or skip the window."
*   **Current State**: The engine catches errors and logs them, but there is no retry mechanism for transient LLM provider failures.

### 2.8 Hardcoded Event Mapping
*   **Observation**: The mapping from `streamType` (e.g., "chat") to `eventType` (e.g., "chat.message.v1") is hardcoded in the engine. This limits flexibility for custom observers that might want to target specific event subtypes without code changes.

---

## 3. Recommended Remediation Plan

1.  **Implement Observer Poller**: Add a handler for `system.timer.v1` that queries active `StreamObservers` and triggers the analysis loop.
2.  **Add Idempotency Middleware**: Implement a check in the `engine.summarize` method that records successful runs in a `summarization_runs` collection.
3.  **Complete Egress Path**: Update the reporting phase to publish to `internal.egress.v1` with the appropriate `Egress` metadata derived from the observer's `delivery` configuration.
4.  **Expand Data Extraction**: Update `queryEvents` to respect the `source.collection` field and handle the schema differences between `events` and `prompt_logs`.
5.  **Enable Annotation Persistence**: Add a step to save generated annotations back to the respective event documents in Firestore.
6.  **Align MCP Tool with Observers**: Refactor the MCP tool to optionally accept an `observerId` and verify `mcpEnabled` before processing.
