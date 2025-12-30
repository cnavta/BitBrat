# Key Learnings – sprint-181-f2e3d4

## SDK Limitations
The Twilio Conversations WebSocket SDK is identity-scoped, meaning it only receives events for conversations where the identity is ALREADY a participant. It cannot "discover" new conversations unless it is invited or added via another channel (REST or another participant).

## Hybrid is Often Necessary
For mobile/real-time SDKs that use persistent connections (like WebSockets or MQTT), a server-side "manager" component using a REST API is often necessary to bridge the gap between external system events (like SMS) and the identity-scoped view of the client.

## Webhook Validation
Always plan for signature validation when exposing endpoints to third-party services like Twilio. This prevents spoofing and unauthorized REST API calls.
