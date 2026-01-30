# Key Learnings – sprint-230-e4f1a2

## Technical
- **InternalEventV2 Refactor**: Flattening the envelope into the root of the event makes properties like `correlationId` and `type` easier to access and reduces serialisation overhead.
- **Identity Grouping**: The `identity.external` pattern is highly effective for ingress processes to pass platform-specific user metadata without polluting the root namespace.
- **Defensive Ingress**: Adding null checks to ingress builders (like `EventSubEnvelopeBuilder`) is critical when dealing with external SDKs that might emit unexpected null events.

## Process
- **Incremental Verification**: Running unit tests for each service immediately after migration helped catch schema mismatches early.
- **Git Branch Management**: Maintaining a clean feature branch and pushing regularly ensured that work was safe and reviewable.
- **Sprint Protocol Rigor**: Following the Sprint Protocol v2.5 ensured that all planning artifacts, logs, and verification reports were complete and traceable.
