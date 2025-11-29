Auth Service – User Enrichment v1

The Auth service enriches internal events with user information from Firestore and republishes them for downstream routing.

Overview
- Input: internal.ingress.v1 (prefixable via BUS_PREFIX)
- Output: internal.user.enriched.v1 (override via AUTH_ENRICH_OUTPUT_TOPIC)
- Contract additions:
  - envelope.user: { id, email?, displayName?, roles?, status? }
  - envelope.auth: { v:'1', method:'enrichment', matched:boolean, userRef?, at, provider? }
- Forwarding behavior: Always forwards the event even when no user match is found (matched=false).

Environment Variables
- MESSAGE_BUS_DRIVER: 'pubsub' | 'nats' (default: pubsub)
- BUS_PREFIX: optional subject/topic prefix (e.g., "dev.")
- AUTH_ENRICH_OUTPUT_TOPIC: override for default output topic (default: internal.user.enriched.v1)
- FIREBASE_DATABASE_ID: optional Firestore multi-database binding
- LOG_LEVEL: error|warn|info|debug

Firestore
- Collection: users (top-level)
- Document ID: userId (string)
- Suggested fields: email, displayName?, roles?, status?, identities?
- Access: read-only required by this service (no writes in v1)

IAM (Least Privilege)
- Grant the runtime service account read access to the users collection only.
- Recommended roles: a custom role with datastore.entities.get, datastore.entities.list scoped to the project; or Firestore rules permitting read for the service identity in the target environment.

Observability
- Logs: info on subscription/publish; debug on enrichment outcome; error on failures
- Counters (/_debug/counters): auth.enrich.total, auth.enrich.matched, auth.enrich.unmatched, auth.enrich.errors

Error Handling
- JSON parse errors: ack (no retry)
- Firestore/publish transient errors: nack with requeue

Notes
- Runtime: Node 24.x on Cloud Run (managed)
- The event-router expects internal.user.enriched.v1 by default, aligning the pipeline ingress → auth → router.