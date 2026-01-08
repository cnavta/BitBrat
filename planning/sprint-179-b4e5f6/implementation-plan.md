# Sprint Execution Plan – sprint-179-b4e5f6: Twilio SMS Integration

## Objective
- Add a Twilio-node based SMS integration to the `ingress-egress` service using WebSockets for receiving and Twilio APIs for sending.

## Scope
- `ingress-egress` service enhancements.
- New `src/services/ingress/twilio` module.
- Integration into `IngressEgressServer`.

## Deliverables
- `SmsEnvelopeBuilder`: Converts Twilio messages to internal events.
- `TwilioSmsIngressClient`: Handles WebSocket connectivity to Twilio Conversations and implements Ingress/Egress interfaces.
- Updated `IngressEgressServer` to register and start the Twilio connector and handle egress delivery.
- Unit tests for all new components.
- Updated `architecture.yaml` and config framework.

## Acceptance Criteria
- [ ] SMS received via Twilio Conversations are published as `InternalEventV2`.
- [ ] Egress messages with `source=twilio` are sent via Twilio REST API.
- [ ] Service starts correctly with Twilio enabled/disabled.
- [ ] `validate_deliverable.sh` passes successfully.

## Prioritized Task Backlog (IE-SMS)

### Phase 1: Foundation (P0)
1. **IE-SMS-01: Install Dependencies**
    - `npm install twilio @twilio/conversations`
2. **IE-SMS-02: Configuration Framework**
    - Update `src/types/index.ts` with Twilio settings.
    - Update `src/common/config.ts` to parse `TWILIO_*` env vars.
    - Update `architecture.yaml` for `ingress-egress` service.

### Phase 2: Core Components (P0/P1)
3. **IE-SMS-03: SmsEnvelopeBuilder (P1)**
    - Implement mapping from Twilio `Message` to `InternalEventV2`.
4. **IE-SMS-04: TwilioSmsIngressClient (P0)**
    - Implement Access Token generation logic.
    - Implement `@twilio/conversations` lifecycle (start/stop).
    - Implement `messageAdded` event listener.
    - Implement `sendText()` using REST API.

### Phase 3: Integration & Delivery (P0)
5. **IE-SMS-05: Server Registration**
    - Register `TwilioSmsIngressClient` with `ConnectorManager` in `IngressEgressServer`.
6. **IE-SMS-06: Egress Routing**
    - Add logic to `IngressEgressServer` message listener to route to `twilioClient` when `source` matches.

### Phase 4: Verification (P0/P1)
7. **IE-SMS-07: Unit Testing (P1)**
    - Tests for mapping logic and client state management.
8. **IE-SMS-09: Validation & Publication (P0)**
    - Execute `validate_deliverable.sh`.
    - Create GitHub PR.

## Testing Strategy
- **Mocks**: Use `jest.mock` to simulate Twilio Conversations WebSocket client and Twilio REST client.
- **Contract Tests**: Verify `InternalEventV2` shape matches platform standards.
- **Integration Tests**: Verify end-to-end flow from message consumption to client call.

## Definition of Done
- MUST pass `npm test`.
- MUST pass `validate_deliverable.sh`.
- MUST have 100% task completion in `backlog.yaml`.
- PR Created.
