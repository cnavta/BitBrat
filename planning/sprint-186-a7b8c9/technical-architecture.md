# Technical Architecture — Scheduled Events

## Overview
This document outlines the architecture for adding scheduled event capabilities to the BitBrat Platform. Scheduled events allow the platform to trigger internal actions at specific times or intervals, defined in Firestore and managed via MCP tools.

## Proposed Architecture

### 1. Data Model (Firestore)
We will use a new Firestore collection `schedules` to store event definitions.

**Collection**: `schedules`
- `id` (string): Unique identifier.
- `title` (string): Human-readable name.
- `description` (string): Optional description.
- `schedule` (object):
    - `type`: `once` | `cron`
    - `value`: ISO timestamp for `once`, or Cron expression for `cron`.
- `event` (object): Partial `InternalEventV2` to be produced.
    - `type`: `InternalEventType`
    - `payload`: Record<string, any>
    - `message`: MessageV1 (optional)
    - `annotations`: AnnotationV1[] (optional)
- `enabled` (boolean): Whether the schedule is active.
- `lastRun` (timestamp): Last time the event was triggered.
- `nextRun` (timestamp): Next scheduled trigger time (indexed for efficient querying).
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

### 2. Execution Mechanism
We will use **GCP Cloud Scheduler** to trigger a "tick" event.

1. **Cloud Scheduler Job**: Configured to run every minute (or desired granularity, e.g., `* * * * *`).
2. **Trigger**: Publishes a message to the `internal.scheduler.tick` topic (or triggers an HTTP endpoint on `scheduler-service`).
3. **Scheduler Service**:
    - Listens for the tick.
    - Queries Firestore: `schedules` where `enabled == true` and `nextRun <= now`.
    - For each matching schedule:
        - Constructs a full `InternalEventV2`.
        - Sets `source` to `scheduler`.
        - Generates a new `correlationId`.
        - Publishes the event to `internal.ingress.v1`.
        - Calculates the next `nextRun` based on the schedule type/cron and updates the document.
        - Updates `lastRun`.

### 3. MCP Tools
The `scheduler-service` will expose the following tools:

- `list_schedules`: List all or filtered scheduled events.
- `create_schedule`: Create a new scheduled event.
- `update_schedule`: Modify an existing scheduled event (including enabling/disabling).
- `delete_schedule`: Remove a scheduled event.
- `get_schedule`: Get details of a specific schedule.

### 4. Integration with Internal Ingress
Events produced by the scheduler will be published to `internal.ingress.v1`. This ensures they follow the same path as external events (Auth enrichment, Event Routing, etc.), allowing them to trigger LLM-bot actions or Command Processor logic seamlessly.

## Alternatives Considered

### Option A: Direct Cloud Scheduler Jobs per Schedule
- **Pros**: More native, handles scaling better.
- **Cons**: Requires managing GCP resources via API from within the service; harder to implement "repeatable by week/month" if using simple Firestore-only definitions without syncing logic.

### Option B: Local setTimeout/Interval in Scheduler Service
- **Pros**: Extremely simple.
- **Cons**: Not reliable in serverless environments (Cloud Run) as the service may scale to zero or restart, losing state.

## Decision
We will proceed with the **Firestore + Cloud Scheduler Tick** approach for its balance of reliability and simplicity.
