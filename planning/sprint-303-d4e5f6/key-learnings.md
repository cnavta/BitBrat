# Key Learnings – sprint-303-d4e5f6

## Enrichment vs Tools
- Injecting context via annotations is more robust than relying on bot memory or direct tool calls for state. It ensures the LLM always has the "ground truth" before it even starts processing.

## Firestore Schema Consistency
- Explicitly typing history entries (e.g., `narrative_scene`) is crucial for reliable retrieval. Filtering for specific types in `get_current_scene` fixed many of the "jumping" issues seen in Phase 1.

## Snapshotting
- Leveraging `BaseServer.publishPersistenceSnapshot` provides an easy way to enable auditable history without adding complex logic to every tool.
