# Key Learnings – sprint-230-e4f1a2

## Architectural Insights
- **Grouping over Flattening**: Grouping metadata into logical blocks (`ingress`, `identity`) is superior to raw flattening as it prevents property collisions and improves readability.
- **Identity Duality**: Maintaining both `identity.external` and `identity.user` is critical for services that bridge external platforms (e.g., Twitch) and internal business logic.

## Technical Lessons
- **Defensive Ingress Building**: Ingress builders should be defensive about missing platform metadata to avoid `InternalEvent` validation errors later in the pipeline.
- **Correlation ID Consistency**: Services that generate their own events (like `scheduler` or `auth` tools) must strictly adhere to the `InternalEvent` schema for `correlationId` and `v` to avoid routing failures.
- **Egress Lookup Logic**: In the `api-gateway`, always prioritize the `external.id` for socket lookup, as the internal `userId` may change during enrichment (e.g., prefixing).

## Process Improvements
- **Incremental Verification**: Running targeted tests for each service immediately after modification saved significant time compared to a single massive test run at the end.
- **Backlog Tracking**: Keeping the `backlog.yaml` updated in real-time helped maintain focus during the multi-service refactor.
