# Platform Webhook Egress: Technical Architecture

## 1. Overview
The platform now supports a generalized egress mechanism hosted within the `api-gateway` service. This architecture enables internal microservices to trigger external HTTP POST requests by publishing platform events with the `webhook` connector type.

## 2. Component Design

### 2.1 WebhookManager
The central orchestrator in `api-gateway` responsible for:
- Subscribing to egress events from the platform's internal message bus.
- Filtering events where `egress.connector` is set to `webhook`.
- Delegating variable resolution and payload formatting.
- Executing HTTP POST requests to resolved destination URLs.
- Logging delivery outcomes and publishing failure events on the bus.

### 2.2 VariableResolver
A utility service that processes template strings within webhook metadata:
- **`${event.path}`**: Accesses properties of the `InternalEventV2` (e.g., `identity.user.id`, `correlationId`).
- **`${ENV.VAR_NAME}`**: Reads from the service's environment variables.
- **`${secret.SECRET_NAME}`**: Resolves platform-managed secrets from the platform's secure secret store or protected environment variables.
- **Interpolation logic**: Uses regex or a template parser to find `${...}` tokens and replace them with resolved values.

### 2.3 FormatterRegistry
A registry of specialized payload formatters:
- **`json` (Default)**: Produces a standardized, minimized JSON payload containing the event's `correlationId`, `type`, and the `payload` object.
- **`discord`**: Maps platform event fields to the Discord Webhook API schema (`content`, `username`, `avatar_url`).
- **Extensibility**: Designed to support additional formatters (e.g., Slack, MS Teams) in the future.

## 3. Data Flow

1. **Egress Trigger**: An internal service (e.g., `brat-service`) publishes an `InternalEventV2` with `egress.connector = 'webhook'` and `egress.metadata` containing `webhookUrl`, `headers`, and `format`.
2. **Event Reception**: `api-gateway` picks up the event from the bus.
3. **Resolution Phase**:
   - `VariableResolver` processes the `webhookUrl`.
   - `VariableResolver` processes each value in the `headers` map.
4. **Formatting Phase**:
   - `WebhookManager` selects the formatter based on `metadata.format` (falling back to `json`).
   - The selected formatter generates the outgoing request body.
5. **Execution Phase**:
   - `WebhookManager` executes an asynchronous POST request using `fetch`.
6. **Persistence & Observability**:
   - Success (`2xx`): Outcome logged as `DELIVERED`.
   - Failure (`4xx`/`5xx` or network error): Outcome logged as `FAILED`, and an `egress.failed` event is published back to the message bus for DLQ or retry handling.

## 4. Security Architecture
- **Secret Resolution at the Edge**: Sensitive information (e.g., API keys, integration tokens) remains within the `api-gateway`'s secure environment. Internal services only reference the secret by name (`${secret.MY_KEY}`), ensuring that raw secrets never traverse the internal message bus.
- **Environment Isolation**: `api-gateway` only has access to secrets and environment variables explicitly provisioned for its role.

## 5. Performance Considerations
- **Stateless Execution**: The gateway does not maintain state for webhook deliveries, ensuring horizontal scalability.
- **Asynchronous Processing**: Webhook delivery is non-blocking to the primary event flow of the gateway.

## 6. Observability
- All webhook attempts are tagged with the original event's `correlationId`.
- Logs include destination URLs (after non-sensitive resolution) and outcome status.
- Standard platform metrics capture success/failure rates for egress.
