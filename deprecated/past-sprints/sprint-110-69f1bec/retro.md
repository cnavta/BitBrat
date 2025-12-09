# Sprint Retro – sprint-110-69f1bec

## What worked
- Attribute normalization helper enabled driver parity with minimal code duplication.
- Pub/Sub timeout + ensure strategy reduced worst‑case publish latency and improved diagnosability.
- Structured logging around publish/flush provided fast triage signals in tests and local runs.
- BaseServer Resource Management centralized publisher/Firestore initialization, improving startup consistency and shutdown behavior.

## What didn’t
- Initial test fragility in command-processor due to resource vs factory mocking differences; resolved by preferring factory under Jest and making setup synchronous.
- Backoff integration into subscribers was out of scope/time; helper and tests landed but wiring deferred.

## Improvements
- Add a micro-benchmark harness for publish latency and first-publish cold start across drivers.
- Consider smoke tests that validate PUBSUB_API_ENDPOINT/PROJECT_ID and emulator flows.
- In a follow-up sprint, integrate computeBackoffSchedule into subscriber retry policies (BB-110-05).
