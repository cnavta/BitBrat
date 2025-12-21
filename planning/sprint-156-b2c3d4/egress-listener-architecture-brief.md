# Architecture Brief: Unified Egress Listener & Generic Routing

## 1. Objective
Enhance the `ingress-egress` service to support a generic egress path via `internal.egress.v1`, allowing load-balanced message delivery across all service instances. This supplements the existing instance-specific egress topics and ensures high availability for platform responses.

## 2. Design Principles
- **Centralized Logic**: Avoid duplication by extracting egress processing into a single, unified handler.
- **Discriminator-First Routing**: Prioritize the `egress.type` property for determining the target platform, reducing reliance on heuristics.
- **Graceful Degradation**: Implement a Dead Letter Queue (DLQ) fallback to handle messages that cannot be delivered due to missing configuration or unavailable clients.

## 3. Proposed Architecture

### 3.1 Unified Egress Handler
Refactor `src/apps/ingress-egress-service.ts` to extract the core delivery logic into a private method:
`handleEgressDelivery(evt: InternalEventV2, ctx: MessageContext, subscriptionTopic: string)`.

This method will encapsulate the following workflow:
1.  **Selection & Enrichment**: Execute `selectBestCandidate` and `markSelectedCandidate` to finalize the response content.
2.  **Payload Extraction**: Use `extractEgressTextFromEvent` to derive the raw string for delivery.
3.  **Target Determination**:
    *   Identify target platform (`discord` vs `twitch:irc`) via `evt.egress.type`.
    *   Fallback to legacy `source` and `annotations` checks if `egress.type` is missing.
4.  **Client Validation**: Verify that the required client (`this.discordClient` or `this.twitchClient`) is initialized and connected.
5.  **Execution & Finalization**:
    *   If valid and available: Call `sendText` and publish `SENT` status to `internal.persistence.finalize.v1`.
    *   If undeliverable: Publish failure context to `internal.deadletter.v1` (DLQ) and ACK the message to prevent retry loops for unrouteable events.

### 3.2 Listener Configuration
The service will register two concurrent listeners:
- **Topic**: `internal.egress.v1.{instanceId}` | **Queue**: `ingress-egress.{instanceId}` (Unchanged)
- **Topic**: `internal.egress.v1` | **Queue**: `ingress-egress.generic` (New)

Both listeners will invoke `handleEgressDelivery`. The generic queue name ensures that if multiple instances are running, only one will process any given message on the generic topic (competing consumer pattern).

### 3.3 Dead Letter Logic
When a message reaches a terminal routing failure (e.g., `discord` requested but Discord is disabled), the service will publish a DLQ event:
- **Target Topic**: `internal.deadletter.v1`
- **Schema**: Align with `normalizeDeadLetterPayload` in the Persistence service, including `correlationId`, `reason` (e.g., `EGRESS_CLIENT_UNAVAILABLE`), and the original event type.

## 4. Minimal Code Splitting
By consolidating the logic into `handleEgressDelivery`, the "splitting" is confined to the initial subscription setup. All downstream logic—from candidate marking to persistence finalization—remains identical regardless of which topic the message arrived on.

## 5. Next Steps
1. User approval of this brief.
2. "Start sprint" to initiate implementation.
3. Update `architecture.yaml` to reflect new topic consumption.
4. Implement `handleEgressDelivery` and DLQ helper.
5. Add integration tests for generic topic routing.
