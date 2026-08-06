# Execution Plan – sprint-281-0f4a2b: Webhook Egress

## 1. Objective
Implement a generalized, stateless Webhook Egress mechanism in the `api-gateway` service. This system allows internal microservices to trigger external HTTP POST requests via the platform's message bus, supporting variable interpolation and customizable payload formatters.

## 2. Implementation Phases

### Phase 1: Core Utilities (P0)
- **VariableResolver**: 
  - Create a utility to parse `${...}` tokens.
  - Implement resolution for `${event.path}` (using `lodash.get` or similar).
  - Implement resolution for `${ENV.VAR_NAME}`.
  - Implement resolution for `${secret.SECRET_NAME}` (initially from process environment, prepared for GCP Secret Manager).
- **FormatterRegistry & Formatters**:
  - `FormatterRegistry`: Store and retrieve formatters by name.
  - `JsonFormatter`: Standard platform payload (correlationId, type, payload).
  - `DiscordFormatter`: Map platform event fields to Discord's `content`, `username`, `avatar_url`.

### Phase 2: Orchestration & Execution (P0-P1)
- **WebhookManager**:
  - Implement `handleWebhookEgress(event: InternalEventV2)`.
  - Resolve URL and Headers using `VariableResolver`.
  - Format payload using `FormatterRegistry`.
  - Execute HTTP POST via `fetch` (asynchronous).
  - Handle success (2xx) and log as `DELIVERED`.
- **Message Bus Integration**:
  - Subscribe to events where `egress.connector === 'webhook'`.
  - Route matched events to `WebhookManager`.

### Phase 3: Reliability & Observability (P1)
- **Error Handling**:
  - Catch 4xx/5xx and network errors.
  - Log failures with correlationId and destination URL (redacting sensitive parts).
  - Publish `egress.failed` event to the message bus for DLQ/Retry.
- **Observability**:
  - Ensure all logs include `correlationId`.
  - Add basic metrics for success/failure rates.

### Phase 4: Validation & Hardening (P2)
- **Unit Testing**: 100% coverage for Resolver and Formatters.
- **Integration Testing**: End-to-end flow using a mock HTTP server.
- **Validation Script**: Create `validate_deliverable.sh` to verify core resolution logic.

## 3. Component Interaction
1. `MessageBus` -> `EgressRouter` -> `WebhookManager`.
2. `WebhookManager` uses `VariableResolver` for URL/Headers.
3. `WebhookManager` uses `FormatterRegistry` for Body.
4. `WebhookManager` uses `fetch` for delivery.
5. `WebhookManager` uses `MessageBus` to report failure.

## 4. Security & Secret Management
- Raw secrets NEVER travel on the message bus.
- Resolution happens only at the `api-gateway` edge.
- `api-gateway` service account must have access to required secrets.

## 5. Definition of Done
- All P0 and P1 backlog items completed.
- `validate_deliverable.sh` passes successfully.
- Code matches technical architecture and requirement update.
- Documentation for new connector configuration updated.
