Title: Technical Architecture – Auth Service (User Enrichment)
Status: Approved (v1)
Sprint: sprint-104-f0bef1b
Branch: feature/sprint-104-f0bef1b-auth-architecture

Objective
- Build an Auth service responsible for user enrichment of internal events.
  - Listen on internal.ingress.v1
  - Look up any attached user identifier in a Firestore-backed user database
  - If found, add user information into the event envelope (see Contract below)
  - Publish the event (enriched or pass-through) to a default topic internal.user.enriched.v1 (overridable via env var AUTH_ENRICH_OUTPUT_TOPIC)
  - Service must forward even if user not found

Scope
- In scope: event contracts, Firestore schema, runtime flow, env vars, observability, error handling, security, deployment shape, and testing strategy.
- Out of scope (this sprint): functional implementation of the service code; infra provisioning for Firebase/Firestore; IAM binding changes.

Contracts and Types
- Input topic: internal.ingress.v1 (constant: INTERNAL_INGRESS_V1)
- Output topic (default): internal.user.enriched.v1 (constant: INTERNAL_USER_ENRICHED_V1), overridable via AUTH_ENRICH_OUTPUT_TOPIC
- Event type: InternalEventV1 from src/types/events.ts
- Envelope enrichment: add envelope.user and envelope.auth sub-objects when available

Envelope Additions (Auth)
- envelope.user: basic identity for downstream consumers
  {
    id: string;             // primary user id (e.g., Twitch user id)
    email?: string;         // optional; when available
    displayName?: string;   // display or preferred name
    roles?: string[];       // effective roles at time of enrichment
    status?: string;        // e.g., 'active' | 'disabled'
  }
- envelope.auth: meta about how enrichment occurred
  {
    v: '1';
    provider?: string;      // e.g., 'twitch', 'kick'
    method: 'enrichment';
    matched: boolean;       // whether a user record was found
    userRef?: string;       // Firestore doc path if matched
    at: string;             // ISO timestamp when enrichment executed
  }

User Lookup Inputs
- Primary: envelope.user.id (string) – confirmed
- Fallback: envelope.user.email (string) – confirmed
- If neither present, matched=false and service forwards without changes except envelope.auth{ matched:false }

Firestore Data Model
- Collection: users (top-level)
- Document ID: userId (string) – the same value stored in envelope.user.id
- Suggested fields:
  {
    email: string;
    displayName?: string;
    roles?: string[];           // e.g., ['broadcaster', 'mod']
    status?: 'active'|'disabled'|'pending';
    createdAt?: string;         // ISO8601
    updatedAt?: string;         // ISO8601
    identities?: { [provider: string]: string }; // provider->subject (e.g., twitch->"12345")
  }
- Indexes: (optional) composite index on email if frequently used for fallback lookup.

Runtime Flow
1) Subscribe to ${BUS_PREFIX}${INTERNAL_INGRESS_V1}
2) For each event:
   - Extract candidate user identifiers (userId, email)
   - Query Firestore users collection by document id (userId)
   - If not found and email present, query by where('email','==',email) limit 1
   - If a user is found:
     - Populate envelope.user with { id, email, displayName, roles, status }
     - Set envelope.auth = { v:'1', provider, method:'enrichment', matched:true, userRef, at }
   - Else:
     - Ensure envelope.auth = { v:'1', method:'enrichment', matched:false, at }
   - Publish event to outputSubject = ${BUS_PREFIX}${AUTH_ENRICH_OUTPUT_TOPIC || INTERNAL_USER_ENRICHED_V1}

Idempotency & Ordering
- Enrichment is stateless and idempotent per event; multiple passes should yield identical envelope.user/auth.
- No ordering guarantees are added by this service; rely on message bus semantics.

Environment Variables
- AUTH_ENRICH_OUTPUT_TOPIC: string (default: internal.user.enriched.v1)
- LOG_LEVEL: string
- MESSAGE_BUS_DRIVER: 'nats' | 'pubsub'
- NATS_URL: when MESSAGE_BUS_DRIVER='nats'
- BUS_PREFIX: string prefix for subjects, e.g., 'dev.'
- FIREBASE_DATABASE_ID: optional Firestore multi-db binding (maps to configureFirestore)

Observability
- Log at info: subscription start/stop, publish success/failure
- Log at debug: enrichment outcomes with matched, userId/email, userRef, output subject
- Metrics (counters):
  - auth.enrich.total
  - auth.enrich.matched
  - auth.enrich.unmatched
  - auth.enrich.errors
- Consider exporting /_debug/counters and /healthz endpoints via BaseServer defaults.

Error Handling
- JSON parsing errors: ack (do not retry poison messages)
- Firestore transient errors: nack with requeue
- Publish errors: nack with requeue
- Always attempt to include correlationId and traceId in logs for traceability

Security & IAM
- Service account should have least-privilege read access to Firestore users collection
- Avoid writing to users via this service in v1
- Ensure transport auth as per Cloud Run default; public ingress allowed only if mandated by architecture.yaml defaults

Deployment
- Runtime: Node 24.x on Cloud Run (managed) per architecture.yaml defaults
- Message bus: Google Pub/Sub or NATS via existing abstraction in src/services/message-bus
- Configure FIREBASE_DATABASE_ID if using multi-tenant Firestore
- Topics: ensure internal.ingress.v1 and internal.user.enriched.v1 exist in the chosen bus implementation

Testing Strategy
- Unit tests: enrichment decision logic with mocked Firestore and bus
- Integration (local): Firestore emulator and in-memory bus mocks
- Contract tests: verify envelope.user/auth shapes and presence with matched/unmatched cases

Open Questions (Resolved)
1) User lookup key: envelope.user.id primary, fallback envelope.user.email – Yes
2) Firestore collection/schema (users): Yes (see above)
3) Output topic env var: AUTH_ENRICH_OUTPUT_TOPIC – Yes
4) Router default input topic env var: ROUTER_DEFAULT_INPUT_TOPIC – Yes
5) Message bus: Google Pub/Sub supported via pubsub-driver – Yes

Notes on Router Alignment
- As of this sprint, event-router’s default input has moved to internal.user.enriched.v1, so the typical path is: ingress → auth (enrich) → router.
- Downstream routing rules may further dispatch to bot, formatter, or egress.
