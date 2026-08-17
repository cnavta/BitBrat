# Sprint Execution Plan – sprint-141-9b1a72

## Overview
Implement Auth User Enrichment v1 to enrich EnvelopeV1.user with notes and tags, establish a 24h inactivity session model, and create/update Firestore user documents per ingress source.

## Milestones
- M1 – Foundations (Repo + Rules + Stubs)
- M2 – Core Enrichment (Lookup/Create/Update + Tags)
- M3 – Testing (Unit + Emulator Integration + Contract)
- M4 – Observability (Metrics + Logs) and Hardening
- M5 – Validation & Release Prep

## Work Breakdown & Sequencing
1) Foundations
   - Create Firestore users repository (read/update/create)
   - Adapter to resolve provider + providerUserId from incoming events
   - Config flags (enable/disable enrichment; dry-run logging mode)
2) Core enrichment
   - Read user doc by `${provider}:${providerUserId}`
   - Create on first-seen with initialized counters and timestamps
   - Session boundary logic (24h inactivity => new session)
   - Message counters and last* timestamps updates
   - Tagging logic: NEW_USER, FIRST_ALLTIME_MESSAGE, FIRST_SESSION_MESSAGE, RETURNING_USER
   - Envelope augmentation: envelope.user + envelope.auth
3) Testing
   - Unit tests for tag and session boundary logic
   - Firestore emulator integration tests for create vs update paths
   - Contract tests to assert envelope schema and contents
4) Observability & Hardening
   - Structured logs around lookups, creations, updates
   - Metrics: created_user_count, new_session_count, first_message_count, enriched_event_count
   - Error handling + retries (backoff)
5) Validation & Release Prep
   - Run sprint validate script and repo validator
   - Review Firestore rules and principle of least privilege
   - Prepare PR with summary and links

## Environments & Tooling
- Firestore Emulator for local integration tests
- Jest for unit/integration tests
- Existing CI to run build/test

## Risk & Mitigation
- Incorrect session boundary at 24h: Cover with edge-case tests at 23:59/24:00/24:01
- Duplicate user creation under race: Use Firestore transaction/merge semantics to avoid clobber
- Missing provider/userId: Skip enrichment safely with auth.matched=false
- Performance under load: Batch reads when feasible; keep single-user operations transactional

## Acceptance Criteria (from plan)
- New user doc created per provider on first-seen
- Tags set correctly for first-ever, first-session, and returning messages
- EnvelopeV1.user.notes populated from Firestore when present
- All tests pass locally and in CI; validate script succeeds

## Definition of Ready
- Technical Architecture approved (DONE)
- Clear mapping for provider+userId in each ingress (Discord/Twitch)

## Definition of Done
- Code merged to main behind feature flag or safe defaults
- Tests green; docs updated; validation passes
- Observability in place; Firestore rules verified

## Estimates (T-shirt)
- Foundations: M
- Core enrichment: L
- Testing: M
- Observability & hardening: S-M
- Validation & release prep: S
