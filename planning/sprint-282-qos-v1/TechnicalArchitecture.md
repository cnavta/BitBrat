# Platform Quality of Service (QOS): Technical Architecture

## 1. Overview
The platform incorporates Quality of Service (QOS) parameters to ensure reliable processing, controllable persistence, and enhanced observability. These changes are integrated into the core event-loop (`BaseServer`), resource-management (`PersistenceStore`), and communication-edge (`IngressEgressServer`).

## 2. QOSV1 Specification
The `QOSV1` interface defines the service level objectives (SLOs) for a single event:
- `persistenceTtlSec`: Duration (in seconds) for which the event record and its snapshots should be retained in Firestore.
- `tracer`: A boolean flag that, when set to `true`, enables high-verbosity tracing and debugging for the event's lifecycle.
- `maxResponseMs`: The maximum time (in milliseconds) allowed for the complete processing of an event before it is considered a timeout violation.

## 3. Enforcement Mechanisms

### 3.1 Persistence TTL (`persistenceTtlSec`)
The `computeExpireAt` helper in the persistence layer is updated to prioritize `qos.persistenceTtlSec` if present.
- **Calculation:** `expireAt = ingressAt + persistenceTtlSec`.
- **Fallback:** If omitted, it defaults to the global `PERSISTENCE_TTL_DAYS`.

### 3.2 Explicit Tracing (`tracer`)
Tracer events trigger special handling across the routing slip:
- **Logging:** `BaseServer` must debug log the full event object upon reception (`onMessage`) and immediately before publication to the next destination (`next`, `complete`).
- **Tracing:** Spans associated with tracer events are always sampled, bypassing default sampling ratios.
- **Ingress Feedback:** If an ingress receives a chat event marked as a tracer, it must immediately send back a debug message containing the `correlationId` and/or `traceId` to the source platform.
- **Error Feedback:** If a tracer event encounters a processing error, the error message and relevant supporting data (e.g., failed step ID) must be sent back to the requester.

### 3.3 Processing Timeouts (`maxResponseMs`)
Event processing is wrapped in a timeout promise:
- **Detection:** If `maxResponseMs` is exceeded, the violation is logged as a `warn`.
- **Escalation:** The event aggregate is updated with an error entry, and if possible, a "Processing Timeout" response is sent to the egress connector.
- **Finalization:** The event is finalized as a failure to prevent further resource consumption.

### 3.4 Debug User Command Handling (`!debug`)
The platform allows designated "debug users" to manually trigger tracer mode for any chat message.
- **Definition:** A debug user is defined as a `connector:username` pair (e.g., `twitch:bitbrat`).
- **Trigger:** A debug user prefixes their message with `!debug`.
- **Handling:**
  - The ingress responsible for the message MUST detect the `!debug` prefix.
  - If the user is in the authorized `debugUsers` list:
    - The `!debug` prefix is removed from the message text.
    - `qos.tracer` is set to `true` for the resulting event.
  - If the user is NOT in the list, the message is treated as a normal message (retaining the prefix if it's not a native platform command).

## 4. Component Design

### 4.1 BaseServer Integration
- `onMessage`: Wraps the handler in a timeout if `maxResponseMs` is set.
- `onMessage`: Logs the full event if `tracer` is `true`.
- `next` / `complete`: Logs the full event before publishing if `tracer` is `true`.

### 4.2 IngressEgressServer Integration
- **Tracer Feedback:** Specific logic in the ingress handlers to detect `qos.tracer` and send immediate feedback for chat-type events.
- **Error Propagation:** The egress path handles error-status events by notifying the source platform if they were originally marked as tracers.

## 5. Observability
All QOS violations and tracer milestones are tagged with the event's `correlationId`, ensuring end-to-end traceability across microservices.
