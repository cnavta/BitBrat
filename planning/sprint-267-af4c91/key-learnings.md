# Key Learnings – sprint-267-af4c91

## Architecture & Design
- **Immutable Snapshots for Auditability:** Storing full snapshots at each boundary transition provides perfect traceability, even when subsequent steps fail or modify event state.
- **Sequence as a Persistence Responsibility:** Transactional assignment of sequence numbers at the storage layer is safer than publisher-side incrementing in high-concurrency event-driven systems.

## Process & Tools
- **Policy-Driven Helpers:** Implementing snapshot behavior via a shared helper with configurable policy (`PERSISTENCE_SNAPSHOT_MODE`) allowed for incremental rollout and consistent behavior.
- **Validation Script Limitations:** Large-scale integration tests are valuable but can hit environmental limits; scoped unit/integration tests for the core logic are more reliable for fast feedback.

## Implementation Details
- **Firestore Batch Transactions:** Managing both the aggregate document and the snapshot sub-collection document in a single transaction is critical for maintaining data consistency during the initial ingest or finalization.
