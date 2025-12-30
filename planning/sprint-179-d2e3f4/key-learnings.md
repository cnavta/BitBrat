# Key Learnings – sprint-179-d2e3f4

## Twilio Conversations SDK
- **Auto-Join**: When a phone number is mapped to a Conversation Service, incoming SMS may create conversations where the bot identity is only "invited". The client MUST explicitly call `join()` on these conversations to receive messages.
- **Synchronization**: The SDK has a multi-step connection lifecycle. Listening for `synchronized` on the client state is more reliable than checking the WebSocket connection state for logical readiness.
- **Token Management**: Tokens should be updated via `client.updateToken(newToken)` before expiration. Both `tokenAboutToExpire` and `tokenExpired` events should be handled for maximum robustness.

## Platform Integration
- **Redaction**: Always ensure new secrets (like `TWILIO_API_SECRET`) are added to the `safeConfig` redaction list to prevent exposure in logs.
- **Diagnostic Visibility**: For WebSocket-based ingress, exposing the list of "joined" vs "invited" channels/conversations in a debug endpoint significantly reduces mean-time-to-resolution for "silent" message failures.
- **Egress Routing**: As the number of connectors grows, the selection logic in `ingress-egress-service.ts` should be moved to a more dynamic, metadata-driven system to avoid growing `if/else` chains.
