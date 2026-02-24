# Key Learnings – sprint-258-7e3f2a

- Async enrichment in event handlers can easily lose context if the event object is reconstructed.
- Test mocks should reflect the latest interface of the objects being mocked.
- Non-deterministic timing in tests should use larger buffers or more robust waiting mechanisms.
