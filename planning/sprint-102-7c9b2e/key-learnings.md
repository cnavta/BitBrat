# Key Learnings - sprint-102-7c9b2e

- Firestore collection paths must have an odd number of segments; normalize defensively and document clearly.
- Avoid long blocking calls on the hot publish path; favor publish-first and targeted retries with bounded ensures.
- Explicit ack semantics give better control and correctness under failure; tests should model ack/nack behavior.
- Disable external listeners (Firestore) during Jest to prevent open handles and post-teardown logs.
- Keep routing slips minimal in config; normalize runtime fields (status/attempt/version) in code for consistency.
- Decision logs with compact metadata aid debugging without excessive verbosity.