# Key Learnings - sprint-110-69f1bec
- Maintaining transport-agnostic attribute normalization simplifies cross-driver parity.
- Timeout and ensure strategies should be environment-tunable with conservative defaults.
- Structured logs at publish start/ok/error provide fast triage for latency issues.
 - Centralizing shared resources (publisher, Firestore) in BaseServer reduces cold-start costs and prevents duplicate client init.
 - Tests interacting with async service setup benefit from synchronous setup in constructors or explicit hooks; prefer factory paths under Jest to honor mocks.