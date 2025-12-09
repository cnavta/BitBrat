Sprint Retrospective — sprint-105-2d47f1a

What worked
- Clear alignment with the approved technical architecture simplified implementation choices.
- Introducing a noop message bus driver eliminated CI flakiness and made tests deterministic.
- Guarding subscriptions and Firestore listeners during Jest prevented open-handle and teardown issues.
- Structured logging and counters gave immediate visibility into service behavior.

What didn’t
- Initial CI stability issues (segfaults) consumed time; implicit driver defaults led to accidental network I/O.
- Some planned contract/integration tests were deferred due to focusing on stabilization.

Improvements
- Keep a dedicated zero-I/O driver available from the start of a sprint for any networked component.
- Standardize test environment guards across all services (MESSAGE_BUS_DISABLE_SUBSCRIBE, MESSAGE_BUS_DISABLE_IO).
- Add a tiny harness for handler path tests to avoid needing real drivers.

Action items
- Add dedicated contract test files for envelope.user/auth shapes.
- Implement Firestore emulator-based integration test for enrichment.
- Consider adding a lint rule to ban direct driver imports from business code.
