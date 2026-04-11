# Implementation Plan – sprint-281-0f4a2b

## Objective
- Build out the generalized Webhook Egress functionality within the `api-gateway` service.

## Scope
- Architectural design for Webhook Egress.
- `WebhookManager` in `api-gateway` to handle `egress.connector: "webhook"` events.
- Variable Resolution logic for `${event.*}`, `${ENV.*}`, and `${secret.*}`.
- Payload Formatters: `json` (default) and `discord`.
- Secure secret resolution at the edge.
- Monitoring and logging for all outgoing webhooks.

## Deliverables
- Technical Architecture document.
- `WebhookManager` class and supporting components in `api-gateway`.
- Variable resolution engine.
- Formatter registry.
- Integration with message bus to subscribe to egress events.
- Unit and integration tests.
- Documentation for usage.

## Acceptance Criteria
- `api-gateway` successfully processes events with `egress.connector: "webhook"`.
- Correct interpolation of event properties, environment variables, and secrets.
- Payloads are correctly formatted for `json` and `discord`.
- Webhook delivery status is logged (DELIVERED, FAILED).
- Failed deliveries publish `egress.failed` events.

## Testing Strategy
- Unit tests for `VariableResolver` and `FormatterRegistry`.
- Mock server to verify HTTP POST requests from `WebhookManager`.
- Integration test for end-to-end event-to-webhook flow.

## Deployment Approach
- Cloud Run for `api-gateway`.
- Secret Manager for platform-managed secrets.

## Dependencies
- Internal message bus (Redis or similar).
- HTTP Fetch API (undici or native fetch in Node 18+).

## Definition of Done
- Technical Architecture approved.
- Code implements all features in requirement doc.
- `validate_deliverable.sh` passes.
- PR created and URL recorded.
