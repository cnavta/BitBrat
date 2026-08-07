# Execution Plan – sprint-179-d2e3f4

This plan details the technical steps for implementing Twilio SMS integration within the `ingress-egress` service, as defined in the Technical Architecture.

## Phase 1: Infrastructure & Configuration
Goal: Set up the necessary configuration and dependencies.

- **Task 1.1: Update architecture.yaml**: Add Twilio secrets (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_CHAT_SERVICE_SID`) and environment variables (`TWILIO_ENABLED`, `TWILIO_IDENTITY`) to the `ingress-egress` service definition.
- **Task 1.2: Update config.ts**: Define `TwilioConfig` interface and update `buildConfig` to parse Twilio-related environment variables and secrets.
- **Task 1.3: Verify Dependencies**: Ensure `@twilio/conversations` and `twilio` are correctly installed and available in `package.json`.

## Phase 2: Core Twilio Implementation
Goal: Implement the specific components for Twilio communication.

- **Task 2.1: Implement TwilioTokenProvider**: Create a utility (possibly in `src/services/ingress/twilio/token-provider.ts`) to generate JWT Access Tokens for the Twilio Conversations SDK.
- **Task 2.2: Implement TwilioEnvelopeBuilder**: Create `src/services/ingress/twilio/twilio-envelope-builder.ts` to transform Twilio message events into the platform's standard `IngressEnvelope`.
- **Task 2.3: Implement TwilioIngressClient**: Create `src/services/ingress/twilio/twilio-ingress-client.ts` using `@twilio/conversations` SDK to manage WebSocket connections and handle `messageAdded` events.
- **Task 2.4: Implement TwilioConnectorAdapter**: Create `src/services/ingress/twilio/connector-adapter.ts` implementing the `IConnector` interface to enable egress messages to be sent via Twilio.

## Phase 3: Service Integration
Goal: Wire the Twilio components into the `ingress-egress` service.

- **Task 3.1: Integrate into IngressEgressServer**: Update `src/apps/ingress-egress-service.ts` to instantiate and start the `TwilioIngressClient` and register the `TwilioConnectorAdapter` with the `ConnectorManager` if `TWILIO_ENABLED` is true.
- **Task 3.2: Error Handling & Logging**: Ensure proper logging of connection status and graceful error handling for Twilio SDK interactions.

## Phase 4: Validation & Testing
Goal: Ensure the implementation is robust and correct.

- **Task 4.1: Unit Tests**: Create unit tests for `TwilioEnvelopeBuilder` and `TwilioTokenProvider`.
- **Task 4.2: Integration Tests**: Create mock-based integration tests for `TwilioIngressClient` to verify it correctly publishes events to the internal bus and handles egress.
- **Task 4.3: Manual Verification**: Use `validate_deliverable.sh` to confirm the project builds and all tests pass.

## Phase 5: Publication
Goal: Finalize the sprint and prepare for review.

- **Task 5.1: Documentation**: Ensure `technical-architecture.md` and `implementation-plan.md` are up to date.
- **Task 5.2: Create PR**: Push the feature branch and create a Pull Request on GitHub.
