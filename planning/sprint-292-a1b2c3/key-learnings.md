# Key Learnings - sprint-292-a1b2c3

- **Backward Compatibility**: Even when moving to a new event structure (V2), legacy tests often mix and match fields. Differentiating between "legacy" and "V2" should be done based on structure (e.g. `message` block) rather than just presence of new flags like `egress`.
- **Egress Skip Logic**: The distinction between `IGNORED` and `FAILED` is critical for preventing DLQ noise. `IGNORED` should be reserved for intentional "no response" paths.
