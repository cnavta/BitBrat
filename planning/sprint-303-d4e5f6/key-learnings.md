# Key Learnings – sprint-303-d4e5f6

## Enrichment vs Tools
- Injecting context via annotations is more robust than relying on bot memory or direct tool calls for state. It ensures the LLM always has the "ground truth" before it even starts processing.

## Firestore Schema Consistency
- Explicitly typing history entries (e.g., `narrative_scene`) is crucial for reliable retrieval. Filtering for specific types in `get_current_scene` fixed many of the "jumping" issues seen in Phase 1.

## Snapshotting
- Leveraging `BaseServer.publishPersistenceSnapshot` provides an easy way to enable auditable history without adding complex logic to every tool.

## Pub/Sub Acknowledgement Strategy
- `BaseServer.onMessage` uses explicit acknowledgement by default. Handlers MUST call `ctx.ack()` on all exit paths (success and error) to avoid message redelivery loops. This was a significant finding during the remediation of the Scheduler and Story Engine loops.

## Ingress Self-Filtering
- Connectors (especially Twitch IRC) must explicitly filter out their own messages by comparing the sender's ID/Login with the bot's credentials. Failure to do so leads to infinite loops when the bot responds to its own commands.

## Architecture & Tool Scaling
- As toolsets grow (e.g., adding 5+ story-specific tools), contextual filtering becomes necessary. The "Architecture Brief: Advanced Tool Selection" provides a roadmap for using event annotations to scope tools dynamically, preventing LLM confusion and reducing token costs.
