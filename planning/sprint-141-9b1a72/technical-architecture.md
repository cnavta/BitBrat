# Technical Architecture – Auth User Enrichment v1 (Notes & Tags)

## Objective
Extend the auth/enrichment flow to:
- Populate EnvelopeV1.user.notes from the user’s Firestore document
- Populate EnvelopeV1.user.tags with deterministic state tags (e.g., NEW_USER, FIRST_ALLTIME_MESSAGE, FIRST_SESSION_MESSAGE)
- Auto-create a new Firestore user document for any first‑seen user, keeping uniqueness per ingress source (provider + providerUserId)
- Establish a clear session model where 24h inactivity => new session

## Context & Constraints
- Use and extend the existing event model: EnvelopeV1.user.notes (string), EnvelopeV1.user.tags (string[])
- Users are unique per ingress source (e.g., Twitch vs Discord are separate users)
- Session boundary: 24 hours of inactivity starts a new session
- No special compliance constraints for notes right now (assume internal-only, redact if needed later)

## High-Level Flow
1) Message arrives via ingress (Discord/Twitch)
2) Event Router forwards to Auth/Enrichment service
3) Enrichment service:
   - Resolves provider and providerUserId from the envelope/platform payload
   - Looks up Firestore user doc keyed by provider+providerUserId
   - If missing: creates the user doc (firstSeenAt set, message counters initialized)
   - Updates counters and session fields
   - Computes tags and reads notes
   - Writes EnvelopeV1.user and EnvelopeV1.auth metadata
4) Downstream services receive enriched event

## Data Model

### Event Envelope (existing, referenced)
- EnvelopeV1.user.notes: string | undefined
- EnvelopeV1.user.tags: string[] | undefined

### Firestore
Collection: users
- Document ID: `${provider}:${providerUserId}`

Example schema (minimum viable fields):
```
users/{provider}:{providerUserId} {
  provider: "twitch" | "discord" | string,
  providerUserId: string,
  displayName?: string,
  email?: string,
  roles?: string[],
  status?: string,

  // Enrichment-related
  notes?: string,                // Internal operator notes shown to LLMs
  tags?: string[],               // Persistent tags (long-lived labels)

  // State tracking
  firstSeenAt: string,           // ISO timestamp first seen
  lastSeenAt: string,            // ISO timestamp last seen (any event)
  lastMessageAt?: string,        // ISO timestamp last message event
  messageCountAllTime: number,

  // Session tracking
  lastSessionId?: string,
  lastSessionStartedAt?: string,
  lastSessionActivityAt?: string,
  sessionCount?: number,

  // Provider profiles (extensible)
  profiles?: {
    twitch?: { id: string; login?: string; displayName?: string; },
    discord?: { id: string; username?: string; discriminator?: string; },
  }
}
```

Notes:
- Uniqueness per ingress source is achieved by composite doc IDs (`provider:userId`).
- Future identity linking (cross‑provider accounts) can be added via a `links[]` array or `accounts` sub-objects without breaking uniqueness.

## Session Model
- New session if inactivity >= 24h since lastSessionActivityAt (or lastMessageAt if undefined)
- Session ID: `sess_${yyyyMMdd}_${provider}_${providerUserId}_${shortRand}`
- On each message:
  - If no user doc: create, set firstSeenAt, lastSeenAt, lastMessageAt, messageCountAllTime=1, sessionCount=1, new lastSessionId
  - Else update lastSeenAt/lastMessageAt, increment messageCountAllTime
  - If 24h inactivity threshold passed: increment sessionCount, generate new lastSessionId and lastSessionStartedAt
  - Always set lastSessionActivityAt=now

## Tagging Logic
Tags are recomputed per-event and placed in EnvelopeV1.user.tags (transient for the event), with some tags optionally persisted to the user doc (long-lived).

Deterministic transient tags (per event):
- NEW_USER: set if this is the first ever event for this (provider, userId)
- FIRST_ALLTIME_MESSAGE: set on the very first message event
- FIRST_SESSION_MESSAGE: set on the first message observed after a new session boundary
- RETURNING_USER: set when messageCountAllTime > 1 and not NEW_USER

Optional persistent tags (long-lived labels stored on the user doc):
- PROVIDER_TWITCH, PROVIDER_DISCORD
- MODERATOR, SUBSCRIBER, VIP (platform-derived roles, if available)
- INTERNAL_TEST, STAFF, FRIEND, HIGH_VALUE, TRIAL, PAYING_CUSTOMER
- LANGUAGE_<ISO>, TIMEZONE_<IANA>, LOCALE_<BCP47> (when detected upstream/downstream)
- COOLDOWN, RATE_LIMITED (if policy applied)
- FEEDBACK_POSITIVE, FEEDBACK_NEGATIVE, BUG_REPORTER (if events indicate)

Tag computation steps:
1) Load user doc (or create)
2) Determine current session vs new session using 24h rule
3) Build transient tags set per rules above
4) Union with any persistent tags that should always be surfaced (configurable)
5) Write tags into envelope; do not overwrite user‑doc.tags unless rules specify persistence

## Auth/Enrichment Service Responsibilities
- Input: InternalEvent/Envelope with provider + platform payload to resolve providerUserId
- Firestore operations:
  - get user doc by `${provider}:${providerUserId}`
  - create if missing with initialized counters
  - update counters and session metadata atomically
- Tag calculation per rules
- Envelope augmentation:
  - user: { id, displayName?, email?, roles?, status?, notes?, tags? }
  - auth: { v: '1', provider, method: 'enrichment', matched: boolean, userRef, at }
- Observability: log info and debug for lookups, creations, and updates; record metrics (created_user_count, session_count, new_session_count, first_message_count)

## Error Handling
- If Firestore unavailable: continue without enrichment, set auth.matched=false and include reason in auth payload
- Timeouts: set conservative retry with backoff; do not block pipeline indefinitely
- Input validation: if provider or userId missing, skip enrichment (matched=false)

## Security & Compliance
- Notes currently have no special constraints; treat as internal text, cap length (e.g., 4KB) and sanitize for control chars
- Access to users/* guarded by firestore.rules to restrict writes to platform services
- PII minimization: store only necessary profile fields

## Backward Compatibility
- EnvelopeV1.user is optional; services that don’t rely on enrichment remain unaffected
- New fields are additive; no breaking changes

## Testing Strategy (high level)
- Unit tests: tag computation for first-ever, first-session, returning user; 24h boundary edge cases
- Integration: Firestore emulator tests for create vs update paths and counters
- Contract tests: ensure EnvelopeV1.user and auth fields are populated as specified

## Work Items (implementation-level outline)
1) Add enrichment logic in auth service to:
   - Resolve provider + user ID
   - Read/Write Firestore user doc
   - Compute tags and session transitions
   - Populate envelope.user and envelope.auth
2) Firestore rules: ensure only auth/enrichment has write access to users/*
3) Tests: unit + emulator integration
4) Observability: metrics counters and structured logs

## Acceptance Criteria (excerpt)
- New user doc is created on first seen per provider
- FIRST_ALLTIME_MESSAGE and NEW_USER tags appear on first user message
- FIRST_SESSION_MESSAGE appears on the first message after >=24h inactivity
- Returning messages include RETURNING_USER and omit NEW_USER
- EnvelopeV1.user.notes is populated from Firestore when present
