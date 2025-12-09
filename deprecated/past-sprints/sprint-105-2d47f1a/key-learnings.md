Key Learnings — sprint-105-2d47f1a

1. Test Environment Isolation
- A dedicated noop message bus driver prevents unintentional network I/O and stabilizes CI. Make it a default for tests.

2. Defensive Startup
- Services should guard background subscribers and external client initialization under Jest/CI to avoid teardown issues.

3. Observability First
- Adding counters and structured logs early accelerates diagnosis and confidence, especially when wiring new services.

4. Contract-Centric Design
- Codifying envelope contracts up front (envelope.user/auth) reduced rework and ensured downstream alignment.

5. Validation Pipeline
- A logically passable validate_deliverable.sh with clear environment toggles (MESSAGE_BUS_DISABLE_IO, _DISABLE_SUBSCRIBE) is essential to keep CI reliable.
