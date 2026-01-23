# Key Learnings – sprint-220-a1b2c3

- **Core Type Strategy**: When refactoring ubiquitous types like `EnvelopeV1`, expect to touch many files. Using required properties ensures correctness but increases migration effort.
- **Persistence Schema Evolution**: Inheritance between event types and document types (`EventDocV1 extends InternalEventV2`) simplifies code but couples database schema to internal event schema.
- **Mock Maintenance**: NATS JetStream `jetstreamManager` is now required for initialization in the current `nats` library version used. Mocks must reflect this to avoid `TypeError`.
- **Firebase Defaults**: The default Firebase database ID is `(default)`, and tests should align with this unless explicitly configured otherwise.
