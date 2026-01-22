# Key Learnings – sprint-209-f8e9d0

## Architectural Decisions
- **WebSocket over REST**: Chosen for the bi-directional nature of chat and event passing, providing a more responsive experience for external bots.
- **Opaque Tokens**: Using hashed opaque tokens in Firestore is preferred over JWTs for this use case because it allows for easy revocation and server-side control without needing a complex CRL (Certificate Revocation List) or short-lived token refresh logic for external programmatic clients.
- **Instance-specific Egress**: Subscribing to `internal.api.egress.v1.{instanceId}` ensures that events are only delivered to the specific gateway instance where the client is connected, avoiding duplicate delivery or unnecessary cross-instance coordination.
