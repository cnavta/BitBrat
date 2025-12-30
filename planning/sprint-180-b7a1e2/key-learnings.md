# Key Learnings – sprint-180-b7a1e2

## Visibility is Key
When troubleshooting third-party SDK integrations (like Twilio), always ensure lifecycle events are logged at a visible level (`INFO`) during early stages of implementation. `DEBUG` logs are often silenced in production environments, leading to the perception that events are missing.

## SDK Redundancy
The Twilio Conversations SDK sometimes fires multiple events for the same logical action (e.g., `conversationAdded` with status `joined` vs `conversationJoined`). Handling both provides better resilience across different SDK versions or race conditions.

## Project Integrity
Unrelated validation errors in core configuration files (like `architecture.yaml`) can block development and validation. Regular full-project validation checks are essential to catch these early.
