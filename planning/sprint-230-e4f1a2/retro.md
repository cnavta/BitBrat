# Retro – sprint-230-e4f1a2

## What Worked
- **Big Bang Migration Strategy**: Despite being a breaking change across the entire platform, the migration was managed effectively by following a phased approach (Types -> Common -> Ingress -> Auth -> Router -> Egress -> Tests).
- **JsonLogic Compatibility**: Proactively mapping the new V2 paths to legacy context fields in `JsonLogicEvaluator` prevented major breakage of existing routing rules stored in the database.
- **Global Search/Replace for Tests**: Using `sed` to update common version strings and field names significantly sped up the test alignment phase.

## Challenges
- **Resource Leaks in Integration Tests**: Some tests were leaking `setInterval` timers because `server.stop()` wasn't being called, causing extremely long test runs and console spam.
- **Integration Test Complexity**: `IngressEgressServer` tests required careful mocking of the `message-bus` to avoid real PubSub connection attempts when simulating production environments.

## Lessons Learned
- Ensure all tests that initialize servers have an `afterEach` that calls `stop()` or equivalent cleanup.
- Standardizing property locations (`ingress.source` vs `source`) simplifies downstream processing logic and makes the event flow more predictable.
- Grouping user information into `identity.external` and `identity.user` clearly separates platform-level data from internal database data.
