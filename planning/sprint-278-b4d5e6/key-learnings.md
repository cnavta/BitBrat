# Key Learnings – sprint-278-b4d5e6

- **Explicit Connectors:** Using explicit `connector` fields in event envelopes significantly reduces the reliance on brittle heuristics based on source names or provider strings.
- **Routing Precedence:** When implementing flexible routing, explicit destination fields should always override inferred destinations from ingress context, especially in cross-connector scenarios.
- **Type-Driven Refactoring:** Updating the central `ConnectorType` first helped identify all the places where the code needed to be updated to satisfy TypeScript's requirements.
