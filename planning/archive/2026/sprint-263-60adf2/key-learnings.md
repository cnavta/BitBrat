# Key Learnings – sprint-263-60adf2

- **Behavioral Policy Isolation**: Deriving a normalized `BehaviorProfile` once per event made it practical to apply `risk > intent > tone` consistently across prompting, gating, tool eligibility, and logs without changing the event schema.
- **Annotation Compatibility Matters**: Extending router annotation matching to accept the current query-analyzer shape avoided a schema migration while still enabling annotation-aware routing decisions.
- **Validation Needs Two Layers**: Service-level Jest coverage caught behavioral-control regressions quickly, while a separate Compose config regression protected local runtime assumptions that unit tests would otherwise miss.
