# Key Learnings — sprint-108-bc7a2d

Date: 2025-12-01 19:08 (local)

## Technical
- Lazy-importing critical processing functions in subscribers allows Jest module mocks to take effect reliably.
- Explicit, versioned event contracts (InternalEventV2) simplify service development and testing versus nested V1 envelopes.
- Transactional Firestore updates (cooldowns, rate limits) are essential to avoid race conditions under concurrency.

## Process
- Keeping a detailed request log with commands and outcomes increases traceability and speeds troubleshooting.
- Writing tests alongside implementation (policies, routing, logging) reduces later rework.

## Tooling
- A small CLI (firestore-upsert) speeds configuration management via GDAC without needing the Firebase Console.
- The validation script acting as a single entry point helps ensure repeatable local verification.

## Next Time
- Add deterministic RNG utilities for template selection tests.
- Consider shared test harness utilities for message bus subscribe/publish patterns.
