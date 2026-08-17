# Scheduling Service Analysis – sprint-286-a1b2c3

## Overview
The Scheduling Service (`src/apps/scheduler-service.ts`) is a critical component for time-based event triggering. It currently leverages Firestore for schedule persistence and MCP for a management interface.

## Current Functionality
- **Schedule Management (MCP Tools):**
    - `list_schedules`: Returns all schedules (optional filter for enabled only).
    - `get_schedule`: Retrieves a specific schedule by ID.
    - `create_schedule`: Adds a new schedule with 'once' or 'cron' type.
    - `update_schedule`: Partially updates a schedule and re-calculates `nextRun`.
    - `delete_schedule`: Removes a schedule from Firestore.
- **Execution Mechanism:**
    - Triggered by 'tick' events via POST `/tick` (HTTP) or `internal.scheduler.tick` (Pub/Sub).
    - Queries Firestore for enabled schedules where `nextRun <= now`.
    - Publishes an `InternalEventV2` for each matching schedule to `internal.ingress.v1`.
    - Updates `lastRun`, `nextRun`, and `enabled` (for 'once' types) after execution.

## Identified Issues & Risks

### 1. Robustness & Reliability
- **Non-Atomic Ticks:** `handleTick` performs a `.get()` followed by multiple `.update()` calls. This lacks atomicity. If two ticks overlap, a schedule could be executed twice.
- **Brittle Next-Run Logic:** 
    - `calculateNextRun` returns `null` for past 'once' timestamps.
    - If a tick fails to update the document after execution, the schedule will stay with an old `nextRun` and likely re-execute on the next tick.
- **Error Propagation:** If `executeSchedule` fails, it logs an error but doesn't implement a retry or move the schedule to an error state.

### 2. Validation & Security
- **Cron Expression Validation:** Minimal validation for the string passed to `cron-parser`. Invalid expressions may cause the service to log an error and return `null` for `nextRun`, effectively disabling the schedule silently.
- **Timestamp Precision:** Uses `new Date()` and `Timestamp.now()` which might have subtle drift in distributed environments.

### 3. Missing Features
- **Timezone Support:** Currently assumes UTC or local server time for cron expressions. No way to specify a target timezone.
- **Schedule History/Logs:** No historical record of executions is kept other than `lastRun` on the schedule document itself.
- **Manual Trigger Tool:** No MCP tool to manually trigger a schedule regardless of its `nextRun` time.
- **Concurrency Controls:** No mechanism to prevent multiple executions if the `tick` interval is shorter than the execution time of all schedules.

### 4. Observability & Testing
- **Test Coverage:** Existing tests only cover basic health endpoints (`/healthz`, etc.). No unit tests for:
    - `calculateNextRun` edge cases.
    - Tool handler logic.
    - `handleTick` execution flow.
- **Telemetry:** Basic logging exists, but lacks structured metrics (e.g., execution duration, failure rates per schedule).

## Recommendations
1. **Stabilize Ticks:** Use a Firestore transaction or distributed lock to ensure each schedule is processed once per execution window.
2. **Improve Validation:** Add stricter Zod validation or a dry-run check for cron expressions during creation/update.
3. **Expand Testing:** Implement a comprehensive suite of unit tests for the scheduler logic.
4. **Refactor Next-Run Logic:** Move `nextRun` calculation into a dedicated utility and handle edge cases (e.g., missed ticks) more explicitly.
