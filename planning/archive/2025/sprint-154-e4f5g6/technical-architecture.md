# Technical Architecture – DLQ Processing and Error Handling

## 1. Overview
This document describes the architectural changes required to enable the `persistence` service to handle Dead-Letter Queue (DLQ) events. This ensures that any event that fails terminally in the system is properly recorded in the event store with its error state and context.

## 2. Goals
- Provide visibility into failed events within the BitBrat Platform.
- Ensure the `persistence` service is the central recorder for all terminal failures.
- Maintain a consistent error model across the platform.

## 3. Proposed Changes

### 3.1 Topic Subscriptions
The `persistence` service will be updated to consume from the following topics:
- `internal.deadletter.v1`: General purpose dead-letter topic for workers.
- `internal.router.dlq.v1`: Specific topic used by the Router when no routing rules match or an abort occurs.

### 3.2 Data Model Updates
We will extend the `EventDocV1` (the Firestore representation of an event) to include a `deadletter` field.

```typescript
export interface EventDocV1 extends InternalEventV2 {
  status?: 'INGESTED' | 'FINALIZED' | 'ERROR' | string;
  // ... existing fields ...
  deadletter?: {
    reason: string;
    error: { code: string; message?: string } | null;
    lastStepId?: string;
    originalType?: string;
    slipSummary?: string;
    at: string; // ISO8601
  };
}
```

### 3.3 Persistence Logic
A new method `applyDeadLetter` will be added to `PersistenceStore`.

1. **Extraction**: Normalize the DLQ event payload.
2. **Identification**: Use `correlationId` from the envelope to locate the original event document.
3. **Update**:
    - Set `status` to `ERROR`.
    - Populate the `deadletter` field with data from the DLQ payload.
    - Set `finalizedAt` to the current time.
    - Update `ttl` based on the standard persistence policy.

### 3.4 Architecture.yaml
The `persistence` service definition will be updated to include the new consumed topics.

```yaml
  persistence:
    topics:
      consumes:
        - internal.ingress.v1
        - internal.persistence.finalize.v1
        - internal.deadletter.v1
        - internal.router.dlq.v1
```

## 4. Flow Diagram
1. **Event Failure**: A service (e.g., `llm-bot`) or the `router` encounters a terminal error.
2. **DLQ Emission**: The service calls `buildDlqEvent()` and publishes the result to `internal.deadletter.v1`.
3. **Consumption**: `persistence` service receives the DLQ event.
4. **Storage**: `persistence` service updates the Firestore document identified by `correlationId`.

## 5. Alternatives Considered
- **Appending to `errors` array**: While `InternalEventV2` has an `errors` array, DLQ context (like `reason` and `lastStepId`) is more structured and warrants a specific field for easier querying and display in dashboards.
- **Separate DLQ Collection**: Storing DLQ events in a separate collection would make it harder to see the full lifecycle of a single event by correlation ID. Keeping it within the `events` collection is preferred.

## 6. Security & Observability
- All DLQ processing will be logged with `correlationId` for traceability.
- Sensitive data in `originalPayloadPreview` is already handled by `safePreview` in the DLQ builder.
